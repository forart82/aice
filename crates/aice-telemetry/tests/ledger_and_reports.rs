use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use aice_governance::{JsonValue, parse_json};
use aice_telemetry::analyze::{AnalyzeOptions, analyze_project, analyze_report_to_json};
use aice_telemetry::analyze_format::format_analyze_report;
use aice_telemetry::env::resolve_gains_path_with;
use aice_telemetry::error_log::{
    RecordTelemetryErrorInput, load_non_benign_errors_by_project, record_error_event_with,
};
use aice_telemetry::gain_format::{format_global_gain_dashboard, format_project_gain_detail};
use aice_telemetry::gain_json::{
    compact_result_to_json, gain_report_to_json, project_detail_to_json, reset_result_to_json,
};
use aice_telemetry::gain_report::{GainQuery, build_gain_report, summarize_ledger};
use aice_telemetry::ledger::{
    compact_telemetry_ledger, load_telemetry_events, reset_telemetry_history,
    should_exclude_from_global_ledger_with, with_suppressed_telemetry,
};
use aice_telemetry::meter::{
    TelemetryRichInput, meter_rich_payload, meter_rich_payload_with, record_cli_failure_telemetry,
};
use aice_telemetry::{TelemetryOpKind, classify_friction_cause, count_cl100k, count_o200k};

fn unique_temp_dir(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("aice_tel_lr_{tag}_{}_{}", std::process::id(), nanos));
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

