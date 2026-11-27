use std::path::Path;
use std::process::Command;

use aice_aice_ir::ir_code::{Expr, LiteralVal, Pattern};
use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice_with_opts;
use aice_aice_ir::printer_expr::{print_expr, print_pattern};
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn roundtrip(lang: LanguageId, vname: &str, src: &str) -> (String, String) {
    let reg = EngineRegistry::default();
    let tr = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;
    let opts = TranspileOpts::default();
    let tree = reg.adapter(lang).unwrap().parse_cst(src).unwrap();
    let TranspileOutcome::Transpiled(m) = tr.to_aice(&tree, src, &opts).unwrap() else {
        panic!("expected Transpiled for {lang:?}");
    };
    let aice = print_aice_with_opts(&m, &opts);
    let reparsed = parse_aice(&aice).unwrap_or_else(|e| {
        panic!("parse_aice failed for {vname}: {e}\n--- AICE ---\n{aice}")
    });
    let native = tr.to_native(&reparsed, lang).unwrap_or_else(|e| {
        panic!("to_native failed for {vname}: {e}\n--- AICE ---\n{aice}")
    });
    let verdict = fw.verify(&native, Path::new(vname), lang);
    assert_eq!(
        verdict,
        FirewallVerdict::Valid,
        "firewall rejected {vname}:\n--- NATIVE ---\n{native}\n--- AICE ---\n{aice}"
    );
    (aice, native)
}

fn has_tool(name: &str) -> bool {
    Command::new("which").arg(name).output().is_ok_and(|o| o.status.success())
}

#[test]
fn f126_rust_tuple_and_slice_destructuring_roundtrip_and_rustc() {
    let rs_src = r#"fn triple() -> (i32, i32, i32) {
    (7, 8, 9)
}

pub fn eval(p: (i32, i32), q: (i32, (i32, i32)), arr: [i32; 2], arr3: [i32; 3], t1: (i32,)) -> i32 {
    let (a, b) = p;
    let (mut c, mut d) = p;
    let (mut e, g) = p;
    let (h, _) = p;
    let (_, i) = p;
    let (j, (k, l)) = q;
    let (m, n, o) = triple();
    let (r, s): (i32, i32) = p;
    let (only,) = t1;
    let [x, y] = arr;
    let [mut z, w] = arr;
    let [head, rest @ ..] = arr3;
    c += 1;
    d += 2;
    e += 3;
    z += 4;
    a + b + c + d + e + g + h + i + j + k + l + m + n + o + r + s + only + x + y + z + w + head + rest.len() as i32
}

