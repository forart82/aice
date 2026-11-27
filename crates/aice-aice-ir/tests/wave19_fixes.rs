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
fn f159_uninitialized_locals_all_7_languages_2x() {
    // Rust
    let rs = r#"pub fn f(b: bool) -> i32 {
    let x: i32;
    let mut y: i32;
    let z;
    if b {
        x = 1;
        y = 10;
        z = 100;
    } else {
        x = 2;
        y = 20;
        z = 200;
    }
    y += x;
    y + z
}
"#;
    let (rs_aice, rs_nat) = roundtrip_2x(LanguageId::Rust, "uninit.rs", rs);
    assert!(rs_aice.contains("let x:i32"), "{rs_aice}");
    assert!(rs_aice.contains("mut y:i32"), "{rs_aice}");
    assert!(rs_aice.contains("let z\n"), "{rs_aice}");
    assert!(!rs_nat.contains("= None"), "Rust fabricated = None:\n{rs_nat}");
    assert!(rs_nat.contains("let x: i32;"), "{rs_nat}");
    assert!(rs_nat.contains("let mut y: i32;"), "{rs_nat}");
    assert!(rs_nat.contains("let z;"), "{rs_nat}");

    // TypeScript
    let ts = r#"export function f(b: boolean): number {
  let x: number;
  if (b) {
    x = 1;
  } else {
    x = 2;
  }
  return x;
}
"#;
    let (ts_aice, ts_nat) = roundtrip_2x(LanguageId::TypeScript, "uninit.ts", ts);
    assert!(ts_aice.contains("mut x:num"), "{ts_aice}");
    assert!(!ts_nat.contains("= null"), "TS fabricated = null:\n{ts_nat}");
    assert!(ts_nat.contains("let x: number;"), "{ts_nat}");

    // JavaScript
    let js = r#"export function f() {
  let x;
  return x === undefined;
}
"#;
    let (js_aice, js_nat) = roundtrip_2x(LanguageId::JavaScript, "uninit.js", js);
    assert!(js_aice.contains("mut x\n"), "{js_aice}");
    assert!(!js_nat.contains("= null"), "JS fabricated = null:\n{js_nat}");
    assert!(js_nat.contains("let x;"), "{js_nat}");

    // C
    let c = r#"struct P {
    int x;
};

int f(void) {
    struct P local;
    int n;
    n = 5;
    local.x = n;
    return local.x;
}
"#;
    let (c_aice, c_nat) = roundtrip_2x(LanguageId::C, "uninit.c", c);
    assert!(c_aice.contains("mut local:\"struct P\""), "{c_aice}");
    assert!(c_aice.contains("mut n:int"), "{c_aice}");
    assert!(!c_nat.contains("= NULL"), "C fabricated = NULL:\n{c_nat}");
    assert!(c_nat.contains("struct P local;"), "{c_nat}");
    assert!(c_nat.contains("int n;"), "{c_nat}");

    // C++
    let cpp = r#"struct P {
    int x;
};

int f() {
    P local;
    int n;
    n = 5;
    local.x = n;
    return local.x;
}
"#;
    let (cpp_aice, cpp_nat) = roundtrip_2x(LanguageId::Cpp, "uninit.cpp", cpp);
    assert!(cpp_aice.contains("mut local:P"), "{cpp_aice}");
    assert!(cpp_aice.contains("mut n:int"), "{cpp_aice}");
    assert!(!cpp_nat.contains("= nullptr"), "C++ fabricated = nullptr:\n{cpp_nat}");
    assert!(cpp_nat.contains("P local;"), "{cpp_nat}");
    assert!(cpp_nat.contains("int n;"), "{cpp_nat}");

    // Java
    let java = r#"public class JavaUninit {
    public static int f() {
        int n;
        n = 5;
        return n;
    }
}
"#;
    let (java_aice, java_nat) = roundtrip_2x(LanguageId::Java, "JavaUninit.java", java);
    assert!(java_aice.contains("mut n:int"), "{java_aice}");
    assert!(!java_nat.contains("= null"), "Java fabricated = null:\n{java_nat}");
    assert!(java_nat.contains("int n;"), "{java_nat}");

    // C#
    let cs = r#"public class CsUninit {
    public static int F() {
        int n;
        n = 5;
        return n;
    }
}
"#;
    let (cs_aice, cs_nat) = roundtrip_2x(LanguageId::CSharp, "CsUninit.cs", cs);
    assert!(cs_aice.contains("mut n:int"), "{cs_aice}");
    assert!(!cs_nat.contains("= null"), "C# fabricated = null:\n{cs_nat}");
    assert!(cs_nat.contains("int n;"), "{cs_nat}");

    // Kotlin
    let kt = r#"fun f(b: Boolean): Int {
    val x: Int
    if (b) {
        x = 1
    } else {
        x = 2
    }
    return x
}
"#;
    let (kt_aice, kt_nat) = roundtrip_2x(LanguageId::Kotlin, "uninit.kt", kt);
    assert!(kt_aice.contains("let x:int"), "{kt_aice}");
    assert!(!kt_nat.contains("= null"), "Kotlin fabricated = null:\n{kt_nat}");
    assert!(kt_nat.contains("val x: Int"), "{kt_nat}");

    // Inline block uninitialized local (closure body)
    let rs_inline = r#"pub fn g() -> i32 {
    let f = || {
        let x: i32;
        x = 7;
        x
    };
    f()
}
"#;
    let (_ri_aice, ri_nat) = roundtrip_2x(LanguageId::Rust, "uninit_inline.rs", rs_inline);
    assert!(!ri_nat.contains("= None"), "Inline Rust closure fabricated = None:\n{ri_nat}");
    assert!(ri_nat.contains("let x: i32;"), "{ri_nat}");
}

