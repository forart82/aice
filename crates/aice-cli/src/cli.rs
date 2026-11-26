use std::path::{Path, PathBuf};

use aice_governance::{AdminAction, AdminOp, FindOp, ReadOp, SearchOp, WriteOp};

use crate::cmd_admin::parse_admin_subcommand;
use crate::cmd_discover::{parse_find_args, parse_search_args};
use crate::cmd_read::parse_read_args;
use crate::cmd_write::parse_write_args;
use crate::flags_norm::normalize_ingress_flags;

#[derive(Debug)]
pub enum CliAction {
    Version,
    Help(Option<String>),
    Read(ReadOp),
    Search(SearchOp),
    Find(FindOp),
    Write(WriteOp),
    Mcp(AdminOp),
    Admin(AdminOp),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliParseError {
    Message(String),
}

pub fn canonical_command_name(cmd: &str) -> Option<&'static str> {
    match cmd {
        "read" | "context" | "ctx" => Some("read"),
        "search" | "grep" => Some("search"),
        "find" | "tree" => Some("find"),
        "splice" | "write" => Some("splice"),
        "enable" => Some("enable"),
        "disable" => Some("disable"),
        "config" | "status" => Some("config"),
        "agents" => Some("agents"),
        "gain" | "gains" | "stats" | "telemetry" => Some("gain"),
        "analyze" => Some("analyze"),
        "mcp" => Some("mcp"),
        "benchmark" | "bench" => Some("benchmark"),
        _ => None,
    }
}

pub fn parse_args(raw_args: &[String], cwd: &Path) -> Result<CliAction, CliParseError> {
    if raw_args.is_empty() {
        return Ok(CliAction::Help(None));
    }

    let normalized = normalize_ingress_flags(raw_args);
    let Some(first) = normalized.first() else {
        return Ok(CliAction::Help(None));
    };
    match first.as_str() {
        "-V" | "--version" => return Ok(CliAction::Version),
        "-h" | "--help" => return Ok(CliAction::Help(None)),
        _ => {}
    }

    let cmd = first.as_str();
    let rest = &normalized[1..];
    if let Some(canon) = canonical_command_name(cmd)
        && has_help_flag(cmd, rest)
    {
        return Ok(CliAction::Help(Some(canon.to_string())));
    }

    match cmd {
        "read" | "context" | "ctx" => parse_read_args(rest).map(CliAction::Read),
        "search" | "grep" => parse_search_args(rest).map(CliAction::Search),
        "find" | "tree" => parse_find_args(rest, cwd).map(CliAction::Find),
        "splice" | "write" => parse_write_args(rest, cwd).map(CliAction::Write),
        "mcp" => parse_mcp_args(rest, cwd),
        "enable" | "disable" | "config" | "status" | "agents" | "gain" | "gains" | "stats"
        | "telemetry" | "analyze" | "benchmark" | "bench" => {
            parse_admin_subcommand(cmd, rest, cwd).map(CliAction::Admin)
        }
        other => Err(CliParseError::Message(format!(
            "unknown subcommand '{other}'. Run 'aice --help' for usage."
        ))),
    }
}

fn flag_takes_value(cmd: &str, arg: &str) -> bool {
    if arg.contains('=') {
        return false;
    }
    match cmd {
        "read" | "context" | "ctx" => matches!(
            arg,
            "-d" | "--depth"
                | "-L"
                | "-C"
                | "--context"
                | "--max-tokens"
                | "-s"
                | "--symbol"
                | "--search"
        ),
        "search" | "grep" => matches!(
            arg,
            "-C" | "--context" | "--max-tokens" | "-s" | "--symbol" | "--search"
        ),
        "find" | "tree" => matches!(arg, "-d" | "--depth" | "-L" | "--max-tokens" | "--search"),
        "splice" | "write" => matches!(
            arg,
            "-f"
                | "--file"
                | "-s"
                | "--symbol"
                | "-c"
                | "--code"
                | "-t"
                | "--template"
                | "-b"
                | "--body"
                | "--from"
                | "--insert-after"
                | "--insert-before"
                | "--edits"
                | "--batch"
        ),
        "agents" => matches!(arg, "-a" | "--agent"),
        "gain" | "gains" | "stats" | "telemetry" => matches!(arg, "-p" | "--project"),
        "analyze" => matches!(arg, "-p" | "--project" | "--transcripts-dir"),
        _ => false,
    }
}

fn has_help_flag(cmd: &str, rest: &[String]) -> bool {
    let mut i = 0;
    while i < rest.len() {
        let arg = rest[i].as_str();
        if arg == "--" {
            break;
        }
        if arg == "-h" || arg == "--help" {
            return true;
        }
        if flag_takes_value(cmd, arg) {
            i += 2;
        } else {
            i += 1;
        }
    }
    false
}

fn default_mcp_schemas_dir(cwd: &Path) -> PathBuf {
    let base = std::env::var_os("AICE_AGENT_HOME")
        .filter(|v| !v.is_empty())
        .or_else(|| std::env::var_os("HOME").filter(|v| !v.is_empty()))
        .map(PathBuf::from)
        .unwrap_or_else(|| cwd.to_path_buf());
    base.join(".gemini").join("antigravity-cli").join("mcp").join("aice")
}

fn resolve_schema_dir_arg(raw: &str, cwd: &Path) -> Result<PathBuf, CliParseError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || raw.contains('\0') {
        return Err(CliParseError::Message(
            "schema output directory cannot be empty".into(),
        ));
    }
    let p = PathBuf::from(trimmed);
    Ok(if p.is_absolute() { p } else { cwd.join(p) })
}

fn parse_mcp_args(rest: &[String], cwd: &Path) -> Result<CliAction, CliParseError> {
    let mut generate_schemas: Option<PathBuf> = None;
    let mut i = 0;
    while i < rest.len() {
        let arg = rest[i].as_str();
        if arg == "--" {
            if i + 1 < rest.len() {
                return Err(CliParseError::Message(format!(
                    "unexpected argument '{}' for 'mcp'",
                    rest[i + 1]
                )));
            }
            break;
        }
        if arg == "--generate-schemas" {
            if let Some(next) = rest.get(i + 1)
                && !next.starts_with('-')
            {
                generate_schemas = Some(resolve_schema_dir_arg(next, cwd)?);
                i += 2;
            } else {
                generate_schemas = Some(default_mcp_schemas_dir(cwd));
                i += 1;
            }
        } else if let Some(val) = arg.strip_prefix("--generate-schemas=") {
            generate_schemas = Some(resolve_schema_dir_arg(val, cwd)?);
            i += 1;
        } else {
            return Err(CliParseError::Message(format!(
                "unknown option '{arg}' for 'mcp'"
            )));
        }
    }
    Ok(CliAction::Mcp(AdminOp {
        action: AdminAction::Mcp { generate_schemas },
    }))
}
