use std::path::Path;

use aice_aice_ir::ir::{AiceItem, FnBody, Stmt};
use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn roundtrip(lang: LanguageId, vpath: &str, src: &str) -> (String, String) {
    let reg = EngineRegistry::default();
    let transpiler = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;
    let tree = reg.adapter(lang).unwrap().parse_cst(src).unwrap_or_else(|e| panic!("CST {lang:?}: {e:?}"));
    let TranspileOutcome::Transpiled(m) = transpiler.to_aice(&tree, src, &TranspileOpts::default()).unwrap() else {
        panic!("expected Transpiled for {lang:?}");
    };
    let aice = print_aice(&m);
    let reparsed = parse_aice(&aice).unwrap_or_else(|e| panic!("parse_aice {lang:?}: {e}\n--- AICE ---\n{aice}"));
    let native = transpiler.to_native(&reparsed, lang).unwrap();
    assert_eq!(
        fw.verify(&native, Path::new(vpath), lang),
        FirewallVerdict::Valid,
        "Firewall rejected {lang:?}:\n--- NATIVE ---\n{native}\n--- AICE ---\n{aice}"
    );
    (aice, native)
}

#[test]
fn defect1_twig_utf8_valid_and_malformed_zero_panics() {
    let (_, nat1) = roundtrip(LanguageId::Twig, "cafe.twig", "<div>Café</div>");
    assert!(nat1.contains("Café"), "Twig lost Café:\n{nat1}");

    let (aice2, nat2) = roundtrip(LanguageId::Twig, "crab.twig", "<div>Café 🦀</div>");
    assert!(aice2.contains("Café 🦀") && nat2.contains("Café 🦀"), "Twig lost Café 🦀:\n{aice2}\n{nat2}");

    let reg = EngineRegistry::default();
    let transpiler = DefaultAiceTranspiler;
    let adapter = reg.adapter(LanguageId::Twig).unwrap();
    for bad in [
        "{ [ ( <<< >>> \"unclosed\n\0🦀 fn (((",
        "<!-- Café 🦀",
        "{% 🦀",
        "{{ 🦀",
    ] {
        let tree = adapter.parse_cst(bad).expect("CST");
        let _ = transpiler.to_aice(&tree, bad, &TranspileOpts::default());
    }
}

#[test]
fn defect2_sql_block_comments_preserve_utf8() {
    let sql = "SELECT 'Café 🦀'; /* Café 🦀 */";
    for (lang, path) in [(LanguageId::PostgreSql, "utf8.pg.sql"), (LanguageId::MySql, "utf8.my.sql")] {
        let (aice, nat) = roundtrip(lang, path, sql);
        assert!(aice.contains("Café 🦀"), "{lang:?} AICE corrupted UTF-8:\n{aice}");
        assert!(nat.contains("Café 🦀"), "{lang:?} native corrupted UTF-8:\n{nat}");
    }
}

fn fn_body_stmts(aice_src: &str) -> Vec<Stmt> {
    let m = parse_aice(aice_src).unwrap_or_else(|e| panic!("parse failed: {e}\n{aice_src}"));
    let AiceItem::Fn(fd) = &m.items[0] else { panic!("expected Fn"); };
    let FnBody::Block(stmts) = &fd.body else { panic!("expected Block"); };
    stmts.clone()
}

