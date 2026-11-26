use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

use aice_governance::{JsonValue, parse_json};
use aice_telemetry::{count_cl100k, count_o200k};

static TMP_SEQ: AtomicU64 = AtomicU64::new(1);

struct Tw {
    dir: PathBuf,
}

impl Tw {
    fn new(prefix: &str) -> Self {
        let id = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "aice_w4_m3_{prefix}_{}_{}",
            std::process::id(),
            id
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir temp ws");
        fs::write(
            dir.join("aice.config.json"),
            "{\"enabled\":true,\"idiomsEnabled\":false}\n",
        )
        .expect("write config");
        Self { dir }
    }

    fn write(&self, rel: &str, content: &str) {
        let p = self.dir.join(rel);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).expect("mkdir parent");
        }
        fs::write(&p, content).expect("write fixture");
    }

    fn write_bytes(&self, rel: &str, bytes: &[u8]) {
        let p = self.dir.join(rel);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).expect("mkdir parent");
        }
        fs::write(&p, bytes).expect("write binary fixture");
    }

    fn read(&self, rel: &str) -> String {
        fs::read_to_string(self.dir.join(rel)).expect("read file")
    }

    fn exists(&self, rel: &str) -> bool {
        self.dir.join(rel).exists()
    }

    fn path(&self) -> &Path {
        &self.dir
    }
}

impl Drop for Tw {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn seed_ts_workspace(ws: &Tw) {
    ws.write(
        "src/math.ts",
        "export interface CalcResult {\n  value: number;\n  label: string;\n}\n\nexport class Calculator {\n  constructor(private offset = 0) {}\n\n  public add(a: number, b: number): CalcResult {\n    return { value: a + b + this.offset, label: \"sum\" };\n  }\n\n  public mul(a: number, b: number): CalcResult {\n    return { value: a * b, label: \"prod\" };\n  }\n}\n",
    );
    ws.write(
        "src/app.ts",
        "import { Calculator, type CalcResult } from \"./math.js\";\n\nexport class App {\n  private calc: Calculator;\n  private count = 0;\n\n  constructor(offset = 1) {\n    this.calc = new Calculator(offset);\n  }\n\n  /** Increment counter and compute sum */\n  public inc(step: number): CalcResult {\n    this.count += step;\n    return this.calc.add(this.count, step);\n  }\n\n  public reset(): number {\n    this.count = 0;\n    return this.count;\n  }\n}\n",
    );
    ws.write_bytes(
        "bin/logo.png",
        &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01, 0x02, 0x03],
    );
}

fn aice_bin() -> &'static str {
    env!("CARGO_BIN_EXE_aice")
}

