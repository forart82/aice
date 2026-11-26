use std::path::Path;

use aice_governance::{
    FindOp, GovernanceError, OutputSurface, PipelineRequest, SearchOp, authorize,
};
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

pub fn parse_search_args(args: &[String]) -> Result<SearchOp, CliParseError> {
    let mut positionals = Vec::new();
    let (mut context_lines, mut line_numbers, mut symbol) = (None, false, None);
    let (mut search_pat, mut files_with_matches, mut full) = (None, false, false);
    let (mut max_tokens, mut json, mut stats) = (None, false, false);
    let (mut i, mut past_dd) = (0, false);

    while i < args.len() {
        let arg = args[i].as_str();
        if !past_dd && arg == "--" {
            past_dd = true;
        } else if !past_dd && arg.starts_with('-') {
            match arg {
                "-n" | "--line-number" => line_numbers = true,
                "-l" | "--files-with-matches" => files_with_matches = true,
                "--full" => full = true,
                "--json" => json = true,
                "--stats" => stats = true,
                "-C" | "--context" => {
                    context_lines = Some(parse_usize_opt(args, &mut i, "-C/--context")?);
                }
                "--max-tokens" => {
                    max_tokens = Some(parse_usize_opt(args, &mut i, "--max-tokens")?);
                }
                "-s" | "--symbol" => symbol = Some(take_opt_val(args, &mut i, "-s/--symbol")?),
                "--search" => search_pat = Some(take_opt_val(args, &mut i, "--search")?),
                _ if arg.starts_with("--context=") => {
                    context_lines = Some(parse_usize_opt(args, &mut i, "--context")?);
                }
                _ if arg.starts_with("--max-tokens=") => {
                    max_tokens = Some(parse_usize_opt(args, &mut i, "--max-tokens")?);
                }
                _ if arg.starts_with("--symbol=") => {
                    symbol = Some(take_opt_val(args, &mut i, "--symbol")?);
                }
                _ if arg.starts_with("--search=") => {
                    search_pat = Some(take_opt_val(args, &mut i, "--search")?);
                }
                _ => {
                    return Err(CliParseError::Message(format!(
                        "unknown option '{arg}' for 'search'"
                    )));
                }
            }
        } else {
            positionals.push(arg.to_string());
        }
        i += 1;
    }

    let (pattern, targets) = if let Some(pat) = search_pat {
        (pat, positionals)
    } else if !positionals.is_empty() {
        let pat = positionals.remove(0);
        (pat, positionals)
    } else if let Some(sym) = &symbol {
        (sym.clone(), Vec::new())
    } else {
        return Err(CliParseError::Message(
            "search requires <pattern>".to_string(),
        ));
    };

    Ok(SearchOp {
        pattern,
        targets,
        target_paths: Vec::new(),
        context_lines,
        line_numbers,
        symbol,
        files_with_matches,
        full,
        max_tokens,
        json,
        stats,
    })
}

fn looks_like_path_target(raw: &str, cwd: &Path) -> bool {
    raw == "."
        || raw == ".."
        || raw.starts_with("./")
        || raw.starts_with("../")
        || raw.starts_with('/')
        || raw.contains('/')
        || raw.contains('\\')
        || cwd.join(raw).exists()
}

fn has_glob_magic(s: &str) -> bool {
    s.contains('*') || s.contains('?') || s.contains('[')
}

fn is_subpath_glob_pattern(raw: &str, cwd: &Path) -> bool {
    has_glob_magic(raw)
        && !raw.contains("..")
        && !Path::new(raw).is_absolute()
        && !cwd.join(raw).exists()
}

fn existing_glob_prefix(raw: &str, cwd: &Path) -> Option<String> {
    let norm = raw.replace('\\', "/");
    let parts: Vec<&str> = norm.split('/').take_while(|s| !has_glob_magic(s)).collect();
    if parts.is_empty() {
        return Some(".".to_string());
    }
    let candidate = parts.join("/");
    cwd.join(&candidate).is_dir().then_some(candidate)
}

