use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

use aice_batch_read::discovery::format_find_pack;
use aice_batch_read::gitignore::GitIgnoreSet;
use aice_batch_read::search::execute_search;
use aice_batch_read::topo_cache::{clear_dep_cache, dep_cache_stats};
use aice_batch_read::{BatchReadPack, execute_batch_read};
use aice_find_engine::{FindWalkOpts, walk_governed_with_opts};
use aice_governance::{
    FindOp, GovernanceError, OutputSurface, PipelineRequest, ReadOp, SearchOp, WriteOp, authorize,
};
use aice_lang_registry::LanguageId;

static NEXT_ID: AtomicUsize = AtomicUsize::new(1);

struct TempWs {
    root: PathBuf,
}

impl TempWs {
    fn new(tag: &str) -> Self {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "aice_w2_rg_{tag}_{}_{}",
            std::process::id(),
            id
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create temp dir");
        fs::write(root.join("aice.config.json"), "{\"enabled\": true}\n").expect("write cfg");
        Self { root }
    }

    fn write(&self, rel: &str, content: &str) {
        self.write_bytes(rel, content.as_bytes());
    }

    fn write_bytes(&self, rel: &str, content: &[u8]) {
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

    fn run_find(&self, full: bool) -> BatchReadPack {
        let op = FindOp {
            pattern: None,
            targets: Vec::new(),
            target_paths: Vec::new(),
            depth: None,
            search: None,
            full,
            max_tokens: None,
            json: false,
        };
        let gov = authorize(PipelineRequest::new(
            op.clone(),
            self.root.clone(),
            OutputSurface::Cli,
        ))
        .expect("authorize find");
        let walk = walk_governed_with_opts(
            gov.state(),
            &FindWalkOpts {
                include_hidden: full,
                ..FindWalkOpts::default()
            },
        )
        .expect("walk find");
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

fn search_op(pattern: &str, targets: Vec<&str>) -> SearchOp {
    SearchOp {
        pattern: pattern.to_string(),
        targets: targets.into_iter().map(String::from).collect(),
        target_paths: Vec::new(),
        context_lines: None,
        line_numbers: false,
        symbol: None,
        files_with_matches: false,
        full: false,
        max_tokens: None,
        json: false,
        stats: false,
    }
}

fn write_op_for(path: &str) -> WriteOp {
    WriteOp {
        path: Some(PathBuf::from(path)),
        symbol: None,
        code: Some("hello\n".into()),
        template: None,
        body: None,
        from_file: None,
        from_stdin: false,
        delete: None,
        insert_after: None,
        insert_before: None,
        edits: None,
        batch: None,
        create: false,
        overwrite: false,
        force: false,
        in_place: false,
        dry_run: true,
        diff: false,
        json: false,
        preserve_docs: true,
        target_paths: Vec::new(),
    }
}

#[test]
fn f19_mysql_table_and_line_slice_never_swaps_fk_referenced_table() {
    let ws = TempWs::new("f19_mysql");
    ws.write(
        "repro_drop.sql",
        concat!(
            "-- MySQL schema\n",
            "CREATE TABLE `alpha` (\n",
            "  `id` INT NOT NULL AUTO_INCREMENT,\n",
            "  `alpha_code` VARCHAR(32) NOT NULL,\n",
            "  `beta_id` INT NOT NULL,\n",
            "  CONSTRAINT `fk_alpha_beta` FOREIGN KEY (`beta_id`) REFERENCES `beta` (`id`),\n",
            "  PRIMARY KEY (`id`)\n",
            ") ENGINE=InnoDB;\n",
            "\n",
            "CREATE TABLE `beta` (\n",
            "  `id` INT NOT NULL AUTO_INCREMENT,\n",
            "  `beta_label` VARCHAR(64) NOT NULL,\n",
            "  PRIMARY KEY (`id`)\n",
            ") ENGINE=InnoDB;\n",
        ),
    );

    let alpha_sym = ws.run_read(read_op(vec!["repro_drop.sql:alpha"]));
    assert_eq!(alpha_sym.exit_code, 0, "stderr: {}", alpha_sym.stderr_output);
    assert!(alpha_sym.emitted_output.contains("alpha_code"), "out:\n{}", alpha_sym.emitted_output);
    assert!(
        !alpha_sym.emitted_output.contains("beta_label"),
        "FK target table beta leaked into :alpha:\n{}",
        alpha_sym.emitted_output
    );

    let alpha_lines = ws.run_read(read_op(vec!["repro_drop.sql:L2-L8"]));
    assert_eq!(alpha_lines.exit_code, 0, "stderr: {}", alpha_lines.stderr_output);
    assert!(alpha_lines.emitted_output.contains("alpha_code"), "out:\n{}", alpha_lines.emitted_output);
    assert!(
        !alpha_lines.emitted_output.contains("beta_label"),
        "FK target table beta leaked into :L2-L8:\n{}",
        alpha_lines.emitted_output
    );

    let beta_sym = ws.run_read(read_op(vec!["repro_drop.sql:beta"]));
    assert_eq!(beta_sym.exit_code, 0, "stderr: {}", beta_sym.stderr_output);
    assert!(beta_sym.emitted_output.contains("beta_label"), "out:\n{}", beta_sym.emitted_output);
    assert!(
        !beta_sym.emitted_output.contains("alpha_code"),
        "alpha leaked into :beta:\n{}",
        beta_sym.emitted_output
    );
}

#[test]
fn f20_bounded_line_slice_on_huge_c_ifdef_and_markdown_heading() {
    let ws = TempWs::new("f20_bounds");

    let mut c_src = String::from("#ifndef RT_GUI_AUDIO_H\n#define RT_GUI_AUDIO_H\n#include <stdint.h>\n");
    for i in 4..=7013 {
        if i == 15 {
            c_src.push_str("int audio_head_marker_15(int x) { return x + 15; }\n");
        } else if i == 6900 {
            c_src.push_str("int audio_tail_marker_6900(int x) { return x + 6900; }\n");
        } else {
            c_src.push_str(&format!("static int pad_var_{i} = {i};\n"));
        }
    }
    c_src.push_str("#endif\n");
    ws.write("runtime/rt_gui_audio.c", &c_src);

    let t_c = Instant::now();
    let c_pack = ws.run_read(read_op(vec!["runtime/rt_gui_audio.c:L1-L80"]));
    let c_ms = t_c.elapsed().as_millis();
    assert_eq!(c_pack.exit_code, 0, "stderr: {}", c_pack.stderr_output);
    assert!(!c_pack.emitted_output.contains("Auto-outlined"), "out:\n{}", c_pack.emitted_output);
    assert!(c_pack.emitted_output.contains("audio_head_marker_15"), "out:\n{}", c_pack.emitted_output);
    assert!(
        !c_pack.emitted_output.contains("audio_tail_marker_6900"),
        "unbounded #ifdef leaked tail:\n{}",
        c_pack.emitted_output
    );
    assert!(
        c_pack.emitted_output.lines().count() <= 110,
        "C slice blew bounds ({} lines)",
        c_pack.emitted_output.lines().count()
    );
    assert!(c_ms < 2000, "C :L1-L80 too slow: {c_ms}ms");

    let mut md_src = String::from("# Master Graphics 2D Reference\n\nIntro head_md_marker_line3.\n\n");
    for i in 1..=1350 {
        md_src.push_str(&format!("## Section {i}\n\n"));
        for j in 0..8 {
            if i == 5 && j == 0 {
                md_src.push_str("Paragraph early_md_marker_inside_80.\n");
            } else if i == 1340 && j == 0 {
                md_src.push_str("Paragraph late_md_marker_13400.\n");
            } else {
                md_src.push_str(&format!("Line {i}_{j} describing 2D rendering pipeline.\n"));
            }
        }
        md_src.push('\n');
    }
    ws.write("docs/reference/26_gfx2d.md", &md_src);

    let t_md = Instant::now();
    let md_pack = ws.run_read(read_op(vec!["docs/reference/26_gfx2d.md:L1-L80"]));
    let md_ms = t_md.elapsed().as_millis();
    assert_eq!(md_pack.exit_code, 0, "stderr: {}", md_pack.stderr_output);
    assert!(!md_pack.emitted_output.contains("Auto-outlined"), "out:\n{}", md_pack.emitted_output);
    assert!(md_pack.emitted_output.contains("early_md_marker_inside_80"), "out:\n{}", md_pack.emitted_output);
    assert!(
        !md_pack.emitted_output.contains("late_md_marker_13400"),
        "unbounded MD heading leaked tail"
    );
    assert!(
        md_pack.emitted_output.lines().count() <= 110,
        "MD slice blew bounds ({} lines)",
        md_pack.emitted_output.lines().count()
    );
    assert!(md_ms < 500, "MD :L1-L80 too slow: {md_ms}ms");
}

#[test]
fn f22_colon_filenames_php_namespaces_and_malformed_regex() {
    let ws = TempWs::new("f22_paths");
    ws.write(
        "aipl_reports/13: AIPL_BENCHMARK_RESULTS.md",
        "# Benchmark 13\nline two colon_file_body\nline three tail_marker\n",
    );
    ws.write(
        "src/Controller/WhiteboardController.php",
        concat!(
            "<?php\n",
            "namespace App\\Controller;\n",
            "class WhiteboardController {\n",
            "    public function index(): int { return 42; }\n",
            "}\n",
        ),
    );
    ws.write("src/lib/yaml.ts", "export const parseYaml = (s: string) => s;\n");

    let colon_full = ws.run_read(read_op(vec!["aipl_reports/13: AIPL_BENCHMARK_RESULTS.md"]));
    assert_eq!(colon_full.exit_code, 0, "stderr: {}", colon_full.stderr_output);
    assert!(colon_full.emitted_output.contains("colon_file_body"), "out:\n{}", colon_full.emitted_output);

    let colon_slice = ws.run_read(read_op(vec!["aipl_reports/13: AIPL_BENCHMARK_RESULTS.md:L1-L2"]));
    assert_eq!(colon_slice.exit_code, 0, "stderr: {}", colon_slice.stderr_output);
    assert!(colon_slice.emitted_output.contains("colon_file_body"));
    assert!(!colon_slice.emitted_output.contains("tail_marker"));

    let php_ns = ws.run_read(read_op(vec![
        r"src/Controller/WhiteboardController.php:App\Controller",
    ]));
    assert_eq!(php_ns.exit_code, 0, "stderr: {}", php_ns.stderr_output);
    assert!(php_ns.emitted_output.contains("WhiteboardController"), "out:\n{}", php_ns.emitted_output);

    for bad_sel in [
        r"src/Controller/WhiteboardController.php:\App\Controller",
        r"src/Controller/WhiteboardController.php:App\..\Evil",
        r"src/Controller/WhiteboardController.php:C:\Windows",
        "safe:/etc/shadow",
        "src/lib/yaml.ts:/etc/shadow",
    ] {
        let res = authorize(PipelineRequest::new(
            read_op(vec![bad_sel]),
            ws.root.clone(),
            OutputSurface::Cli,
        ));
        assert!(
            matches!(res, Err(GovernanceError::PathOutsideAllowedRoots(_))),
            "expected PathOutsideAllowedRoots for {bad_sel}, got {res:?}"
        );
    }

    let bad_rx = authorize(PipelineRequest::new(
        read_op(vec!["src/lib/yaml.ts:/[unclosed/"]),
        ws.root.clone(),
        OutputSurface::Cli,
    ));
    match bad_rx {
        Err(GovernanceError::InvalidSelector(msg)) => {
            assert!(msg.contains("Invalid regex"), "unexpected msg: {msg}");
        }
        other => panic!("expected InvalidSelector for malformed regex, got {other:?}"),
    }
}

#[test]
fn f23_over_2mib_utf8_stream_slice_and_diagnostic_vs_true_binary() {
    let ws = TempWs::new("f23_large_utf8");

    let mut huge_md = String::with_capacity(2_300_000);
    huge_md.push_str("# Giant UI Spec\n");
    for i in 2..=30_000 {
        if i == 15 {
            huge_md.push_str("marker_line_15_visible_in_slice\n");
        } else if i == 60 {
            huge_md.push_str("marker_line_60_visible_in_slice\n");
        } else {
            huge_md.push_str(&format!("Row {i:05}: component layout width=128 height=64 padding=8 margin=4 mode=flex\n"));
        }
    }
    assert!(huge_md.len() > 2 * 1024 * 1024);
    ws.write("docs/reference/29_ui.md", &huge_md);

    let mut huge_bin = vec![b'x'; 2 * 1024 * 1024 + 128];
    huge_bin[100] = 0;
    ws.write_bytes("bin/large.dat", &huge_bin);

    // WriteOp still rejects >2 MiB files
    let write_res = authorize(PipelineRequest::new(
        write_op_for("docs/reference/29_ui.md"),
        ws.root.clone(),
        OutputSurface::Cli,
    ));
    assert!(matches!(write_res, Err(GovernanceError::BinaryWriteForbidden(_))));

    // Bounded :L1-L80 streams cleanly on >2 MiB valid UTF-8
    let sliced = ws.run_read(read_op(vec!["docs/reference/29_ui.md:L1-L80"]));
    assert_eq!(sliced.exit_code, 0, "stderr: {}", sliced.stderr_output);
    assert!(!sliced.emitted_output.contains("binary file skipped"), "out:\n{}", sliced.emitted_output);
    assert!(sliced.emitted_output.contains("marker_line_15_visible_in_slice"), "out:\n{}", sliced.emitted_output);
    assert!(sliced.emitted_output.contains("marker_line_60_visible_in_slice"), "out:\n{}", sliced.emitted_output);

    // Unbounded read emits accurate size-limit diagnostic (NOT binary file skipped)
    let unbounded = ws.run_read(read_op(vec!["docs/reference/29_ui.md"]));
    assert_eq!(unbounded.exit_code, 1);
    assert!(unbounded.stderr_output.contains("exceeds maximum text size"), "err: {}", unbounded.stderr_output);
    assert!(!unbounded.emitted_output.contains("binary file skipped"));
    assert!(!unbounded.stderr_output.contains("binary file skipped"));

    // True >2 MiB binary still emits [binary file skipped]
    let bin_read = ws.run_read(read_op(vec!["bin/large.dat:L1-L10"]));
    assert_eq!(bin_read.exit_code, 0);
    assert!(bin_read.emitted_output.contains("binary file skipped"), "out:\n{}", bin_read.emitted_output);

    // Walker with include_binary: true does not mislabel >2 MiB pure UTF-8 as binary
    let find_gov = authorize(PipelineRequest::new(
        FindOp {
            pattern: None,
            targets: Vec::new(),
            target_paths: Vec::new(),
            depth: None,
            search: None,
            full: false,
            max_tokens: None,
            json: false,
        },
        ws.root.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    let walked = walk_governed_with_opts(
        find_gov.state(),
        &FindWalkOpts {
            include_binary: true,
            ..FindWalkOpts::default()
        },
    )
    .unwrap();
    let md_entry = walked.files.iter().find(|f| f.path.ends_with("29_ui.md")).expect("29_ui.md present");
    assert!(!md_entry.is_binary, ">2MiB pure UTF-8 mislabeled binary in walker");
    assert_eq!(md_entry.language, LanguageId::Markdown);
    let bin_entry = walked.files.iter().find(|f| f.path.ends_with("large.dat")).expect("large.dat present");
    assert!(bin_entry.is_binary, ">2MiB NUL binary must stay binary");
}

#[test]
fn f25_pure_ts_barrel_over_120l_auto_outline_emits_reexports() {
    let ws = TempWs::new("f25_ts_barrel");
    let mut barrel = String::new();
    for i in 1..=70 {
        barrel.push_str(&format!("export * from './mod_{i}';\n"));
        barrel.push_str(&format!("export {{\n  Foo{i},\n  Bar{i},\n}} from './group_{i}';\n"));
    }
    ws.write("src/core/meta/index.ts", &barrel);

    let auto_pack = ws.run_read(read_op(vec!["src/core/meta/index.ts"]));
    assert_eq!(auto_pack.exit_code, 0, "stderr: {}", auto_pack.stderr_output);
    assert!(
        !auto_pack.emitted_output.contains("(no AST symbols"),
        "barrel auto-outline emitted empty stub:\n{}",
        auto_pack.emitted_output
    );
    assert!(auto_pack.emitted_output.contains("Auto-outlined"), "out:\n{}", auto_pack.emitted_output);
    assert!(auto_pack.emitted_output.contains("export * from './mod_1' # [L1]"), "out:\n{}", auto_pack.emitted_output);
    assert!(auto_pack.emitted_output.contains("Foo1, Bar1"), "out:\n{}", auto_pack.emitted_output);

    let mut explicit_op = read_op(vec!["src/core/meta/index.ts"]);
    explicit_op.outline = true;
    let out_pack = ws.run_read(explicit_op);
    assert_eq!(out_pack.exit_code, 0);
    assert!(!out_pack.emitted_output.contains("(no AST symbols"));
    assert!(out_pack.emitted_output.contains("export * from './mod_1' # [L1]"));
}

#[test]
fn f28_markdown_search_fast_path_no_latency_cliff() {
    let ws = TempWs::new("f28_md_search");
    let mut big_md = String::with_capacity(550_000);
    big_md.push_str("# Game Design Bible\n\n");
    for sec in 0..400 {
        big_md.push_str(&format!("## Chapter {sec}\n\n"));
        for line in 0..20 {
            if sec % 4 == 0 && line == 5 {
                big_md.push_str(&format!("Encounter {sec}: the dungeon boss spawns with shield phase {line}.\n"));
            } else {
                big_md.push_str(&format!(
                    "Paragraph {sec}-{line}: atmospheric lore and combat pacing telemetry notes for zone exploration.\n"
                ));
            }
        }
        big_md.push('\n');
    }
    assert!(big_md.len() > 500 * 1024);
    ws.write("GAME_DESIGN.md", &big_md);

    let t0 = Instant::now();
    let pack = ws.run_search(search_op("boss", vec!["GAME_DESIGN.md"]));
    let elapsed_ms = t0.elapsed().as_millis();
    assert_eq!(pack.exit_code, 0, "stderr: {}", pack.stderr_output);
    assert!(pack.emitted_output.contains("GAME_DESIGN.md:"), "out:\n{}", pack.emitted_output);
    assert!(pack.emitted_output.contains("dungeon boss spawns"), "out:\n{}", pack.emitted_output);
    assert!(elapsed_ms < 500, "512KB MD search took {elapsed_ms}ms (expected <500ms)");
}

#[test]
fn f29_dotfile_parity_and_gitignore_parent_dir_negation() {
    let ws = TempWs::new("f29_dotfiles");
    ws.write(
        ".gitignore",
        ".aipl/\n!.aipl/manifest.sha256\nnested_keep/*\n!nested_keep/allowed.txt\n",
    );
    ws.write(".github/workflows/ci.yml", "steps:\n  - uses: actions/checkout@v4\n");
    ws.write(".gitlab-ci.yml", "script:\n  - echo actions/checkout\n");
    ws.write(".env.example", "TOKEN=actions/checkout\n");
    ws.write(".env.local", "SECRET=actions/checkout\n");
    ws.write(".git/HEAD", "ref: refs/heads/actions/checkout\n");
    ws.write(".aipl/manifest.sha256", "sha256 actions/checkout\n");
    ws.write("nested_keep/allowed.txt", "keep actions/checkout\n");
    ws.write("nested_keep/drop.txt", "drop actions/checkout\n");

    let gi = GitIgnoreSet::from_root(&ws.root);
    assert!(gi.is_ignored(&ws.root.join(".aipl/manifest.sha256"), false));
    assert!(!gi.is_ignored(&ws.root.join("nested_keep/allowed.txt"), false));
    assert!(gi.is_ignored(&ws.root.join("nested_keep/drop.txt"), false));

    let find_pack = ws.run_find(false);
    let search_pack = ws.run_search(search_op("actions/checkout", vec![]));
    let mut files_op = read_op(vec![]);
    files_op.files_only = true;
    let files_pack = ws.run_read(files_op);

    for (label, out) in [
        ("find", &find_pack.emitted_output),
        ("search", &search_pack.emitted_output),
        ("read --files", &files_pack.emitted_output),
    ] {
        assert!(out.contains("ci.yml"), "{label} missing .github/workflows/ci.yml:\n{out}");
        assert!(out.contains(".gitlab-ci.yml"), "{label} missing .gitlab-ci.yml:\n{out}");
        assert!(out.contains(".env.example"), "{label} missing .env.example:\n{out}");
        assert!(out.contains("allowed.txt"), "{label} missing nested_keep/allowed.txt:\n{out}");
        assert!(!out.contains(".git/HEAD"), "{label} leaked .git/HEAD:\n{out}");
        assert!(!out.contains(".env.local"), "{label} leaked .env.local:\n{out}");
        assert!(!out.contains("manifest.sha256"), "{label} leaked ignored-parent .aipl/manifest.sha256:\n{out}");
        assert!(!out.contains("drop.txt"), "{label} leaked nested_keep/drop.txt:\n{out}");
    }

    // Even with --full, .gitignore parent-dir ignore still blocks .aipl/manifest.sha256
    let find_full = ws.run_find(true);
    assert!(
        !find_full.emitted_output.contains("manifest.sha256"),
        "find --full leaked .aipl/manifest.sha256:\n{}",
        find_full.emitted_output
    );
}

#[test]
fn f31_topo_cache_warm_hits_and_edit_invalidation() {
    clear_dep_cache();
    let ws = TempWs::new("f31_topo_cache");
    ws.write("src/main.ts", "import { runA } from './a';\nexport const m = runA();\n");
    ws.write("src/a.ts", "import { runB } from './b';\nexport function runA() { return runB(); }\n");
    ws.write("src/b.ts", "export function runB() { return 1; }\n");
    ws.write("src/c.ts", "export function runC() { return 2; }\n");
    for i in 0..20 {
        ws.write(&format!("src/util_{i}.ts"), &format!("export const U{i} = {i};\n"));
    }

    let mut op = read_op(vec!["src/main.ts"]);
    op.include_deps = true;
    op.depth = Some(2);

    let cold = ws.run_read(op.clone());
    assert_eq!(cold.exit_code, 0, "stderr: {}", cold.stderr_output);
    assert!(cold.multi_files.iter().any(|p| p == "src/b.ts"), "cold: {:?}", cold.multi_files);
    let (h1, m1) = dep_cache_stats();
    assert!(m1 >= 24, "expected cold misses >= 24, got ({h1}, {m1})");

    let warm = ws.run_read(op.clone());
    assert_eq!(warm.exit_code, 0);
    assert!(warm.multi_files.iter().any(|p| p == "src/b.ts"), "warm: {:?}", warm.multi_files);
    let (h2, m2) = dep_cache_stats();
    assert!(h2 >= h1 + 24, "expected warm cache hits, before=({h1},{m1}) after=({h2},{m2})");
    assert_eq!(m2, m1, "warm repeat should not re-parse unchanged files");

    // Atomic edit (changes size + inode) auto-invalidates only src/a.ts
    let tmp_a = ws.root.join("src/a.ts.tmp");
    fs::write(
        &tmp_a,
        "import { runC } from './c';\nexport function runA(): number { return runC() + 100; }\n",
    )
    .expect("write tmp");
    fs::rename(&tmp_a, ws.root.join("src/a.ts")).expect("atomic rename");

    let after_edit = ws.run_read(op);
    assert_eq!(after_edit.exit_code, 0);
    assert!(
        after_edit.multi_files.iter().any(|p| p == "src/c.ts"),
        "expected invalidated dep src/c.ts, got {:?}",
        after_edit.multi_files
    );
    let (_, m3) = dep_cache_stats();
    assert_eq!(m3, m2 + 1, "only edited file should re-parse: m2={m2}, m3={m3}");
}
