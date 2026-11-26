use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use aice_batch_read::budget::count_cl100k_exact;
use aice_batch_read::regex_compile::{compile_search_pattern, compile_slash_regex};
use aice_batch_read::search::execute_search;
use aice_batch_read::search_rank::score_file_matches;
use aice_batch_read::{BatchReadPack, execute_batch_read};
use aice_governance::{OutputSurface, PipelineRequest, ReadOp, SearchOp, authorize};

static NEXT_ID: AtomicUsize = AtomicUsize::new(1);

struct TempWs {
    root: PathBuf,
}

impl TempWs {
    fn new(tag: &str) -> Self {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "aice_w1_read_{tag}_{}_{}",
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

#[test]
fn f06_regex_preserves_escaped_ere_parens_and_bre_pipe_compat() {
    let slash_exit = compile_slash_regex(r"/exit\(exit_code\)/").expect("slash regex");
    assert!(slash_exit.is_match("std::process::exit(exit_code);"));
    assert!(!slash_exit.is_match("exitexit_code"));

    let slash_main = compile_slash_regex(r"/fn main\(/").expect("slash main");
    assert!(slash_main.is_match("fn main() {"));
    assert!(!slash_main.is_match("fn main {"));

    let slash_pipe = compile_slash_regex(r"/foo\|bar/").expect("slash literal pipe");
    assert!(slash_pipe.is_match("foo|bar"));
    assert!(!slash_pipe.is_match("foo"));

    let bare_call = compile_search_pattern(r"computeItemPowerScore\(item\)", false);
    assert!(bare_call.is_match("const score = computeItemPowerScore(item);"));
    assert!(!bare_call.is_match("computeItemPowerScoreitem"));

    let bre_alt = compile_search_pattern(r"export class\|CREATE TABLE", false);
    assert!(bre_alt.is_match("export class Foo {"));
    assert!(bre_alt.is_match("CREATE TABLE users ("));

    let mixed_pipe = compile_search_pattern(r"foo\|bar|baz", false);
    assert!(mixed_pipe.is_match("foo|bar"));
    assert!(mixed_pipe.is_match("baz"));
    assert!(!mixed_pipe.is_match("foo"));

    let ws = TempWs::new("f06");
    ws.write(
        "src/main.rs",
        "fn main() {\n    let exit_code = 0;\n    std::process::exit(exit_code);\n}\n",
    );
    ws.write(
        "src/save.ts",
        "export function check(item: number): number {\n  return computeItemPowerScore(item);\n}\n",
    );

    let rs_read = ws.run_read(read_op(vec![r"src/main.rs:/fn main\(/"]));
    assert_eq!(rs_read.exit_code, 0);
    assert!(rs_read.emitted_output.contains("main("), "{}", rs_read.emitted_output);
    assert!(!rs_read.emitted_output.contains("no regex matches"));

    let rs_search = ws.run_search(search_op(r"/exit\(exit_code\)/", vec!["src/main.rs"]));
    assert_eq!(rs_search.exit_code, 0);
    assert!(rs_search.emitted_output.contains("exit(exit_code)"), "{}", rs_search.emitted_output);

    let ts_search = ws.run_search(search_op(r"computeItemPowerScore\(item\)", vec!["src/save.ts"]));
    assert_eq!(ts_search.exit_code, 0);
    assert!(
        ts_search.emitted_output.contains("computeItemPowerScore(item)"),
        "{}",
        ts_search.emitted_output
    );
}

#[test]
fn f07_search_compact_line_numbers_no_pass_no_module_and_preserves_call_args() {
    let ws = TempWs::new("f07");
    ws.write(
        "src/math.ts",
        "export interface CalcResult {\n  value: number;\n}\n\nexport class Calculator {\n  public add(a: number, b: number): number {\n    return a + b;\n  }\n}\n",
    );
    ws.write(
        "src/breakpoints.ts",
        "export function isMobile(width: number): boolean {\n  return width < 768;\n}\nexport default function isDesktop(width: number): boolean {\n  return width >= 1200;\n}\n",
    );
    ws.write(
        "src/inventory.ts",
        "export function dismantleProfile(profile: any, rarity: string) {\n  const result = dismantleByRarity(\n    profile.inventory,\n    rarity,\n  );\n  return result;\n}\n",
    );
    ws.write(
        "src/session.rs",
        "pub struct Session {\n    pub id: String,\n}\n\nimpl Session {\n    pub fn make(id: String) -> Self {\n        Session {\n            id,\n        }\n    }\n}\n",
    );

    // B-R2 contract: Calculator must NOT emit raw `export class Calculator`, no `module`, no `pass`, has `L5:`
    let calc = ws.run_search(search_op("Calculator", vec!["src/math.ts"]));
    assert_eq!(calc.exit_code, 0);
    assert!(!calc.emitted_output.contains("export class Calculator"), "{}", calc.emitted_output);
    assert!(!calc.emitted_output.contains("module typescript"), "{}", calc.emitted_output);
    assert!(!calc.emitted_output.contains("\n    pass"), "{}", calc.emitted_output);
    assert!(!calc.emitted_output.contains("\n  pass"), "{}", calc.emitted_output);
    assert!(calc.emitted_output.contains("L5:"), "{}", calc.emitted_output);
    assert!(calc.emitted_output.contains("Calculator"), "{}", calc.emitted_output);

    // Single-line function hits: exact L<n>:, no repeated module <lang>, no fabricated pass
    let bp = ws.run_search(search_op(
        r"/export\s+(default\s+)?function\s+\w+/",
        vec!["src/breakpoints.ts"],
    ));
    assert_eq!(bp.exit_code, 0);
    assert!(!bp.emitted_output.contains("module typescript"), "{}", bp.emitted_output);
    assert!(!bp.emitted_output.contains("pass"), "{}", bp.emitted_output);
    assert!(bp.emitted_output.contains("L1:"), "{}", bp.emitted_output);
    assert!(bp.emitted_output.contains("L4:"), "{}", bp.emitted_output);
    assert!(bp.emitted_output.contains("isMobile"), "{}", bp.emitted_output);
    assert!(bp.emitted_output.contains("isDesktop"), "{}", bp.emitted_output);

    // Multi-line call hit must NOT fabricate 0-arg `dismantleByRarity()`
    let inv = ws.run_search(search_op("dismantleByRarity", vec!["src/inventory.ts"]));
    assert_eq!(inv.exit_code, 0);
    assert!(inv.emitted_output.contains("L2:"), "{}", inv.emitted_output);
    assert!(!inv.emitted_output.contains("dismantleByRarity()"), "{}", inv.emitted_output);
    assert!(inv.emitted_output.contains("dismantleByRarity("), "{}", inv.emitted_output);

    // Rust struct + literal `Session {` gets exact L1: and L7:, no repeated `module rust` or `pass`
    let sess = ws.run_search(search_op("Session {", vec!["src/session.rs"]));
    assert_eq!(sess.exit_code, 0);
    assert!(!sess.emitted_output.contains("module rust"), "{}", sess.emitted_output);
    assert!(!sess.emitted_output.contains("pass"), "{}", sess.emitted_output);
    assert!(sess.emitted_output.contains("L1:"), "{}", sess.emitted_output);
    assert!(sess.emitted_output.contains("L7:"), "{}", sess.emitted_output);
}

#[test]
fn f08_literal_search_matches_substrings_while_boosting_whole_words() {
    let ws = TempWs::new("f08");
    ws.write(
        "src/health.ts",
        "export class HealthCheck {\n  public ok(): boolean { return true; }\n}\n",
    );
    ws.write(
        "src/check.ts",
        "export function Check(): boolean {\n  return true;\n}\n",
    );
    ws.write(
        "src/HeartRateNativePlugin.java",
        "public class HeartRateNativePlugin {\n  public int bpm() { return 72; }\n}\n",
    );

    let sub = ws.run_search(search_op("Check", vec!["src/health.ts"]));
    assert_eq!(sub.exit_code, 0);
    assert!(sub.emitted_output.contains("HealthCheck"), "{}", sub.emitted_output);

    let hr = ws.run_search(search_op("HeartRate", vec!["src/HeartRateNativePlugin.java"]));
    assert_eq!(hr.exit_code, 0);
    assert!(hr.emitted_output.contains("HeartRateNativePlugin"), "{}", hr.emitted_output);

    // Whole-word definition must still rank strictly above substring match
    let both = ws.run_search(search_op("Check", vec![]));
    assert_eq!(both.exit_code, 0);
    let pos_exact = both.emitted_output.find("src/check.ts").expect("check.ts hit");
    let pos_sub = both.emitted_output.find("src/health.ts").expect("health.ts hit");
    assert!(pos_exact < pos_sub, "exact whole-word def must rank #1:\n{}", both.emitted_output);

    let pat = compile_search_pattern("Check", false);
    let (s_exact, _) = score_file_matches("src/a.ts", "Check", &pat, &["const x = Check();"]).unwrap();
    let (s_sub, _) = score_file_matches("src/b.ts", "Check", &pat, &["const x = HealthCheck();"]).unwrap();
    assert!(s_exact > s_sub, "whole-word ({s_exact}) must outrank substring ({s_sub})");
}

#[test]
fn f09_mid_method_and_mid_function_line_slices_emit_requested_body_lines() {
    let ws = TempWs::new("f09");
    // Rust impl method with mid-match tail slice (like src/ipc/mod.rs:L535-L587)
    ws.write(
        "src/ipc.rs",
        "\
pub struct IpcServer {
    pub store: String,
    pub pty_sessions: usize,
}

impl IpcServer {
    pub fn handle_connection(&self, cmd: &str) -> String {
        let mut out = String::new();
        match cmd {
            \"ping\" => {
                out.push_str(\"pong\");
            }
            \"list\" => {
                let sessions = self.store.clone();
                out.push_str(&sessions);
            }
            \"resize\" => {
                let count = self.pty_sessions + 1;
                out.push_str(&count.to_string());
            }
            _ => out.push_str(\"unsupported\"),
        }
        out
    }
}
",
    );
    let rs_mid = ws.run_read(read_op(vec!["src/ipc.rs:L13-L24"]));
    assert_eq!(rs_mid.exit_code, 0);
    assert!(rs_mid.emitted_output.contains("\"list\""), "{}", rs_mid.emitted_output);
    assert!(rs_mid.emitted_output.contains("\"resize\""), "{}", rs_mid.emitted_output);
    assert!(rs_mid.emitted_output.contains("\"unsupported\""), "{}", rs_mid.emitted_output);