fn run_mcp_newline(cwd: &Path, lines: &[&str]) -> (i32, Vec<JsonValue>, String) {
    let mut input = lines.join("\n");
    input.push('\n');
    let aice_home = cwd.join(".aice_home");
    let _ = fs::create_dir_all(&aice_home);
    let mut child = Command::new(aice_bin())
        .arg("mcp")
        .current_dir(cwd)
        .env("AICE_HOME", &aice_home)
        .env("HOME", cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn aice mcp");
    {
        let stdin = child.stdin.as_mut().expect("stdin");
        stdin.write_all(input.as_bytes()).expect("write stdin");
    }
    let out = child.wait_with_output().expect("wait aice mcp");
    let code = out.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    let mut msgs = Vec::new();
    for line in stdout.lines() {
        let t = line.trim();
        if !t.is_empty() {
            msgs.push(parse_json(t).expect("valid newline json response"));
        }
    }
    (code, msgs, stderr)
}

fn frame_cl(body: &str, sep: &str, header_name: &str) -> Vec<u8> {
    format!("{header_name}: {}{sep}{body}", body.len()).into_bytes()
}

fn parse_cl_frames(mut bytes: &[u8]) -> Vec<JsonValue> {
    let mut out = Vec::new();
    while !bytes.is_empty() {
        let Some(pos) = bytes.windows(4).position(|w| w == b"\r\n\r\n") else {
            panic!("missing CRLFCRLF header terminator in MCP output");
        };
        let hdr = std::str::from_utf8(&bytes[..pos]).expect("utf8 header");
        let len: usize = hdr
            .strip_prefix("Content-Length:")
            .expect("Content-Length header")
            .trim()
            .parse()
            .expect("numeric Content-Length");
        bytes = &bytes[pos + 4..];
        let body = std::str::from_utf8(&bytes[..len]).expect("utf8 body");
        out.push(parse_json(body).expect("valid json body"));
        bytes = &bytes[len..];
    }
    out
}

fn resp_text(resp: &JsonValue) -> &str {
    resp.as_object()
        .and_then(|m| m.get("result"))
        .and_then(JsonValue::as_object)
        .and_then(|r| r.get("content"))
        .and_then(JsonValue::as_array)
        .and_then(|a| a.first())
        .and_then(JsonValue::as_object)
        .and_then(|c| c.get("text"))
        .and_then(JsonValue::as_str)
        .expect("result.content[0].text")
}

fn resp_is_error(resp: &JsonValue) -> bool {
    resp.as_object()
        .and_then(|m| m.get("result"))
        .and_then(JsonValue::as_object)
        .and_then(|r| r.get("isError"))
        .and_then(JsonValue::as_bool)
        .unwrap_or(false)
}

fn err_code(resp: &JsonValue) -> i64 {
    resp.as_object()
        .and_then(|m| m.get("error"))
        .and_then(JsonValue::as_object)
        .and_then(|e| e.get("code"))
        .and_then(JsonValue::as_i64)
        .expect("error.code")
}

#[test]
fn mcp_initialize_ping_notifications_and_strict_schema_budget() {
    let ws = Tw::new("init");
    seed_ts_workspace(&ws);

    let (code, msgs, stderr) = run_mcp_newline(
        ws.path(),
        &[
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}"#,
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
            r#"{"jsonrpc":"2.0","id":null,"method":"initialized"}"#,
            r#"{"jsonrpc":"2.0","id":2,"method":"ping"}"#,
            r#"{"jsonrpc":"2.0","id":3,"method":"tools/list"}"#,
        ],
    );
    assert_eq!(code, 0, "stderr: {stderr}");
    assert_eq!(msgs.len(), 3, "notifications must emit no responses");

    let init_res = msgs[0].as_object().unwrap().get("result").unwrap().as_object().unwrap();
    assert_eq!(init_res.get("protocolVersion").and_then(JsonValue::as_str), Some("2024-11-05"));
    let info = init_res.get("serverInfo").unwrap().as_object().unwrap();
    assert_eq!(info.get("name").and_then(JsonValue::as_str), Some("aice-mcp"));

    let ping_res = msgs[1].as_object().unwrap().get("result").unwrap().as_object().unwrap();
    assert!(ping_res.is_empty());

    let tools_val = msgs[2]
        .as_object()
        .unwrap()
        .get("result")
        .unwrap()
        .as_object()
        .unwrap()
        .get("tools")
        .unwrap();
    let tools_arr = tools_val.as_array().unwrap();
    assert_eq!(tools_arr.len(), 2);
    let names: Vec<&str> = tools_arr
        .iter()
        .map(|t| t.as_object().unwrap().get("name").unwrap().as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["aice_read", "aice_splice"]);

    let serialized = tools_val.to_compact_string();
    assert!(serialized.len() <= 2600, "tools schema len {} > 2600", serialized.len());
    let cl = count_cl100k(&serialized);
    let o2 = count_o200k(&serialized);
    assert!(cl <= 600, "tools schema cl100k {cl} > 600");
    assert!(o2 <= 600, "tools schema o200k {o2} > 600");
}

#[test]
fn mcp_content_length_partial_chunks_and_multibyte_utf8() {
    let ws = Tw::new("cl_framing");
    seed_ts_workspace(&ws);

    let req1 = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#;
    let req2 = r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"aice_splice","arguments":{"filePath":"notes.txt","code":"café ☕ — ✓"}}}"#;

    let mut frame1 = frame_cl(req1, "\r\n\r\n", "Content-Length");
    let frame2 = frame_cl(req2, "\n\n", "content-length");
    frame1.extend_from_slice(&frame2);

    let mut child = Command::new(aice_bin())
        .arg("mcp")
        .current_dir(ws.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn aice mcp");

    {
        let mut stdin = child.stdin.take().expect("stdin");
        let split_a = 8;
        let split_b = frame1.len() / 2;
        stdin.write_all(&frame1[..split_a]).unwrap();
        stdin.flush().unwrap();
        thread::sleep(Duration::from_millis(15));
        stdin.write_all(&frame1[split_a..split_b]).unwrap();
        stdin.flush().unwrap();
        thread::sleep(Duration::from_millis(15));
        stdin.write_all(&frame1[split_b..]).unwrap();
        stdin.flush().unwrap();
    }

    let mut stdout_bytes = Vec::new();
    child.stdout.take().unwrap().read_to_end(&mut stdout_bytes).unwrap();
    let status = child.wait().unwrap();
    assert_eq!(status.code(), Some(0));

    let msgs = parse_cl_frames(&stdout_bytes);
    assert_eq!(msgs.len(), 2);
    assert!(!resp_is_error(&msgs[1]));
    assert_eq!(ws.read("notes.txt").trim(), "café ☕ — ✓");
}