#[test]
fn defect3_lexer_stmt_block_classification_edge_cases() {
    let transpiler = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;

    // 3a: fn f(ok:bool) -> int: { ... }
    let case_a = "module m\nfn f(ok:bool) -> int: {\n  if ok:\n    x := 1\n    ret x\n  ret 0\n}\n";
    let stmts_a = fn_body_stmts(case_a);
    assert_eq!(stmts_a.len(), 2, "expected 2 stmts in fn(): {{ ... }}, got {stmts_a:?}");
    let Stmt::If { then_body, .. } = &stmts_a[0] else { panic!("expected If"); };
    assert_eq!(then_body.len(), 2, "expected 2 stmts in then_body, got {then_body:?}");
    let mod_a = parse_aice(case_a).unwrap();
    let py_a = transpiler.to_native(&mod_a, LanguageId::Python).unwrap();
    assert!(py_a.contains("        return x"), "Python return x escaped if:\n{py_a}");
    assert_eq!(fw.verify(&py_a, Path::new("a.py"), LanguageId::Python), FirewallVerdict::Valid, "{py_a}");

    // 3b: fn f[T](ok:bool) -> int { ... }
    let case_b = "module m\nfn f[T](ok:bool) -> int {\n  if ok:\n    x := 1\n    ret x\n  ret 0\n}\n";
    let stmts_b = fn_body_stmts(case_b);
    assert_eq!(stmts_b.len(), 2, "expected 2 stmts in fn[T]() {{ ... }}, got {stmts_b:?}");
    let Stmt::If { then_body, .. } = &stmts_b[0] else { panic!("expected If"); };
    assert_eq!(then_body.len(), 2, "expected 2 stmts in then_body, got {then_body:?}");
    let mod_b = parse_aice(case_b).unwrap();
    let rs_b = transpiler.to_native(&mod_b, LanguageId::Rust).unwrap();
    assert_eq!(fw.verify(&rs_b, Path::new("b.rs"), LanguageId::Rust), FirewallVerdict::Valid, "{rs_b}");

    // 3c: if x == { a: 1 }: { ... } (both nested control flow and adjacent expression statement)
    let case_c1 = "module m\nfn f(x:any, ok:bool) -> int:\n  if x == { a: 1 }: {\n    if ok:\n      y := 1\n      ret y\n    ret 0\n  }\n  ret 1\n";
    let stmts_c1 = fn_body_stmts(case_c1);
    assert_eq!(stmts_c1.len(), 2);
    let Stmt::If { then_body: outer_then, .. } = &stmts_c1[0] else { panic!("expected outer If"); };
    assert_eq!(outer_then.len(), 2, "outer_then corrupted: {outer_then:?}");
    let Stmt::If { then_body: inner_then, .. } = &outer_then[0] else { panic!("expected inner If"); };
    assert_eq!(inner_then.len(), 2, "inner_then corrupted: {inner_then:?}");

    let case_c2 = "module m\nfn f(x:any) -> int:\n  if x == { a: 1 }: {\n    y := g\n    (1 + 2)\n  }\n  ret 0\n";
    let stmts_c2 = fn_body_stmts(case_c2);
    let Stmt::If { then_body: then_c2, .. } = &stmts_c2[0] else { panic!("expected If"); };
    assert_eq!(then_c2.len(), 2, "y := g and (1 + 2) merged into call: {then_c2:?}");
    let ts_c1 = transpiler.to_native(&parse_aice(case_c1).unwrap(), LanguageId::TypeScript).unwrap();
    assert_eq!(fw.verify(&ts_c1, Path::new("c1.ts"), LanguageId::TypeScript), FirewallVerdict::Valid, "{ts_c1}");
}

