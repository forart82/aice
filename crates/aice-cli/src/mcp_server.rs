use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use aice_governance::{AdminAction, AdminOp, JsonValue};
use aice_pipeline::StdoutWriter;

use crate::cmd_admin::run_admin;
use crate::mcp_framing::{FrameEvent, McpFrameReader};
use crate::mcp_map_read::handle_read;
use crate::mcp_map_write::handle_write;
use crate::mcp_schemas::{
    build_initialize_result, build_tools_list_result, resolve_workspace_root,
};

pub const MCP_EXPOSED_TOOLS: [&str; 2] = ["aice_read", "aice_splice"];

pub fn is_supported_mcp_tool(name: &str) -> bool {
    MCP_EXPOSED_TOOLS.contains(&name)
}

pub fn run_mcp(op: AdminOp, cwd: &Path) -> i32 {
    if let AdminAction::Mcp {
        generate_schemas: Some(_),
    } = op.action
    {
        return run_admin(op, cwd);
    }

    let stdin = std::io::stdin();
    let mut reader = McpFrameReader::new(stdin.lock());
    let mut session_cwd = cwd.to_path_buf();
    let mut initialized = false;

    loop {
        match reader.next_frame() {
            Ok(None) => break,
            Ok(Some(FrameEvent::ParseError)) => {
                StdoutWriter::emit_mcp_error(
                    &JsonValue::Null,
                    -32700,
                    "Parse error",
                    reader.is_framed(),
                );
            }
            Ok(Some(FrameEvent::Message(msg))) => {
                handle_message(&msg, &mut session_cwd, &mut initialized, reader.is_framed());
            }
            Err(_) => break,
        }
    }

    0
}

fn handle_message(
    msg: &JsonValue,
    session_cwd: &mut PathBuf,
    initialized: &mut bool,
    framed: bool,
) {
    let Some(obj) = msg.as_object() else {
        StdoutWriter::emit_mcp_error(&JsonValue::Null, -32600, "Invalid Request", framed);
        return;
    };

    let req_id = obj.get("id").cloned().unwrap_or(JsonValue::Null);
    let Some(method) = obj.get("method").and_then(JsonValue::as_str) else {
        StdoutWriter::emit_mcp_error(&req_id, -32600, "Invalid Request", framed);
        return;
    };

    let is_notification = matches!(obj.get("id"), None | Some(JsonValue::Null));
    if is_notification {
        return;
    }

    match method {
        "initialize" => {
            if !*initialized {
                if let Some(root) = resolve_workspace_root(obj.get("params"), session_cwd) {
                    *session_cwd = root;
                }
                *initialized = true;
            }
            StdoutWriter::emit_mcp_result(&req_id, &build_initialize_result(), framed);
        }
        "ping" => {
            StdoutWriter::emit_mcp_result(
                &req_id,
                &JsonValue::Object(BTreeMap::new()),
                framed,
            );
        }
        "tools/list" => {
            StdoutWriter::emit_mcp_result(&req_id, &build_tools_list_result(), framed);
        }
        "tools/call" => {
            dispatch_tools_call(obj.get("params"), &req_id, session_cwd, framed);
        }
        other => {
            StdoutWriter::emit_mcp_error(
                &req_id,
                -32601,
                &format!("Method not found: {other}"),
                framed,
            );
        }
    }
}

fn dispatch_tools_call(
    params: Option<&JsonValue>,
    id: &JsonValue,
    cwd: &Path,
    framed: bool,
) {
    let Some(pmap) = params.and_then(JsonValue::as_object) else {
        StdoutWriter::emit_mcp_error(id, -32602, "Invalid params: expected object", framed);
        return;
    };

    let Some(tool_name) = pmap.get("name").and_then(JsonValue::as_str) else {
        StdoutWriter::emit_mcp_error(id, -32602, "Invalid params: missing tool name", framed);
        return;
    };

    if !is_supported_mcp_tool(tool_name) {
        StdoutWriter::emit_mcp_error(id, -32602, &format!("Unknown tool: {tool_name}"), framed);
        return;
    }

    let empty_map = BTreeMap::new();
    let args = match pmap.get("arguments") {
        None | Some(JsonValue::Null) => &empty_map,
        Some(JsonValue::Object(m)) => m,
        Some(_) => {
            StdoutWriter::emit_mcp_error(
                id,
                -32602,
                "Invalid params: arguments must be an object",
                framed,
            );
            return;
        }
    };

    let res = match tool_name {
        "aice_read" => handle_read(args, id, cwd, framed),
        "aice_splice" => handle_write(args, id, cwd, framed),
        _ => Err((-32602, format!("Unknown tool: {tool_name}"))),
    };
    if let Err((code, msg)) = res {
        StdoutWriter::emit_mcp_error(id, code, &msg, framed);
    }
}