#[test]
fn mcp_protocol_errors_and_strict_two_tool_and_null_guards() {
    let ws = Tw::new("errors");
    seed_ts_workspace(&ws);

    let legacy_tools = [
        "aice_context",
        "aice_outline",
        "aice_idioms",
        "aice_create",
        "aice_gain",
        "aice_project_config",
        "aice_write",
        "aice_read_file",
        "aice_find",
        "aice_search",
        "aice_status",
        "unknown_tool_xyz",
    ];
    let mut lines: Vec<String> = vec![
        "{not valid json".to_string(),
        r#"{"jsonrpc":"2.0","id":10,"params":{}}"#.to_string(),
        r#"{"jsonrpc":"2.0","id":11,"method":"unknown/method_xyz"}"#.to_string(),
    ];
    for (idx, tool) in legacy_tools.iter().enumerate() {
        lines.push(format!(
            r#"{{"jsonrpc":"2.0","id":{},"method":"tools/call","params":{{"name":"{tool}","arguments":{{}}}}}}"#,
            100 + idx
        ));
    }
    lines.extend([
        r#"{"jsonrpc":"2.0","id":17,"method":"tools/call","params":{"name":"aice_splice","arguments":{"files":[null]}}}"#.to_string(),
        r#"{"jsonrpc":"2.0","id":18,"method":"tools/call","params":{"name":"aice_splice","arguments":{"edits":["bad"]}}}"#.to_string(),
        r#"{"jsonrpc":"2.0","id":19,"method":"tools/call","params":{"name":"aice_splice","arguments":{"batch":"[null]"}}}"#.to_string(),
        r#"{"jsonrpc":"2.0","id":20,"method":"tools/call","params":{"name":"aice_splice","arguments":{"files":[{"filePath":"src/app.ts","edits":[null]}]}}}"#.to_string(),
        r#"{"jsonrpc":"2.0","id":21,"method":"tools/call","params":{"name":"aice_read","arguments":{"paths":[null]}}}"#.to_string(),
        r#"{"jsonrpc":"2.0","id":22,"method":"ping"}"#.to_string(),
    ]);
    let line_refs: Vec<&str> = lines.iter().map(String::as_str).collect();
    let (code, msgs, _) = run_mcp_newline(ws.path(), &line_refs);
    assert_eq!(code, 0);
    assert_eq!(msgs.len(), line_refs.len());
    assert_eq!(err_code(&msgs[0]), -32700);
    assert_eq!(err_code(&msgs[1]), -32600);
    assert_eq!(err_code(&msgs[2]), -32601);
    for m in &msgs[3..line_refs.len() - 1] {
        assert_eq!(err_code(m), -32602, "expected -32602 for {m:?}");
    }
    assert!(msgs.last().unwrap().as_object().unwrap().contains_key("result"));
}

#[test]
fn mcp_read_symbol_binary_multifile_search_files_and_partial_warning() {
    let ws = Tw::new("read_ops");
    seed_ts_workspace(&ws);

    let (code, msgs, _) = run_mcp_newline(
        ws.path(),
        &[
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"aice_read","arguments":{"path":"src/math.ts:Calculator.add"}}}"#,
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"aice_read","arguments":{"path":"bin/logo.png"}}}"#,
            r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"aice_read","arguments":{"path":"src/math.ts src/app.ts"}}}"#,
            r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"aice_read","arguments":{"filesOnly":true,"path":"src"}}}"#,
            r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"aice_read","arguments":{"search":"Calculator","filesWithMatches":true}}}"#,
            r#"{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"aice_read","arguments":{"paths":["src/math.ts","src/missing.ts"]}}}"#,
            r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"aice_read","arguments":{"path":"../../etc/passwd"}}}"#,
        ],
    );
    assert_eq!(code, 0);
    assert_eq!(msgs.len(), 7);

    assert!(!resp_is_error(&msgs[0]));
    assert!(resp_text(&msgs[0]).contains("Calculator"));

    assert!(!resp_is_error(&msgs[1]));
    assert!(resp_text(&msgs[1]).contains("binary"));

    assert!(!resp_is_error(&msgs[2]));
    assert!(resp_text(&msgs[2]).contains("Calculator"));
    assert!(resp_text(&msgs[2]).contains("App"));

    assert!(!resp_is_error(&msgs[3]));
    assert!(resp_text(&msgs[3]).contains("src/math.ts"));

    assert!(!resp_is_error(&msgs[4]));
    assert!(resp_text(&msgs[4]).contains("src/math.ts"));

    assert!(!resp_is_error(&msgs[5]));
    let partial = resp_text(&msgs[5]);
    assert!(partial.contains("Calculator") && partial.contains("missing.ts"));

    assert!(resp_is_error(&msgs[6]));
}

