use std::collections::BTreeMap;
use std::path::Path;

use aice_governance::{
    GovernanceError, JsonValue, OutputSurface, PipelineRequest, ReadOp, SearchOp, authorize,
    parse_json,
};
use aice_pipeline::{
    DefaultPipelineExecutor, PipelineExecutor, StdoutWriter, meter_and_seal, record_failure_for_cli,
};
use aice_telemetry::TelemetryOpKind;

use crate::mcp_args::{RpcErr, opt_bool, opt_str, opt_usize, split_read_target_string};

pub fn handle_read(
    args: &BTreeMap<String, JsonValue>,
    id: &JsonValue,
    cwd: &Path,
    framed: bool,
) -> Result<(), RpcErr> {
    let (mut targets, full_override) = collect_read_targets(args, cwd)?;
    let symbol = opt_str(args, &["symbol", "selector", "sym", "range"])?;
    let search = opt_str(args, &["search"])?;
    let files_only = opt_bool(args, &["filesOnly", "files_only"])?.unwrap_or(false);
    let files_with_matches =
        opt_bool(args, &["filesWithMatches", "files_with_matches"])?.unwrap_or(false);
    let context_lines = opt_usize(args, &["contextLines", "context_lines", "context"])?;
    let outline = opt_bool(args, &["outline"])?.unwrap_or(false);
    let outline_target = opt_bool(args, &["outlineTarget", "outline_target"])?.unwrap_or(false);
    let full = opt_bool(args, &["full"])?.unwrap_or(false) || full_override;
    let depth = opt_usize(args, &["depth"])?;
    let max_tokens = opt_usize(args, &["maxTokens", "max_tokens"])?;
    let compact = opt_bool(args, &["compact"])?.unwrap_or(true);
    let include_types =
        opt_bool(args, &["types", "includeTypes", "include_types"])?.unwrap_or(true);
    let include_deps = opt_bool(args, &["includeDeps", "include_deps", "deps"])?
        .unwrap_or_else(|| !outline && !outline_target && depth.is_some_and(|d| d > 0));
    let include_callers =
        opt_bool(args, &["includeCallers", "include_callers", "callers"])?.unwrap_or(false);
    let stats = opt_bool(args, &["stats"])?.unwrap_or(false);
    let json = opt_bool(args, &["json"])?.unwrap_or(false);

    if targets.is_empty() && !files_only && search.is_none() {
        targets.push(".".to_string());
    }

    if files_with_matches && let Some(pattern) = search {
        let label = targets.first().cloned().unwrap_or_else(|| "<directory>".to_string());
        let op = SearchOp {
            pattern,
            targets,
            target_paths: Vec::new(),
            context_lines,
            line_numbers: true,
            symbol,
            files_with_matches: true,
            full,
            max_tokens,
            json,
            stats,
        };
        let req = PipelineRequest::new(op, cwd.to_path_buf(), OutputSurface::Mcp);
        match authorize(req) {
            Ok(gov) => match DefaultPipelineExecutor.execute_search(gov) {
                Ok(res) => {
                    let _ = StdoutWriter::emit_mcp_tool_result(meter_and_seal(res), id, framed);
                }
                Err(e) => emit_read_err(
                    cwd, TelemetryOpKind::Context, &label, &e.to_string(), false, id, framed,
                ),
            },
            Err(e) => emit_read_err(
                cwd,
                TelemetryOpKind::Context,
                &label,
                &e.to_string(),
                matches!(e, GovernanceError::Disabled),
                id,
                framed,
            ),
        }
        return Ok(());
    }

    let mut op = ReadOp {
        targets,
        target_paths: Vec::new(),
        outline,
        outline_target,
        full,
        depth,
        symbol,
        search,
        context_lines,
        files_only,
        compact,
        include_types,
        include_deps,
        include_callers,
        max_tokens,
        json,
        stats,
    };
    if op.files_only && op.search.is_none() {
        extract_files_only_filter(&mut op, cwd);
    }
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
    let label = op.targets.first().cloned().unwrap_or_else(|| "<read>".to_string());
    let req = PipelineRequest::new(op, cwd.to_path_buf(), OutputSurface::Mcp);
    match authorize(req) {
        Ok(gov) => match DefaultPipelineExecutor.execute_read(gov) {
            Ok(res) => {
                let _ = StdoutWriter::emit_mcp_tool_result(meter_and_seal(res), id, framed);
            }
            Err(e) => emit_read_err(cwd, op_kind, &label, &e.to_string(), false, id, framed),
        },
        Err(e) => emit_read_err(
            cwd,
            op_kind,
            &label,
            &e.to_string(),
            matches!(e, GovernanceError::Disabled),
            id,
            framed,
        ),
    }
    Ok(())
}

