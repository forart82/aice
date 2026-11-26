use std::path::{Path, PathBuf};

use aice_governance::{
    GovernanceError, OperationTargets, OutputSurface, PipelineRequest, WriteOp, authorize,
    has_regex_selector_part, split_target_selector,
};
use aice_pipeline::{
    DefaultPipelineExecutor, PipelineExecutor, StdoutWriter, has_write_targets,
    is_disallowed_write_selector, meter_and_seal, record_failure_for_cli,
    validate_raw_write_target, validate_write_op_selectors,
};
use aice_telemetry::TelemetryOpKind;

use crate::cli::CliParseError;
use crate::cmd_write_targets::{
    consume_stdin_flag, empty_write_op, has_pending_manifest_target, is_batch_write_op,
    read_stdin_payload, resolve_manifest_files, should_consume_delete_arg, stage_flag_payload,
    take_opt_val,
};

pub fn parse_write_args(args: &[String], cwd: &Path) -> Result<WriteOp, CliParseError> {
    parse_write_args_with_stdin(args, cwd, read_stdin_payload)
}

pub fn parse_write_args_with_stdin<F>(
    args: &[String],
    cwd: &Path,
    mut read_stdin: F,
) -> Result<WriteOp, CliParseError>
where
    F: FnMut() -> Result<String, CliParseError>,
{
    let mut op = empty_write_op();
    let (mut i, mut past_dd, mut stdin_consumed) = (0, false, false);
    let (mut edits_stdin, mut batch_stdin) = (false, false);

    while i < args.len() {
        let arg = args[i].as_str();
        if !past_dd && arg == "--" {
            past_dd = true;
        } else if !past_dd && arg.starts_with('-') {
            match arg {
                "--dry-run" => op.dry_run = true,
                "--create" => op.create = true,
                "--overwrite" => op.overwrite = true,
                "--force" => op.force = true,
                "--in-place" => op.in_place = true,
                "--diff" => op.diff = true,
                "--json" => op.json = true,
                "--no-preserve-docs" => op.preserve_docs = false,
                "--stdin" => {
                    consume_stdin_flag(&mut stdin_consumed)?;
                    op.from_stdin = true;
                }
                "-f" | "--file" => {
                    op.path = Some(PathBuf::from(take_opt_val(args, &mut i, "-f/--file")?));
                }
                "-s" | "--symbol" => op.symbol = Some(take_opt_val(args, &mut i, "-s/--symbol")?),
                "-c" | "--code" => op.code = Some(take_opt_val(args, &mut i, "-c/--code")?),
                "-t" | "--template" => {
                    op.template = Some(take_opt_val(args, &mut i, "-t/--template")?);
                }
                "-b" | "--body" => op.body = Some(take_opt_val(args, &mut i, "-b/--body")?),
                "--from" => {
                    op.from_file = Some(PathBuf::from(take_opt_val(args, &mut i, "--from")?));
                }
                "--insert-after" => {
                    op.insert_after = Some(take_opt_val(args, &mut i, "--insert-after")?);
                }
                "--insert-before" => {
                    op.insert_before = Some(take_opt_val(args, &mut i, "--insert-before")?);
                }
                "--edits" => {
                    let v = take_opt_val(args, &mut i, "--edits")?;
                    stage_flag_payload(v, &mut op.edits, &mut edits_stdin, &mut stdin_consumed)?;
                }
                "--batch" => {
                    let v = take_opt_val(args, &mut i, "--batch")?;
                    stage_flag_payload(v, &mut op.batch, &mut batch_stdin, &mut stdin_consumed)?;
                }
                "-d" | "--delete" => {
                    if should_consume_delete_arg(args, i, op.path.is_some()) {
                        op.delete = Some(args[i + 1].clone());
                        i += 1;
                    } else {
                        op.delete = Some(String::new());
                    }
                }
                _ if arg.starts_with("--file=") => {
                    op.path = Some(PathBuf::from(take_opt_val(args, &mut i, "--file")?));
                }
                _ if arg.starts_with("--symbol=") => {
                    op.symbol = Some(take_opt_val(args, &mut i, "--symbol")?);
                }
                _ if arg.starts_with("--code=") => {
                    op.code = Some(take_opt_val(args, &mut i, "--code")?);
                }
                _ if arg.starts_with("--template=") => {
                    op.template = Some(take_opt_val(args, &mut i, "--template")?);
                }
                _ if arg.starts_with("--body=") => {
                    op.body = Some(take_opt_val(args, &mut i, "--body")?);
                }
                _ if arg.starts_with("--from=") => {
                    op.from_file = Some(PathBuf::from(take_opt_val(args, &mut i, "--from")?));
                }
                _ if arg.starts_with("--delete=") => {
                    op.delete = Some(take_opt_val(args, &mut i, "--delete")?);
                }
                _ if arg.starts_with("--insert-after=") => {
                    op.insert_after = Some(take_opt_val(args, &mut i, "--insert-after")?);
                }
                _ if arg.starts_with("--insert-before=") => {
                    op.insert_before = Some(take_opt_val(args, &mut i, "--insert-before")?);
                }
                _ if arg.starts_with("--edits=") => {
                    let v = take_opt_val(args, &mut i, "--edits")?;
                    stage_flag_payload(v, &mut op.edits, &mut edits_stdin, &mut stdin_consumed)?;
                }
                _ if arg.starts_with("--batch=") => {
                    let v = take_opt_val(args, &mut i, "--batch")?;
                    stage_flag_payload(v, &mut op.batch, &mut batch_stdin, &mut stdin_consumed)?;
                }
                _ => {
                    return Err(CliParseError::Message(format!(
                        "unknown option '{arg}' for 'splice'"
                    )));
                }
            }
        } else if op.path.is_none() {
            op.path = Some(PathBuf::from(arg));
        } else if op.symbol.is_none() {
            op.symbol = Some(arg.to_string());
        } else {
            return Err(CliParseError::Message(format!(
                "unexpected argument '{arg}' for 'splice'"
            )));
        }
        i += 1;
    }

    if edits_stdin {
        op.edits = Some(read_stdin()?);
    } else if batch_stdin {
        op.batch = Some(read_stdin()?);
    } else if op.from_stdin && op.batch.is_none() && op.edits.is_none() && op.code.is_none() {
        let stdin_buf = read_stdin()?;
        if op.path.is_some() {
            op.code = Some(stdin_buf);
        } else {
            op.batch = Some(stdin_buf);
        }
    }

    if let Some(raw_path) = op.path.as_ref().and_then(|p| p.to_str()).map(str::to_string) {
        if !op.dry_run {
            validate_raw_write_target(&raw_path, cwd).map_err(CliParseError::Message)?;
        }
        if let (file, Some(sel)) = split_target_selector(&raw_path) {
            if !op.dry_run && (has_regex_selector_part(sel) || is_disallowed_write_selector(sel)) {
                return Err(CliParseError::Message(format!(
                    "regex selector '{sel}' is not supported for splice target '{raw_path}'"
                )));
            }
            if let Some(existing) = &op.symbol
                && existing != sel
            {
                return Err(CliParseError::Message(format!(
                    "conflicting symbol '{existing}' and selector '{sel}' on target '{raw_path}'"
                )));
            }
            op.path = Some(PathBuf::from(file));
            if op.symbol.is_none() {
                op.symbol = Some(sel.to_string());
            }
        }
    }
    if op.symbol.is_none()
        && let Some(del) = &op.delete
        && !del.is_empty()
    {
        op.symbol = Some(del.clone());
    } else if op.delete.as_deref() == Some("")
        && let Some(sym) = &op.symbol
    {
        op.delete = Some(sym.clone());
    }
    if !op.dry_run
        && let Some(ref sym) = op.symbol
        && (has_regex_selector_part(sym) || is_disallowed_write_selector(sym))
    {
        return Err(CliParseError::Message(format!(
            "regex selector '{sym}' is not supported for splice"
        )));
    }
    if !has_pending_manifest_target(&op) {
        if !is_batch_write_op(&op) && !op.dry_run {
            validate_write_op_selectors(cwd, &op).map_err(CliParseError::Message)?;
        }
        if !has_write_targets(&op) {
            return Err(CliParseError::Message(
                "splice requires a target file, --batch, --edits, or heredoc --code targets"
                    .to_string(),
            ));
        }
    }
    op.target_paths = op.path.iter().cloned().collect();
    Ok(op)
}

