use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use aice_batch_read::aice_project_util::balance_closers_for_lang;
use aice_batch_read::budget::count_cl100k_exact;
use aice_batch_read::budget_fill::water_fill_quotas;
use aice_batch_read::discovery::format_find_pack;
use aice_batch_read::glob::glob_matches;
use aice_batch_read::search::execute_search;
use aice_batch_read::{BatchReadPack, execute_batch_read};
use aice_find_engine::{FindWalkOpts, walk_governed_with_opts};
use aice_governance::{FindOp, OutputSurface, PipelineRequest, ReadOp, SearchOp, authorize};
use aice_lang_registry::LanguageId;

static SEQ: AtomicU64 = AtomicU64::new(1);

struct TempDir {
    root: PathBuf,
}

impl TempDir {
    fn new(tag: &str) -> Self {
        let id = SEQ.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!("aice_w4m1_{tag}_{}_{id}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("mkdir");
        std::fs::write(root.join("aice.config.json"), "{\"enabled\": true}\n").expect("cfg");
        Self { root }
    }

    fn write(&self, rel: &str, content: &str) {
        let p = self.root.join(rel);
        if let Some(par) = p.parent() {
            std::fs::create_dir_all(par).expect("mkdir parent");
        }
        std::fs::write(p, content).expect("write");
    }

    fn write_bytes(&self, rel: &str, content: &[u8]) {
        let p = self.root.join(rel);
        if let Some(par) = p.parent() {
            std::fs::create_dir_all(par).expect("mkdir parent");
        }
        std::fs::write(p, content).expect("write bytes");
    }

    fn run_read(&self, op: ReadOp) -> BatchReadPack {
        let gov = authorize(PipelineRequest::new(op.clone(), self.root.clone(), OutputSurface::Cli))
            .expect("authorize read");
        execute_batch_read(gov.state(), &op).expect("execute_batch_read")
    }

    fn run_search(&self, op: SearchOp) -> BatchReadPack {
        let gov =
            authorize(PipelineRequest::new(op.clone(), self.root.clone(), OutputSurface::Cli))
                .expect("authorize search");
        execute_search(gov.state(), &op).expect("execute_search")
    }

    fn run_find(&self, op: FindOp) -> BatchReadPack {
        let gov = authorize(PipelineRequest::new(op.clone(), self.root.clone(), OutputSurface::Cli))
            .expect("authorize find");
        let opts = FindWalkOpts {
            max_depth: op.depth,
            include_hidden: op.full,
            skip_lockfiles: true,
            include_binary: false,
            probe_binary: true,
            measure_lines: true,
            query: op.pattern.clone(),
            explicit_targets: op.targets.clone(),
            walk_project_root_if_untargeted: true,
        };
        let walk = walk_governed_with_opts(gov.state(), &opts).expect("walk");
        format_find_pack(gov.state(), walk, &op)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
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

#[test]
fn coalesce_multi_arg_full_subsumption_ranges_and_symbol_containment() {
    let ws = TempDir::new("coalesce");
    let app_ts = "\
export class App {
  private count = 0;
  public inc(step: number): number {
    if (step > 0) {
      this.count += step;
    }
    return this.count;
  }
  public reset(): number {
    this.count = 0;
    return this.count;
  }
}
";
    ws.write("src/app.ts", app_ts);
    let mut lines_200 = String::new();
    for i in 1..=200 {
        lines_200.push_str(&format!("export const c_{i}: number = {i};\n"));
    }
    ws.write("src/big.ts", &lines_200);
    let mut txt_50 = String::new();
    for i in 1..=50 {
        txt_50.push_str(&format!("line {i}\n"));
    }
    ws.write("src/lines.txt", &txt_50);

    // 1. Multi-arg same-file coalescing: 1 header, both symbols, no double-counted raw_baseline
    let pack = ws.run_read(read_op(vec!["src/app.ts:App.inc", "src/app.ts:App.reset"]));
    assert_eq!(pack.exit_code, 0);
    assert_eq!(pack.emitted_output.matches("// file: src/app.ts").count(), 1);
    assert!(pack.emitted_output.contains("inc("));
    assert!(pack.emitted_output.contains("reset("));
    assert_eq!(pack.multi_files, vec!["src/app.ts"]);
    assert_eq!(pack.raw_baseline.len(), app_ts.len());

    // 2. Explicit selectors alongside bare Full are preserved when !op.full (F-10),
    //    while explicit --full still subsumes selectors.
    for args in [
        vec!["src/big.ts:L1-L5", "src/big.ts"],
        vec!["src/big.ts", "src/big.ts:c_10"],
    ] {
        let p = ws.run_read(read_op(args.clone()));
        assert_eq!(p.exit_code, 0);
        assert_eq!(p.emitted_output.matches("// file: src/big.ts").count(), 1);
        assert!(!p.emitted_output.contains("Auto-outlined src/big.ts"), "{}", p.emitted_output);
        assert!(
            p.emitted_output.contains("c_1") || p.emitted_output.contains("c_10"),
            "{}",
            p.emitted_output
        );

        let mut full_op = read_op(args);
        full_op.full = true;
        let pf = ws.run_read(full_op);
        assert_eq!(pf.exit_code, 0);
        assert!(pf.emitted_output.contains("c_200"), "explicit --full should emit full file");
    }

    // Dir + specific symbol in both orders: preserves symbol when !op.full, subsumes when op.full
    for args in [vec!["src", "src/app.ts:App.inc"], vec!["src/app.ts:App.inc", "src"]] {
        let p = ws.run_read(read_op(args.clone()));
        assert_eq!(p.exit_code, 0);
        assert_eq!(p.emitted_output.matches("// file: src/app.ts").count(), 1);
        assert!(p.emitted_output.contains("inc("), "{}", p.emitted_output);

        let mut full_op = read_op(args);
        full_op.full = true;
        let pf = ws.run_read(full_op);
        assert_eq!(pf.exit_code, 0);
        assert!(pf.emitted_output.contains("reset("), "explicit --full should subsume inc: {}", pf.emitted_output);
    }

    // Inverted range still fails closed even with Full
    let inv = ws.run_read(read_op(vec!["src/app.ts:L50-L10", "src/app.ts"]));
    assert_eq!(inv.exit_code, 1);

    // 3. Comma-separated overlapping & adjacent LineRanges merge
    let overlap = ws.run_read(read_op(vec!["src/lines.txt:L1-L20,L10-L30"]));
    assert_eq!(overlap.emitted_output.matches("// slice: L1-L30").count(), 1);
    assert!(!overlap.emitted_output.contains("// slice: L1-L20"));

    let adjacent = ws.run_read(read_op(vec!["src/lines.txt:L1-L10,L11-L20"]));
    assert_eq!(adjacent.emitted_output.matches("// slice: L1-L20").count(), 1);

    let disjoint = ws.run_read(read_op(vec!["src/lines.txt:L1-L5,L20-L25"]));
    assert!(disjoint.emitted_output.contains("// slice: L1-L5"));
    assert!(disjoint.emitted_output.contains("// slice: L20-L25"));

    // 4. Symbol-span containment & Symbol dedup (. vs ::, @first vs None)
    let sym_contained = ws.run_read(read_op(vec![
        "src/app.ts:App.inc",
        "src/app.ts:L4-L6",
        "src/app.ts:App.inc@branch",
        "src/app.ts:App::inc",
        "src/app.ts:App.inc@first",
        "src/app.ts:L1-L2",
    ]));
    assert_eq!(sym_contained.exit_code, 0);
    assert_eq!(sym_contained.emitted_output.matches("fn inc(").count(), 1, "{}", sym_contained.emitted_output);
    assert!(!sym_contained.emitted_output.contains("// slice: L4-L6"));
    assert!(sym_contained.emitted_output.contains("// slice: L1-L2"));

    // 5. Coalescing + --json + --deps never double-counts raw_baseline
    let mut json_op = read_op(vec!["src/app.ts:App.inc", "src/app.ts:App.reset"]);
    json_op.json = true;
    json_op.include_deps = true;
    let jp = ws.run_read(json_op);
    assert_eq!(jp.exit_code, 0);
    assert_eq!(jp.raw_baseline.len(), app_ts.len());
    assert_eq!(jp.multi_files, vec!["src/app.ts"]);
}

#[test]
fn glob_expansion_in_read_matches_ignores_links_and_handles_binary_and_empty() {
    let ws = TempDir::new("glob");
    ws.write(".gitignore", "src/ignored.ts\n");
    ws.write("src/a.ts", "export function alpha(): number { return 1; }\n");
    ws.write("src/b.ts", "export function beta(): number { return 2; }\n");
    ws.write("src/nested/c.rs", "pub fn gamma() -> i32 { 3 }\n");
    ws.write("src/ignored.ts", "export function secret(): number { return 99; }\n");
    ws.write("src/[id].ts", "export function dynRoute(): number { return 7; }\n");
    ws.write("src/foo.rs", "pub fn top_foo() -> i32 { 1 }\n");
    ws.write("src/sub/barfoo.rs", "pub fn bar_foo() -> i32 { 2 }\n");
    ws.write_bytes("assets/logo.png", b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR");

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(ws.root.join("src/a.ts"), ws.root.join("src/link_a.ts"))
            .expect("create link");
    }

    // **/ boundary check
    assert!(glob_matches("src/**/foo.rs", "src/foo.rs"));
    assert!(glob_matches("src/**/foo.rs", "src/nested/foo.rs"));
    assert!(!glob_matches("src/**/foo.rs", "src/sub/barfoo.rs"));

    // Brace + glob with line selector
    let brace = ws.run_read(read_op(vec!["src/{a,b}.ts:L1"]));
    assert_eq!(brace.exit_code, 0);
    assert_eq!(brace.multi_files, vec!["src/a.ts", "src/b.ts"]);
    assert!(brace.emitted_output.contains("alpha"));
    assert!(brace.emitted_output.contains("beta"));

    // Recursive glob with symbol selector (skips ignored & links)
    let rec = ws.run_read(read_op(vec!["src/**/*.rs:gamma"]));
    assert_eq!(rec.exit_code, 0);
    assert_eq!(rec.multi_files, vec!["src/nested/c.rs"]);
    assert!(rec.emitted_output.contains("gamma"));

    let all_ts = ws.run_read(read_op(vec!["src/*.ts"]));
    assert_eq!(all_ts.exit_code, 0);
    assert!(!all_ts.multi_files.contains(&"src/ignored.ts".to_string()));
    assert!(!all_ts.multi_files.contains(&"src/link_a.ts".to_string()));

    // Literal filename containing '[' still resolves directly
    let lit = ws.run_read(read_op(vec!["src/[id].ts"]));
    assert_eq!(lit.exit_code, 0);
    assert!(lit.emitted_output.contains("dynRoute"));

    // Binary glob expands to actual matched files (not fake "assets/*.png (0 bytes)")
    let bin = ws.run_read(read_op(vec!["assets/*.png"]));
    assert_eq!(bin.exit_code, 0);
    assert!(bin.emitted_output.contains("assets/logo.png"));
    assert!(!bin.emitted_output.contains("assets/*.png"));

    // Unmatched glob returns clean error without fuzzy fallback
    ws.write("src/nonexistent_other.ts", "export const x = 1;\n");
    let empty = ws.run_read(read_op(vec!["src/*.nonexistent"]));
    assert_eq!(empty.exit_code, 1);
    assert!(empty.stderr_output.contains("No files matched glob: src/*.nonexistent"));
    assert!(empty.emitted_output.is_empty());
}

#[test]
fn water_fill_budget_prevents_starvation_respects_topo_and_honest_baseline() {
    assert_eq!(water_fill_quotas(&[400, 100], 220), vec![120, 100]);

    let ws = TempDir::new("budget_fill");
    let mut big_ts = String::from("export class BigEngine {\n");
    for i in 1..=12 {
        big_ts.push_str(&format!(
            "  public computeStep{i}(val: number): number {{\n    let acc = val * {i};\n    if (acc > 10) {{\n      acc += {i} * 2;\n    }}\n    return acc + 1;\n  }}\n"
        ));
    }
    big_ts.push_str("}\n");
    let math_ts = "export function add(a: number, b: number): number { return a + b; }\nexport function mul(a: number, b: number): number { return a * b; }\n";
    ws.write("src/big.ts", &big_ts);
    ws.write("src/math.ts", math_ts);

    let mut op = read_op(vec!["src/big.ts", "src/math.ts"]);
    op.full = true;
    op.max_tokens = Some(260);
    let p1 = ws.run_read(op.clone());
    let p2 = ws.run_read(op);
    assert_eq!(p1.exit_code, 0);
    assert_eq!(p1.emitted_output, p2.emitted_output);
    assert!(count_cl100k_exact(&p1.emitted_output) <= 260);
    assert!(p1.emitted_output.contains("compacted to :outline"), "{}", p1.emitted_output);
    assert!(p1.emitted_output.contains("fn add("), "{}", p1.emitted_output);
    assert!(p1.emitted_output.contains("fn mul("), "{}", p1.emitted_output);

    // --deps priority preserves schema/types before callers/tests
    ws.write("src/types.ts", "export interface LedgerRecord { id: string; amount: number; }\n");
    ws.write(
        "src/service.ts",
        "import { LedgerRecord } from \"./types\";\nexport class LedgerService {\n  public format(r: LedgerRecord): string { return `${r.id}:${r.amount}`; }\n}\n",
    );
    ws.write(
        "src/handler.spec.ts",
        "import { LedgerService } from \"./service\";\nexport function testA(): string { return new LedgerService().format({ id: \"1\", amount: 1 }); }\nexport function testB(): string { return new LedgerService().format({ id: \"2\", amount: 2 }); }\nexport function testC(): string { return new LedgerService().format({ id: \"3\", amount: 3 }); }\n",
    );
    let mut dep_op = read_op(vec!["src/service.ts"]);
    dep_op.include_deps = true;
    dep_op.include_callers = true;
    dep_op.max_tokens = Some(130);
    let dep_pack = ws.run_read(dep_op);
    assert_eq!(dep_pack.exit_code, 0);
    assert!(count_cl100k_exact(&dep_pack.emitted_output) <= 130);
    assert!(dep_pack.emitted_output.contains("LedgerRecord"));

    // Extreme tight budget & max_tokens == 0 honest telemetry
    let mut tight = read_op(vec!["src/big.ts", "src/math.ts"]);
    tight.max_tokens = Some(30);
    let tp = ws.run_read(tight);
    assert_eq!(tp.exit_code, 0);
    assert!(count_cl100k_exact(&tp.emitted_output) <= 30);

    let mut zero_op = read_op(vec!["src/big.ts", "src/math.ts"]);
    zero_op.max_tokens = Some(0);
    let zp = ws.run_read(zero_op);
    assert_eq!(zp.exit_code, 0);
    assert!(zp.emitted_output.is_empty(), "{}", zp.emitted_output);
    assert_eq!(count_cl100k_exact(&zp.emitted_output), 0);
    assert!(zp.raw_baseline.is_empty(), "omitted targets must not inflate raw_baseline");
    assert!(zp.realistic_native_payload.is_none());
    assert!(zp.multi_files.is_empty());
}

#[test]
fn regex_windows_find_dot_slash_search_max_tokens_zero_and_project_domain() {
    let ws = TempDir::new("caveats");
    let mut big_txt = String::new();
    for i in 1..=200 {
        if i == 5 || i == 190 {
            big_txt.push_str(&format!("NEEDLE_HIT line {i}\n"));
        } else {
            big_txt.push_str(&format!("filler line {i}\n"));
        }
    }
    ws.write("src/big.txt", &big_txt);
    let mut big_ts = String::new();
    for i in 1..=200 {
        if i == 5 || i == 9 {
            big_ts.push_str(&format!("export const hit_{i} = {i}; // NEEDLE_ADJ\n"));
        } else if i == 190 {
            big_ts.push_str("export const far_190 = 190; // NEEDLE_TS\n");
        } else {
            big_ts.push_str(&format!("export const pad_{i} = {i};\n"));
        }
    }
    ws.write("src/big.ts", &big_ts);

    // :/regex/ disjoint windows omit unrequested middle lines
    let rx_txt = ws.run_read(read_op(vec!["src/big.txt:/NEEDLE_HIT/"]));
    assert_eq!(rx_txt.exit_code, 0);
    assert!(rx_txt.emitted_output.contains("// slice: L3-L7"));
    assert!(rx_txt.emitted_output.contains("// slice: L188-L192"));
    assert!(!rx_txt.emitted_output.contains("filler line 100"));
    let rn = rx_txt.realistic_native_payload.as_deref().unwrap_or("");
    assert!(!rn.contains("filler line 100"));

    // Adjacent matches merge (L5 + L9 with pad=2 -> L3-L11)
    let mut rx_ts_op = read_op(vec!["src/big.ts:/NEEDLE_ADJ/"]);
    rx_ts_op.context_lines = Some(2);
    let rx_ts = ws.run_read(rx_ts_op);
    assert_eq!(rx_ts.exit_code, 0);
    assert!(!rx_ts.emitted_output.contains("// slice: L"));
    assert!(rx_ts.emitted_output.contains("hit_5"));
    assert!(rx_ts.emitted_output.contains("hit_9"));

    // find ./src "sub/*.ts" & "./src/*.ts"
    ws.write("src/sub/deep.ts", "export const d = 1;\n");
    for (targets, pat) in [
        (vec!["./src".into()], Some("sub/*.ts".into())),
        (vec!["./src/".into()], Some("sub/*.ts".into())),
        (vec!["./".into()], Some("src/*.ts".into())),
        (vec!["./src".into()], Some("./sub/*.ts".into())),
    ] {
        let fp = ws.run_find(FindOp {
            pattern: pat,
            targets,
            target_paths: Vec::new(),
            depth: None,
            search: None,
            full: false,
            max_tokens: None,
            json: false,
        });
        assert!(fp.emitted_output.contains("deep.ts") || fp.emitted_output.contains("big.ts"), "{}", fp.emitted_output);
    }

    // search --max-tokens 0 (text & json)
    for json in [false, true] {
        let sp = ws.run_search(SearchOp {
            pattern: "NEEDLE_TS".into(),
            targets: vec!["src/big.ts".into()],
            target_paths: Vec::new(),
            context_lines: None,
            line_numbers: false,
            symbol: None,
            files_with_matches: false,
            full: false,
            max_tokens: Some(0),
            json,
            stats: false,
        });
        assert_eq!(sp.exit_code, 0);
        assert!(sp.emitted_output.contains("// +1 more matching files"), "{}", sp.emitted_output);
        assert!(!sp.emitted_output.contains("far_190"), "{}", sp.emitted_output);
    }

    // Rust lifetimes in balance_closers_for_lang
    let rust_frag = "fn f<'a, 'static>(x: &'a str) {\n    if x == '}' || x == '\\'' || x == '🦀' {\n        'outer: loop {\n            let y = (1 + 2;\n";
    let balanced = balance_closers_for_lang(LanguageId::Rust, rust_frag);
    assert!(balanced.ends_with(")\n}\n}\n}\n"), "balanced:\n{balanced}");

    // Shell, DbMigration, and Doc partial :L windows preserve items inside window
    ws.write("scripts/run.sh", "#!/usr/bin/env bash\nset -euo pipefail\nbuild_it() {\n  echo \"step1\"\n  echo \"step2\"\n}\n");
    ws.write("db/001.sql", "-- +goose Up\nCREATE TABLE users (id INT PRIMARY KEY);\nCREATE TABLE posts (id INT PRIMARY KEY);\n-- +goose Down\nDROP TABLE posts;\n");
    ws.write("docs/guide.md", "# Title\n\nIntro paragraph.\n\n## Details\n\nDeep detail line.\n");

    let sh_p = ws.run_read(read_op(vec!["scripts/run.sh:L4-L5"]));
    assert!(sh_p.emitted_output.contains("step1"), "{}", sh_p.emitted_output);

    let db_p = ws.run_read(read_op(vec!["db/001.sql:L3-L3"]));
    assert!(db_p.emitted_output.contains("posts"), "{}", db_p.emitted_output);

    let md_p = ws.run_read(read_op(vec!["docs/guide.md:L5-L7"]));
    assert!(md_p.emitted_output.contains("Details"), "{}", md_p.emitted_output);
    assert!(md_p.emitted_output.contains("Deep detail line"), "{}", md_p.emitted_output);
}

#[test]
fn iteration2_tight_budget_honesty_windows_find_globs_coalesce_and_raw_strings() {
    let ws = TempDir::new("iter2_fixes");
    let long_rel = "src/deeply/nested/very_long_component_filename_alpha.ts";
    ws.write(
        long_rel,
        "export function alphaLong(a: number, b: number): number {\n  return a + b + 1 + 2 + 3 + 4 + 5;\n}\n",
    );
    ws.write("src/small.ts", "export const smallVal = 42;\n");
    ws.write(
        "src/very_long_directory_path/beta_service_handler.ts",
        "export function betaNeedle(v: number): number { return v + 1; }\nexport const extraNeedle = 2;\n",
    );
    ws.write(
        "src/app.ts",
        "export class App {\n  private count = 0;\n  public inc(n: number): number { return this.count + n; }\n  public reset(): number { this.count = 0; return 0; }\n}\n",
    );

    // 1. Tight-budget telemetry honesty: wiped long-header file must NOT populate multi_files/raw_baseline
    for mt in [15usize, 5, 1, 0] {
        let mut op = read_op(vec![long_rel, "src/small.ts"]);
        op.max_tokens = Some(mt);
        let p = ws.run_read(op);
        assert_eq!(p.exit_code, 0);
        assert!(
            count_cl100k_exact(&p.emitted_output) <= mt,
            "read max_tokens={mt} overflowed: {}",
            p.emitted_output
        );
        if mt <= 15 {
            assert!(p.multi_files.is_empty(), "mt={mt}: {:?}\n{}", p.multi_files, p.emitted_output);
            assert!(p.raw_baseline.is_empty(), "mt={mt}: {}", p.raw_baseline);
            assert!(p.realistic_native_payload.is_none());
            assert!(!p.emitted_output.contains("// ... [truncated]"));
        }
    }

    // At max_tokens = 30, long_rel header+notice exceeds 15-tok quota while src/small.ts survives honestly
    let mut op30 = read_op(vec![long_rel, "src/small.ts"]);
    op30.max_tokens = Some(30);
    let p30 = ws.run_read(op30);
    assert_eq!(p30.exit_code, 0);
    assert!(count_cl100k_exact(&p30.emitted_output) <= 30, "{}", p30.emitted_output);
    assert_eq!(p30.multi_files, vec!["src/small.ts"]);
    assert!(!p30.raw_baseline.contains("alphaLong"));
    assert!(p30.emitted_output.contains("// file: src/small.ts"));

    // 2. Strict <= max_tokens on search (15, 5, 1, and -l) and find (15, 5, 0)
    for mt in [15usize, 5, 1] {
        let sp = ws.run_search(SearchOp {
            pattern: "Needle".into(),
            targets: Vec::new(),
            target_paths: Vec::new(),
            context_lines: None,
            line_numbers: false,
            symbol: None,
            files_with_matches: false,
            full: false,
            max_tokens: Some(mt),
            json: false,
            stats: false,
        });
        assert_eq!(sp.exit_code, 0);
        assert!(
            count_cl100k_exact(&sp.emitted_output) <= mt,
            "search max_tokens={mt} overflowed: {}",
            sp.emitted_output
        );
    }
    let sl = ws.run_search(SearchOp {
        pattern: "Needle".into(),
        targets: Vec::new(),
        target_paths: Vec::new(),
        context_lines: None,
        line_numbers: false,
        symbol: None,
        files_with_matches: true,
        full: false,
        max_tokens: Some(5),
        json: false,
        stats: false,
    });
    assert!(count_cl100k_exact(&sl.emitted_output) <= 5, "{}", sl.emitted_output);

    for i in 0..10 {
        ws.write(&format!("src/pad_{i}.ts"), "export const pad = 1;\n");
    }
    for mt in [15usize, 5, 0] {
        let fp = ws.run_find(FindOp {
            pattern: None,
            targets: Vec::new(),
            target_paths: Vec::new(),
            depth: None,
            search: None,
            full: false,
            max_tokens: Some(mt),
            json: false,
        });
        assert_eq!(fp.exit_code, 0);
        assert!(
            count_cl100k_exact(&fp.emitted_output) <= mt,
            "find max_tokens={mt} overflowed: {}",
            fp.emitted_output
        );
    }

    // 3. find ".\\src\\" and read --files ".\\src\\" on Linux
    ws.write("src/sub/deep.ts", "export const deep = 1;\n");
    let fp_win = ws.run_find(FindOp {
        pattern: None,
        targets: vec![".\\src\\".into()],
        target_paths: Vec::new(),
        depth: None,
        search: None,
        full: false,
        max_tokens: None,
        json: false,
    });
    assert!(fp_win.emitted_output.contains("deep.ts"), "{}", fp_win.emitted_output);
    let mut rf_win = read_op(vec![".\\src\\"]);
    rf_win.files_only = true;
    let rp_win = ws.run_read(rf_win);
    assert!(rp_win.emitted_output.contains("deep.ts"), "{}", rp_win.emitted_output);

    // 4a. Brace glob with dot-dir (.github, .env) & nested braces
    ws.write(".github/ci.yml", "name: ci\n");
    ws.write("ci/deploy.yml", "name: deploy\n");
    ws.write("src/.env", "SECRET=1\n");
    ws.write("src/a.ts", "export const a = 1;\n");
    ws.write("src/b.ts", "export const b = 2;\n");
    ws.write("src/c.ts", "export const c = 3;\n");

    let dot_brace = ws.run_read(read_op(vec!["{.github,ci}/*.yml"]));
    assert_eq!(dot_brace.exit_code, 0, "{}", dot_brace.stderr_output);
    assert_eq!(dot_brace.multi_files, vec![".github/ci.yml", "ci/deploy.yml"]);

    let env_brace = ws.run_read(read_op(vec!["src/{.env,a.ts}"]));
    assert_eq!(env_brace.exit_code, 0, "{}", env_brace.stderr_output);
    assert_eq!(env_brace.multi_files, vec!["src/.env", "src/a.ts"]);

    assert!(glob_matches("src/{a,{b,c}}.ts", "src/a.ts"));
    assert!(glob_matches("src/{a,{b,c}}.ts", "src/b.ts"));
    assert!(glob_matches("src/{a,{b,c}}.ts", "src/c.ts"));
    let nested_brace = ws.run_read(read_op(vec!["src/{a,{b,c}}.ts"]));
    assert_eq!(nested_brace.exit_code, 0, "{}", nested_brace.stderr_output);
    assert_eq!(nested_brace.multi_files, vec!["src/a.ts", "src/b.ts", "src/c.ts"]);

    // 4b. Coalesce qualified+unqualified and parent+child symbol selectors
    let q_unq = ws.run_read(read_op(vec!["src/app.ts:App.inc", "src/app.ts:inc"]));
    assert_eq!(q_unq.emitted_output.matches("fn inc(").count(), 1, "{}", q_unq.emitted_output);

    for pair in [vec!["src/app.ts:App", "src/app.ts:App.inc"], vec!["src/app.ts:App.inc", "src/app.ts:App"]] {
        let pc = ws.run_read(read_op(pair));
        assert_eq!(pc.emitted_output.matches("inc(").count(), 1, "{}", pc.emitted_output);
        assert!(pc.emitted_output.contains("class App"), "{}", pc.emitted_output);
    }

    // 4c. Rust raw strings containing escaped quote in balance_closers_for_lang
    let raw_rust = "fn h() {\n    let s = r#\"{{(\\\"#;\n    let x = (1;\n";
    let bal = balance_closers_for_lang(LanguageId::Rust, raw_rust);
    assert!(bal.ends_with(")\n}\n"), "bal:\n{bal}");
}

#[test]
fn short_path_tight_budget_never_emits_zero_content_stub() {
    let ws = TempDir::new("short_stub");
    ws.write(
        "src/a.ts",
        "export function computeTotalValue(alpha: number, beta: number, gamma: number): number {\n  return alpha + beta + gamma;\n}\n",
    );
    ws.write(
        "src/b.ts",
        "export function computeOtherValue(delta: number, epsilon: number): number {\n  return delta * epsilon;\n}\n",
    );
    for mt in [12usize, 15, 18] {
        let mut op = read_op(vec!["src/a.ts"]);
        op.max_tokens = Some(mt);
        let p = ws.run_read(op);
        assert_eq!(p.exit_code, 0);
        assert!(count_cl100k_exact(&p.emitted_output) <= mt, "mt={mt}: {}", p.emitted_output);
        assert!(p.multi_files.is_empty(), "mt={mt}: {:?}\n{}", p.multi_files, p.emitted_output);
        assert!(p.raw_baseline.is_empty(), "mt={mt}: {}", p.raw_baseline);
        assert!(!p.emitted_output.contains("// file: src/a.ts"), "mt={mt}: {}", p.emitted_output);
    }

    // Two short-path files where post-join loop trims down under 22 tokens: neither emits 0-content stub
    let mut multi_op = read_op(vec!["src/a.ts", "src/b.ts"]);
    multi_op.max_tokens = Some(22);
    let mp = ws.run_read(multi_op);
    assert_eq!(mp.exit_code, 0);
    assert!(count_cl100k_exact(&mp.emitted_output) <= 22, "{}", mp.emitted_output);
    assert!(
        !mp.emitted_output.contains("// file: src/a.ts\n// ..."),
        "0-content stub leaked: {}",
        mp.emitted_output
    );
    assert!(
        !mp.emitted_output.contains("// file: src/b.ts\n// ..."),
        "0-content stub leaked: {}",
        mp.emitted_output
    );
}

#[test]
fn tight_budget_preserves_user_module_reflows_trailing_and_drops_comment_only_stubs() {
    let ws = TempDir::new("iter2_budget_edge");
    ws.write("a.txt", "module foo\nbar\nbaz\nqux\n");
    ws.write(
        "a.rb",
        "module MyMod\n  def alpha\n    1\n  end\n  def beta\n    2\n  end\nend\n",
    );
    ws.write(
        "src/deep/very_long_directory_path_for_header/alpha_service.ts",
        "export function alphaService(x: number): number { return x + 1; }\n",
    );
    ws.write("z.txt", "hi\n");
    ws.write("c.ts", "// comment only\n");
    ws.write("z.ts", "export const z = 1;\n");

    // 1. PlainText `module foo` is preserved at max_tokens = 12
    let mut txt_op = read_op(vec!["a.txt"]);
    txt_op.max_tokens = Some(12);
    let txt_pack = ws.run_read(txt_op);
    assert_eq!(txt_pack.exit_code, 0);
    assert!(count_cl100k_exact(&txt_pack.emitted_output) <= 12, "{}", txt_pack.emitted_output);
    assert!(txt_pack.emitted_output.contains("module foo"), "{}", txt_pack.emitted_output);

    // 2. Ruby `module MyMod` is preserved at max_tokens = 16
    let mut rb_op = read_op(vec!["a.rb"]);
    rb_op.max_tokens = Some(16);
    let rb_pack = ws.run_read(rb_op);
    assert_eq!(rb_pack.exit_code, 0);
    assert!(count_cl100k_exact(&rb_pack.emitted_output) <= 16, "{}", rb_pack.emitted_output);
    assert!(rb_pack.emitted_output.contains("module MyMod"), "{}", rb_pack.emitted_output);

    // 3. Leading long-path drop allows small trailing `z.txt` to reflow at max_tokens = 22
    let mut reflow_op = read_op(vec![
        "src/deep/very_long_directory_path_for_header/alpha_service.ts",
        "z.txt",
    ]);
    reflow_op.max_tokens = Some(22);
    let reflow_pack = ws.run_read(reflow_op);
    assert_eq!(reflow_pack.exit_code, 0);
    assert!(count_cl100k_exact(&reflow_pack.emitted_output) <= 22, "{}", reflow_pack.emitted_output);
    assert_eq!(reflow_pack.multi_files, vec!["z.txt"]);
    assert!(reflow_pack.emitted_output.contains("// file: z.txt\nhi\n"), "{}", reflow_pack.emitted_output);
    assert!(reflow_pack.emitted_output.contains("omitted"), "{}", reflow_pack.emitted_output);

    // 4. Comment-only `c.ts` must not survive as a 0-content `module typescript` stub at max_tokens = 10
    let mut cmt_op = read_op(vec!["c.ts", "z.ts"]);
    cmt_op.max_tokens = Some(10);
    let cmt_pack = ws.run_read(cmt_op);
    assert_eq!(cmt_pack.exit_code, 0);
    assert!(count_cl100k_exact(&cmt_pack.emitted_output) <= 10, "{}", cmt_pack.emitted_output);
    assert!(!cmt_pack.emitted_output.contains("// file: c.ts"), "{}", cmt_pack.emitted_output);
    assert!(!cmt_pack.multi_files.contains(&"c.ts".to_string()), "{:?}", cmt_pack.multi_files);
}

#[test]
fn budget_fill_monotonic_no_dead_zones_across_tight_budgets() {
    let ws = TempDir::new("budget_monotonic");
    ws.write("c.ts", "// comment only\n");
    ws.write("z.ts", "export const z = 1;\n");
    ws.write("src/a.ts", "export const a = 1;\n");
    let big_src: String = (0..15)
        .map(|i| format!("export function fn{i}(x: number): number {{ return x + {i}; }}\n"))
        .collect();
    ws.write("big.ts", &big_src);

    for mt in 14..=26 {
        let mut op = read_op(vec!["c.ts", "z.ts"]);
        op.max_tokens = Some(mt);
        let pack = ws.run_read(op);
        assert_eq!(pack.exit_code, 0);
        assert!(count_cl100k_exact(&pack.emitted_output) <= mt, "c+z mt={mt}: {}", pack.emitted_output);
        assert!(
            !pack.multi_files.is_empty(),
            "dead zone for c.ts+z.ts at mt={mt}: {}",
            pack.emitted_output
        );
        assert!(pack.multi_files.contains(&"z.ts".to_string()), "c+z mt={mt}: {:?}", pack.multi_files);
    }

    for mt in 15..=31 {
        let mut op = read_op(vec!["big.ts", "src/a.ts"]);
        op.max_tokens = Some(mt);
        let pack = ws.run_read(op);
        assert_eq!(pack.exit_code, 0);
        assert!(
            count_cl100k_exact(&pack.emitted_output) <= mt,
            "big+a mt={mt}: {}",
            pack.emitted_output
        );
        assert!(
            !pack.multi_files.is_empty(),
            "dead zone for big.ts+src/a.ts at mt={mt}: {}",
            pack.emitted_output
        );
    }
}

#[test]
fn c2_g1_g3_g4_unreadable_perm_search_tight_budget_and_stats_enforcement() {
    let ws = TempDir::new("c2_g134");
    for i in 0..5 {
        ws.write(
            &format!("mod_{i}.rs"),
            &format!("pub fn fn_{i}(needle: usize) -> usize {{\n    needle + {i}\n}}\n"),
        );
    }
    let big_rs: String = (0..25)
        .map(|i| format!("pub fn big_fn_{i}(x: usize) -> usize {{ x + {i} }}\n"))
        .collect();
    ws.write("big.rs", &big_rs);

    // C2-G1: 0o000 unreadable .rs fails closed instead of binary skip
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        ws.write("unreadable.rs", "pub fn secret() {}\n");
        let p = ws.root.join("unreadable.rs");
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o000)).unwrap();
        let pack = ws.run_read(read_op(vec!["unreadable.rs"]));
        let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o644));
        assert_eq!(pack.exit_code, 1);
        assert!(pack.stderr_output.contains("Failed reading unreadable.rs"), "{}", pack.stderr_output);
        assert!(!pack.emitted_output.contains("binary file skipped"), "{}", pack.emitted_output);
    }

    // C2-G3: Tight non-zero --max-tokens in search never emits 0-content stubs or fake multi_files/raw_baseline
    let s15 = ws.run_search(SearchOp {
        pattern: "needle".into(),
        targets: vec![],
        target_paths: vec![],
        context_lines: None,
        line_numbers: true,
        symbol: None,
        files_with_matches: false,
        full: false,
        max_tokens: Some(15),
        json: false,
        stats: false,
    });
    assert_eq!(s15.exit_code, 0);
    assert!(count_cl100k_exact(&s15.emitted_output) <= 15, "{}", s15.emitted_output);
    assert!(s15.emitted_output.contains("// +5 more"), "{}", s15.emitted_output);
    assert!(!s15.emitted_output.contains("mod_0.rs:\n// +"), "{}", s15.emitted_output);
    assert!(s15.multi_files.is_empty(), "{:?}", s15.multi_files);
    assert!(s15.raw_baseline.is_empty(), "{}", s15.raw_baseline);

    let s15_json = ws.run_search(SearchOp {
        pattern: "needle".into(),
        targets: vec![],
        target_paths: vec![],
        context_lines: None,
        line_numbers: true,
        symbol: None,
        files_with_matches: false,
        full: false,
        max_tokens: Some(15),
        json: true,
        stats: false,
    });
    assert_eq!(s15_json.exit_code, 0);
    assert!(s15_json.emitted_output.contains("\"count\": 0"), "{}", s15_json.emitted_output);
    assert!(s15_json.emitted_output.contains("\"files\": []"), "{}", s15_json.emitted_output);

    let sl5 = ws.run_search(SearchOp {
        pattern: "needle".into(),
        targets: vec![],
        target_paths: vec![],
        context_lines: None,
        line_numbers: false,
        symbol: None,
        files_with_matches: true,
        full: false,
        max_tokens: Some(5),
        json: false,
        stats: false,
    });
    assert_eq!(sl5.exit_code, 0);
    assert!(count_cl100k_exact(&sl5.emitted_output) <= 5, "{}", sl5.emitted_output);
    assert!(sl5.multi_files.is_empty(), "{:?}", sl5.multi_files);
    assert!(sl5.raw_baseline.is_empty(), "{}", sl5.raw_baseline);

    let sl5_json = ws.run_search(SearchOp {
        pattern: "needle".into(),
        targets: vec![],
        target_paths: vec![],
        context_lines: None,
        line_numbers: false,
        symbol: None,
        files_with_matches: true,
        full: false,
        max_tokens: Some(5),
        json: true,
        stats: false,
    });
    assert_eq!(sl5_json.exit_code, 0);
    assert!(sl5_json.emitted_output.contains("\"count\": 0"), "{}", sl5_json.emitted_output);

    let sl60_json = ws.run_search(SearchOp {
        pattern: "needle".into(),
        targets: vec![],
        target_paths: vec![],
        context_lines: None,
        line_numbers: false,
        symbol: None,
        files_with_matches: true,
        full: false,
        max_tokens: Some(60),
        json: true,
        stats: false,
    });
    assert_eq!(sl60_json.exit_code, 0);
    assert!(count_cl100k_exact(&sl60_json.emitted_output) <= 60, "{}", sl60_json.emitted_output);
    assert!(!sl60_json.multi_files.is_empty() && sl60_json.multi_files.len() < 5, "{:?}", sl60_json.multi_files);

    // C2-G4: --stats with --max-tokens N never overflows N for read or search
    for mt in [0usize, 25, 80] {
        let mut rop = read_op(vec!["big.rs", "mod_0.rs"]);
        rop.max_tokens = Some(mt);
        rop.stats = true;
        let rpack = ws.run_read(rop);
        assert_eq!(rpack.exit_code, 0);
        assert!(
            count_cl100k_exact(&rpack.emitted_output) <= mt,
            "read --stats mt={mt} overflowed: {}",
            rpack.emitted_output
        );
        if mt == 80 {
            assert!(rpack.emitted_output.contains("Context Pack Token Telemetry"), "{}", rpack.emitted_output);
        }
    }
    for mt in [0usize, 15, 80] {
        let spack = ws.run_search(SearchOp {
            pattern: "needle".into(),
            targets: vec![],
            target_paths: vec![],
            context_lines: None,
            line_numbers: true,
            symbol: None,
            files_with_matches: false,
            full: false,
            max_tokens: Some(mt),
            json: false,
            stats: true,
        });
        assert_eq!(spack.exit_code, 0);
        if mt > 0 {
            assert!(
                count_cl100k_exact(&spack.emitted_output) <= mt,
                "search --stats mt={mt} overflowed: {}",
                spack.emitted_output
            );
        } else {
            assert!(!spack.emitted_output.contains("Context Pack Token Telemetry"));
        }
        if mt == 80 {
            assert!(spack.emitted_output.contains("Context Pack Token Telemetry"), "{}", spack.emitted_output);
        }
    }

    // C2-R2-G1: `module <lang>` / `# L...` directives must not count as matched hit content
    for i in 0..5 {
        ws.write(
            &format!("rust_hit_{i}.rs"),
            &format!("pub fn rust_fn_{i}() -> usize {{ /* needle_marker */ {i} }}\n"),
        );
    }
    let r15 = ws.run_search(SearchOp {
        pattern: "needle_marker".into(),
        targets: vec![],
        target_paths: vec![],
        context_lines: None,
        line_numbers: true,
        symbol: None,
        files_with_matches: false,
        full: false,
        max_tokens: Some(15),
        json: false,
        stats: false,
    });
    assert_eq!(r15.exit_code, 0);
    assert!(!r15.emitted_output.contains("  module "), "{}", r15.emitted_output);
    assert!(r15.multi_files.is_empty(), "{:?}", r15.multi_files);
    assert!(r15.raw_baseline.is_empty(), "{}", r15.raw_baseline);

    let r15_json = ws.run_search(SearchOp {
        pattern: "needle_marker".into(),
        targets: vec![],
        target_paths: vec![],
        context_lines: None,
        line_numbers: true,
        symbol: None,
        files_with_matches: false,
        full: false,
        max_tokens: Some(15),
        json: true,
        stats: false,
    });
    assert!(r15_json.emitted_output.contains("\"count\": 0"), "{}", r15_json.emitted_output);
    assert!(r15_json.emitted_output.contains("\"files\": []"), "{}", r15_json.emitted_output);

    let ts_src: String = (0..10)
        .map(|i| format!("export function tsFn{i}(): number {{ return {i}; }} // TARGET_WORD\n"))
        .collect();
    ws.write("app_target.ts", &ts_src);
    let ts25 = ws.run_search(SearchOp {
        pattern: "TARGET_WORD".into(),
        targets: vec!["app_target.ts".into()],
        target_paths: vec![std::path::PathBuf::from("app_target.ts")],
        context_lines: None,
        line_numbers: true,
        symbol: None,
        files_with_matches: false,
        full: false,
        max_tokens: Some(25),
        json: false,
        stats: false,
    });
    assert_eq!(ts25.exit_code, 0);
    assert!(!ts25.emitted_output.contains("module typescript"), "{}", ts25.emitted_output);
    assert!(ts25.multi_files.is_empty(), "{:?}", ts25.multi_files);
    assert!(ts25.raw_baseline.is_empty(), "{}", ts25.raw_baseline);

    ws.write("single_hit.rs", "pub fn alpha(x: i32) -> i32 { x + 1 } // findme_c2_r2\n");
    let s60_stats = ws.run_search(SearchOp {
        pattern: "findme_c2_r2".into(),
        targets: vec!["single_hit.rs".into()],
        target_paths: vec![std::path::PathBuf::from("single_hit.rs")],
        context_lines: None,
        line_numbers: true,
        symbol: None,
        files_with_matches: false,
        full: false,
        max_tokens: Some(60),
        json: false,
        stats: true,
    });
    assert_eq!(s60_stats.exit_code, 0);
    assert!(count_cl100k_exact(&s60_stats.emitted_output) <= 60, "{}", s60_stats.emitted_output);
    assert!(
        !(s60_stats.multi_files.is_empty() && s60_stats.emitted_output.contains("Context Pack Token Telemetry")),
        "stats appended to 0-hit stub: {}",
        s60_stats.emitted_output
    );
    assert!(!s60_stats.emitted_output.contains("module rust\n// ..."), "{}", s60_stats.emitted_output);
}