pub fn parse_find_args(args: &[String], cwd: &Path) -> Result<FindOp, CliParseError> {
    let mut positionals = Vec::new();
    let (mut depth, mut search, mut full) = (None, None, false);
    let (mut max_tokens, mut json, mut i, mut past_dd) = (None, false, 0, false);

    while i < args.len() {
        let arg = args[i].as_str();
        if !past_dd && arg == "--" {
            past_dd = true;
        } else if !past_dd && arg.starts_with('-') {
            match arg {
                "--full" => full = true,
                "--json" => json = true,
                "-d" | "--depth" | "-L" => depth = Some(parse_usize_opt(args, &mut i, "-d/--depth")?),
                "--max-tokens" => {
                    max_tokens = Some(parse_usize_opt(args, &mut i, "--max-tokens")?);
                }
                "--search" => search = Some(take_opt_val(args, &mut i, "--search")?),
                _ if arg.starts_with("--depth=") => {
                    depth = Some(parse_usize_opt(args, &mut i, "--depth")?);
                }
                _ if arg.starts_with("--max-tokens=") => {
                    max_tokens = Some(parse_usize_opt(args, &mut i, "--max-tokens")?);
                }
                _ if arg.starts_with("--search=") => {
                    search = Some(take_opt_val(args, &mut i, "--search")?);
                }
                _ => {
                    return Err(CliParseError::Message(format!(
                        "unknown option '{arg}' for 'find'"
                    )));
                }
            }
        } else {
            positionals.push(arg.to_string());
        }
        i += 1;
    }

    let (pattern, targets) = if search.is_some() || positionals.is_empty() {
        (None, positionals)
    } else if positionals.len() >= 2
        && looks_like_path_target(&positionals[0], cwd)
        && (!looks_like_path_target(&positionals[1], cwd)
            || is_subpath_glob_pattern(&positionals[1], cwd))
    {
        let pat = positionals.remove(1);
        (Some(pat), positionals)
    } else if positionals.len() == 1
        && has_glob_magic(&positionals[0])
        && !positionals[0].contains("..")
        && !Path::new(&positionals[0]).is_absolute()
        && !cwd.join(&positionals[0]).exists()
    {
        let raw = positionals.remove(0);
        if let Some(prefix) = existing_glob_prefix(&raw, cwd)
            && prefix != "."
        {
            positionals.push(prefix);
        }
        (Some(raw), positionals)
    } else if looks_like_path_target(&positionals[0], cwd) {
        (None, positionals)
    } else {
        let pat = positionals.remove(0);
        (Some(pat), positionals)
    };

    Ok(FindOp {
        pattern,
        targets,
        target_paths: Vec::new(),
        depth,
        search,
        full,
        max_tokens,
        json,
    })
}

pub fn run_search(op: SearchOp, cwd: &Path) -> i32 {
    let req = PipelineRequest::new(op, cwd.to_path_buf(), OutputSurface::Cli);
    match authorize(req) {
        Ok(gov) => match DefaultPipelineExecutor.execute_search(gov) {
            Ok(res) => StdoutWriter::emit(meter_and_seal(res)),
            Err(e) => fail_discover(cwd, "<directory>", &e.to_string(), false),
        },
        Err(e) => fail_discover(cwd, "<directory>", &e.to_string(), matches!(e, GovernanceError::Disabled)),
    }
}

pub fn run_find(op: FindOp, cwd: &Path) -> i32 {
    let req = PipelineRequest::new(op, cwd.to_path_buf(), OutputSurface::Cli);
    match authorize(req) {
        Ok(gov) => match DefaultPipelineExecutor.execute_find(gov) {
            Ok(res) => StdoutWriter::emit(meter_and_seal(res)),
            Err(e) => fail_discover(cwd, "<workspace-files>", &e.to_string(), false),
        },
        Err(e) => fail_discover(cwd, "<workspace-files>", &e.to_string(), matches!(e, GovernanceError::Disabled)),
    }
}

fn fail_discover(cwd: &Path, label: &str, msg: &str, is_disabled: bool) -> i32 {
    eprintln!("{msg}");
    record_failure_for_cli(cwd, TelemetryOpKind::Context, OutputSurface::Cli, label, msg, None, is_disabled);
    1
}
