use aice_find_engine::{FindWalkOpts, WalkOutput, rank_candidates, walk_governed_with_opts};
use aice_governance::{FindOp, Governed, PipelineRequest, ReadOp, authorize};

use crate::BatchReadPack;
use crate::budget::effective_token_budget;
use crate::discovery_format::{
    DiscoveryEntry, build_fd_baseline, format_discovery_json, format_discovery_text,
};
use crate::gitignore::{filter_walk_output, to_rel_posix};
use crate::glob::glob_matches;
use crate::regex_compile::compile_slash_regex;
use crate::search_validate::{error_pack_with_mode, validate_explicit_targets};

pub fn walk_to_entries(
    governed: &Governed,
    mut walk: WalkOutput,
    query: Option<&str>,
    explicit_targets: &[String],
) -> (Vec<DiscoveryEntry>, Vec<String>) {
    filter_walk_output(governed, &mut walk, explicit_targets);
    let root = governed.project_root();

    let mut all_entries: Vec<DiscoveryEntry> = walk
        .files
        .into_iter()
        .filter(|f| !f.is_binary)
        .map(|f| DiscoveryEntry {
            rel_path: to_rel_posix(root, &f.path),
            lines: f.line_count,
            bytes: f.byte_size,
        })
        .collect();
    all_entries.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    all_entries.dedup_by(|a, b| a.rel_path == b.rel_path);

    let mut boundary_dirs: Vec<String> = walk
        .boundary_dirs
        .into_iter()
        .map(|d| to_rel_posix(root, &d))
        .filter(|s| !s.is_empty())
        .collect();
    boundary_dirs.sort();
    boundary_dirs.dedup();

    let Some(raw_q) = query.map(str::trim).filter(|s| !s.is_empty()) else {
        return (all_entries, boundary_dirs);
    };

    let filtered = filter_entries_by_query(&all_entries, raw_q, explicit_targets);
    (filtered, Vec::new())
}

fn normalize_rel_prefix(raw: &str) -> String {
    let norm = raw.replace('\\', "/");
    let mut s = norm.as_str();
    while let Some(rest) = s.strip_prefix("./") {
        s = rest;
    }
    s.trim_matches('/').to_string()
}

fn strip_leading_dot_slashes(raw: &str) -> String {
    let norm = raw.replace('\\', "/");
    let mut s = norm.as_str();
    while let Some(rest) = s.strip_prefix("./") {
        s = rest;
    }
    s.to_string()
}

fn strip_target_prefix<'a>(rel_path: &'a str, targets: &[String]) -> Option<&'a str> {
    for t in targets {
        let pfx = normalize_rel_prefix(t);
        if !pfx.is_empty()
            && pfx != "."
            && let Some(rest) = rel_path.strip_prefix(&format!("{pfx}/"))
        {
            return Some(rest);
        }
    }
    None
}

fn filter_entries_by_query(
    entries: &[DiscoveryEntry],
    raw_q: &str,
    explicit_targets: &[String],
) -> Vec<DiscoveryEntry> {
    if raw_q.starts_with('/')
        && raw_q.len() >= 2
        && let Ok(rx) = compile_slash_regex(raw_q)
    {
        return entries
            .iter()
            .filter(|e| rx.is_match(&e.rel_path))
            .cloned()
            .collect();
    }

    let clean_q = strip_leading_dot_slashes(raw_q);
    let q_str = clean_q.as_str();
    let is_glob = q_str.contains('*') || q_str.contains('?') || q_str.contains('[');
    if is_glob {
        let has_slash = q_str.contains('/');
        let mut matched: Vec<DiscoveryEntry> = entries
            .iter()
            .filter(|e| {
                if has_slash {
                    glob_matches(q_str, &e.rel_path)
                        || strip_target_prefix(&e.rel_path, explicit_targets)
                            .is_some_and(|sub| glob_matches(q_str, sub))
                } else {
                    let base = e.rel_path.rsplit('/').next().unwrap_or(&e.rel_path);
                    glob_matches(q_str, base) || glob_matches(q_str, &e.rel_path)
                }
            })
            .cloned()
            .collect();
        matched.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
        return matched;
    }

    let q_low = q_str.to_ascii_lowercase();
    let mut sub: Vec<DiscoveryEntry> = entries
        .iter()
        .filter(|e| e.rel_path.to_ascii_lowercase().contains(&q_low))
        .cloned()
        .collect();
    if !sub.is_empty() {
        sub.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
        return sub;
    }

    let paths: Vec<String> = entries.iter().map(|e| e.rel_path.clone()).collect();
    let ranked = rank_candidates(q_str, &paths);
    let mut out = Vec::new();
    for m in ranked {
        if m.score >= 0.35
            && let Some(e) = entries.iter().find(|e| e.rel_path == m.target)
        {
            out.push(e.clone());
        }
    }
    out
}

