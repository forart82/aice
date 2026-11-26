use std::collections::{HashMap, HashSet};

use crate::r5::twig_html_balance::{
    ScopeCtx, SimState, StateMap, StateMeta, apply_range, collect_scope_conds, err_at, lookup_env,
    merge_pruned, set_env,
};
use crate::r5::twig_html_scan::ScanMode;
use crate::r5::twig_html_tree::{CtrlArena, CtrlKind, pos_to_line_col};

enum EvalFrame {
    ScopeEnd {
        scope_start: usize,
        entry_mode: ScanMode,
        saved_counts: HashMap<usize, usize>,
        saved_last: HashMap<usize, usize>,
    },
    Branch {
        br_idx: usize,
        child_idx: usize,
        cur_pos: usize,
        states: StateMap,
    },
    ForLoop {
        br_idx: usize,
        child_idx: usize,
        states: StateMap,
        cur_pos: usize,
        pending: Vec<(usize, ScanMode, usize)>,
    },
    IfLoop {
        br_idx: usize,
        child_idx: usize,
        child_end: usize,
        has_else: bool,
        branches: Vec<usize>,
        items: Vec<(SimState, StateMeta)>,
        s_pos: usize,
        b_pos: usize,
        cur_env: Vec<(usize, bool)>,
        forced_true: bool,
        in_branch: bool,
        pending_env_false: Option<usize>,
        next_map: StateMap,
    },
}

fn push_scope(
    frames: &mut Vec<EvalFrame>,
    arena: &CtrlArena,
    scope_br: usize,
    entry_mode: ScanMode,
    entry_skip: usize,
    ctx: &mut ScopeCtx<'_>,
) {
    let saved_counts = std::mem::take(&mut ctx.counts);
    let saved_last = std::mem::take(&mut ctx.last_end);
    collect_scope_conds(arena, scope_br, &mut ctx.conds, &mut ctx.counts, &mut ctx.last_end);
    let mut init = StateMap::new();
    init.insert(
        SimState { stack: Vec::new(), env: Vec::new(), mode: entry_mode, skip_until: entry_skip },
        StateMeta::default(),
    );
    let br = &arena.branches[scope_br];
    frames.push(EvalFrame::ScopeEnd { scope_start: br.start, entry_mode, saved_counts, saved_last });
    frames.push(EvalFrame::Branch { br_idx: scope_br, child_idx: 0, cur_pos: br.start, states: init });
}

