use std::path::Path;

use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn roundtrip_and_check(lang: LanguageId, vpath: &str, src: &str, must: &[&str]) -> String {
    let reg = EngineRegistry::default();
    let transpiler = DefaultAiceTranspiler;
    let firewall = DefaultSyntaxFirewall;
    let tree = reg.adapter(lang).unwrap().parse_cst(src).expect("parse_cst");
    let TranspileOutcome::Transpiled(module) = transpiler
        .to_aice(&tree, src, &TranspileOpts::default())
        .expect("to_aice")
    else {
        panic!("expected Transpiled for {lang:?}");
    };
    let aice = print_aice(&module);
    assert!(!aice.contains("for item in"), "fabricated for-in for {lang:?}:\n{aice}");
    for needle in must {
        assert!(aice.contains(needle), "missing {needle:?} for {lang:?} in:\n{aice}");
    }
    let reparsed = parse_aice(&aice).unwrap_or_else(|e| panic!("parse_aice failed for {lang:?}: {e}\n{aice}"));
    let native = transpiler.to_native(&reparsed, lang).expect("to_native");
    let verdict = firewall.verify(&native, Path::new(vpath), lang);
    assert_eq!(verdict, FirewallVerdict::Valid, "firewall rejected {lang:?}:\n{native}\nAICE:\n{aice}");
    aice
}

#[test]
fn c_style_for_all_imperative_languages_and_go_kotlin() {
    let cases: &[(LanguageId, &str, &str, &[&str])] = &[
        (
            LanguageId::TypeScript,
            "loop.ts",
            "export function sumTo(n: number): number { let acc = 0; for (let i = 0; i < n; i++) { acc += i; } return acc; }\n",
            &["i ::= 0", "while i < n:", "i++"],
        ),
        (
            LanguageId::Tsx,
            "loop.tsx",
            "export function sumTo(n: number): number { let acc = 0; for (let i = 0; i < n; i++) { acc += i; } return acc; }\n",
            &["i ::= 0", "while i < n:", "i++"],
        ),
        (
            LanguageId::JavaScript,
            "loop.js",
            "export function sumTo(n) { let acc = 0; for (let i = 0; i < n; i++) { acc += i; } return acc; }\n",
            &["i ::= 0", "while i < n:", "i++"],
        ),
        (
            LanguageId::C,
            "loop.c",
            "int sum_to(int n) { int s = 0; for (int i = 0; i < n; i++) { s += i; } return s; }\n",
            &["i:int ::= 0", "while i < n:", "i++"],
        ),
        (
            LanguageId::Cpp,
            "loop.cpp",
            "int sum_to(int n) { int s = 0; for (int i = 0; i < n; i++) { s += i; } return s; }\n",
            &["i:int ::= 0", "while i < n:", "i++"],
        ),
        (
            LanguageId::CSharp,
            "Loop.cs",
            "public class Loop { public int SumTo(int n) { int s = 0; for (int i = 0; i < n; i++) { s += i; } return s; } }\n",
            &["i:int ::= 0", "while i < n:", "i++"],
        ),
        (
            LanguageId::Java,
            "Loop.java",
            "public class Loop { public int sumTo(int n) { int s = 0; for (int i = 0; i < n; i++) { s += i; } return s; } }\n",
            &["i:int ::= 0", "while i < n:", "i++"],
        ),
        (
            LanguageId::Dart,
            "loop.dart",
            "int sumTo(int n) { var s = 0; for (var i = 0; i < n; i++) { s += i; } return s; }\nint sumEach(List<int> xs) { var s = 0; for (var x in xs) { s += x; } return s; }\n",
            &["i ::= 0", "while i < n:", "i++", "for x in xs:"],
        ),
        (
            LanguageId::Php,
            "loop.php",
            "<?php\nfunction sumTo($n) { $s = 0; for ($i = 0; $i < $n; $i++) { $s += $i; } return $s; }\n",
            &["$i = 0", "while $i < $n:", "$i++"],
        ),
        (
            LanguageId::Go,
            "loop.go",
            "package p\nfunc f(n int) int {\n  acc := 0\n  for i := 0; i < n; i++ { acc += i }\n  for acc < n { acc++ }\n  for { break }\n  return acc\n}\n",
            &["i ::= 0", "while i < n:", "while acc < n:", "loop:"],
        ),
        (
            LanguageId::Kotlin,
            "loop.kt",
            "fun sumEach(xs: List<Int>): Int { var acc = 0; for (x in xs) { acc += x }; return acc }\n",
            &["for x in xs:"],
        ),
    ];
    for (lang, vpath, src, must) in cases {
        roundtrip_and_check(*lang, vpath, src, must);
    }
}

