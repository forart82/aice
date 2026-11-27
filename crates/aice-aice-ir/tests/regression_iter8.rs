use std::path::Path;

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
fn iter8_colon_return_type_class_methods_and_map_guards() {
    let src = "\
module m
class C:
  val: int = 0
  get prop() -> int: {
    if true:
      x := 1
      ret x
    ret 0
  }
  get propRec() -> { a: int }: {
    if true:
      x := 1
      ret x
    ret 0
  }
  static get count() -> int: {
    if true:
      x := 1
      ret x
    ret 0
  }
  set prop(v:int) -> void: {
    if v > 0:
      this.val = v
      ret
    this.val = 0
  }
  constructor(v:int) -> void: {
    if v > 0:
      this.val = v
      ret
    this.val = 0
  }
";
    let m = parse_aice(src).unwrap_or_else(|e| panic!("class colon+ret failed: {e}"));
    let AiceItem::Class(cd) = &m.items[0] else { panic!("expected Class"); };
    assert_eq!(cd.methods.len(), 5, "expected 5 methods, got {:?}", cd.methods);
    for meth in &cd.methods {
        let FnBody::Block(stmts) = &meth.body else {
            panic!("method {} expected Block, got {:?}", meth.name, meth.body);
        };
        assert_if_not_escaped(stmts, &meth.name);
    }
    let ts = DefaultAiceTranspiler.to_native(&m, LanguageId::TypeScript).unwrap();
    assert_eq!(DefaultSyntaxFirewall.verify(&ts, Path::new("c.ts"), LanguageId::TypeScript), FirewallVerdict::Valid, "{ts}");

    let map_guard_src = "\
module m
fn check(x:any) -> any:
  rec := {
    a: { b: 1 }
  }
  if x == { a: 1 }: {
    y := 2
    ret y
  }
  ret rec
";
    let mg = parse_aice(map_guard_src).unwrap_or_else(|e| panic!("map guard failed: {e}"));
    let AiceItem::Fn(fd) = &mg.items[0] else { panic!("expected Fn"); };
    let FnBody::Block(stmts) = &fd.body else { panic!("expected Block"); };
    assert_eq!(stmts.len(), 3, "expected 3 stmts, got {stmts:?}");
    assert!(matches!(&stmts[0], Stmt::Let { init: Some(Expr::Record(_)), .. }));
    let Stmt::If { then_body, .. } = &stmts[1] else { panic!("expected Stmt::If"); };
    assert_eq!(then_body.len(), 2, "if x == {{ a: 1 }} escaped: {then_body:?}");
}

#[test]
fn iter8_rust_string_ranges_and_parenthesized_range_bounds() {
    let transpiler = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;

    for (name, pat) in [("excl.rs", "in \"a\"..\"z\""), ("incl.rs", "in \"a\"..=\"z\"")] {
        let aice = format!("module m\npub fn check(s:str) -> int:\n  ret match s:\n    {pat} => 1\n    _ => 0\n");
        let m = parse_aice(&aice).unwrap();
        let rs = transpiler.to_native(&m, LanguageId::Rust).unwrap();
        assert!(!rs.contains("match s {"), "{name} should lower to if, got:\n{rs}");
        assert!(rs.contains("s >= \"a\""), "{name} missing lower comparison:\n{rs}");
        assert_eq!(fw.verify(&rs, Path::new(name), LanguageId::Rust), FirewallVerdict::Valid, "{rs}");
    }

    let kt_prec = "\
fun maskRange(x: Int, a: Int, b: Int): Int {
  return when (x) {
    in (a + 1)..(b - 1) -> 1
    else -> 0
  }
}
";
    let reg = EngineRegistry::default();
    let tree = reg.adapter(LanguageId::Kotlin).unwrap().parse_cst(kt_prec).unwrap();
    let TranspileOutcome::Transpiled(km) = transpiler.to_aice(&tree, kt_prec, &TranspileOpts::default()).unwrap() else {
        panic!("expected Transpiled");
    };
    let reparsed = parse_aice(&print_aice(&km)).unwrap();
    let rs_prec = transpiler.to_native(&reparsed, LanguageId::Rust).unwrap();
    assert!(
        rs_prec.contains("(a + 1)") && rs_prec.contains("(b - 1)"),
        "Rust lost parenthesized range bounds:\n{rs_prec}"
    );
    assert_eq!(fw.verify(&rs_prec, Path::new("prec.rs"), LanguageId::Rust), FirewallVerdict::Valid, "{rs_prec}");

    let aice_bit_rng = "\
module m
pub fn f(x:int, a:int, b:int, ok:bool) -> int:
  ret match x:
    in (a | 1)..(b & 7) => 1
    in (ok ? 1 : 2)..10 => 2
    _ => 0
