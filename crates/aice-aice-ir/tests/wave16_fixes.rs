use std::path::Path;
use std::process::Command;

use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice_with_opts;
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

fn roundtrip_2x(lang: LanguageId, vname: &str, src: &str) -> (String, String, String, String) {
    let (a1, n1) = roundtrip(lang, vname, src);
    let (a2, n2) = roundtrip(lang, vname, &n1);
    (a1, n1, a2, n2)
}

fn has_tool(name: &str) -> bool {
    Command::new("which").arg(name).output().is_ok_and(|o| o.status.success())
}

#[test]
fn f128_ten_lang_string_escapes_2x_idempotent_and_raw_lossless() {
    let cases: &[(LanguageId, &str, &str)] = &[
        (
            LanguageId::Rust,
            "esc.rs",
            r###"pub fn demo() -> (&'static str, &'static str, &'static str, &'static str) {
    let std_s = "a\nb\rc\td\"e\\f";
    let raw_s = r#"raw\n\t"ok""#;
    let hex_s = "\x1b[31m\u{1F600}\0";
    let simple_raw = r"c:\dir\file";
    (std_s, raw_s, hex_s, simple_raw)
}
"###,
        ),
        (
            LanguageId::Python,
            "esc.py",
            r#"def demo():
    a = "a\nb\rc\td\"e\\f"
    b = 'x\ny\'z'
    c = r"raw\n\d+"
    d = "\x1b[31m\u001b\0\a\b\f\v\012\d+\s+\w+"
    return (a, b, c, d)
"#,
        ),
        (
            LanguageId::C,
            "esc.c",
            r#"#include <stdio.h>
void demo(void) {
    const char *a = "a\nb\rc\td\"e\\f";
    const char *b = "\x1b[31m\012\a\b\f\v";
    printf("%s%s\n", a, b);
}
"#,
        ),
        (
            LanguageId::Cpp,
            "esc.cpp",
            r###"#include <cstdio>
void demo() {
    const char* a = "a\nb\rc\td\"e\\f";
    const char* b = R"(raw\n\t"cpp")";
    const char* c = "\x1b[31m\0";
    std::printf("%s%s%s\n", a, b, c);
}
"###,
        ),
        (
            LanguageId::Go,
            "esc.go",
            "package main\n\nfunc demo() (string, string, string) {\n\ta := \"a\\nb\\rc\\td\\\"e\\\\f\"\n\tb := `raw\\n\\tgo`\n\tc := \"\\x1b[31m\\u001b\\a\\b\\f\\v\\012\"\n\treturn a, b, c\n}\n",
        ),
        (
            LanguageId::Java,
            "Esc.java",
            r#"public class Esc {
    public static String demo() {
        String a = "a\nb\rc\td\"e\\f";
        String b = "\u001b\b\f\012";
        return a + b;
    }
}
"#,
        ),
        (
            LanguageId::CSharp,
            "Esc.cs",
            r#"public class Esc {
    public static string Demo() {
        var a = "a\nb\rc\td\"e\\f";
        var b = @"C:\raw\n\t";
        var c = "\x1b\u001b\0\a\b\f\v";
        return a + b + c;
    }
}
"#,
        ),
        (
            LanguageId::Kotlin,
            "Esc.kt",
            "fun demo(): String {\n    val a = \"a\\nb\\rc\\td\\\"e\\\\f\"\n    val b = \"\"\"raw\\n\\tkt\"\"\"\n    val c = \"\\u001b\\b\"\n    return a + b + c\n}\n",
        ),
        (
            LanguageId::Ruby,
            "esc.rb",
            r#"def demo
  a = "a\nb\rc\td\"e\\f"
  b = 'raw\n\t\'ok\\end'
  c = "\x1b[31m\a\b\f\v"
  [a, b, c]
end
"#,
        ),
        (
            LanguageId::Dart,
            "esc.dart",
            r#"String demo() {
  var a = "a\nb\rc\td\"e\\f";
  var b = r"raw\n\d+";
  var c = "\x1b\u001b\b\f\v";
  return a + b + c;
}
"#,
        ),
    ];

    for (lang, vname, src) in cases {
        let (a1, n1, a2, n2) = roundtrip_2x(*lang, vname, src);
        assert_eq!(a1, a2, "{lang:?} AICE not idempotent on 2x round-trip:\n--- A1 ---\n{a1}\n--- A2 ---\n{a2}");
        assert_eq!(n1, n2, "{lang:?} native not idempotent on 2x round-trip:\n--- N1 ---\n{n1}\n--- N2 ---\n{n2}");
        assert!(
            n2.contains(r#""a\nb\rc\td\"e\\f""#),
            "{lang:?} standard string corrupted/double-escaped after 2x RT:\n{n2}"
        );
        assert!(
            !n2.contains(r"a\\nb"),
            "{lang:?} double-escaped \\n after 2x RT:\n{n2}"
        );
    }

    // Verify JS, TS, PHP remain clean on 2x round-trip
    for (lang, vname, src) in [
        (LanguageId::JavaScript, "esc.js", "function demo() { return \"a\\nb\\tc\\\"d\\\\e\"; }\n"),
        (LanguageId::TypeScript, "esc.ts", "function demo(): string { return \"a\\nb\\tc\\\"d\\\\e\"; }\n"),
        (LanguageId::Php, "esc.php", "<?php\nfunction demo(): string { return \"a\\nb\\tc\\\"d\\\\e\"; }\n"),
    ] {
        let (a1, n1, a2, n2) = roundtrip_2x(lang, vname, src);
        assert_eq!(a1, a2, "{lang:?} AICE 2x mismatch:\n{a1}\n---\n{a2}");
        assert_eq!(n1, n2, "{lang:?} native 2x mismatch:\n{n1}\n---\n{n2}");
        assert!(n2.contains(r#""a\nb\tc\"d\\e""#), "{lang:?} corrupted:\n{n2}");
    }

    if has_tool("python3") {
        let py_src = "def f():\n    a = \"a\\nb\\tc\\\"d\\\\e\"\n    b = r\"raw\\n\\d+\"\n    c = \"\\x1b[31m\\0\"\n    return f\"{len(a)}|{len(b)}|{len(c)}|{ord(c[0])}|{ord(c[-1])}\"\n";
        let (_, _, _, py_n2) = roundtrip_2x(LanguageId::Python, "rt2.py", py_src);
        let out = Command::new("python3")
            .args(["-c", &format!("{py_n2}\nprint(f())\n")])
            .output()
            .unwrap();
        assert!(out.status.success(), "python3 failed: {}\n{py_n2}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "9|8|6|27|0");
    }
}

#[test]
fn f129_js_ts_module_level_destructuring_all_forms() {
    let js_src = r#"const { readFileSync } = require("fs");
const [a, b] = [10, 25];
const { nested: { v }, defVal = 7 } = { nested: { v: 3 } };
const [head, ...rest] = [1, 2, 3, 4];
let { k } = { k: 11 };
let [m, n] = [2, 3];
function report() {
  return [typeof readFileSync, a + b, v + defVal, head, rest.length, k, m + n].join("|");
}
"#;
    let (a1, n1, a2, n2) = roundtrip_2x(LanguageId::JavaScript, "cjs.js", js_src);
    assert_eq!(a1, a2, "JS destructuring AICE 2x mismatch:\n{a1}\n---\n{a2}");
    assert_eq!(n1, n2, "JS destructuring native 2x mismatch:\n{n1}\n---\n{n2}");
    for exp in [
        "const { readFileSync } = require(\"fs\");",
        "const [a, b] = [10, 25];",
        "const { nested: { v }, defVal = 7 } = { nested: { v: 3 } };",
        "const [head, ...rest] = [1, 2, 3, 4];",
        "let { k } = { k: 11 };",
        "let [m, n] = [2, 3];",
    ] {
        assert!(n2.contains(exp), "missing `{exp}` in JS output:\n{n2}");
    }
    if has_tool("node") {
        let out = Command::new("node")
            .args(["-e", &format!("{n2}\nconsole.log(report());\n")])
            .output()
            .unwrap();
        assert!(out.status.success(), "node failed: {}\n{n2}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "function|35|10|1|3|11|5");
    }

    let ts_src = r#"export const { a, b } = { a: 1, b: 2 };
export const [x, y] = [3, 4];
export let { p, q }: { p: number; q: number } = { p: 5, q: 6 };
export const [first, ...others] = [10, 20, 30];
"#;
    let (ta1, tn1, ta2, tn2) = roundtrip_2x(LanguageId::TypeScript, "esm.ts", ts_src);
    assert_eq!(ta1, ta2, "TS destructuring AICE 2x mismatch:\n{ta1}\n---\n{ta2}");
    assert_eq!(tn1, tn2, "TS destructuring native 2x mismatch:\n{tn1}\n---\n{tn2}");
    for exp in [
        "export const { a, b } = { a: 1, b: 2 };",
        "export const [x, y] = [3, 4];",
        "export let { p, q }:",
        "export const [first, ...others] = [10, 20, 30];",
    ] {
        assert!(tn2.contains(exp), "missing `{exp}` in TS output:\n{tn2}");
    }
}

#[test]
fn f130_python_all_four_comprehensions_and_generators() {
    let py_src = r#"def demo(xs, grid):
    nil = 10
    lc = [x + 1 for x in xs if x > 0]
    dc = {x: x * 2 for x in xs}
    sc = {x + 1 for x in xs}
    gn = sum(x * 2 for x in xs)
    gn2 = (x + nil for x in xs if x > 0)
    multi = [x * 10 + y for x in xs for y in xs if x > 0 if y != x]
    nested = [[y + nil for y in row] for row in grid]
    nil_lc = [x + nil for x in xs if x is not None]
    nil_dc = {x: x + nil for x in xs if x > 0}
    nil_sc = {x + nil for x in xs if x > 0}
    nil_gn = sum(x + nil for x in xs if x > 0)
    return (lc, sorted(dc.items()), sorted(sc), gn, list(gn2), multi, nested, nil_lc, sorted(nil_dc.items()), sorted(nil_sc), nil_gn)
"#;
    let (a1, n1, a2, n2) = roundtrip_2x(LanguageId::Python, "comp.py", py_src);
    assert_eq!(a1, a2, "Py comp AICE 2x mismatch:\n{a1}\n---\n{a2}");
    assert_eq!(n1, n2, "Py comp native 2x mismatch:\n{n1}\n---\n{n2}");
    assert!(a1.contains("[x + 1 for x in xs if x > 0]"), "list comp IR:\n{a1}");
    assert!(a1.contains("{x: x * 2 for x in xs}"), "dict comp IR:\n{a1}");
    assert!(a1.contains("{x + 1 for x in xs}"), "set comp IR:\n{a1}");
    assert!(a1.contains("sum(x * 2 for x in xs)"), "gen expr IR:\n{a1}");
    assert!(a1.contains("x + \\#nil"), "nil var not escaped in comp IR:\n{a1}");
    assert!(!n2.contains("x + None"), "nil corrupted to None in comp:\n{n2}");

    if has_tool("python3") {
        let runner = format!("{n2}\nprint(demo([-1, 1, 2], [[1, 2], [3]]))\n");
        let out = Command::new("python3").args(["-c", &runner]).output().unwrap();
        assert!(out.status.success(), "python3 failed: {}\n{n2}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(
            String::from_utf8_lossy(&out.stdout).trim(),
            "([2, 3], [(-1, -2), (1, 2), (2, 4)], [0, 2, 3], 4, [11, 12], [9, 12, 19, 21], [[11, 12], [13]], [9, 11, 12], [(1, 11), (2, 12)], [11, 12], 23)"
        );
    }
}

#[test]
fn f131_tuple_literals_and_nil_in_compounds_py_rs_cs() {
    let py_src = r#"def f():
    pre = None
    nil = 7
    t = (nil, None)
    t1 = (nil,)
    t0 = ()
    s = {nil, None}
    g = lambda k: (k + nil, None)
    p = g(3)
    return (nil + 1, pre is None, t[0], t[1] is None, t1[0], len(t0), len(s), p[0], p[1] is None)
"#;
    let (pa1, pn1, pa2, pn2) = roundtrip_2x(LanguageId::Python, "tup.py", py_src);
    assert_eq!(pa1, pa2, "Py tuple AICE 2x mismatch:\n{pa1}\n---\n{pa2}");
    assert_eq!(pn1, pn2, "Py tuple native 2x mismatch:\n{pn1}\n---\n{pn2}");
    assert!(pn2.contains("t = (nil, None)"), "Py tuple nil corrupted:\n{pn2}");
    assert!(pn2.contains("t1 = (nil,)"), "Py 1-tuple nil corrupted:\n{pn2}");
    assert!(pn2.contains("t0 = ()"), "Py empty tuple corrupted:\n{pn2}");
    assert!(pn2.contains("lambda k: (k + nil, None)"), "Py lambda tuple corrupted:\n{pn2}");
    if has_tool("python3") {
        let out = Command::new("python3")
            .args(["-c", &format!("{pn2}\nprint(f())\n")])
            .output()
            .unwrap();
        assert!(out.status.success(), "python3 failed: {}\n{pn2}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(
            String::from_utf8_lossy(&out.stdout).trim(),
            "(8, True, 7, True, 7, 0, 2, 10, True)"
        );
    }

    let rs_src = r#"fn main() {
    let nil = 7;
    let t = (nil, 3);
    let t1 = (nil,);
    let u = ();
    let opt: Option<i32> = None;
    let _ = u;
    println!("{}:{}:{}:{:?}", t.0, t.1, t1.0, opt);
}
"#;
    let (ra1, rn1, ra2, rn2) = roundtrip_2x(LanguageId::Rust, "tup.rs", rs_src);
    assert_eq!(ra1, ra2, "Rust tuple AICE 2x mismatch:\n{ra1}\n---\n{ra2}");
    assert_eq!(rn1, rn2, "Rust tuple native 2x mismatch:\n{rn1}\n---\n{rn2}");
    assert!(rn2.contains("let t = (nil, 3);"), "Rust tuple corrupted:\n{rn2}");
    assert!(rn2.contains("let t1 = (nil,);"), "Rust 1-tuple corrupted:\n{rn2}");
    if has_tool("rustc") {
        let dir = std::env::temp_dir().join(format!("aice_w16_rs_tup_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let sp = dir.join("tup.rs");
        let bp = dir.join("tup");
        std::fs::write(&sp, &rn2).unwrap();
        let cc = Command::new("rustc")
            .args(["--edition", "2021", "-D", "warnings"])
            .arg(&sp)
            .arg("-o")
            .arg(&bp)
            .output()
            .unwrap();
        assert!(cc.status.success(), "rustc failed: {}\n{rn2}", String::from_utf8_lossy(&cc.stderr));
        let run = Command::new(&bp).output().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(run.status.success());
        assert_eq!(String::from_utf8_lossy(&run.stdout).trim(), "7:3:7:None");
    }

    let cs_src = r#"public class T {
    public static (int, int) F() {
        int nil = 7;
        return (nil, 3);
    }
}
"#;
    let (ca1, cn1, ca2, cn2) = roundtrip_2x(LanguageId::CSharp, "T.cs", cs_src);
    assert_eq!(ca1, ca2, "C# tuple AICE 2x mismatch:\n{ca1}\n---\n{ca2}");
    assert_eq!(cn1, cn2, "C# tuple native 2x mismatch:\n{cn1}\n---\n{cn2}");
    assert!(cn2.contains("return (nil, 3);"), "C# tuple nil corrupted:\n{cn2}");
}

#[test]
fn f132_csharp_and_php_static_fields_preserved() {
    let cs_src = r#"public class Config {
    public static int X = 5;
    public static readonly int Y = 10;
    public static int nil = 7;
    public static int Prop { get; set; } = 3;
    public int Inst = 1;
    public static int Sum() => X + Y + nil + Prop;
}
"#;
    let (a1, n1, a2, n2) = roundtrip_2x(LanguageId::CSharp, "Config.cs", cs_src);
    assert_eq!(a1, a2, "C# static AICE 2x mismatch:\n{a1}\n---\n{a2}");
    assert_eq!(n1, n2, "C# static native 2x mismatch:\n{n1}\n---\n{n2}");
    for exp in [
        "public static int X { get; set; } = 5;",
        "public static int Y => 10;",
        "public static int nil { get; set; } = 7;",
        "public static int Prop { get; set; } = 3;",
        "public int Inst { get; set; } = 1;",
    ] {
        assert!(n2.contains(exp), "missing `{exp}` in C# output:\n{n2}");
    }

    let php_src = "<?php\nclass Counter {\n    public static int $count;\n    public int $inst;\n}\n";
    let (_, pn1, _, pn2) = roundtrip_2x(LanguageId::Php, "Counter.php", php_src);
    assert_eq!(pn1, pn2);
    assert!(pn2.contains("public static int $count;"), "PHP static prop dropped:\n{pn2}");
}

#[test]
fn f133_dart_top_level_vars_and_conditional_ternary() {
    let dart_src = r#"int nil = 5;
String? modNull = null;
final a = 1;
final int af = 2;
const b = 3;
const int bc = 4;
var c = 5;

int localNil() {
  int nil = 7;
  String? s = null;
  int r = s == null ? nil + 1 : 0;
  return r + a + af + b + bc + c;
}

int readMod() {
  return modNull == null ? nil * 2 : 0;
}
"#;
    let (a1, n1, a2, n2) = roundtrip_2x(LanguageId::Dart, "mod.dart", dart_src);
    assert_eq!(a1, a2, "Dart AICE 2x mismatch:\n{a1}\n---\n{a2}");
    assert_eq!(n1, n2, "Dart native 2x mismatch:\n{n1}\n---\n{n2}");
    for exp in [
        "int nil = 5;",
        "String? modNull = null;",
        "final a = 1;",
        "final int af = 2;",
        "const b = 3;",
        "const int bc = 4;",
        "var c = 5;",
        "s == null ? nil + 1 : 0",
        "modNull == null ? nil * 2 : 0",
    ] {
        assert!(n2.contains(exp), "missing `{exp}` in Dart output:\n{n2}");
    }
    assert!(!n2.contains("null + 1"), "Dart ternary corrupted nil -> null:\n{n2}");
    assert!(!n2.contains("null * 2"), "Dart mod ternary corrupted nil -> null:\n{n2}");
}
