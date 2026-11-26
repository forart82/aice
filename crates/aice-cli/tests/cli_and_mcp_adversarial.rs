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
use aice_cli::mcp_framing::{FrameEvent, McpFrameReader};
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
