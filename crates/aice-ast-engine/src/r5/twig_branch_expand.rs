use std::collections::{HashMap, HashSet};

use crate::r5::twig_branch_fallback::{append_truncation_fallbacks, branch_masks, count_conds};
use crate::r5::twig_branches::{IfArena, IfBlock, InTagIfPlan, VariantPlan};

const MAX_CARTESIAN_VARIANTS: usize = 1024;
const MAX_LINEAR_BRANCHES: usize = 4096;

type Env = HashMap<String, bool>;

struct Item {
    plan: VariantPlan,
    env: Env,
    covered: Vec<usize>,
}

pub(crate) fn expand_if_plan(arena: &IfArena, roots: &[usize]) -> InTagIfPlan {
    if roots.is_empty() {
        return InTagIfPlan { variants: Vec::new(), has_unexpanded_ctrl: false };
    }
    let mut counts: HashMap<String, usize> = HashMap::new();
    count_conds(arena, roots, &mut counts);
    let tracked: HashSet<String> = counts.into_iter().filter(|&(_, n)| n >= 2).map(|(c, _)| c).collect();
    let limit = if roots.len() == 1 && is_flat_block(&arena.blocks[roots[0]]) {
        MAX_LINEAR_BRANCHES
    } else {
        MAX_CARTESIAN_VARIANTS
    };
    let (expanded, truncated) = expand_seq_iter(arena, roots, &Env::new(), &tracked, limit);
    let mut covered = HashSet::new();
    let mut variants = Vec::with_capacity(expanded.len());
    for item in expanded {
        covered.extend(item.covered);
        variants.push(item.plan);
    }
    if truncated {
        append_truncation_fallbacks(arena, roots, &mut covered, &mut variants);
    }
    InTagIfPlan { variants, has_unexpanded_ctrl: truncated }
}

fn is_flat_block(block: &IfBlock) -> bool {
    block.branches.iter().all(|b| b.children.is_empty())
}

enum ExpandFrame {
    Seq {
        blocks: Vec<usize>,
        b_pos: usize,
        acc: Vec<Item>,
        cur_idx: usize,
        next: Vec<Item>,
        limit: usize,
        truncated: bool,
    },
    Block {
        bi: usize,
        step_env: Env,
        limit: usize,
        branch_limit: usize,
        b_idx: usize,
        out: Vec<Item>,
        forced_true: bool,
        truncated: bool,
        pending_false_cond: Option<String>,
    },
    BranchPost {
        bi: usize,
        b_idx: usize,
        other_masks: Vec<(usize, usize)>,
        limit: usize,
    },
}

fn push_seq_frame(frames: &mut Vec<ExpandFrame>, arena: &IfArena, block_ids: &[usize], env: Env, limit: usize) {
    let blocks: Vec<usize> = block_ids.iter().copied().filter(|&id| arena.blocks[id].needs_expand).collect();
    let acc = vec![Item { plan: VariantPlan::default(), env, covered: Vec::new() }];
    frames.push(ExpandFrame::Seq { blocks, b_pos: 0, acc, cur_idx: 0, next: Vec::new(), limit, truncated: false });
}

fn push_block_frame(frames: &mut Vec<ExpandFrame>, arena: &IfArena, bi: usize, env: Env, limit: usize) {
    let branch_limit = if arena.blocks[bi].has_else { limit } else { limit.saturating_sub(1).max(1) };
    frames.push(ExpandFrame::Block {
        bi, step_env: env, limit, branch_limit, b_idx: 0, out: Vec::new(),
        forced_true: false, truncated: false, pending_false_cond: None,
    });
}