fn emit_read_err(
    cwd: &Path,
    op_kind: TelemetryOpKind,
    label: &str,
    msg: &str,
    is_disabled: bool,
    id: &JsonValue,
    framed: bool,
) {
    StdoutWriter::emit_mcp_tool_error(id, msg, framed);
    record_failure_for_cli(cwd, op_kind, OutputSurface::Mcp, label, msg, None, is_disabled);
}

fn collect_read_targets(
    args: &BTreeMap<String, JsonValue>,
    cwd: &Path,
) -> Result<(Vec<String>, bool), RpcErr> {
    let mut out = Vec::new();
    let mut full_override = false;

    for key in ["targets", "paths", "files", "filesOrDirs"] {
        let Some(val) = args.get(key) else { continue };
        if matches!(val, JsonValue::Null) {
            continue;
        }
        let owned_arr;
        let items: &[JsonValue] = match val {
            JsonValue::Array(arr) => arr.as_slice(),
            JsonValue::String(s) => {
                let trimmed = s.trim_start_matches('\u{FEFF}').trim();
                if trimmed.starts_with('[') {
                    owned_arr = parse_json(trimmed)
                        .ok()
                        .and_then(|v| v.as_array().map(|a| a.to_vec()))
                        .ok_or_else(|| (-32602, format!("Invalid JSON array in '{key}'")))?;
                    &owned_arr
                } else {
                    out.extend(split_read_target_string(s, cwd));
                    continue;
                }
            }
            _ => return Err((-32602, format!("Invalid type for '{key}': expected array or string"))),
        };
        for item in items {
            match item {
                JsonValue::String(s) => out.extend(split_read_target_string(s, cwd)),
                JsonValue::Object(obj) => {
                    let p = opt_str(obj, &["path", "filePath", "target", "file"])?
                        .filter(|s| !s.trim().is_empty())
                        .ok_or_else(|| (-32602, format!("Target object in '{key}' must specify 'path'")))?;
                    if opt_bool(obj, &["full"])? == Some(true) {
                        full_override = true;
                    }
                    if let Some(sym) = opt_str(obj, &["symbol", "selector"])?.filter(|s| !s.trim().is_empty()) {
                        out.push(format!("{p}:{sym}"));
                    } else if opt_bool(obj, &["outline"])? == Some(true) {
                        out.push(format!("{p}:outline"));
                    } else {
                        out.push(p);
                    }
                }
                _ => {
                    return Err((-32602, format!("Invalid null or non-string/object element in '{key}'")));
                }
            }
        }
    }

    if let Some(scalar) = opt_str(
        args,
        &["path", "filePath", "fileOrDir", "file", "dir", "target", "inputPath", "source"],
    )? {
        out.extend(split_read_target_string(&scalar, cwd));
    }
    Ok((out, full_override))
}

fn extract_files_only_filter(op: &mut ReadOp, cwd: &Path) {
    if !op.files_only || op.search.is_some() || op.targets.len() != 1 {
        return;
    }
    let raw = op.targets[0].clone();
    if raw.contains("..") || Path::new(&raw).is_absolute() || cwd.join(&raw).exists() {
        return;
    }
    if !raw.contains('/') && !raw.contains('\\') {
        op.targets.clear();
        op.search = Some(raw);
    } else if raw.contains('*') || raw.contains('?') || raw.contains('[') {
        let norm = raw.replace('\\', "/");
        let parts: Vec<&str> = norm
            .split('/')
            .take_while(|s| !s.contains('*') && !s.contains('?') && !s.contains('['))
            .collect();
        let prefix = if parts.is_empty() { ".".to_string() } else { parts.join("/") };
        if cwd.join(&prefix).is_dir() {
            op.targets.clear();
            if prefix != "." {
                op.targets.push(prefix);
            }
            op.search = Some(raw);
        }
    }
}
