use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use aice_batch_read::budget::count_cl100k_exact;
use aice_batch_read::search::execute_search;
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
            "aice_w3_read_{tag}_{}_{}",
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
fn f44_partial_method_ts_and_nested_python_loop_line_slices_preserve_body() {
    let ws = TempWs::new("f44");

    // 1. TypeScript class whose :L slice ends mid-method inside an unclosed push({ ...
    let ts_src = concat!(
        "export interface BoundingBox {\n",
        "  readonly x: number;\n",
        "  readonly width: number;\n",
        "}\n",
        "\n",
        "export class VisualProofAuditor {\n",
        "  private readonly width: number;\n",
        "  constructor(width: number) {\n",
        "    this.width = width;\n",
        "  }\n",
        "\n",
        "  public auditElements(elements: readonly BoundingBox[]): string[] {\n",
        "    const violations: string[] = [];\n",
        "    const viewportBox = { x: 0, width: this.width };\n",
        "    for (let i = 0; i < elements.length; i++) {\n",
        "      const el = elements[i];\n",
        "      if (\n",
        "        !Number.isFinite(el.x) ||\n",
        "        el.width <= 0\n",
        "      ) {\n",
        "        violations.push(\"CORRUPTED_DIMENSIONS\");\n",
        "        continue;\n",
        "      }\n",
        "      if (el.x + el.width > viewportBox.width) {\n",
        "        violations.push(JSON.stringify({\n",
        "          type: \"VIEWPORT_OVERFLOW\",\n",
        "          elementIndex: i,\n",
        "          extraTailField: true,\n",
        "        }));\n",
        "      }\n",
        "    }\n",
        "    return violations;\n",
        "  }\n",
        "}\n",
    );
    ws.write("src/IVisualProof.ts", ts_src);

    // Ends at line 27 (`elementIndex: i,`) inside unclosed `violations.push(JSON.stringify({`
    let ts_mid_call = ws.run_read(read_op(vec!["src/IVisualProof.ts:L1-L27"]));
    assert_eq!(ts_mid_call.exit_code, 0);
    assert!(ts_mid_call.emitted_output.contains("viewportBox"), "{}", ts_mid_call.emitted_output);
    assert!(
        ts_mid_call.emitted_output.contains("CORRUPTED_DIMENSIONS"),
        "{}",
        ts_mid_call.emitted_output
    );
    assert!(
        ts_mid_call.emitted_output.contains("VIEWPORT_OVERFLOW"),
        "{}",
        ts_mid_call.emitted_output
    );
    assert!(ts_mid_call.emitted_output.contains("elementIndex"), "{}", ts_mid_call.emitted_output);
    assert!(!ts_mid_call.emitted_output.contains("extraTailField"), "{}", ts_mid_call.emitted_output);

    // Ends at line 18 (`!Number.isFinite(el.x) ||`) — unbalanceable dangling `||` must still not drop body
    let ts_dangling = ws.run_read(read_op(vec!["src/IVisualProof.ts:L1-L18"]));
    assert_eq!(ts_dangling.exit_code, 0);
    assert!(ts_dangling.emitted_output.contains("viewportBox"), "{}", ts_dangling.emitted_output);
    assert!(
        ts_dangling.emitted_output.contains("Number.isFinite"),
        "{}",
        ts_dangling.emitted_output
    );

    // 2. Python function slice starting inside deeply nested `for -> if -> if` and continuing into subsequent functions
    let py_src = concat!(
        "def audit_visual_proof(elements, min_hitbox=48.0):\n",
        "    violations = []\n",
        "    for i, el in enumerate(elements):\n",
        "        el_id = str(el.get('id', i))\n",
        "        # don't skip interactive checks\n",
        "        if el.get('isInteractive', False):\n",
        "            raw_min = el.get('minHitboxDp')\n",
        "            if raw_min is not None and raw_min < 0:\n",
        "                violations.append({\n",
        "                    'type': 'CORRUPTED_DIMENSIONS',\n",
        "                    'elementId': el_id,\n",
        "                })\n",
        "                continue\n",
        "            threshold = max(min_hitbox, float(raw_min or 0))\n",
        "            if el['width'] < threshold:\n",
        "                violations.append({'type': 'TARGET_UNDERSIZED', 'id': el_id})\n",
        "        fg_raw = el.get('fgColor')\n",
        "        if fg_raw is not None:\n",
        "            violations.append({'type': 'INSUFFICIENT_CONTRAST', 'fg': fg_raw})\n",
        "    return {\n",
        "        'isCompliant': len(violations) == 0,\n",
        "        'violations': violations,\n",
        "    }\n",
        "\n",
        "\n",
        "def _discover_snapshot_file():\n",
        "    return 'reports/vp-snapshot.json'\n",
        "\n",
        "\n",
        "def main():\n",
        "    return audit_visual_proof([])\n",
    );
    ws.write("tools/verify_vp.py", py_src);

    // Line 9 starts at `                violations.append({` (indent 16) and dedents to 12, 8, 4, then 0
    let py_nested = ws.run_read(read_op(vec!["tools/verify_vp.py:L9-L31"]));
    assert_eq!(py_nested.exit_code, 0);
    for needle in [
        "CORRUPTED_DIMENSIONS",
        "continue",
        "threshold",
        "TARGET_UNDERSIZED",
        "fg_raw",
        "INSUFFICIENT_CONTRAST",
        "isCompliant",
        "_discover_snapshot_file",
        "def main",
    ] {
        let needle_alt = if needle == "def main" { "fn main" } else { needle };
        assert!(
            py_nested.emitted_output.contains(needle)
                || py_nested.emitted_output.contains(needle_alt),
            "missing '{needle}' in Python nested :L slice:\n{}",
            py_nested.emitted_output
        );
    }
    // Subsequent complete functions stay in AICE IR
    assert!(
        py_nested.emitted_output.contains("module python")
            && py_nested.emitted_output.contains("pub fn main()"),
        "expected complete subsequent functions in AICE IR:\n{}",
        py_nested.emitted_output
    );

    // Starting mid-dict at L10 (`'type': 'CORRUPTED_DIMENSIONS',`) must fall back cleanly without dropping any lines
    let py_mid_dict = ws.run_read(read_op(vec!["tools/verify_vp.py:L10-L31"]));
    assert_eq!(py_mid_dict.exit_code, 0);
    assert!(py_mid_dict.emitted_output.contains("CORRUPTED_DIMENSIONS"), "{}", py_mid_dict.emitted_output);
    assert!(py_mid_dict.emitted_output.contains("TARGET_UNDERSIZED"), "{}", py_mid_dict.emitted_output);
    assert!(py_mid_dict.emitted_output.contains("INSUFFICIENT_CONTRAST"), "{}", py_mid_dict.emitted_output);
    assert!(py_mid_dict.emitted_output.contains("main"), "{}", py_mid_dict.emitted_output);
}