#[test]
fn defect4_and_5_go_conditional_c_php_generics_and_14_target_kt_adv() {
    let transpiler = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;

    // Defect 4: direct AICE ternary -> Go
    let aice_tern = "module m\npub fn f(ok:bool) -> str:\n  x := foo(ok ? 1 : 2)\n  ret ok ? \"ok\" : \"wait\"\n";
    let m_tern = parse_aice(aice_tern).unwrap();
    let go_tern = transpiler.to_native(&m_tern, LanguageId::Go).unwrap();
    assert!(!go_tern.contains("? \"ok\""), "Go emitted invalid ternary:\n{go_tern}");
    assert_eq!(fw.verify(&go_tern, Path::new("tern.go"), LanguageId::Go), FirewallVerdict::Valid, "{go_tern}");

    // Defect 5: generic Named types in C and PHP
    let aice_gen = "module m\npub fn check(s:Set[int], xs:List[str], mp:Map[str, int]) -> Set[int]:\n  ret s\n";
    let m_gen = parse_aice(aice_gen).unwrap();
    for (lang, path) in [(LanguageId::C, "gen.c"), (LanguageId::Php, "gen.php")] {
        let nat = transpiler.to_native(&m_gen, lang).unwrap();
        assert!(!nat.contains("Set<") && !nat.contains("List<") && !nat.contains("Map<"), "{lang:?} emitted generic <>:\n{nat}");
        assert_eq!(fw.verify(&nat, Path::new(path), lang), FirewallVerdict::Valid, "{nat}");
    }

    // kt_adv cross-compiled to all 14 code targets
    let kt_adv = "fun routeAdv(code: Int, ok: Boolean, validSet: Set<Int>): String {\n  when (code) {\n    !in 1 until 10 -> println(\"a\")\n    in validSet -> println(\"b\")\n    else -> println(\"c\")\n  }\n  return when (code) {\n    200, 201 -> if (ok) \"ok\" else \"wait\"\n    else -> \"err\"\n  }\n}\n";
    let (aice_kt, _) = roundtrip(LanguageId::Kotlin, "adv.kt", kt_adv);
    let reparsed = parse_aice(&aice_kt).unwrap();
    let targets = [
        (LanguageId::Rust, "adv.rs"),
        (LanguageId::TypeScript, "adv.ts"),
        (LanguageId::Tsx, "adv.tsx"),
        (LanguageId::JavaScript, "adv.js"),
        (LanguageId::Python, "adv.py"),
        (LanguageId::Go, "adv.go"),
        (LanguageId::C, "adv.c"),
        (LanguageId::Cpp, "adv.cpp"),
        (LanguageId::CSharp, "Adv.cs"),
        (LanguageId::Java, "Adv.java"),
        (LanguageId::Kotlin, "adv2.kt"),
        (LanguageId::Dart, "adv.dart"),
        (LanguageId::Php, "adv.php"),
        (LanguageId::Ruby, "adv.rb"),
    ];
    for (lang, path) in targets {
        let nat = transpiler.to_native(&reparsed, lang).unwrap();
        assert_eq!(fw.verify(&nat, Path::new(path), lang), FirewallVerdict::Valid, "kt_adv failed {lang:?}:\n{nat}");
    }
}

#[test]
fn polish_dart_typed_map_ruby_when_indent_and_kotlin_complex_range() {
    let dart_map = "class Store {\n  void init() {\n    var emptyMap = const <String, int>{};\n  }\n}\n";
    let (aice_d, nat_d) = roundtrip(LanguageId::Dart, "store.dart", dart_map);
    assert!(!aice_d.contains("<String, int>"), "Dart typed map leaked generics:\n{aice_d}");
    assert!(nat_d.contains("emptyMap = {}"), "Dart empty map lost:\n{nat_d}");

    let rb_when_multi = "module rb\npub fn run(x:int, items:[int]):\n  match x:\n    1 => items.each(fn(it:int) {\n      puts(it)\n      y := it + 1\n    })\n    _ => pass\n";
    let m_rb = parse_aice(rb_when_multi).unwrap();
    let nat_rb = DefaultAiceTranspiler.to_native(&m_rb, LanguageId::Ruby).unwrap();
    assert!(nat_rb.contains("      puts(it)"), "Ruby when single-expr multi-line missed indentation:\n{nat_rb}");
    assert_eq!(DefaultSyntaxFirewall.verify(&nat_rb, Path::new("w.rb"), LanguageId::Ruby), FirewallVerdict::Valid, "{nat_rb}");

    let kt_rng = "fun check(x: Int, n: Int): String {\n  return when (x) {\n    in 1 until n - 1 -> \"in\"\n    else -> \"out\"\n  }\n}\n";
    let (_, nat_kt) = roundtrip(LanguageId::Kotlin, "rng.kt", kt_rng);
    assert!(nat_kt.contains("n - 1"), "Kotlin complex range bound lost:\n{nat_kt}");
}
