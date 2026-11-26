use crate::dep_callers_bash::CompoundKind;
use crate::dep_callers_bash_span::step_inline_hd_grp_close;
use crate::r5::bash_hd_bt::{
    HdMeta, and_list_tail_span_bang, blank_preserving_nl, extract_hd_body_subs_checked,
    find_dq_close, has_hdr_tail_ctrl, hd_tail_redir_and_spans, should_neutralize_meta,
};
use crate::r5::bash_hd_cond::apply_norm_inline_cond;
use crate::r5::bash_hd_unq::hd_header_tail_abort_span_bang;

pub(super) struct HdSlot {
    pub(super) subs: Vec<String>,
    pub(super) aborted: bool,
}

pub(super) type PendingGrp = (usize, usize, usize, u8, bool, usize, bool, bool);

pub(super) struct NormAbortCtx {
    pub(super) pending_grp: Option<PendingGrp>,
    pub(super) pending_grp_bangs: Vec<(usize, usize, usize, u8, bool)>,
    pub(super) pending_cond: Option<(usize, usize, CompoundKind, usize, bool)>,
    pub(super) cond_branch_open: Option<(usize, usize, usize, usize)>,
    pub(super) cond_alt_wait: Option<(usize, usize, usize)>,
    pub(super) abort_if_branch: Option<(usize, usize, usize)>,
    pub(super) abort_while_hd_body: Option<(usize, usize, usize)>,
    pub(super) cond_outer_bangs: Vec<bool>,
    pub(super) sub_sole_cmds: Vec<(usize, usize, u8)>,
    pub(super) cmd_ready: bool,
    pub(super) pending_case: Option<(usize, usize, usize, bool, bool)>,
    pub(super) case_esac_abort: Option<(usize, usize, usize, bool, bool)>,
    pub(super) case_outer_bangs: Vec<bool>,
}

