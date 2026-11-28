use std::collections::HashSet;

use aice_aice_ir::DefaultAiceTranspiler;
use aice_ast_engine::EngineRegistry;
use aice_find_engine::{FindWalkOpts, walk_governed_with_opts};
use aice_governance::{Governed, OutputSurface, ReadOp};
use aice_lang_registry::LanguageId;

use crate::BatchReadPack;
use crate::budget::{count_cl100k_exact, effective_read_token_budget};
use crate::budget_fill::{BudgetCandidate, apply_water_fill_budget};
use crate::gitignore::{filter_walk_output, to_rel_posix};
use crate::matcher::{ResolvedTarget, apply_cli_symbol_flag, resolve_targets_with_governance};
use crate::render_json::{
    ReadJsonInput, append_stats_footer_within_budget, format_read_json, resolve_pack_language,
    resolve_stats_fill_budget,
};
use crate::render_single::{SingleRenderResult, render_resolved_target};
use crate::selector::{ParsedTargetSpec, TargetSelector};
use crate::topo_order::build_topo_pack;

const MCP_INLINE_SIZE_THRESHOLD_BYTES: usize = 9_216;
const MCP_INLINE_SIZE_TIP: &str = "// [aice-tip] >9KB output may spill to output.txt in CLI hosts; split 5+ targets across parallel 2-4 target aice_read calls in 1 turn.";

pub fn render_pack(
    governed: &Governed,
    specs: &[ParsedTargetSpec],
    op: &ReadOp,
    file_label: String,
) -> BatchReadPack {
    let mut working_specs = specs.to_vec();
    apply_cli_symbol_flag(&mut working_specs, op.symbol.as_deref());

    let (resolved, resolve_errors) = resolve_targets_with_governance(governed, &working_specs);
    if resolved.is_empty() && !resolve_errors.is_empty() {
        return error_pack(file_label, resolve_errors.join("\n"), None);
    }

    let expanded = expand_directory_targets(governed, resolved);
    let registry = EngineRegistry::new();
    let transpiler = DefaultAiceTranspiler;
    let topo = build_topo_pack(governed, expanded, &registry, op);

    let mut rendered: Vec<(ResolvedTarget, SingleRenderResult)> = Vec::new();
    let mut errors = resolve_errors;
    let mut wasted_tokens = 0usize;
    let mut has_wasted = false;

    for t in topo.ordered_targets {
        let single = render_resolved_target(&t, &registry, &transpiler, op);
        if let Some(err) = single.error {
            errors.push(err);
            if let Some(w) = single.wasted_payload {
                wasted_tokens += count_cl100k_exact(&w);
                has_wasted = true;
            }
            continue;
        }
        rendered.push((t, single));
    }

    if rendered.is_empty() && !errors.is_empty() {
        return error_pack(
            file_label,
            errors.join("\n"),
            has_wasted.then_some(wasted_tokens),
        );
    }

    let candidates: Vec<BudgetCandidate> = rendered
        .iter()
        .map(|(t, s)| BudgetCandidate {
            rel_path: t.rel_path.clone(),
            header: s.header.clone(),
            emitted: s.emitted.clone(),
            outline_text: s.outline_text.clone(),
            is_expanded: t.is_expanded,
            synthetic_module_line: (s.lang != LanguageId::PlainText && s.lang != LanguageId::Aice)
                .then(|| format!("module {}", s.lang.canonical_name())),
        })
        .collect();
    let caller_paths: Vec<String> = topo.caller_hits.iter().map(|h| h.caller_path.clone()).collect();
    let has_explicit_selectors = rendered.iter().any(|(t, _)| {
        !t.is_expanded
            && t.spec.selectors.iter().any(|s| {
                matches!(
                    s,
                    TargetSelector::Symbol(_)
                        | TargetSelector::LineRange { .. }
                        | TargetSelector::Regex(_)
                        | TargetSelector::IntraBlock(_)
                )
            })
    });
    let max_tokens = effective_read_token_budget(
        governed.surface(),
        op.max_tokens,
        op.full,
        has_explicit_selectors,
    );
    let topo_prio = op.include_deps || op.include_callers;
    let est_chars: usize = rendered
        .iter()
        .filter(|(t, _)| !t.is_expanded)
        .map(|(_, s)| s.raw_baseline.chars().count())
        .sum();
    let (fill_budget, reserved_stats) = resolve_stats_fill_budget(
        max_tokens, op.stats, op.json, op.max_tokens, topo.dep_paths.len(), caller_paths.len(), est_chars,
    );
    let mut outcome = apply_water_fill_budget(&candidates, fill_budget, topo_prio);
    if reserved_stats && outcome.included_indices.is_empty() {
        outcome = apply_water_fill_budget(&candidates, max_tokens, topo_prio);
    }
    let bundle = outcome.bundle;

    let mut raw_parts = Vec::new();
    let mut realistic_parts = Vec::new();
    let mut multi_files = Vec::new();
    let mut detected_langs = Vec::new();
    let mut target_content = String::new();
    let mut target_outline = String::new();
    let mut target_chars = 0usize;

    for idx in outcome.included_indices {
        let (t, s) = &rendered[idx];
        multi_files.push(t.rel_path.clone());
        if !t.is_binary {
            detected_langs.push(s.lang);
        }
        if !t.is_expanded {
            if target_content.is_empty() {
                target_content = s.emitted.clone();
                target_outline = s.outline_text.clone();
            } else {
                target_content.push_str(&s.emitted);
            }
            target_chars += s.raw_baseline.chars().count();
        }
        if !s.raw_baseline.is_empty() {
            raw_parts.push(s.raw_baseline.as_str());
        }
        if let Some(rn) = &s.realistic_native {
            realistic_parts.push(rn.as_str());
        }
    }

    let has_expanded = !topo.dep_paths.is_empty() || !caller_paths.is_empty();

    let mut emitted_output = if op.json {
        let primary_path = multi_files.first().map_or(file_label.as_str(), String::as_str);
        format_read_json(&ReadJsonInput {
            target_path: primary_path,
            target_content: &target_content,
            target_outline: &target_outline,
            dependencies: &topo.dep_paths,
            callers: &caller_paths,
            formatted_bundle: &bundle,
        })
    } else {
        bundle
    };

    if op.stats && !op.json {
        append_stats_footer_within_budget(
            &mut emitted_output,
            topo.dep_paths.len(),
            caller_paths.len(),
            target_chars,
            op.max_tokens,
        );
    }

    if governed.surface() == OutputSurface::Mcp
        && !op.json
        && !emitted_output.is_empty()
        && emitted_output.len() > MCP_INLINE_SIZE_THRESHOLD_BYTES
    {
        let footer = if emitted_output.ends_with('\n') {
            format!("{MCP_INLINE_SIZE_TIP}\n")
        } else {
            format!("\n{MCP_INLINE_SIZE_TIP}\n")
        };
        let fits_budget = op
            .max_tokens
            .is_none_or(|mt| count_cl100k_exact(&format!("{emitted_output}{footer}")) <= mt);
        if fits_budget {
            emitted_output.push_str(&footer);
        }
    }

    let language = resolve_pack_language(&detected_langs);
    let raw_baseline = raw_parts.join("\n");
    let realistic_native_payload = if realistic_parts.is_empty() {
        None
    } else {
        Some(realistic_parts.join("\n"))
    };
    let preserved_trivia_tokens = emitted_output
        .lines()
        .filter(|l| l.trim_start().starts_with('#'))
        .map(count_cl100k_exact)
        .sum();
    let stderr_output = if errors.is_empty() {
        String::new()
    } else {
        format!("{}\n", errors.join("\n"))
    };

    BatchReadPack {
        raw_baseline,
        emitted_output,
        file_label,
        stderr_output,
        exit_code: 0,
        realistic_native_payload,
        multi_files,
        language,
        is_search_mode: false,
        is_files_mode: false,
        has_expanded_context: has_expanded,
        preserved_trivia_tokens,
        wasted_input_tokens: None,
    }
}

