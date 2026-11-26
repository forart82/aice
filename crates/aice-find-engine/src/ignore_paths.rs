use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};

use aice_governance::Governed;
use aice_governance::path_guard::resolve_contained_path;

pub(crate) fn build_allowed_pairs(
    project_root: &Path,
    allowed_roots: &[PathBuf],
) -> Vec<(PathBuf, Option<PathBuf>)> {
    allowed_roots
        .iter()
        .map(|r| {
            let raw = if r.is_relative() {
                lexical_normalize(&project_root.join(r))
            } else {
                lexical_normalize(r)
            };
            (raw, resolve_contained_path(r, project_root))
        })
        .collect()
}

pub(crate) fn lexical_normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                let can_pop = matches!(out.components().next_back(), Some(Component::Normal(_)));
                if can_pop {
                    out.pop();
                } else if !matches!(
                    out.components().next_back(),
                    Some(Component::RootDir | Component::Prefix(_))
                ) {
                    out.push(comp);
                }
            }
            other => out.push(other),
        }
    }
    if out.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        out
    }
}

fn add_prefix_chains(
    rel: &Path,
    raw_base: Option<&Path>,
    canon_base: Option<&Path>,
    include_rel: bool,
    allowed_dirs: &mut BTreeSet<String>,
    allowed_paths: &mut BTreeSet<PathBuf>,
) {
    let mut prefix = PathBuf::new();
    for comp in rel.components() {
        if let Component::Normal(seg) = comp {
            let s = seg.to_string_lossy();
            if s.is_empty() || s == "." {
                continue;
            }
            allowed_dirs.insert(s.into_owned());
            prefix.push(seg);
            if include_rel {
                allowed_paths.insert(prefix.clone());
            }
            if let Some(rb) = raw_base {
                allowed_paths.insert(rb.join(&prefix));
            }
            if let Some(cb) = canon_base {
                allowed_paths.insert(cb.join(&prefix));
            }
        }
    }
}

pub(crate) fn record_rel_prefixes(
    path: &Path,
    root_norm: &Path,
    root_canon: &Path,
    allowed_pairs: &[(PathBuf, Option<PathBuf>)],
    allowed_dirs: &mut BTreeSet<String>,
    allowed_paths: &mut BTreeSet<PathBuf>,
) {
    let norm = lexical_normalize(path);
    if let Some(rel) = norm
        .strip_prefix(root_norm)
        .ok()
        .or_else(|| norm.strip_prefix(root_canon).ok())
    {
        add_prefix_chains(
            rel,
            Some(root_norm),
            Some(root_canon),
            true,
            allowed_dirs,
            allowed_paths,
        );
        return;
    }
    for (raw_root, canon_root) in allowed_pairs {
        if let Some(rel) = norm
            .strip_prefix(raw_root)
            .ok()
            .or_else(|| canon_root.as_deref().and_then(|cr| norm.strip_prefix(cr).ok()))
        {
            add_prefix_chains(
                rel,
                Some(raw_root.as_path()),
                canon_root.as_deref(),
                false,
                allowed_dirs,
                allowed_paths,
            );
            return;
        }
    }
}

pub(crate) fn compute_out_dirs(
    governed: &Governed,
    project_root: &Path,
    root_canon: &Path,
) -> Vec<PathBuf> {
    let cfg = governed.config();
    let out_trimmed = cfg.out_dir.trim();
    if out_trimmed.is_empty() || out_trimmed == "." {
        return Vec::new();
    }
    let root_norm = lexical_normalize(project_root);
    let out_norm = lexical_normalize(&project_root.join(out_trimmed));
    let out_contained = resolve_contained_path(Path::new(out_trimmed), project_root);
    let out_canon = std::fs::canonicalize(&out_norm).ok();
    let src_trimmed = cfg.source_dir.trim();
    if !src_trimmed.is_empty() {
        let src_norm = lexical_normalize(&project_root.join(src_trimmed));
        if out_norm == src_norm {
            return Vec::new();
        }
        if let (Some(oc), Some(sc)) = (
            out_contained.as_ref(),
            resolve_contained_path(Path::new(src_trimmed), project_root).as_ref(),
        ) && oc == sc
        {
            return Vec::new();
        }
        if let (Some(oc), Ok(sc)) = (out_canon.as_ref(), std::fs::canonicalize(&src_norm))
            && oc == &sc
        {
            return Vec::new();
        }
    }
    let mut out_dirs = Vec::new();
    for candidate in [
        Some(project_root.join(out_trimmed)),
        Some(out_norm),
        out_contained,
        out_canon,
    ]
    .into_iter()
    .flatten()
    {
        if candidate != project_root
            && candidate != root_norm
            && candidate != *root_canon
            && !out_dirs.contains(&candidate)
        {
            out_dirs.push(candidate);
        }
    }
    out_dirs
}

pub(crate) fn has_git_component(path: &Path) -> bool {
    path.components()
        .any(|c| matches!(c, Component::Normal(s) if s == ".git"))
}

pub(crate) fn has_dot_components(path: &Path) -> bool {
    path.components()
        .any(|c| matches!(c, Component::CurDir | Component::ParentDir))
}

pub(crate) fn is_special_file_name(name: &str, is_lockfile: bool) -> bool {
    name == "aice.config.json"
        || name.ends_with(".trivia.json")
        || name.starts_with('.')
        || is_lockfile
}

pub(crate) fn push_unique(out: &mut Vec<String>, val: &str) {
    if !out.iter().any(|existing| existing == val) {
        out.push(val.to_string());
    }
}

pub fn has_leading_dot_token(input: &str) -> bool {
    let bytes = input.as_bytes();
    bytes.iter().enumerate().any(|(i, &b)| {
        b == b'.'
            && (i == 0 || matches!(bytes[i - 1], b'/' | b'\\' | b',' | b'{'))
            && bytes
                .get(i + 1)
                .is_some_and(|&next| !matches!(next, b'/' | b'\\' | b'.' | b',' | b'}'))
    })
}

pub(crate) fn collect_out_dir_names(out_dirs: &[PathBuf]) -> Vec<String> {
    let mut names = Vec::new();
    for out in out_dirs {
        if let Some(name) = out.file_name().and_then(|n| n.to_str()) {
            push_unique(&mut names, name);
        }
    }
    names
}

pub(crate) fn collect_special_file_names(
    paths: &BTreeSet<PathBuf>,
    is_lockfile: fn(&str) -> bool,
) -> Vec<String> {
    let mut names = Vec::new();
    for p in paths {
        if let Some(name) = p.file_name().and_then(|n| n.to_str())
            && is_special_file_name(name, is_lockfile(name))
        {
            push_unique(&mut names, name);
        }
    }
    names
}

pub(crate) fn add_target_with_prefixes(
    candidate: PathBuf,
    root_norm: &Path,
    root_canon: &Path,
    allowed_pairs: &[(PathBuf, Option<PathBuf>)],
    allowed_dirs: &mut BTreeSet<String>,
    allowed_paths: &mut BTreeSet<PathBuf>,
    target_paths: &mut BTreeSet<PathBuf>,
) {
    record_rel_prefixes(&candidate, root_norm, root_canon, allowed_pairs, allowed_dirs, allowed_paths);
    target_paths.insert(candidate);
}
