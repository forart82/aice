use std::collections::HashSet;
use std::path::PathBuf;

use aice_governance::path_guard::resolve_contained_path;
use aice_governance::{Governed, OperationKind};
use aice_lang_registry::LanguageId;

use crate::ignore_paths::{has_dot_components, lexical_normalize};
use crate::ignore_rules::IgnorePolicy;
use crate::walker_pool::{WalkContext, run_parallel_walk};
use crate::walker_seed::{dedup_and_check_overlap, seed_roots};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredFile {
    pub path: PathBuf,
    pub language: LanguageId,
    pub is_binary: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FindWalkOpts {
    pub max_depth: Option<usize>,
    pub include_hidden: bool,
    pub skip_lockfiles: bool,
    pub include_binary: bool,
    pub probe_binary: bool,
    pub measure_lines: bool,
    pub query: Option<String>,
    pub explicit_targets: Vec<String>,
    pub walk_project_root_if_untargeted: bool,
}

impl Default for FindWalkOpts {
    fn default() -> Self {
        Self {
            max_depth: None,
            include_hidden: false,
            skip_lockfiles: true,
            include_binary: false,
            probe_binary: true,
            measure_lines: true,
            query: None,
            explicit_targets: Vec::new(),
            walk_project_root_if_untargeted: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WalkedFile {
    pub path: PathBuf,
    pub language: LanguageId,
    pub is_binary: bool,
    pub line_count: usize,
    pub byte_size: u64,
    pub depth: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WalkOutput {
    pub files: Vec<WalkedFile>,
    pub boundary_dirs: Vec<PathBuf>,
}

pub fn walk_governed(
    governed: &Governed,
    max_depth: Option<usize>,
) -> std::io::Result<Vec<DiscoveredFile>> {
    let opts = FindWalkOpts {
        max_depth,
        measure_lines: false,
        ..FindWalkOpts::default()
    };
    let output = walk_governed_with_opts(governed, &opts)?;
    Ok(output
        .files
        .into_iter()
        .map(|f| DiscoveredFile {
            path: f.path,
            language: f.language,
            is_binary: f.is_binary,
        })
        .collect())
}

pub fn walk_governed_with_opts(
    governed: &Governed,
    opts: &FindWalkOpts,
) -> std::io::Result<WalkOutput> {
    if !matches!(
        governed.op_kind(),
        OperationKind::Find | OperationKind::Read | OperationKind::Search
    ) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            format!("governance op_kind mismatch for discovery: {:?}", governed.op_kind()),
        ));
    }

    let project_root = governed.project_root();
    let allowed_roots = &governed.config().allowed_read_roots;
    let root_canon = std::fs::canonicalize(project_root)
        .ok()
        .or_else(|| resolve_contained_path(project_root, project_root));
    let base_root = root_canon.as_deref().unwrap_or(project_root);
    let allowed_canons: Vec<PathBuf> = allowed_roots
        .iter()
        .filter_map(|r| {
            let joined = if r.is_relative() { base_root.join(r) } else { r.clone() };
            std::fs::canonicalize(&joined).ok().or_else(|| resolve_contained_path(r, base_root))
        })
        .collect();

    let effective_max_depth = opts.max_depth.map(|d| d.max(1));
    let ignore = IgnorePolicy::from_governed(
        governed,
        opts.query.as_deref(),
        opts.include_hidden,
        opts.skip_lockfiles,
        &opts.explicit_targets,
    );
    let (mut files, mut initial_tasks) =
        seed_roots(governed, opts, &ignore, root_canon.as_deref(), allowed_roots);
    let has_overlapping_roots = dedup_and_check_overlap(&mut initial_tasks);

    let mut entered_dirs = if opts.max_depth.is_some() {
        let mut set = HashSet::with_capacity(initial_tasks.len() * 3);
        for t in &initial_tasks {
            set.insert(t.dir.clone());
            set.insert(lexical_normalize(&t.dir));
            set.insert(t.canon_dir.clone());
        }
        set
    } else {
        HashSet::new()
    };

    let needs_canon_paths = has_overlapping_roots || effective_max_depth.is_some();
    let ctx = WalkContext {
        opts,
        ignore: &ignore,
        effective_max_depth,
        root_canon,
        allowed_canons,
        has_overlapping_roots,
        needs_canon_paths,
    };
    let had_seeded_files = !files.is_empty();
    let (pooled_files, mut boundary_dirs, walked_entered) =
        run_parallel_walk(initial_tasks, &ctx);
    files.extend(pooled_files);
    files.sort_unstable_by(|a, b| a.path.cmp(&b.path).then_with(|| a.depth.cmp(&b.depth)));
    if has_overlapping_roots || had_seeded_files {
        files.dedup_by(|a, b| a.path == b.path);
    }

    if opts.max_depth.is_some() && !boundary_dirs.is_empty() {
        for d in walked_entered {
            if has_dot_components(&d) {
                entered_dirs.insert(lexical_normalize(&d));
            }
            entered_dirs.insert(d);
        }
        boundary_dirs.sort_unstable();
        boundary_dirs.dedup();
        boundary_dirs.retain(|bd| {
            !entered_dirs.contains(bd)
                && (!has_dot_components(bd) || !entered_dirs.contains(&lexical_normalize(bd)))
        });
    }
    Ok(WalkOutput { files, boundary_dirs })
}
