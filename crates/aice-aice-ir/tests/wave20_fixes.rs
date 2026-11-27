use std::path::Path;

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

fn roundtrip_2x(lang: LanguageId, vname: &str, src: &str) -> (String, String) {
    let (a1, n1) = roundtrip(lang, vname, src);
    let (a2, n2) = roundtrip(lang, vname, &n1);
    assert_eq!(a1, a2, "{vname} AICE 2x mismatch:\n--- A1 ---\n{a1}\n--- A2 ---\n{a2}");
    assert_eq!(n1, n2, "{vname} native 2x mismatch:\n--- N1 ---\n{n1}\n--- N2 ---\n{n2}");
    (a1, n1)
}

#[test]
fn f165_kotlin_if_else_elif_braceless_and_expr_2x() {
    let src = r#"fun sign(n: Int): Int {
    var r = 99
    if (n > 0) {
        r = 1
    } else if (n < 0) {
        r = -1
    } else {
        r = 0
    }
    return r
}

fun defAssign(b: Boolean): Int {
    val x: Int
    if (b) {
        x = 31
    } else {
        x = 41
    }
    return x
}

fun guardPos(x: Int): Int {
    if (x < 0) throw RuntimeException("bad")
    var out = 0
    if (x == 0) out = 10 else out = x
    val absX = if (x > 0) x else -x
    val br = if (x > 0) { x } else { -x }
    val tri = if (x > 0) 1 else if (x < 0) -1 else 0
    return out + absX + br + tri
}
"#;
    let (_aice, nat) = roundtrip_2x(LanguageId::Kotlin, "KtIfElse.kt", src);
    assert!(nat.contains("} else if (n < 0) {"), "{nat}");
    assert!(nat.contains("r = -1"), "{nat}");
    assert!(nat.contains("r = 0"), "{nat}");
    assert!(nat.contains("x = 41"), "{nat}");
    assert!(nat.contains("throw RuntimeException(\"bad\")"), "{nat}");
    assert!(nat.contains("out = 10") && nat.contains("out = x"), "{nat}");
    assert!(nat.contains("if (x > 0) x else -x"), "{nat}");
    assert!(nat.contains("if (x > 0) 1 else if (x < 0) -1 else 0"), "{nat}");
}

#[test]
fn f166_kotlin_and_dart_local_nullable_and_fn_types_2x() {
    let kt = r#"fun ktLocals(): String {
    var s: String? = null
    s = "hi"
    val dbl: (Int) -> Int = { it * 2 }
    var optFn: ((Int) -> Int)? = null
    optFn = dbl
    return "${s}:${optFn(3)}"
}
"#;
    let (_kt_aice, kt_nat) = roundtrip_2x(LanguageId::Kotlin, "KtTypes.kt", kt);
    assert!(kt_nat.contains("var s: String? = null"), "{kt_nat}");
    assert!(kt_nat.contains("val dbl: (Int) -> Int = { it * 2 }"), "{kt_nat}");
    assert!(kt_nat.contains("var optFn: ((Int) -> Int)? = null"), "{kt_nat}");

    let dart = r#"String dartLocals() {
  String? s = null;
  s = 'hi';
  List<int>? xs = null;
  int Function(int) dbl = (x) => x * 2;
  var plain = 3;
  return '${s}:${dbl(plain)}:${xs}';
}
"#;
    let (_d_aice, d_nat) = roundtrip_2x(LanguageId::Dart, "dart_types.dart", dart);
    assert!(d_nat.contains("String? s = null;"), "{d_nat}");
    assert!(d_nat.contains("List<int>? xs = null;"), "{d_nat}");
    assert!(d_nat.contains("int Function(int) dbl ="), "{d_nat}");
    assert!(d_nat.contains("var plain = 3;"), "{d_nat}");
}