#[test]
fn f160_go_anonymous_functions_closures_and_iife_2x() {
    let go = r#"package main

import (
	"fmt"
	"sort"
)

func run(log *int) int {
	fn := func(x int) int {
		return x + 1
	}
	bump := func() { *log += 5 }
	bump()
	acc := 0
	func() {
		acc += 5
	}()
	xs := []int{3, 1, 2}
	sort.Slice(xs, func(i, j int) bool {
		return xs[i] < xs[j]
	})
	fmt.Println(xs[0])
	return fn(acc) + *log
}
"#;
    let (_aice, nat) = roundtrip_2x(LanguageId::Go, "closures.go", go);
    assert!(nat.contains("fn := func(x int) int"), "{nat}");
    assert!(nat.contains("bump := func() { *log += 5 }"), "{nat}");
    assert!(nat.contains("}()"), "Go IIFE lost () attachment:\n{nat}");
    assert!(!nat.contains("func()\n{"), "Go IIFE split func() and {{:\n{nat}");
    assert!(nat.contains("sort.Slice(xs, func(i, j int) bool"), "{nat}");
}

#[test]
fn f161_kotlin_trailing_lambdas_2x() {
    let kt = r#"data class Box(var a: Int = 0, var b: Int = 0)

fun process(xs: List<Int>): Int {
    val ys = xs.map { x -> x * 2 }
    val zs = xs.filter { it > 0 }.map { it * 2 }
    val sum = xs.fold(0) { acc, x -> acc + x }
    val ids = xs.map { it + 1 }.toSet()
    val box = Box().apply {
        a = 10
        b = 20
    }
    val dbl = { x: Int -> x * 2 }
    return ys.size + zs.size + sum + ids.size + box.a + box.b + dbl(3)
}
"#;
    let (_aice, nat) = roundtrip_2x(LanguageId::Kotlin, "lambdas.kt", kt);
    assert!(nat.contains("xs.map { x -> x * 2 }"), "{nat}");
    assert!(nat.contains("xs.filter { it > 0 }.map { it * 2 }"), "{nat}");
    assert!(nat.contains("xs.fold(0) { acc, x -> acc + x }"), "{nat}");
    assert!(nat.contains("xs.map { it + 1 }.toSet()"), "{nat}");
    assert!(nat.contains("Box().apply {"), "{nat}");
    assert!(nat.contains("{ x: Int -> x * 2 }"), "{nat}");
    assert!(!nat.contains("xs.map()"), "Kotlin trailing lambda deleted:\n{nat}");
}

#[test]
fn f162_php_anonymous_functions_2x() {
    let php = r#"<?php

function run(int $y): int {
    $acc = 0;
    $add = function (int $x) use ($y): int {
        return $x + $y;
    };
    $inc = function (int $d) use (&$acc): void {
        $acc += $d;
    };
    $inc(7);
    $mapped = array_map(function (int $v) use ($y): int {
        return $v + $y;
    }, [1, 2, 3]);
    $imm = (function (int $z): int { return $z * 2; })(5);
    return $add($acc) + $mapped[0] + $imm;
}
"#;
    let (_aice, nat) = roundtrip_2x(LanguageId::Php, "closures.php", php);
    assert!(nat.contains("function (int $x) use ($y): int"), "{nat}");
    assert!(nat.contains("function (int $d) use (&$acc): void"), "{nat}");
    assert!(nat.contains("array_map(function (int $v) use ($y): int"), "{nat}");
    assert!(nat.contains("(function (int $z): int { return $z * 2; })(5)"), "{nat}");
}

