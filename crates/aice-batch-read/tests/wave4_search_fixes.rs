use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use aice_batch_read::discovery::format_find_pack;
use aice_batch_read::regex_compile::compile_search_pattern;
use aice_batch_read::search::execute_search;
use aice_batch_read::{BatchReadPack, execute_batch_read};
use aice_find_engine::{FindWalkOpts, walk_governed_with_opts};
use aice_governance::{FindOp, OutputSurface, PipelineRequest, ReadOp, SearchOp, authorize};

static NEXT_ID: AtomicUsize = AtomicUsize::new(1);

struct TempWs {
    root: PathBuf,
}

impl TempWs {
    fn new(tag: &str) -> Self {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "aice_w4_search_{tag}_{}_{}",
            std::process::id(),
            id
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create temp dir");
        fs::write(root.join("aice.config.json"), "{\"enabled\": true}\n").expect("write cfg");
        Self { root }
    }

    fn write(&self, rel: &str, content: &str) {
        let p = self.root.join(rel);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).expect("mkdir parent");
        }
        fs::write(p, content).expect("write file");
    }

    fn run_read(&self, op: ReadOp) -> BatchReadPack {
        let gov = authorize(PipelineRequest::new(
            op.clone(),
            self.root.clone(),
            OutputSurface::Cli,
        ))
        .expect("authorize read");
        execute_batch_read(gov.state(), &op).expect("execute_batch_read")
    }

    fn run_search(&self, op: SearchOp) -> BatchReadPack {
        let gov = authorize(PipelineRequest::new(
            op.clone(),
            self.root.clone(),
            OutputSurface::Cli,
        ))
        .expect("authorize search");
        execute_search(gov.state(), &op).expect("execute_search")
    }

    fn run_find(&self, op: FindOp) -> BatchReadPack {
        let gov = authorize(PipelineRequest::new(
            op.clone(),
            self.root.clone(),
            OutputSurface::Cli,
        ))
        .expect("authorize find");
        let opts = FindWalkOpts {
            max_depth: op.depth,
            include_hidden: op.full,
            explicit_targets: op.targets.clone(),
            walk_project_root_if_untargeted: op.targets.is_empty(),
            ..FindWalkOpts::default()
        };
        let walk = walk_governed_with_opts(gov.state(), &opts).expect("walk find");
        format_find_pack(gov.state(), walk, &op)
    }
}