    // Clean mid-method slice (valid statements inside a method body)
    ws.write(
        "src/calc.rs",
        "\
pub struct Calc {
    pub base: i32,
}

impl Calc {
    pub fn run(&self, x: i32) -> i32 {
        let a = x + 1;
        let b = a * 2;
        let c = b + self.base;
        let d = c * 3;
        d
    }
}
",
    );
    let rs_clean = ws.run_read(read_op(vec!["src/calc.rs:L9-L12"]));
    assert_eq!(rs_clean.exit_code, 0);
    assert!(rs_clean.emitted_output.contains("c := b + self.base"), "{}", rs_clean.emitted_output);
    assert!(rs_clean.emitted_output.contains("d := c * 3"), "{}", rs_clean.emitted_output);
    assert!(!rs_clean.emitted_output.contains("a := x + 1"), "{}", rs_clean.emitted_output);

    // JS mid-function slice overlapping into trailing top-level test() (like frontend.test.mjs:L115-L195)
    ws.write(
        "tests/frontend.test.mjs",
        "\
function createMockJQuery() {
    const elements = new Map();
    function wrap(list) {
        const wrapper = {
            width() {
                return 10;
            },
            height() {
                return 20;
            },
            trigger(eventName) {
                return eventName;
            },
        };
        return wrapper;
    }
    function $jq(sel) {
        return wrap([sel]);
    }
    return { $jq, elements };
}