pub fn format_find_pack(governed: &Governed, walk: WalkOutput, op: &FindOp) -> BatchReadPack {
    let query_opt = op.pattern.clone().or_else(|| op.search.clone());
    let (eff_walk, eff_targets) = rewalk_backslash_targets(
        governed,
        &op.targets,
        op.depth,
        op.full,
        query_opt.clone(),
    )
    .unwrap_or_else(|| (walk, op.targets.clone()));
    if let Err(msg) = validate_explicit_targets(governed, &eff_targets) {
        return error_pack_with_mode("<workspace-files>", msg, false, true);
    }
    let query = query_opt.as_deref().filter(|s| !s.trim().is_empty());
    finish_discovery_pack(governed, eff_walk, query, &eff_targets, op.depth, op.max_tokens, op.json)
}

pub fn execute_files_only(governed: &Governed, op: &ReadOp) -> Result<BatchReadPack, String> {
    let (walk, eff_targets) = if let Some(pair) = rewalk_backslash_targets(
        governed,
        &op.targets,
        op.depth,
        op.full,
        op.search.clone(),
    ) {
        pair
    } else {
        if let Err(msg) = validate_explicit_targets(governed, &op.targets) {
            return Ok(error_pack_with_mode("<workspace-files>", msg, false, true));
        }
        let opts = FindWalkOpts {
            max_depth: op.depth,
            include_hidden: op.full,
            skip_lockfiles: true,
            include_binary: false,
            probe_binary: true,
            measure_lines: true,
            query: op.search.clone(),
            explicit_targets: op.targets.clone(),
            walk_project_root_if_untargeted: true,
        };
        (walk_governed_with_opts(governed, &opts).map_err(|e| e.to_string())?, op.targets.clone())
    };
    let query = op.search.as_deref().filter(|s| !s.trim().is_empty());
    Ok(finish_discovery_pack(governed, walk, query, &eff_targets, op.depth, op.max_tokens, op.json))
}

fn finish_discovery_pack(
    governed: &Governed,
    walk: WalkOutput,
    query: Option<&str>,
    targets: &[String],
    depth: Option<usize>,
    max_tokens_opt: Option<usize>,
    json: bool,
) -> BatchReadPack {
    let (entries, boundary_dirs) = walk_to_entries(governed, walk, query, targets);
    let max_tokens = effective_token_budget(governed.surface(), max_tokens_opt);
    let raw_baseline = build_fd_baseline(&entries, &boundary_dirs);
    let emitted = if json {
        format_discovery_json(governed.project_root(), &entries)
    } else {
        format_discovery_text(&entries, &boundary_dirs, depth, max_tokens)
    };
    BatchReadPack {
        raw_baseline,
        emitted_output: emitted,
        file_label: "<workspace-files>".to_string(),
        stderr_output: String::new(),
        exit_code: 0,
        realistic_native_payload: None,
        multi_files: Vec::new(),
        language: Some("Multi".to_string()),
        is_search_mode: false,
        is_files_mode: true,
        has_expanded_context: true,
        preserved_trivia_tokens: 0,
        wasted_input_tokens: None,
    }
}

fn normalize_win_target(raw: &str) -> String {
    let trimmed = strip_leading_dot_slashes(raw);
    let clean = trimmed.trim_end_matches('/');
    if clean.is_empty() { ".".to_string() } else { clean.to_string() }
}

fn rewalk_backslash_targets(
    governed: &Governed,
    targets: &[String],
    depth: Option<usize>,
    full: bool,
    query: Option<String>,
) -> Option<(WalkOutput, Vec<String>)> {
    if !targets.iter().any(|t| t.contains('\\') && !governed.cwd().join(t).exists()) {
        return None;
    }
    let norm_targets: Vec<String> = targets
        .iter()
        .map(|t| if t.contains('\\') && !governed.cwd().join(t).exists() { normalize_win_target(t) } else { t.clone() })
        .collect();
    let find_op = FindOp {
        pattern: query.clone(),
        targets: norm_targets.clone(),
        target_paths: Vec::new(),
        depth,
        search: None,
        full,
        max_tokens: None,
        json: false,
    };
    let req = PipelineRequest::new(find_op, governed.cwd().to_path_buf(), governed.surface());
    let find_gov = authorize(req).ok()?;
    let opts = FindWalkOpts {
        max_depth: depth,
        include_hidden: full,
        skip_lockfiles: true,
        include_binary: false,
        probe_binary: true,
        measure_lines: true,
        query,
        explicit_targets: norm_targets.clone(),
        walk_project_root_if_untargeted: false,
    };
    let walk = walk_governed_with_opts(find_gov.state(), &opts).ok()?;
    Some((walk, norm_targets))
}

pub fn walk_project_root(governed: &Governed, measure_lines: bool) -> Option<WalkOutput> {
    let find_op = FindOp {
        pattern: None,
        targets: Vec::new(),
        target_paths: Vec::new(),
        depth: None,
        search: None,
        full: false,
        max_tokens: None,
        json: false,
    };
    let req = PipelineRequest::new(find_op, governed.project_root().to_path_buf(), governed.surface());
    let find_gov = authorize(req).ok()?;
    let opts = FindWalkOpts {
        walk_project_root_if_untargeted: true,
        include_binary: false,
        measure_lines,
        ..FindWalkOpts::default()
    };
    let mut walk = walk_governed_with_opts(find_gov.state(), &opts).ok()?;
    filter_walk_output(governed, &mut walk, &[]);
    Some(walk)
}
