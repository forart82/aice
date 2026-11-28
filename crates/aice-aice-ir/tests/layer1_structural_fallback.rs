use std::path::Path;
use std::process::Command;

use aice_aice_ir::ir_code::{Expr, FnBody, Stmt};
use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice_with_opts;
use aice_aice_ir::{AiceItem, AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
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
    assert_eq!(a1, a2, "{vname} AICE 2x mismatch:\n{a1}\n---\n{a2}");
    assert_eq!(n1, n2, "{vname} native 2x mismatch:\n{n1}\n---\n{n2}");
    (a1, n1, a2, n2)
}

fn has_tool(name: &str) -> bool {
    Command::new("which").arg(name).output().is_ok_and(|o| o.status.success())
}

#[test]
fn layer1_raw_expr_and_stmt_quoting_roundtrip() {
    let cases = [
        ("single", "defer mu.Unlock()"),
        ("quoted", "static_assert(sizeof(int) >= 4, \"int32\");"),
        ("multiline", "do {\n  x += 1;\n} while (x < 3);"),
        ("triple_quote", "note(\"\"\"triple\"\"\");"),
        ("crlf", "a();\r\nb();"),
    ];
    for (tag, raw_text) in cases {
        let mut m = aice_aice_ir::AiceModule::new(LanguageId::Cpp, "m");
        m.items.push(AiceItem::Fn(aice_aice_ir::ir_code::FnDecl {
            vis: aice_aice_ir::Visibility::Public,
            is_async: false,
            is_static: false,
            name: format!("f_{tag}"),
            type_params: Vec::new(),
            params: Vec::new(),
            return_type: None,
            body: FnBody::Block(vec![
                Stmt::Raw { text: raw_text.to_string(), trivia: Default::default() },
                Stmt::Expr {
                    expr: Expr::Binary {
                        op: aice_aice_ir::ir_code::BinaryOp::Add,
                        left: Box::new(Expr::Raw("a::b<int>".into())),
                        right: Box::new(Expr::Literal(aice_aice_ir::ir_code::LiteralVal::Int("1".into()))),
                    },
                    trivia: Default::default(),
                },
            ]),
            decorators: Vec::new(),
            trivia: Default::default(),
            span: Default::default(),
        }));
        let aice = print_aice_with_opts(&m, &TranspileOpts::default());
        let parsed = parse_aice(&aice).unwrap_or_else(|e| panic!("{tag}: {e}\n{aice}"));
        let AiceItem::Fn(f) = &parsed.items[0] else { panic!("expected fn") };
        let FnBody::Block(stmts) = &f.body else { panic!("expected block") };
        assert!(matches!(&stmts[0], Stmt::Raw { text, .. } if text == raw_text), "{tag}: {stmts:?}");
        assert!(matches!(&stmts[1], Stmt::Expr { expr: Expr::Binary { .. }, .. }), "{tag}: {stmts:?}");
        let native = DefaultAiceTranspiler.to_native(&parsed, LanguageId::Cpp).unwrap();
        assert!(!native.contains(";;"), "{tag} emitted spurious double semi:\n{native}");
    }
}

#[test]
fn layer1_csharp_events_indexers_operators_linq_2x() {
    let src = r#"using System;
using System.Linq;

public delegate void Notify(string msg);

public class Box {
    public event Notify? OnChange;
    private int[] _data = new int[] { 1, 2, 3 };

    public int this[int i] {
        get { return _data[i]; }
        set { _data[i] = value; }
    }

    public static Box operator +(Box a, Box b) {
        return a;
    }

    public int Run() {
        lock (_data) {
            _data[0] = 4;
        }
        var q = from x in _data where x > 1 select x * 2;
        return q.Count();
    }
}
"#;
    let (_a1, _n1, _a2, n2) = roundtrip_2x(LanguageId::CSharp, "Box.cs", src);
    for needle in [
        "public delegate void Notify(string msg);",
        "public event Notify? OnChange;",
        "public int this[int i]",
        "public static Box operator +(Box a, Box b)",
        "lock (_data)",
        "from x in _data where x > 1 select x * 2",
    ] {
        assert!(n2.contains(needle), "C# missing `{needle}`:\n{n2}");
    }
}

