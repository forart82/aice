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
use aice_telemetry::{RecordTelemetryErrorInput, TelemetryOpKind, count_cl100k, record_error_event};
use cli::{CliAction, CliParseError};

pub(crate) fn record_batch_error_only(
    cwd: &Path,
    op_kind: TelemetryOpKind,
    surface: OutputSurface,
    label: &str,
    msg: &str,
    wasted: Option<&str>,
) {
    let root = find_project_root(cwd);
    let surface_label = match surface {
        OutputSurface::Cli => "cli",
        OutputSurface::Mcp => "mcp",
    };
    record_error_event(&RecordTelemetryErrorInput {
        target_path: None,
        project_root: Some(&root),
        file_path: Some(label),
        operation: op_kind.as_str(),
        surface: surface_label,
        agent: None,
        error_message: msg,
        wasted_input_tokens: wasted.map(count_cl100k),
        explicit_telemetry_path: None,
    });
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn record_write_failure(
    cwd: &Path,
    op_kind: TelemetryOpKind,
    surface: OutputSurface,
    label: &str,
    msg: &str,
    wasted: Option<&str>,
    dry_run: bool,
    is_batch: bool,
    is_disabled: bool,
) {
    if dry_run || is_disabled {
        return;
    }
    if is_batch {
        record_batch_error_only(cwd, op_kind, surface, label, msg, wasted);
    } else {
        record_failure_for_cli(cwd, op_kind, surface, label, msg, wasted, false);
    }
}

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
