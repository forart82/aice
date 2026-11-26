use std::io::Write;

use aice_governance::{JsonValue, escape_json_str};

use crate::seal::MeteredOutput;

pub struct StdoutWriter;

impl StdoutWriter {
    pub fn emit(out: MeteredOutput) -> i32 {
        let code = out.exit_code();
        let payload = out.payload();
        if !payload.is_empty() {
            let stdout = std::io::stdout();
            let mut handle = stdout.lock();
            let _ = handle.write_all(payload.as_bytes());
            let _ = handle.flush();
        }
        let err = out.stderr_payload();
        if !err.is_empty() {
            let stderr = std::io::stderr();
            let mut handle = stderr.lock();
            let _ = handle.write_all(err.as_bytes());
            let _ = handle.flush();
        }
        code
    }

    pub fn emit_mcp_frame(json: &str, framed: bool) {
        let stdout = std::io::stdout();
        let mut handle = stdout.lock();
        if framed {
            let header = format!("Content-Length: {}\r\n\r\n", json.len());
            let _ = handle.write_all(header.as_bytes());
        }
        let _ = handle.write_all(json.as_bytes());
        if !framed {
            let _ = handle.write_all(b"\n");
        }
        let _ = handle.flush();
    }

    pub fn emit_mcp_result(id: &JsonValue, result: &JsonValue, framed: bool) {
        let mut out = String::from("{\"jsonrpc\":\"2.0\",\"id\":");
        out.push_str(&id.to_compact_string());
        out.push_str(",\"result\":");
        out.push_str(&result.to_compact_string());
        out.push('}');
        Self::emit_mcp_frame(&out, framed);
    }

    pub fn emit_mcp_error(id: &JsonValue, code: i64, message: &str, framed: bool) {
        let mut out = String::from("{\"jsonrpc\":\"2.0\",\"id\":");
        out.push_str(&id.to_compact_string());
        out.push_str(",\"error\":{\"code\":");
        out.push_str(&code.to_string());
        out.push_str(",\"message\":");
        escape_json_str(message, &mut out);
        out.push_str("}}");
        Self::emit_mcp_frame(&out, framed);
    }

    pub fn emit_mcp_tool_error(id: &JsonValue, text: &str, framed: bool) {
        let mut out = String::from("{\"jsonrpc\":\"2.0\",\"id\":");
        out.push_str(&id.to_compact_string());
        out.push_str(",\"result\":{\"content\":[{\"type\":\"text\",\"text\":");
        escape_json_str(text, &mut out);
        out.push_str("}],\"isError\":true}}");
        Self::emit_mcp_frame(&out, framed);
    }

    pub fn emit_mcp_tool_ok(id: &JsonValue, text: &str, framed: bool) {
        let mut out = String::from("{\"jsonrpc\":\"2.0\",\"id\":");
        out.push_str(&id.to_compact_string());
        out.push_str(",\"result\":{\"content\":[{\"type\":\"text\",\"text\":");
        escape_json_str(text, &mut out);
        out.push_str("}]}}");
        Self::emit_mcp_frame(&out, framed);
    }

    pub fn emit_mcp_tool_result(out: MeteredOutput, id: &JsonValue, framed: bool) -> i32 {
        let code = out.exit_code();
        let payload = out.payload();
        let err = out.stderr_payload();
        if code != 0 {
            let msg = if !err.trim().is_empty() {
                err.trim()
            } else if !payload.trim().is_empty() {
                payload.trim()
            } else {
                "AICE tool execution failed"
            };
            Self::emit_mcp_tool_error(id, msg, framed);
        } else {
            let err_trim = err.trim();
            let text = if !payload.is_empty() && !err_trim.is_empty() {
                format!("{}\n{}", payload.trim_end_matches(['\r', '\n']), err_trim)
            } else if !payload.is_empty() {
                payload.to_string()
            } else {
                err_trim.to_string()
            };
            Self::emit_mcp_tool_ok(id, &text, framed);
        }
        code
    }
}
