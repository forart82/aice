use std::fs;
use std::path::Path;

use aice_aice_ir::lexer::lex;
use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::{print_aice, print_aice_with_opts};
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::EngineRegistry;
use aice_lang_registry::{AdapterLookup, LanguageId};

#[test]
fn read_02_preserves_private_visibility_and_number_type() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/golden/fixtures/src/math.ts");
    let src = fs::read_to_string(path).expect("read math.ts");
    let reg = EngineRegistry::default();
    let tree = reg.adapter(LanguageId::TypeScript).unwrap().parse_cst(&src).unwrap();
    let transpiler = DefaultAiceTranspiler;
    let TranspileOutcome::Transpiled(module) = transpiler
        .to_aice(&tree, &src, &TranspileOpts::default())
        .unwrap()
    else {
        panic!("expected Transpiled");
    };
    let aice = print_aice(&module);
    assert!(aice.contains("priv offset:num"), "expected priv offset:num in:\n{aice}");
    assert!(aice.contains("value:num"), "expected value:num in:\n{aice}");
    assert!(!aice.contains("value:int"), "must not collapse TS number to int:\n{aice}");

    let reparsed = parse_aice(&aice).expect("reparse math.ts AICE");
    let native = transpiler.to_native(&reparsed, LanguageId::TypeScript).unwrap();
    assert!(native.contains("private offset: number"), "lost private in native:\n{native}");
}

#[test]
fn transpile_opts_control_types_docs_and_compactness() {
    let src = "// Leading doc\nexport function compute(x: number): number {\n  return x + 1;\n}\n";
    let reg = EngineRegistry::default();
    let tree = reg.adapter(LanguageId::TypeScript).unwrap().parse_cst(src).unwrap();
    let transpiler = DefaultAiceTranspiler;

    let TranspileOutcome::Transpiled(m_docs) = transpiler
        .to_aice(&tree, src, &TranspileOpts { compact: true, include_types: true, preserve_docs: true })
        .unwrap()
    else { panic!() };
    let out_full = print_aice_with_opts(&m_docs, &TranspileOpts { compact: true, include_types: true, preserve_docs: true });
    assert!(out_full.contains("# Leading doc"), "{out_full}");
    assert!(out_full.contains("compute(x:num) -> num"), "{out_full}");

    let out_notypes = print_aice_with_opts(&m_docs, &TranspileOpts { compact: true, include_types: false, preserve_docs: false });
    assert!(!out_notypes.contains("# Leading doc"), "{out_notypes}");
    assert!(!out_notypes.contains(":num"), "{out_notypes}");
    assert!(!out_notypes.contains("-> num"), "{out_notypes}");

    let out_expanded = print_aice_with_opts(&m_docs, &TranspileOpts { compact: false, include_types: true, preserve_docs: true });
    assert!(out_expanded.contains("x: num"), "{out_expanded}");
}

#[test]
fn control_flow_and_large_50kb_input_non_bypass() {
    let cf = r#"module cf
pub fn classify(n:int) -> str:
  if n < 0:
    ret "neg"
  elif n == 0:
    ret "zero"
  else:
    ret "pos"
pub fn loops(items:[int]) -> int:
  acc ::= 0
  for x in items:
    acc += x
  while acc > 100:
    acc -= 10
  try:
    if acc == 0:
      throw "empty"
  catch e:
    ret -1
  finally:
    pass
  ret acc
"#;
    let parsed = parse_aice(cf).expect("parse cf");
    let printed = print_aice(&parsed);
    let reparsed = parse_aice(&printed).expect("reparse cf");
    assert_eq!(parsed.items.len(), reparsed.items.len());

    // B-R3: > 50 KB TS file must still transpile cleanly without raw fallback
    let mut big = String::with_capacity(70_000);
    for i in 0..1000 {
        big.push_str(&format!("export function f_{i}(x: number): number {{ return x + {i}; }}\n"));
    }
    assert!(big.len() > 50 * 1024);
    let reg = EngineRegistry::default();
    let tree = reg.adapter(LanguageId::TypeScript).unwrap().parse_cst(&big).unwrap();
    let TranspileOutcome::Transpiled(m) = DefaultAiceTranspiler.to_aice(&tree, &big, &TranspileOpts::default()).unwrap() else {
        panic!("expected Transpiled for >50KB");
    };
    assert_eq!(m.items.len(), 1000);
    assert!(m.raw_fallback.is_empty());
}

