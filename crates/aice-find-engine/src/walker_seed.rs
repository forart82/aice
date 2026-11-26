use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

use aice_governance::Governed;
use aice_governance::path_guard::{is_blocked_system_path, is_path_contained};

use crate::ignore_paths::has_git_component;
use crate::ignore_rules::IgnorePolicy;
use crate::walker::{FindWalkOpts, WalkedFile};
use crate::walker_pool::{DirTask, WalkContext};
use crate::walker_probe::inspect_file;

pub(crate) fn is_canon_contained(canon: &Path, ctx: &WalkContext<'_>) -> bool {
    if is_blocked_system_path(canon) {
        return false;
    }
    if ctx.root_canon.as_ref().is_some_and(|rc| canon.starts_with(rc)) {
        return true;
    }
    ctx.allowed_canons.iter().any(|ac| canon.starts_with(ac))
}

pub(crate) fn dedup_and_check_overlap(tasks: &mut Vec<DirTask>) -> bool {
    if tasks.len() > 1 {
        let mut seen = HashSet::with_capacity(tasks.len());
        tasks.retain(|t| seen.insert(t.canon_dir.clone()));
    }
    tasks.len() > 1
        && (0..tasks.len()).any(|i| {
            (0..tasks.len())
                .any(|j| i != j && tasks[i].canon_dir.starts_with(&tasks[j].canon_dir))
        })
}

pub(crate) fn seed_roots(
    governed: &Governed,
    opts: &FindWalkOpts,
    ignore: &IgnorePolicy,
    root_canon: Option<&Path>,
    allowed_roots: &[PathBuf],
) -> (Vec<WalkedFile>, Vec<DirTask>) {
    let project_root = governed.project_root();
    let authorized = governed.authorized_paths();

    let all_implicit_dot = authorized.iter().all(|ap| {
        ap.requested == governed.cwd().join(".")
            || root_canon.is_some_and(|rc| ap.canonical == rc)
    });

    if opts.walk_project_root_if_untargeted
        && (authorized.is_empty() || (opts.explicit_targets.is_empty() && all_implicit_dot))
    {
        if is_path_contained(project_root, project_root, allowed_roots)
            && !has_git_component(project_root)
            && root_canon.is_none_or(|rc| !has_git_component(rc))
            && std::fs::read_link(project_root).is_err()
        {
            let canon_dir = root_canon
                .map(Path::to_path_buf)
                .unwrap_or_else(|| project_root.to_path_buf());
            return (
                Vec::new(),
                vec![DirTask {
                    dir: project_root.to_path_buf(),
                    canon_dir,
                    canon_verified: false,
                    depth: 1,
                    root_in_node_modules: false,
                }],
            );
        }
        return (Vec::new(), Vec::new());
    }

    let mut files = Vec::new();
    let mut tasks = Vec::new();
    let mut scratch = Vec::new();

    for ap in authorized {
        if !is_path_contained(&ap.requested, project_root, allowed_roots)
            || !is_path_contained(&ap.canonical, project_root, allowed_roots)
        {
            continue;
        }
        if has_git_component(&ap.requested) || has_git_component(&ap.canonical) {
            continue;
        }
        if std::fs::read_link(&ap.requested).is_ok()
            || std::fs::read_link(&ap.canonical).is_ok()
        {
            continue;
        }
        let Ok(meta) = std::fs::metadata(&ap.canonical) else {
            continue;
        };
        if meta.is_file() {
            let file_name = ap
                .canonical
                .file_name()
                .map(|n| n.to_string_lossy())
                .unwrap_or_default();
            if !ignore.should_skip_file(&file_name, &ap.canonical)
                && let Some(wf) = inspect_file(ap.canonical.clone(), 1, opts, &mut scratch)
            {
                files.push(wf);
            }
        } else if meta.is_dir() {
            let in_nm = ap
                .canonical
                .components()
                .any(|c| matches!(c, Component::Normal(s) if s == "node_modules"));
            let canon_dir =
                std::fs::canonicalize(&ap.canonical).unwrap_or_else(|_| ap.canonical.clone());
            tasks.push(DirTask {
                dir: ap.canonical.clone(),
                canon_dir,
                canon_verified: false,
                depth: 1,
                root_in_node_modules: in_nm,
            });
        }
    }

    (files, tasks)
}