pub(crate) fn eval_all(arena: &CtrlArena, root_br: usize, ctx: &mut ScopeCtx<'_>) {
    let mut frames = Vec::new();
    push_scope(&mut frames, arena, root_br, ScanMode::Normal, 0, ctx);
    let mut ret: Option<StateMap> = None;
    while let Some(frame) = frames.pop() {
        match frame {
            EvalFrame::ScopeEnd { scope_start, entry_mode, saved_counts, saved_last } => {
                let final_states = ret.take().unwrap_or_default();
                for (st, meta) in final_states {
                    for (&tid, &pos) in st.stack.iter().zip(&meta.open_pos) {
                        let (line, col) = pos_to_line_col(ctx.line_starts, pos);
                        ctx.errs.push(err_at(line, col, format!("Unclosed tag '<{}>'", ctx.tags.name(tid))));
                    }
                    if st.mode == ScanMode::Comment && entry_mode != ScanMode::Comment {
                        let (line, col) = pos_to_line_col(ctx.line_starts, meta.comment_pos.unwrap_or(scope_start));
                        ctx.errs.push(err_at(line, col, "Unterminated comment '<!--'".to_string()));
                    } else if st.mode != entry_mode && entry_mode != ScanMode::Normal {
                        let (line, col) = pos_to_line_col(ctx.line_starts, scope_start);
                        ctx.errs.push(err_at(line, col, "Unbalanced HTML rawtext/comment inside loop".to_string()));
                    }
                }
                ctx.counts = saved_counts;
                ctx.last_end = saved_last;
            }
            EvalFrame::Branch { br_idx, child_idx, cur_pos, mut states } => {
                let br = &arena.branches[br_idx];
                if child_idx >= br.children.len() {
                    ret = Some(apply_range(cur_pos, br.end, states, ctx));
                    continue;
                }
                let child = &arena.blocks[br.children[child_idx]];
                states = apply_range(cur_pos, child.start, states, ctx);
                if child.kind == CtrlKind::For {
                    let mut seen = HashSet::new();
                    let mut tasks = Vec::new();
                    for st in states.keys() {
                        if seen.insert((st.mode, st.skip_until)) {
                            if let Some(&body) = child.branches.first() {
                                tasks.push((body, st.mode, st.skip_until));
                            }
                            if child.has_else && let Some(&else_br) = child.branches.get(1) {
                                tasks.push((else_br, st.mode, st.skip_until));
                            }
                        }
                    }
                    tasks.reverse();
                    frames.push(EvalFrame::ForLoop {
                        br_idx, child_idx: child_idx + 1, states, cur_pos: child.end, pending: tasks,
                    });
                } else {
                    let items: Vec<(SimState, StateMeta)> = states.into_iter().collect();
                    let cur_env = items.first().map(|(st, _)| st.env.clone()).unwrap_or_default();
                    frames.push(EvalFrame::IfLoop {
                        br_idx, child_idx: child_idx + 1, child_end: child.end,
                        has_else: child.has_else, branches: child.branches.clone(),
                        items, s_pos: 0, b_pos: 0, cur_env, forced_true: false,
                        in_branch: false, pending_env_false: None, next_map: StateMap::new(),
                    });
                }
            }
            EvalFrame::ForLoop { br_idx, child_idx, states, cur_pos, mut pending } => {
                if let Some((sub_br, mode, skip)) = pending.pop() {
                    frames.push(EvalFrame::ForLoop { br_idx, child_idx, states, cur_pos, pending });
                    push_scope(&mut frames, arena, sub_br, mode, skip, ctx);
                } else {
                    frames.push(EvalFrame::Branch { br_idx, child_idx, cur_pos, states });
                }
            }
            EvalFrame::IfLoop {
                br_idx, child_idx, child_end, has_else, branches, items, mut s_pos,
                mut b_pos, mut cur_env, mut forced_true, in_branch,
                mut pending_env_false, mut next_map,
            } => {
                if in_branch {
                    let sub_res = ret.take().unwrap_or_default();
                    merge_pruned(&mut next_map, sub_res, child_end, &ctx.last_end);
                    if let Some(cid) = pending_env_false.take() {
                        set_env(&mut cur_env, cid, false);
                    }
                }
                let mut pushed_sub: Option<(usize, Vec<(usize, bool)>)> = None;
                while s_pos < items.len() {
                    while b_pos < branches.len() {
                        let sub_br = branches[b_pos];
                        b_pos += 1;
                        let cid_opt = arena.branches[sub_br]
                            .cond
                            .as_deref()
                            .and_then(|c| ctx.conds.get_id(c))
                            .filter(|cid| ctx.counts.get(cid).copied().unwrap_or(0) >= 2);
                        if let Some(cid) = cid_opt {
                            match lookup_env(&cur_env, cid) {
                                Some(true) => {
                                    forced_true = true;
                                    b_pos = branches.len();
                                    pushed_sub = Some((sub_br, cur_env.clone()));
                                    break;
                                }
                                Some(false) => continue,
                                None => {
                                    let mut t_env = cur_env.clone();
                                    set_env(&mut t_env, cid, true);
                                    pending_env_false = Some(cid);
                                    pushed_sub = Some((sub_br, t_env));
                                    break;
                                }
                            }
                        } else {
                            pushed_sub = Some((sub_br, cur_env.clone()));
                            break;
                        }
                    }
                    if pushed_sub.is_some() {
                        break;
                    }
                    if !has_else && !forced_true {
                        let mut single = StateMap::new();
                        let (st, meta) = &items[s_pos];
                        let mut nxt = st.clone();
                        nxt.env = cur_env.clone();
                        single.insert(nxt, meta.clone());
                        merge_pruned(&mut next_map, single, child_end, &ctx.last_end);
                    }
                    s_pos += 1;
                    b_pos = 0;
                    forced_true = false;
                    if s_pos < items.len() {
                        cur_env = items[s_pos].0.env.clone();
                    }
                }
                if let Some((sub_br, sub_env)) = pushed_sub {
                    let (st, meta) = &items[s_pos];
                    let mut nxt = st.clone();
                    nxt.env = sub_env;
                    let mut single = StateMap::new();
                    single.insert(nxt, meta.clone());
                    frames.push(EvalFrame::IfLoop {
                        br_idx, child_idx, child_end, has_else, branches, items, s_pos,
                        b_pos, cur_env, forced_true, in_branch: true, pending_env_false, next_map,
                    });
                    frames.push(EvalFrame::Branch {
                        br_idx: sub_br, child_idx: 0, cur_pos: arena.branches[sub_br].start, states: single,
                    });
                } else {
                    frames.push(EvalFrame::Branch { br_idx, child_idx, cur_pos: child_end, states: next_map });
                }
            }
        }
    }
}