impl Drop for TempWs {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn read_op(targets: Vec<&str>) -> ReadOp {
    ReadOp {
        targets: targets.into_iter().map(String::from).collect(),
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
    }
}

fn search_op(pattern: &str, targets: Vec<&str>, context_lines: Option<usize>) -> SearchOp {
    SearchOp {
        pattern: pattern.to_string(),
        targets: targets.into_iter().map(String::from).collect(),
        target_paths: Vec::new(),
        context_lines,
        line_numbers: false,
        symbol: None,
        files_with_matches: false,
        full: false,
        max_tokens: None,
        json: false,
        stats: false,
    }
}

#[test]
fn f54_template_literal_context_search_preserves_matched_lines_and_br2() {
    let ws = TempWs::new("f54_template");
    let mut mjs = String::from("import fs from 'node:fs';\n\nconst appCss = `\n");
    for i in 1..=65 {
        mjs.push_str(&format!(".rule-{i} {{ margin: {i}px; }}\n"));
    }
    mjs.push_str(concat!(
        "#main {\n",
        "    position: absolute;\n",
        "    top: 0px;\n",
        "    left: 0px;\n",
        "    width: 100%;\n",
        "    height: 100%;\n",
        "    pointer-events: fill;\n",
        "    z-index: 10;\n",
        "}\n",
        "\n",
        ".onBoard {\n",
        "    z-index: 20;\n",
        "}\n",
        "`;\n",
        "\n",
        "const runtimeJs = `/* Webpack Encore Runtime */\n",
        "(function(global) {\n",
        "    global.__WHITEBOARD_RUNTIME__ = true;\n",
        "})(typeof window !== 'undefined' ? window : globalThis);\n",
        "`;\n",
    ));
    ws.write("bin/build-assets.mjs", &mjs);
    ws.write(
        "src/math.ts",
        "export class Calculator {\n  public add(a: number, b: number): number {\n    return a + b;\n  }\n}\n",
    );

    // Exact V4-AB-03 repro: search -C 5 '\.onBoard' bin/build-assets.mjs
    let hit = ws.run_search(search_op(r"\.onBoard", vec!["bin/build-assets.mjs"], Some(5)));
    assert_eq!(hit.exit_code, 0, "stderr: {}", hit.stderr_output);
    assert!(
        hit.emitted_output.contains(".onBoard {"),
        "matched template-literal line dropped:\n{}",
        hit.emitted_output
    );
    assert!(
        hit.emitted_output.contains("z-index: 20;"),
        "context inside template literal missing:\n{}",
        hit.emitted_output
    );
    assert!(
        hit.emitted_output.contains("L79:") || hit.emitted_output.contains("L78:"),
        "expected line-numbered template-literal window:\n{}",
        hit.emitted_output
    );

    // CSS ID selector inside JS template literal stays `#main {` (not rewritten to `# main {`)
    let hash_hit = ws.run_search(search_op("#main", vec!["bin/build-assets.mjs"], Some(2)));
    assert_eq!(hash_hit.exit_code, 0);
    assert!(
        hash_hit.emitted_output.contains("#main {"),
        "CSS id inside template literal corrupted:\n{}",
        hash_hit.emitted_output
    );

    // B-R2 invariant on normal TS class remains strictly intact
    let calc = ws.run_search(search_op("Calculator", vec!["src/math.ts"], Some(2)));
    assert_eq!(calc.exit_code, 0);
    assert!(calc.emitted_output.contains("Calculator"), "{}", calc.emitted_output);
    assert!(
        !calc.emitted_output.contains("export class Calculator"),
        "B-R2 regression:\n{}",
        calc.emitted_output
    );
}

#[test]
fn f55_zero_width_anchors_match_yaml_and_preserve_literal_fallback() {
    let ws = TempWs::new("f55_anchors");
    ws.write(
        "deploy.yaml",
        "apiVersion: v1\nkind: Service\nmetadata:\n  name: whiteboard\nspec:\n  port: 8080\n",
    );
    ws.write("notes.txt", "Special [a+b]*(c?) chars\nunrelated line\n");

    for pat in ["^", "$", r"\b"] {
        let res = ws.run_search(search_op(pat, vec!["deploy.yaml"], None));
        assert_eq!(res.exit_code, 0, "pat={pat} stderr={}", res.stderr_output);
        assert!(
            !res.emitted_output.trim().is_empty(),
            "zero-width anchor '{pat}' returned empty output on YAML"
        );
        assert!(
            res.emitted_output.contains("deploy.yaml"),
            "pat={pat} missing file header:\n{}",
            res.emitted_output
        );
        assert!(
            res.emitted_output.contains("whiteboard") || res.emitted_output.contains("apiVersion"),
            "pat={pat} missing YAML content:\n{}",
            res.emitted_output
        );
    }

    // SRCH-05 literal fallback for [a+b]*(c?) remains intact
    let lit = compile_search_pattern("[a+b]*(c?)", false);
    assert!(lit.is_literal);
    let lit_res = ws.run_search(search_op("[a+b]*(c?)", vec!["notes.txt"], None));
    assert_eq!(lit_res.exit_code, 0);
    assert!(lit_res.emitted_output.contains("[a+b]*(c?)"), "{}", lit_res.emitted_output);
    assert!(!lit_res.emitted_output.contains("unrelated line"), "{}", lit_res.emitted_output);
}

#[test]
fn f40_search_and_find_reject_empty_pattern_invalid_regex_and_missing_dirs() {
    let ws = TempWs::new("f40_ux");
    ws.write("src/app.ts", "export const endpoint = \"/api/v1/users\";\nexport function mul(a: number) { return a * 2; }\n");

    // 1. Empty search pattern rejected cleanly
    let empty = ws.run_search(search_op("", vec!["src/app.ts"], None));
    assert_eq!(empty.exit_code, 1);
    assert!(empty.emitted_output.is_empty());
    assert!(empty.stderr_output.ends_with('\n'), "stderr missing newline: {:?}", empty.stderr_output);
    assert!(empty.stderr_output.to_ascii_lowercase().contains("empty"), "{}", empty.stderr_output);

    // 2. Invalid slash regex patterns rejected cleanly instead of silent literal fallback
    for bad_rx in ["/[unclosed/", "/unclosed[", "/(abc/", "/unclosed(", "//"] {
        let bad = ws.run_search(search_op(bad_rx, vec!["src/app.ts"], None));
        assert_eq!(bad.exit_code, 1, "expected rc=1 for {bad_rx}");
        assert!(bad.emitted_output.is_empty(), "expected empty stdout for {bad_rx}");
        assert!(bad.stderr_output.ends_with('\n'), "missing \\n for {bad_rx}: {:?}", bad.stderr_output);
        assert!(
            bad.stderr_output.contains("Invalid regex"),
            "unexpected stderr for {bad_rx}: {}",
            bad.stderr_output
        );
    }

    // Valid slash regex & literal URL path /api/v1 still succeed
    let ok_rx = ws.run_search(search_op("/MUL/i", vec!["src/app.ts"], None));
    assert_eq!(ok_rx.exit_code, 0, "stderr: {}", ok_rx.stderr_output);
    assert!(ok_rx.emitted_output.contains("mul"), "{}", ok_rx.emitted_output);

    let ok_path = ws.run_search(search_op("/api/v1", vec!["src/app.ts"], None));
    assert_eq!(ok_path.exit_code, 0, "stderr: {}", ok_path.stderr_output);
    assert!(ok_path.emitted_output.contains("/api/v1"), "{}", ok_path.emitted_output);

    // 3. Nonexistent explicit target directory rejected cleanly in search, find, and read --files
    let miss_s = ws.run_search(search_op("endpoint", vec!["missing_dir_123"], None));
    assert_eq!(miss_s.exit_code, 1);
    assert!(miss_s.stderr_output.contains("does not exist"), "{}", miss_s.stderr_output);
    assert!(miss_s.stderr_output.ends_with('\n'), "{:?}", miss_s.stderr_output);

    let miss_f = ws.run_find(FindOp {
        pattern: None,
        targets: vec!["missing_dir_123/".into()],
        target_paths: Vec::new(),
        depth: None,
        search: None,
        full: false,
        max_tokens: None,
        json: false,
    });
    assert_eq!(miss_f.exit_code, 1);
    assert!(miss_f.stderr_output.contains("does not exist"), "{}", miss_f.stderr_output);
    assert!(miss_f.stderr_output.ends_with('\n'), "{:?}", miss_f.stderr_output);

    let mut files_op = read_op(vec!["missing_dir_123/"]);
    files_op.files_only = true;
    let miss_rf = ws.run_read(files_op);
    assert_eq!(miss_rf.exit_code, 1);
    assert!(miss_rf.stderr_output.contains("does not exist"), "{}", miss_rf.stderr_output);
    assert!(miss_rf.stderr_output.ends_with('\n'), "{:?}", miss_rf.stderr_output);

    // Pattern-only find query with 0 matches still exits 0 cleanly
    let zero_f = ws.run_find(FindOp {
        pattern: Some("definitely_absent_token_xyz".into()),
        targets: Vec::new(),
        target_paths: Vec::new(),
        depth: None,
        search: None,
        full: false,
        max_tokens: None,
        json: false,
    });
    assert_eq!(zero_f.exit_code, 0);
    assert!(zero_f.emitted_output.is_empty());
}

#[test]
fn f41_read_error_diagnostics_always_end_with_trailing_newline() {
    let ws = TempWs::new("f41_newline");
    ws.write("src/lib.ts", "export const ok = 1;\n");

    let mut huge = String::with_capacity(2_400_000);
    for i in 0..40_000 {
        huge.push_str(&format!("line_{i:05}: payload_abcdefghijklmnopqrstuvwxyz_0123456789\n"));
    }
    assert!(huge.len() > 2 * 1024 * 1024);
    ws.write("docs/huge.txt", &huge);

    for target in [
        "src/lib.ts:NoSuchSymXYZ",
        "src/lib.ts:L20-L5",
        "src/no_such_file_xyz.ts",
        "docs/huge.txt",
    ] {
        let pack = ws.run_read(read_op(vec![target]));
        assert_eq!(pack.exit_code, 1, "expected rc=1 for {target}");
        assert!(
            !pack.stderr_output.is_empty() && pack.stderr_output.ends_with('\n'),
            "missing trailing newline for {target}: {:?}",
            pack.stderr_output
        );
    }

    // Mixed valid + missing target also terminates partial stderr with `\n`
    let mixed = ws.run_read(read_op(vec!["src/lib.ts", "src/no_such_file_xyz.ts"]));
    assert_eq!(mixed.exit_code, 0);
    assert!(
        !mixed.stderr_output.is_empty() && mixed.stderr_output.ends_with('\n'),
        "missing trailing newline on partial stderr: {:?}",
        mixed.stderr_output
    );
}

#[test]
fn f42_ts_and_js_outlines_distinguish_let_var_and_const() {
    let ws = TempWs::new("f42_outline_let");
    ws.write(
        "src/state.ts",
        concat!(
            "export const MAX_RETRIES = 3;\n",
            "export let activeCount = 0;\n",
            "let localCursor = 1;\n",
            "var legacyFlag = false;\n",
            "const INTERNAL_KEY = \"abc\";\n",
        ),
    );
    ws.write(
        "src/script.js",
        "let mutableItems = [];\nconst FIXED_LIMIT = 10;\nvar globalMode = \"dev\";\n",
    );

    for include_types in [true, false] {
        let mut op = read_op(vec!["src/state.ts"]);
        op.outline = true;
        op.include_types = include_types;
        let out = ws.run_read(op);
        assert_eq!(out.exit_code, 0, "stderr: {}", out.stderr_output);
        let txt = &out.emitted_output;
        assert!(txt.contains("const MAX_RETRIES # [L1-L1]"), "include_types={include_types}:\n{txt}");
        assert!(txt.contains("let activeCount # [L2-L2]"), "include_types={include_types}:\n{txt}");
        assert!(txt.contains("let localCursor # [L3-L3]"), "include_types={include_types}:\n{txt}");
        assert!(txt.contains("var legacyFlag # [L4-L4]"), "include_types={include_types}:\n{txt}");
        assert!(txt.contains("const INTERNAL_KEY # [L5-L5]"), "include_types={include_types}:\n{txt}");
    }

    let mut js_op = read_op(vec!["src/script.js"]);
    js_op.outline = true;
    let js_out = ws.run_read(js_op);
    assert_eq!(js_out.exit_code, 0);
    assert!(js_out.emitted_output.contains("let mutableItems # [L1-L1]"), "{}", js_out.emitted_output);
    assert!(js_out.emitted_output.contains("const FIXED_LIMIT # [L2-L2]"), "{}", js_out.emitted_output);
    assert!(js_out.emitted_output.contains("var globalMode # [L3-L3]"), "{}", js_out.emitted_output);
}