#[test]
fn f45_search_omits_jsdoc_banners_caps_expansive_hits_and_keeps_br2() {
    let ws = TempWs::new("f45");

    let mut ts_doc = String::from("/**\n * Protocol 5.0 Visual Proof Contract\n");
    for i in 1..=18 {
        ts_doc.push_str(&format!(
            " * Banner line {i}: multi-platform safe-area inset compliance and viewport density documentation.\n"
        ));
    }
    ts_doc.push_str(" */\n");
    ts_doc.push_str(concat!(
        "export interface BoundingBox {\n",
        "  readonly x: number;\n",
        "  readonly y: number;\n",
        "}\n",
        "export interface SafeAreaInsets {\n",
        "  readonly top: number;\n",
        "}\n",
        "export interface ViewportBounds {\n",
        "  readonly width: number;\n",
        "}\n",
        "// Visual proof provider interface comment\n",
        "export interface IVisualStepProvider {\n",
        "  readonly name: string;\n",
        "}\n",
        "export const VIEWPORT_PRESETS = Object.freeze({\n",
        "  android_phone: Object.freeze({ width: 390, height: 844, dpr: 3.0 }),\n",
        "  android_tablet: Object.freeze({ width: 800, height: 1280, dpr: 2.0 }),\n",
        "  desktop_fhd: Object.freeze({ width: 1920, height: 1080, dpr: 1.0 }),\n",
        "  desktop_qhd: Object.freeze({ width: 2560, height: 1440, dpr: 1.0 }),\n",
        "  desktop_uhd: Object.freeze({ width: 3840, height: 2160, dpr: 2.0 }),\n",
        "});\n",
        "export class Calculator {\n",
        "  public add(a: number, b: number): number { return a + b; }\n",
        "}\n",
    ));
    ws.write("src/IVisualProof.ts", &ts_doc);

    // 1. Regex search on interfaces omits the 20-line JSDoc banner and beats rg baseline tokens
    let iface = ws.run_search(search_op(r"/interface\s+\w+/", vec!["src/IVisualProof.ts"]));
    assert_eq!(iface.exit_code, 0);
    assert!(
        !iface.emitted_output.contains("Banner line 1"),
        "JSDoc banner leaked into search output:\n{}",
        iface.emitted_output
    );
    assert!(
        iface.emitted_output.contains("Visual proof provider interface comment"),
        "direct comment match must still render:\n{}",
        iface.emitted_output
    );
    assert!(iface.emitted_output.contains("BoundingBox"), "{}", iface.emitted_output);
    let aice_tok = count_cl100k_exact(&iface.emitted_output);
    let rg_tok = count_cl100k_exact(&iface.raw_baseline);
    assert!(
        aice_tok < rg_tok,
        "expected search AICE ({aice_tok} tok) < rg baseline ({rg_tok} tok):\n{}",
        iface.emitted_output
    );

    // 2. Single-line hit on multi-line const must NOT dump the entire 20-line object literal
    let presets = ws.run_search(search_op("VIEWPORT_PRESETS", vec!["src/IVisualProof.ts"]));
    assert_eq!(presets.exit_code, 0);
    assert!(presets.emitted_output.contains("VIEWPORT_PRESETS"), "{}", presets.emitted_output);
    assert!(
        !presets.emitted_output.contains("desktop_uhd"),
        "single-line const search dumped whole object literal:\n{}",
        presets.emitted_output
    );

    // 3. B-R2 contract remains 100% intact
    let calc = ws.run_search(search_op("Calculator", vec!["src/IVisualProof.ts"]));
    assert_eq!(calc.exit_code, 0);
    assert!(!calc.emitted_output.contains("export class Calculator"), "{}", calc.emitted_output);
    assert!(calc.emitted_output.contains("Calculator"), "{}", calc.emitted_output);

    // 4. Context search matching a comment line still shows that comment
    let mut ctx_op = search_op("provider interface comment", vec!["src/IVisualProof.ts"]);
    ctx_op.context_lines = Some(1);
    let ctx_hit = ws.run_search(ctx_op);
    assert_eq!(ctx_hit.exit_code, 0);
    assert!(
        ctx_hit.emitted_output.contains("Visual proof provider interface comment"),
        "{}",
        ctx_hit.emitted_output
    );

    // 5. Markdown search emits only matching lines without dumping surrounding huge table
    let mut md = String::from("# Report\n\n| Id | Status | Notes |\n|---|---|---|\n");
    for i in 1..=80 {
        md.push_str(&format!("| ROW-{i:03} | ok | filler row {i} with long audit description |\n"));
    }
    ws.write("docs/report.md", &md);
    let md_hit = ws.run_search(search_op("ROW-042", vec!["docs/report.md"]));
    assert_eq!(md_hit.exit_code, 0);
    assert!(md_hit.emitted_output.contains("ROW-042"), "{}", md_hit.emitted_output);
    assert!(!md_hit.emitted_output.contains("ROW-001"), "{}", md_hit.emitted_output);
    assert!(!md_hit.emitted_output.contains("ROW-080"), "{}", md_hit.emitted_output);
}

