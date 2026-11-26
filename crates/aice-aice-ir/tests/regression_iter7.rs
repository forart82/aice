use std::path::Path;
use std::time::Instant;

use aice_aice_ir::ir::{AiceItem, Expr, FnBody, Stmt};
use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn assert_if_not_escaped(stmts: &[Stmt], label: &str) {
    assert_eq!(stmts.len(), 2, "{label}: expected 2 stmts, got {stmts:?}");
    let Stmt::If { then_body, .. } = &stmts[0] else {
        panic!("{label}: expected Stmt::If at [0], got {:?}", stmts[0]);
    };
    assert_eq!(then_body.len(), 2, "{label}: then_body escaped if: {then_body:?}");
}

#[test]
fn iter7_lexer_multiline_record_and_record_return_type() {
    let transpiler = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;

    // Top-level fn() = multiline record
    let fn_rec = "module m\nfn f() = {\n  a: 1,\n  b: 2\n}\n";
    let m1 = parse_aice(fn_rec).unwrap_or_else(|e| panic!("fn() = record failed: {e}"));
    let AiceItem::Fn(fd1) = &m1.items[0] else { panic!("expected Fn"); };
    assert!(matches!(&fd1.body, FnBody::Expr(Expr::Record(es)) if es.len() == 2));
    let printed1 = print_aice(&m1);
    assert!(parse_aice(&printed1).is_ok(), "reparse failed:\n{printed1}");

    // Closure g := fn() = multiline record
    let clo_rec = "module m\nfn f() -> any:\n  g := fn() = {\n    a: 1,\n    b: 2\n  }\n  ret g\n";
    let m2 = parse_aice(clo_rec).unwrap_or_else(|e| panic!("closure = record failed: {e}"));
    let AiceItem::Fn(fd2) = &m2.items[0] else { panic!("expected Fn"); };
    let FnBody::Block(bs2) = &fd2.body else { panic!("expected Block"); };
    let Stmt::Let { init: Expr::Closure { body, .. }, .. } = &bs2[0] else {
        panic!("expected Let Closure, got {:?}", bs2[0]);
    };
    assert!(matches!(body.as_ref(), FnBody::Expr(Expr::Record(es)) if es.len() == 2));
    let printed2 = print_aice(&m2);
    assert!(parse_aice(&printed2).is_ok(), "reparse closure failed:\n{printed2}");
    let ts2 = transpiler.to_native(&m2, LanguageId::TypeScript).unwrap();
    assert_eq!(fw.verify(&ts2, Path::new("clo.ts"), LanguageId::TypeScript), FirewallVerdict::Valid, "{ts2}");

    // fn f(ok:bool) -> { a: int } { ... } and nested Map[str, { a: int }]
    for src in [
        "module m\nfn f(ok:bool) -> { a: int } {\n  if ok:\n    x := 1\n    ret x\n  ret 0\n}\n",
        "module m\nfn f(ok:bool) -> Map[str, { a: int }] {\n  if ok:\n    x := 1\n    ret x\n  ret 0\n}\n",
        "module m\nfn f(ok:bool) -> { a: int }: {\n  if ok:\n    x := 1\n    ret x\n  ret 0\n}\n",
    ] {
        let m = parse_aice(src).unwrap_or_else(|e| panic!("parse failed: {e}\n{src}"));
        let AiceItem::Fn(fd) = &m.items[0] else { panic!("expected Fn"); };
        let FnBody::Block(stmts) = &fd.body else { panic!("expected Block"); };
        assert_if_not_escaped(stmts, src);
    }
}