fn expand_directory_targets(
    governed: &Governed,
    targets: Vec<ResolvedTarget>,
) -> Vec<ResolvedTarget> {
    let mut out = Vec::new();
    let mut seen_dirs: HashSet<String> = HashSet::new();
    let mut dir_files: HashSet<String> = HashSet::new();
    let root = governed.project_root();

    for t in targets {
        if !t.is_dir {
            out.push(t);
            continue;
        }
        if !seen_dirs.insert(t.rel_path.clone()) {
            continue;
        }
        let opts = FindWalkOpts {
            include_binary: false,
            measure_lines: false,
            explicit_targets: vec![t.rel_path.clone()],
            walk_project_root_if_untargeted: false,
            ..FindWalkOpts::default()
        };
        if let Ok(mut walk) = walk_governed_with_opts(governed, &opts) {
            filter_walk_output(governed, &mut walk, &[]);
            for f in walk.files {
                let rel = to_rel_posix(root, &f.path);
                if dir_files.insert(rel.clone()) {
                    out.push(ResolvedTarget {
                        spec: ParsedTargetSpec {
                            file_path: rel.clone(),
                            selectors: vec![TargetSelector::Full],
                        },
                        canonical: f.path,
                        rel_path: rel,
                        is_dir: false,
                        is_binary: f.is_binary,
                        fuzzy_note: None,
                        is_expanded: false,
                    });
                }
            }
        }
    }
    out
}

fn error_pack(file_label: String, mut stderr: String, wasted: Option<usize>) -> BatchReadPack {
    if !stderr.is_empty() && !stderr.ends_with('\n') {
        stderr.push('\n');
    }
    BatchReadPack {
        raw_baseline: String::new(),
        emitted_output: String::new(),
        file_label,
        stderr_output: stderr,
        exit_code: 1,
        realistic_native_payload: None,
        multi_files: Vec::new(),
        language: None,
        is_search_mode: false,
        is_files_mode: false,
        has_expanded_context: false,
        preserved_trivia_tokens: 0,
        wasted_input_tokens: wasted,
    }
}