#[test]
fn mcp_splice_single_stream_files_dryrun_rollback_disabled_and_telemetry() {
    let ws = Tw::new("splice_ops");
    seed_ts_workspace(&ws);

    let (code, msgs, _) = run_mcp_newline(
        ws.path(),
        &[
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"aice_splice","arguments":{"filePath":"src/app.ts","symbol":"App.reset","code":"public reset(): number {\n  this.count = 42;\n  return this.count;\n}"}}}"#,
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"aice_splice","arguments":{"filePath":"nested/created.ts","code":"export const ok = true;\n"}}}"#,
            r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"aice_splice","arguments":{"files":[{"filePath":"src/from_files.ts","code":"export const x = 1;\n"}]}}}"#,
            r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"aice_splice","arguments":{"filePath":"src/app.ts","symbol":"App.inc","code":"public inc(step: number): CalcResult {\n  return this.calc.add(step, 99);\n}","dryRun":true}}}"#,
            r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"aice_splice","arguments":{"code":"=== src/rollback_new.ts ===\nexport const r = 1;\n=== src/app.ts:App.inc ===\npublic inc(: { broken ==="}}}"#,
        ],
    );
    assert_eq!(code, 0);
    assert_eq!(msgs.len(), 5);
    assert!(!resp_is_error(&msgs[0]));
    assert!(ws.read("src/app.ts").contains("this.count = 42;"));
    assert!(!resp_is_error(&msgs[1]));
    assert_eq!(ws.read("nested/created.ts").trim(), "export const ok = true;");
    assert!(!resp_is_error(&msgs[2]));
    assert_eq!(ws.read("src/from_files.ts").trim(), "export const x = 1;");
    assert!(!resp_is_error(&msgs[3]));
    assert!(!ws.read("src/app.ts").contains("99"));

    assert!(resp_is_error(&msgs[4]));
    assert!(resp_text(&msgs[4]).contains("Line"));
    assert!(!ws.exists("src/rollback_new.ts"));

    let gains = ws.read(".aice_home/telemetry/gains.jsonl");
    assert!(gains.contains("\"s\":\"mcp\""), "gains missing s:mcp: {gains}");
    let rollback_rows = gains.lines().filter(|l| l.contains("rollback_new")).count();
    assert_eq!(rollback_rows, 0);

    // Trigger single-file failure telemetry and check errors.jsonl
    let (code_err, msgs_err, _) = run_mcp_newline(
        ws.path(),
        &[
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"aice_splice","arguments":{"filePath":"src/app.ts","symbol":"App.inc","code":"public inc(: { broken ==="}}}"#,
        ],
    );
    assert_eq!(code_err, 0);
    assert!(resp_is_error(&msgs_err[0]));
    let errors_log = ws.read(".aice_home/telemetry/errors.jsonl");
    assert!(errors_log.contains("\"surface\":\"mcp\""), "errors.jsonl: {errors_log}");

    // Governance disabled check (MCP-02)
    ws.write("aice.config.json", "{\"enabled\":false}\n");
    let before_gains_lines = ws.read(".aice_home/telemetry/gains.jsonl").lines().count();
    let (code_dis, msgs_dis, _) = run_mcp_newline(
        ws.path(),
        &[
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"aice_read","arguments":{"path":"src/app.ts"}}}"#,
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"aice_splice","arguments":{"filePath":"src/app.ts","symbol":"App.reset","code":"public reset(): number { return 0; }"}}}"#,
        ],
    );
    assert_eq!(code_dis, 0);
    assert!(resp_is_error(&msgs_dis[0]));
    assert!(resp_text(&msgs_dis[0]).contains("enabled"));
    assert!(resp_is_error(&msgs_dis[1]));
    assert!(resp_text(&msgs_dis[1]).contains("enabled"));
    let after_gains_lines = ws.read(".aice_home/telemetry/gains.jsonl").lines().count();
    assert_eq!(before_gains_lines, after_gains_lines);
}

#[test]
fn mcp_content_type_before_content_length_first_frame_and_depth_float_rejected() {
    let ws = Tw::new("ct_first_and_float");
    seed_ts_workspace(&ws);

    let ping = r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
    let bad_depth = r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"aice_read","arguments":{"path":"src/app.ts","depth":1.5}}}"#;
    let mut input = format!(
        "Content-Type: application/vscode-jsonrpc; charset=utf-8\r\nContent-Length: {}\r\n\r\n{ping}",
        ping.len()
    )
    .into_bytes();
    input.extend_from_slice(&frame_cl(bad_depth, "\r\n\r\n", "Content-Length"));

    let mut child = Command::new(aice_bin())
        .arg("mcp")
        .current_dir(ws.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn aice mcp");
    child.stdin.take().unwrap().write_all(&input).unwrap();
    let mut stdout_bytes = Vec::new();
    child.stdout.take().unwrap().read_to_end(&mut stdout_bytes).unwrap();
    assert_eq!(child.wait().unwrap().code(), Some(0));

    let msgs = parse_cl_frames(&stdout_bytes);
    assert_eq!(msgs.len(), 2, "must emit exact 2 framed responses, no -32700");
    assert!(msgs[0].as_object().unwrap().contains_key("result"));
    assert_eq!(err_code(&msgs[1]), -32602);
}

