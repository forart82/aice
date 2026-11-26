use std::collections::BTreeMap;
use std::path::PathBuf;

use aice_governance::{JsonValue, WriteOp, parse_json, split_target_selector};

use crate::manifest::validate_selector;
use crate::types::BatchSpliceItem;

fn str_field(map: &BTreeMap<String, JsonValue>, keys: &[&str]) -> Result<Option<String>, String> {
    for &k in keys {
        if let Some(v) = map.get(k) {
            return match v {
                JsonValue::String(s) => Ok(Some(s.clone())),
                JsonValue::Null => Ok(None),
                _ => Err(format!("Expected string for field '{k}' in splice JSON manifest")),
            };
        }
    }
    Ok(None)
}

fn bool_field(map: &BTreeMap<String, JsonValue>, keys: &[&str]) -> Result<Option<bool>, String> {
    for &k in keys {
        if let Some(v) = map.get(k) {
            return match v {
                JsonValue::Bool(b) => Ok(Some(*b)),
                JsonValue::Null => Ok(None),
                _ => Err(format!("Expected boolean for field '{k}' in splice JSON manifest")),
            };
        }
    }
    Ok(None)
}

fn payload_field(map: &BTreeMap<String, JsonValue>) -> Result<(Option<String>, bool), String> {
    for k in ["code", "aice", "newAiceCode", "template", "snippet", "content", "replacement", "body"] {
        if let Some(v) = map.get(k) {
            return match v {
                JsonValue::String(s) => Ok((Some(s.clone()), false)),
                JsonValue::Null => continue,
                _ => Err(format!("Expected string for payload field '{k}'")),
            };
        }
    }
    Ok((None, false))
}

fn parse_edit_obj(
    map: &BTreeMap<String, JsonValue>,
    default_file: Option<&PathBuf>,
    op: &WriteOp,
    require_target_sel: bool,
) -> Result<BatchSpliceItem, String> {
    let raw_path = str_field(map, &["filePath", "file", "path", "file_path", "target"])?;
    let (file_path, inline_sel) = match raw_path {
        Some(ref p) => {
            let (fp, sel) = split_target_selector(p);
            if fp.is_empty() {
                return Err("Empty filePath in JSON splice manifest".into());
            }
            (PathBuf::from(fp), sel.map(str::to_string))
        }
        None => {
            let fp = default_file
                .cloned()
                .ok_or_else(|| "Missing 'filePath'/'path' in --batch JSON item".to_string())?;
            (fp, None)
        }
    };
    let mut symbol = str_field(map, &["symbol", "selector", "range", "symbolSelector"])?.or(inline_sel);
    let (delete, del_sel) = match map.get("delete") {
        Some(JsonValue::Bool(b)) => (*b, None),
        Some(JsonValue::String(s)) if !s.is_empty() => (true, Some(s.clone())),
        Some(JsonValue::Null) | None => (false, None),
        _ => return Err("Expected boolean or selector string for 'delete'".into()),
    };
    if symbol.is_none() {
        symbol = del_sel;
    }
    let insert_after = str_field(map, &["insertAfter", "insert_after"])?;
    let insert_before = str_field(map, &["insertBefore", "insert_before"])?;
    let clone_from = str_field(map, &["cloneFrom", "clone_from"])?;
    for sel in [&symbol, &insert_after, &insert_before, &clone_from].into_iter().flatten() {
        if !sel.is_empty() {
            validate_selector(sel)?;
        }
    }
    let (payload_opt, force_aice_ir) = payload_field(map)?;
    let payload = payload_opt.unwrap_or_default();
    if require_target_sel
        && symbol.is_none()
        && insert_after.is_none()
        && insert_before.is_none()
        && !crate::hunk::has_hunk_markers(&payload)
    {
        return Err("Each --edits JSON item must specify 'symbol', 'insertAfter', 'insertBefore', or a hunk".into());
    }
    let create = bool_field(map, &["create"])?.unwrap_or(op.create);
    let overwrite = bool_field(map, &["overwrite"])?.unwrap_or(op.overwrite);
    let force = bool_field(map, &["force"])?.unwrap_or(op.force);
    let preserve_docs = bool_field(map, &["preserveDocs", "preserve_docs"])?.unwrap_or(op.preserve_docs);
    Ok(BatchSpliceItem {
        requested_display: file_path.display().to_string(),
        file_path,
        symbol,
        payload,
        force_aice_ir,
        delete,
        insert_after,
        insert_before,
        clone_from,
        create,
        explicit_create_flag: create,
        overwrite,
        force,
        preserve_docs,
    })
}

