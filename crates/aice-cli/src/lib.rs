pub mod cli;
pub mod cmd_admin;
pub mod cmd_admin_parse;
pub mod cmd_discover;
pub mod cmd_read;
pub mod cmd_write;
pub mod cmd_write_targets;
pub mod flags_norm;
pub mod help_render;
pub mod mcp_args;
pub mod mcp_framing;
pub mod mcp_framing_drain;
pub mod mcp_framing_probe;
pub mod mcp_map_read;
pub mod mcp_map_write;
pub mod mcp_schemas;
pub mod mcp_server;

use std::path::Path;

use aice_governance::{OutputSurface, find_project_root, load_config};
use aice_pipeline::record_failure_for_cli;
use aice_telemetry::TelemetryOpKind;
use cli::{CliAction, CliParseError};

fn infer_cli_parse_op(args: &[String]) -> Option<TelemetryOpKind> {
    for arg in args {
        if arg == "--" {
            break;
        }
        if arg.starts_with('-') {
            continue;
        }
        return match arg.as_str() {
            "read" | "context" | "ctx" => Some(TelemetryOpKind::Read),
            "search" | "grep" | "find" | "tree" => Some(TelemetryOpKind::Context),
            "splice" | "write" => Some(TelemetryOpKind::Splice),
            _ => None,
        };
    }
    None
}

fn record_parse_error(args: &[String], cwd: &Path, msg: &str) {
    let Some(op_kind) = infer_cli_parse_op(args) else {
        return;
    };
    let disabled = !load_config(&find_project_root(cwd)).enabled;
    record_failure_for_cli(
        cwd,
        op_kind,
        OutputSurface::Cli,
        "<cli-error>",
        msg,
        None,
        disabled,
    );
}

pub fn run_cli(args: &[String], cwd: &Path) -> i32 {
    match cli::parse_args(args, cwd) {
        Ok(CliAction::Version) => cmd_admin::run_version(cwd),
        Ok(CliAction::Help(topic)) => help_render::emit_help(topic.as_deref(), cwd),
        Ok(CliAction::Read(op)) => cmd_read::run_read(op, cwd),
        Ok(CliAction::Search(op)) => cmd_discover::run_search(op, cwd),
        Ok(CliAction::Find(op)) => cmd_discover::run_find(op, cwd),
        Ok(CliAction::Write(op)) => cmd_write::run_write(op, cwd),
        Ok(CliAction::Mcp(op)) => mcp_server::run_mcp(op, cwd),
        Ok(CliAction::Admin(op)) => cmd_admin::run_admin(op, cwd),
        Err(CliParseError::Message(msg)) => {
            eprintln!("error: {msg}");
            record_parse_error(args, cwd, &msg);
            1
        }
    }
}
