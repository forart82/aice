use std::collections::{HashMap, HashSet};

use aice_ast_engine::EngineRegistry;
use aice_find_engine::SymbolResolution;
use aice_governance::binary_probe::DEFAULT_MAX_TEXT_FILE_BYTES;
use aice_lang_registry::{AdapterLookup, SymbolSelector};

use crate::matcher::{ResolvedTarget, resolve_symbol_fuzzy};
use crate::selector::TargetSelector;
use crate::transpile::parse_for_read;

pub fn coalesce_targets(
    targets: Vec<ResolvedTarget>,
    registry: &EngineRegistry,
) -> Vec<ResolvedTarget> {
    coalesce_targets_with_opts(targets, registry, false)
}

pub fn coalesce_targets_with_opts(
    targets: Vec<ResolvedTarget>,
    registry: &EngineRegistry,
    explicit_full: bool,
) -> Vec<ResolvedTarget> {
    let mut out: Vec<ResolvedTarget> = Vec::new();
    let mut idx_by_rel: HashMap<String, usize> = HashMap::new();

    for t in targets {
        if let Some(&idx) = idx_by_rel.get(&t.rel_path) {
            out[idx].spec.selectors.extend(t.spec.selectors);
            out[idx].is_expanded &= t.is_expanded;
            out[idx].is_binary |= t.is_binary;
            if let Some(note) = t.fuzzy_note {
                match &mut out[idx].fuzzy_note {
                    Some(existing) if !existing.contains(&note) => existing.push_str(&note),
                    None => out[idx].fuzzy_note = Some(note),
                    _ => {}
                }
            }
        } else {
            let idx = out.len();
            idx_by_rel.insert(t.rel_path.clone(), idx);
            out.push(t);
        }
    }

    for t in &mut out {
        coalesce_target_selectors(t, registry, explicit_full);
    }
    out
}

fn coalesce_target_selectors(
    target: &mut ResolvedTarget,
    registry: &EngineRegistry,
    explicit_full: bool,
) {
    let selectors = std::mem::take(&mut target.spec.selectors);
    if selectors.len() <= 1 {
        target.spec.selectors = selectors;
        return;
    }

    if selectors.iter().any(|s| matches!(s, TargetSelector::Full)) {
        let has_explicit_slice = selectors.iter().any(|s| {
            matches!(
                s,
                TargetSelector::Symbol(_)
                    | TargetSelector::LineRange { .. }
                    | TargetSelector::Regex(_)
                    | TargetSelector::IntraBlock(_)
            )
        });
        if explicit_full || !has_explicit_slice {
            let mut merged = Vec::new();
            let mut seen_inv = HashSet::new();
            for s in selectors {
                if let TargetSelector::InvertedLineRange { start, end } = s
                    && seen_inv.insert((start, end))
                {
                    merged.push(TargetSelector::InvertedLineRange { start, end });
                }
            }
            merged.push(TargetSelector::Full);
            target.spec.selectors = merged;
            return;
        }
    }

    let mut dropped_indices = HashSet::new();
    let sym_count = selectors
        .iter()
        .filter(|s| matches!(s, TargetSelector::Symbol(_)))
        .count();
    let has_contained_cand = selectors
        .iter()
        .any(|s| matches!(s, TargetSelector::LineRange { .. } | TargetSelector::IntraBlock(_)));
    if ((sym_count > 0 && has_contained_cand) || sym_count > 1)
        && !target.is_dir
        && !target.is_binary
    {
        collect_symbol_contained_drops(target, &selectors, registry, &mut dropped_indices);
    }

    let mut line_ranges: Vec<(usize, usize, usize)> = Vec::new();
    let mut kept_other: Vec<(usize, TargetSelector)> = Vec::new();
    let mut seen_outline = false;
    let mut seen_imports = false;
    let mut seen_regex = HashSet::new();
    let mut seen_inv = HashSet::new();
    let mut seen_sym = HashSet::new();
    let mut seen_intra = HashSet::new();

    for (idx, sel) in selectors.into_iter().enumerate() {
        if dropped_indices.contains(&idx) {
            continue;
        }
        match sel {
            TargetSelector::LineRange { start, end } => line_ranges.push((idx, start, end)),
            TargetSelector::Outline => {
                if !seen_outline {
                    seen_outline = true;
                    kept_other.push((idx, TargetSelector::Outline));
                }
            }
            TargetSelector::Imports => {
                if !seen_imports {
                    seen_imports = true;
                    kept_other.push((idx, TargetSelector::Imports));
                }
            }
            TargetSelector::Regex(r) => {
                if seen_regex.insert(r.clone()) {
                    kept_other.push((idx, TargetSelector::Regex(r)));
                }
            }
            TargetSelector::InvertedLineRange { start, end } => {
                if seen_inv.insert((start, end)) {
                    kept_other.push((idx, TargetSelector::InvertedLineRange { start, end }));
                }
            }
            TargetSelector::Symbol(s) => {
                let key = (normalize_sym_key(&s.name), s.ordinal.unwrap_or(1));
                if seen_sym.insert(key) {
                    kept_other.push((idx, TargetSelector::Symbol(s)));
                }
            }
            TargetSelector::IntraBlock(b) => {
                let key = (normalize_sym_key(&b.symbol), b.pattern.trim().to_string());
                if seen_intra.insert(key) {
                    kept_other.push((idx, TargetSelector::IntraBlock(b)));
                }
            }
            TargetSelector::Full => {}
        }
    }

    let merged_ranges = merge_line_ranges(line_ranges);
    let mut combined: Vec<(usize, TargetSelector)> = kept_other;
    for (first_idx, start, end) in merged_ranges {
        combined.push((first_idx, TargetSelector::LineRange { start, end }));
    }
    combined.sort_by_key(|(idx, _)| *idx);
    target.spec.selectors = combined.into_iter().map(|(_, s)| s).collect();
}