#[test]
fn mcp_initialize_root_governance_and_containment_enforced() {
    let ws_dis = Tw::new("init_dis");
    ws_dis.write("aice.config.json", "{\"enabled\":false}\n");
    ws_dis.write("src/a.ts", "export const a = 1;\n");

    let ws_en = Tw::new("init_en");
    seed_ts_workspace(&ws_en);
    ws_en.write("sub/nested.ts", "export const nested = 7;\n");

    let ws_other = Tw::new("init_other");
    ws_other.write("src/secret.ts", "export const secret = 99;\n");

    // 1. Disabled launch workspace cannot be bypassed via enabled rootUri or workspaceFolders
    let en_uri = format!("file://{}", ws_en.path().display());
    let init_bypass = format!(
        r#"{{"jsonrpc":"2.0","id":1,"method":"initialize","params":{{"rootUri":"{en_uri}","workspaceFolders":[{{"uri":"{en_uri}"}}]}}}}"#
    );
    let (code, msgs, _) = run_mcp_newline(
        ws_dis.path(),
        &[
            &init_bypass,
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"aice_read","arguments":{"path":"src/a.ts"}}}"#,
        ],
    );
    assert_eq!(code, 0);
    assert!(resp_is_error(&msgs[1]));
    assert!(resp_text(&msgs[1]).contains("enabled"));

    // 2. Enabled launch workspace blocks /var/log, /etc/, /etc/ssh, /tmp/../etc, symlink->/etc, and external workspaces
    #[cfg(unix)]
    {
        let link_etc = ws_en.path().join("link_to_etc");
        std::os::unix::fs::symlink("/etc", &link_etc).expect("symlink /etc");
    }
    let other_uri = format!("file://{}", ws_other.path().display());
    let link_uri = format!("file://{}/link_to_etc", ws_en.path().display());
    for bad_root in [
        "file:///var/log".to_string(),
        "file:///etc/".to_string(),
        "file:///etc/ssh".to_string(),
        "file:///tmp/../etc".to_string(),
        link_uri,
        other_uri,
    ] {
        let init_esc = format!(
            r#"{{"jsonrpc":"2.0","id":1,"method":"initialize","params":{{"rootUri":"{bad_root}"}}}}"#
        );
        let (c, m, _) = run_mcp_newline(
            ws_en.path(),
            &[
                &init_esc,
                r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"aice_read","arguments":{"filesOnly":true,"path":"."}}}"#,
            ],
        );
        assert_eq!(c, 0);
        let txt = resp_text(&m[1]);
        assert!(txt.contains("src/app.ts"), "escaped session_cwd on {bad_root}: {txt}");
        assert!(!txt.contains("secret.ts"), "leaked external workspace on {bad_root}: {txt}");
    }

    // 3. Contained subdirectory inside active launch root IS allowed
    let sub_uri = format!("file://{}/sub", ws_en.path().display());
    let init_sub = format!(
        r#"{{"jsonrpc":"2.0","id":1,"method":"initialize","params":{{"rootUri":"{sub_uri}"}}}}"#
    );
    let (c_sub, m_sub, _) = run_mcp_newline(
        ws_en.path(),
        &[
            &init_sub,
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"aice_read","arguments":{"path":"nested.ts"}}}"#,
        ],
    );
    assert_eq!(c_sub, 0);
    assert!(!resp_is_error(&m_sub[1]));
    assert!(resp_text(&m_sub[1]).contains("nested"));
    // 4. Bare non-project launcher dir CAN adopt an enabled non-blocked workspace root
    let bare_id = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let bare_dir = std::env::temp_dir().join(format!("aice_w4_m3_bare_{}_{bare_id}", std::process::id()));
    fs::create_dir_all(&bare_dir).expect("mkdir bare");
    let init_adopt = format!(
        r#"{{"jsonrpc":"2.0","id":1,"method":"initialize","params":{{"rootUri":"{en_uri}"}}}}"#
    );
    let (c_adopt, m_adopt, _) = run_mcp_newline(
        &bare_dir,
        &[
            &init_adopt,
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"aice_read","arguments":{"path":"src/app.ts"}}}"#,
        ],
    );
    let _ = fs::remove_dir_all(&bare_dir);
    assert_eq!(c_adopt, 0);
    assert!(!resp_is_error(&m_adopt[1]));
    assert!(resp_text(&m_adopt[1]).contains("App"));
}

