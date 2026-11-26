use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use aice_telemetry::gain_json::gain_report_to_json;
use aice_telemetry::gain_report::{GainQuery, build_gain_report};
use aice_telemetry::meter::{
    TelemetryRichInput, meter_payload, meter_rich_payload, record_cli_failure_telemetry,
};
use aice_telemetry::{
    CanonicalTelemetryCommand, TelemetryEvent, TelemetryMeterInput, TelemetryOpKind, count_cl100k,
    count_lines, count_o200k,
};

fn unique_temp_dir(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("aice_tel_ab_{tag}_{}_{}", std::process::id(), nanos));
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

#[test]
fn bt1_o200k_never_copied_from_cl100k() {
    let raw_cjk = "// 日本語コメント: 東京タワー🗼 — café résumé naïve 🚀\nconst msg = \"你好世界\";\n";
    let emitted_cjk = "// AICE\nconst msg = \"你好世界\";\n";
    assert_ne!(count_cl100k(raw_cjk), count_o200k(raw_cjk));

    let res = meter_payload(&TelemetryMeterInput {
        project_root: Path::new("/home/test/bt1_proj"),
        file_label: "src/i18n.ts",
        op_kind: TelemetryOpKind::Read,
        surface_label: "cli",
        raw_baseline: raw_cjk,
        emitted_payload: emitted_cjk,
        record_ledger: false,
        should_meter_bpe: true,
    });
    assert_eq!(res.native_cl100k, count_cl100k(raw_cjk));
    assert_eq!(res.native_o200k, count_o200k(raw_cjk));
    assert_ne!(res.native_cl100k, res.native_o200k);
    assert_eq!(res.aice_cl100k, count_cl100k(emitted_cjk));
    assert_eq!(res.aice_o200k, count_o200k(emitted_cjk));
    assert_eq!(
        res.saved_cl100k,
        res.native_cl100k as isize - res.aice_cl100k as isize
    );
    assert_eq!(
        res.saved_o200k,
        res.native_o200k as isize - res.aice_o200k as isize
    );
}

