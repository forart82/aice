pub mod aice_lower;
mod aice_unwrap;
mod aice_unwrap_cls;
pub mod ast_select;
pub mod ast_splice;
pub mod diagnostics;
pub mod diff;
pub mod hunk;
pub mod hunk_match;
pub mod json_manifest;
pub mod line_splice;
pub mod manifest;
mod py_walrus;
mod py_walrus_cst;
mod py_walrus_diff;
mod py_walrus_isolate;
pub mod span_patch;
pub mod stream_header;
pub mod stream_parse;
pub mod ts_fallback;
pub mod tx_commit;
pub mod tx_order;
pub mod tx_rollback;
pub mod types;

use aice_governance::{Governed, OperationKind, OperationTargets, WriteOp};

pub use diff::format_splice_json;
pub use tx_commit::TOKENS_SAVED_PLACEHOLDER;
pub use types::{BatchWriteReport, JsonBatchEdit, JsonSpliceInfo};

/// Wave 1+ contract: takes `&Governed` (never `&AdminGoverned`).
/// Resolves and commits write targets strictly via `governed.authorized_paths()`.
pub fn execute_batch_write(governed: &Governed, op: &WriteOp) -> Result<BatchWriteReport, String> {
    let label = op
        .path
        .as_ref()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "<batch-splice>".to_string());
    if governed.op_kind() != OperationKind::Write {
        return Err(format!(
            "governance op_kind mismatch for {label}: expected Write, got {:?}",
            governed.op_kind()
        ));
    }
    let expected = op.target_paths();
    let has_raw = op.path.is_some()
        || op.from_file.is_some()
        || !op.target_paths.is_empty()
        || !expected.is_empty();
    let authorized = governed.authorized_paths();
    if has_raw && authorized.is_empty() {
        return Err(format!(
            "governance rejected write targets for {label}: empty authorized_paths"
        ));
    }
    if authorized.len() != expected.len() {
        return Err(format!(
            "governance target mismatch for {label}: {} authorized vs {} requested",
            authorized.len(),
            expected.len()
        ));
    }
    for target in &expected {
        if target.as_os_str().is_empty() {
            return Err(format!("governance rejected empty write target for {label}"));
        }
        let resolved = if target.is_absolute() {
            target.to_path_buf()
        } else {
            governed.cwd().join(target)
        };
        let matched = authorized
            .iter()
            .any(|ap| ap.requested == resolved || ap.canonical == resolved);
        if !matched {
            return Err(format!(
                "governance rejected unauthorized write target: {}",
                target.display()
            ));
        }
    }
    if authorized.iter().any(|p| p.is_binary) {
        return Err(format!("governance rejected binary write targets for {label}"));
    }
    let items = match manifest::parse_manifest(op) {
        Ok(items) => items,
        Err(msg) => {
            return Ok(BatchWriteReport {
                raw_baseline: String::new(),
                emitted_output: msg,
                file_label: label,
                exit_code: 1,
                multi_files: Vec::new(),
                primary_lang: None,
                realistic_native_payload: None,
                preserved_trivia_text: String::new(),
                is_batch_rollback: op.batch.is_some()
                    || op.edits.is_some()
                    || op.raw_target_strings().len() > 1,
                banner_needs_tokens: false,
                json_info: None,
            });
        }
    };
    Ok(tx_commit::run_transaction(governed, op, &items, label))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{WriteOp, execute_batch_write};
    use aice_governance::{FindOp, OutputSurface, PipelineRequest, SearchOp, authorize};

    fn base_write_op() -> WriteOp {
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
            dry_run: true,
            diff: false,
            json: false,
            preserve_docs: true,
            target_paths: vec![],
        }
    }

    #[test]
    fn rejects_empty_authorized_paths_when_path_or_batch_present() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let empty_search = SearchOp {
            pattern: "foo".into(),
            targets: vec![],
            target_paths: vec![],
            context_lines: None,
            line_numbers: false,
            symbol: None,
            files_with_matches: false,
            full: false,
            max_tokens: None,
            json: false,
            stats: false,
        };
        let gov = authorize(PipelineRequest::new(empty_search, dir, OutputSurface::Cli))
            .expect("empty search authorized");

        let mut with_path = base_write_op();
        with_path.path = Some(PathBuf::from("/etc/shadow"));
        assert!(execute_batch_write(gov.state(), &with_path).is_err());

        let mut with_batch = base_write_op();
        with_batch.batch = Some("[]".into());
        assert!(execute_batch_write(gov.state(), &with_batch).is_err());
    }

    #[test]
    fn rejects_cross_op_governed_and_suffix_laundering() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let find_op = FindOp {
            pattern: None,
            targets: vec!["src/lib.rs".into()],
            target_paths: vec![],
            depth: None,
            search: None,
            full: false,
            max_tokens: None,
            json: false,
        };
        let find_gov = authorize(PipelineRequest::new(find_op, dir.clone(), OutputSurface::Cli))
            .expect("find authorized");
        let mut same_target_write = base_write_op();
        same_target_write.path = Some(PathBuf::from("src/lib.rs"));
        assert!(execute_batch_write(find_gov.state(), &same_target_write).is_err());

        let mut sub_write = base_write_op();
        sub_write.path = Some(PathBuf::from("src/lib.rs"));
        let write_gov = authorize(PipelineRequest::new(sub_write, dir, OutputSurface::Cli))
            .expect("write authorized");
        let mut suffix_write = base_write_op();
        suffix_write.path = Some(PathBuf::from("lib.rs"));
        assert!(execute_batch_write(write_gov.state(), &suffix_write).is_err());
    }
}
