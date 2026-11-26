use std::collections::{HashMap, HashSet};

use crate::r5::twig_branches::{IfArena, IfBlock, VariantPlan};

const MAX_FALLBACK_VARIANTS: usize = 4096;

pub(crate) fn count_conds(arena: &IfArena, roots: &[usize], counts: &mut HashMap<String, usize>) {
    let mut stack: Vec<usize> = roots.iter().rev().copied().collect();
    while let Some(bi) = stack.pop() {
        let b = &arena.blocks[bi];
        if !b.needs_expand {
            continue;
        }
        for br in &b.branches {
            if let Some(c) = &br.cond {
                *counts.entry(c.clone()).or_insert(0) += 1;
            }
        }
        for br in b.branches.iter().rev() {
            stack.extend(br.children.iter().rev().copied());
        }
    }
}

pub(crate) fn branch_masks(block: &IfBlock, br_start: usize, br_end: usize) -> Vec<(usize, usize)> {
    let mut m = Vec::with_capacity(2);
    if br_start > block.start_byte {
        m.push((block.start_byte, br_start));
    }
    if block.end_byte > br_end {
        m.push((br_end, block.end_byte));
    }
    m
}

pub(crate) fn default_block_plan(arena: &IfArena, root: usize, out: &mut VariantPlan) {
    let mut stack = vec![root];
    while let Some(bi) = stack.pop() {
        let b = &arena.blocks[bi];
        if !b.needs_expand {
            continue;
        }
        out.resolved_tags.extend_from_slice(&b.tag_bytes);
        if !b.has_else {
            out.masks.push((b.start_byte, b.end_byte));
        } else if let Some(br) = b.branches.first() {
            out.masks.extend(branch_masks(b, br.start, br.end));
            stack.extend(br.children.iter().rev().copied());
        }
    }
}

pub(crate) fn append_truncation_fallbacks(
    arena: &IfArena,
    roots: &[usize],
    covered: &mut HashSet<usize>,
    variants: &mut Vec<VariantPlan>,
) {
    let defs: Vec<VariantPlan> = roots
        .iter()
        .map(|&r| {
            let mut p = VariantPlan::default();
            default_block_plan(arena, r, &mut p);
            p
        })
        .collect();
    let mut base = VariantPlan::default();
    for d in &defs {
        base.masks.extend_from_slice(&d.masks);
        base.resolved_tags.extend_from_slice(&d.resolved_tags);
    }
    variants.push(base);
    let mut budget = MAX_FALLBACK_VARIANTS;
    for (idx, &r) in roots.iter().enumerate() {
        if !arena.blocks[r].needs_expand || budget == 0 {
            continue;
        }
        let mut others = VariantPlan::default();
        for (j, d) in defs.iter().enumerate() {
            if j != idx {
                others.masks.extend_from_slice(&d.masks);
                others.resolved_tags.extend_from_slice(&d.resolved_tags);
            }
        }
        push_uncovered_in_block(arena, r, &others, covered, variants, &mut budget);
    }
}

fn push_uncovered_in_block(
    arena: &IfArena,
    root: usize,
    init_others: &VariantPlan,
    covered: &mut HashSet<usize>,
    variants: &mut Vec<VariantPlan>,
    budget: &mut usize,
) {
    struct Step {
        bi: usize,
        br_idx: usize,
        prefix: VariantPlan,
        others: VariantPlan,
    }
    let mut stack = vec![Step {
        bi: root,
        br_idx: 0,
        prefix: VariantPlan::default(),
        others: init_others.clone(),
    }];
    while let Some(mut st) = stack.pop() {
        let b = &arena.blocks[st.bi];
        if !b.needs_expand || *budget == 0 || st.br_idx >= b.branches.len() {
            continue;
        }
        let br = &b.branches[st.br_idx];
        st.br_idx += 1;
        let mut br_plan = st.prefix.clone();
        br_plan.masks.extend(branch_masks(b, br.start, br.end));
        br_plan.resolved_tags.extend_from_slice(&b.tag_bytes);
        if covered.insert(br.start) {
            let mut full = st.others.clone();
            full.masks.extend_from_slice(&br_plan.masks);
            full.resolved_tags.extend_from_slice(&br_plan.resolved_tags);
            for &ch in &br.children {
                default_block_plan(arena, ch, &mut full);
            }
            variants.push(full);
            *budget -= 1;
        }
        let mut child_steps = Vec::new();
        if *budget > 0 && br.children.iter().any(|&c| arena.blocks[c].needs_expand) {
            let child_defs: Vec<VariantPlan> = br
                .children
                .iter()
                .map(|&c| {
                    let mut p = VariantPlan::default();
                    default_block_plan(arena, c, &mut p);
                    p
                })
                .collect();
            for (ci, &ch) in br.children.iter().enumerate() {
                if !arena.blocks[ch].needs_expand {
                    continue;
                }
                let mut next_others = st.others.clone();
                for (cj, cd) in child_defs.iter().enumerate() {
                    if cj != ci {
                        next_others.masks.extend_from_slice(&cd.masks);
                        next_others.resolved_tags.extend_from_slice(&cd.resolved_tags);
                    }
                }
                child_steps.push(Step {
                    bi: ch,
                    br_idx: 0,
                    prefix: br_plan.clone(),
                    others: next_others,
                });
            }
        }
        stack.push(st);
        for cs in child_steps.into_iter().rev() {
            stack.push(cs);
        }
    }
}
