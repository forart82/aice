use aice_batch_read::execute_batch_read;
use aice_governance::{OutputSurface, PipelineRequest, ReadOp, authorize};

fn read_target(root: &std::path::Path, target: &str) -> String {
    let op = ReadOp {
        targets: vec![target.into()],
        target_paths: Vec::new(),
        outline: false,
        outline_target: false,
        full: false,
        depth: None,
        symbol: None,
        search: None,
        context_lines: None,
        files_only: false,
        compact: true,
        include_types: true,
        include_deps: false,
        include_callers: false,
        max_tokens: None,
        json: false,
        stats: false,
    };
    let gov = authorize(PipelineRequest::new(op.clone(), root.to_path_buf(), OutputSurface::Cli))
        .expect("authorize");
    execute_batch_read(gov.state(), &op).expect("execute_batch_read").emitted_output
}

#[test]
fn dart_intra_try_on_catch_finally_transpiles_cleanly() {
    let root = std::env::temp_dir().join(format!("aice_br_dart_try_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("src")).expect("mkdir");
    std::fs::write(root.join("aice.config.json"), "{\"enabled\": true}\n").expect("cfg");

    std::fs::write(
        root.join("src/tc.dart"),
        "int f() {\n  try {\n    work();\n  } catch (e) {\n    log(e);\n    return -1;\n  } finally {\n    y = 1;\n  }\n  return 0;\n}\n",
    ).expect("write tc.dart");

    std::fs::write(
        root.join("src/dart_try.dart"),
        "int f() {\n  try {\n    work();\n  } on ArgumentError catch (e, st) {\n    log(e, st);\n    return -2;\n  } on FormatException {\n    recover();\n    return -3;\n  } catch (e) {\n    fallback(e);\n    return -4;\n  } finally {\n    y = 1;\n  }\n  return 0;\n}\nint g() {\n  try {\n    work();\n  } on StateError {\n    recover();\n    return -5;\n  } finally {\n    y = 1;\n  }\n  return 0;\n}\n",
    ).expect("write dart_try.dart");

    let tc_catch = read_target(&root, "src/tc.dart:f@catch");
    assert!(tc_catch.contains("catch e:") && tc_catch.contains("log(e)") && tc_catch.contains("ret -1"), "{tc_catch}");
    assert!(!tc_catch.contains("try:") && !tc_catch.contains("pass") && !tc_catch.contains("catch err:"), "{tc_catch}");

    let on_catch_st = read_target(&root, "src/dart_try.dart:f@ArgumentError");
    assert!(on_catch_st.contains("catch (e, st): ArgumentError:") && on_catch_st.contains("log(e, st)") && on_catch_st.contains("ret -2"), "{on_catch_st}");
    assert!(!on_catch_st.contains("try:") && !on_catch_st.contains("pass") && !on_catch_st.contains("catch err:"), "{on_catch_st}");

    let bare_fmt = read_target(&root, "src/dart_try.dart:f@FormatException");
    assert!(bare_fmt.contains("catch (): FormatException:") && bare_fmt.contains("recover()") && bare_fmt.contains("ret -3"), "{bare_fmt}");
    assert!(!bare_fmt.contains("try:") && !bare_fmt.contains("pass") && !bare_fmt.contains("catch err:"), "{bare_fmt}");

    let bare_on = read_target(&root, "src/dart_try.dart:g@StateError");
    assert!(bare_on.contains("catch (): StateError:") && bare_on.contains("recover()") && bare_on.contains("ret -5"), "{bare_on}");
    assert!(!bare_on.contains("try:") && !bare_on.contains("pass") && !bare_on.contains("catch err:"), "{bare_on}");

    let full_try = read_target(&root, "src/dart_try.dart");
    for needle in [
        "catch (e, st): ArgumentError:",
        "catch (): FormatException:",
        "catch e:",
        "catch (): StateError:",
        "recover()",
        "ret -3",
        "fallback(e)",
    ] {
        assert!(full_try.contains(needle), "missing {needle:?} in full:\n{full_try}");
    }
    assert!(!full_try.contains("catch err:") && !full_try.contains("\n    pass\n"), "{full_try}");

    let _ = std::fs::remove_dir_all(&root);
}
