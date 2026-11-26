use std::path::PathBuf;

use aice_aice_ir::DefaultAiceTranspiler;
use aice_ast_engine::EngineRegistry;
use aice_find_engine::{FindWalkOpts, walk_governed_with_opts};
use aice_governance::binary_probe::DEFAULT_MAX_TEXT_FILE_BYTES;
use aice_governance::{Governed, OperationKind, OperationTargets, ReadOp, SearchOp};
use aice_lang_registry::{AdapterLookup, LanguageId, detect_language};

use crate::budget::effective_token_budget;
use crate::gitignore::{filter_walk_output, to_rel_posix};
use crate::regex_compile::{compile_search_pattern, compile_slash_regex};
use crate::render_json::{append_stats_footer_within_budget, resolve_stats_fill_budget};
use crate::search_json::{budget_files_with_matches, build_budgeted_bundle, format_search_json};
use crate::search_rank::{SearchHit, build_rg_baseline, build_windows, score_file_matches};
use crate::{BatchReadPack, verify_authorized_targets};

pub struct SearchParams<'a> {
    pub pattern: &'a str,
    pub targets: &'a [String],
    pub context_lines: Option<usize>,
    pub line_numbers: bool,
    pub symbol: Option<&'a str>,
    pub files_with_matches: bool,
    pub full: bool,
    pub max_tokens: Option<usize>,
    pub json: bool,
    pub stats: bool,
    pub from_read_flag: bool,
}

pub fn execute_search(governed: &Governed, op: &SearchOp) -> Result<BatchReadPack, String> {
    let expected = op.target_paths_in_dir(governed.cwd());
    let has_raw = !op.targets.is_empty() || !op.target_paths.is_empty();
    verify_authorized_targets(governed, OperationKind::Search, &expected, has_raw)?;
    let params = SearchParams {
        pattern: &op.pattern,
        targets: &op.targets,
        context_lines: op.context_lines,
        line_numbers: op.line_numbers,
        symbol: op.symbol.as_deref(),
        files_with_matches: op.files_with_matches,
        full: op.full,
        max_tokens: op.max_tokens,
        json: op.json,
        stats: op.stats,
        from_read_flag: false,
    };
    Ok(run_search_core(governed, &params))
}

pub fn execute_read_search(governed: &Governed, op: &ReadOp) -> Result<BatchReadPack, String> {
    let pat = op.search.as_deref().unwrap_or("");
    let params = SearchParams {
        pattern: pat,
        targets: &op.targets,
        context_lines: op.context_lines,
        line_numbers: true,
        symbol: op.symbol.as_deref(),
        files_with_matches: false,
        full: op.full,
        max_tokens: op.max_tokens,
        json: op.json,
        stats: op.stats,
        from_read_flag: true,
    };
    Ok(run_search_core(governed, &params))
}