pub fn run_write(mut op: WriteOp, cwd: &Path) -> i32 {
    let op_kind = if op.create {
        TelemetryOpKind::Create
    } else {
        TelemetryOpKind::Splice
    };
    let label = op
        .path
        .as_ref()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "<batch-splice>".to_string());
    let mut is_batch = is_batch_write_op(&op);
    if let Err(e) = resolve_manifest_files(&mut op, cwd) {
        let is_disabled = matches!(e, GovernanceError::Disabled);
        let msg = e.to_string();
        eprintln!("{msg}");
        if !op.dry_run && !is_batch {
            record_failure_for_cli(cwd, op_kind, OutputSurface::Cli, &label, &msg, None, is_disabled);
        }
        return 1;
    }
    is_batch |= is_batch_write_op(&op);
    if let Err(msg) = validate_write_op_selectors(cwd, &op) {
        eprintln!("{msg}");
        if !op.dry_run && !is_batch {
            record_failure_for_cli(cwd, op_kind, OutputSurface::Cli, &label, &msg, None, false);
        }
        return 1;
    }
    let wasted = {
        let payloads = op.inline_payloads();
        (!payloads.is_empty()).then(|| payloads.join("\n"))
    };
    let dry_run = op.dry_run;
    let req = PipelineRequest::new(op, cwd.to_path_buf(), OutputSurface::Cli);
    match authorize(req) {
        Ok(gov) => match DefaultPipelineExecutor.execute_write(gov) {
            Ok(res) => StdoutWriter::emit(meter_and_seal(res)),
            Err(e) => {
                let msg = e.to_string();
                eprintln!("{msg}");
                if !dry_run && !is_batch {
                    record_failure_for_cli(
                        cwd,
                        op_kind,
                        OutputSurface::Cli,
                        &label,
                        &msg,
                        wasted.as_deref(),
                        false,
                    );
                }
                1
            }
        },
        Err(e) => {
            let is_disabled = matches!(e, GovernanceError::Disabled);
            let msg = e.to_string();
            eprintln!("{msg}");
            if !dry_run && !is_batch {
                record_failure_for_cli(
                    cwd,
                    op_kind,
                    OutputSurface::Cli,
                    &label,
                    &msg,
                    wasted.as_deref(),
                    is_disabled,
                );
            }
            1
        }
    }
}
