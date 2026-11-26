use std::path::Path;

use aice_governance::{GovernanceError, OutputSurface, PipelineRequest, ReadOp, authorize};
use aice_pipeline::{
    DefaultPipelineExecutor, PipelineExecutor, StdoutWriter, meter_and_seal, record_failure_for_cli,
};
use aice_telemetry::TelemetryOpKind;

use crate::cli::CliParseError;

fn take_opt_val(args: &[String], i: &mut usize, flag: &str) -> Result<String, CliParseError> {
    if let Some((_, val)) = args[*i].split_once('=') {
        return Ok(val.to_string());
    }
    let next = args
        .get(*i + 1)
        .ok_or_else(|| CliParseError::Message(format!("missing value for {flag}")))?;
    *i += 1;
    Ok(next.clone())
}

fn parse_usize_opt(args: &[String], i: &mut usize, flag: &str) -> Result<usize, CliParseError> {
    let raw = take_opt_val(args, i, flag)?;
    raw.parse::<usize>()
        .map_err(|_| CliParseError::Message(format!("invalid integer '{raw}' for {flag}")))
}

pub fn parse_read_args(args: &[String]) -> Result<ReadOp, CliParseError> {
    let mut op = ReadOp {
        targets: Vec::new(),
        target_paths: Vec::new(),
        outline: false,
        outline_target: false,
        full: false,
        depth: None,
        symbol: None,
        search: None,
        context_lines: None,
        files_only: false,
        compact: true,
        include_types: true,
        include_deps: false,
        include_callers: false,
        max_tokens: None,
        json: false,
        stats: false,
    };
    let mut explicit_deps: Option<bool> = None;
    let mut explicit_callers: Option<bool> = None;
    let (mut i, mut past_dd) = (0, false);
    while i < args.len() {
        let arg = args[i].as_str();
        if !past_dd && arg == "--" {
            past_dd = true;
        } else if !past_dd && arg.starts_with('-') {
            match arg {
                "--outline" => op.outline = true,
                "--outline-target" => op.outline_target = true,
                "--full" => op.full = true,
                "--files" => op.files_only = true,
                "--compact" => op.compact = true,
                "--no-compact" => op.compact = false,
                "--no-types" => op.include_types = false,
                "--deps" => explicit_deps = Some(true),
                "--no-deps" => explicit_deps = Some(false),
                "--callers" => explicit_callers = Some(true),
                "--no-callers" => explicit_callers = Some(false),
                "--json" => op.json = true,
                "--stats" => op.stats = true,
                "-d" | "--depth" => op.depth = Some(parse_usize_opt(args, &mut i, "-d/--depth")?),
                "-C" | "--context" => {
                    op.context_lines = Some(parse_usize_opt(args, &mut i, "-C/--context")?);
                }
                "--max-tokens" => {
                    op.max_tokens = Some(parse_usize_opt(args, &mut i, "--max-tokens")?);
                }
                "-s" | "--symbol" => op.symbol = Some(take_opt_val(args, &mut i, "-s/--symbol")?),
                "--search" => op.search = Some(take_opt_val(args, &mut i, "--search")?),
                _ if arg.starts_with("--depth=") => {
                    op.depth = Some(parse_usize_opt(args, &mut i, "--depth")?);
                }
                _ if arg.starts_with("--context=") => {
                    op.context_lines = Some(parse_usize_opt(args, &mut i, "--context")?);
                }
                _ if arg.starts_with("--max-tokens=") => {
                    op.max_tokens = Some(parse_usize_opt(args, &mut i, "--max-tokens")?);
                }
                _ if arg.starts_with("--symbol=") => {
                    op.symbol = Some(take_opt_val(args, &mut i, "--symbol")?);
                }
                _ if arg.starts_with("--search=") => {
                    op.search = Some(take_opt_val(args, &mut i, "--search")?);
                }
                _ => {
                    return Err(CliParseError::Message(format!(
                        "unknown option '{arg}' for 'read'"
                    )));
                }
            }
        } else {
            op.targets.push(arg.to_string());
        }
        i += 1;
    }
    if op.targets.is_empty() && !op.files_only && op.search.is_none() {
        return Err(CliParseError::Message(
            "read requires at least one <target>".to_string(),
        ));
    }
    op.include_deps = explicit_deps
        .unwrap_or_else(|| !op.outline && !op.outline_target && op.depth.is_some_and(|d| d > 0));
    op.include_callers = explicit_callers.unwrap_or(false);
    Ok(op)
}

fn extract_files_only_filter(op: &mut ReadOp, cwd: &Path) {
    if !op.files_only || op.search.is_some() || op.targets.is_empty() {
        return;
    }
    if op.targets.len() >= 2 {
        let first_exists = cwd.join(&op.targets[0]).exists();
        let second = &op.targets[1];
        if first_exists && !second.contains("..") && !Path::new(second).is_absolute() && !cwd.join(second).exists() {
            op.search = Some(op.targets.remove(1));
            return;
        }
    }
    if op.targets.len() == 1 {
        let raw = op.targets[0].clone();
        if raw.contains("..") || Path::new(&raw).is_absolute() || cwd.join(&raw).exists() {
            return;
        }
        if !raw.contains('/') && !raw.contains('\\') {
            op.targets.clear();
            op.search = Some(raw);
        } else if has_glob_magic(&raw)
            && let Some(prefix) = existing_glob_prefix(&raw, cwd)
        {
            op.targets.clear();
            if prefix != "." {
                op.targets.push(prefix);
            }
            op.search = Some(raw);
        }
    }
}

fn has_glob_magic(s: &str) -> bool {
    s.contains('*') || s.contains('?') || s.contains('[')
}

fn existing_glob_prefix(raw: &str, cwd: &Path) -> Option<String> {
    let norm = raw.replace('\\', "/");
    let mut parts = Vec::new();
    for seg in norm.split('/') {
        if has_glob_magic(seg) {
            break;
        }
        parts.push(seg);
    }
    if parts.is_empty() {
        return Some(".".to_string());
    }
    let candidate = parts.join("/");
    cwd.join(&candidate).is_dir().then_some(candidate)
}

pub fn run_read(mut op: ReadOp, cwd: &Path) -> i32 {
    extract_files_only_filter(&mut op, cwd);
    let op_kind = if op.outline
        || (op.outline_target && !op.include_deps && !op.include_callers && op.targets.len() <= 1)
    {
        TelemetryOpKind::Outline
    } else if op.files_only
        || op.search.is_some()
        || op.targets.len() > 1
        || op.include_deps
        || op.include_callers
    {
        TelemetryOpKind::Context
    } else {
        TelemetryOpKind::Read
    };
    let label = op
        .targets
        .first()
        .cloned()
        .unwrap_or_else(|| "<read>".to_string());
    let req = PipelineRequest::new(op, cwd.to_path_buf(), OutputSurface::Cli);
    match authorize(req) {
        Ok(gov) => match DefaultPipelineExecutor.execute_read(gov) {
            Ok(res) => StdoutWriter::emit(meter_and_seal(res)),
            Err(e) => {
                let msg = e.to_string();
                eprintln!("{msg}");
                record_failure_for_cli(cwd, op_kind, OutputSurface::Cli, &label, &msg, None, false);
                1
            }
        },
        Err(e) => {
            let is_disabled = matches!(e, GovernanceError::Disabled);
            let msg = e.to_string();
            eprintln!("{msg}");
            record_failure_for_cli(
                cwd,
                op_kind,
                OutputSurface::Cli,
                &label,
                &msg,
                None,
                is_disabled,
            );
            1
        }
    }
}