fn run_search_core(governed: &Governed, params: &SearchParams<'_>) -> BatchReadPack {
    let walk_opts = FindWalkOpts {
        include_hidden: params.full,
        include_binary: false,
        measure_lines: false,
        explicit_targets: params.targets.to_vec(),
        walk_project_root_if_untargeted: params.targets.is_empty(),
        ..FindWalkOpts::default()
    };
    let mut walk = match walk_governed_with_opts(governed, &walk_opts) {
        Ok(w) => w,
        Err(e) => {
            return BatchReadPack {
                raw_baseline: String::new(),
                emitted_output: String::new(),
                file_label: "<directory>".to_string(),
                stderr_output: e.to_string(),
                exit_code: 1,
                realistic_native_payload: None,
                multi_files: Vec::new(),
                language: Some("Multi".to_string()),
                is_search_mode: true,
                is_files_mode: false,
                has_expanded_context: true,
                preserved_trivia_tokens: 0,
                wasted_input_tokens: None,
            };
        }
    };
    filter_walk_output(governed, &mut walk, params.targets);

    let root = governed.project_root();
    let compiled = if params.pattern.starts_with('/') && params.pattern[1..].contains('/') {
        compile_slash_regex(params.pattern)
            .unwrap_or_else(|_| compile_search_pattern(params.pattern, false))
    } else {
        compile_search_pattern(params.pattern, false)
    };
    let ctx = params.context_lines.unwrap_or(0);
    let registry = EngineRegistry::new();
    let transpiler = DefaultAiceTranspiler;

    let mut candidate_hits: Vec<(SearchHit, String)> = Vec::new();
    for wf in walk.files {
        if wf.is_binary || wf.byte_size > DEFAULT_MAX_TEXT_FILE_BYTES {
            continue;
        }
        let Ok(src) = std::fs::read_to_string(&wf.path) else {
            continue;
        };
        if src.as_bytes().contains(&0) {
            continue;
        }
        let rel_path = to_rel_posix(root, &wf.path);
        let lines: Vec<&str> = src.lines().collect();
        let Some((mut score, mut matched_lines)) =
            score_file_matches(&rel_path, params.pattern, &compiled, &lines)
        else {
            continue;
        };
        let lang = detect_language(&wf.path, &src);
        if let Some(sym_filter) = params.symbol.map(str::trim).filter(|s| !s.is_empty()) {
            let scoped = filter_lines_by_symbol(&registry, lang, &src, sym_filter, &matched_lines);
            if scoped.is_empty() {
                continue;
            }
            matched_lines = scoped;
            score += 200.0;
        }
        let windows = build_windows(&matched_lines, lines.len(), ctx);
        let abs_path: PathBuf = wf.path;
        candidate_hits.push((
            SearchHit {
                rel_path,
                abs_path,
                lang,
                score,
                matched_lines,
                windows,
            },
            src,
        ));
    }

    candidate_hits.sort_by(|a, b| {
        b.0.score
            .total_cmp(&a.0.score)
            .then_with(|| a.0.rel_path.cmp(&b.0.rel_path))
    });

    let hits: Vec<SearchHit> = candidate_hits.iter().map(|(h, _)| h.clone()).collect();
    let sources: Vec<String> = candidate_hits.iter().map(|(_, s)| s.clone()).collect();

    let mut stderr_output = String::new();
    if params.pattern.starts_with('/') && !params.pattern[1..].contains('/') {
        stderr_output = format!(
            "Hint: unclosed '/' in search pattern '{}'; treated as literal.\n",
            params.pattern
        );
    }

    let max_tokens = effective_token_budget(governed.surface(), params.max_tokens);
    let est_chars: usize = sources.iter().map(|s| s.chars().count()).sum();
    let (fill_budget, reserved_stats) = resolve_stats_fill_budget(
        max_tokens, params.stats, params.json, params.max_tokens, 0, 0, est_chars,
    );

    let (mut emitted_output, multi_files, raw_baseline, included_chars) = if hits.is_empty() {
        let empty_out = if params.json {
            format_search_json(params.pattern, &[], "", params.files_with_matches)
        } else if params.from_read_flag && !params.targets.is_empty() {
            format!("// No matches for \"{}\" in {}\n", params.pattern, params.targets.join(", "))
        } else {
            String::new()
        };
        (empty_out, Vec::new(), String::new(), 0usize)
    } else if params.files_with_matches {
        let mut sorted_paths: Vec<String> = hits.iter().map(|h| h.rel_path.clone()).collect();
        sorted_paths.sort();
        let (mut out, mut kept) = budget_files_with_matches(
            params.pattern, &sorted_paths, params.max_tokens, fill_budget, params.json,
        );
        if reserved_stats && kept.is_empty() {
            (out, kept) = budget_files_with_matches(
                params.pattern, &sorted_paths, params.max_tokens, max_tokens, params.json,
            );
        }
        let baseline = if kept.is_empty() { String::new() } else { format!("{}\n", kept.join("\n")) };
        let inc_chars: usize = hits
            .iter()
            .zip(sources.iter())
            .filter(|(h, _)| kept.contains(&h.rel_path))
            .map(|(_, s)| s.chars().count())
            .sum();
        (out, kept, baseline, inc_chars)
    } else {
        let mut bo = build_budgeted_bundle(&hits, &sources, &registry, &transpiler, params, fill_budget);
        if reserved_stats && bo.included_indices.is_empty() {
            bo = build_budgeted_bundle(&hits, &sources, &registry, &transpiler, params, max_tokens);
        }
        let inc_hits: Vec<SearchHit> = bo.included_indices.iter().map(|&i| hits[i].clone()).collect();
        let inc_srcs: Vec<String> = bo.included_indices.iter().map(|&i| sources[i].clone()).collect();
        let kept_files: Vec<String> = inc_hits.iter().map(|h| h.rel_path.clone()).collect();
        let baseline = build_rg_baseline(&inc_hits, &inc_srcs, false);
        let inc_chars: usize = inc_srcs.iter().map(|s| s.chars().count()).sum();
        let out = if params.json {
            format_search_json(params.pattern, &kept_files, &bo.bundle, false)
        } else {
            bo.bundle
        };
        (out, kept_files, baseline, inc_chars)
    };

    if params.stats && !params.json && !emitted_output.is_empty() && !multi_files.is_empty() {
        append_stats_footer_within_budget(
            &mut emitted_output, 0, 0, included_chars, params.max_tokens,
        );
    }

    BatchReadPack {
        raw_baseline,
        emitted_output,
        file_label: "<directory>".to_string(),
        stderr_output,
        exit_code: 0,
        realistic_native_payload: None,
        multi_files,
        language: Some("Multi".to_string()),
        is_search_mode: true,
        is_files_mode: false,
        has_expanded_context: true,
        preserved_trivia_tokens: 0,
        wasted_input_tokens: None,
    }
}

fn filter_lines_by_symbol(
    registry: &EngineRegistry,
    lang: LanguageId,
    src: &str,
    sym_name: &str,
    matched_lines: &[usize],
) -> Vec<usize> {
    let Some(adapter) = registry.adapter(lang) else {
        return Vec::new();
    };
    let Ok(tree) = adapter.parse_cst(src) else {
        return Vec::new();
    };
    let syms = adapter.extract_symbols(&tree, src);
    let q_low = sym_name.to_ascii_lowercase();
    let matching_spans: Vec<(usize, usize)> = syms
        .into_iter()
        .filter(|s| {
            s.name.eq_ignore_ascii_case(&q_low)
                || s.qualified_name.eq_ignore_ascii_case(&q_low)
                || s.qualified_name.to_ascii_lowercase().contains(&q_low)
        })
        .map(|s| (s.start_line, s.end_line))
        .collect();
    matched_lines
        .iter()
        .copied()
        .filter(|&ln| matching_spans.iter().any(|&(s, e)| ln >= s && ln <= e))
        .collect()
}
