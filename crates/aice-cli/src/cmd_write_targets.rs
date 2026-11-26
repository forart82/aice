use std::io::Read;
use std::path::Path;

use aice_governance::{
    GovernanceError, OutputSurface, PipelineRequest, ReadOp, WriteOp, authorize,
    has_regex_selector_part, is_valid_selector_tail, split_target_selector,
};
use aice_pipeline::is_disallowed_write_selector;

use crate::cli::CliParseError;

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

pub(crate) fn empty_write_op() -> WriteOp {
    WriteOp {
        path: None,
        symbol: None,
        code: None,
        template: None,
        body: None,
        from_file: None,
        from_stdin: false,
        delete: None,
        insert_after: None,
        insert_before: None,
        edits: None,
        batch: None,
        create: false,
        overwrite: false,
        force: false,
        in_place: false,
        dry_run: false,
        diff: false,
        json: false,
        preserve_docs: true,
        target_paths: Vec::new(),
    }
}

pub(crate) fn read_stdin_payload() -> Result<String, CliParseError> {
    let mut buf = String::new();
    std::io::stdin()
        .read_to_string(&mut buf)
        .map_err(|e| CliParseError::Message(format!("failed to read stdin: {e}")))?;
    Ok(buf)
}

pub(crate) fn consume_stdin_flag(stdin_consumed: &mut bool) -> Result<(), CliParseError> {
    if *stdin_consumed {
        return Err(CliParseError::Message(
            "cannot read multiple splice inputs from stdin".to_string(),
        ));
    }
    *stdin_consumed = true;
    Ok(())
}

pub(crate) fn stage_flag_payload(
    val: String,
    slot: &mut Option<String>,
    from_stdin_flag: &mut bool,
    stdin_consumed: &mut bool,
) -> Result<(), CliParseError> {
    if val == "-" {
        consume_stdin_flag(stdin_consumed)?;
        *from_stdin_flag = true;
        *slot = None;
    } else {
        *from_stdin_flag = false;
        *slot = Some(val);
    }
    Ok(())
}

fn splice_flag_takes_value(arg: &str) -> bool {
    if arg.contains('=') {
        return false;
    }
    matches!(
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
    )
}

fn is_regex_selector_expr(tok: &str) -> bool {
    let bytes = tok.as_bytes();
    let (mut start, mut i) = (0, 0);
    let (mut in_regex, mut in_class, mut in_quote) = (false, false, None);
    let mut saw_regex = false;
    while i < bytes.len() {
        let b = bytes[i];
        if let Some(q) = in_quote {
            if b == b'\\' {
                if i + 1 >= bytes.len() {
                    return false;
                }
                i += 2;
                continue;
            }
            if b == q {
                in_quote = None;
            }
        } else if in_regex {
            match b {
                b'\\' => {
                    if i + 1 >= bytes.len() {
                        return false;
                    }
                    i += 2;
                    continue;
                }
                b'[' if !in_class => in_class = true,
                b']' if in_class => in_class = false,
                b'/' if !in_class => in_regex = false,
                _ => {}
            }
        } else {
            match b {
                b'\'' | b'"' => in_quote = Some(b),
                b'/' if tok[start..i].trim().is_empty() => in_regex = true,
                b',' => {
                    let seg = tok[start..i].trim();
                    if !is_valid_selector_tail(seg) {
                        return false;
                    }
                    if has_regex_selector_part(seg) {
                        saw_regex = true;
                    }
                    start = i + 1;
                }
                _ => {}
            }
        }
        i += 1;
    }
    if in_regex || in_class || in_quote.is_some() {
        return false;
    }
    let tail = tok[start..].trim();
    is_valid_selector_tail(tail) && (saw_regex || has_regex_selector_part(tail))
}

fn is_explicit_selector_token(tok: &str) -> bool {
    if let (_, Some(sel)) = split_target_selector(tok) {
        return is_disallowed_write_selector(sel);
    }
    is_regex_selector_expr(tok)
}

fn has_following_file_or_positional(args: &[String], start: usize) -> bool {
    let mut j = start;
    while j < args.len() {
        let arg = args[j].as_str();
        if arg == "--" {
            return j + 1 < args.len();
        }
        if arg == "-f" || arg == "--file" || arg.starts_with("--file=") {
            return true;
        }
        if !arg.starts_with('-') {
            return true;
        }
        if splice_flag_takes_value(arg) {
            j += 2;
        } else {
            j += 1;
        }
    }
    false
}

pub fn should_consume_delete_arg(
    args: &[String],
    delete_idx: usize,
    has_path: bool,
) -> bool {
    let Some(next) = args.get(delete_idx + 1) else {
        return false;
    };
    if next.starts_with('-') {
        return false;
    }
    has_path
        || is_explicit_selector_token(next)
        || has_following_file_or_positional(args, delete_idx + 2)
}

pub fn looks_like_manifest_file(raw: &str) -> bool {
    let t = raw.trim_start_matches('\u{FEFF}').trim();
    !t.is_empty()
        && t != "-"
        && !t.starts_with('[')
        && !t.starts_with('{')
        && !t.starts_with("===")
        && !t.contains('\n')
        && !t.contains('\r')
}

pub(crate) fn has_pending_manifest_target(op: &WriteOp) -> bool {
    op.batch.as_deref().is_some_and(looks_like_manifest_file)
        || op.edits.as_deref().is_some_and(looks_like_manifest_file)
}

pub(crate) fn is_batch_write_op(op: &WriteOp) -> bool {
    use aice_governance::OperationTargets;
    op.batch.is_some() || op.edits.is_some() || op.raw_target_strings().len() > 1
}

pub(crate) fn resolve_manifest_files(op: &mut WriteOp, cwd: &Path) -> Result<(), GovernanceError> {
    for slot in [&mut op.batch, &mut op.edits] {
        if slot.as_deref().is_some_and(looks_like_manifest_file) {
            let raw = slot.take().unwrap_or_default();
            let read_op = ReadOp {
                targets: vec![raw.clone()],
                target_paths: vec![],
                outline: false,
                outline_target: false,
                full: false,
                depth: None,
                symbol: None,
                search: None,
                context_lines: None,
                files_only: false,
                compact: false,
                include_types: false,
                include_deps: false,
                include_callers: false,
                max_tokens: None,
                json: false,
                stats: false,
            };
            let gov = authorize(PipelineRequest::new(
                read_op,
                cwd.to_path_buf(),
                OutputSurface::Cli,
            ))?;
            let auth = &gov.state().authorized_paths()[0];
            if auth.is_binary {
                return Err(GovernanceError::BinaryWriteForbidden(
                    auth.canonical.clone(),
                ));
            }
            if auth.canonical.is_file() {
                let content = std::fs::read_to_string(&auth.canonical)
                    .map_err(|e| GovernanceError::Io(e.to_string()))?;
                *slot = Some(content);
            } else {
                *slot = Some(raw);
            }
        }
    }
    Ok(())
}
