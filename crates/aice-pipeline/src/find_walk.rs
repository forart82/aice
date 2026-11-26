use std::path::Path;

use aice_find_engine::{FindWalkOpts, WalkOutput, walk_governed_with_opts};
use aice_governance::path_guard::is_path_contained;
use aice_governance::{FindOp, Governed, OperationKind, OperationTargets};

use crate::state::PipelineError;

fn target_matches_authorized(target: &Path, governed: &Governed) -> bool {
    if target.as_os_str().is_empty() {
        return false;
    }
    let resolved = if target.is_absolute() {
        target.to_path_buf()
    } else {
        governed.cwd().join(target)
    };
    governed
        .authorized_paths()
        .iter()
        .any(|ap| ap.requested == resolved || ap.canonical == resolved)
}

pub(crate) fn walk_find_output(
    governed: &Governed,
    op: &FindOp,
) -> Result<WalkOutput, PipelineError> {
    if governed.op_kind() != OperationKind::Find {
        return Err(PipelineError::Execution(format!(
            "governance op_kind mismatch for find: {:?}",
            governed.op_kind()
        )));
    }
    let expected = op.target_paths();
    let authorized = governed.authorized_paths();
    if authorized.len() != expected.len() {
        return Err(PipelineError::Execution(format!(
            "governance target mismatch: {} authorized vs {} requested",
            authorized.len(),
            expected.len()
        )));
    }
    for target in &expected {
        if target.as_os_str().is_empty() || !target_matches_authorized(target, governed) {
            return Err(PipelineError::Execution(format!(
                "governance rejected unauthorized find target: {}",
                target.display()
            )));
        }
    }

    let project_root = governed.project_root();
    let allowed_roots = &governed.config().allowed_read_roots;
    for ap in authorized {
        if !is_path_contained(&ap.requested, project_root, allowed_roots)
            || !is_path_contained(&ap.canonical, project_root, allowed_roots)
        {
            return Err(PipelineError::Execution(format!(
                "Path outside allowed project roots: {}",
                ap.requested.display()
            )));
        }
    }

    let query = op.pattern.clone().or_else(|| op.search.clone());
    let opts = FindWalkOpts {
        max_depth: op.depth,
        include_hidden: op.full,
        skip_lockfiles: true,
        include_binary: false,
        probe_binary: true,
        measure_lines: true,
        query,
        explicit_targets: op.targets.clone(),
        walk_project_root_if_untargeted: op.targets.is_empty() && op.target_paths.is_empty(),
    };
    walk_governed_with_opts(governed, &opts).map_err(|e| PipelineError::Execution(e.to_string()))
}