#[test]
fn lexer_reports_precise_error_spans() {
    let bad_indent = "fn f():\n    x := 1\n  y := 2\n";
    let err = lex(bad_indent).expect_err("expected indentation error");
    assert_eq!(err.span.map(|s| s.line), Some(3));

    let unclosed_str = "x := \"hello\n";
    let err2 = lex(unclosed_str).expect_err("expected unclosed string");
    assert_eq!(err2.span.map(|s| s.line), Some(1));
}

#[test]
fn dart_try_on_catch_finally_roundtrip() {
    use aice_ast_engine::DefaultSyntaxFirewall;
    use aice_lang_registry::{FirewallVerdict, SyntaxFirewall};

    let reg = EngineRegistry::default();
    let adp = reg.adapter(LanguageId::Dart).unwrap();
    let tr = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;

    let cases = [
        (
            "tc.dart",
            "int f() {\n  try {\n    work();\n  } catch (e) {\n    log(e);\n    return -1;\n  } finally {\n    y = 1;\n  }\n  return 0;\n}\n",
            &["try:", "catch e:", "log(e)", "ret -1", "finally:", "y = 1", "ret 0"][..],
            &["catch err:", "pass"][..],
            &["log(e)", "y = 1"][..],
        ),
        (
            "dart_try.dart",
            "int f() {\n  try {\n    work();\n  } on FormatException catch (e, st) {\n    log(e, st);\n    return -1;\n  } catch (e) {\n    fallback(e);\n    return -2;\n  } finally {\n    cleanup();\n  }\n  return 0;\n}\n",
            &["try:", "catch (e, st): FormatException:", "log(e, st)", "ret -1", "catch e:", "fallback(e)", "ret -2", "finally:", "cleanup()", "ret 0"][..],
            &["catch err:", "pass"][..],
            &["on FormatException catch (e, st)", "fallback(e)", "cleanup()"][..],
        ),
        (
            "dart_on_only.dart",
            "int f() {\n  try {\n    work();\n  } on FormatException {\n    log(\"fmt\");\n    return -1;\n  } finally {\n    cleanup();\n  }\n  return 0;\n}\n",
            &["try:", "catch (): FormatException:", "log(\"fmt\")", "ret -1", "finally:", "cleanup()", "ret 0"][..],
            &["catch err:", "pass"][..],
            &["on FormatException {", "log(\"fmt\")", "cleanup()"][..],
        ),
    ];

    for (name, src, must_aice, forbid_aice, must_native) in cases {
        let tree = adp.parse_cst(src).unwrap();
        let TranspileOutcome::Transpiled(m) = tr.to_aice(&tree, src, &TranspileOpts::default()).unwrap() else {
            panic!("expected Transpiled for {name}");
        };
        let aice = print_aice(&m);
        for needle in must_aice {
            assert!(aice.contains(needle), "{name} missing {needle:?} in AICE:\n{aice}");
        }
        for bad in forbid_aice {
            assert!(!aice.contains(bad), "{name} unexpected {bad:?} in AICE:\n{aice}");
        }
        let reparsed = parse_aice(&aice).unwrap_or_else(|e| panic!("{name} parse_aice failed: {e}\n{aice}"));
        let native = tr.to_native(&reparsed, LanguageId::Dart).unwrap();
        assert_eq!(fw.verify(&native, Path::new(name), LanguageId::Dart), FirewallVerdict::Valid, "{name} invalid native:\n{native}");
        for needle in must_native {
            assert!(native.contains(needle), "{name} missing {needle:?} in native:\n{native}");
        }
    }
}