pub fn parse_edits_json(raw: &str, op: &WriteOp) -> Result<Vec<BatchSpliceItem>, String> {
    let val = parse_json(raw.trim_start_matches('\u{FEFF}').trim())
        .map_err(|e| format!("Invalid --edits JSON: {e}"))?;
    let (arr, top_file) = match &val {
        JsonValue::Array(a) => (a, None),
        JsonValue::Object(m) => {
            let fp = str_field(m, &["filePath", "file", "path", "file_path", "target"])?
                .map(|p| PathBuf::from(split_target_selector(&p).0));
            match m.get("edits") {
                Some(JsonValue::Array(a)) => (a, fp),
                _ => return Err("--edits JSON must be an array or {\"edits\": [...]}".into()),
            }
        }
        _ => return Err("--edits JSON must be an array of edit objects".into()),
    };
    if arr.is_empty() {
        return Err("--edits JSON array must not be empty".into());
    }
    let default_fp = top_file.as_ref().or(op.path.as_ref());
    let mut out = Vec::with_capacity(arr.len());
    for entry in arr {
        let map = entry
            .as_object()
            .ok_or_else(|| "Invalid element in --edits JSON: expected object".to_string())?;
        if let Some(JsonValue::Array(nested_edits)) = map.get("edits") {
            let fp = str_field(map, &["filePath", "file", "path", "file_path", "target"])?
                .map(|p| PathBuf::from(split_target_selector(&p).0));
            for sub in nested_edits {
                let sub_map = sub.as_object().ok_or_else(|| "Invalid nested edit in --edits JSON".to_string())?;
                out.push(parse_edit_obj(sub_map, fp.as_ref().or(default_fp), op, true)?);
            }
        } else {
            out.push(parse_edit_obj(map, default_fp, op, true)?);
        }
    }
    if out.is_empty() {
        return Err("--edits JSON array must not be empty".into());
    }
    Ok(out)
}

pub fn parse_batch_json(raw: &str, op: &WriteOp) -> Result<Vec<BatchSpliceItem>, String> {
    let val = parse_json(raw.trim_start_matches('\u{FEFF}').trim())
        .map_err(|e| format!("Invalid --batch JSON: {e}"))?;
    let arr = match &val {
        JsonValue::Array(a) => a,
        JsonValue::Object(m) => ["batch", "files", "items"]
            .iter()
            .find_map(|k| m.get(*k).and_then(JsonValue::as_array))
            .ok_or_else(|| "--batch JSON must be an array or {\"batch\"|\"files\"|\"items\": [...]}".to_string())?,
        _ => return Err("--batch JSON must be an array of target objects".into()),
    };
    if arr.is_empty() {
        return Err("--batch JSON array must not be empty".into());
    }
    let mut out = Vec::with_capacity(arr.len());
    for entry in arr {
        let map = entry
            .as_object()
            .ok_or_else(|| "Invalid element in --batch JSON: expected object".to_string())?;
        if let Some(JsonValue::Array(nested_edits)) = map.get("edits") {
            let fp = str_field(map, &["filePath", "file", "path", "file_path", "target"])?
                .map(|p| PathBuf::from(split_target_selector(&p).0));
            for sub in nested_edits {
                let sub_map = sub.as_object().ok_or_else(|| "Invalid nested edit in --batch JSON".to_string())?;
                out.push(parse_edit_obj(sub_map, fp.as_ref().or(op.path.as_ref()), op, true)?);
            }
        } else {
            out.push(parse_edit_obj(map, op.path.as_ref(), op, false)?);
        }
    }
    if out.is_empty() {
        return Err("--batch JSON array must not be empty".into());
    }
    Ok(out)
}
