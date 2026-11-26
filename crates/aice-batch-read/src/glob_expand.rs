use std::path::{Path, PathBuf};

use aice_find_engine::{FindWalkOpts, walk_governed_with_opts};
use aice_governance::path_guard::is_path_contained;
use aice_governance::{
    AuthorizedPath, BinaryProbeResult, FindOp, Governed, PipelineRequest, authorize, probe_file,
};

use crate::gitignore::{GitIgnoreSet, filter_walk_output, to_rel_posix};
use crate::glob::{glob_matches, split_braces, split_top_level_commas};
use crate::matcher::ResolvedTarget;
use crate::selector::ParsedTargetSpec;

pub(crate) fn is_glob_pattern(file_path: &str) -> bool {
    file_path.contains('*')
        || file_path.contains('?')
        || file_path.contains('[')
        || has_brace_group(file_path)
}

fn has_brace_group(s: &str) -> bool {
    s.find('{').is_some_and(|o| s[o + 1..].contains('}'))
}

fn has_leading_dot_segment(pat: &str) -> bool {
    has_leading_dot_segment_rec(pat, 0)
}

fn has_leading_dot_segment_rec(pat: &str, depth: usize) -> bool {
    if depth < 8
        && let Some((pre, inner, post)) = split_braces(pat)
    {
        return split_top_level_commas(inner)
            .into_iter()
            .take(64)
            .any(|alt| has_leading_dot_segment_rec(&format!("{pre}{alt}{post}"), depth + 1));
    }
    pat.replace('\\', "/")
        .split('/')
        .any(|seg| seg.starts_with('.') && seg != "." && seg != "..")
}

pub(crate) fn expand_glob_target(
    governed: &Governed,
    spec: &ParsedTargetSpec,
    ap: &AuthorizedPath,
    cached_walk: &mut Option<Vec<PathBuf>>,
) -> Vec<ResolvedTarget> {
    let project_root = governed.project_root();
    let allowed_roots = &governed.config().allowed_read_roots;
    let canon_root = std::fs::canonicalize(project_root).ok();
    let under_root = ap.canonical.starts_with(project_root)
        || canon_root
            .as_deref()
            .is_some_and(|cr| ap.canonical.starts_with(cr));
    let needs_hidden = has_leading_dot_segment(&spec.file_path);

    let (norm_pat, candidates, use_abs_match): (String, Vec<PathBuf>, bool) = if under_root {
        let pat = to_rel_posix(project_root, &ap.canonical);
        let paths = if needs_hidden {
            walk_glob_candidates(governed, None, true)
        } else {
            cached_walk
                .get_or_insert_with(|| walk_glob_candidates(governed, None, false))
                .clone()
        };
        (pat, paths, false)
    } else {
        let Some(prefix_dir) = find_non_glob_dir_prefix(&ap.canonical) else {
            return Vec::new();
        };
        if !is_path_contained(&prefix_dir, project_root, allowed_roots)
            || std::fs::read_link(&prefix_dir).is_ok()
        {
            return Vec::new();
        }
        let pat = ap.canonical.to_string_lossy().replace('\\', "/");
        let paths = walk_glob_candidates(governed, Some(&prefix_dir), needs_hidden);
        (pat, paths, true)
    };

    let gi = GitIgnoreSet::from_root(project_root);
    let mut matches = Vec::new();
    for path in candidates {
        let rel = to_rel_posix(project_root, &path);
        let match_str = if use_abs_match {
            path.to_string_lossy().replace('\\', "/")
        } else {
            rel.clone()
        };
        if !glob_matches(&norm_pat, &match_str) {
            continue;
        }
        if !is_path_contained(&path, project_root, allowed_roots) {
            continue;
        }
        if std::fs::read_link(&path).is_ok() {
            continue;
        }
        if gi.is_ignored(&path, false) {
            continue;
        }
        if !std::fs::metadata(&path).is_ok_and(|m| m.is_file()) {
            continue;
        }
        let is_binary = !matches!(probe_file(&path), BinaryProbeResult::Text);
        matches.push(ResolvedTarget {
            spec: ParsedTargetSpec {
                file_path: rel.clone(),
                selectors: spec.selectors.clone(),
            },
            canonical: path,
            rel_path: rel,
            is_dir: false,
            is_binary,
            fuzzy_note: None,
            is_expanded: false,
        });
    }

    matches.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    matches
}

fn find_non_glob_dir_prefix(path: &Path) -> Option<PathBuf> {
    let mut cur = path.parent()?;
    loop {
        let s = cur.to_string_lossy();
        if !is_glob_pattern(&s) && cur.is_dir() {
            return Some(cur.to_path_buf());
        }
        cur = cur.parent()?;
    }
}

fn walk_glob_candidates(
    governed: &Governed,
    explicit_dir: Option<&Path>,
    include_hidden: bool,
) -> Vec<PathBuf> {
    let targets = explicit_dir
        .map(|d| vec![d.display().to_string()])
        .unwrap_or_default();
    let find_op = FindOp {
        pattern: None,
        targets: targets.clone(),
        target_paths: Vec::new(),
        depth: None,
        search: None,
        full: include_hidden,
        max_tokens: None,
        json: false,
    };
    let req = PipelineRequest::new(find_op, governed.project_root().to_path_buf(), governed.surface());
    let Ok(find_gov) = authorize(req) else {
        return Vec::new();
    };
    let opts = FindWalkOpts {
        include_hidden,
        include_binary: true,
        probe_binary: false,
        measure_lines: false,
        explicit_targets: targets,
        walk_project_root_if_untargeted: explicit_dir.is_none(),
        ..FindWalkOpts::default()
    };
    let Ok(mut walk) = walk_governed_with_opts(find_gov.state(), &opts) else {
        return Vec::new();
    };
    filter_walk_output(governed, &mut walk, &[]);
    walk.files.into_iter().map(|f| f.path).collect()
}
