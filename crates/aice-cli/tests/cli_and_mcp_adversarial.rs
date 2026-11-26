use std::collections::BTreeMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use aice_cli::cli::{CliAction, CliParseError, parse_args};
use aice_cli::cmd_admin_parse::{parse_agents, parse_analyze, parse_benchmark, parse_gain};
use aice_cli::cmd_discover::{parse_find_args, parse_search_args};
use aice_cli::cmd_read::parse_read_args;
use aice_cli::cmd_write::parse_write_args_with_stdin;
use aice_cli::cmd_write_targets::{looks_like_manifest_file, should_consume_delete_arg};
use aice_cli::flags_norm::normalize_ingress_flags;
use aice_cli::mcp_args::{opt_bool, opt_str, opt_usize, split_read_target_string};
use aice_cli::mcp_framing::{FrameEvent, MAX_MCP_FRAME_BYTES, McpFrameReader};
use aice_cli::mcp_map_read::handle_read;
use aice_cli::mcp_map_write::handle_write;
use aice_cli::mcp_schemas::{build_initialize_result, build_tools_list_result};
use aice_cli::mcp_server::is_supported_mcp_tool;
use aice_governance::JsonValue;

fn svec(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| (*s).to_string()).collect()
}

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let d = std::env::temp_dir().join(format!("aice_cli_adv_{tag}_{}_{nanos}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn flags_norm_and_cli_passthrough_and_numeric_edge_cases() {
    let norm = normalize_ingress_flags(&svec(&[
        "--color",
        "read",
        "-d1",
        "-c2",
        "--maxTokens=50",
        "--",
        "-d1",
        "--color",
    ]));
    assert_eq!(
        norm,
        svec(&["read", "-d", "1", "-C", "2", "--max-tokens", "50", "--", "-d1", "--color"])
    );

    let find_norm = normalize_ingress_flags(&svec(&["--no-color", "find", "-L1", "--maxDepth=2"]));
    assert_eq!(find_norm, svec(&["find", "-d", "1", "-d", "2"]));

    // -d -h must not be hijacked as --help when -d expects a value
    let cwd = Path::new(".");
    let err_dh = parse_args(&svec(&["read", "-d", "-h", "a.rs"]), cwd).unwrap_err();
    assert!(matches!(err_dh, CliParseError::Message(_)));

    // -- passthrough allows filenames starting with '-'
    let Ok(CliAction::Read(rop)) = parse_args(&svec(&["read", "--", "-d1"]), cwd) else {
        panic!("expected CliAction::Read");
    };
    assert_eq!(rop.targets, vec!["-d1"]);

    // Numeric edge cases: 0, -0, u64::MAX, missing values
    assert_eq!(parse_read_args(&svec(&["a.rs", "--max-tokens", "0"])).unwrap().max_tokens, Some(0));
    assert!(parse_read_args(&svec(&["a.rs", "--max-tokens", "-0"])).is_err());
    assert!(parse_read_args(&svec(&["a.rs", "--max-tokens", "184467440737095516150"])).is_err());
    assert!(parse_read_args(&svec(&["a.rs", "--max-tokens"])).is_err());
    assert!(parse_search_args(&svec(&["pat", "-C", "1e20"])).is_err());
    assert!(parse_find_args(&svec(&["-d"]), cwd).is_err());

    // Admin parse edge cases
    assert!(parse_agents(&svec(&["-a", "unknown_agent"])).is_err());
    assert!(parse_gain(&svec(&["-p", "   "])).is_err());
    assert!(parse_analyze(&svec(&["--transcripts-dir", ""]), cwd).is_err());
    assert!(parse_benchmark(&svec(&["extra"])).is_err());
}

#[test]
fn cmd_write_rejects_conflicting_stdin_flags_and_covers_delete_manifest_helpers() {
    let cwd = Path::new(".");
    for bad in [
        &["--edits", "-", "--batch", "-"][..],
        &["--edits=-", "--batch=-"][..],
        &["--edits", "-", "--edits", "-"][..],
        &["--batch", "-", "--batch", "-"][..],
        &["--edits", "-", "--stdin"][..],
        &["--stdin", "--edits", "-"][..],
        &["--stdin", "--batch", "-"][..],
        &["--stdin", "--stdin"][..],
    ] {
        let err = parse_write_args_with_stdin(&svec(bad), cwd, || Ok("[]".into())).unwrap_err();
        let CliParseError::Message(msg) = err;
        assert!(msg.contains("stdin"), "bad={bad:?}, msg={msg}");
    }

    assert!(!should_consume_delete_arg(&svec(&["-d", "--dry-run"]), 0, false));
    assert!(should_consume_delete_arg(&svec(&["a.rs", "-d", "foo"]), 1, true));
    assert!(looks_like_manifest_file("edits.json"));
    assert!(!looks_like_manifest_file("-"));
    assert!(!looks_like_manifest_file("[{\"path\":\"a.rs\"}]"));
    assert!(!looks_like_manifest_file("=== a.rs ===\ncode\n"));
}

#[test]
fn mcp_split_read_target_string_handles_multi_selectors_and_spaced_paths() {
    let dir = temp_dir("split_targets");
    std::fs::write(dir.join("a.ts"), "export function foo() {}\n").unwrap();
    std::fs::write(dir.join("b.ts"), "export function bar() {}\n").unwrap();
    std::fs::write(dir.join("my file.ts"), "export function baz() {}\n").unwrap();

    assert_eq!(split_read_target_string("a.ts:foo b.ts:bar", &dir), svec(&["a.ts:foo", "b.ts:bar"]));
    assert_eq!(split_read_target_string("a.ts:L1-L1 b.ts:L1-L1", &dir), svec(&["a.ts:L1-L1", "b.ts:L1-L1"]));
    assert_eq!(split_read_target_string("a.ts:/foo bar/ b.ts", &dir), svec(&["a.ts:/foo bar/", "b.ts"]));
    assert_eq!(split_read_target_string("a.ts:foo b.ts", &dir), svec(&["a.ts:foo", "b.ts"]));
    assert_eq!(split_read_target_string("'my file.ts':baz", &dir), svec(&["my file.ts:baz"]));
    assert_eq!(split_read_target_string("my file.ts", &dir), svec(&["my file.ts"]));
    assert_eq!(split_read_target_string("my file.ts:baz", &dir), svec(&["my file.ts:baz"]));
    assert_eq!(split_read_target_string("my file.ts:/baz qux/", &dir), svec(&["my file.ts:/baz qux/"]));

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn mcp_args_schemas_mapping_and_ct_eof_framing_adversarial() {
    let mut map = BTreeMap::new();
    map.insert("neg_zero".into(), JsonValue::Number(-0.0));
    map.insert("big_float".into(), JsonValue::Number(1e20));
    map.insert("u64_max".into(), JsonValue::Number(18446744073709551615.0));
    map.insert("js_unsafe".into(), JsonValue::Number(9007199254740992.0));
    map.insert("frac".into(), JsonValue::Number(1.5));
    map.insert("flag".into(), JsonValue::String("not_bool".into()));
    map.insert("text".into(), JsonValue::Number(42.0));

    assert_eq!(opt_usize(&map, &["neg_zero"]).unwrap(), Some(0));
    assert!(opt_usize(&map, &["big_float"]).is_err());
    assert!(opt_usize(&map, &["u64_max"]).is_err());
    assert!(opt_usize(&map, &["frac"]).is_err());
    assert!(opt_usize(&map, &["js_unsafe"]).is_err());
    assert!(opt_bool(&map, &["flag"]).is_err());
    assert!(opt_str(&map, &["text"]).is_err());

    assert!(is_supported_mcp_tool("aice_read"));
    assert!(is_supported_mcp_tool("aice_splice"));
    assert!(!is_supported_mcp_tool("aice_context"));
    assert!(build_initialize_result().as_object().unwrap().contains_key("capabilities"));
    assert_eq!(
        build_tools_list_result()
            .as_object()
            .unwrap()
            .get("tools")
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        2
    );

    // Invalid arg mapping returns -32602 without emitting stdout
    let mut bad_read = BTreeMap::new();
    bad_read.insert("targets".into(), JsonValue::Number(1.0));
    assert_eq!(handle_read(&bad_read, &JsonValue::Null, Path::new("."), false).unwrap_err().0, -32602);
    let mut bad_write = BTreeMap::new();
    bad_write.insert("delete".into(), JsonValue::Number(1.0));
    assert_eq!(handle_write(&bad_write, &JsonValue::Null, Path::new("."), false).unwrap_err().0, -32602);

    // C1-G6: Content-Type-only EOF mid-header emits a single FrameEvent::ParseError
    let mut reader = McpFrameReader::new(Cursor::new(b"Content-Type: application/json\r\nX-Extra: 1"));
    let first = reader.next_frame().unwrap();
    assert!(matches!(first, Some(FrameEvent::ParseError)));
    assert!(reader.is_framed());
    assert!(reader.next_frame().unwrap().is_none());

    // Zero Content-Length and overflow Content-Length both yield ParseError cleanly
    let mut zero_cl = McpFrameReader::new(Cursor::new(b"Content-Length: 0\r\n\r\n"));
    assert!(matches!(zero_cl.next_frame().unwrap(), Some(FrameEvent::ParseError)));
    let mut over_cl = McpFrameReader::new(Cursor::new(
        b"Content-Length: 99999999999999999999999\r\n\r\n{\"a\":1}\nContent-Length: 40\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"ping\"}",
    ));
    assert!(matches!(over_cl.next_frame().unwrap(), Some(FrameEvent::ParseError)));
    assert!(matches!(over_cl.next_frame().unwrap(), Some(FrameEvent::Message(_))));
}

#[test]
fn cli_subcommand_help_aliases_and_mcp_generate_schemas_parsing() {
    let cwd = Path::new("/tmp");
    for (alias, canon) in [
        ("read", "read"),
        ("context", "read"),
        ("ctx", "read"),
        ("search", "search"),
        ("grep", "search"),
        ("find", "find"),
        ("tree", "find"),
        ("splice", "splice"),
        ("write", "splice"),
        ("enable", "enable"),
        ("disable", "disable"),
        ("config", "config"),
        ("status", "config"),
        ("agents", "agents"),
        ("gain", "gain"),
        ("gains", "gain"),
        ("stats", "gain"),
        ("telemetry", "gain"),
        ("analyze", "analyze"),
        ("mcp", "mcp"),
        ("benchmark", "benchmark"),
        ("bench", "benchmark"),
    ] {
        let Ok(CliAction::Help(Some(topic))) = parse_args(&svec(&[alias, "--help"]), cwd) else {
            panic!("expected CliAction::Help(Some({canon})) for '{alias}'");
        };
        assert_eq!(topic, canon);
    }

    assert!(matches!(parse_args(&svec(&["--help"]), cwd), Ok(CliAction::Help(None))));
    assert!(matches!(parse_args(&svec(&[]), cwd), Ok(CliAction::Help(None))));
    assert!(parse_args(&svec(&["bogus", "--help"]), cwd).is_err());

    // MCP schema output directory validation
    assert!(parse_args(&svec(&["mcp", "--generate-schemas", ""]), cwd).is_err());
    assert!(parse_args(&svec(&["mcp", "--generate-schemas="]), cwd).is_err());
    assert!(parse_args(&svec(&["mcp", "--generate-schemas=   "]), cwd).is_err());

    let Ok(CliAction::Mcp(op)) = parse_args(&svec(&["mcp", "--generate-schemas", "out_dir"]), cwd) else {
        panic!("expected CliAction::Mcp");
    };
    assert_eq!(
        op.action,
        aice_governance::AdminAction::Mcp {
            generate_schemas: Some(PathBuf::from("/tmp/out_dir")),
        }
    );

    // Dead "dsl" property removed from aice_read schema
    let tools = build_tools_list_result();
    let read_props = tools
        .as_object()
        .unwrap()
        .get("tools")
        .unwrap()
        .as_array()
        .unwrap()[0]
        .as_object()
        .unwrap()
        .get("inputSchema")
        .unwrap()
        .as_object()
        .unwrap()
        .get("properties")
        .unwrap()
        .as_object()
        .unwrap();
    assert!(!read_props.contains_key("dsl"), "dead 'dsl' schema prop must be removed");
}

#[test]
fn wave1_f16_failed_batch_splice_logs_honest_errors_across_cli_and_mcp() {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let bin = env!("CARGO_BIN_EXE_aice");

    // 1. CLI failed multi-file batch rollback logs to errors.jsonl while keeping T3-05 gains.jsonl clean,
    //    and `aice gain --json` reports honest failedRetryTurns & spliceErrorRatePct > 0.
    let cli_dir = temp_dir("f16_cli");
    let cli_home = cli_dir.join("aice_home");
    std::fs::create_dir_all(cli_dir.join("src")).unwrap();
    std::fs::write(cli_dir.join("aice.config.json"), "{\"enabled\":true}\n").unwrap();
    std::fs::write(cli_dir.join("src/a.rs"), "pub fn alpha() -> i32 { 1 }\n").unwrap();
    std::fs::write(cli_dir.join("src/b.rs"), "pub fn beta() -> i32 { 2 }\n").unwrap();

    let run_aice = |args: &[&str], stdin_data: Option<&str>, cwd: &Path, aice_home: &Path| {
        let mut cmd = Command::new(bin);
        cmd.args(args)
            .current_dir(cwd)
            .env("HOME", aice_home)
            .env("AICE_HOME", aice_home)
            .env_remove("AICE_TELEMETRY_PATH")
            .env_remove("AICE_TELEMETRY_ERRORS_PATH")
            .env_remove("AICE_TELEMETRY_SUPPRESS")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if stdin_data.is_some() {
            cmd.stdin(Stdio::piped());
        }
        let mut child = cmd.spawn().unwrap();
        if let Some(input) = stdin_data {
            child.stdin.as_mut().unwrap().write_all(input.as_bytes()).unwrap();
        }
        child.wait_with_output().unwrap()
    };

    // Valid splice first so gains.jsonl has 1 successful write for this project
    let ok = run_aice(&["splice", "src/a.rs:alpha", "-c", "pub fn alpha() -> i32 { 10 }"], None, &cli_dir, &cli_home);
    assert_eq!(ok.status.code(), Some(0));
    let gains_path = cli_home.join("telemetry/gains.jsonl");
    let errs_path = cli_home.join("telemetry/errors.jsonl");
    let gains_before = std::fs::read_to_string(&gains_path).unwrap().lines().count();

    // Failed multi-file batch rollback (SyntaxFirewall) -> 0 new gains rows, +1 errors.jsonl row
    let bad_batch = "=== src/a.rs:alpha ===\npub fn alpha() -> i32 { 99 }\n=== src/b.rs:beta ===\npub fn beta( { {{{{\n";
    let fail = run_aice(&["splice", "--stdin"], Some(bad_batch), &cli_dir, &cli_home);
    assert_eq!(fail.status.code(), Some(1));
    assert_eq!(std::fs::read_to_string(&gains_path).unwrap().lines().count(), gains_before);
    let errs_cli = std::fs::read_to_string(&errs_path).expect("CLI batch failure must create errors.jsonl");
    assert!(errs_cli.contains("\"surface\":\"cli\"") && errs_cli.contains("\"operation\":\"splice\""), "{errs_cli}");
    assert!(errs_cli.contains("\"wastedInputTokens\":"), "{errs_cli}");

    // Dry-run failed batch must NOT append to errors.jsonl
    let err_lines_before_dry = errs_cli.lines().count();
    let dry_fail = run_aice(&["splice", "--stdin", "--dry-run"], Some(bad_batch), &cli_dir, &cli_home);
    assert_eq!(dry_fail.status.code(), Some(1));
    assert_eq!(std::fs::read_to_string(&errs_path).unwrap().lines().count(), err_lines_before_dry);

    // Pre-commit batch failure (--batch malformed JSON) also logs to errors.jsonl, 0 gains rows
    let mal_fail = run_aice(&["splice", "--batch", "{bad"], None, &cli_dir, &cli_home);
    assert_eq!(mal_fail.status.code(), Some(1));
    assert_eq!(std::fs::read_to_string(&gains_path).unwrap().lines().count(), gains_before);
    assert_eq!(std::fs::read_to_string(&errs_path).unwrap().lines().count(), err_lines_before_dry + 1);

    // `aice gain --json` reflects the failed batch splices honestly
    let gain_out = run_aice(&["gain", "--json"], None, &cli_dir, &cli_home);
    assert_eq!(gain_out.status.code(), Some(0));
    let gain_str = String::from_utf8_lossy(&gain_out.stdout);
    let gain_val = aice_governance::parse_json(&gain_str).expect("valid gain --json");
    let econ = gain_val.as_object().unwrap();
    assert!(econ.get("failedRetryTurns").and_then(JsonValue::as_u64).unwrap_or(0) >= 2, "{gain_str}");
    assert!(econ.get("spliceErrorRatePct").and_then(JsonValue::as_f64).unwrap_or(0.0) > 0.0, "{gain_str}");

    // 2. MCP failed multi-file batch rollback logs to errors.jsonl (surface:mcp) and drives honest spliceErrorRatePct
    let mcp_dir = temp_dir("f16_mcp");
    let mcp_home = mcp_dir.join("aice_home");
    std::fs::create_dir_all(mcp_dir.join("src")).unwrap();
    std::fs::write(mcp_dir.join("aice.config.json"), "{\"enabled\":true}\n").unwrap();
    std::fs::write(mcp_dir.join("src/a.ts"), "export function alpha(): number { return 1; }\n").unwrap();
    std::fs::write(mcp_dir.join("src/b.ts"), "export function beta(): number { return 2; }\n").unwrap();

    let mcp_msgs = concat!(
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"aice_splice\",\"arguments\":{\"filePath\":\"src/a.ts\",\"symbol\":\"alpha\",\"code\":\"export function alpha(): number { return 11; }\"}}}\n",
        "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"aice_splice\",\"arguments\":{\"filePath\":\"src/b.ts\",\"symbol\":\"beta\",\"code\":\"export function beta(): number { return 22; }\"}}}\n",
        "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"aice_splice\",\"arguments\":{\"code\":\"=== src/a.ts:alpha ===\\nexport function alpha(): number { return 33; }\\n=== src/b.ts:beta ===\\nexport function beta( { broken ===\\n\"}}}\n",
    );
    let mcp_out = run_aice(&["mcp"], Some(mcp_msgs), &mcp_dir, &mcp_home);
    assert_eq!(mcp_out.status.code(), Some(0), "mcp stderr={}", String::from_utf8_lossy(&mcp_out.stderr));
    let mcp_errs = std::fs::read_to_string(mcp_home.join("telemetry/errors.jsonl"))
        .expect("MCP batch rollback must create errors.jsonl");
    assert!(mcp_errs.contains("\"surface\":\"mcp\"") && mcp_errs.contains("\"operation\":\"splice\""), "{mcp_errs}");
    assert_eq!(mcp_errs.lines().count(), 1, "{mcp_errs}");

    let mcp_gain = run_aice(&["gain", "--json"], None, &mcp_dir, &mcp_home);
    assert_eq!(mcp_gain.status.code(), Some(0));
    let mg_str = String::from_utf8_lossy(&mcp_gain.stdout);
    let mg_val = aice_governance::parse_json(&mg_str).expect("valid mcp gain --json");
    let mg_econ = mg_val.as_object().unwrap();
    assert_eq!(mg_econ.get("failedRetryTurns").and_then(JsonValue::as_u64), Some(1), "{mg_str}");
    let err_pct = mg_econ.get("spliceErrorRatePct").and_then(JsonValue::as_f64).unwrap_or(0.0);
    assert!((err_pct - 33.3).abs() < 0.2, "expected ~33.3% spliceErrorRatePct (1/3), got {err_pct}\n{mg_str}");

    let _ = std::fs::remove_dir_all(&cli_dir);
    let _ = std::fs::remove_dir_all(&mcp_dir);
}

#[test]
fn wave2_f32_mcp_frame_cap_shrink_and_non_ledger_dry_run() {
    use std::io::Write;
    use std::process::{Command, Stdio};

    assert_eq!(MAX_MCP_FRAME_BYTES, 64 * 1024 * 1024);

    // 1. Oversized Content-Length (> 64 MiB, fits in usize) returns ParseError without OOM and recovers next ping
    let over_cap = MAX_MCP_FRAME_BYTES + 1;
    let payload = format!(
        "Content-Length: {over_cap}\r\n\r\n{{\"huge\":true}}\nContent-Length: 40\r\n\r\n{{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"ping\"}}"
    );
    let mut cap_reader = McpFrameReader::new(Cursor::new(payload.into_bytes()));
    assert!(matches!(cap_reader.next_frame().unwrap(), Some(FrameEvent::ParseError)));
    assert!(matches!(cap_reader.next_frame().unwrap(), Some(FrameEvent::Message(_))));
    assert!(cap_reader.next_frame().unwrap().is_none());

    // 2. Oversized Content-Length with immediate EOF returns ParseError without allocating
    let huge_eof = format!("Content-Length: {}\r\n\r\n", 1024usize * 1024 * 1024);
    let mut eof_reader = McpFrameReader::new(Cursor::new(huge_eof.into_bytes()));
    assert!(matches!(eof_reader.next_frame().unwrap(), Some(FrameEvent::ParseError)));
    assert!(eof_reader.buf_capacity() <= 64 * 1024);

    // 3. Large valid Content-Length frame (> 256 KiB) grows buffer then shrinks capacity back down to <= 64 KiB
    let big_str = "a".repeat(320 * 1024);
    let big_body = format!("{{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\",\"pad\":\"{big_str}\"}}");
    let big_frame = format!("Content-Length: {}\r\n\r\n{big_body}", big_body.len());
    let mut shrink_reader = McpFrameReader::new(Cursor::new(big_frame.into_bytes()));
    assert!(matches!(shrink_reader.next_frame().unwrap(), Some(FrameEvent::Message(_))));
    assert!(
        shrink_reader.buf_capacity() <= 64 * 1024,
        "expected buf capacity <= 64 KiB after draining large frame, got {}",
        shrink_reader.buf_capacity()
    );

    // 4. Large newline-delimited frame also shrinks buffer capacity back down to <= 64 KiB
    let big_nl = format!("{big_body}\n");
    let mut nl_reader = McpFrameReader::new(Cursor::new(big_nl.into_bytes()));
    assert!(matches!(nl_reader.next_frame().unwrap(), Some(FrameEvent::Message(_))));
    assert!(
        nl_reader.buf_capacity() <= 64 * 1024,
        "expected newline buf capacity <= 64 KiB, got {}",
        nl_reader.buf_capacity()
    );

    // 5. End-to-end `aice mcp` emits -32700 Parse error on > 64 MiB Content-Length and serves following ping
    let dir = temp_dir("f32_mcp");
    let home = dir.join("aice_home");
    std::fs::write(dir.join("aice.config.json"), "{\"enabled\":true}\n").unwrap();
    std::fs::write(dir.join("src_a.rs"), "pub fn alpha() -> i32 { 1 }\n").unwrap();

    let bin = env!("CARGO_BIN_EXE_aice");
    let mcp_in = format!(
        "Content-Length: {over_cap}\r\n\r\n{{\"bad\":1}}\nContent-Length: 40\r\n\r\n{{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"ping\"}}"
    );
    let mut child = Command::new(bin)
        .arg("mcp")
        .current_dir(&dir)
        .env("HOME", &home)
        .env("AICE_HOME", &home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.as_mut().unwrap().write_all(mcp_in.as_bytes()).unwrap();
    let out = child.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("-32700"), "expected -32700 parse error, got: {stdout}");
    assert!(stdout.contains("\"id\":7"), "expected recovered ping id=7, got: {stdout}");

    // 6. Non-ledger CLI `splice --dry-run` succeeds cleanly without creating gains.jsonl
    let dry = Command::new(bin)
        .args(["splice", "src_a.rs:alpha", "-c", "pub fn alpha() -> i32 { 2 }", "--dry-run"])
        .current_dir(&dir)
        .env("HOME", &home)
        .env("AICE_HOME", &home)
        .env_remove("AICE_TELEMETRY_PATH")
        .output()
        .unwrap();
    assert_eq!(dry.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&dry.stderr));
    assert!(!home.join("telemetry/gains.jsonl").exists());

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn wave3_f38_f39_f46_f49_dup_content_length_schema_mcp_dedup_and_error_only_gain() {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let bin = env!("CARGO_BIN_EXE_aice");
    let run_aice = |args: &[&str], stdin_data: Option<&str>, cwd: &Path, aice_home: &Path| {
        let mut cmd = Command::new(bin);
        cmd.args(args)
            .current_dir(cwd)
            .env("HOME", aice_home)
            .env("AICE_HOME", aice_home)
            .env_remove("AICE_TELEMETRY_PATH")
            .env_remove("AICE_TELEMETRY_ERRORS_PATH")
            .env_remove("AICE_TELEMETRY_SUPPRESS")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if stdin_data.is_some() {
            cmd.stdin(Stdio::piped());
        }
        let mut child = cmd.spawn().unwrap();
        if let Some(input) = stdin_data {
            child.stdin.as_mut().unwrap().write_all(input.as_bytes()).unwrap();
        }
        child.wait_with_output().unwrap()
    };

    // 1. F-38: Duplicate/conflicting/invalid Content-Length headers reject with ParseError (-32700)
    let dup_conflict = concat!(
        "Content-Length: 40\r\nContent-Length: 999\r\n\r\n",
        "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"ping\"}",
        "Content-Length: 40\r\n\r\n",
        "{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"ping\"}"
    );
    let mut r = McpFrameReader::new(Cursor::new(dup_conflict.as_bytes()));
    assert!(matches!(r.next_frame().unwrap(), Some(FrameEvent::ParseError)));
    assert!(matches!(r.next_frame().unwrap(), Some(FrameEvent::Message(_))));
    assert!(r.next_frame().unwrap().is_none());

    for bad_hdr in [
        "Content-Length: 40\r\ncontent-length: 40\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}",
        "Content-Length: 40\r\nContent-Length: bad\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"ping\"}",
        "Content-Length: +40\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"ping\"}",
    ] {
        let mut br = McpFrameReader::new(Cursor::new(bad_hdr.as_bytes()));
        assert!(matches!(br.next_frame().unwrap(), Some(FrameEvent::ParseError)), "{bad_hdr}");
        assert!(br.next_frame().unwrap().is_none(), "{bad_hdr}");
    }

    // 2. F-39: Both `aice_read` and `aice_splice` expose `"required": []` in `inputSchema`
    let tools_list = build_tools_list_result();
    let tools = tools_list.as_object().unwrap().get("tools").unwrap().as_array().unwrap();
    assert_eq!(tools.len(), 2);
    for tool in tools {
        let req = tool
            .as_object()
            .unwrap()
            .get("inputSchema")
            .unwrap()
            .as_object()
            .unwrap()
            .get("required")
            .and_then(JsonValue::as_array);
        assert_eq!(req, Some([].as_slice()), "missing required: [] on {tool:?}");
    }

    // End-to-end `aice mcp`: F-38 (-32700 + recovery) + F-39 (`tools/list` required: [])
    let dir = temp_dir("w3_mcp_f38_f39");
    let home = dir.join("aice_home");
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("aice.config.json"), "{\"enabled\":true}\n").unwrap();
    std::fs::write(dir.join("src/a.ts"), "export function alpha(): number { return 1; }\n").unwrap();
    std::fs::write(dir.join("src/b.ts"), "export function beta(): number { return 2; }\n").unwrap();

    let mcp_f38 = run_aice(&["mcp"], Some(dup_conflict), &dir, &home);
    assert_eq!(mcp_f38.status.code(), Some(0));
    let f38_out = String::from_utf8_lossy(&mcp_f38.stdout);
    assert!(f38_out.contains("-32700"), "expected -32700 on duplicate Content-Length: {f38_out}");
    assert!(!f38_out.contains("\"id\":5"), "smuggled id=5 must be rejected: {f38_out}");
    assert!(f38_out.contains("\"id\":6"), "following valid ping id=6 must recover: {f38_out}");

    let mcp_list = run_aice(
        &["mcp"],
        Some("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}\n"),
        &dir,
        &home,
    );
    assert_eq!(mcp_list.status.code(), Some(0));
    let list_json = aice_governance::parse_json(String::from_utf8_lossy(&mcp_list.stdout).trim())
        .expect("valid tools/list json");
    let rpc_tools = list_json
        .as_object()
        .unwrap()
        .get("result")
        .unwrap()
        .as_object()
        .unwrap()
        .get("tools")
        .unwrap()
        .as_array()
        .unwrap();
    assert_eq!(rpc_tools.len(), 2);
    for t in rpc_tools {
        let req = t
            .as_object()
            .unwrap()
            .get("inputSchema")
            .unwrap()
            .as_object()
            .unwrap()
            .get("required")
            .and_then(JsonValue::as_array);
        assert_eq!(req, Some([].as_slice()), "tools/list missing required: [] on {t:?}");
    }

    // 3. F-46 E2E: 1 single-file MCP splice fail + 1 batch MCP splice fail + 1 MCP read fail -> failedRetryTurns == 3
    let f46_home = dir.join("f46_home");
    let f46_msgs = concat!(
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"aice_splice\",\"arguments\":{\"filePath\":\"src/a.ts\",\"symbol\":\"alpha\",\"code\":\"export function alpha( { broken ===\"}}}\n",
        "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"aice_splice\",\"arguments\":{\"code\":\"=== src/a.ts:alpha ===\\nexport function alpha(): number { return 11; }\\n=== src/b.ts:beta ===\\nexport function beta( { broken ===\\n\"}}}\n",
        "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"aice_read\",\"arguments\":{\"path\":\"src/does_not_exist.ts\"}}}\n",
    );
    let f46_mcp = run_aice(&["mcp"], Some(f46_msgs), &dir, &f46_home);
    assert_eq!(f46_mcp.status.code(), Some(0));
    let f46_gain = run_aice(&["gain", "--all", "--json"], None, &dir, &f46_home);
    assert_eq!(f46_gain.status.code(), Some(0));
    let f46_str = String::from_utf8_lossy(&f46_gain.stdout);
    let f46_val = aice_governance::parse_json(&f46_str).expect("valid f46 gain json");
    assert_eq!(
        f46_val.as_object().unwrap().get("failedRetryTurns").and_then(JsonValue::as_u64),
        Some(3),
        "expected 3 failedRetryTurns (not 5): {f46_str}"
    );

    // 4. F-49 E2E: Only 1 failing batch splice into fresh AICE_HOME (no gains.jsonl) -> failedRetryTurns: 1, spliceErrorRatePct: 100
    let f49_home = dir.join("f49_home");
    let bad_batch = "=== src/a.ts:alpha ===\nexport function alpha(): number { return 99; }\n=== src/b.ts:beta ===\nexport function beta( { broken ===\n";
    let f49_fail = run_aice(&["splice", "--stdin"], Some(bad_batch), &dir, &f49_home);
    assert_eq!(f49_fail.status.code(), Some(1));
    assert!(!f49_home.join("telemetry/gains.jsonl").exists());
    assert!(f49_home.join("telemetry/errors.jsonl").is_file());

    let f49_gain = run_aice(&["gain", "--all", "--json"], None, &dir, &f49_home);
    assert_eq!(f49_gain.status.code(), Some(0));
    let f49_str = String::from_utf8_lossy(&f49_gain.stdout);
    let f49_val = aice_governance::parse_json(&f49_str).expect("valid f49 gain json");
    let f49_obj = f49_val.as_object().unwrap();
    assert_eq!(f49_obj.get("failedRetryTurns").and_then(JsonValue::as_u64), Some(1), "{f49_str}");
    assert_eq!(f49_obj.get("spliceErrorRatePct").and_then(JsonValue::as_f64), Some(100.0), "{f49_str}");
    assert_eq!(
        f49_obj.get("endToEndVerdict").and_then(JsonValue::as_str),
        Some("TOKEN-CONSUMING"),
        "{f49_str}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}