#[test]
fn bt2_exact_bpe_bytes_lines_zero_heuristics() {
    let raw = "pub fn compute(a: i64, b: i64) -> i64 {\r\n    a.saturating_add(b)\r\n}\r\n";
    let emitted = "fn compute(a: i64, b: i64) -> i64 = a.saturating_add(b)";
    let rich = meter_rich_payload(&TelemetryRichInput {
        project_root: Path::new("/home/test/bt2_proj"),
        file_label: "src/lib.rs",
        op_kind: TelemetryOpKind::Read,
        surface_label: "cli",
        raw_baseline: raw,
        emitted_payload: emitted,
        realistic_native_payload: None,
        multi_files: &[],
        language: None,
        agent: None,
        is_search_mode: false,
        preserved_trivia_tokens: 0,
        wasted_input_tokens: None,
        explicit_telemetry_path: None,
        record_ledger: false,
        should_meter_bpe: true,
    });
    assert_eq!(rich.summary.native_chars, raw.len());
    assert_eq!(rich.summary.aice_chars, emitted.len());
    assert_eq!(rich.summary.native_cl100k, count_cl100k(raw));
    assert_eq!(rich.summary.aice_cl100k, count_cl100k(emitted));
    assert_eq!(rich.summary.native_o200k, count_o200k(raw));
    assert_eq!(rich.summary.aice_o200k, count_o200k(emitted));
    assert_eq!(rich.native_lines, 3);
    assert_eq!(rich.aice_lines, 1);
    assert_eq!(rich.saved_lines, 2);
    assert_eq!(count_lines(""), 0);

    let admin_noop = meter_payload(&TelemetryMeterInput {
        project_root: Path::new("/home/test/bt2_proj"),
        file_label: "status",
        op_kind: TelemetryOpKind::Admin,
        surface_label: "cli",
        raw_baseline: raw,
        emitted_payload: emitted,
        record_ledger: false,
        should_meter_bpe: false,
    });
    assert_eq!(admin_noop.native_cl100k, 0);
    assert_eq!(admin_noop.aice_cl100k, 0);
    assert_eq!(admin_noop.native_o200k, 0);
    assert_eq!(admin_noop.aice_o200k, 0);

    let tmp = unique_temp_dir("bt2_err");
    let gains = tmp.join("gains.jsonl");
    let err_msg = "Error: Symbol 'Missing.fn' not found in src/lib.rs";
    let wasted_code = "fn missing() {\n    let x = 1;\n}\n";
    let fail = record_cli_failure_telemetry(
        Path::new("/home/test/bt2_proj"),
        TelemetryOpKind::Splice,
        "cli",
        err_msg,
        Some(wasted_code),
        Some(&gains),
    );
    assert_eq!(fail.summary.native_cl100k, 0);
    assert_eq!(fail.summary.aice_cl100k, count_cl100k(err_msg));
    assert_eq!(fail.summary.aice_o200k, count_o200k(err_msg));
    assert_eq!(fail.summary.saved_cl100k, -(count_cl100k(err_msg) as isize));

    let rows = aice_telemetry::load_telemetry_events(&gains, false);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].wasted_input_tokens, Some(count_cl100k(wasted_code)));
    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn bt3_find_search_baselines_not_inflated() {
    let tmp = unique_temp_dir("bt3");
    let gains = tmp.join("gains.jsonl");
    let native_find_out = "src/main.rs\nsrc/lib.rs\nsrc/config.rs\n";
    let aice_find_out = "src/{main,lib,config}.rs\n";
    let find_res = meter_rich_payload(&TelemetryRichInput {
        project_root: Path::new("/home/test/bt3_proj"),
        file_label: "<workspace-files>",
        op_kind: TelemetryOpKind::Outline,
        surface_label: "cli",
        raw_baseline: native_find_out,
        emitted_payload: aice_find_out,
        realistic_native_payload: None,
        multi_files: &[],
        language: Some("Multi"),
        agent: None,
        is_search_mode: false,
        preserved_trivia_tokens: 0,
        wasted_input_tokens: None,
        explicit_telemetry_path: Some(&gains),
        record_ledger: true,
        should_meter_bpe: true,
    });
    assert_eq!(find_res.summary.native_cl100k, count_cl100k(native_find_out));
    assert_eq!(find_res.realistic_native_cl100k, count_cl100k(native_find_out));

    let native_rg_out = "src/lib.rs:4:pub fn parse() {}\n";
    let aice_search_out = "=== src/lib.rs:4 ===\nfn parse()\n";
    let search_res = meter_rich_payload(&TelemetryRichInput {
        project_root: Path::new("/home/test/bt3_proj"),
        file_label: "<directory>",
        op_kind: TelemetryOpKind::Context,
        surface_label: "cli",
        raw_baseline: native_rg_out,
        emitted_payload: aice_search_out,
        realistic_native_payload: None,
        multi_files: &[],
        language: Some("Multi"),
        agent: None,
        is_search_mode: true,
        preserved_trivia_tokens: 0,
        wasted_input_tokens: None,
        explicit_telemetry_path: Some(&gains),
        record_ledger: true,
        should_meter_bpe: true,
    });
    assert_eq!(search_res.summary.native_cl100k, count_cl100k(native_rg_out));

    let report = build_gain_report(&GainQuery {
        telemetry_path: Some(gains),
        ..Default::default()
    });
    let find_b = report
        .economics
        .by_command
        .iter()
        .find(|b| b.command == CanonicalTelemetryCommand::Find)
        .expect("find bucket");
    assert_eq!(find_b.calls, 1);
    assert_eq!(find_b.realistic_native_cl100k, count_cl100k(native_find_out));
    let search_b = report
        .economics
        .by_command
        .iter()
        .find(|b| b.command == CanonicalTelemetryCommand::Search)
        .expect("search bucket");
    assert_eq!(search_b.calls, 1);
    assert_eq!(search_b.realistic_native_cl100k, count_cl100k(native_rg_out));
    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn bt4_negative_deltas_never_clamped_to_zero_or_one() {
    let tmp = unique_temp_dir("bt4");
    let gains = tmp.join("gains.jsonl");
    let raw = "const x = 1;\n";
    let emitted = "=== src/tiny.ts:L1-L1 (12 bytes) ===\nconst x = 1;\n📊 Context Pack Token Telemetry:\n  Total pack tokens: 24\n";
    let rich = meter_rich_payload(&TelemetryRichInput {
        project_root: Path::new("/home/test/bt4_proj"),
        file_label: "src/tiny.ts",
        op_kind: TelemetryOpKind::Read,
        surface_label: "cli",
        raw_baseline: raw,
        emitted_payload: emitted,
        realistic_native_payload: None,
        multi_files: &[],
        language: None,
        agent: None,
        is_search_mode: false,
        preserved_trivia_tokens: 0,
        wasted_input_tokens: None,
        explicit_telemetry_path: Some(&gains),
        record_ledger: true,
        should_meter_bpe: true,
    });
    assert!(rich.summary.saved_cl100k < 0);
    assert!(rich.summary.saved_o200k < 0);
    assert!(rich.realistic_saved_cl100k < 0);
    assert!(rich.saved_lines < 0);

    let report = build_gain_report(&GainQuery {
        telemetry_path: Some(gains),
        ..Default::default()
    });
    assert!(report.saved_cl100k < 0);
    assert!(report.saved_o200k < 0);
    assert!(report.cl100k_savings_pct < 0.0);
    assert!(report.o200k_savings_pct < 0.0);
    assert_eq!(report.economics.single_file_read_loss_calls, 1);
    assert_eq!(report.economics.end_to_end_verdict, "TOKEN-CONSUMING");
    let json = gain_report_to_json(&report);
    assert!(json.contains("\"savedCl100k\": -"));
    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn bt5_zero_synthetic_multipliers_on_multi_files_and_dirs() {
    let files: Vec<String> = (0..16).map(|i| format!("src/f{i}.rs")).collect();
    let raw = "fn a() {}\nfn b() {}\nfn c() {}\nfn d() {}\n";
    let realistic = "fn a() {}\nfn b() {}\n";
    let emitted = "fn a() {}\n";
    let rich = meter_rich_payload(&TelemetryRichInput {
        project_root: Path::new("/home/test/bt5_proj"),
        file_label: "<multi-context>",
        op_kind: TelemetryOpKind::Context,
        surface_label: "cli",
        raw_baseline: raw,
        emitted_payload: emitted,
        realistic_native_payload: Some(realistic),
        multi_files: &files,
        language: Some("Rust"),
        agent: None,
        is_search_mode: false,
        preserved_trivia_tokens: 0,
        wasted_input_tokens: None,
        explicit_telemetry_path: None,
        record_ledger: false,
        should_meter_bpe: true,
    });
    assert_eq!(rich.realistic_native_cl100k, count_cl100k(realistic));
    assert_eq!(
        rich.realistic_saved_cl100k,
        count_cl100k(realistic) as isize - count_cl100k(emitted) as isize
    );

    // Hydrating a legacy row without `rn` with 16 multiFiles must NOT apply *10/*45/*80 multipliers.
    let legacy = r#"{"t":1700000000000,"r":"/home/test/bt5_proj","f":"<multi-context>","mf":["a.rs","b.rs","c.rs","d.rs"],"o":"context","nc":40,"ac":12,"n1":16,"a1":4,"n2":16,"a2":4}"#;
    let ev = TelemetryEvent::from_json_line(legacy).expect("parse legacy");
    assert_eq!(ev.realistic_native_cl100k, None);
    assert_eq!(ev.realistic_native(), 16);
    assert_eq!(ev.realistic_saved(), 12);
}

#[test]
fn bt6_full_stdout_including_headers_and_stats_footer_metered() {
    let raw = "export class App {\n  private count = 0;\n  public reset(): number {\n    this.count = 0;\n    return this.count;\n  }\n}\n";
    let body_only = "class App:\n  count = 0\n  fn reset() -> number = { this.count = 0; this.count }\n";
    let full_stdout = format!(
        "=== src/app.ts [TypeScript -> AICE] ===\n{body_only}\n📊 Context Pack Token Telemetry:\n  Total pack tokens: 22\n  Dependencies:      0\n  Downstream callers:0\n  Target characters: {}\n",
        body_only.len()
    );
    let res = meter_payload(&TelemetryMeterInput {
        project_root: Path::new("/home/test/bt6_proj"),
        file_label: "src/app.ts",
        op_kind: TelemetryOpKind::Context,
        surface_label: "cli",
        raw_baseline: raw,
        emitted_payload: &full_stdout,
        record_ledger: false,
        should_meter_bpe: true,
    });
    assert_eq!(res.aice_chars, full_stdout.len());
    assert_ne!(res.aice_chars, body_only.len());
    assert_eq!(res.aice_cl100k, count_cl100k(&full_stdout));
    assert_ne!(res.aice_cl100k, count_cl100k(body_only));
    assert_eq!(res.aice_o200k, count_o200k(&full_stdout));
}