#[test]
fn f167_cpp_default_member_initializers_2x() {
    let src = r#"#include <iostream>
#include <vector>

struct Box {
    int b = 7;
    int c{3};
    std::vector<int> xs{1, 2};
    int uninit;
    int run() {
        auto f = [this]() { return b + 1; };
        return f();
    }
};

int main() {
    Box box;
    std::cout << box.run() << "\n";
}
"#;
    let (_aice, nat) = roundtrip_2x(LanguageId::Cpp, "box.cpp", src);
    assert!(nat.contains("int b = 7;"), "{nat}");
    assert!(nat.contains("int c{3};"), "{nat}");
    assert!(nat.contains("std::vector<int> xs{1, 2};"), "{nat}");
    assert!(nat.contains("int uninit;"), "{nat}");
}

#[test]
fn f168_go_package_level_vars_2x() {
    let src = r#"package main

import (
	"errors"
	"fmt"
)

var ErrMiss = errors.New("miss")
var count int = 5
var g int
var (
	a = 1
	b int = 2
	c string
)
var x, y int = 10, 20

func main() {
	fmt.Println(ErrMiss, count, g, a, b, c, x, y)
}
"#;
    let (_aice, nat) = roundtrip_2x(LanguageId::Go, "vars.go", src);
    assert!(nat.contains("var ErrMiss = errors.New(\"miss\")"), "{nat}");
    assert!(nat.contains("var count int = 5"), "{nat}");
    assert!(nat.contains("var g int"), "{nat}");
    assert!(nat.contains("var (\n\ta = 1\n\tb int = 2\n\tc string\n)"), "{nat}");
    assert!(nat.contains("var x, y int = 10, 20"), "{nat}");
}

#[test]
fn f169_top_level_uninit_vars_and_python_global_nonlocal_2x() {
    let js = "let x;\nexport let y;\nexport function check() {\n  return x === undefined && typeof x === \"undefined\";\n}\n";
    let (_js_aice, js_nat) = roundtrip_2x(LanguageId::JavaScript, "top.js", js);
    assert!(js_nat.contains("let x;"), "{js_nat}");
    assert!(js_nat.contains("export let y;"), "{js_nat}");
    assert!(!js_nat.contains("= null"), "{js_nat}");

    let ts = "let x: number;\nexport let y: string;\nexport function setAll(): number {\n  x = 42;\n  y = \"ok\";\n  return x;\n}\n";
    let (_ts_aice, ts_nat) = roundtrip_2x(LanguageId::TypeScript, "top.ts", ts);
    assert!(ts_nat.contains("let x: number;"), "{ts_nat}");
    assert!(ts_nat.contains("export let y: string;"), "{ts_nat}");
    assert!(!ts_nat.contains("= null"), "{ts_nat}");

    let py = r#"x: int
g = 1

def bump() -> int:
    global g
    g += 1
    y = 10
    def inner() -> int:
        nonlocal y
        y += 5
        return y
    return g + inner()
"#;
    let (_py_aice, py_nat) = roundtrip_2x(LanguageId::Python, "top.py", py);
    assert!(py_nat.contains("x: int\n"), "{py_nat}");
    assert!(!py_nat.contains("x: int = None"), "{py_nat}");
    assert!(py_nat.contains("    global g\n"), "{py_nat}");
    assert!(py_nat.contains("        nonlocal y\n"), "{py_nat}");

    let c_src = "int g;\nint get_g(void) {\n    return g;\n}\n";
    let (_c_aice, c_nat) = roundtrip_2x(LanguageId::C, "top.c", c_src);
    assert!(c_nat.contains("int g;") && !c_nat.contains("NULL"), "{c_nat}");

    let cpp_src = "int g;\nint get_g() {\n    return g;\n}\n";
    let (_cpp_aice, cpp_nat) = roundtrip_2x(LanguageId::Cpp, "top.cpp", cpp_src);
    assert!(cpp_nat.contains("int g;") && !cpp_nat.contains("nullptr"), "{cpp_nat}");
}

