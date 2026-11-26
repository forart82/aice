use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use aice_governance::{
    GovernanceError, OutputSurface, PipelineRequest, WriteOp, authorize,
};

static COUNTER: AtomicU64 = AtomicU64::new(1);

fn temp_ws(label: &str) -> PathBuf {
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "aice_gov_hd_{label}_{}_{seq}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src")).unwrap();
    fs::write(dir.join("aice.config.json"), "{\"enabled\": true}\n").unwrap();
    fs::write(dir.join("src/a.rs"), "pub fn a() {}\n").unwrap();
    fs::write(dir.join("src/b.rs"), "pub fn b() {}\n").unwrap();
    fs::write(dir.join("src/doc.md"), "# Doc\n").unwrap();
    fs::write(dir.join("src/app.py"), "def run():\n    pass\n").unwrap();
    dir
}

fn write_op(path: Option<&str>, code: Option<&str>, batch: Option<&str>) -> WriteOp {
    WriteOp {
        path: path.map(PathBuf::from),
        symbol: None,
        code: code.map(str::to_string),
        template: None,
        body: None,
        from_file: None,
        from_stdin: false,
        delete: None,
        insert_after: None,
        insert_before: None,
        edits: None,
        batch: batch.map(str::to_string),
        create: false,
        overwrite: false,
        force: false,
        in_place: false,
        dry_run: true,
        diff: false,
        json: false,
        preserve_docs: true,
        target_paths: vec![],
    }
}