#[test]
fn f48_bare_file_plus_explicit_symbol_preserves_outline_and_symbol_body() {
    let ws = TempWs::new("f48");

    let mut types_ts = String::new();
    for i in 1..=140 {
        types_ts.push_str(&format!("export type Pad{i} = number;\n"));
    }
    types_ts.push_str(
        "export interface LootItem {\n  id: string;\n  powerScore: number;\n  rarity: string;\n}\n",
    );
    ws.write("src/types.ts", &types_ts);
    ws.write("notes.txt", "line1\nline2\nline3\nline4\nline5\n");

    for args in [
        vec!["src/types.ts", "src/types.ts:LootItem"],
        vec!["src/types.ts:LootItem", "src/types.ts"],
    ] {
        let pack = ws.run_read(read_op(args));
        assert_eq!(pack.exit_code, 0);
        assert_eq!(pack.emitted_output.matches("// file: src/types.ts").count(), 1);
        // Compact outline entries from bare target are present
        assert!(pack.emitted_output.contains("Pad1 # [L"), "{}", pack.emitted_output);
        assert!(pack.emitted_output.contains("Pad140 # [L"), "{}", pack.emitted_output);
        // Full requested symbol body is present after outline
        assert!(pack.emitted_output.contains("powerScore"), "{}", pack.emitted_output);
        assert!(pack.emitted_output.contains("rarity"), "{}", pack.emitted_output);
        assert!(
            pack.emitted_output.find("Pad1 # [L").unwrap()
                < pack.emitted_output.find("powerScore").unwrap(),
            "expected outline before symbol body:\n{}",
            pack.emitted_output
        );
        assert!(!pack.emitted_output.contains("Auto-outlined"), "{}", pack.emitted_output);
        assert!(pack.realistic_native_payload.is_none());
    }

    // PlainText bare + :L does not duplicate the entire PlainText file
    let txt_pack = ws.run_read(read_op(vec!["notes.txt", "notes.txt:L1-L2"]));
    assert_eq!(txt_pack.exit_code, 0);
    assert!(txt_pack.emitted_output.contains("line1"), "{}", txt_pack.emitted_output);
    assert!(!txt_pack.emitted_output.contains("line5"), "{}", txt_pack.emitted_output);
}