impl Default for NormAbortCtx {
    fn default() -> Self {
        Self {
            pending_grp: None, pending_grp_bangs: Vec::new(), pending_cond: None,
            cond_branch_open: None, cond_alt_wait: None, abort_if_branch: None,
            abort_while_hd_body: None, cond_outer_bangs: Vec::new(),
            sub_sole_cmds: Vec::new(), cmd_ready: true, pending_case: None,
            case_esac_abort: None, case_outer_bangs: Vec::new(),
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn finalize_hd_meta(
    m: HdMeta,
    force_neutralize: bool,
    src: &str,
    slot_pfx: &str,
    hd_slots: &mut Vec<HdSlot>,
    edits: &mut Vec<(usize, usize, String)>,
    ctx: &mut NormAbortCtx,
) -> Option<usize> {
    let mut aborted_until = None;
    if should_neutralize_meta(&m, force_neutralize) {
        let (body_subs, aborted) = if !m.quoted && !m.body.is_empty() {
            extract_hd_body_subs_checked(&m.body, m.bt_depth, m.bt_mask)
        } else {
            (Vec::new(), false)
        };
        if !m.quoted && (!body_subs.is_empty() || aborted) {
            let idx = hd_slots.len();
            hd_slots.push(HdSlot { subs: body_subs, aborted });
            let mut repl = format!("<{slot_pfx}{idx}_");
            for _ in 0..src[m.hdr_start..m.hdr_end].bytes().filter(|&b| b == b'\n').count() {
                repl.push('\n');
            }
            edits.push((m.hdr_start, m.hdr_end, repl));
        } else {
            edits.push((m.hdr_start, m.hdr_end, blank_preserving_nl(&src[m.hdr_start..m.hdr_end])));
        }
        if !m.neutralize {
            for (bs, be) in m.body_lines {
                edits.push((bs, be, String::new()));
            }
        }
        if aborted && m.hdr_end <= m.hdr_line_end {
            let (sup_end, trailing_op, stop_ch, redir_spans, first_op) =
                hd_tail_redir_and_spans(src, m.hdr_end, m.hdr_line_end, false, m.in_bang);
            aborted_until = Some(sup_end);
            for (rs, re) in redir_spans {
                if re > rs { edits.push((rs, re, blank_preserving_nl(&src[rs..re]))); }
            }
            if let Some(fa) = first_op && sup_end > fa {
                edits.push((fa, sup_end, blank_preserving_nl(&src[fa..sup_end])));
            }
            if trailing_op && m.close_line_end < src.len() {
                let post_s = m.close_line_end + 1;
                let post_e = src[post_s..].find('\n').map_or(src.len(), |p| post_s + p);
                let (p_sup_end, _) = hd_header_tail_abort_span_bang(src, post_s, post_e, true, m.in_bang);
                if p_sup_end > post_s {
                    edits.push((post_s, p_sup_end, blank_preserving_nl(&src[post_s..p_sup_end])));
                }
            } else if !trailing_op {
                if stop_ch == Some(b';') && let Some((kind, idx)) = m.cond_ctx {
                    apply_norm_inline_cond(ctx, edits, src, (m.bt_depth, m.pd, kind, idx, m.in_bang), (sup_end, m.hdr_line_end));
                } else if matches!(stop_ch, Some(b')' | b'}' | b';')) && !m.outer_grp_bangs.is_empty()
                    && let Some((after_p, gk, bang, closed_cnt)) = step_inline_hd_grp_close(
                        &src[..m.hdr_line_end], sup_end, &m.outer_grp_bangs,
                        if stop_ch == Some(b')') && m.in_sub_sole && m.outer_grp_bangs[0].3 == 0 { false } else { m.in_bang },
                    )
                {
                    let (g_bt, g_pd, g_bg, _, _) = m.outer_grp_bangs[closed_cnt - 1];
                    let mut scan_p = after_p;
                    if matches!(gk, 2 | 4) && let Some(dq_end) = find_dq_close(&src[..m.hdr_line_end], scan_p) {
                        scan_p = dq_end + 1;
                    }
                    let b = src.as_bytes();
                    let mut ws_p = scan_p;
                    while ws_p < m.hdr_line_end && matches!(b[ws_p], b' ' | b'\t') { ws_p += 1; }
                    if let Some((ck, cidx, c_sd, c_bd)) = m.outer_cond && (g_pd, g_bg) == (c_sd, c_bd) {
                        if b.get(ws_p) == Some(&b';') {
                            apply_norm_inline_cond(ctx, edits, src, (g_bt, c_sd, ck, cidx, bang), (ws_p, m.hdr_line_end));
                        } else if ws_p == m.hdr_line_end || b[ws_p] == b'#' {
                            ctx.pending_cond = Some((g_bt, c_sd, ck, cidx, bang));
                        }
                    } else if closed_cnt == m.outer_grp_bangs.len() {
                        if let Some((as_, ae)) = and_list_tail_span_bang(src, after_p, gk, bang) {
                            edits.push((as_, ae, blank_preserving_nl(&src[as_..ae])));
                        } else if let Some((case_d, arm_matches)) = m.case_ctx {
                            ctx.pending_case = Some((g_bt, g_pd, case_d, arm_matches, bang));
                        }
                    } else if let Some(&(bt, pd, bg, _, _)) = m.outer_grp_bangs.get(closed_cnt - 1)
                        && let Some(&(_, _, _, cur_gk, _)) = m.outer_grp_bangs.get(closed_cnt)
                        && (ws_p == m.hdr_line_end || b[ws_p] == b'#')
                    {
                        ctx.pending_grp = Some((bt, pd, bg, cur_gk, false, 0, bang, true));
                        ctx.pending_grp_bangs = m.outer_grp_bangs[closed_cnt..].to_vec();
                    }
                } else if stop_ch.is_none() {
                    if let Some((kind, idx)) = m.cond_ctx {
                        ctx.pending_cond = Some((m.bt_depth, m.pd, kind, idx, m.in_bang));
                    } else if let Some((case_d, arm_matches)) = m.case_ctx {
                        ctx.pending_case = Some((m.bt_depth, m.pd, case_d, arm_matches, m.in_bang));
                    } else if let Some(g) = m.grp_ctx {
                        ctx.pending_grp = Some((g.0, g.1, g.2, g.3, false, 0, m.in_bang, true));
                        ctx.pending_grp_bangs = m.outer_grp_bangs;
                    }
                }
            }
        }
    }
    aborted_until
}

pub(super) fn flush_pending_meta(
    pending_meta: &mut Vec<HdMeta>,
    active_meta: &mut Vec<HdMeta>,
    src: &str,
    line_end: usize,
) {
    if pending_meta.len() >= 2 {
        for m in pending_meta.iter_mut() { m.neutralize = true; }
    }
    for m in pending_meta.iter_mut() {
        m.hdr_line_end = line_end;
        if m.hdr_end <= line_end && !m.hdr_tail_ctrl {
            m.hdr_tail_ctrl = has_hdr_tail_ctrl(&src[m.hdr_end..line_end]);
        }
    }
    active_meta.append(pending_meta);
}
