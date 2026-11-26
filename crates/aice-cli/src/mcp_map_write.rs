use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use aice_governance::heredoc_targets::starts_with_heredoc_header_for;
use aice_governance::{
    GovernanceError, JsonValue, OperationTargets, OutputSurface, PipelineRequest, WriteOp,
    authorize, parse_json, split_target_selector,
};
use aice_pipeline::{
    DefaultPipelineExecutor, PipelineExecutor, StdoutWriter, meter_and_seal, record_failure_for_cli,
};
use aice_telemetry::TelemetryOpKind;

use crate::mcp_args::{RpcErr, opt_bool, opt_str};

const NULL_ITEM_ERR: &str = "Invalid null or non-object item in splice 'files'/'batch'/'edits' array. Provide valid edit objects or a flat === <file>:<selector> === heredoc stream in 'code'.";

pub fn handle_write(
    args: &BTreeMap<String, JsonValue>,
    id: &JsonValue,
    cwd: &Path,
    framed: bool,
) -> Result<(), RpcErr> {
    let raw_target = opt_str(args, &["filePath", "path", "file", "fileOrDir", "target"])?;
    let explicit_sym = opt_str(args, &["symbolSelector", "symbol", "selector", "range"])?;
    let code = opt_str(args, &["newAiceCode", "code", "content", "aice", "snippet", "replacement"])?;
    let body = opt_str(args, &["body"])?;
    let template = opt_str(args, &["template"])?;
    let insert_after = opt_str(args, &["insertAfter", "insert_after"])?;
    let insert_before = opt_str(args, &["insertBefore", "insert_before"])?;
    let explicit_create = opt_bool(args, &["create"])?;
    let overwrite = opt_bool(args, &["overwrite"])?.unwrap_or(false);
    let force = opt_bool(args, &["force"])?.unwrap_or(false);
    let preserve_docs = opt_bool(args, &["preserveDocs", "preserve_docs"])?.unwrap_or(true);
    let dry_run = opt_bool(args, &["dryRun", "dry_run"])?.unwrap_or(false);

    let (path, mut symbol, conflict_err) = split_target_and_symbol(&raw_target, explicit_sym);
    let mut delete = match args.get("delete") {
        Some(JsonValue::Bool(true)) => Some(String::new()),
        Some(JsonValue::Bool(false)) | Some(JsonValue::Null) | None => None,
        Some(JsonValue::String(s)) => Some(s.clone()),
        _ => return Err((-32602, "Expected boolean or selector string for 'delete'".into())),
    };
    if symbol.is_none() && let Some(del) = &delete && !del.is_empty() {
        symbol = Some(del.clone());
    } else if delete.as_deref() == Some("") && let Some(sym) = &symbol {
        delete = Some(sym.clone());
    }

    let edits = parse_manifest_arg(args, "edits", false, path.as_deref(), cwd)?;
    let files_val = parse_manifest_arg(args, "files", true, path.as_deref(), cwd)?;
    let batch_val = parse_manifest_arg(args, "batch", true, path.as_deref(), cwd)?;
    let batch = match (files_val, batch_val) {
        (Some(f), None) => Some(f),
        (None, Some(b)) => Some(b),
        (Some(_), Some(_)) => return Err((-32602, "Specify either 'files' or 'batch', not both".into())),
        (None, None) => None,
    };

    let mut create = explicit_create.unwrap_or(false);
    if explicit_create.is_none()
        && batch.is_none()
        && edits.is_none()
        && symbol.is_none()
        && delete.is_none()
        && insert_after.is_none()
        && insert_before.is_none()
        && !overwrite
        && let Some(p) = &path
    {
        let is_heredoc = code
            .as_deref()
            .is_some_and(|c| starts_with_heredoc_header_for(c, Some(p)) || has_hunk_block(c));
        let has_payload = code.is_some() || body.is_some() || template.is_some();
        if !is_heredoc && has_payload && !resolve_path(p, cwd).exists() {
            create = true;
        }
    }

    let target_paths: Vec<PathBuf> = path.iter().cloned().collect();
    let op = WriteOp {
        path,
        symbol,
        code,
        template,
        body,
        from_file: None,
        from_stdin: false,
        delete,
        insert_after,
        insert_before,
        edits,
        batch,
        create,
        overwrite,
        force,
        in_place: !dry_run,
        dry_run,
        diff: dry_run,
        json: false,
        preserve_docs,
        target_paths,
    };

    let op_kind = if op.create { TelemetryOpKind::Create } else { TelemetryOpKind::Splice };
    let label = op.path.as_ref().map(|p| p.display().to_string()).unwrap_or_else(|| "<batch-splice>".into());
    let is_batch = op.batch.is_some() || op.edits.is_some() || op.raw_target_strings().len() > 1;
    let wasted = {
        let payloads = op.inline_payloads();
        (!payloads.is_empty()).then(|| payloads.join("\n"))
    };

    let req = PipelineRequest::new(op, cwd.to_path_buf(), OutputSurface::Mcp);
    match authorize(req) {
        Ok(gov) => {
            if let Some(msg) = conflict_err {
                emit_write_err(cwd, op_kind, &label, &msg, wasted.as_deref(), dry_run, is_batch, false, id, framed);
                return Ok(());
            }
            match DefaultPipelineExecutor.execute_write(gov) {
                Ok(res) => {
                    let _ = StdoutWriter::emit_mcp_tool_result(meter_and_seal(res), id, framed);
                }
                Err(e) => emit_write_err(
                    cwd, op_kind, &label, &e.to_string(), wasted.as_deref(), dry_run, is_batch, false, id, framed,
                ),
            }
        }
        Err(e) => emit_write_err(
            cwd, op_kind, &label, &e.to_string(), wasted.as_deref(), dry_run, is_batch,
            matches!(e, GovernanceError::Disabled), id, framed,
        ),
    }
    Ok(())
}