#[test]
fn f35_sibling_hints_capped_and_imports_honest_realistic_native() {
    let ws = TempWs::new("f35");

    // 1. 61-method class (60 siblings) caps sibling hints at 8 + `(+52 more)`
    let mut big_cls = String::from("export class HollowMeridianRenderer {\n");
    for i in 0..61 {
        big_cls.push_str(&format!("  public method{i:02}(v: number): number {{ return v + {i}; }}\n"));
    }
    big_cls.push_str("}\n");
    ws.write("src/renderer.ts", &big_cls);

    let sym = ws.run_read(read_op(vec!["src/renderer.ts:HollowMeridianRenderer.method30"]));
    assert_eq!(sym.exit_code, 0);
    let sib_line = sym
        .emitted_output
        .lines()
        .find(|l| l.starts_with("// siblings in HollowMeridianRenderer:"))
        .expect("sibling hint line");
    assert!(sib_line.ends_with("(+52 more)"), "expected (+52 more), got: {sib_line}");
    let listed = sib_line
        .strip_prefix("// siblings in HollowMeridianRenderer: ")
        .unwrap()
        .strip_suffix(" (+52 more)")
        .unwrap();
    let names: Vec<&str> = listed.split(", ").collect();
    assert_eq!(names.len(), 8, "expected exactly 8 sibling names: {sib_line}");
    assert!(!names.contains(&"method30"), "matched method must not appear as sibling: {sib_line}");

    // Small class (<= 8 siblings) has no `(+N more)` suffix
    ws.write(
        "src/small_cls.ts",
        "export class Small {\n  public a(): number { return 1; }\n  public b(): number { return 2; }\n  public c(): number { return 3; }\n}\n",
    );
    let small_sym = ws.run_read(read_op(vec!["src/small_cls.ts:Small.a"]));
    assert_eq!(small_sym.exit_code, 0);
    assert!(small_sym.emitted_output.contains("// siblings in Small: b, c\n"), "{}", small_sym.emitted_output);

    // 2. `:imports` sets realistic_native_payload to the raw import lines, NOT the whole file
    let mut mod_ts = String::from(concat!(
        "import { alpha } from \"./alpha\";\n",
        "import { beta, gamma } from \"./beta\";\n",
        "import type { Config } from \"./config\";\n\n",
    ));
    for i in 1..=120 {
        mod_ts.push_str(&format!(
            "export function heavyBodyFn{i}(x: number): number {{ return alpha(x) + beta({i}) + gamma(); }}\n"
        ));
    }
    ws.write("src/service.ts", &mod_ts);

    let imp = ws.run_read(read_op(vec!["src/service.ts:imports"]));
    assert_eq!(imp.exit_code, 0);
    let rn = imp
        .realistic_native_payload
        .as_deref()
        .expect("expected realistic_native_payload for :imports");
    assert!(rn.contains("from \"./alpha\""), "{rn}");
    assert!(rn.contains("from \"./beta\""), "{rn}");
    assert!(rn.contains("from \"./config\""), "{rn}");
    assert!(!rn.contains("heavyBodyFn"), "body leaked into :imports realistic_native:\n{rn}");
    assert!(
        count_cl100k_exact(rn) * 10 < count_cl100k_exact(&imp.raw_baseline),
        "expected :imports rn ({}) << raw_baseline ({})",
        count_cl100k_exact(rn),
        count_cl100k_exact(&imp.raw_baseline)
    );
}