#[test]
fn iter7_lexer_class_methods_without_fn_braced_blocks() {
    let src = "\
module m
class C:
  val: int = 0
  constructor(ok:bool) {
    if ok:
      x := 1
      ret x
    ret 0
  }
  pub async run(ok:bool) -> int {
    if ok:
      y := 2
      ret y
    ret 0
  }
  get prop() -> int {
    if true:
      z := 3
      ret z
    ret 0
  }
  set prop(v:int) {
    if v > 0:
      this.val = v
      ret
    this.val = 0
  }
";
    let m = parse_aice(src).unwrap_or_else(|e| panic!("class methods failed: {e}"));
    let AiceItem::Class(cd) = &m.items[0] else { panic!("expected Class"); };
    assert_eq!(cd.methods.len(), 4, "expected 4 methods, got {:?}", cd.methods);
    for meth in &cd.methods {
        let FnBody::Block(stmts) = &meth.body else {
            panic!("method {} expected Block, got {:?}", meth.name, meth.body);
        };
        assert_if_not_escaped(stmts, &meth.name);
    }
    let ts = DefaultAiceTranspiler.to_native(&m, LanguageId::TypeScript).unwrap();
    assert_eq!(DefaultSyntaxFirewall.verify(&ts, Path::new("c.ts"), LanguageId::TypeScript), FirewallVerdict::Valid, "{ts}");

    // Ensure expressions calling get(...) / constructor(...) do not misclassify trailing maps
    let expr_src = "module m\nfn f() -> any:\n  a := get(1)\n  b := { x: 1 }\n  ret { a: a, b: b }\n";
    let me = parse_aice(expr_src).unwrap();
    let AiceItem::Fn(fe) = &me.items[0] else { panic!("expected Fn"); };
    let FnBody::Block(se) = &fe.body else { panic!("expected Block"); };
    assert_eq!(se.len(), 3);
}

#[test]
fn iter7_c_qualified_named_types_emit_valid_identifiers() {
    let reg = EngineRegistry::default();
    let transpiler = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;

    let aice_src = "\
module m
pub fn f1(p:Pkg::Type) -> Pkg::Type:
  ret p
pub fn f2(p:Pkg::Type[int]) -> Pkg::Type[int]:
  ret p
pub fn f3(p:Foo::Bar::Baz) -> Foo::Bar::Baz:
  ret p
";
    let m = parse_aice(aice_src).unwrap();
    let c_out = transpiler.to_native(&m, LanguageId::C).unwrap();
    assert!(!c_out.contains("Pkg.Type") && !c_out.contains("Foo.Bar"), "C emitted dot path:\n{c_out}");
    assert!(c_out.contains("Pkg_Type") && c_out.contains("Foo_Bar_Baz"), "C missing _ path:\n{c_out}");
    assert_eq!(fw.verify(&c_out, Path::new("types.c"), LanguageId::C), FirewallVerdict::Valid, "{c_out}");

    // Kotlin Pkg.Type<Int> -> C
    let kt_src = "fun usePkg(p: Pkg.Type<Int>): Pkg.Type<Int> {\n  return p\n}\n";
    let tree = reg.adapter(LanguageId::Kotlin).unwrap().parse_cst(kt_src).unwrap();
    let TranspileOutcome::Transpiled(km) = transpiler.to_aice(&tree, kt_src, &TranspileOpts::default()).unwrap() else {
        panic!("expected Transpiled");
    };
    let kt_aice = print_aice(&km);
    let kt_reparsed = parse_aice(&kt_aice).unwrap();
    let kt_to_c = transpiler.to_native(&kt_reparsed, LanguageId::C).unwrap();
    assert!(!kt_to_c.contains("Pkg.Type") && !kt_to_c.contains('<'), "Kotlin->C invalid:\n{kt_to_c}");
    assert!(kt_to_c.contains("Pkg_Type"), "Kotlin->C missing Pkg_Type:\n{kt_to_c}");
    assert_eq!(fw.verify(&kt_to_c, Path::new("kt.c"), LanguageId::C), FirewallVerdict::Valid, "{kt_to_c}");
}