#[test]
fn f170_kotlin_typed_catch_clauses_2x() {
    let src = r#"fun parsePos(x: Int): Int {
    try {
        if (x < 0) {
            throw IllegalArgumentException("neg")
        }
        return x
    } catch (e: IllegalArgumentException) {
        return e.message?.length ?: -1
    } catch (st: IllegalStateException) {
        return -2
    }
}
"#;
    let (_aice, nat) = roundtrip_2x(LanguageId::Kotlin, "KtCatch.kt", src);
    assert!(nat.contains("} catch (e: IllegalArgumentException) {"), "{nat}");
    assert!(nat.contains("} catch (st: IllegalStateException) {"), "{nat}");
    assert!(!nat.contains("catch (err: Exception)"), "{nat}");
}

#[test]
fn f171_do_while_all_9_c_family_languages_2x() {
    let cases: &[(LanguageId, &str, &str, &str)] = &[
        (LanguageId::C, "dw.c", "int f(int n) {\n    int i = 0;\n    do { i++; } while (i < n);\n    return i;\n}\n", "do { i++; } while (i < n);"),
        (LanguageId::Cpp, "dw.cpp", "int f(int n) {\n    int i = 0;\n    do { i++; } while (i < n);\n    return i;\n}\n", "do { i++; } while (i < n);"),
        (LanguageId::Java, "Dw.java", "public class Dw {\n    public static int f(int n) {\n        int i = 0;\n        do { i++; } while (i < n);\n        return i;\n    }\n}\n", "do { i++; } while (i < n);"),
        (LanguageId::CSharp, "Dw.cs", "public class Dw {\n    public static int F(int n) {\n        int i = 0;\n        do { i++; } while (i < n);\n        return i;\n    }\n}\n", "do { i++; } while (i < n);"),
        (LanguageId::JavaScript, "dw.js", "export function f(n) {\n  let i = 0;\n  do { i++; } while (i < n);\n  return i;\n}\n", "do { i++; } while (i < n);"),
        (LanguageId::TypeScript, "dw.ts", "export function f(n: number): number {\n  let i = 0;\n  do { i++; } while (i < n);\n  return i;\n}\n", "do { i++; } while (i < n);"),
        (LanguageId::Php, "dw.php", "<?php\nfunction f(int $n): int {\n    $i = 0;\n    do { $i++; } while ($i < $n);\n    return $i;\n}\n", "do { $i++; } while ($i < $n);"),
        (LanguageId::Kotlin, "Dw.kt", "fun f(n: Int): Int {\n    var i = 0\n    do { i++ } while (i < n)\n    return i\n}\n", "do { i++ } while (i < n)"),
        (LanguageId::Dart, "dw.dart", "int f(int n) {\n  int i = 0;\n  do { i++; } while (i < n);\n  return i;\n}\n", "do { i++; } while (i < n);"),
    ];
    for &(lang, name, src, expected) in cases {
        let (_aice, nat) = roundtrip_2x(lang, name, src);
        assert!(nat.contains(expected), "{name} missing `{expected}`:\n{nat}");
        assert!(!nat.contains(";;"), "{name} produced double semicolon:\n{nat}");
    }
}

#[test]
fn f172_rust_if_let_expr_and_let_else_stmt_2x() {
    let src = r#"pub fn unwrap_sum(o: Option<i32>) -> i32 {
    let a = if let Some(v) = o { v } else { 0 };
    let c = if o.is_none() { 1 } else if let Some(v) = o { v } else { 0 };
    let Some(b) = o else { return a + c; };
    a + b + c
}

pub fn tail_let_else(o: Option<i32>) {
    let Some(_x) = o else { return; };
}
"#;
    let (_aice, nat) = roundtrip_2x(LanguageId::Rust, "let_else.rs", src);
    assert!(nat.contains("let a = if let Some(v) = o { v } else { 0 };"), "{nat}");
    assert!(nat.contains("let Some(b) = o else { return a + c; };"), "{nat}");
    assert!(nat.contains("let Some(_x) = o else { return; };"), "{nat}");
    assert!(!nat.contains(";;"), "{nat}");
}