test('initGlobals works', () => {
    const res = createMockJQuery();
    assert.ok(res.$jq);
});
",
    );
    let js_mid = ws.run_read(read_op(vec!["tests/frontend.test.mjs:L8-L26"]));
    assert_eq!(js_mid.exit_code, 0);
    assert!(js_mid.emitted_output.contains("height()"), "{}", js_mid.emitted_output);
    assert!(js_mid.emitted_output.contains("trigger(eventName)"), "{}", js_mid.emitted_output);
    assert!(js_mid.emitted_output.contains("function $jq"), "{}", js_mid.emitted_output);
    assert!(js_mid.emitted_output.contains("initGlobals works"), "{}", js_mid.emitted_output);
}

#[test]
fn f10_bare_file_plus_explicit_symbol_preserves_symbol_without_full() {
    let ws = TempWs::new("f10");
    let mut types_ts = String::new();
    for i in 1..=140 {
        types_ts.push_str(&format!("export type Pad{i} = number;\n"));
    }
    types_ts.push_str(
        "export interface LootItem {\n  id: string;\n  powerScore: number;\n  rarity: string;\n}\n",
    );
    ws.write("src/types.ts", &types_ts);

    for args in [
        vec!["src/types.ts", "src/types.ts:LootItem"],
        vec!["src/types.ts:LootItem", "src/types.ts"],
    ] {
        let pack = ws.run_read(read_op(args));
        assert_eq!(pack.exit_code, 0);
        assert!(pack.emitted_output.contains("LootItem"), "{}", pack.emitted_output);
        assert!(pack.emitted_output.contains("powerScore"), "{}", pack.emitted_output);
        assert!(!pack.emitted_output.contains("Auto-outlined"), "{}", pack.emitted_output);
    }
}

