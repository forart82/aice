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

fn has_tool(name: &str) -> bool {
    Command::new("which").arg(name).output().is_ok_and(|o| o.status.success())
}

#[test]
fn f118_python_and_js_assign_nil_binding_and_unbound_none() {
    let py_src = r#"def f_simple():
    nil = 14
    return nil + 1

def f_assign():
    nil = 14
    arr = [nil]
    fn = lambda x: x + nil
    s = f"{nil}"
    return [nil + 1, arr[0], fn(2), s]

def f_before_and_self():
    pre = None
    nil = 10
    nil = nil + 5
    return [pre is None, nil]

def f_init_none():
    nil = None
    return nil is None

def f_branches(flag):
    if flag:
        nil = 14
    else:
        nil = 20
    return nil + 1

def f_for_catch():
    total = 0
    for nil in [1, 2, 3]:
        total += nil
    try:
        raise ValueError("boom")
    except ValueError as nil:
        msg = str(nil)
    return [total, msg]

def g_unbound(x):
    return [x is None, None]

def h_lambda_nil():
    cb = lambda nil: nil + 1
    return cb(9)

print(f_simple(), f_assign(), f_before_and_self(), f_init_none(), f_branches(True), f_branches(False), f_for_catch(), g_unbound(None), g_unbound(1), h_lambda_nil())
"#;
    let (_, py_nat) = roundtrip(LanguageId::Python, "py_nil.py", py_src);
    assert!(py_nat.contains("return [x is None, None]"), "unbound None corrupted:\n{py_nat}");
    assert!(py_nat.contains("pre = None"), "pre-binding None corrupted:\n{py_nat}");
    assert!(py_nat.contains("nil = None"), "nil = None RHS corrupted:\n{py_nat}");
    if has_tool("python3") {
        let out = Command::new("python3").args(["-c", &py_nat]).output().expect("python3");
        assert!(out.status.success(), "python3 failed: {}\n{py_nat}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(
            String::from_utf8_lossy(&out.stdout).trim(),
            "15 [15, 14, 16, '14'] [True, 15] True 15 21 [6, 'boom'] [True, None] [False, None] 10"
        );
    }

    let js_src = "function f() { nil = 1; return nil + 2; }\nfunction fd() { const [a, nil] = [4, 5]; return a + nil; }\nfunction g(x) { return x === null ? 0 : 1; }\nconsole.log(f(), fd(), g(null));\n";
    let (_, js_nat) = roundtrip(LanguageId::JavaScript, "js_nil.js", js_src);
    assert!(js_nat.contains("return nil + 2;"), "JS bare nil assign failed:\n{js_nat}");
    assert!(js_nat.contains("return a + nil;"), "JS destructure nil failed:\n{js_nat}");
    assert!(js_nat.contains("x === null"), "JS unbound null corrupted:\n{js_nat}");
    if has_tool("node") {
        let out = Command::new("node").args(["-e", &js_nat]).output().expect("node");
        assert!(out.status.success(), "node failed: {}\n{js_nat}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "3 9 0");
    }
}

#[test]
fn f119_rust_macro_invocations_expr_stmt_and_rustc_run() {
    let rs_src = r##"use std::fmt::Write;

macro_rules! add_block {
    ($a:expr, $b:expr) => {{
        let t = $a + $b;
        t
    }};
}

pub fn fmt_val(x: i32) -> String {
    format!("v={}", x)
}

pub fn make_vecs(n: usize) -> Vec<i32> {
    let mut a = vec![1, 2, 3];
    let b = vec![0; n];
    a.extend_from_slice(&b);
    a
}

pub fn check_matches(opt: Option<i32>) -> bool {
    matches!(opt, Some(v) if v > 0)
}

pub fn concat_and_chain(x: i32) -> usize {
    let s = std::concat!("ab", "cd");
    let raw_s = format!(r#"say "{}""#, x);
    s.len() + raw_s.len() + vec![10, 20][0]
}

pub fn write_try(x: i32) -> Result<String, std::fmt::Error> {
    let mut buf = String::new();
    write!(buf, "n={}", x)?;
    Ok(buf)
}

pub fn unused_todo() -> i32 {
    todo!();
}

fn main() {
    let x = 42;
    assert_eq!(fmt_val(x), "v=42");
    assert_eq!(make_vecs(2), vec![1, 2, 3, 0, 0]);
    assert!(check_matches(Some(5)));
    assert!(!check_matches(None));
    let sum = add_block! { 10, 20 };
    assert_eq!(sum, 30);
    let w = write_try(7).unwrap();
    if false {
        eprintln!("err {}", x);
    }
    println!(
        "{}|{}|{}",
        w,
        concat_and_chain(3),
        sum
    );
}
"##;
    let (aice, rs_nat) = roundtrip(LanguageId::Rust, "rs_macros.rs", rs_src);
    assert!(aice.contains("format!(\"v={}\", x)"), "AICE should keep readable format!:\n{aice}");
    assert!(aice.contains("vec![0; n]"), "AICE should keep readable vec![0; n]:\n{aice}");
    let cfg_rs = "pub fn cfg_mac() -> &'static str {\n    cfg_if::cfg_if! {\n        if #[cfg(unix)] {\n            // don't choke on quotes or 'static\n            \"unix\"\n        } else {\n            \"other\"\n        }\n    }\n}\n";
    let (_, cfg_nat) = roundtrip(LanguageId::Rust, "cfg_mac.rs", cfg_rs);
    assert!(cfg_nat.contains("cfg_if::cfg_if!") && cfg_nat.contains("#[cfg(unix)]"), "cfg_if lost:\n{cfg_nat}");
    if has_tool("rustc") {
        let dir = std::env::temp_dir().join(format!("aice_w13_macros_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let src_p = dir.join("rs_macros.rs");
        let bin_p = dir.join("rs_macros");
        std::fs::write(&src_p, &rs_nat).unwrap();
        let cc = Command::new("rustc").arg(&src_p).arg("-o").arg(&bin_p).output().unwrap();
        assert!(cc.status.success(), "rustc failed: {}\n--- RS ---\n{rs_nat}", String::from_utf8_lossy(&cc.stderr));
        let run = Command::new(&bin_p).output().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(run.status.success(), "run failed: {}", String::from_utf8_lossy(&run.stderr));
        assert_eq!(String::from_utf8_lossy(&run.stdout).trim(), "n=7|21|30");
    }
}

#[test]
fn f120_rust_mut_params_self_and_control_flow_smoke() {
    let rs_src = r#"pub trait Greet {
    fn greet(&self) -> i32;
}

pub struct Counter {
    pub val: i32,
}

impl Counter {
    pub fn bump(mut self) -> Self {
        self.val += 1;
        self
    }

    pub fn add_in_place(&mut self, delta: &mut i32) {
        self.val += *delta;
        *delta = 0;
    }
}

impl Greet for Counter {
    fn greet(&self) -> i32 {
        self.val * 2
    }
}

pub fn calc(mut val: i32) -> i32 {
    val += 1;
    val
}

pub fn combine(mut a: String, mut b: Vec<i32>) -> usize {
    a.push_str("!");
    b.push(1);
    a.len() + b.len()
}

pub fn flow_smoke(mut opt: Option<i32>, res: Result<i32, i32>) -> Result<i32, i32> {
    let mut sum = 0;
    if let Some(x) = opt {
        sum += x;
    }
    while let Some(v) = opt {
        sum += v;
        opt = None;
    }
    let m = match res? {
        n if n > 10 => n * 2,
        n => n,
    };
    Ok(sum + m)
}

fn main() {
    let mut c = Counter { val: calc(4) }.bump();
    let mut d = 3;
    c.add_in_place(&mut d);
    let n = combine(String::from("hi"), vec![1, 2]);
    let f = flow_smoke(Some(5), Ok(12)).unwrap();
    println!("{}|{}|{}|{}", c.greet(), d, n, f);
}
"#;
    let (_, rs_nat) = roundtrip(LanguageId::Rust, "rs_mutp.rs", rs_src);
    assert!(rs_nat.contains("pub fn calc(mut val: i32) -> i32"), "lost mut param:\n{rs_nat}");
    assert!(rs_nat.contains("pub fn bump(mut self) -> Self"), "lost mut self:\n{rs_nat}");
    assert!(rs_nat.contains("impl Greet for Counter"), "lost impl Trait for Struct:\n{rs_nat}");
    if has_tool("rustc") {
        let dir = std::env::temp_dir().join(format!("aice_w13_mutp_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let src_p = dir.join("rs_mutp.rs");
        let bin_p = dir.join("rs_mutp");
        std::fs::write(&src_p, &rs_nat).unwrap();
        let cc = Command::new("rustc").args(["-D", "warnings"]).arg(&src_p).arg("-o").arg(&bin_p).output().unwrap();
        assert!(cc.status.success(), "rustc -D warnings failed: {}\n--- RS ---\n{rs_nat}", String::from_utf8_lossy(&cc.stderr));
        let run = Command::new(&bin_p).output().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(run.status.success());
        assert_eq!(String::from_utf8_lossy(&run.stdout).trim(), "18|0|6|34");
    }
}

#[test]
fn f121_java_csharp_php_cast_expressions() {
    let java_src = r#"public class CastJava {
    public static int toInt(double d) { return (int)d; }
    public static int sumCast(double a, double b) { return (int)(a + b); }
    public static int strLen(Object o) { return ((String)o).length(); }
    public static void main(String[] args) {
        System.out.println(toInt(3.9) + "|" + sumCast(1.6, 2.7) + "|" + strLen("hello"));
    }
}
"#;
    let (_, java_nat) = roundtrip(LanguageId::Java, "CastJava.java", java_src);
    assert!(java_nat.contains("(int)d"), "Java cast lost:\n{java_nat}");
    if has_tool("javac") && has_tool("java") {
        let dir = std::env::temp_dir().join(format!("aice_w13_jcast_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let jp = dir.join("CastJava.java");
        std::fs::write(&jp, &java_nat).unwrap();
        let jc = Command::new("javac").arg(&jp).output().unwrap();
        assert!(jc.status.success(), "javac failed: {}\n{java_nat}", String::from_utf8_lossy(&jc.stderr));
        let jr = Command::new("java").args(["-cp"]).arg(&dir).arg("CastJava").output().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(String::from_utf8_lossy(&jr.stdout).trim(), "3|4|5");
    }

    let cs_src = r#"using System;
public class CastCs {
    public static int F(double d) => (int)d;
    public static int SumCast(double a, double b) => (int)(a + b);
    public static string SafeAs(object o) => o as string ?? "none";
    public static int ExplicitLen(object o) => ((string)o).Length;
}
"#;
    let (_, cs_nat) = roundtrip(LanguageId::CSharp, "CastCs.cs", cs_src);
    assert!(cs_nat.contains("(int)d"), "C# value cast lost:\n{cs_nat}");
    assert!(cs_nat.contains("(int)(a + b)"), "C# paren cast lost:\n{cs_nat}");
    assert!(cs_nat.contains("o as string"), "C# safe 'as' cast corrupted:\n{cs_nat}");
    assert!(cs_nat.contains("((string)o).Length"), "C# member-after-cast lost:\n{cs_nat}");

    let php_src = "<?php\nfunction to_int(float $d): int { return (int)$d; }\nfunction to_str(int $n): string { return (string)$n; }\nfunction to_arr(int $n): array { return (array)$n; }\necho to_int(4.9) . '|' . to_str(7) . '|' . count(to_arr(9));\n";
    let (_, php_nat) = roundtrip(LanguageId::Php, "cast_php.php", php_src);
    assert!(php_nat.contains("(int)$d") && php_nat.contains("(string)$n") && php_nat.contains("(array)$n"), "PHP casts lost:\n{php_nat}");
    if has_tool("php") {
        let dir = std::env::temp_dir().join(format!("aice_w13_phpcast_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let pp = dir.join("cast_php.php");
        std::fs::write(&pp, &php_nat).unwrap();
        let lint = Command::new("php").args(["-l"]).arg(&pp).output().unwrap();
        assert!(lint.status.success(), "php -l failed: {}\n{php_nat}", String::from_utf8_lossy(&lint.stderr));
        let run = Command::new("php").arg(&pp).output().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(run.status.success());
        assert_eq!(String::from_utf8_lossy(&run.stdout).trim(), "4|7|1");
    }
}