#[test]
fn heredoc_ignores_md_fences_hunks_triple_quotes_and_indented_samples() {
    let dir = temp_ws("ignore_guards");
    let stream = concat!(
        "=== src/doc.md ===\n",
        "```markdown\n",
        "=== /etc/shadow ===\n",
        "```\n",
        "~~~\n",
        "=== /etc/passwd ===\n",
        "~~~\n",
        "=== src/a.rs ===\n",
        "<<<\n",
        "=== /etc/shadow ===\n",
        "===\n",
        "pub fn a() {}\n",
        ">>>\n",
        "  === /etc/indented_example ===\n",
        "=======\n",
        "=== src/app.py:run ===\n",
        "def run():\n",
        "    \"\"\"\n",
        "=== /etc/shadow ===\n",
        "    \"\"\"\n",
        "    '''\n",
        "=== /etc/passwd ===\n",
        "    '''\n",
        "    pass\n",
    );
    let gov = authorize(PipelineRequest::new(
        write_op(None, None, Some(stream)),
        dir.clone(),
        OutputSurface::Cli,
    ))
    .expect("fences/hunks/triple-quotes/indented examples must not fail path check");
    assert_eq!(gov.state().authorized_paths().len(), 3);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn heredoc_with_default_path_authorizes_other_files_and_skips_relative_selectors() {
    let dir = temp_ws("default_path_multi");
    let code = concat!(
        "=== :a ===\n",
        "pub fn a() {}\n",
        "=== #a @replace-docs ===\n",
        "pub fn a() {}\n",
        "=== src/b.rs:b --insert-after a ===\n",
        "pub fn c() {}\n",
    );
    let gov = authorize(PipelineRequest::new(
        write_op(Some("src/a.rs"), Some(code), None),
        dir.clone(),
        OutputSurface::Cli,
    ))
    .expect("default file + relative selectors + second file should authorize");
    assert_eq!(gov.state().authorized_paths().len(), 2);

    let bad = "=== :a ===\npub fn a() {}\n=== /etc/shadow ===\nevil\n";
    let err = authorize(PipelineRequest::new(
        write_op(Some("src/a.rs"), Some(bad), None),
        dir.clone(),
        OutputSurface::Cli,
    ))
    .unwrap_err();
    assert!(matches!(err, GovernanceError::PathOutsideAllowedRoots(_)));

    let bad_rel = "=== :/etc/shadow ===\nevil\n";
    let err2 = authorize(PipelineRequest::new(
        write_op(Some("src/a.rs"), Some(bad_rel), None),
        dir.clone(),
        OutputSurface::Cli,
    ))
    .unwrap_err();
    assert!(matches!(err2, GovernanceError::PathOutsideAllowedRoots(_)));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn heredoc_strips_all_modifiers_and_catches_unindented_escapes() {
    let dir = temp_ws("modifiers");
    let stream = concat!(
        "=== src/a.rs:a:delete ===\n",
        "=== src/a.rs:a @replace-docs ===\npub fn a() {}\n",
        "=== src/a.rs:a @strip-docs ===\npub fn a() {}\n",
        "=== src/a.rs:a @drop-docs ===\npub fn a() {}\n",
        "=== src/a.rs:b @clone(a) ===\n",
        "=== src/a.rs:c (clone a) ===\n",
        "=== src/a.rs:c --insert-after a ===\npub fn c() {}\n",
        "=== src/b.rs --insert-before=\"b\" ===\npub fn pre() {}\n",
    );
    let gov = authorize(PipelineRequest::new(
        write_op(None, None, Some(stream)),
        dir.clone(),
        OutputSurface::Cli,
    ))
    .expect("modifiers should strip cleanly to src/a.rs and src/b.rs");
    assert_eq!(gov.state().authorized_paths().len(), 2);

    let escape = "=== src/a.rs ===\npub fn ok() {}\n===/etc/shadow===\nevil\n";
    let err = authorize(PipelineRequest::new(
        write_op(None, None, Some(escape)),
        dir.clone(),
        OutputSurface::Cli,
    ))
    .unwrap_err();
    assert!(matches!(err, GovernanceError::PathOutsideAllowedRoots(_)));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn inline_code_with_path_ignores_fenced_and_triple_quoted_samples_and_rust_raw_strings() {
    let dir = temp_ws("inline_c_and_rust_raw");
    let md_plain = "# Updated\n```\n=== /etc/passwd ===\n```\n";
    authorize(PipelineRequest::new(
        write_op(Some("src/doc.md"), Some(md_plain), None),
        dir.clone(),
        OutputSurface::Cli,
    ))
    .expect("plain markdown -c with fenced === must not fail governance");

    let md_heredoc = "=== :create ===\n# Updated\n```\n=== /etc/passwd ===\n```\n";
    authorize(PipelineRequest::new(
        write_op(Some("src/doc.md"), Some(md_heredoc), None),
        dir.clone(),
        OutputSurface::Cli,
    ))
    .expect("heredoc on doc.md seeds md ext and ignores fenced ===");

    let py_plain = "def run():\n    \"\"\"\n=== /etc/passwd ===\n    \"\"\"\n    pass\n";
    authorize(PipelineRequest::new(
        write_op(Some("src/app.py"), Some(py_plain), None),
        dir.clone(),
        OutputSurface::Cli,
    ))
    .expect("plain python -c with triple-quoted === must not fail governance");

    let rs_raw = concat!(
        "=== src/a.rs:a ===\n",
        "pub fn a() -> &'static str {\n",
        "    let c = '\"';\n",
        "    let _ = c;\n",
        "    r#\"\n=== /etc/passwd ===\n\"#\n",
        "}\n",
        "=== src/b.rs:b ===\n",
        "pub fn b() -> &'static [u8] {\n",
        "    br##\"\n=== /etc/shadow ===\n\"##\n",
        "}\n",
    );
    let gov = authorize(PipelineRequest::new(
        write_op(None, None, Some(rs_raw)),
        dir.clone(),
        OutputSurface::Cli,
    ))
    .expect("Rust raw strings must not leak /etc/passwd or /etc/shadow");
    assert_eq!(gov.state().authorized_paths().len(), 2);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn heredoc_guards_md_closed_headings_multiline_block_comments_and_ts_templates() {
    let dir = temp_ws("md_bc_tpl");
    fs::write(dir.join("src/a.ts"), "export const A = 1;\n").unwrap();
    fs::write(dir.join("notes.txt"), "init\n").unwrap();

    let stream = concat!(
        "=== src/doc.md ===\n",
        "# Title\n\n",
        "=== Section Inside Markdown ===\n",
        "Body text.\n",
        "=== notes.txt ===\n",
        "=== Section Inside Text ===\n",
        "Line.\n",
        "=== src/a.rs ===\n",
        "/*\n=== /etc/passwd ===\n*/\n",
        "pub fn a() -> i32 { 1 }\n",
        "=== src/a.ts ===\n",
        "const s = `\n=== /etc/shadow ===\n`;\n",
        "/*\n=== /etc/hosts ===\n*/\n",
        "export const A = 2;\n",
    );
    let gov = authorize(PipelineRequest::new(
        write_op(None, None, Some(stream)),
        dir.clone(),
        OutputSurface::Cli,
    ))
    .expect("md closed heading, multiline /* */, and TS template must not spoof targets");
    assert_eq!(gov.state().authorized_paths().len(), 4);

    // Direct `-c` on .md starting with a closed heading stays plain markdown content
    authorize(PipelineRequest::new(
        write_op(Some("src/doc.md"), Some("=== Section Inside Markdown ===\nBody\n"), None),
        dir.clone(),
        OutputSurface::Cli,
    ))
    .expect("direct -c on .md with closed heading must not treat heading as file");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn heredoc_java_cs_kt_block_comments_precede_triple_quotes_and_text_blocks_suppress_headers() {
    let dir = temp_ws("java_bc_tq");
    fs::write(dir.join("A.java"), "public class A {}\n").unwrap();
    fs::write(dir.join("B.java"), "public class B {}\n").unwrap();
    fs::write(dir.join("C.cs"), "public class C {}\n").unwrap();
    fs::write(dir.join("D.kt"), "class D {}\n").unwrap();

    let stream = concat!(
        "=== A.java ===\n",
        "public class A {\n",
        "  /* note about \"\"\" text blocks */\n",
        "  /*\n\"\"\"\n*/\n",
        "  // \"\"\"\n",
        "  String s = \"\"\"\n",
        "=== /etc/shadow ===\n",
        "\"\"\";\n",
        "  public int ok() { return 1; }\n",
        "}\n",
        "=== B.java ===\n",
        "public class B {\n  public int ok2() { return 2; }\n}\n",
        "=== C.cs ===\n",
        "public class C {\n  /* \"\"\" */\n  string s = \"\"\"\n=== /etc/passwd ===\n\"\"\";\n}\n",
        "=== D.kt ===\n",
        "class D {\n  /*\n\"\"\"\n*/\n  val s = \"\"\"\n=== /etc/hosts ===\n\"\"\"\n}\n",
    );
    let gov = authorize(PipelineRequest::new(
        write_op(None, None, Some(stream)),
        dir.clone(),
        OutputSurface::Cli,
    ))
    .expect("/* \"\"\" */ and // \"\"\" must not swallow next header; real \"\"\" must suppress fake header");
    assert_eq!(gov.state().authorized_paths().len(), 4);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn extensionless_makefile_odd_triple_quotes_do_not_swallow_while_python_shebang_protects() {
    let dir = temp_ws("extless_shebang");
    let mk_stream = concat!(
        "=== Makefile:create ===\n",
        "all:\n",
        "\techo '''hello\n",
        "=== after_mk.txt:create ===\n",
        "hello world\n",
    );
    let gov_mk = authorize(PipelineRequest::new(
        write_op(None, None, Some(mk_stream)),
        dir.clone(),
        OutputSurface::Cli,
    ))
    .expect("Makefile odd ''' must not swallow after_mk.txt");
    assert_eq!(gov_mk.state().authorized_paths().len(), 2);

    let py_shebang = concat!(
        "=== bin/tool:create ===\n",
        "#!/usr/bin/env python3\n",
        "DOC = '''\n",
        "=== /etc/passwd ===\n",
        "'''\n",
    );
    let gov_py = authorize(PipelineRequest::new(
        write_op(None, None, Some(py_shebang)),
        dir.clone(),
        OutputSurface::Cli,
    ))
    .expect("extensionless Python shebang script must still guard triple quotes");
    assert_eq!(gov_py.state().authorized_paths().len(), 1);

    let direct_py = "#!/usr/bin/env python3\nDOC = '''\n=== /etc/passwd ===\n'''\n";
    fs::create_dir_all(dir.join("bin")).unwrap();
    fs::write(dir.join("bin/direct_tool"), "#!/usr/bin/env python3\n").unwrap();
    authorize(PipelineRequest::new(
        write_op(Some("bin/direct_tool"), Some(direct_py), None),
        dir.clone(),
        OutputSurface::Cli,
    ))
    .expect("direct -c on extensionless Python shebang tool must guard triple quotes");

    let _ = fs::remove_dir_all(&dir);
}