fn collect_symbol_contained_drops(
    target: &ResolvedTarget,
    selectors: &[TargetSelector],
    registry: &EngineRegistry,
    dropped_indices: &mut HashSet<usize>,
) {
    let Ok(meta) = std::fs::metadata(&target.canonical) else {
        return;
    };
    if !meta.is_file() || meta.len() > DEFAULT_MAX_TEXT_FILE_BYTES {
        return;
    }
    let Ok(src) = std::fs::read_to_string(&target.canonical) else {
        return;
    };
    if src.as_bytes().contains(&0) {
        return;
    }
    let (lang, tree) = parse_for_read(registry, &target.canonical, &src);
    let (Some(slicer), Some(tr)) = (registry.slicer(lang), tree.as_ref()) else {
        return;
    };

    let mut sym_spans: Vec<(usize, usize, usize)> = Vec::new();
    for (idx, sel) in selectors.iter().enumerate() {
        if let TargetSelector::Symbol(sym_sel) = sel {
            if let Ok(sl) = slicer.slice_symbol(tr, &src, sym_sel) {
                sym_spans.push((idx, sl.start_line, sl.end_line));
            } else if let SymbolResolution::Exact(m)
            | SymbolResolution::AutoResolved { symbol: m, .. } =
                resolve_symbol_fuzzy(registry, lang, &src, &sym_sel.name)
                && let Ok(sl) = slicer.slice_symbol(
                    tr,
                    &src,
                    &SymbolSelector {
                        name: m.qualified_name,
                        ordinal: sym_sel.ordinal,
                    },
                )
            {
                sym_spans.push((idx, sl.start_line, sl.end_line));
            }
        }
    }
    if sym_spans.is_empty() {
        return;
    }

    for &(idx, ss, se) in &sym_spans {
        if sym_spans.iter().any(|&(oi, os, oe)| {
            oi != idx && os <= ss && oe >= se && ((os, oe) != (ss, se) || oi < idx)
        }) {
            dropped_indices.insert(idx);
        }
    }

    for (idx, sel) in selectors.iter().enumerate() {
        match sel {
            TargetSelector::LineRange { start, end } => {
                if sym_spans.iter().any(|&(_, ss, se)| *start >= ss && *end <= se) {
                    dropped_indices.insert(idx);
                }
            }
            TargetSelector::IntraBlock(blk) => {
                if let Ok(sl) = slicer.slice_intra_block(tr, &src, blk)
                    && sym_spans
                        .iter()
                        .any(|&(_, ss, se)| sl.start_line >= ss && sl.end_line <= se)
                {
                    dropped_indices.insert(idx);
                }
            }
            _ => {}
        }
    }
}

fn merge_line_ranges(mut ranges: Vec<(usize, usize, usize)>) -> Vec<(usize, usize, usize)> {
    if ranges.is_empty() {
        return ranges;
    }
    ranges.sort_by_key(|&(idx, start, end)| (start, end, idx));
    let mut merged: Vec<(usize, usize, usize)> = Vec::new();
    for (idx, start, end) in ranges {
        if let Some(cur) = merged.last_mut()
            && start <= cur.2.saturating_add(1)
        {
            cur.0 = cur.0.min(idx);
            cur.2 = cur.2.max(end);
        } else {
            merged.push((idx, start, end));
        }
    }
    merged
}

fn normalize_sym_key(name: &str) -> String {
    name.trim().replace('.', "::")
}