fn expand_seq_iter(
    arena: &IfArena,
    roots: &[usize],
    init_env: &Env,
    tracked: &HashSet<String>,
    limit: usize,
) -> (Vec<Item>, bool) {
    let mut frames = Vec::new();
    push_seq_frame(&mut frames, arena, roots, init_env.clone(), limit);
    let mut ret: Option<(Vec<Item>, bool)> = None;
    while let Some(frame) = frames.pop() {
        match frame {
            ExpandFrame::Seq { blocks, mut b_pos, mut acc, mut cur_idx, mut next, limit, mut truncated } => {
                if let Some((subs, sub_trunc)) = ret.take() {
                    truncated |= sub_trunc;
                    let cur = &acc[cur_idx];
                    for sub in subs {
                        let mut merged = cur.plan.clone();
                        merged.masks.extend_from_slice(&sub.plan.masks);
                        merged.resolved_tags.extend_from_slice(&sub.plan.resolved_tags);
                        let mut cov = cur.covered.clone();
                        cov.extend_from_slice(&sub.covered);
                        next.push(Item { plan: merged, env: sub.env, covered: cov });
                        if next.len() >= limit {
                            truncated = true;
                            break;
                        }
                    }
                    cur_idx += 1;
                    if next.len() >= limit || cur_idx >= acc.len() {
                        if next.len() >= limit && cur_idx < acc.len() { truncated = true; }
                        acc = std::mem::take(&mut next);
                        b_pos += 1;
                        cur_idx = 0;
                    }
                }
                if b_pos >= blocks.len() || acc.is_empty() {
                    ret = Some((acc, truncated));
                    continue;
                }
                let rem = limit.saturating_sub(next.len());
                if rem == 0 {
                    truncated = true;
                    acc = std::mem::take(&mut next);
                    b_pos += 1;
                    cur_idx = 0;
                    frames.push(ExpandFrame::Seq { blocks, b_pos, acc, cur_idx, next, limit, truncated });
                    continue;
                }
                let bi = blocks[b_pos];
                let cur_env = acc[cur_idx].env.clone();
                frames.push(ExpandFrame::Seq { blocks, b_pos, acc, cur_idx, next, limit, truncated });
                push_block_frame(&mut frames, arena, bi, cur_env, rem);
            }
            ExpandFrame::Block {
                bi, mut step_env, limit, branch_limit, mut b_idx, mut out,
                mut forced_true, mut truncated, mut pending_false_cond,
            } => {
                let block = &arena.blocks[bi];
                if let Some((subs, sub_trunc)) = ret.take() {
                    truncated |= sub_trunc;
                    out.extend(subs);
                    if let Some(c) = pending_false_cond.take() {
                        step_env.insert(c, false);
                    }
                    if out.len() >= branch_limit {
                        truncated |= b_idx < block.branches.len();
                        b_idx = block.branches.len();
                    }
                }
                let mut pushed_child = false;
                while b_idx < block.branches.len() {
                    let cur_b = b_idx;
                    b_idx += 1;
                    let br = &block.branches[cur_b];
                    let tracked_cond = br.cond.as_deref().filter(|c| tracked.contains(*c));
                    if let Some(c) = tracked_cond {
                        match step_env.get(c).copied() {
                            Some(true) => {
                                forced_true = true;
                                b_idx = block.branches.len();
                                push_branch_or_inline(arena, bi, cur_b, &step_env, limit, &mut frames, &mut out, &mut truncated, &mut pushed_child);
                                break;
                            }
                            Some(false) => continue,
                            None => {}
                        }
                    }
                    let mut taken_env = step_env.clone();
                    if let Some(c) = tracked_cond {
                        taken_env.insert(c.to_string(), true);
                    }
                    let rem = branch_limit.saturating_sub(out.len());
                    if rem == 0 {
                        truncated = true;
                        b_idx = block.branches.len();
                        break;
                    }
                    push_branch_or_inline(arena, bi, cur_b, &taken_env, rem, &mut frames, &mut out, &mut truncated, &mut pushed_child);
                    if pushed_child {
                        pending_false_cond = tracked_cond.map(str::to_string);
                        break;
                    }
                    if let Some(c) = tracked_cond {
                        step_env.insert(c.to_string(), false);
                    }
                    if out.len() >= branch_limit {
                        truncated |= b_idx < block.branches.len();
                        b_idx = block.branches.len();
                        break;
                    }
                }
                if pushed_child {
                    let seq = frames.pop().expect("seq pushed");
                    let post = frames.pop().expect("branch post");
                    frames.push(ExpandFrame::Block {
                        bi, step_env, limit, branch_limit, b_idx, out,
                        forced_true, truncated, pending_false_cond,
                    });
                    frames.push(post);
                    frames.push(seq);
                    continue;
                }
                if !block.has_else && !forced_true {
                    if out.len() < limit {
                        out.push(Item {
                            plan: VariantPlan { masks: vec![(block.start_byte, block.end_byte)], resolved_tags: block.tag_bytes.clone() },
                            env: step_env,
                            covered: Vec::new(),
                        });
                    } else {
                        truncated = true;
                    }
                }
                ret = Some((out, truncated));
            }
            ExpandFrame::BranchPost { bi, b_idx, other_masks, limit } => {
                let (children, sub_trunc) = ret.take().expect("seq result");
                let block = &arena.blocks[bi];
                let br = &block.branches[b_idx];
                let mut out = Vec::new();
                let mut truncated = sub_trunc;
                for sub in children {
                    let mut masks = other_masks.clone();
                    masks.extend_from_slice(&sub.plan.masks);
                    let mut resolved_tags = block.tag_bytes.clone();
                    resolved_tags.extend_from_slice(&sub.plan.resolved_tags);
                    let mut covered = vec![br.start];
                    covered.extend_from_slice(&sub.covered);
                    out.push(Item { plan: VariantPlan { masks, resolved_tags }, env: sub.env, covered });
                    if out.len() >= limit {
                        truncated = true;
                        break;
                    }
                }
                ret = Some((out, truncated));
            }
        }
    }
    ret.unwrap_or_default()
}

#[allow(clippy::too_many_arguments)]
fn push_branch_or_inline(
    arena: &IfArena,
    bi: usize,
    b_idx: usize,
    env: &Env,
    limit: usize,
    frames: &mut Vec<ExpandFrame>,
    out: &mut Vec<Item>,
    truncated: &mut bool,
    pushed_child: &mut bool,
) {
    let block = &arena.blocks[bi];
    let br = &block.branches[b_idx];
    let other_masks = branch_masks(block, br.start, br.end);
    if br.children.is_empty() {
        out.push(Item {
            plan: VariantPlan { masks: other_masks, resolved_tags: block.tag_bytes.clone() },
            env: env.clone(),
            covered: vec![br.start],
        });
        return;
    }
    let _ = truncated;
    frames.push(ExpandFrame::BranchPost { bi, b_idx, other_masks, limit });
    push_seq_frame(frames, arena, &br.children, env.clone(), limit);
    *pushed_child = true;
}