#[test]
fn f163_cpp_brace_temporaries_and_c99_compound_literals_2x() {
    let cpp = r#"#include <memory>
#include <vector>

struct Node {
    int x;
    Node* next;
};

struct Point {
    int x;
    int y;
};

Node make_node(int x) {
    auto up = std::make_unique<Node>(Node{5, nullptr});
    Point p = Point{x, up->x};
    auto xs = std::vector<int>{1, 2, 3};
    return Node{p.x + p.y + static_cast<int>(xs.size()), nullptr};
}
"#;
    let (_cpp_aice, cpp_nat) = roundtrip_2x(LanguageId::Cpp, "braces.cpp", cpp);
    assert!(cpp_nat.contains("Node{5, nullptr}"), "{cpp_nat}");
    assert!(cpp_nat.contains("std::make_unique<Node>(Node{5, nullptr})"), "{cpp_nat}");
    assert!(cpp_nat.contains("Point{x, up->x}"), "{cpp_nat}");
    assert!(cpp_nat.contains("std::vector<int>{1, 2, 3}"), "{cpp_nat}");

    let c = r#"struct P {
    int x;
};

int read_p(struct P p) {
    return p.x;
}

int f(void) {
    struct P a = { .x = 3 };
    return a.x + read_p((struct P){ .x = 5 });
}
"#;
    let (_c_aice, c_nat) = roundtrip_2x(LanguageId::C, "compound.c", c);
    assert!(c_nat.contains("(struct P){ .x = 5 }"), "{c_nat}");
    assert!(c_nat.contains("{ .x = 3 }"), "{c_nat}");
}

#[test]
fn f164_cpp_lambda_captures_and_rust_move_closures_2x() {
    let cpp = r#"#include <memory>
#include <utility>

class Adder {
public:
    int base_ = 4;

    int run() {
        int y = 10;
        int x = 2;
        auto zero = []() { return 1; };
        auto by_val = [y](int a) { return a + y; };
        auto copy_all = [=](int a) { return a + y; };
        auto by_ref = [&](int a) { y += a; return y; };
        auto mixed = [x, &y](int a) { y += x + a; return y; };
        auto with_this = [this](int a) { return a + base_; };
        auto p = std::make_unique<int>(7);
        auto init_cap = [q = std::move(p)](int a) { return *q + a; };
        auto mut_lam = [y](int a) mutable { y += a; return y; };
        y = 100;
        return zero() + by_val(3) + copy_all(1) + by_ref(2) + mixed(1) + with_this(1) + init_cap(2) + mut_lam(5);
    }
};
"#;
    let (_cpp_aice, cpp_nat) = roundtrip_2x(LanguageId::Cpp, "captures.cpp", cpp);
    assert!(cpp_nat.contains("[]() { return 1; }"), "{cpp_nat}");
    assert!(cpp_nat.contains("[y](int a) { return a + y; }"), "{cpp_nat}");
    assert!(cpp_nat.contains("[=](int a) { return a + y; }"), "{cpp_nat}");
    assert!(cpp_nat.contains("[&](int a) { y += a; return y; }"), "{cpp_nat}");
    assert!(cpp_nat.contains("[x, &y](int a)"), "{cpp_nat}");
    assert!(cpp_nat.contains("[this](int a)"), "{cpp_nat}");
    assert!(cpp_nat.contains("[q = std::move(p)](int a)"), "{cpp_nat}");
    assert!(cpp_nat.contains("[y](int a) mutable"), "{cpp_nat}");

    let rs = r#"pub fn make_adder(y: i32) -> Box<dyn Fn(i32) -> i32> {
    Box::new(move |x: i32| x + y)
}

pub fn make_block(y: i32) -> Box<dyn Fn(i32) -> i32> {
    let f = move |x: i32| -> i32 { x + y };
    Box::new(f)
}
"#;
    let (rs_aice, rs_nat) = roundtrip_2x(LanguageId::Rust, "move_closure.rs", rs);
    assert!(rs_aice.contains("move fn(x: i32) = x + y"), "{rs_aice}");
    assert!(rs_aice.contains("move fn(x: i32) -> i32 { x + y }"), "{rs_aice}");
    assert!(rs_nat.contains("Box::new(move |x: i32| x + y)"), "{rs_nat}");
    assert!(rs_nat.contains("move |x: i32| -> i32 { x + y }"), "{rs_nat}");
}