#[test]
fn f11_full_honors_uncapped_explicit_slices_get_24k_zero_sym_not_wiped_and_200_tok_emits_content() {
    let ws = TempWs::new("f11");

    // 1. Zero-symbol large test file (>5k tokens) with --full (no --max-tokens) must NOT be wiped to 119B
    let mut hebar = String::from("// Top-level test suite with zero named AST declarations\n");
    for i in 1..=320 {
        hebar.push_str(&format!(
            "test(\"hebar scenario number {i} verifies deterministic combat tick and loot table\", () => {{\n  expect(runSimTick({i}, \"zone_{i}\")).toBe({i});\n}});\n"
        ));
    }
    ws.write("tests/hebar.test.ts", &hebar);

    let mut full_no_cap = read_op(vec!["tests/hebar.test.ts"]);
    full_no_cap.full = true;
    let p_full = ws.run_read(full_no_cap);
    assert_eq!(p_full.exit_code, 0);
    assert!(count_cl100k_exact(&p_full.emitted_output) > 5_000, "full read was silently capped");
    assert!(p_full.emitted_output.contains("scenario number 320"), "truncated tail");
    assert!(!p_full.emitted_output.contains("no AST symbols"), "{}", p_full.emitted_output);

    // 2. Zero-symbol file with explicit --max-tokens 300 must fall back to truncated head lines, NEVER `// (no AST symbols)`
    let mut zero_sym_tight = read_op(vec!["tests/hebar.test.ts"]);
    zero_sym_tight.full = true;
    zero_sym_tight.max_tokens = Some(300);
    let p_z300 = ws.run_read(zero_sym_tight);
    assert_eq!(p_z300.exit_code, 0);
    assert!(count_cl100k_exact(&p_z300.emitted_output) <= 300, "{}", p_z300.emitted_output);
    assert!(!p_z300.emitted_output.contains("no AST symbols"), "{}", p_z300.emitted_output);
    assert!(p_z300.emitted_output.contains("scenario number 1"), "{}", p_z300.emitted_output);

    // 3. Multi-target explicit :Symbol reads totaling > 5,000 tokens (<= 24,000) must NOT silently compact to :outline
    let mut big_a = String::new();
    let mut big_b = String::new();
    for i in 1..=8 {
        big_a.push_str(&format!("export function alphaFn{i}(x: number): number {{\n"));
        for j in 1..=25 {
            big_a.push_str(&format!("  const alphaStep_{i}_{j} = x + {j} * {i} + 100;\n"));
        }
        big_a.push_str("  return x;\n}\n");

        big_b.push_str(&format!("export function betaFn{i}(y: number): number {{\n"));
        for j in 1..=25 {
            big_b.push_str(&format!("  const betaStep_{i}_{j} = y + {j} * {i} + 200;\n"));
        }
        big_b.push_str("  return y;\n}\n");
    }
    ws.write("src/alpha.ts", &big_a);
    ws.write("src/beta.ts", &big_b);

    let sym_targets = vec![
        "src/alpha.ts:alphaFn1", "src/alpha.ts:alphaFn2", "src/alpha.ts:alphaFn3", "src/alpha.ts:alphaFn4",
        "src/alpha.ts:alphaFn5", "src/alpha.ts:alphaFn6", "src/alpha.ts:alphaFn7", "src/alpha.ts:alphaFn8",
        "src/beta.ts:betaFn1", "src/beta.ts:betaFn2", "src/beta.ts:betaFn3", "src/beta.ts:betaFn4",
        "src/beta.ts:betaFn5", "src/beta.ts:betaFn6", "src/beta.ts:betaFn7", "src/beta.ts:betaFn8",
    ];
    let p_multi = ws.run_read(read_op(sym_targets));
    assert_eq!(p_multi.exit_code, 0);
    assert!(count_cl100k_exact(&p_multi.emitted_output) > 5_000);
    assert!(!p_multi.emitted_output.contains("compacted to :outline"), "{}", p_multi.emitted_output);
    assert!(p_multi.emitted_output.contains("betaStep_8_25"));

    // 4. Giant JSDoc header (>200 tok on line 1 in IR) + --full --max-tokens 200 emits useful bounded content, NOT 0 content
    let mut renderer_ts = String::from("/**\n");
    for i in 1..=28 {
        renderer_ts.push_str(&format!(
            " * Rule {i}: Continuous framebuffer synchronization, zero per-frame gradient allocations, batched WebGL2 atlas quads.\n"
        ));
    }
    renderer_ts.push_str(" */\n");
    for i in 1..=30 {
        renderer_ts.push_str(&format!(
            "export function renderPass{i}(frame: number): number {{ return frame + {i}; }}\n"
        ));
    }
    ws.write("src/rendering/HollowMeridianRenderer.ts", &renderer_ts);

    let mut op200 = read_op(vec!["src/rendering/HollowMeridianRenderer.ts"]);
    op200.full = true;
    op200.max_tokens = Some(200);
    let p200 = ws.run_read(op200);
    assert_eq!(p200.exit_code, 0);
    assert!(count_cl100k_exact(&p200.emitted_output) <= 200, "{}", p200.emitted_output);
    assert_eq!(p200.multi_files, vec!["src/rendering/HollowMeridianRenderer.ts"]);
    assert!(p200.emitted_output.contains("renderPass1"), "expected useful outline/head content:\n{}", p200.emitted_output);
}