fn main() {
    println!("{}", eval((1, 2), (3, (4, 5)), [10, 20], [100, 200, 300], (6,)));
}
"#;
    let (_, rs_nat) = roundtrip(LanguageId::Rust, "destr.rs", rs_src);
    for exp in [
        "let (a, b) = p;",
        "let (mut c, mut d) = p;",
        "let (mut e, g) = p;",
        "let (h, _) = p;",
        "let (_, i) = p;",
        "let (j, (k, l)) = q;",
        "let (m, n, o) = triple();",
        "let (r, s): (i32, i32) = p;",
        "let (only,) = t1;",
        "let [x, y] = arr;",
        "let [mut z, w] = arr;",
        "let [head, rest @ ..] = arr3;",
    ] {
        assert!(rs_nat.contains(exp), "missing `{exp}` in Rust output:\n{rs_nat}");
    }
    assert!(!rs_nat.contains("const ["), "JS destructuring leaked into Rust:\n{rs_nat}");

    if has_tool("rustc") {
        let dir = std::env::temp_dir().join(format!("aice_w15_rs_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let sp = dir.join("destr.rs");
        let bp = dir.join("destr");
        std::fs::write(&sp, &rs_nat).unwrap();
        let cc = Command::new("rustc")
            .args(["--edition", "2021", "-D", "warnings"])
            .arg(&sp)
            .arg("-o")
            .arg(&bp)
            .output()
            .unwrap();
        assert!(cc.status.success(), "rustc failed: {}\n{rs_nat}", String::from_utf8_lossy(&cc.stderr));
        let run = Command::new(&bp).output().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(run.status.success());
        assert_eq!(String::from_utf8_lossy(&run.stdout).trim(), "229");
    }
}

#[test]
fn f126_cpp_csharp_kotlin_js_ts_destructuring_matrix() {
    // C++ structured bindings (round-trip + untyped AICE IR compile + g++)
    let cpp_src = r#"#include <iostream>
#include <utility>
int main() {
    std::pair<int, int> p{10, 20};
    auto [a, b] = p;
    const auto& [c, d] = p;
    std::cout << (a + b + c + d) << std::endl;
    return 0;
}
"#;
    let (_, cpp_nat) = roundtrip(LanguageId::Cpp, "sb.cpp", cpp_src);
    assert!(cpp_nat.contains("auto [a, b] = p;"), "C++ auto [a, b]:\n{cpp_nat}");
    let cpp_untyped = DefaultAiceTranspiler
        .to_native(&parse_aice("module cpp\nfn f(p:auto) -> int:\n  [a, b] := p\n  ret a + b\n").unwrap(), LanguageId::Cpp)
        .unwrap();
    assert!(cpp_untyped.contains("auto [a, b] = p;"), "C++ untyped destructure:\n{cpp_untyped}");
    assert!(!cpp_untyped.contains("const [a, b]"), "JS leaked into C++:\n{cpp_untyped}");
    if has_tool("g++") {
        let dir = std::env::temp_dir().join(format!("aice_w15_cpp_sb_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let sp = dir.join("sb.cpp");
        let bp = dir.join("sb");
        std::fs::write(&sp, &cpp_nat).unwrap();
        let cc = Command::new("g++").args(["-std=c++17"]).arg(&sp).arg("-o").arg(&bp).output().unwrap();
        assert!(cc.status.success(), "g++ failed: {}\n{cpp_nat}", String::from_utf8_lossy(&cc.stderr));
        let run = Command::new(&bp).output().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(run.status.success());
        assert_eq!(String::from_utf8_lossy(&run.stdout).trim(), "60");
    }

    // C# tuple deconstruction (round-trip + untyped AICE IR)
    let cs_src = r#"using System;
public class CsDestr {
    public static int F((int, int) p, (int, (int, int)) q) {
        var (a, b) = p;
        var (e, _) = p;
        var (x, (y, z)) = q;
        return a + b + e + x + y + z;
    }
}
"#;
    let (_, cs_nat) = roundtrip(LanguageId::CSharp, "CsDestr.cs", cs_src);
    assert!(cs_nat.contains("var (a, b) = p;"), "C# var (a, b):\n{cs_nat}");
    assert!(cs_nat.contains("var (e, _) = p;"), "C# var (e, _):\n{cs_nat}");
    assert!(cs_nat.contains("var (x, (y, z)) = q;"), "C# nested var:\n{cs_nat}");
    let cs_untyped = DefaultAiceTranspiler
        .to_native(&parse_aice("module csharp\nfn f(p:object) -> int:\n  [a, b] := p\n  (c, d) := p\n  ret a + b + c + d\n").unwrap(), LanguageId::CSharp)
        .unwrap();
    assert!(cs_untyped.contains("var (a, b) = p;") && cs_untyped.contains("var (c, d) = p;"), "C# untyped:\n{cs_untyped}");
    assert!(!cs_untyped.contains("const ["), "JS leaked into C#:\n{cs_untyped}");

    // Kotlin, JS/TS, Python, Go, Ruby zero-regression checks
    let (_, kt_nat) = roundtrip(LanguageId::Kotlin, "d.kt", "fun f(p: Pair<Int, Int>): Int {\n    val (a, b) = p\n    var (c, d) = p\n    return a + b + c + d\n}\n");
    assert!(kt_nat.contains("val (a, b) = p") && kt_nat.contains("var (c, d) = p"), "Kotlin:\n{kt_nat}");

    let (_, js_nat) = roundtrip(LanguageId::JavaScript, "d.js", "function f(arr, obj) {\n    const [a, b] = arr;\n    let [head, ...rest] = arr;\n    const { x, y } = obj;\n    return a + b + head + rest.length + x + y;\n}\n");
    assert!(js_nat.contains("const [a, b] = arr;") && js_nat.contains("let [head, ...rest] = arr;") && js_nat.contains("const { x, y } = obj;"), "JS:\n{js_nat}");

    let (ts_aice, ts_nat) = roundtrip(LanguageId::TypeScript, "d.ts", "export function f(xs: number[], o: { a: number; b: number }): number {\n    const [head, ...rest] = xs;\n    const { a, b } = o;\n    return head + rest.length + a + b;\n}\n");
    assert!(ts_aice.contains("[head, ...rest] := xs"), "TS AICE:\n{ts_aice}");
    assert!(ts_nat.contains("const [head, ...rest] = xs;") && ts_nat.contains("const { a, b } = o;"), "TS:\n{ts_nat}");

    roundtrip(LanguageId::Python, "d.py", "def f(p):\n    [a, b] = p\n    return a + b\n");
    roundtrip(LanguageId::Go, "d.go", "package p\nfunc f(x int) int {\n    a := x + 1\n    return a\n}\n");
    let go_destr = DefaultAiceTranspiler
        .to_native(&parse_aice("module p\nfn f(p:any) -> int:\n  [a, b] := p\n  ret a + b\n").unwrap(), LanguageId::Go)
        .unwrap();
    assert!(go_destr.contains("a, b := p"), "Go destructure:\n{go_destr}");
    roundtrip(LanguageId::Ruby, "d.rb", "def f(p)\n  x = p\n  x\nend\n");
    let rb_destr = DefaultAiceTranspiler
        .to_native(&parse_aice("module ruby\nfn f(p):\n  [a, b] := p\n  ret a + b\n").unwrap(), LanguageId::Ruby)
        .unwrap();
    assert!(rb_destr.contains("a, b = p"), "Ruby destructure:\n{rb_destr}");
}

#[test]
fn f127_ident_nil_vs_literal_nil_ir_contract_and_polyglot() {
    // IR print/parse contract: bare `nil` stays LiteralVal::Nil, Ident("nil") uses `\#nil`
    assert_eq!(print_expr(&Expr::Literal(LiteralVal::Nil)), "nil");
    assert_eq!(print_expr(&Expr::Ident("nil".into())), "\\#nil");
    assert_eq!(print_pattern(&Pattern::Literal(LiteralVal::Nil)), "nil");
    assert_eq!(print_pattern(&Pattern::Ident("nil".into())), "\\#nil");

    // Verify lexer/parser does not touch PHP \nil, strings, comments, or identifiers containing nil
    let m = parse_aice("module t\nfn f():\n  s := \"\\\\#nil\"\n  a := \\#nil\n  b := nil\n  [c, nil] = [1, 2]\n  ret [s, a, b, c]\n").unwrap();
    let py_check = DefaultAiceTranspiler.to_native(&m, LanguageId::Python).unwrap();
    assert!(py_check.contains("a = nil") && py_check.contains("b = None") && py_check.contains("[c, nil] = [1, 2]"), "direct AICE:\n{py_check}");

    // 1. Python local scope (V15-SOAK-01 repro #1)
    let py_local = "def f():\n    nil = 14\n    x = None\n    return f\"{nil + 1}:{x is None}:{bool(x)}\"\nprint(f())\n";
    let (_, py_local_nat) = roundtrip(LanguageId::Python, "py_nil.py", py_local);
    assert!(py_local_nat.contains("x = None"), "Python local None corrupted:\n{py_local_nat}");
    if has_tool("python3") {
        let out = Command::new("python3").args(["-c", &py_local_nat]).output().unwrap();
        assert!(out.status.success(), "python3 local failed: {}\n{py_local_nat}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "15:True:False");
    }

    // 2. Python module scope (V15-SOAK-01 repro #2) + calling module fn nil() alongside None
    let py_mod = "def nil():\n    return 42\ndef other(x):\n    y = None\n    return (x == None, y)\ndef both():\n    return (nil(), None)\nprint(other(None), both())\n";
    let (_, py_mod_nat) = roundtrip(LanguageId::Python, "py_mod_nil.py", py_mod);
    assert!(py_mod_nat.contains("y = None"), "Python module None corrupted:\n{py_mod_nat}");
    if has_tool("python3") {
        let out = Command::new("python3").args(["-c", &py_mod_nat]).output().unwrap();
        assert!(out.status.success(), "python3 mod failed: {}\n{py_mod_nat}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "(True, None) (42, None)");
    }

    // 3. JavaScript (V15-SOAK-01 repro #3)
    let js_src = "function f(a) { const nil = 1; const x = null; return `${a === null}:${x === null}:${nil}`; }\nconsole.log(f(1));\n";
    let (_, js_nat) = roundtrip(LanguageId::JavaScript, "js_nil.js", js_src);
    assert!(js_nat.contains("const x = null;"), "JS null corrupted:\n{js_nat}");
    if has_tool("node") {
        let out = Command::new("node").args(["-e", &js_nat]).output().unwrap();
        assert!(out.status.success(), "node failed: {}\n{js_nat}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "false:true:1");
    }

    // 4. Java (V15-SOAK-01 repro #4)
    let java_src = "public class JavaNil { public static void main(String[] a) { int nil = 1; String s = null; System.out.println((s == null) + \":\" + nil); } }\n";
    let (_, java_nat) = roundtrip(LanguageId::Java, "JavaNil.java", java_src);
    assert!(java_nat.contains("String s = null;") && java_nat.contains("s == null"), "Java null corrupted:\n{java_nat}");
    if has_tool("javac") && has_tool("java") {
        let dir = std::env::temp_dir().join(format!("aice_w15_java_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let jp = dir.join("JavaNil.java");
        std::fs::write(&jp, &java_nat).unwrap();
        let jc = Command::new("javac").arg(&jp).output().unwrap();
        assert!(jc.status.success(), "javac failed: {}\n{java_nat}", String::from_utf8_lossy(&jc.stderr));
        let jr = Command::new("java").args(["-cp"]).arg(&dir).arg("JavaNil").output().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(jr.status.success());
        assert_eq!(String::from_utf8_lossy(&jr.stdout).trim(), "true:1");
    }

    // 5. C++ (V15-SOAK-01 repro #5)
    let cpp_src = "#include <iostream>\nint main() { int nil = 1; int* p = nullptr; std::cout << (p == nullptr) << \":\" << nil << std::endl; return 0; }\n";
    let (_, cpp_nat) = roundtrip(LanguageId::Cpp, "cpp_nil.cpp", cpp_src);
    assert!(cpp_nat.contains("int* p = nullptr;") && cpp_nat.contains("p == nullptr"), "C++ nullptr corrupted:\n{cpp_nat}");
    if has_tool("g++") {
        let dir = std::env::temp_dir().join(format!("aice_w15_cpp_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let sp = dir.join("cpp_nil.cpp");
        let bp = dir.join("cpp_nil");
        std::fs::write(&sp, &cpp_nat).unwrap();
        let cc = Command::new("g++").arg(&sp).arg("-o").arg(&bp).output().unwrap();
        assert!(cc.status.success(), "g++ failed: {}\n{cpp_nat}", String::from_utf8_lossy(&cc.stderr));
        let run = Command::new(&bp).output().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(run.status.success());
        assert_eq!(String::from_utf8_lossy(&run.stdout).trim(), "1:1");
    }

    // 6. C (-Wall -Werror), TypeScript, C#, Dart, Rust
    let c_src = "#include <stdio.h>\n#include <stddef.h>\nint main(void) { int nil = 1; int *p = NULL; printf(\"%d:%d\", p == NULL, nil); return 0; }\n";
    let (_, c_nat) = roundtrip(LanguageId::C, "c_nil.c", c_src);
    assert!(c_nat.contains("= NULL;") && c_nat.contains("p == NULL"), "C NULL corrupted:\n{c_nat}");
    if has_tool("gcc") {
        let dir = std::env::temp_dir().join(format!("aice_w15_c_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let sp = dir.join("c_nil.c");
        let bp = dir.join("c_nil");
        std::fs::write(&sp, &c_nat).unwrap();
        let cc = Command::new("gcc").args(["-Wall", "-Werror"]).arg(&sp).arg("-o").arg(&bp).output().unwrap();
        assert!(cc.status.success(), "gcc failed: {}\n{c_nat}", String::from_utf8_lossy(&cc.stderr));
        let run = Command::new(&bp).output().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(run.status.success());
        assert_eq!(String::from_utf8_lossy(&run.stdout).trim(), "1:1");
    }

    let (_, ts_nat) = roundtrip(LanguageId::TypeScript, "ts_nil.ts", "export function f(a: number | null): string { const nil = 1; const x: string | null = null; return `${a === null}:${x === null}:${nil}`; }\n");
    assert!(ts_nat.contains("= null;") && ts_nat.contains("x === null") && ts_nat.contains("${nil}"), "TS:\n{ts_nat}");

    let (_, cs_nat) = roundtrip(LanguageId::CSharp, "CsNil.cs", "using System;\npublic class CsNil { public static void Main() { int nil = 1; string s = null; Console.WriteLine($\"{s == null}:{nil}\"); } }\n");
    assert!(cs_nat.contains("string s = null;") && cs_nat.contains("s == null") && cs_nat.contains("{nil}"), "C#:\n{cs_nat}");

    let (_, dart_nat) = roundtrip(LanguageId::Dart, "nil.dart", "void main() { int nil = 1; String? s = null; print(\"${s == null}:$nil\"); }\n");
    assert!(dart_nat.contains("= null;"), "Dart:\n{dart_nat}");

    let rs_nil = "fn main() { let nil = 1; let x: Option<i32> = None; let y = nil + 2; println!(\"{}:{}:{}\", x.is_none(), nil, y); }\n";
    let (_, rs_nil_nat) = roundtrip(LanguageId::Rust, "rs_nil.rs", rs_nil);
    assert!(rs_nil_nat.contains("let y = nil + 2;") && rs_nil_nat.contains("= None;"), "Rust nil:\n{rs_nil_nat}");
}