#[test]
fn f173_rust_generics_lifetimes_where_and_assoc_types_2x() {
    let src = r#"pub fn id<T>(x: T) -> T {
    x
}

pub fn first_clone<I>(mut it: I) -> Option<I::Item> where I: Iterator, I::Item: Clone {
    it.next().map(|v| v.clone())
}

pub struct Boxed<T> {
    pub val: T,
}

impl<T> Boxed<T> {
    pub fn get(self) -> T {
        self.val
    }

    pub fn pair<U>(self, u: U) -> (T, U) {
        (self.val, u)
    }
}

impl<T: Clone> Boxed<T> {
    pub fn dup(&self) -> T {
        self.val.clone()
    }
}

pub struct Ref<'a, T> {
    pub item: &'a T,
}

impl<'a, T> Ref<'a, T> {
    pub fn borrow(&self) -> &'a T {
        self.item
    }
}

pub enum Either<L, R> {
    Left(L),
    Right(R),
}

pub type Pair<T> = (T, T);

pub trait Mapper {
    type Out;
    fn map(&self) -> Self::Out;
}

impl Mapper for Boxed<i32> {
    type Out = i32;
    fn map(&self) -> Self::Out {
        self.val * 2
    }
}
"#;
    let (_aice, nat) = roundtrip_2x(LanguageId::Rust, "generics.rs", src);
    assert!(nat.contains("pub fn id<T>(x: T) -> T"), "{nat}");
    assert!(nat.contains("pub fn first_clone<I: Iterator>(mut it: I) -> Option<I::Item> where I::Item: Clone"), "{nat}");
    assert!(nat.contains("pub struct Boxed<T> {"), "{nat}");
    assert!(nat.contains("impl<T> Boxed<T> {"), "{nat}");
    assert!(nat.contains("pub fn pair<U>(self, u: U) -> (T, U)"), "{nat}");
    assert!(nat.contains("impl<T: Clone> Boxed<T> {"), "{nat}");
    assert!(nat.contains("pub struct Ref<'a, T> {"), "{nat}");
    assert!(nat.contains("impl<'a, T> Ref<'a, T> {"), "{nat}");
    assert!(nat.contains("pub enum Either<L, R> {"), "{nat}");
    assert!(nat.contains("pub type Pair<T> = (T, T);"), "{nat}");
    assert!(nat.contains("pub trait Mapper {\n    type Out;\n    fn map(&self) -> Self::Out;\n}"), "{nat}");
    assert!(nat.contains("impl Mapper for Boxed<i32> {\n    type Out = i32;"), "{nat}");
}

#[test]
fn f174_and_f175_rust_async_unsafe_blocks_and_nested_items_2x() {
    let src = r#"pub fn blocks_and_nested(p: *const i32, x: i32) -> i32 {
    fn inner(a: i32) -> i32 { a + 1 }
    const C: i32 = 10;
    let _fut = async move { x + 2 };
    let _fut2 = async { 1 + 2 };
    inner(unsafe { *p }) + C
}
"#;
    let (_aice, nat) = roundtrip_2x(LanguageId::Rust, "blk_nested.rs", src);
    assert!(nat.contains("fn inner(a: i32) -> i32 { a + 1 }"), "{nat}");
    assert!(nat.contains("const C: i32 = 10;"), "{nat}");
    assert!(nat.contains("let _fut = async move { x + 2 };"), "{nat}");
    assert!(nat.contains("let _fut2 = async { 1 + 2 };"), "{nat}");
    assert!(nat.contains("unsafe { *p }"), "{nat}");
    assert!(!nat.contains("a + 1 };"), "{nat}");
    assert!(!nat.contains(";;"), "{nat}");
}
