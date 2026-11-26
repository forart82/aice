pub mod aice_project;
pub(crate) mod aice_project_domain;
pub mod aice_project_util;
pub mod budget;
pub mod budget_fill;
pub(crate) mod budget_fill_cand;
pub mod coalesce;
pub mod discovery;
pub mod discovery_format;
pub mod gitignore;
pub mod glob;
pub(crate) mod glob_expand;
pub mod intra_transpile;
pub(crate) mod intra_wrap;
pub mod matcher;
pub mod regex_compile;
pub mod regex_mini;
pub mod regex_parse;
pub mod render_json;
pub mod render_selector;
pub mod render_single;
pub mod renderer;
pub mod search;
pub mod search_aice;
pub mod search_json;
pub mod search_rank;
pub mod selector;
pub mod topo_order;
pub mod transpile;
pub mod transpile_helpers;

use std::path::{Path, PathBuf};

use aice_governance::{AuthorizedPath, Governed, OperationKind, OperationTargets, ReadOp};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BatchReadPack {
    pub raw_baseline: String,
    pub emitted_output: String,
    pub file_label: String,
    pub stderr_output: String,
    pub exit_code: i32,
    pub realistic_native_payload: Option<String>,
    pub multi_files: Vec<String>,
    pub language: Option<String>,
    pub is_search_mode: bool,
    pub is_files_mode: bool,
    pub has_expanded_context: bool,
    pub preserved_trivia_tokens: usize,
    pub wasted_input_tokens: Option<usize>,
}

pub(crate) fn verify_authorized_targets(
    governed: &Governed,
    expected_kind: OperationKind,
    expected: &[PathBuf],
    has_raw_targets: bool,
) -> Result<(), String> {
    if governed.op_kind() != expected_kind {
        return Err(format!(
            "governance op_kind mismatch: expected {:?}, got {:?}",
            expected_kind,
            governed.op_kind()
        ));
    }
    let authorized = governed.authorized_paths();
    if has_raw_targets && authorized.is_empty() {
        return Err(
            "governance rejected operation: targets present with empty authorized_paths"
                .to_string(),
        );
    }
    if authorized.len() != expected.len() {
        return Err(format!(
            "governance target mismatch: {} authorized vs {} requested",
            authorized.len(),
            expected.len()
        ));
    }
    for target in expected {
        if target.as_os_str().is_empty() {
            return Err("governance rejected empty target path".to_string());
        }
        if !target_matches_authorized(target, authorized, governed.cwd()) {
            return Err(format!(
                "governance rejected unauthorized target: {}",
                target.display()
            ));
        }
    }
    Ok(())
}

fn target_matches_authorized(
    target: &Path,
    authorized: &[AuthorizedPath],
    cwd: &Path,
) -> bool {
    if target.as_os_str().is_empty() {
        return false;
    }
    let resolved = if target.is_absolute() {
        target.to_path_buf()
    } else {
        cwd.join(target)
    };
    authorized
        .iter()
        .any(|ap| ap.requested == resolved || ap.canonical == resolved)
}

/// Wave 1+ contract: takes `&Governed` (never `&AdminGoverned`).
/// Resolves all read targets strictly from `governed.authorized_paths()`.
pub fn execute_batch_read(governed: &Governed, op: &ReadOp) -> Result<BatchReadPack, String> {
    let expected = op.target_paths();
    let has_raw = !op.targets.is_empty() || !op.target_paths.is_empty();
    verify_authorized_targets(governed, OperationKind::Read, &expected, has_raw)?;

    if op.files_only {
        return discovery::execute_files_only(governed, op);
    }
    if op.search.is_some() {
        return search::execute_read_search(governed, op);
    }

    let specs: Vec<_> = op
        .targets
        .iter()
        .map(|t| selector::parse_target_spec(t))
        .collect();
    let label = if let Some(first) = governed.authorized_paths().first() {
        first.requested.display().to_string()
    } else if specs.is_empty() {
        governed.project_root().display().to_string()
    } else {
        specs[0].file_path.clone()
    };
    Ok(renderer::render_pack(governed, &specs, op, label))
}

#[cfg(test)]
mod tests {
    use super::{ReadOp, execute_batch_read, search};
    use aice_governance::{FindOp, OutputSurface, PipelineRequest, SearchOp, authorize};

    fn read_with(targets: Vec<&str>) -> ReadOp {
        ReadOp {
            targets: targets.into_iter().map(String::from).collect(),
            target_paths: vec![],
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
        }
    }

    fn search_with(targets: Vec<&str>) -> SearchOp {
        SearchOp {
            pattern: "foo".into(),
            targets: targets.into_iter().map(String::from).collect(),
            target_paths: vec![],
            context_lines: None,
            line_numbers: false,
            symbol: None,
            files_with_matches: false,
            full: false,
            max_tokens: None,
            json: false,
            stats: false,
        }
    }

    #[test]
    fn rejects_mismatched_or_empty_authorized_paths() {
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let gov = authorize(PipelineRequest::new(search_with(vec![]), dir, OutputSurface::Cli))
            .expect("empty search authorized");

        assert!(execute_batch_read(gov.state(), &read_with(vec!["/etc/shadow"])).is_err());
        assert!(search::execute_search(gov.state(), &search_with(vec!["/etc/shadow"])).is_err());
    }

    #[test]
    fn rejects_cross_op_suffix_and_empty_targets() {
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
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
        assert!(execute_batch_read(find_gov.state(), &read_with(vec!["src/lib.rs"])).is_err());
        assert!(search::execute_search(find_gov.state(), &search_with(vec!["src/lib.rs"])).is_err());

        let read_gov = authorize(PipelineRequest::new(
            read_with(vec!["src/lib.rs"]),
            dir.clone(),
            OutputSurface::Cli,
        ))
        .expect("read authorized");
        assert!(execute_batch_read(read_gov.state(), &read_with(vec!["lib.rs"])).is_err());
        assert!(execute_batch_read(read_gov.state(), &read_with(vec![""])).is_err());

        let search_gov = authorize(PipelineRequest::new(
            search_with(vec!["src/lib.rs"]),
            dir,
            OutputSurface::Cli,
        ))
        .expect("search authorized");
        assert!(search::execute_search(search_gov.state(), &search_with(vec!["lib.rs"])).is_err());
        assert!(search::execute_search(search_gov.state(), &search_with(vec![""])).is_err());
    }
}