#[test]
fn iter7_rust_non_literal_range_patterns_lower_to_if() {
    let reg = EngineRegistry::default();
    let transpiler = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;

    let kt_until = "\
fun check(x: Int, n: Int): String {
  when (x) {
    in 1 until n - 1 -> return \"a\"
    else -> return \"b\"
  }
}
";
    let kt_expr_bounds = "\
fun checkExpr(x: Int, a: Int, b: Int): Int {
  return when (x) {
    in (a + 1)..(b - 1) -> 1
    in -5..5 -> 2
    else -> 0
  }
}
";
    for (name, kt) in [("until.rs", kt_until), ("expr_rng.rs", kt_expr_bounds)] {
        let tree = reg.adapter(LanguageId::Kotlin).unwrap().parse_cst(kt).unwrap();
        let TranspileOutcome::Transpiled(m) = transpiler.to_aice(&tree, kt, &TranspileOpts::default()).unwrap() else {
            panic!("expected Transpiled");
        };
        let aice = print_aice(&m);
        let reparsed = parse_aice(&aice).unwrap();
        let rs = transpiler.to_native(&reparsed, LanguageId::Rust).unwrap();
        assert_eq!(fw.verify(&rs, Path::new(name), LanguageId::Rust), FirewallVerdict::Valid, "Rust failed for {name}:\n{rs}");
    }

    // Pure literal range stays valid match arm in Rust
    let lit_aice = "module m\npub fn f(x:int) -> int:\n  ret match x:\n    -5..=5 => 1\n    _ => 0\n";
    let rs_lit = transpiler.to_native(&parse_aice(lit_aice).unwrap(), LanguageId::Rust).unwrap();
    assert!(rs_lit.contains("match x"), "Literal range unnecessarily lowered:\n{rs_lit}");
    assert_eq!(fw.verify(&rs_lit, Path::new("lit.rs"), LanguageId::Rust), FirewallVerdict::Valid, "{rs_lit}");
}

#[test]
fn iter7_big_single_line_json_linear_time_and_trailing_comment_preserved() {
    let reg = EngineRegistry::default();
    let transpiler = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;

    // Single-line >50KB JSON (n = 6000 keys, ~81KB)
    let mut big = String::from("{");
    for i in 0..6000 {
        if i > 0 { big.push(','); }
        big.push_str(&format!("\"k_{i}\":{i}"));
    }
    big.push('}');
    assert!(big.len() > 50_000);

    let json_adapter = reg.adapter(LanguageId::Json).unwrap();
    let t0 = Instant::now();
    let tree = json_adapter.parse_cst(&big).unwrap();
    let t_aice_start = Instant::now();
    let TranspileOutcome::Transpiled(m) = transpiler.to_aice(&tree, &big, &TranspileOpts::default()).unwrap() else {
        panic!("expected Transpiled JSON");
    };
    let to_aice_dur = t_aice_start.elapsed();
    let aice = print_aice(&m);
    let reparsed = parse_aice(&aice).unwrap();
    let native = transpiler.to_native(&reparsed, LanguageId::Json).unwrap();
    assert_eq!(fw.verify(&native, Path::new("big.json"), LanguageId::Json), FirewallVerdict::Valid);
    let total_dur = t0.elapsed();
    assert!(to_aice_dur.as_secs_f64() < 1.0, "to_aice took {:?} (expected < 1s)", to_aice_dur);
    assert!(total_dur.as_secs_f64() < 2.0, "total roundtrip took {:?} (expected < 2s)", total_dur);

    // Same-line trailing comments must still be preserved in Trivia
    let ts_src = "function demo() {\n  let x = 1; // doc\n  return x;\n}\n";
    let ts_tree = reg.adapter(LanguageId::TypeScript).unwrap().parse_cst(ts_src).unwrap();
    let TranspileOutcome::Transpiled(ts_m) = transpiler.to_aice(&ts_tree, ts_src, &TranspileOpts::default()).unwrap() else {
        panic!("expected Transpiled TS");
    };
    let AiceItem::Fn(fd) = &ts_m.items[0] else { panic!("expected Fn"); };
    let FnBody::Block(stmts) = &fd.body else { panic!("expected Block"); };
    let Stmt::Let { trivia, .. } = &stmts[0] else { panic!("expected Let, got {:?}", stmts[0]); };
    assert_eq!(trivia.trailing.as_deref(), Some("doc"), "trailing comment lost: {trivia:?}");
}