fn split_target_and_symbol(
    raw_target: &Option<String>,
    explicit_sym: Option<String>,
) -> (Option<PathBuf>, Option<String>, Option<String>) {
    let mut path = None;
    let mut symbol = explicit_sym.filter(|s| !s.is_empty());
    let mut conflict = None;
    if let Some(raw) = raw_target {
        let (file, inline_sel) = split_target_selector(raw);
        if let Some(sel) = inline_sel {
            if let Some(existing) = &symbol && existing != sel {
                conflict = Some(format!("conflicting symbol '{existing}' and selector '{sel}' on target '{raw}'"));
            }
            if symbol.is_none() {
                symbol = Some(sel.to_string());
            }
        }
        if !file.is_empty() {
            path = Some(PathBuf::from(file));
        }
    }
    (path, symbol, conflict)
}

#[allow(clippy::too_many_arguments)]
fn emit_write_err(
    cwd: &Path,
    op_kind: TelemetryOpKind,
    label: &str,
    msg: &str,
    wasted: Option<&str>,
    dry_run: bool,
    is_batch: bool,
    is_disabled: bool,
    id: &JsonValue,
    framed: bool,
) {
    StdoutWriter::emit_mcp_tool_error(id, msg, framed);
    if !dry_run && !is_batch {
        record_failure_for_cli(cwd, op_kind, OutputSurface::Mcp, label, msg, wasted, is_disabled);
    }
}

fn parse_manifest_arg(
    args: &BTreeMap<String, JsonValue>,
    key: &str,
    auto_create: bool,
    default_file: Option<&Path>,
    cwd: &Path,
) -> Result<Option<String>, RpcErr> {
    let Some(val) = args.get(key) else { return Ok(None) };
    if matches!(val, JsonValue::Null) {
        return Ok(None);
    }
    let mut parsed = match val {
        JsonValue::Array(_) | JsonValue::Object(_) => val.clone(),
        JsonValue::String(s) => {
            let t = s.trim_start_matches('\u{FEFF}').trim();
            if t.starts_with('[') || t.starts_with('{') {
                parse_json(t).map_err(|e| (-32602, format!("Invalid JSON in '{key}': {e}")))?
            } else if key == "batch" {
                return Ok(Some(s.clone()));
            } else {
                return Err((-32602, format!("Expected array or JSON array string for '{key}'")));
            }
        }
        _ => return Err((-32602, format!("Expected array for '{key}'"))),
    };

    validate_and_normalize_manifest(&mut parsed, auto_create, default_file, cwd)?;
    Ok(Some(parsed.to_compact_string()))
}