#[test]
fn tel01_ledger_roundtrip_and_gain_json_contract() {
    let tmp = unique_temp_dir("tel01");
    let gains = tmp.join("gains.jsonl");
    let proj = Path::new("/home/test/tel01_ws");

    let raw_big = "export class Calculator {\n  constructor(private readonly offset: number) {}\n  public add(a: number, b: number): number {\n    return a + b + this.offset;\n  }\n}\n".repeat(6);
    let out_outline = "class Calculator(offset: number)\n  fn add(a: number, b: number) -> number\n";
    meter_rich_payload(&TelemetryRichInput {
        project_root: proj,
        file_label: "src/big.ts",
        op_kind: TelemetryOpKind::Outline,
        surface_label: "cli",
        raw_baseline: &raw_big,
        emitted_payload: out_outline,
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

    let raw_splice = "  public reset(): number {\n    this.count = 0;\n    return this.count;\n  }\n".repeat(4);
    let out_splice = "✔ Spliced App.reset";
    meter_rich_payload(&TelemetryRichInput {
        project_root: proj,
        file_label: "src/app.ts",
        op_kind: TelemetryOpKind::Splice,
        surface_label: "cli",
        raw_baseline: &raw_splice,
        emitted_payload: out_splice,
        realistic_native_payload: Some("  public reset(): number {\n    this.count = 0;\n    return this.count;\n  }"),
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

    let report = build_gain_report(&GainQuery {
        telemetry_path: Some(gains.clone()),
        ..Default::default()
    });
    assert_eq!(report.total_operations, 2);
    assert_eq!(report.read_operations, 1);
    assert_eq!(report.write_operations, 1);
    assert_eq!(
        report.native_cl100k,
        count_cl100k(&raw_big) + count_cl100k(&raw_splice)
    );
    assert_eq!(
        report.native_o200k,
        count_o200k(&raw_big) + count_o200k(&raw_splice)
    );

    let json_str = gain_report_to_json(&report);
    let parsed = parse_json(&json_str).expect("gain --json must be valid JSON");
    let obj = parsed.as_object().expect("root object");

    for key in [
        "telemetryPath",
        "unique",
        "totalOperations",
        "readOperations",
        "writeOperations",
        "overheadOperations",
        "overheadCalls",
        "repeatReadCalls",
        "nativeChars",
        "aiceChars",
        "savedChars",
        "charSavingsPct",
        "nativeCl100k",
        "aiceCl100k",
        "savedCl100k",
        "cl100kSavingsPct",
        "nativeO200k",
        "aiceO200k",
        "savedO200k",
        "o200kSavingsPct",
        "ruleBudgetCl100k",
        "netAfterRuleBudgetCl100k",
        "ruleBreakEvenMultiple",
        "ruleBreakEvenReached",
        "totalRealisticNativeCl100k",
        "totalRealisticSavedCl100k",
        "realisticSavedCl100kPct",
        "totalPreservedTriviaTokens",
        "wrapperTaxCl100k",
        "parallelSliceCalls",
        "sequentialPaginationTurns",
        "failedRetryTurns",
        "estimatedTurns",
        "mcpEstimatedTurns",
        "grossRuleReplayCl100k",
        "ruleReplayTaxCl100k",
        "mcpSchemaBudgetCl100k",
        "mcpSchemaTaxCl100k",
        "paginationReplayTaxCl100k",
        "paginationCostWeightedTaxCl100k",
        "wastedRetryOutputTokensCl100k",
        "failedRetryOutputPenalty4xCl100k",
        "retryReplayTaxCl100k",
        "retryCostWeightedTaxCl100k",
        "totalSystemicTaxCl100k",
        "totalCostWeightedTaxCl100k",
        "netEndToEndSavedCl100k",
        "costWeightedNetDeltaCl100k",
        "spliceErrorRatePct",
        "singleFileReadCalls",
        "singleFileReadLossCalls",
        "singleFileReadLossPct",
        "endToEndVerdict",
        "byCommand",
        "byOperation",
        "byLanguage",
        "projects",
    ] {
        assert!(obj.contains_key(key), "missing golden key '{key}'");
    }

    let by_cmd = obj
        .get("byCommand")
        .and_then(JsonValue::as_array)
        .expect("byCommand array");
    let cmds: Vec<&str> = by_cmd
        .iter()
        .filter_map(|v| v.as_object()?.get("command")?.as_str())
        .collect();
    assert_eq!(cmds, vec!["read", "search", "find", "outline", "splice/write"]);

    let detail_report = build_gain_report(&GainQuery {
        project: Some("tel01_ws".to_string()),
        telemetry_path: Some(gains),
        ..Default::default()
    });
    let detail = detail_report.project_detail.as_ref().expect("project detail");
    let detail_json = project_detail_to_json(&detail_report.telemetry_path, false, detail);
    assert!(parse_json(&detail_json).is_ok());
    assert!(format_global_gain_dashboard(&report).contains("AICE Honest BPE Telemetry"));
    assert!(format_project_gain_detail(detail).contains("tel01_ws"));

    // smoke test back-compat API used by aice-pipeline/src/admin_flow.rs
    let _summary = summarize_ledger();
    let _ = fs::remove_dir_all(&tmp);
}


#[test]
fn tel02_ephemeral_tmp_and_swarm_excluded_without_env_override() {
    let tmp = unique_temp_dir("tel02");
    let fake_home = tmp.join("home");
    fs::create_dir_all(&fake_home).expect("create fake home");

    let no_override_env = |k: &str| -> Option<String> {
        if k == "HOME" {
            Some(fake_home.display().to_string())
        } else {
            None
        }
    };

    assert!(should_exclude_from_global_ledger_with(
        Path::new("/tmp/ephemeral-ws"),
        None,
        &no_override_env
    ));
    assert!(should_exclude_from_global_ledger_with(
        Path::new("/private/tmp/ephemeral-ws"),
        None,
        &no_override_env
    ));
    assert!(should_exclude_from_global_ledger_with(
        Path::new("/var/tmp/ephemeral-ws"),
        None,
        &no_override_env
    ));
    assert!(should_exclude_from_global_ledger_with(
        &std::env::temp_dir().join("ephemeral-ws"),
        None,
        &no_override_env
    ));
    assert!(should_exclude_from_global_ledger_with(
        Path::new("/home/user/work/swarm-agent-1"),
        None,
        &no_override_env
    ));
    assert!(!should_exclude_from_global_ledger_with(
        Path::new("/home/user/real-project"),
        None,
        &no_override_env
    ));

    // When AICE_HOME is set, explicit override permits recording even under /tmp.
    let with_aice_home = |k: &str| -> Option<String> {
        if k == "AICE_HOME" {
            Some(fake_home.join(".aice").display().to_string())
        } else {
            None
        }
    };
    assert!(!should_exclude_from_global_ledger_with(
        Path::new("/tmp/ephemeral-ws"),
        None,
        &with_aice_home
    ));

    let res = meter_rich_payload_with(
        &TelemetryRichInput {
            project_root: &tmp.join("ws"),
            file_label: "src/app.ts",
            op_kind: TelemetryOpKind::Read,
            surface_label: "cli",
            raw_baseline: "export const a = 1;\n",
            emitted_payload: "const a = 1\n",
            realistic_native_payload: None,
            multi_files: &[],
            language: None,
            agent: None,
            is_search_mode: false,
            preserved_trivia_tokens: 0,
            wasted_input_tokens: None,
            explicit_telemetry_path: None,
            record_ledger: true,
            should_meter_bpe: true,
        },
        &no_override_env,
    );
    assert!(res.summary.ledger_path.is_none());
    let default_gains = resolve_gains_path_with(None, &no_override_env);
    assert!(!default_gains.exists());
    let _ = fs::remove_dir_all(&tmp);
}


#[test]
fn ledger_compaction_drops_ephemeral_and_hydrates_legacy_rows() {
    let tmp = unique_temp_dir("compact");
    let gains = tmp.join("gains.jsonl");
    let errors = tmp.join("errors.jsonl");
    let rows = [
        r#"{"t":1700000000000,"r":"/home/user/real_proj","f":"src/main.rs","o":"read","nc":200,"ac":60,"n1":50,"a1":15,"n2":48,"a2":14}"#,
        r#"{"timestamp":"2026-11-20T01:02:03.000Z","projectRoot":"/home/user/real_proj","filePath":"src/lib.rs","operation":"outline","nativeChars":300,"aiceChars":90,"nativeCl100k":80,"aiceCl100k":20,"nativeO200k":78,"aiceO200k":19}"#,
        r#"{"t":1700000000002,"r":"/tmp/scratch_ws","f":"a.ts","o":"read","nc":100,"ac":50,"n1":25,"a1":12,"n2":25,"a2":12}"#,
        r#"{"t":1700000000003,"r":"/home/user/swarm-42","f":"b.ts","o":"read","nc":100,"ac":50,"n1":25,"a1":12,"n2":25,"a2":12}"#,
        "{not valid json",
    ];
    fs::write(&gains, format!("{}\n", rows.join("\n"))).expect("seed gains.jsonl");
    fs::write(&errors, "{}\n").expect("seed errors.jsonl");

    let compact = compact_telemetry_ledger(Some(&gains)).expect("compact");
    assert_eq!(compact.total_lines, 5);
    assert_eq!(compact.kept_rows, 2);
    assert_eq!(compact.dropped_ephemeral, 2);
    assert_eq!(compact.dropped_invalid, 1);
    assert!(parse_json(&compact_result_to_json(&compact)).is_ok());

    let loaded = load_telemetry_events(&gains, true);
    assert_eq!(loaded.len(), 2);
    assert_eq!(loaded[1].language, "Rust");

    let suppressed_summary = with_suppressed_telemetry(|| {
        meter_rich_payload(&TelemetryRichInput {
            project_root: Path::new("/home/user/real_proj"),
            file_label: "src/suppressed.rs",
            op_kind: TelemetryOpKind::Read,
            surface_label: "cli",
            raw_baseline: "fn hidden() {}\n",
            emitted_payload: "fn hidden()\n",
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
        })
    });
    assert!(suppressed_summary.summary.ledger_path.is_none());
    assert_eq!(load_telemetry_events(&gains, false).len(), 2);

    let reset = reset_telemetry_history(Some(&gains)).expect("reset");
    assert!(reset.removed_gains);
    assert!(reset.removed_errors);
    assert!(!gains.exists());
    assert!(!errors.exists());
    assert!(parse_json(&reset_result_to_json(&reset)).is_ok());
    let _ = fs::remove_dir_all(&tmp);
}


#[test]
fn error_log_reconciliation_and_analyze_report_contract() {
    let tmp = unique_temp_dir("analyze");
    let ws = tmp.join("demo_repo");
    let src = ws.join("src");
    let transcripts = tmp.join("transcripts");
    fs::create_dir_all(&src).expect("create ws src");
    fs::create_dir_all(&transcripts).expect("create transcripts");
    fs::write(
        src.join("lib.rs"),
        "pub fn greet() -> &'static str {\n    \"hello\"\n}\n",
    )
    .expect("write lib.rs");

    let gains = tmp.join("gains.jsonl");
    meter_rich_payload(&TelemetryRichInput {
        project_root: &ws,
        file_label: "src/lib.rs",
        op_kind: TelemetryOpKind::Read,
        surface_label: "cli",
        raw_baseline: "pub fn greet() -> &'static str {\n    \"hello\"\n}\n".repeat(8).as_str(),
        emitted_payload: "fn greet() -> &str",
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

    record_cli_failure_telemetry(
        &ws,
        TelemetryOpKind::Splice,
        "cli",
        "Error: Symbol 'greet_v2' not found in src/lib.rs",
        Some("pub fn greet_v2() {}"),
        Some(&gains),
    );
    let env_empty = |_: &str| -> Option<String> { None };
    record_error_event_with(
        &RecordTelemetryErrorInput {
            target_path: Some(&src.join("lib.rs")),
            project_root: Some(&ws),
            file_path: Some("src/lib.rs"),
            operation: "splice",
            surface: "cli",
            agent: Some("cli"),
            error_message: "Symbol 'greet_v2' not found in src/lib.rs",
            wasted_input_tokens: Some(12),
            explicit_telemetry_path: Some(&gains),
        },
        &env_empty,
    );
    record_error_event_with(
        &RecordTelemetryErrorInput {
            target_path: Some(&src.join("lib.rs")),
            project_root: Some(&ws),
            file_path: Some("src/lib.rs"),
            operation: "read",
            surface: "cli",
            agent: Some("cli"),
            error_message: "Benign notice: fallback skipped",
            wasted_input_tokens: None,
            explicit_telemetry_path: Some(&gains),
        },
        &env_empty,
    );

    let non_benign = load_non_benign_errors_by_project(&gains, false);
    assert_eq!(non_benign.get(&ws.display().to_string()).map(Vec::len), Some(1));
    assert_eq!(
        classify_friction_cause("Invalid half-open delimiter"),
        "Line-range delimiter / boundary rejection"
    );
    assert_eq!(
        classify_friction_cause("JSON parse error"),
        "Dialect hunk / JSON-YAML parse error"
    );

    let tfile = transcripts.join("session_1.jsonl");
    let tlines = [
        format!(r#"{{"workspace":"{}","role":"assistant","tool":"read_file"}}"#, ws.display()),
        format!(r#"{{"workspace":"{}","role":"assistant","tool":"aice_splice","error":"Syntax error in src/lib.rs"}}"#, ws.display()),
    ];
    fs::write(&tfile, format!("{}\n", tlines.join("\n"))).expect("write transcript");

    let report = analyze_project(&AnalyzeOptions {
        project: Some(ws.display().to_string()),
        telemetry_path: Some(gains),
        transcripts_dir: Some(transcripts),
    });
    assert_eq!(report.workspace_stats.file_count, 1);
    assert_eq!(report.total_calls, 2);
    assert_eq!(report.end_to_end_economics.failed_retry_turns, 1);
    assert_eq!(report.sessions.len(), 1);
    assert_eq!(report.sessions[0].native_file_bypasses.get("read_file"), Some(&1));
    assert_eq!(report.transcript_errors.len(), 1);

    let json = analyze_report_to_json(&report);
    let parsed = parse_json(&json).expect("analyze JSON valid");
    let obj = parsed.as_object().expect("analyze object");
    for key in [
        "capturedAt",
        "projectRoot",
        "projectName",
        "configStatus",
        "workspaceStats",
        "bpeSavings",
        "frictionAudit",
        "sessionCount",
        "endToEndEconomics",
    ] {
        assert!(obj.contains_key(key), "missing analyze key '{key}'");
    }
    assert!(format_analyze_report(&report).contains("AICE Project Analyze"));
    let _ = fs::remove_dir_all(&tmp);
}


#[test]
fn transcript_prefix_unscoped_and_cross_project_error_isolation() {
    let tmp = unique_temp_dir("isolation");
    let ws_main = tmp.join("contracts/ws");
    let ws_other_prefix = tmp.join("contracts/ws_other");
    let ws_same_base = tmp.join("contracts/other_parent/ws");
    let transcripts = tmp.join("transcripts");
    fs::create_dir_all(ws_main.join("src")).expect("ws_main");
    fs::create_dir_all(ws_other_prefix.join("src")).expect("ws_other_prefix");
    fs::create_dir_all(ws_same_base.join("src")).expect("ws_same_base");
    fs::create_dir_all(&transcripts).expect("transcripts");
    fs::write(ws_main.join("aice.config.json"), r#"{"enabled":true}"#).expect("cfg");
    fs::write(ws_main.join("src/lib.rs"), "pub fn main_ws() {}\n").expect("src");
    fs::write(ws_same_base.join("aice.config.json"), r#"{"enabled":true}"#).expect("cfg2");
    fs::write(ws_same_base.join("src/lib.rs"), "pub fn other_ws() {}\n").expect("src2");

    let gains = tmp.join("gains.jsonl");
    let errors = tmp.join("errors.jsonl");
    let env_with = |k: &str| -> Option<String> {
        match k {
            "AICE_TELEMETRY_PATH" => Some(gains.display().to_string()),
            "AICE_TELEMETRY_ERRORS_PATH" => Some(errors.display().to_string()),
            _ => None,
        }
    };

    meter_rich_payload_with(
        &TelemetryRichInput {
            project_root: &ws_main,
            file_label: "src/lib.rs",
            op_kind: TelemetryOpKind::Read,
            surface_label: "cli",
            raw_baseline: "pub fn main_ws() { let x = 1; }\n",
            emitted_payload: "fn main_ws()\n",
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
        },
        &env_with,
    );
    meter_rich_payload_with(
        &TelemetryRichInput {
            project_root: &ws_same_base,
            file_label: "src/lib.rs",
            op_kind: TelemetryOpKind::Splice,
            surface_label: "cli",
            raw_baseline: "pub fn other_ws() { let y = 2; }\n",
            emitted_payload: "ok\n",
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
        },
        &env_with,
    );
    record_error_event_with(
        &RecordTelemetryErrorInput {
            project_root: Some(&ws_same_base),
            target_path: Some(&ws_same_base.join("src/lib.rs")),
            file_path: Some("src/lib.rs"),
            operation: "splice",
            surface: "cli",
            agent: None,
            error_message: "Syntax error on other_parent/ws",
            wasted_input_tokens: Some(40),
            explicit_telemetry_path: Some(&errors),
        },
        &env_with,
    )
    .expect("record error");

    let global = build_gain_report(&GainQuery {
        telemetry_path: Some(gains.clone()),
        drop_ephemeral: false,
        ..Default::default()
    });
    assert_eq!(global.economics.failed_retry_turns, 1, "must not double-count across same basename");
    let main_proj = global
        .projects
        .iter()
        .find(|p| Path::new(&p.project_root) == ws_main)
        .expect("ws_main project");
    let other_proj = global
        .projects
        .iter()
        .find(|p| Path::new(&p.project_root) == ws_same_base)
        .expect("ws_same_base project");
    assert_eq!(main_proj.economics.failed_retry_turns, 0);
    assert_eq!(other_proj.economics.failed_retry_turns, 1);

    fs::write(
        transcripts.join("sess_main.jsonl"),
        format!("{{\"workspace\":\"{}\",\"role\":\"assistant\",\"tool\":\"aice_read\"}}\n", ws_main.display()),
    )
    .expect("sess_main");
    fs::write(
        transcripts.join("sess_sub.jsonl"),
        format!("{{\"workspace\":\"{}/packages/core\",\"role\":\"assistant\",\"tool\":\"aice_read\"}}\n", ws_main.display()),
    )
    .expect("sess_sub");
    fs::write(
        transcripts.join("sess_other_prefix.jsonl"),
        format!("{{\"workspace\":\"{}\",\"role\":\"assistant\",\"tool\":\"read_file\"}}\n", ws_other_prefix.display()),
    )
    .expect("sess_other_prefix");
    fs::write(
        transcripts.join("sess_no_ws.jsonl"),
        "{\"role\":\"assistant\",\"tool\":\"read_file\"}\n",
    )
    .expect("sess_no_ws");

    let analyze = analyze_project(&AnalyzeOptions {
        project: Some(ws_main.display().to_string()),
        telemetry_path: Some(gains),
        transcripts_dir: Some(transcripts),
    });
    assert_eq!(analyze.end_to_end_economics.failed_retry_turns, 0);
    assert!(analyze.telemetry_errors.is_empty());
    let mut ids: Vec<&str> = analyze.sessions.iter().map(|s| s.conversation_id.as_str()).collect();
    ids.sort();
    assert_eq!(ids, vec!["sess_main", "sess_sub"]);

    let hydrated = aice_telemetry::TelemetryEvent::from_json_line(
        r#"{"t":1700000000000,"r":"/home/user/proj","f":"src/a.rs","o":"read","nc":100,"ac":40,"n1":50,"a1":20,"n2":48,"a2":19,"rn":500,"rs":480}"#,
    )
    .expect("hydrate row");
    assert_eq!(hydrated.realistic_native_cl100k, Some(50));
    assert_eq!(hydrated.realistic_saved_cl100k, Some(30));

    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn c1_g1_20mib_tail_seek_mid_utf8_preserves_subsequent_events() {
    let tmp = unique_temp_dir("c1_g1_20m");
    let gains = tmp.join("gains_20m.jsonl");
    let filler_row = r#"{"t":1700000000000,"r":"/home/user/proj_big","f":"src/pad.rs","o":"read","nc":100,"ac":40,"n1":25,"a1":10,"n2":25,"a2":10}"#;
    let tail_row = r#"{"t":1700000001000,"r":"/home/user/proj_big","f":"src/tail.rs","o":"read","nc":200,"ac":60,"n1":50,"a1":15,"n2":48,"a2":14}"#;
    let max_read = 20usize * 1024 * 1024;
    let extra_row_prefix = r#"{"t":1700000000003,"r":"/home/user/proj_big","f":"src/"#;
    let extra_row_suffix = r#".rs","o":"read","nc":10,"ac":5,"n1":3,"a1":2,"n2":3,"a2":2}"#;

    for (label, utf8_char, split_offset) in [
        ("rocket_4byte", "🚀", 1usize),
        ("cjk_3byte", "日", 2usize),
    ] {
        let mut head = String::new();
        while head.len() < 16 * 1024 {
            head.push_str(filler_row);
            head.push('\n');
        }
        let boundary_prefix = format!(
            r#"{{"t":1700000000001,"r":"/home/user/proj_big","f":"src/{utf8_char}.rs","o":"read","nc":10,"ac":5,"n1":3,"a1":2,"n2":3,"a2":2}}"#
        );
        let char_pos_in_line = boundary_prefix.find(utf8_char).unwrap();
        let rem_from_boundary = boundary_prefix.len() + 1 - (char_pos_in_line + split_offset);
        let expected_tail_rows = 200usize;

        let mut body_after = Vec::new();
        for _ in 0..expected_tail_rows {
            body_after.extend_from_slice(tail_row.as_bytes());
            body_after.push(b'\n');
        }
        let target_body_after = max_read - rem_from_boundary;
        while body_after.len() + filler_row.len() + 1 + 200 <= target_body_after {
            body_after.extend_from_slice(filler_row.as_bytes());
            body_after.push(b'\n');
        }
        let gap = target_body_after - body_after.len();
        let min_custom = extra_row_prefix.len() + extra_row_suffix.len() + 1;
        assert!(gap >= min_custom, "gap={gap} < {min_custom}");
        let custom_row = format!("{extra_row_prefix}{}{extra_row_suffix}\n", "z".repeat(gap - min_custom));
        body_after.extend_from_slice(custom_row.as_bytes());
        assert_eq!(body_after.len() + rem_from_boundary, max_read);

        let mut final_bytes = Vec::new();
        final_bytes.extend_from_slice(head.as_bytes());
        final_bytes.extend_from_slice(boundary_prefix.as_bytes());
        final_bytes.push(b'\n');
        final_bytes.extend_from_slice(&body_after);

        let seek_pos = final_bytes.len() - max_read;
        assert!((0x80..0xC0).contains(&final_bytes[seek_pos]), "{label}: byte={:#x}", final_bytes[seek_pos]);

        fs::write(&gains, &final_bytes).expect("write 20m gains");
        let loaded = load_telemetry_events(&gains, false);
        assert!(
            loaded.len() >= expected_tail_rows,
            "{label}: expected >= {expected_tail_rows} tail rows, got {}",
            loaded.len()
        );
        assert!(loaded.iter().any(|e| e.file_path == "src/tail.rs"), "{label}");
    }
    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn c1_g2_c1_g3_c1_g8_relative_symlink_zero_event_and_transcript_edge_cases() {
    let tmp = unique_temp_dir("c1_g238");
    let ws = tmp.join("real_ws");
    let sibling = tmp.join("sibling");
    let zero_ws = tmp.join("zero_ws");
    let transcripts = tmp.join("transcripts");
    fs::create_dir_all(ws.join("src")).unwrap();
    fs::create_dir_all(&sibling).unwrap();
    fs::create_dir_all(&zero_ws).unwrap();
    fs::create_dir_all(&transcripts).unwrap();
    fs::write(ws.join("aice.config.json"), r#"{"enabled":true}"#).unwrap();
    fs::write(ws.join("src/a.rs"), "pub fn a() {}\n").unwrap();
    fs::write(zero_ws.join("aice.config.json"), r#"{"enabled":false}"#).unwrap();

    let gains = tmp.join("gains.jsonl");
    meter_rich_payload(&TelemetryRichInput {
        project_root: &ws,
        file_label: "src/a.rs",
        op_kind: TelemetryOpKind::Read,
        surface_label: "cli",
        raw_baseline: "pub fn a() {}\n",
        emitted_payload: "fn a()\n",
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

    let ev = &load_telemetry_events(&gains, false)[0];
    assert!(aice_telemetry::gain_report::matches_project_filter(ev, "../real_ws", &sibling));
    assert_eq!(
        aice_telemetry::env::resolve_project_filter_target(Some("../real_ws"), &sibling),
        fs::canonicalize(&ws).unwrap()
    );

    #[cfg(unix)]
    {
        let link = sibling.join("ws_link");
        std::os::unix::fs::symlink(&ws, &link).unwrap();
        assert!(aice_telemetry::gain_report::matches_project_filter(ev, "./ws_link", &sibling));
    }

    let zero_report = build_gain_report(&GainQuery {
        project: Some(zero_ws.display().to_string()),
        telemetry_path: Some(gains.clone()),
        ..Default::default()
    });
    let zero_detail = zero_report.project_detail.expect("0-event project_detail");
    assert_eq!(zero_detail.summary.calls, 0);
    assert!(!zero_detail.enabled);
    let zero_json = project_detail_to_json(&zero_report.telemetry_path, false, &zero_detail);
    let parsed_zero = parse_json(&zero_json).unwrap();
    assert!(parsed_zero.as_object().unwrap().contains_key("project"));

    fs::write(transcripts.join("bad_utf8.jsonl"), b"\xff\xfe\x00\x01\nnot_utf8_\x80\n").unwrap();
    fs::write(
        transcripts.join("mixed.jsonl"),
        [
            b"{not json\n".as_slice(),
            b"\xff\xfe invalid utf8 line\n".as_slice(),
            format!("{{\"workspace\":\"{}\",\"role\":\"assistant\",\"tool\":\"aice_read\"}}\n", ws.display()).as_bytes(),
        ]
        .concat(),
    )
    .unwrap();
    fs::write(
        transcripts.join("other_project.jsonl"),
        "{\"workspace\":\"/somewhere/unrelated\",\"role\":\"assistant\",\"tool\":\"read_file\"}\n",
    )
    .unwrap();

    let empty_dir = tmp.join("empty_transcripts");
    fs::create_dir_all(&empty_dir).unwrap();
    let analyze_empty = analyze_project(&AnalyzeOptions {
        project: Some(ws.display().to_string()),
        telemetry_path: Some(gains.clone()),
        transcripts_dir: Some(empty_dir),
    });
    assert_eq!(analyze_empty.sessions.len(), 0);

    let analyze = analyze_project(&AnalyzeOptions {
        project: Some(ws.display().to_string()),
        telemetry_path: Some(gains),
        transcripts_dir: Some(transcripts),
    });
    assert_eq!(analyze.total_calls, 1);
    assert_eq!(analyze.sessions.len(), 1);
    assert_eq!(analyze.sessions[0].conversation_id, "mixed");

    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn wave2_f27_parallel_slices_and_auto_outline_followups_not_penalized_as_pagination() {
    use aice_telemetry::economics::compute_project_systemic_economics;
    use aice_telemetry::TelemetryEvent;

    let make_ev = |ts: u64, fp: &str, mf: &[&str], op: &str, n1: usize, rn: usize, a1: usize| {
        let mf_json: Vec<String> = mf.iter().map(|s| format!("\"{s}\"")).collect();
        let mf_part = if mf_json.is_empty() {
            String::new()
        } else {
            format!(",\"mf\":[{}]", mf_json.join(","))
        };
        let rs = rn as isize - a1 as isize;
        let line = format!(
            r#"{{"t":{ts},"r":"/home/user/trial1","p":"trial1","f":"{fp}"{mf_part},"o":"{op}","nc":{},"ac":{},"n1":{n1},"a1":{a1},"n2":{n1},"a2":{a1},"rn":{rn},"rs":{rs}}}"#,
            n1 * 4,
            a1 * 4
        );
        TelemetryEvent::from_json_line(&line).expect("parse synthetic event")
    };

    // 1. Parallel same-turn targeted slices across distinct files increment parallelSliceCalls, 0 seq_pag_turns
    let par_distinct = vec![
        make_ev(10_000, "src/a.rs", &["src/a.rs"], "read", 1200, 300, 220),
        make_ev(10_800, "src/b.rs", &["src/b.rs"], "read", 1100, 280, 200),
        make_ev(11_500, "src/c.rs", &["src/c.rs"], "read", 900, 250, 180),
    ];
    let econ_par = compute_project_systemic_economics(&par_distinct, &[]);
    assert_eq!(econ_par.parallel_slice_calls, 2);
    assert_eq!(econ_par.sequential_pagination_turns, 0);
    assert_eq!(econ_par.pagination_replay_tax_cl100k, 0);

    // 2. Trial-1 pattern: auto-outline multi-file -> next-turn parallel targeted symbol slices across files -> honest TOKEN-REDUCING
    let trial1_like = vec![
        // Turn 1: auto-outline 4 large files (rn == n1, a1 << n1)
        make_ev(
            100_000,
            "<multi-context>",
            &["src/session/mod.rs", "src/ipc/mod.rs", "src/app.rs", "src/ui/mod.rs"],
            "context",
            15_494,
            15_494,
            2_740,
        ),
        // Same turn: auto-outline 3 test files
        make_ev(
            103_000,
            "<multi-context>",
            &["tests/ipc.rs", "tests/session.rs", "tests/ui.rs"],
            "context",
            4_509,
            4_509,
            812,
        ),
        // Turn 2 (parallel burst of 3 targeted slices following auto-outline):
        make_ev(
            125_000,
            "<multi-context>",
            &["src/session/mod.rs", "src/app.rs"],
            "context",
            5_325,
            2_416,
            2_253,
        ),
        make_ev(126_600, "src/ipc/mod.rs", &["src/ipc/mod.rs"], "context", 6_213, 3_067, 2_728),
        make_ev(
            127_400,
            "<multi-context>",
            &["src/ui/mod.rs", "tests/ipc.rs", "tests/ui.rs"],
            "context",
            6_985,
            4_017,
            3_929,
        ),
        // Turn 3: splice
        make_ev(160_000, "<batch-splice>", &["src/app.rs", "src/ipc/mod.rs"], "splice", 4_920, 4_920, 143),
    ];
    let econ_t1 = compute_project_systemic_economics(&trial1_like, &[]);
    assert_eq!(econ_t1.parallel_slice_calls, 2);
    assert_eq!(econ_t1.sequential_pagination_turns, 0);
    assert_eq!(econ_t1.pagination_replay_tax_cl100k, 0);
    assert_eq!(econ_t1.end_to_end_verdict, "TOKEN-REDUCING");
    assert!(econ_t1.net_end_to_end_saved_cl100k > 0);

    // 3. Genuine sequential repeat line-paging (slice -> later-turn slice on same file, no write) IS penalized
    let seq_paging = vec![
        make_ev(200_000, "src/big.rs", &["src/big.rs"], "read", 2000, 400, 320),
        make_ev(225_000, "src/big.rs", &["src/big.rs"], "read", 2000, 400, 320),
        make_ev(250_000, "src/big.rs", &["src/big.rs"], "read", 2000, 400, 320),
    ];
    let econ_pag = compute_project_systemic_economics(&seq_paging, &[]);
    assert_eq!(econ_pag.parallel_slice_calls, 0);
    assert_eq!(econ_pag.sequential_pagination_turns, 2);
    assert_eq!(econ_pag.pagination_replay_tax_cl100k, 17_000);

    // 4. Explicit outline -> next-turn targeted slice is NOT penalized, whereas repeat full re-read IS
    let explicit_ol_and_reread = vec![
        make_ev(300_000, "src/lib.rs", &["src/lib.rs"], "outline", 1200, 1200, 160),
        make_ev(320_000, "src/lib.rs", &["src/lib.rs"], "read", 1200, 300, 240),
        make_ev(350_000, "src/full.rs", &["src/full.rs"], "read", 500, 500, 420),
        make_ev(375_000, "src/full.rs", &["src/full.rs"], "read", 500, 500, 420),
    ];
    let econ_ol = compute_project_systemic_economics(&explicit_ol_and_reread, &[]);
    assert_eq!(econ_ol.sequential_pagination_turns, 1);
}

#[test]
fn wave2_f32_excluded_and_suppressed_skip_bpe_while_recorded_rows_keep_exact_dual_bpe() {
    let tmp = unique_temp_dir("f32_bpe");
    let gains = tmp.join("gains.jsonl");
    let raw_cjk = "// 日本語コメント: 東京タワー🗼 — café résumé naïve 🚀\nconst msg = \"你好世界\";\n";
    let emitted_cjk = "// AICE\nconst msg = \"你好世界\";\n";
    let no_override_env = |_: &str| -> Option<String> { None };

    // 1. Ephemeral /tmp workspace without override -> excluded -> skips BPE metering (0 cl100k/o200k)
    let excl = meter_rich_payload_with(
        &TelemetryRichInput {
            project_root: &tmp.join("ephemeral_ws"),
            file_label: "src/i18n.ts",
            op_kind: TelemetryOpKind::Read,
            surface_label: "cli",
            raw_baseline: raw_cjk,
            emitted_payload: emitted_cjk,
            realistic_native_payload: None,
            multi_files: &[],
            language: None,
            agent: None,
            is_search_mode: false,
            preserved_trivia_tokens: 0,
            wasted_input_tokens: None,
            explicit_telemetry_path: None,
            record_ledger: true,
            should_meter_bpe: true,
        },
        &no_override_env,
    );
    assert!(excl.summary.ledger_path.is_none());
    assert_eq!(excl.summary.native_cl100k, 0);
    assert_eq!(excl.summary.native_o200k, 0);
    assert_eq!(excl.summary.aice_cl100k, 0);
    assert_eq!(excl.summary.aice_o200k, 0);

    // 2. Suppressed telemetry -> skips BPE metering even on non-ephemeral workspace
    let supp = with_suppressed_telemetry(|| {
        meter_rich_payload(&TelemetryRichInput {
            project_root: Path::new("/home/test/real_ws"),
            file_label: "src/i18n.ts",
            op_kind: TelemetryOpKind::Splice,
            surface_label: "cli",
            raw_baseline: raw_cjk,
            emitted_payload: emitted_cjk,
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
        })
    });
    assert!(supp.summary.ledger_path.is_none());
    assert_eq!(supp.summary.native_cl100k, 0);
    assert_eq!(supp.summary.native_o200k, 0);

    // 3. Recorded ledger row preserves 100% exact Law 3 dual-BPE (cl100k + o200k)
    let rec = meter_rich_payload(&TelemetryRichInput {
        project_root: Path::new("/home/test/real_ws"),
        file_label: "src/i18n.ts",
        op_kind: TelemetryOpKind::Read,
        surface_label: "cli",
        raw_baseline: raw_cjk,
        emitted_payload: emitted_cjk,
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
    assert!(rec.summary.ledger_path.is_some());
    assert_eq!(rec.summary.native_cl100k, count_cl100k(raw_cjk));
    assert_eq!(rec.summary.native_o200k, count_o200k(raw_cjk));
    assert_ne!(rec.summary.native_cl100k, rec.summary.native_o200k);
    let rows = load_telemetry_events(&gains, false);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].native_cl100k, count_cl100k(raw_cjk));
    assert_eq!(rows[0].native_o200k, count_o200k(raw_cjk));
    assert_eq!(rows[0].aice_cl100k, count_cl100k(emitted_cjk));
    assert_eq!(rows[0].aice_o200k, count_o200k(emitted_cjk));

    let _ = fs::remove_dir_all(&tmp);
}
