use std::path::Path;

use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn roundtrip_dart(name: &str, src: &str) -> (String, String) {
    let reg = EngineRegistry::default();
    let adp = reg.adapter(LanguageId::Dart).unwrap();
    let tr = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;

    let tree = adp.parse_cst(src).unwrap();
    let TranspileOutcome::Transpiled(module) = tr
        .to_aice(&tree, src, &TranspileOpts::default())
        .unwrap_or_else(|e| panic!("{name} to_aice failed: {e}"))
    else {
        panic!("{name} expected Transpiled");
    };
    let aice = print_aice(&module);
    assert!(!aice.contains("catch err:"), "{name} erased catch param:\n{aice}");
    assert!(!aice.contains("\n    pass\n"), "{name} erased body to pass:\n{aice}");

    let reparsed = parse_aice(&aice)
        .unwrap_or_else(|e| panic!("{name} parse_aice failed: {e}\n--- AICE ---\n{aice}"));
    let native = tr.to_native(&reparsed, LanguageId::Dart).unwrap();
    assert_eq!(
        fw.verify(&native, Path::new(name), LanguageId::Dart),
        FirewallVerdict::Valid,
        "{name} native failed syntax firewall:\n{native}"
    );
    (aice, native)
}

#[test]
fn dart_all_try_on_catch_finally_rethrow_forms_roundtrip() {
    let src = r#"int runAll() {
  try { // try hdr
    throw FormatException("bad");
  } on FormatException catch (e, st) { // fmt stack
    log(e, st);
    rethrow;
  } on io.HttpException catch (e) { // http err
    log(e);
    return -1;
  } on StateError { // bare on
    recover();
    return -2;
  } catch (e, st) { // catch pair
    trace(e, st);
    return -3;
  } catch (e) { // plain catch
    fallback(e);
    return -4;
  } finally { // always
    cleanup();
  }
  return 0;
}
"#;
    let (aice, native) = roundtrip_dart("all_forms.dart", src);
    for needle in [
        "try: # try hdr",
        "throw FormatException(\"bad\")",
        "catch (e, st): FormatException: # fmt stack",
        "rethrow",
        "catch e: \"io.HttpException\": # http err",
        "catch (): StateError: # bare on",
        "recover()",
        "catch (e, st): # catch pair",
        "trace(e, st)",
        "catch e: # plain catch",
        "fallback(e)",
        "finally: # always",
        "cleanup()",
    ] {
        assert!(aice.contains(needle), "missing {needle:?} in AICE:\n{aice}");
    }
    for needle in [
        "throw FormatException(\"bad\");",
        "on FormatException catch (e, st) {",
        "rethrow;",
        "on io.HttpException catch (e) {",
        "on StateError {",
        "catch (e, st) {",
        "catch (e) {",
        "finally {",
    ] {
        assert!(native.contains(needle), "missing {needle:?} in native:\n{native}");
    }
}

#[test]
fn dart_4500_deep_try_on_catch_finally_roundtrips_on_2mib_stack() {
    const DEPTH: usize = 4_500;
    let mut src = String::with_capacity(DEPTH * 100);
    src.push_str("int deepTry() {\n");
    for _ in 0..DEPTH {
        src.push_str("  try {\n");
    }
    src.push_str("  work();\n");
    for _ in 0..DEPTH {
        src.push_str("  } on FormatException catch (e, st) {\n    log(e, st);\n    rethrow;\n  } finally {\n    cleanup();\n  }\n");
    }
    src.push_str("  return 0;\n}\n");

    let handle = std::thread::Builder::new()
        .stack_size(2 * 1024 * 1024)
        .spawn(move || {
            let reg = EngineRegistry::default();
            let adp = reg.adapter(LanguageId::Dart).unwrap();
            let tree = adp.parse_cst(&src).expect("parse_cst 4500");
            let tr = DefaultAiceTranspiler;
            let TranspileOutcome::Transpiled(module) = tr
                .to_aice(&tree, &src, &TranspileOpts::default())
                .expect("to_aice 4500")
            else {
                panic!("expected Transpiled");
            };
            let aice = print_aice(&module);
            assert!(aice.contains("catch (e, st): FormatException:"));
            assert!(aice.contains("rethrow"));
            assert!(!aice.contains("catch err:"));
            let reparsed = parse_aice(&aice).expect("parse_aice 4500");
            let native = tr.to_native(&reparsed, LanguageId::Dart).expect("to_native 4500");
            assert!(native.contains("on FormatException catch (e, st)"));
            assert!(native.contains("rethrow;"));
            drop(reparsed);
            drop(module);
        })
        .expect("spawn 2MiB thread");
    handle.join().expect("2MiB deep dart try panicked or overflowed stack");
}