fn validate_and_normalize_manifest(
    val: &mut JsonValue,
    auto_create: bool,
    default_file: Option<&Path>,
    cwd: &Path,
) -> Result<(), RpcErr> {
    let items: &mut Vec<JsonValue> = match val {
        JsonValue::Array(arr) => arr,
        JsonValue::Object(map) => ["edits", "batch", "files", "items"]
            .iter()
            .find_map(|k| if map.contains_key(*k) { Some(*k) } else { None })
            .and_then(|k| map.get_mut(k).and_then(JsonValue::as_array_mut))
            .ok_or_else(|| (-32602, NULL_ITEM_ERR.to_string()))?,
        _ => return Err((-32602, NULL_ITEM_ERR.to_string())),
    };

    for entry in items.iter_mut() {
        let Some(obj) = entry.as_object_mut() else {
            return Err((-32602, NULL_ITEM_ERR.to_string()));
        };
        if let Some(nested) = obj.get("edits") && !matches!(nested, JsonValue::Null) {
            let Some(arr) = nested.as_array() else {
                return Err((-32602, NULL_ITEM_ERR.to_string()));
            };
            if arr.iter().any(|sub| !matches!(sub, JsonValue::Object(_))) {
                return Err((-32602, NULL_ITEM_ERR.to_string()));
            }
            continue;
        }
        if auto_create && should_auto_create(obj, default_file, cwd) {
            obj.insert("create".to_string(), JsonValue::Bool(true));
        }
    }
    Ok(())
}

fn should_auto_create(
    obj: &BTreeMap<String, JsonValue>,
    default_file: Option<&Path>,
    cwd: &Path,
) -> bool {
    let has_flag = ["create", "overwrite", "delete"]
        .iter()
        .any(|k| obj.get(*k).is_some_and(|v| !matches!(v, JsonValue::Null)));
    let has_sel = ["symbol", "selector", "range", "symbolSelector", "insertAfter", "insert_after", "insertBefore", "insert_before"]
        .iter()
        .any(|k| obj.get(*k).and_then(JsonValue::as_str).is_some_and(|s| !s.is_empty()));
    let has_payload = ["code", "aice", "newAiceCode", "template", "snippet", "content", "replacement", "body"]
        .iter()
        .any(|k| obj.get(*k).and_then(JsonValue::as_str).is_some());
    if has_flag || has_sel || !has_payload {
        return false;
    }
    let raw_p = ["filePath", "file", "path", "file_path", "target"]
        .iter()
        .find_map(|k| obj.get(*k).and_then(JsonValue::as_str));
    let target_buf: Option<PathBuf> = match raw_p {
        Some(p) => {
            let (fp, sel) = split_target_selector(p);
            (sel.is_none() && !fp.is_empty()).then(|| PathBuf::from(fp))
        }
        None => default_file.map(Path::to_path_buf),
    };
    target_buf.is_some_and(|p| !resolve_path(&p, cwd).exists())
}

fn has_hunk_block(payload: &str) -> bool {
    let mut stage = 0u8;
    for raw in payload.split('\n') {
        let t = raw.strip_suffix('\r').unwrap_or(raw).trim();
        let is_marker = |ch: u8| t.len() >= 3 && t.bytes().all(|b| b == ch);
        match stage {
            0 if is_marker(b'<') => stage = 1,
            1 if is_marker(b'=') => stage = 2,
            2 if is_marker(b'>') => return true,
            _ => {}
        }
    }
    false
}

fn resolve_path(p: &Path, cwd: &Path) -> PathBuf {
    if p.is_absolute() { p.to_path_buf() } else { cwd.join(p) }
}
