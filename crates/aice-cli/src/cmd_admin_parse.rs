use std::path::{Path, PathBuf};

use aice_governance::{AdminAction, AdminOp, SupportedAgentId};

use crate::cli::CliParseError;

pub(crate) fn resolve_arg_path(raw: &str, cwd: &Path) -> PathBuf {
    if raw.is_empty() {
        return PathBuf::new();
    }
    let p = PathBuf::from(raw);
    if p.is_absolute() { p } else { cwd.join(p) }
}

pub(crate) fn take_opt_val(
    args: &[String],
    i: &mut usize,
    flag: &str,
) -> Result<String, CliParseError> {
    if let Some((_, val)) = args[*i].split_once('=') {
        return Ok(val.to_string());
    }
    let next = args
        .get(*i + 1)
        .ok_or_else(|| CliParseError::Message(format!("missing value for {flag}")))?;
    *i += 1;
    Ok(next.clone())
}

pub fn parse_agents(args: &[String]) -> Result<AdminOp, CliParseError> {
    let (mut action, mut agent, mut all, mut global_rules, mut json) =
        (None, None, false, false, false);
    let (mut i, mut past_dd) = (0, false);
    while i < args.len() {
        let arg = args[i].as_str();
        if !past_dd && arg == "--" {
            past_dd = true;
        } else if !past_dd && (arg == "-a" || arg == "--agent" || arg.starts_with("--agent=")) {
            let val = take_opt_val(args, &mut i, "-a/--agent")?;
            if SupportedAgentId::parse(&val).is_none() {
                return Err(CliParseError::Message(format!("unknown agent '{val}'")));
            }
            agent = Some(val);
        } else if !past_dd && arg.starts_with('-') {
            match arg {
                "--all" => all = true,
                "--global-rules" => global_rules = true,
                "--json" => json = true,
                _ => {
                    return Err(CliParseError::Message(format!(
                        "unknown option '{arg}' for 'agents'"
                    )));
                }
            }
        } else if action.is_none() {
            if !matches!(arg, "status" | "list" | "setup" | "install" | "remove" | "uninstall") {
                return Err(CliParseError::Message(format!(
                    "unknown agents action '{arg}'"
                )));
            }
            action = Some(arg.to_string());
        } else {
            return Err(CliParseError::Message(format!(
                "unexpected argument '{arg}' for 'agents'"
            )));
        }
        i += 1;
    }
    Ok(AdminOp {
        action: AdminAction::Agents {
            action: action.unwrap_or_else(|| "status".to_string()),
            agent,
            all,
            global_rules,
            json,
        },
    })
}

pub fn parse_gain(args: &[String]) -> Result<AdminOp, CliParseError> {
    let (mut project, mut unique, mut all, mut interactive) = (None, false, false, false);
    let (mut json, mut reset, mut yes, mut i, mut past_dd) = (false, false, false, 0, false);
    while i < args.len() {
        let arg = args[i].as_str();
        if !past_dd && arg == "--" {
            past_dd = true;
        } else if !past_dd && (arg == "-p" || arg == "--project" || arg.starts_with("--project=")) {
            let val = take_opt_val(args, &mut i, "-p/--project")?;
            if val.trim().is_empty() {
                return Err(CliParseError::Message(
                    "project path cannot be empty".into(),
                ));
            }
            project = Some(val);
        } else if !past_dd && arg.starts_with('-') {
            match arg {
                "--unique" => unique = true,
                "--all" => all = true,
                "-i" | "--interactive" => interactive = true,
                "--json" => json = true,
                "--reset" => reset = true,
                "-y" | "--yes" => yes = true,
                _ => {
                    return Err(CliParseError::Message(format!(
                        "unknown option '{arg}' for 'gain'"
                    )));
                }
            }
        } else if project.is_none() {
            if arg.trim().is_empty() {
                return Err(CliParseError::Message(
                    "project path cannot be empty".into(),
                ));
            }
            project = Some(arg.to_string());
        } else {
            return Err(CliParseError::Message(format!(
                "unexpected argument '{arg}' for 'gain'"
            )));
        }
        i += 1;
    }
    Ok(AdminOp {
        action: AdminAction::Gain {
            project,
            unique,
            all,
            interactive,
            json,
            reset,
            yes,
        },
    })
}

pub fn parse_analyze(
    args: &[String],
    cwd: &Path,
) -> Result<AdminOp, CliParseError> {
    let (mut project, mut transcripts_dir, mut json, mut i, mut past_dd) =
        (None, None, false, 0, false);
    while i < args.len() {
        let arg = args[i].as_str();
        if !past_dd && arg == "--" {
            past_dd = true;
        } else if !past_dd && (arg == "-p" || arg == "--project" || arg.starts_with("--project=")) {
            let val = take_opt_val(args, &mut i, "-p/--project")?;
            if val.trim().is_empty() {
                return Err(CliParseError::Message(
                    "project path cannot be empty".into(),
                ));
            }
            project = Some(val);
        } else if !past_dd && (arg == "--transcripts-dir" || arg.starts_with("--transcripts-dir="))
        {
            let val = take_opt_val(args, &mut i, "--transcripts-dir")?;
            if val.trim().is_empty() {
                return Err(CliParseError::Message(
                    "transcripts directory cannot be empty".into(),
                ));
            }
            transcripts_dir = Some(resolve_arg_path(&val, cwd));
        } else if !past_dd && arg.starts_with('-') {
            match arg {
                "--json" => json = true,
                _ => {
                    return Err(CliParseError::Message(format!(
                        "unknown option '{arg}' for 'analyze'"
                    )));
                }
            }
        } else if project.is_none() {
            if arg.trim().is_empty() {
                return Err(CliParseError::Message(
                    "project path cannot be empty".into(),
                ));
            }
            project = Some(arg.to_string());
        } else {
            return Err(CliParseError::Message(format!(
                "unexpected argument '{arg}' for 'analyze'"
            )));
        }
        i += 1;
    }
    Ok(AdminOp {
        action: AdminAction::Analyze {
            project,
            transcripts_dir,
            json,
        },
    })
}

pub fn parse_benchmark(args: &[String]) -> Result<AdminOp, CliParseError> {
    let (mut json, mut markdown, mut past_dd) = (false, false, false);
    for arg in args {
        if !past_dd && arg == "--" {
            past_dd = true;
        } else if !past_dd && arg.starts_with('-') {
            match arg.as_str() {
                "--json" => json = true,
                "--markdown" => markdown = true,
                _ => {
                    return Err(CliParseError::Message(format!(
                        "unknown option '{arg}' for 'benchmark'"
                    )));
                }
            }
        } else {
            return Err(CliParseError::Message(format!(
                "unexpected argument '{arg}' for 'benchmark'"
            )));
        }
    }
    Ok(AdminOp {
        action: AdminAction::Benchmark { json, markdown },
    })
}