#[test]
fn mcp_splice_greenfield_bash_herestring_auto_creates_without_create_flag() {
    let ws = Tw::new("bash_herestring");
    seed_ts_workspace(&ws);

    let (code, msgs, _) = run_mcp_newline(
        ws.path(),
        &[
            r##"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"aice_splice","arguments":{"filePath":"nested/dir/new.sh","code":"#!/usr/bin/env bash\ncat <<< 'hello'\n"}}}"##,
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"aice_splice","arguments":{"filePath":"nested/dir/missing_hunk.sh","code":"<<<\necho old\n===\necho new\n>>>\n"}}}"#,
        ],
    );
    assert_eq!(code, 0);
    assert!(!resp_is_error(&msgs[0]), "unexpected error: {:?}", msgs[0]);
    assert!(ws.read("nested/dir/new.sh").contains("cat <<< 'hello'"));
    assert!(resp_is_error(&msgs[1]), "real hunk on missing file must not auto-create");
}

#[test]
fn mcp_content_type_without_content_length_drains_orphaned_body_and_recovers() {
    let ws = Tw::new("orphan_body");
    seed_ts_workspace(&ws);

    let orphan = b"Content-Type: application/json\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"ping\"}\n";
    let valid_req = r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
    let valid_frame = frame_cl(valid_req, "\r\n\r\n", "Content-Length");

    let mut payload = Vec::new();
    payload.extend_from_slice(orphan);
    payload.extend_from_slice(&valid_frame);

    let mut child = Command::new(aice_bin())
        .arg("mcp")
        .current_dir(ws.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn aice mcp");
    {
        child.stdin.as_mut().expect("stdin").write_all(&payload).expect("write stdin");
    }
    let out = child.wait_with_output().expect("wait aice mcp");
    assert_eq!(out.status.code(), Some(0));

    let msgs = parse_cl_frames(&out.stdout);
    assert_eq!(msgs.len(), 2, "expected 1 ParseError + 1 recovered ping response: {msgs:?}");
    assert_eq!(err_code(&msgs[0]), -32700);
    let ok_id = msgs[1].as_object().and_then(|m| m.get("id")).and_then(JsonValue::as_i64);
    assert_eq!(ok_id, Some(1), "subsequent valid frame must recover cleanly: {:?}", msgs[1]);
}

#[test]
fn mcp_orphaned_body_drain_handles_multiline_and_embedded_header_strings() {
    let ws = Tw::new("orphan_edge");
    seed_ts_workspace(&ws);

    let valid_req = r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
    let valid_frame = frame_cl(valid_req, "\r\n\r\n", "Content-Length");

    let cases: [(&str, &[u8]); 3] = [
        (
            "5_ct_multiline_orphan_then_cl",
            b"Content-Type: application/json\r\n\r\n{\n  \"jsonrpc\": \"2.0\",\n  \"id\": 99,\n  \"method\": \"ping\"\n}\n",
        ),
        (
            "7_ct_orphan_with_embedded_cl_string_then_cl",
            b"Content-Type: application/json\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":99,\"params\":{\"msg\":\"see Content-Length: 5\"}}\n",
        ),
        (
            "8_ct_orphan_with_embedded_ct_no_nl_then_cl",
            b"Content-Type: application/json\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":99,\"params\":{\"msg\":\"see Content-Type: text/plain\"}}",
        ),
    ];

    for (name, orphan) in cases {
        let mut payload = Vec::new();
        payload.extend_from_slice(orphan);
        payload.extend_from_slice(&valid_frame);

        let mut child = Command::new(aice_bin())
            .arg("mcp")
            .current_dir(ws.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn aice mcp");
        child.stdin.as_mut().expect("stdin").write_all(&payload).expect("write stdin");
        let out = child.wait_with_output().expect("wait aice mcp");
        assert_eq!(out.status.code(), Some(0), "{name}");

        let msgs = parse_cl_frames(&out.stdout);
        assert_eq!(msgs.len(), 2, "{name}: expected 2 frames, got {msgs:?}");
        assert_eq!(err_code(&msgs[0]), -32700, "{name}: {:?}", msgs[0]);
        let ok_id = msgs[1].as_object().and_then(|m| m.get("id")).and_then(JsonValue::as_i64);
        assert_eq!(ok_id, Some(1), "{name}: {:?}", msgs[1]);
        let ok_res = msgs[1].as_object().and_then(|m| m.get("result")).and_then(JsonValue::as_object);
        assert!(ok_res.is_some_and(|r| r.is_empty()), "{name}: {:?}", msgs[1]);
    }
}

#[test]
fn mcp_orphaned_body_drain_handles_chunked_header_splits_and_ct_without_cl() {
    let ws = Tw::new("orphan_chunked");
    seed_ts_workspace(&ws);

    let chunked_cases: [(&str, Vec<&[u8]>); 3] = [
        (
            "A5a_chunked_unbalanced_json_split_cl_header",
            vec![
                b"Content-Type: application/json\r\n\r\n{\"a\": 1\nContent-Len",
                b"gth: 40\r\n\r\n{\"jsonrpc\":\"2.0\",",
                b"\"id\":1,\"method\":\"ping\"}",
            ],
        ),
        (
            "A5g_chunked_unbalanced_json_split_mid_cl",
            vec![
                b"Content-Type: application/json\r\n\r\n{\"a\": \"unclosed\nContent-",
                b"Length: 40\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}",
            ],
        ),
        (
            "A5h_chunked_unbalanced_json_split_at_C",
            vec![
                b"Content-Type: application/json\r\n\r\n{\"a\": 1\nC",
                b"ontent-Length: 40\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}",
            ],
        ),
    ];

    for (name, chunks) in chunked_cases {
        let mut child = Command::new(aice_bin())
            .arg("mcp")
            .current_dir(ws.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn aice mcp");
        {
            let stdin = child.stdin.as_mut().expect("stdin");
            for chunk in chunks {
                stdin.write_all(chunk).expect("write chunk");
                stdin.flush().expect("flush chunk");
                thread::sleep(Duration::from_millis(40));
            }
        }
        let out = child.wait_with_output().expect("wait aice mcp");
        assert_eq!(out.status.code(), Some(0), "{name}");
        let msgs = parse_cl_frames(&out.stdout);
        assert_eq!(msgs.len(), 2, "{name}: {msgs:?}");
        assert_eq!(err_code(&msgs[0]), -32700, "{name}: {:?}", msgs[0]);
        let ok_id = msgs[1].as_object().and_then(|m| m.get("id")).and_then(JsonValue::as_i64);
        assert_eq!(ok_id, Some(1), "{name}: {:?}", msgs[1]);
    }

    let valid_frame = frame_cl(r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#, "\r\n\r\n", "Content-Length");
    let mut leading_nl_junk = b"Content-Type: application/json\r\n\r\n\njunk line\n".to_vec();
    leading_nl_junk.extend_from_slice(&valid_frame);

    let single_cases: [(&str, Vec<u8>); 2] = [
        (
            "A4e_non_json_ct_bad_blank_line_then_nl_json",
            b"Content-Type: application/json\r\n\r\nhello Content-Type: bad\n\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n".to_vec(),
        ),
        ("leading_nl_junk_before_cl", leading_nl_junk),
    ];

    for (name, payload) in single_cases {
        let mut child = Command::new(aice_bin())
            .arg("mcp")
            .current_dir(ws.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn aice mcp");
        child.stdin.as_mut().expect("stdin").write_all(&payload).expect("write stdin");
        let out = child.wait_with_output().expect("wait aice mcp");
        assert_eq!(out.status.code(), Some(0), "{name}");
        let msgs = parse_cl_frames(&out.stdout);
        assert_eq!(msgs.len(), 2, "{name}: {msgs:?}");
        assert_eq!(err_code(&msgs[0]), -32700, "{name}: {:?}", msgs[0]);
        let ok_id = msgs[1].as_object().and_then(|m| m.get("id")).and_then(JsonValue::as_i64);
        assert_eq!(ok_id, Some(1), "{name}: {:?}", msgs[1]);
    }
}

#[test]
fn mcp_json_orphan_backslash_nl_ws_and_mixed_header_endings() {
    let ws = Tw::new("orphan_edge_cases");
    seed_ts_workspace(&ws);
    let ping = r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
    let pf = frame_cl(ping, "\r\n\r\n", "Content-Length");

    let mut case_19 = b"Content-Type: application/json\r\n\r\n{\"a\": \"unclosed\\\n".to_vec();
    case_19.extend_from_slice(&pf);
    let mut case_20 = b"Content-Type: application/json\r\n\r\n{\"a\": 1\n  ".to_vec();
    case_20.extend_from_slice(&pf);
    let mut case_21 = b"Content-Type: application/json\r\n\r\n{\"a\": 1 ".to_vec();
    case_21.extend_from_slice(&pf);

    for (name, payload) in [
        ("19_backslash_nl", case_19),
        ("20_leading_space", case_20),
        ("21_inline_space", case_21),
    ] {
        for chunk_sz in [payload.len(), 3, 1] {
            let mut child = Command::new(aice_bin())
                .arg("mcp")
                .current_dir(ws.path())
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .expect("spawn aice mcp");
            {
                let stdin = child.stdin.as_mut().expect("stdin");
                for chunk in payload.chunks(chunk_sz) {
                    stdin.write_all(chunk).expect("write chunk");
                    stdin.flush().expect("flush chunk");
                }
            }
            let out = child.wait_with_output().expect("wait aice mcp");
            assert_eq!(out.status.code(), Some(0), "{name} chunk={chunk_sz}");
            let msgs = parse_cl_frames(&out.stdout);
            assert_eq!(msgs.len(), 2, "{name} chunk={chunk_sz}: {msgs:?}");
            assert_eq!(err_code(&msgs[0]), -32700, "{name} chunk={chunk_sz}: {:?}", msgs[0]);
            let ok_id = msgs[1].as_object().and_then(|m| m.get("id")).and_then(JsonValue::as_i64);
            assert_eq!(ok_id, Some(1), "{name} chunk={chunk_sz}: {:?}", msgs[1]);
        }
    }

    let split_after_space: [(&str, Vec<&[u8]>); 2] = [
        (
            "20_split_after_spaces",
            vec![
                b"Content-Type: application/json\r\n\r\n{\"a\": 1\n  ",
                b"Content-Length: 40\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}",
            ],
        ),
        (
            "21_split_after_space_and_C",
            vec![
                b"Content-Type: application/json\r\n\r\n{\"a\": 1 ",
                b"C",
                b"ontent-Length: 40\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}",
            ],
        ),
    ];
    for (name, chunks) in split_after_space {
        let mut child = Command::new(aice_bin())
            .arg("mcp")
            .current_dir(ws.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn aice mcp");
        {
            let stdin = child.stdin.as_mut().expect("stdin");
            for chunk in chunks {
                stdin.write_all(chunk).expect("write chunk");
                stdin.flush().expect("flush chunk");
                thread::sleep(Duration::from_millis(30));
            }
        }
        let out = child.wait_with_output().expect("wait aice mcp");
        assert_eq!(out.status.code(), Some(0), "{name}");
        let msgs = parse_cl_frames(&out.stdout);
        assert_eq!(msgs.len(), 2, "{name}: {msgs:?}");
        assert_eq!(err_code(&msgs[0]), -32700, "{name}: {:?}", msgs[0]);
        let ok_id = msgs[1].as_object().and_then(|m| m.get("id")).and_then(JsonValue::as_i64);
        assert_eq!(ok_id, Some(1), "{name}: {:?}", msgs[1]);
    }

    for (name, sep) in [("23_lf_crlf", "\n\r\n"), ("22_crlf_lf", "\r\n\n")] {
        let payload = frame_cl(ping, sep, "Content-Length");
        let mut child = Command::new(aice_bin())
            .arg("mcp")
            .current_dir(ws.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn aice mcp");
        child.stdin.as_mut().expect("stdin").write_all(&payload).expect("write stdin");
        let out = child.wait_with_output().expect("wait aice mcp");
        assert_eq!(out.status.code(), Some(0), "{name}");
        let msgs = parse_cl_frames(&out.stdout);
        assert_eq!(msgs.len(), 1, "{name}: {msgs:?}");
        let ok_id = msgs[0].as_object().and_then(|m| m.get("id")).and_then(JsonValue::as_i64);
        assert_eq!(ok_id, Some(1), "{name}: {:?}", msgs[0]);
    }
}

#[test]
fn mcp_split_multi_selector_targets_and_ct_only_eof_single_parse_error() {
    let ws = Tw::new("w5_m3_mcp");
    ws.write("aice.config.json", "{\"enabled\":true}\n");
    ws.write("a.ts", "export function foo() { return 1; }\nexport const space_hit = \"foo bar\";\n");
    ws.write("b.ts", "export function bar() { return 2; }\n");

    let (code, msgs, _) = run_mcp_newline(
        ws.path(),
        &[
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"aice_read","arguments":{"path":"a.ts:foo b.ts:bar"}}}"#,
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"aice_read","arguments":{"path":"a.ts:L1-L1 b.ts:L1-L1"}}}"#,
            r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"aice_read","arguments":{"path":"a.ts:/foo bar/ b.ts"}}}"#,
        ],
    );
    assert_eq!(code, 0);
    assert_eq!(msgs.len(), 3);
    assert!(!resp_is_error(&msgs[0]), "{:?}", msgs[0]);
    assert!(resp_text(&msgs[0]).contains("fn foo") && resp_text(&msgs[0]).contains("fn bar"));
    assert!(!resp_is_error(&msgs[1]), "{:?}", msgs[1]);
    assert!(resp_text(&msgs[1]).contains("a.ts") && resp_text(&msgs[1]).contains("b.ts"));
    assert!(!resp_is_error(&msgs[2]), "{:?}", msgs[2]);
    assert!(resp_text(&msgs[2]).contains("space_hit") && resp_text(&msgs[2]).contains("fn bar"));

    // C1-G6: Content-Type-only EOF mid-header emits a single -32700 Parse error frame
    let mut child = Command::new(aice_bin())
        .arg("mcp")
        .current_dir(ws.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn aice mcp");
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(b"Content-Type: application/json\r\nX-Extra: 1")
        .unwrap();
    let out = child.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(0));
    let frames = parse_cl_frames(&out.stdout);
    assert_eq!(frames.len(), 1, "expected single -32700 frame, got: {frames:?}");
    assert_eq!(err_code(&frames[0]), -32700);
}