#[test]
fn c_style_for_continue_missing_clauses_prefix_comma_and_single_stmt() {
    let ts_cont = roundtrip_and_check(
        LanguageId::TypeScript,
        "cont.ts",
        "export function sumOdd(n: number): number {\n  let acc = 0;\n  for (let i = 0; i < n; i++) {\n    if (i % 2 === 0) continue;\n    acc += i;\n  }\n  return acc;\n}\n",
        &["i ::= 0", "while i < n:", "continue"],
    );
    assert!(ts_cont.matches("i++").count() >= 2, "expected update before continue:\n{ts_cont}");

    let c_edges = roundtrip_and_check(
        LanguageId::C,
        "edges.c",
        "int edges(int n) {\n  int i = 0, j = n, s = 0;\n  for (; i < n; ++i) s += i;\n  for (int k = 0; ; k++) { if (k >= n) break; s += k; }\n  for (int m = 0; m < n; ) { m++; }\n  for (;;) { break; }\n  for (i = 0, j = n; i < j; i++, j--) { s += i; }\n  return s;\n}\n",
        &["++i", "k:int ::= 0", "m:int ::= 0", "loop:", "i = 0", "j = n", "i++", "j--", "s += i"],
    );
    assert!(!c_edges.contains("for item in"));

    let single_ret = roundtrip_and_check(
        LanguageId::Java,
        "Single.java",
        "public class Single { public int findFirst(int n) { for (int i = 0; i < n; i++) return i; return -1; } }\n",
        &["i:int ::= 0", "while i < n:", "ret i"],
    );
    assert!(single_ret.contains("ret i"), "lost return in single-stmt body:\n{single_ret}");
}

