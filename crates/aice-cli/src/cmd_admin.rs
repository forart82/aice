use std::path::Path;

use aice_governance::{AdminAction, AdminOp, OutputSurface, PipelineRequest, authorize_admin};
use aice_pipeline::{DefaultPipelineExecutor, PipelineExecutor, StdoutWriter, meter_and_seal};

use crate::cli::CliParseError;
use crate::cmd_admin_parse::{
    parse_agents, parse_analyze, parse_benchmark, parse_gain, resolve_arg_path,
};

pub fn parse_admin_subcommand(
    cmd: &str,
    args: &[String],
    cwd: &Path,
) -> Result<AdminOp, CliParseError> {
    match cmd {
        "enable" => parse_enable(args, cwd),
        "disable" => parse_disable(args, cwd),
        "config" | "status" => parse_config(args, cwd),
        "agents" => parse_agents(args),
        "gain" | "gains" | "stats" | "telemetry" => parse_gain(args),
        "analyze" => parse_analyze(args, cwd),
        _ => parse_benchmark(args),
    }
}

fn parse_enable(args: &[String], cwd: &Path) -> Result<AdminOp, CliParseError> {
    let (mut dir, mut force, mut json, mut past_dd) = (None, false, false, false);
    for arg in args {
        if !past_dd && arg == "--" {
            past_dd = true;
        } else if !past_dd && arg.starts_with('-') {
            match arg.as_str() {
                "-f" | "--force" => force = true,
                "--json" => json = true,
                _ => {
                    return Err(CliParseError::Message(format!(
                        "unknown option '{arg}' for 'enable'"
                    )));
                }
            }
        } else if dir.is_none() {
            dir = Some(resolve_arg_path(arg, cwd));
        } else {
            return Err(CliParseError::Message(format!(
                "unexpected argument '{arg}' for 'enable'"
            )));
        }
    }
    Ok(AdminOp {
        action: AdminAction::Enable {
            dir: dir.unwrap_or_else(|| cwd.to_path_buf()),
            force,
            json,
        },
    })
}

fn parse_disable(args: &[String], cwd: &Path) -> Result<AdminOp, CliParseError> {
    let (mut dir, mut json, mut past_dd) = (None, false, false);
    for arg in args {
        if !past_dd && arg == "--" {
            past_dd = true;
        } else if !past_dd && arg.starts_with('-') {
            match arg.as_str() {
                "--json" => json = true,
                _ => {
                    return Err(CliParseError::Message(format!(
                        "unknown option '{arg}' for 'disable'"
                    )));
                }
            }
        } else if dir.is_none() {
            dir = Some(resolve_arg_path(arg, cwd));
        } else {
            return Err(CliParseError::Message(format!(
                "unexpected argument '{arg}' for 'disable'"
            )));
        }
    }
    Ok(AdminOp {
        action: AdminAction::Disable {
            dir: dir.unwrap_or_else(|| cwd.to_path_buf()),
            json,
        },
    })
}

fn parse_config(args: &[String], cwd: &Path) -> Result<AdminOp, CliParseError> {
    let (mut dir, mut enable, mut disable, mut force, mut json, mut past_dd) =
        (None, false, false, false, false, false);
    for arg in args {
        if !past_dd && arg == "--" {
            past_dd = true;
        } else if !past_dd && arg.starts_with('-') {
            match arg.as_str() {
                "--enable" => enable = true,
                "--disable" => disable = true,
                "-f" | "--force" => force = true,
                "--json" => json = true,
                _ => {
                    return Err(CliParseError::Message(format!(
                        "unknown option '{arg}' for 'config'"
                    )));
                }
            }
        } else if dir.is_none() {
            dir = Some(resolve_arg_path(arg, cwd));
        } else {
            return Err(CliParseError::Message(format!(
                "unexpected argument '{arg}' for 'config'"
            )));
        }
    }
    if enable && disable {
        return Err(CliParseError::Message(
            "cannot combine --enable and --disable".into(),
        ));
    }
    Ok(AdminOp {
        action: AdminAction::Config {
            dir: dir.unwrap_or_else(|| cwd.to_path_buf()),
            enable,
            disable,
            force,
            json,
        },
    })
}

pub fn run_version(cwd: &Path) -> i32 {
    run_admin(
        AdminOp {
            action: AdminAction::Version,
        },
        cwd,
    )
}

pub fn run_help(topic: Option<&str>, cwd: &Path) -> i32 {
    let action = match topic {
        Some(cmd) => AdminAction::HelpTopic(cmd.to_string()),
        None => AdminAction::Help,
    };
    run_admin(AdminOp { action }, cwd)
}

pub fn run_admin(op: AdminOp, cwd: &Path) -> i32 {
    let req = PipelineRequest::new(op, cwd.to_path_buf(), OutputSurface::Cli);
    match authorize_admin(req) {
        Ok(gov) => match DefaultPipelineExecutor.execute_admin(gov) {
            Ok(res) => StdoutWriter::emit(meter_and_seal(res)),
            Err(e) => {
                eprintln!("{e}");
                1
            }
        },
        Err(e) => {
            eprintln!("{e}");
            1
        }
    }
}
