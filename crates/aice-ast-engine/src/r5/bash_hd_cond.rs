use crate::dep_callers_bash::{CaseTermKind, CompoundEvent, CompoundKind};
use crate::dep_callers_bash_span::{find_inline_cond_tail_span, find_inline_if_alt_tail_span};
use crate::dep_callers_quote::QuoteDepthTracker;
use crate::r5::bash_hd_bt::{and_list_tail_span_bang, blank_preserving_nl, find_dq_close};
use crate::r5::bash_hd_meta::NormAbortCtx;

impl NormAbortCtx {
    pub(super) fn on_enter_subshell(&mut self, bt: usize, pd: usize) {
        self.sub_sole_cmds.push((bt, pd, 0));
    }
    pub(super) fn on_subshell_cmd_start(&mut self, bt: usize, pd: usize, bg: usize) {
        if bg == 0
            && let Some(&mut (b, p, ref mut st)) = self.sub_sole_cmds.last_mut()
            && b == bt && p == pd
        {
            if *st == 0 { *st = 1; } else if *st == 2 { *st = 3; }
        }
    }
    pub(super) fn on_subshell_sep(&mut self, bt: usize, pd: usize, bg: usize, is_multi: bool) {
        if bg == 0
            && let Some(&mut (b, p, ref mut st)) = self.sub_sole_cmds.last_mut()
            && b == bt && p == pd
        {
            if is_multi { *st = 3; } else if *st == 1 { *st = 2; }
        }
    }
    pub(super) fn is_subshell_sole_cmd(&self, bt: usize, pd: usize) -> bool {
        self.sub_sole_cmds.iter().rev().find(|&&(b, p, _)| b == bt && p == pd).is_some_and(|&(_, _, st)| matches!(st, 1 | 2))
    }
    pub(super) fn prune_subshells(&mut self, bt: usize, pd: usize) {
        self.sub_sole_cmds.retain(|&(b, p, _)| b < bt || (b == bt && p <= pd));
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn step_norm_pending_grp(
    ctx: &mut NormAbortCtx,
    tr: &QuoteDepthTracker,
    bangs: &[(usize, usize, usize)],
    ch: char,
    (abs, after, src): (usize, usize, &str),
    was_sole_sub: bool,
    edits: &mut Vec<(usize, usize, String)>,
) {
    let Some((bd, pd, bg, gk, allow_semi, sup_until, grp_bang, from_hd)) = ctx.pending_grp else {
        return;
    };
    let (c_bt, c_pd, c_bg) = (tr.bash_bt_depth(), tr.bash_paren_depth(), tr.bash_brace_grp_depth());
    let cur_ctx = tr.bash_hd_group_ctx();
    let dropped = cur_ctx.is_none_or(|(cbd, cpd, cbg, _)| cbd < bd || cpd < pd || cbg < bg);
    if dropped && matches!(ch, ')' | '}' | '`') && (tr.quote.is_none() || (matches!(gk, 2 | 4) && tr.quote == Some('"'))) {
        let step_bang = if !ctx.pending_grp_bangs.is_empty() {
            ctx.pending_grp_bangs.remove(0).4
        } else {
            bangs.contains(&(c_bt, c_pd, c_bg))
        };
        let eff_grp_bang = if ch == ')' && gk == 0 && from_hd && was_sole_sub { false } else { grp_bang };
        let next_bang = eff_grp_bang ^ step_bang;
        let mut next_sup = if let Some((as_, ae)) = and_list_tail_span_bang(src, after, gk, next_bang) {
            edits.push((as_, ae, blank_preserving_nl(&src[as_..ae])));
            ae
        } else { 0 };
        if matches!(gk, 2 | 4) && tr.quote == Some('"') && let Some(dq_end) = find_dq_close(src, after) {
            next_sup = next_sup.max(dq_end + 1);
        }
        let next_from_hd = from_hd && !(ch == ')' && gk == 0);
        ctx.pending_grp = cur_ctx.map(|(cbd, cpd, cbg, cgk)| (cbd, cpd, cbg, cgk, true, next_sup, next_bang, next_from_hd));
        if ctx.pending_grp.is_none() {
            ctx.pending_grp_bangs.clear();
        }
        if next_sup == 0 && let Some((ck, cidx)) = tr.bash_in_cond() && ctx.pending_cond.is_none() {
            ctx.pending_cond = Some((c_bt, c_pd, ck, cidx, next_bang));
        } else if next_sup == 0 && let Some((cd, true)) = tr.bash_in_case_body() && ctx.pending_case.is_none() {
            ctx.pending_case = Some((c_bt, c_pd, cd, true, next_bang));
        }
    } else if abs < sup_until || ch.is_ascii_whitespace() {
    } else if allow_semi && ch == ';' {
        ctx.pending_grp = Some((bd, pd, bg, gk, false, sup_until, grp_bang, from_hd));
    } else {
        ctx.pending_grp = None;
        ctx.pending_grp_bangs.clear();
    }
}

pub(super) fn apply_norm_inline_cond(
    ctx: &mut NormAbortCtx,
    edits: &mut Vec<(usize, usize, String)>,
    src: &str,
    (bt, pd, kind, idx, in_bang): (usize, usize, CompoundKind, usize, bool),
    (semi_pos, line_end): (usize, usize),
) {
    if kind == CompoundKind::If {
        if !in_bang {
            if let Some((bs, end, closed)) = find_inline_cond_tail_span(&src[..line_end], semi_pos, kind) {
                if end > bs { edits.push((bs, end, blank_preserving_nl(&src[bs..end]))); }
                if !closed {
                    ctx.cond_branch_open = Some((bt, pd, idx, bs));
                    ctx.abort_if_branch = Some((bt, pd, idx));
                }
            }
        } else if let Some((bs, end, closed)) = find_inline_if_alt_tail_span(&src[..line_end], semi_pos) {
            if end > bs { edits.push((bs, end, blank_preserving_nl(&src[bs..end]))); }
            if !closed {
                if bs < end { ctx.cond_branch_open = Some((bt, pd, idx, bs)); }
                else { ctx.cond_alt_wait = Some((bt, pd, idx)); }
            }
        }
    } else if ((kind == CompoundKind::While && !in_bang) || (kind == CompoundKind::Until && in_bang))
        && let Some((bs, end, closed)) = find_inline_cond_tail_span(&src[..line_end], semi_pos, kind)
    {
        if end > bs { edits.push((bs, end, blank_preserving_nl(&src[bs..end]))); }
        if !closed {
            ctx.cond_branch_open = Some((bt, pd, idx, bs));
            ctx.abort_while_hd_body = Some((bt, pd, idx));
        }
    }
}

fn emit_norm_compound_exit(
    ctx: &mut NormAbortCtx,
    tr: &QuoteDepthTracker,
    pd_before: usize,
    abs_end: usize,
    src: &str,
    edits: &mut Vec<(usize, usize, String)>,
    final_bang: bool,
) {
    let (bt, pd) = (tr.bash_bt_depth(), tr.bash_paren_depth());
    if pd < pd_before {
        ctx.pending_grp = Some((bt, pd_before, tr.bash_brace_grp_depth(), 0, false, 0, final_bang, false));
    } else if let Some((as_, ae)) = and_list_tail_span_bang(src, abs_end, 0, final_bang) {
        edits.push((as_, ae, blank_preserving_nl(&src[as_..ae])));
    } else if let Some(g) = tr.bash_hd_group_ctx() {
        ctx.pending_grp = Some((g.0, g.1, g.2, g.3, true, 0, final_bang, false));
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn handle_norm_compound_event(
    ctx: &mut NormAbortCtx,
    tr: &mut QuoteDepthTracker,
    pd_before: usize,
    abs_end: usize,
    src: &str,
    edits: &mut Vec<(usize, usize, String)>,
) {
    let (bt, pd) = (tr.bash_bt_depth(), tr.bash_paren_depth());
    let ev = tr.bash_take_event();
    match ev {
        CompoundEvent::None => {}
        CompoundEvent::IfThen(idx, _) => {
            if let Some((b, p, k, i, in_bang)) = ctx.pending_cond
                && (b, p, k, i) == (bt, pd, CompoundKind::If, idx)
            {
                ctx.pending_cond = None;
                if in_bang {
                    ctx.cond_alt_wait = Some((bt, pd, idx));
                } else {
                    ctx.cond_branch_open = Some((bt, pd, idx, abs_end));
                    ctx.abort_if_branch = Some((bt, pd, idx));
                }
            }
        }
        CompoundEvent::WhileDo(idx) => {
            if let Some((b, p, k, i, in_bang)) = ctx.pending_cond
                && (b, p, i) == (bt, pd, idx)
                && matches!(k, CompoundKind::While | CompoundKind::Until)
            {
                ctx.pending_cond = None;
                let suppress = if k == CompoundKind::Until { in_bang } else { !in_bang };
                if suppress {
                    ctx.cond_branch_open = Some((bt, pd, idx, abs_end));
                    ctx.abort_while_hd_body = Some((bt, pd, idx));
                }
            }
        }
        CompoundEvent::IfElif(idx) | CompoundEvent::IfElse(idx) | CompoundEvent::IfFi(idx, _) | CompoundEvent::WhileDone(idx) => {
            if ctx.pending_cond.is_some_and(|(b, p, _, i, _)| b == bt && p == pd && i == idx) {
                ctx.pending_cond = None;
            }
            if let Some((b, p, i, b_start)) = ctx.cond_branch_open && (b, p, i) == (bt, pd, idx) {
                ctx.cond_branch_open = None;
                let kw_len = if matches!(ev, CompoundEvent::IfFi(_, _)) { 2 } else { 4 };
                let kw_start = abs_end.saturating_sub(kw_len);
                if kw_start > b_start {
                    edits.push((b_start, kw_start, blank_preserving_nl(&src[b_start..kw_start])));
                }
            }
            if let Some((b, p, i)) = ctx.cond_alt_wait && (b, p, i) == (bt, pd, idx) {
                ctx.cond_alt_wait = None;
                if matches!(ev, CompoundEvent::IfElif(_) | CompoundEvent::IfElse(_)) {
                    ctx.cond_branch_open = Some((bt, pd, idx, abs_end.saturating_sub(4)));
                }
            }
            if matches!(ev, CompoundEvent::IfElif(_) | CompoundEvent::IfElse(_))
                && ctx.abort_if_branch == Some((bt, pd, idx))
            {
                ctx.abort_if_branch = None;
            }
            if matches!(ev, CompoundEvent::IfFi(_, _)) {
                let outer_bang = ctx.cond_outer_bangs.pop().unwrap_or(false);
                if ctx.abort_if_branch == Some((bt, pd, idx)) {
                    ctx.abort_if_branch = None;
                    emit_norm_compound_exit(ctx, tr, pd_before, abs_end, src, edits, !outer_bang);
                }
            } else if matches!(ev, CompoundEvent::WhileDone(_)) {
                let outer_bang = ctx.cond_outer_bangs.pop().unwrap_or(false);
                if ctx.abort_while_hd_body == Some((bt, pd, idx)) {
                    ctx.abort_while_hd_body = None;
                    emit_norm_compound_exit(ctx, tr, pd_before, abs_end, src, edits, !outer_bang);
                }
            }
        }
        CompoundEvent::CaseArm(cd, all_nonmatch) => {
            if !all_nonmatch && ctx.case_esac_abort.is_some_and(|(b, p, c, w, _)| (b, p, c, w) == (bt, pd, cd, true)) {
                ctx.case_esac_abort = None;
            }
        }
        CompoundEvent::CaseTerm(cd, kind) => match kind {
            CaseTermKind::Dsemi => {
                if let Some((b, p, c, true, ab)) = ctx.pending_case && (b, p, c) == (bt, pd, cd) {
                    ctx.pending_case = None;
                    ctx.case_esac_abort = Some((bt, pd, cd, false, ab));
                } else if ctx.pending_case.is_some_and(|(b, p, c, _, _)| (b, p, c) == (bt, pd, cd)) {
                    ctx.pending_case = None;
                }
            }
            CaseTermKind::SemiAmp => {
                if ctx.pending_case.is_some_and(|(b, p, c, _, _)| (b, p, c) == (bt, pd, cd)) { ctx.pending_case = None; }
                if ctx.case_esac_abort.is_some_and(|(b, p, c, _, _)| (b, p, c) == (bt, pd, cd)) { ctx.case_esac_abort = None; }
            }
            CaseTermKind::DsemiAmp => {
                if let Some((b, p, c, false, ab)) = ctx.case_esac_abort && (b, p, c) == (bt, pd, cd) {
                    ctx.case_esac_abort = Some((bt, pd, cd, true, ab));
                } else if ctx.pending_case.is_some_and(|(b, p, c, _, _)| (b, p, c) == (bt, pd, cd)) {
                    ctx.pending_case = None;
                }
            }
        },
        CompoundEvent::CaseEsac(cd) => {
            let match_pd = if pd > pd_before || tr.bash_paren_depth() < pd_before { pd_before } else { pd };
            let arm_bang = ctx.case_esac_abort
                .filter(|&(b, p, c, _, _)| (b, p, c) == (bt, match_pd, cd))
                .map(|(_, _, _, _, ab)| ab)
                .or_else(|| {
                    ctx.pending_case
                        .filter(|&(b, p, c, m, _)| (b, p, c, m) == (bt, match_pd, cd, true))
                        .map(|(_, _, _, _, ab)| ab)
                });
            if ctx.case_esac_abort.is_some_and(|(b, p, c, _, _)| (b, p, c) == (bt, match_pd, cd)) { ctx.case_esac_abort = None; }
            if ctx.pending_case.is_some_and(|(b, p, c, _, _)| (b, p, c) == (bt, match_pd, cd)) { ctx.pending_case = None; }
            let outer_bang = ctx.case_outer_bangs.pop().unwrap_or(false);
            if let Some(ab) = arm_bang {
                emit_norm_compound_exit(ctx, tr, pd_before, abs_end, src, edits, outer_bang ^ ab);
            }
        }
    }
}