#[test]
fn prefix_dec_and_dart_unary_roundtrip() {
    type UnaryCase<'a> = (LanguageId, &'a str, &'a str, &'a [&'a str], &'a [&'a str]);
    let cases: &[UnaryCase<'_>] = &[
        (
            LanguageId::TypeScript,
            "dec.ts",
            "export function dec(n: number): number { let s = 0; for (let i = n; i > 0; --i) { s += i; } return s; }\n",
            &["--i"],
            &["\n    -i"],
        ),
        (
            LanguageId::Tsx,
            "dec.tsx",
            "export function dec(n: number): number { let s = 0; for (let i = n; i > 0; --i) { s += i; } return s; }\n",
            &["--i"],
            &["\n    -i"],
        ),
        (
            LanguageId::JavaScript,
            "dec.js",
            "export function dec(n) { let s = 0; for (let i = n; i > 0; --i) { s += i; } return s; }\n",
            &["--i"],
            &["\n    -i"],
        ),
        (
            LanguageId::C,
            "dec.c",
            "int dec(int n) { int s = 0; for (int i = n; i > 0; --i) { s += i; } return s; }\n",
            &["--i"],
            &["\n    -i"],
        ),
        (
            LanguageId::Cpp,
            "dec.cpp",
            "int dec(int n) { int s = 0; int i = 0; int j = n; for (i = 0, j = n; i < j; ++i, --j) { s += j; } return s; }\n",
            &["++i", "--j"],
            &["\n    -j"],
        ),
        (
            LanguageId::CSharp,
            "Dec.cs",
            "public class Dec { public int Run(int n) { int s = 0; for (int i = n; i > 0; --i) { s += i; } return s; } }\n",
            &["i:int ::= n", "--i"],
            &["\n      -i", "::= nil"],
        ),
        (
            LanguageId::Java,
            "Dec.java",
            "public class Dec { public int run(int n) { int s = 0; for (int i = n; i > 0; --i) { s += i; } return s; } }\n",
            &["--i"],
            &["\n      -i"],
        ),
        (
            LanguageId::Php,
            "dec.php",
            "<?php\nfunction dec($n) { $s = 0; $a = -$n; $b = !$n; for ($i = 0, $j = $n; $i < $j; $i++, --$j) { $s += $j; } return $s; }\n",
            &["-$n", "not $n", "$i++", "--$j"],
            &["\n    -$j"],
        ),
        (
            LanguageId::Dart,
            "dec.dart",
            "int dec(int n, bool b) {\n  var s = -n;\n  var x = ~n;\n  var f = !b;\n  for (var i = n; i > 0; --i) { s += i; }\n  for (var k = 0; k < n; k++) { s += k; }\n  return s;\n}\n",
            &["-n", "~n", "not b", "--i", "k++"],
            &["---", "++++", "not !", "~~"],
        ),
    ];
    for (lang, vpath, src, must, forbid) in cases {
        let aice = roundtrip_and_check(*lang, vpath, src, must);
        for bad in *forbid {
            assert!(!aice.contains(bad), "unexpected {bad:?} for {lang:?} in:\n{aice}");
        }
    }
}

#[test]
fn csharp_and_multivar_for_and_ident_initializers() {
    let cs = roundtrip_and_check(
        LanguageId::CSharp,
        "Edge.cs",
        "public class Edge {\n  public int Run(int n) {\n    int s = 0;\n    var x = n;\n    int y = n;\n    for (int j = 0, k = n; j < k; j++, k--) { s += j; }\n    for (int i = n; i > 0; --i) { s += i; }\n    for (j = 0, k = n; j < k; j++, k--) { s += j; }\n    return s + x + y;\n  }\n}\n",
        &["x:var ::= n", "y:int ::= n", "j:int ::= 0", "k:int ::= n", "j++", "k--", "i:int ::= n", "--i", "j = 0", "k = n"],
    );
    assert!(!cs.lines().any(|l| l.trim() == ","), "bare comma leaked:\n{cs}");
    assert!(!cs.contains("::= nil"), "unexpected nil init:\n{cs}");

    roundtrip_and_check(
        LanguageId::TypeScript,
        "multi.ts",
        "export function m(n: number): number { let a = 1, b = n, s = 0; for (let i = 0, j = n; i < j; i++, j--) { s += i; } return s + a + b; }\n",
        &["a ::= 1", "b ::= n", "i ::= 0", "j ::= n", "i++", "j--"],
    );
    roundtrip_and_check(
        LanguageId::Java,
        "Multi.java",
        "public class Multi { public int m(int n) { int a = 1, b = n, s = 0; for (int i = 0, j = n; i < j; i++, j--) { s += i; } return s + a + b; } }\n",
        &["a:int ::= 1", "b:int ::= n", "i:int ::= 0", "j:int ::= n", "i++", "j--"],
    );
    roundtrip_and_check(
        LanguageId::Dart,
        "multi.dart",
        "int m(int n) { var a = 1, b = n, s = 0; for (var i = 0, j = n; i < j; i++, j--) { s += i; } return s + a + b; }\n",
        &["a ::= 1", "b ::= n", "i ::= 0", "j ::= n", "i++", "j--"],
    );
    let c_multi = roundtrip_and_check(
        LanguageId::C,
        "multi.c",
        "int m(int n) { int a[4]; int u, v = n; int *p = &n, q = 0; return v + q; }\n",
        &["mut a:int", "mut u:int", "v:int ::= n", "p:\"int*\" ::= &n", "q:int ::= 0"],
    );
    assert!(!c_multi.contains("a:int ::= 4"), "array size leaked as init:\n{c_multi}");
}

#[test]
fn cpp_condition_clause_if_else_if_and_init() {
    use aice_aice_ir::ir::AiceItem;
    use aice_aice_ir::ir_code::{Expr, FnBody, Stmt};
    use aice_aice_ir::ir_expr::LiteralVal;

    let cpp = concat!(
        "int f(int x) {\n",
        "  if (x > 0) { return 1; }\n",
        "  else if (x == 0) { return 0; }\n",
        "  else { return -1; }\n",
        "}\n",
    );
    let aice = roundtrip_and_check(
        LanguageId::Cpp,
        "cond.cpp",
        cpp,
        &["if x > 0:", "elif x == 0:", "else:", "ret -1"],
    );
    assert!(!aice.contains("if (x > 0):"), "unwrapped condition kept parens:\n{aice}");

    let reg = EngineRegistry::default();
    let cpp_init = concat!(
        "int f_init(int x) {\n",
        "  if (int y = x + 1; y > 0) { return y; }\n",
        "  if (int z = x) { return z; }\n",
        "  return 0;\n",
        "}\n",
    );
    let init_tree = reg.adapter(LanguageId::Cpp).unwrap().parse_cst(cpp_init).unwrap();
    let TranspileOutcome::Transpiled(init_mod) = DefaultAiceTranspiler
        .to_aice(&init_tree, cpp_init, &TranspileOpts::default())
        .unwrap()
    else {
        panic!("expected Transpiled");
    };
    let init_aice = print_aice(&init_mod);
    assert!(init_aice.contains("if (int y = x + 1; y > 0):"), "{init_aice}");
    assert!(init_aice.contains("if (int z = x):"), "{init_aice}");
    let src_false = "int g() { if (false) {} else { return -1; } return 0; }\n";
    let tree = reg.adapter(LanguageId::Cpp).unwrap().parse_cst(src_false).unwrap();
    let TranspileOutcome::Transpiled(m) = DefaultAiceTranspiler.to_aice(&tree, src_false, &TranspileOpts::default()).unwrap() else {
        panic!("expected Transpiled");
    };
    let AiceItem::Fn(fd) = &m.items[0] else { panic!("expected fn"); };
    let FnBody::Block(stmts) = &fd.body else { panic!("expected block"); };
    assert!(matches!(&stmts[0], Stmt::If { cond: Expr::Literal(LiteralVal::Bool(false)), .. }), "got {:?}", stmts[0]);
}
