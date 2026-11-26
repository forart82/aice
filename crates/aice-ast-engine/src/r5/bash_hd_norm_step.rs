use crate::dep_callers_bash_cont::{bash_dq_eol_surviving_bs, bash_eol_surviving_bs};
use crate::dep_callers_heredoc::{HeredocLine, HeredocTracker};
use crate::dep_callers_quote::QuoteDepthTracker;
use crate::r5::bash_hd_bt::{HdMeta, should_neutralize_meta};
use crate::r5::bash_hd_delim::CoalesceHdDelim;
use crate::r5::bash_hd_meta::{
    HdSlot, NormAbortCtx, finalize_hd_meta, flush_pending_meta,
};

pub(super) fn sync_norm_case_bangs(
    ctx: &mut NormAbortCtx,
    cases_before: usize,
    conds_before: usize,
    tr: &mut QuoteDepthTracker,
    bangs: &mut Vec<(usize, usize, usize)>,
) {
    let cur = tr.bash_case_depth();
    if cur > cases_before {
        let key = (tr.bash_bt_depth(), tr.bash_paren_depth(), tr.bash_brace_grp_depth());
        let had = bangs.contains(&key);
        bangs.retain(|&x| x != key);
        ctx.case_outer_bangs.push(had);
    } else if cur < cases_before && ctx.case_outer_bangs.len() > cur {
        ctx.case_outer_bangs.truncate(cur);
    }
    let cur_conds = tr.bash_cond_depth();
    if cur_conds > conds_before {
        let key = (tr.bash_bt_depth(), tr.bash_paren_depth(), tr.bash_brace_grp_depth());
        let had = bangs.contains(&key);
        bangs.retain(|&x| x != key);
        ctx.cond_outer_bangs.push(had);
    } else if cur_conds < conds_before && ctx.cond_outer_bangs.len() > cur_conds {
        ctx.cond_outer_bangs.truncate(cur_conds);
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_bt_cut_active_meta(
    hd: &HeredocTracker,
    active_meta: &mut Vec<HdMeta>,
    hl: HeredocLine,
    j: usize,
    line_start: usize,
    line: &str,
    force_neutralize: bool,
    src: &str,
    slot_pfx: &str,
    hd_slots: &mut Vec<HdSlot>,
    edits: &mut Vec<(usize, usize, String)>,
    ctx: &mut NormAbortCtx,
) {
    let keep = hd.active.len();
    if active_meta.len() <= keep { return; }
    let mut drained: Vec<HdMeta> = active_meta.drain(keep..).collect();
    if let Some(head_m) = drained.first_mut() {
        if hl == HeredocLine::UnquotedBody && !head_m.quoted && j > 0 {
            head_m.body.push_str(&line[..j]);
            head_m.body.push('\n');
            head_m.body_lines.push((line_start, line_start + j));
        } else if hl == HeredocLine::DelimiterOrQuoted && j > 0 && should_neutralize_meta(head_m, force_neutralize) {
            edits.push((line_start, line_start + j, String::new()));
        }
    }
    for m in drained {
        finalize_hd_meta(m, force_neutralize, src, slot_pfx, hd_slots, edits, ctx);
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn step_active_hd_line(
    hd: &mut HeredocTracker,
    active_meta: &mut Vec<HdMeta>,
    bt_cont_active: bool,
    line: &str,
    line_start: usize,
    line_end: usize,
    has_nl: bool,
    force_neutralize: bool,
    src: &str,
    slot_pfx: &str,
    hd_slots: &mut Vec<HdSlot>,
    edits: &mut Vec<(usize, usize, String)>,
    ctx: &mut NormAbortCtx,
) -> Option<usize> {
    if bt_cont_active {
        return Some(0);
    }
    let active_before = hd.active.len();
    let head_before = hd.active.first().cloned();
    match hd.step_bash_line_bt(line) {
        (HeredocLine::NotActive, _) => Some(0),
        (hl, Some(j)) => {
            handle_bt_cut_active_meta(
                hd, active_meta, hl, j, line_start, line, force_neutralize, src, slot_pfx, hd_slots, edits, ctx,
            );
            Some(j)
        }
        (_, None) => {
            if let Some(head) = head_before {
                if hd.active.len() < active_before {
                    let mut meta = active_meta.remove(0);
                    meta.close_line_end = line_end;
                    if should_neutralize_meta(&meta, force_neutralize) {
                        edits.push((line_start, line_end, String::new()));
                    }
                    let (hle, bd, he) = (meta.hdr_line_end, meta.bt_depth, meta.hdr_end);
                    if let Some(sup_end) =
                        finalize_hd_meta(meta, force_neutralize, src, slot_pfx, hd_slots, edits, ctx)
                    {
                        for next_m in active_meta.iter_mut() {
                            if next_m.hdr_line_end == hle && next_m.bt_depth == bd
                                && next_m.hdr_start >= he && next_m.hdr_start < sup_end
                            {
                                next_m.quoted = true;
                                next_m.body.clear();
                            }
                        }
                    }
                } else if hd.active.len() == active_before {
                    let meta = active_meta.first_mut().unwrap();
                    if meta.neutralize {
                        if !meta.quoted {
                            meta.body.push_str(line);
                            meta.body.push('\n');
                        }
                        edits.push((line_start, line_end, String::new()));
                    } else {
                        if force_neutralize && !meta.quoted {
                            meta.body.push_str(line);
                            meta.body.push('\n');
                            meta.body_lines.push((line_start, line_end));
                        }
                        let false_delim = !head.delim.is_empty()
                            && line.trim_start_matches([' ', '\t']).starts_with(&head.delim)
                            && !(hd.in_cont_delim() && has_nl && hd.cont_chain_closes(src, line_end + 1));
                        let odd_bs = head.bt_depth == 0
                            && head.quoted
                            && line.as_bytes().iter().rev().take_while(|&&c| c == b'\\').count() % 2 == 1;
                        if false_delim || odd_bs {
                            let repl = if head.quoted {
                                if head.delim == "x" { "y" } else { "x" }.to_string()
                            } else {
                                let pfx = if head.delim.starts_with('x') { 'y' } else { 'x' };
                                format!("{pfx}{line}")
                            };
                            edits.push((line_start, line_end, repl));
                        }
                    }
                }
            }
            None
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn try_carry_hd_bt_cont(
    dl: &mut CoalesceHdDelim,
    tr: &mut QuoteDepthTracker,
    arith: &mut Vec<usize>,
    work: &str,
    rel_start: usize,
    carry_len: usize,
    line_start: usize,
    saved_hdr_start: Option<usize>,
    (bs, d, in_sq, in_dq, ansi_sq): (usize, usize, bool, bool, bool),
) -> Option<(usize, String)> {
    let raw_hd_pos = dl.cont_hd_start()?;
    let (hd_work, hs) = if carry_len == 0 {
        (raw_hd_pos.saturating_sub(line_start), raw_hd_pos)
    } else {
        let hs = if raw_hd_pos < carry_len {
            saved_hdr_start.unwrap_or(line_start)
        } else {
            line_start + raw_hd_pos - carry_len
        };
        (raw_hd_pos, hs)
    };
    if hd_work < rel_start || hd_work > work.len() - bs {
        return None;
    }
    let surv = if in_dq { bash_dq_eol_surviving_bs(bs, d, ansi_sq) } else { bash_eol_surviving_bs(bs, d, in_sq) };
    let mut next_carry = work[hd_work..work.len() - bs].to_string();
    for _ in 0..surv { next_carry.push('\\'); }
    if let Some((snap_tr, snap_arith, _)) = dl.take_snap() {
        *tr = snap_tr;
        *arith = snap_arith;
    } else {
        tr.bash_end_continuation(bs);
        if let Some(q) = tr.quote { tr.step(q, None); }
    }
    *dl = CoalesceHdDelim::default();
    Some((hs, next_carry))
}

pub(super) fn finalize_hd_edits(
    mut pending_meta: Vec<HdMeta>,
    mut active_meta: Vec<HdMeta>,
    mut edits: Vec<(usize, usize, String)>,
    mut hd_slots: Vec<HdSlot>,
    force_neutralize: bool,
    src: &str,
    slot_pfx: &str,
) -> Option<(String, Vec<HdSlot>)> {
    if !pending_meta.is_empty() {
        flush_pending_meta(&mut pending_meta, &mut active_meta, src, src.len());
    }
    let mut dummy = NormAbortCtx::default();
    for m in active_meta {
        finalize_hd_meta(m, force_neutralize, src, slot_pfx, &mut hd_slots, &mut edits, &mut dummy);
    }
    if edits.is_empty() {
        return None;
    }
    edits.sort_by_key(|e| e.0);
    let mut out = String::with_capacity(src.len() + 8);
    let mut copied_until = 0usize;
    for (s, e, repl) in edits {
        if s >= copied_until && e <= src.len() {
            out.push_str(&src[copied_until..s]);
            out.push_str(&repl);
            copied_until = e;
        }
    }
    out.push_str(&src[copied_until..]);
    Some((out, hd_slots))
}