#[test]
fn layer1_cpp_static_assert_friend_using_do_while_2x() {
    let src = r#"template<typename T>
using Ptr = T*;

static_assert(sizeof(int) >= 4, "int32");

class Inspector;

class Base {
protected:
    int base_v = 1;
};

class Derived : public Base {
    friend class Inspector;
    static_assert(sizeof(int) >= 4, "member");
    using Base::base_v;
public:
    int compute(int n) {
        int s = 0;
        do {
            s += n;
            n -= 1;
        } while (n > 0);
        return s + base_v;
    }
};
"#;
    let (_a1, n1, _a2, n2) = roundtrip_2x(LanguageId::Cpp, "derived.cpp", src);
    for needle in [
        "using Ptr = T*;",
        "static_assert(sizeof(int) >= 4, \"int32\");",
        "friend class Inspector;",
        "static_assert(sizeof(int) >= 4, \"member\");",
        "using Base::base_v;",
        "while (n > 0);",
    ] {
        assert!(n2.contains(needle), "C++ missing `{needle}`:\n{n2}");
    }
    if has_tool("g++") {
        let dir = std::env::temp_dir().join(format!("aice_l1_cpp_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let fp = dir.join("derived.cpp");
        std::fs::write(&fp, &n1).unwrap();
        let out = Command::new("g++").args(["-std=c++17", "-fsyntax-only", fp.to_str().unwrap()]).output().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(out.status.success(), "g++ failed: {}\n{n1}", String::from_utf8_lossy(&out.stderr));
    }
}

#[test]
fn layer1_rust_macros_const_let_else_labeled_loop_2x() {
    let src = r#"macro_rules! bump {
    ($x:expr) => {
        $x + 1
    };
}

pub struct Calc;

impl Calc {
    const FACTOR: i32 = 3;

    pub fn run(opt: Option<i32>) -> i32 {
        let Some(v) = opt else {
            return 0;
        };
        let mut acc = bump!(0);
        'outer: for i in 0..v {
            if i == 2 {
                break 'outer;
            }
            acc += unsafe { i + Self::FACTOR };
        }
        acc
    }
}
"#;
    let (_a1, n1, _a2, n2) = roundtrip_2x(LanguageId::Rust, "calc.rs", src);
    for needle in [
        "macro_rules! bump",
        "const FACTOR: i32 = 3;",
        "let Some(v) = opt else",
        "'outer: for i in 0..v",
        "unsafe { i + Self::FACTOR }",
    ] {
        assert!(n2.contains(needle), "Rust missing `{needle}`:\n{n2}");
    }
    if has_tool("rustc") {
        let dir = std::env::temp_dir().join(format!("aice_l1_rs_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let fp = dir.join("calc.rs");
        let out_lib = dir.join("libcalc.rlib");
        std::fs::write(&fp, &n1).unwrap();
        let out = Command::new("rustc")
            .args(["--crate-type", "lib", fp.to_str().unwrap(), "-o", out_lib.to_str().unwrap()])
            .output()
            .unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(out.status.success(), "rustc failed: {}\n{n1}", String::from_utf8_lossy(&out.stderr));
    }
}

#[test]
fn layer1_go_select_labels_type_alias_channel_2x() {
    let src = r#"package main

import "fmt"

type AliasInt = int

func drain(ch chan int) AliasInt {
	total := 0
outer:
	for {
		select {
		case v := <-ch:
			total += v
		default:
			break outer
		}
	}
	return total
}

func main() {
	ch := make(chan int, 2)
	ch <- 4
	ch <- 5
	fmt.Println(drain(ch))
}
"#;
    let (_a1, n1, _a2, n2) = roundtrip_2x(LanguageId::Go, "main.go", src);
    for needle in ["type AliasInt = int", "outer:", "select {", "case v := <-ch:", "break outer"] {
        assert!(n2.contains(needle), "Go missing `{needle}`:\n{n2}");
    }
    if has_tool("go") {
        let dir = std::env::temp_dir().join(format!("aice_l1_go_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let fp = dir.join("main.go");
        std::fs::write(&fp, &n1).unwrap();
        let out = Command::new("go").args(["run", fp.to_str().unwrap()]).output().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(out.status.success(), "go run failed: {}\n{n1}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "9");
    }
}

#[test]
fn layer1_java_init_block_record_sync_annotation_2x() {
    let src = r#"@interface Tag {
    String value() default "v";
}

record Point(int x, int y) {
    public Point {
        if (x < 0) {
            x = 0;
        }
    }
}

public class Ledger {
    private int sum;

    {
        sum = 10;
    }

    public int add(int v) {
        synchronized (this) {
            sum += v;
        }
        return sum;
    }
}
"#;
    let (_a1, n1, _a2, n2) = roundtrip_2x(LanguageId::Java, "Ledger.java", src);
    for needle in ["@interface Tag", "record Point(int x, int y)", "public Point {", "sum = 10;", "synchronized (this)"] {
        assert!(n2.contains(needle), "Java missing `{needle}`:\n{n2}");
    }
    if has_tool("javac") {
        let dir = std::env::temp_dir().join(format!("aice_l1_java_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let fp = dir.join("Ledger.java");
        std::fs::write(&fp, &n1).unwrap();
        let out = Command::new("javac").arg(fp.to_str().unwrap()).output().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(out.status.success(), "javac failed: {}\n{n1}", String::from_utf8_lossy(&out.stderr));
    }
}

#[test]
fn layer1_kotlin_init_companion_delegate_do_while_2x() {
    let src = r#"class Store(val seed: Int) {
    val lazyVal: Int by lazy { seed + 1 }

    init {
        require(seed >= 0)
    }

    fun countDown(n: Int): Int {
        var i = n
        var s = 0
        do {
            s += i
            i -= 1
        } while (i > 0)
        return s
    }

    companion object {
        const val TAG: String = "store"

        init {
            val ready = true
        }
    }
}
"#;
    let (_a1, _n1, _a2, n2) = roundtrip_2x(LanguageId::Kotlin, "Store.kt", src);
    for needle in ["by lazy { seed + 1 }", "init {", "require(seed >= 0)", "val ready = true", "while (i > 0)"] {
        assert!(n2.contains(needle), "Kotlin missing `{needle}`:\n{n2}");
    }
}

#[test]
fn layer1_php_declare_attributes_traits_unset_global_2x() {
    let src = r#"<?php
declare(strict_types=1);

trait Loggable {
    public function tag(): string {
        return "ok";
    }
}

#[AllowDynamicProperties]
class Worker {
    use Loggable;
    public const VERSION = 2;

    public function run($x) {
        global $g;
        $arr = [$x];
        unset($arr[0]);
        return self::VERSION;
    }
}
"#;
    let (_a1, n1, _a2, n2) = roundtrip_2x(LanguageId::Php, "Worker.php", src);
    for needle in ["declare(strict_types=1);", "use Loggable;", "public const VERSION = 2;", "global $g;", "unset($arr[0]);"] {
        assert!(n2.contains(needle), "PHP missing `{needle}`:\n{n2}");
    }
    if has_tool("php") {
        let dir = std::env::temp_dir().join(format!("aice_l1_php_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let fp = dir.join("Worker.php");
        std::fs::write(&fp, &n1).unwrap();
        let out = Command::new("php").args(["-l", fp.to_str().unwrap()]).output().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(out.status.success(), "php -l failed: {}\n{n1}", String::from_utf8_lossy(&out.stderr));
    }
}

#[test]
fn layer1_python_match_with_type_alias_yield_from_2x() {
    let src = r#"type Point = tuple[int, int]

class Box:
    """Box container."""

    def gen(self, items):
        yield from items

    def classify(self, x: int) -> str:
        match x:
            case 0:
                return "zero"
            case _:
                return "other"

    async def consume(self, ctx, stream):
        async with ctx as c:
            async for item in stream:
                pass
"#;
    let (_a1, n1, _a2, n2) = roundtrip_2x(LanguageId::Python, "box.py", src);
    for needle in [
        "type Point = tuple[int, int]",
        "\"\"\"Box container.\"\"\"",
        "yield from items",
        "match x:",
        "async with ctx as c:",
        "async for item in stream:",
    ] {
        assert!(n2.contains(needle), "Python missing `{needle}`:\n{n2}");
    }
    if has_tool("python3") {
        let dir = std::env::temp_dir().join(format!("aice_l1_py_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let fp = dir.join("box.py");
        std::fs::write(&fp, &n1).unwrap();
        let out = Command::new("python3").args(["-m", "py_compile", fp.to_str().unwrap()]).output().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(out.status.success(), "py_compile failed: {}\n{n1}", String::from_utf8_lossy(&out.stderr));
    }
}

#[test]
fn layer1_dart_operator_factory_mixin_typedef_do_while_2x() {
    let src = r#"typedef IntMapper = int Function(int);

mixin Printable {
  String label() => 'ok';
}

class Token with Printable {
  final int id;

  Token(this.id);

  factory Token.zero() => Token(0);

  bool operator ==(Object other) => other is Token && other.id == id;

  int sumTo(int n) {
    var s = 0;
    var i = n;
    do {
      s += i;
      i -= 1;
    } while (i > 0);
    return s;
  }
}
"#;
    let (_a1, _n1, _a2, n2) = roundtrip_2x(LanguageId::Dart, "token.dart", src);
    for needle in [
        "typedef IntMapper = int Function(int);",
        "mixin Printable",
        "factory Token.zero() => Token(0);",
        "bool operator ==(Object other)",
        "while (i > 0);",
    ] {
        assert!(n2.contains(needle), "Dart missing `{needle}`:\n{n2}");
    }
}

#[test]
fn layer1_ts_declare_namespace_static_block_index_sig_priv_in_2x() {
    let src = r#"declare namespace Legacy {
  export function ping(): void;
}

interface Dict {
  [key: string]: number;
}

class Vault {
  #secret: number = 1;
  static ready: boolean = false;

  static {
    Vault.ready = true;
  }

  hasSecret(o: object): boolean {
    return #secret in o;
  }
}
"#;
    let (_a1, _n1, _a2, n2) = roundtrip_2x(LanguageId::TypeScript, "vault.ts", src);
    for needle in [
        "declare namespace Legacy",
        "[key: string]: number",
        "static {",
        "Vault.ready = true;",
        "#secret in o",
    ] {
        assert!(n2.contains(needle), "TypeScript missing `{needle}`:\n{n2}");
    }
}
