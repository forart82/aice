use aice_governance::heredoc_targets::starts_with_heredoc_header_for;
use aice_governance::{WriteOp, has_regex_selector_part, is_valid_selector_tail};

use crate::json_manifest::{parse_batch_json, parse_edits_json};
use crate::stream_parse::parse_heredoc_stream;
pub use crate::types::BatchSpliceItem;

pub fn is_literal_divider(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.len() >= 7 && trimmed.bytes().all(|b| b == b'=')
}

pub fn validate_selector(sel: &str) -> Result<(), String> {
    if sel.is_empty()
        || has_regex_selector_part(sel)
        || !is_valid_selector_tail(sel)
        || sel.split(',').any(|p| p.trim().starts_with('/'))
    {
        return Err(format!("regex or invalid selector '{sel}' is not supported for splice"));
    }
    Ok(())
}

pub fn parse_manifest(op: &WriteOp) -> Result<Vec<BatchSpliceItem>, String> {
    if let Some(raw) = &op.batch {
        let trimmed = raw.trim_start_matches('\u{FEFF}').trim();
        if trimmed.is_empty() {
            return Err("Empty --batch payload".into());
        }
        if trimmed.starts_with('[') || trimmed.starts_with('{') {
            return parse_batch_json(trimmed, op);
        }
        return parse_heredoc_stream(raw, op);
    }
    if let Some(raw) = &op.edits {
        return parse_edits_json(raw, op);
    }
    if let Some(raw) = &op.code
        && op.symbol.is_none()
        && (op.path.is_none() || starts_with_heredoc_header_for(raw, op.path.as_deref()))
    {
        return parse_heredoc_stream(raw, op);
    }

    let path = op
        .path
        .as_ref()
        .ok_or_else(|| "splice requires a target file, --batch, --edits, or heredoc stream".to_string())?;
    let payload = op
        .code
        .clone()
        .or_else(|| op.body.clone())
        .or_else(|| op.template.clone())
        .unwrap_or_default();

    if let (Some(sym), Some(del)) = (&op.symbol, &op.delete)
        && !del.is_empty()
        && sym != del
    {
        return Ok(vec![
            make_single_item(path, Some(sym.clone()), payload, false, op),
            make_single_item(path, Some(del.clone()), String::new(), true, op),
        ]);
    }

    Ok(vec![make_single_item(
        path,
        op.symbol.clone(),
        payload,
        op.delete.is_some(),
        op,
    )])
}

fn make_single_item(
    path: &std::path::Path,
    symbol: Option<String>,
    payload: String,
    delete: bool,
    op: &WriteOp,
) -> BatchSpliceItem {
    let explicit_overwrite = symbol
        .as_deref()
        .is_some_and(|s| matches!(s.trim().to_ascii_lowercase().as_str(), "overwrite" | ":overwrite" | "*"));
    BatchSpliceItem {
        requested_display: path.display().to_string(),
        file_path: path.to_path_buf(),
        symbol,
        payload,
        force_aice_ir: false,
        delete,
        insert_after: op.insert_after.clone(),
        insert_before: op.insert_before.clone(),
        clone_from: None,
        create: op.create,
        explicit_create_flag: op.create,
        overwrite: op.overwrite || explicit_overwrite,
        force: op.force,
        preserve_docs: op.preserve_docs,
    }
}
