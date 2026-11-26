use std::path::Path;

use aice_governance::{
    JsonValue, OperationTargets, WriteOp, has_regex_selector_part, is_valid_selector_tail,
    parse_json, split_target_selector,
};

fn is_windows_drive_prefix(raw: &str) -> bool {
    let b = raw.as_bytes();
    b.len() >= 3
        && b[0].is_ascii_alphabetic()
        && b[1] == b':'
        && (b[2] == b'\\' || (b[2] == b'/' && b[0].is_ascii_uppercase()))
}

pub fn is_disallowed_write_selector(sel: &str) -> bool {
    if sel.is_empty() || has_regex_selector_part(sel) || !is_valid_selector_tail(sel) {
        return true;
    }
    sel.split(',').any(|part| part.trim().starts_with('/'))
}

pub fn validate_raw_write_target(raw: &str, cwd: &Path) -> Result<(), String> {
    if raw.is_empty() {
        return Err("empty splice target".to_string());
    }
    let (file, maybe_sel) = split_target_selector(raw);
    if let Some(sel) = maybe_sel {
        if file.is_empty() || is_disallowed_write_selector(sel) {
            return Err(format!(
                "regex selector '{sel}' is not supported for splice target '{raw}'"
            ));
        }
        return Ok(());
    }
    let offset = if is_windows_drive_prefix(raw) { 2 } else { 0 };
    let after_drive = &raw[offset..];
    if after_drive.contains([':', '#']) {
        let abs = if Path::new(raw).is_absolute() {
            Path::new(raw).to_path_buf()
        } else {
            cwd.join(raw)
        };
        if !abs.exists() {
            let tail = after_drive
                .rsplit_once([':', '#'])
                .map(|(_, t)| t)
                .unwrap_or(after_drive);
            return Err(format!(
                "invalid selector '{tail}' in splice target '{raw}'"
            ));
        }
    }
    Ok(())
}

fn validate_json_manifest_selectors(payload: &str) -> Result<(), String> {
    let trimmed = payload.trim_start_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}');
    if !trimmed.starts_with('[') && !trimmed.starts_with('{') {
        return Ok(());
    }
    let Ok(val) = parse_json(trimmed) else {
        return Ok(());
    };
    check_json_selector_fields(&val)
}

fn check_json_selector_fields(val: &JsonValue) -> Result<(), String> {
    match val {
        JsonValue::Array(items) => {
            for item in items {
                check_json_selector_fields(item)?;
            }
        }
        JsonValue::Object(map) => {
            for key in [
                "symbol",
                "delete",
                "selector",
                "symbolSelector",
                "range",
                "cloneFrom",
                "clone_from",
                "insert_after",
                "insertAfter",
                "insert_before",
                "insertBefore",
            ] {
                if let Some(JsonValue::String(s)) = map.get(key)
                    && !s.is_empty()
                    && is_disallowed_write_selector(s)
                {
                    return Err(format!(
                        "regex or invalid selector '{s}' is not supported in splice manifest"
                    ));
                }
            }
            for v in map.values() {
                if matches!(v, JsonValue::Array(_) | JsonValue::Object(_)) {
                    check_json_selector_fields(v)?;
                }
            }
        }
        _ => {}
    }
    Ok(())
}

pub fn has_write_targets(op: &WriteOp) -> bool {
    op.path.is_some()
        || op.batch.is_some()
        || op.edits.is_some()
        || !op.target_paths.is_empty()
        || !op.raw_target_strings().is_empty()
}

pub fn validate_write_op_selectors(cwd: &Path, op: &WriteOp) -> Result<(), String> {
    if let Some(p) = &op.path {
        let raw = p
            .to_str()
            .ok_or_else(|| "non-UTF-8 splice target path".to_string())?;
        validate_raw_write_target(raw, cwd)?;
    }
    for p in &op.target_paths {
        let raw = p
            .to_str()
            .ok_or_else(|| "non-UTF-8 splice target path".to_string())?;
        validate_raw_write_target(raw, cwd)?;
    }
    if let Some(sym) = &op.symbol
        && is_disallowed_write_selector(sym)
    {
        return Err(format!("regex or invalid selector '{sym}' is not supported for splice"));
    }
    if let Some(del) = &op.delete
        && !del.is_empty()
        && is_disallowed_write_selector(del)
    {
        return Err(format!("regex or invalid selector '{del}' is not supported for splice --delete"));
    }
    if let Some(ins) = &op.insert_after
        && !ins.is_empty()
        && is_disallowed_write_selector(ins)
    {
        return Err(format!(
            "regex or invalid selector '{ins}' is not supported for splice --insert-after"
        ));
    }
    if let Some(ins) = &op.insert_before
        && !ins.is_empty()
        && is_disallowed_write_selector(ins)
    {
        return Err(format!(
            "regex or invalid selector '{ins}' is not supported for splice --insert-before"
        ));
    }
    for raw in op.raw_target_strings() {
        validate_raw_write_target(&raw, cwd)?;
    }
    for payload in op.json_manifest_payloads() {
        validate_json_manifest_selectors(payload)?;
    }
    if !has_write_targets(op) {
        return Err(
            "splice requires a target file, --batch, --edits, or heredoc --code targets"
                .to_string(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{has_write_targets, validate_write_op_selectors};
    use aice_governance::WriteOp;
    use std::path::Path;

    fn base_op() -> WriteOp {
        WriteOp {
            path: None, symbol: None, code: None, template: None, body: None,
            from_file: None, from_stdin: false, delete: None, insert_after: None,
            insert_before: None, edits: None, batch: None, create: false,
            overwrite: false, force: false, in_place: false, dry_run: false,
            diff: false, json: false, preserve_docs: true, target_paths: vec![],
        }
    }

    #[test]
    fn batch_and_edits_manifest_inputs_pass_has_write_targets_while_empty_op_fails() {
        let cwd = Path::new(".");
        assert!(!has_write_targets(&base_op()));
        assert!(validate_write_op_selectors(cwd, &base_op()).is_err());

        for (batch, edits) in [
            (Some("{bad"), None),
            (Some("[]"), None),
            (Some(""), None),
            (None, Some("{bad")),
            (None, Some("[]")),
            (None, Some("")),
        ] {
            let mut op = base_op();
            op.batch = batch.map(str::to_string);
            op.edits = edits.map(str::to_string);
            assert!(has_write_targets(&op));
            assert!(validate_write_op_selectors(cwd, &op).is_ok());
        }
    }
}