";
    let m_bit = parse_aice(aice_bit_rng).unwrap();
    let rs_bit = transpiler.to_native(&m_bit, LanguageId::Rust).unwrap();
    assert!(
        rs_bit.contains("x >= (a | 1) && x < (b & 7)")
            && rs_bit.contains("x >= (if ok { 1 } else { 2 })"),
        "Expected parenthesized range bounds in Rust if:\n{rs_bit}"
    );
    assert_eq!(fw.verify(&rs_bit, Path::new("bit.rs"), LanguageId::Rust), FirewallVerdict::Valid, "{rs_bit}");
}

#[test]
fn iter8_c_array_and_reference_wrapper_types() {
    let reg = EngineRegistry::default();
    let transpiler = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;

    // 1. Direct AICE [Pkg::Type] and [int] -> C
    let aice_arr = "\
module m
pub fn f1(p:[Pkg::Type]) -> [Pkg::Type]:
  ret p
pub fn f2(xs:[int]) -> [int]:
  ret xs
";
    let m_arr = parse_aice(aice_arr).unwrap();
    let c_arr = transpiler.to_native(&m_arr, LanguageId::C).unwrap();
    assert!(!c_arr.contains("[]"), "C emitted invalid [] array type:\n{c_arr}");
    assert!(c_arr.contains("Pkg_Type*") && c_arr.contains("int*"), "C missing pointer types:\n{c_arr}");
    assert_eq!(fw.verify(&c_arr, Path::new("arr.c"), LanguageId::C), FirewallVerdict::Valid, "{c_arr}");

    // 2. TypeScript Pkg.Type[] -> C
    let ts_src = "export function f(p: Pkg.Type[], q?: Pkg.Type): Pkg.Type[] { return p; }\n";
    let ts_tree = reg.adapter(LanguageId::TypeScript).unwrap().parse_cst(ts_src).unwrap();
    let TranspileOutcome::Transpiled(ts_m) = transpiler.to_aice(&ts_tree, ts_src, &TranspileOpts::default()).unwrap() else {
        panic!("expected Transpiled TS");
    };
    let ts_reparsed = parse_aice(&print_aice(&ts_m)).unwrap();
    let c_from_ts = transpiler.to_native(&ts_reparsed, LanguageId::C).unwrap();
    assert!(!c_from_ts.contains("Pkg.Type") && !c_from_ts.contains("[]"), "TS->C invalid:\n{c_from_ts}");
    assert!(c_from_ts.contains("Pkg_Type*"), "TS->C missing Pkg_Type*:\n{c_from_ts}");
    assert_eq!(fw.verify(&c_from_ts, Path::new("ts_to_c.c"), LanguageId::C), FirewallVerdict::Valid, "{c_from_ts}");

    // 3. Rust &Pkg::Type, &[Pkg::Type], &mut Pkg::Type, &str, Option<Pkg::Type> -> C
    let rs_src = "\
pub fn f(p: &Pkg::Type, a: &[Pkg::Type]) -> Option<Pkg::Type> { None }
pub fn g(s: &str, m: &mut Pkg::Type, b: &mut [i32]) -> Vec<Pkg::Type> { Vec::new() }
";
    let rs_tree = reg.adapter(LanguageId::Rust).unwrap().parse_cst(rs_src).unwrap();
    let TranspileOutcome::Transpiled(rs_m) = transpiler.to_aice(&rs_tree, rs_src, &TranspileOpts::default()).unwrap() else {
        panic!("expected Transpiled Rust");
    };
    let c_direct = transpiler.to_native(&rs_m, LanguageId::C).unwrap();
    assert_eq!(fw.verify(&c_direct, Path::new("rs_direct.c"), LanguageId::C), FirewallVerdict::Valid, "{c_direct}");

    let rs_reparsed = parse_aice(&print_aice(&rs_m)).unwrap();
    let c_from_rs = transpiler.to_native(&rs_reparsed, LanguageId::C).unwrap();
    assert!(!c_from_rs.contains('&') && !c_from_rs.contains("::") && !c_from_rs.contains('[') && !c_from_rs.contains("i32"), "Rust->C leaked wrapper:\n{c_from_rs}");
    assert!(c_from_rs.contains("const Pkg_Type*") && c_from_rs.contains("const char*") && c_from_rs.contains("int* b"), "Rust->C missing C types:\n{c_from_rs}");
    assert_eq!(fw.verify(&c_from_rs, Path::new("rs_to_c.c"), LanguageId::C), FirewallVerdict::Valid, "{c_from_rs}");
}
