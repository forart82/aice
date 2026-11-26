use crate::dep_callers_bash_abort::{BashAbortState, BashBufs};
use crate::dep_callers_bash_cont::ContLineAccum;
use crate::dep_callers_bash_hd::{
    HdHdrMeta, HeredocSubKind, HeredocSubState, mask_hd_header_tail, mask_unclosed_hd_sub,
};
use crate::dep_callers_bash_hd_line::step_heredoc_unquoted_line;
use crate::dep_callers_bash_strip::{BashStripState, PendingHdCol};
use crate::dep_callers_heredoc::{HeredocLine, HeredocTracker};
use crate::dep_callers_span::StripCfg;
use crate::dep_callers_strip::{ScanState, strip_line_bash};

fn on_hd_close(
    hd_sub: &Option<HeredocSubState>,
    active_hd_hdrs: &mut Vec<HdHdrMeta>,
    imp_lines: &mut [String],
    code_lines: &mut [String],
    abort: &mut BashAbortState,
    bt_depth: usize,
) {
    if !active_hd_hdrs.is_empty() {
        let meta = active_hd_hdrs.remove(0);
        if meta.aborted || hd_sub.as_ref().is_some_and(|s| s.kind == HeredocSubKind::Param) {
            let (ln, bd, pd) = (meta.line, meta.bt_depth, meta.paren_depth);
            if let Some(sup_end) = mask_hd_header_tail(imp_lines, code_lines, abort, meta, bt_depth) {
                for h in active_hd_hdrs.iter_mut() {
                    if h.line == ln && h.bt_depth == bd && h.paren_depth == pd && h.col <= sup_end {
                        h.suppressed = true;
                    }
                }
            }
        }
    }
}

pub(crate) fn strip_bash_source(src: &str, cfg: &StripCfg) -> (Vec<String>, Vec<String>) {
    let mut state = ScanState::Code;
    let mut bash = BashStripState::new();
    let mut abort = BashAbortState::default();
    let mut heredoc = HeredocTracker::default();
    let (mut hd_sub, mut hd_sub_line): (Option<HeredocSubState>, Option<(usize, usize, usize)>) = (None, None);
    let mut active_hd_hdrs: Vec<HdHdrMeta> = Vec::new();
    let (mut imp_lines, mut code_lines) = (Vec::new(), Vec::new());
    let (mut acc, mut hd_acc) = (ContLineAccum::default(), ContLineAccum::default());
    for raw in src.lines() {
        let mut start_i = 0usize;
        if acc.cont_slots == 0 && matches!(state, ScanState::Code) {
            let hd_bt_ctx = heredoc.active.first().map_or((0, 0), |h| (h.bt_depth, h.bt_mask));
            let active_before = heredoc.active.len();
            match heredoc.step_bash_line_bt(raw) {
                (HeredocLine::DelimiterOrQuoted, None) => {
                    if heredoc.active.len() < active_before {
                        hd_acc.flush_eof(&mut imp_lines, &mut code_lines);
                        on_hd_close(&hd_sub, &mut active_hd_hdrs, &mut imp_lines, &mut code_lines, &mut abort, bash.bt_depth());
                        mask_unclosed_hd_sub(&mut hd_sub, &mut hd_sub_line, &mut imp_lines, &mut code_lines, None);
                    }
                    imp_lines.push(String::new());
                    code_lines.push(String::new());
                    continue;
                }
                (HeredocLine::DelimiterOrQuoted, Some(j)) => {
                    hd_acc.flush_eof(&mut imp_lines, &mut code_lines);
                    while active_hd_hdrs.len() > heredoc.active.len() {
                        if let Some(idx) = active_hd_hdrs.iter().position(|m| m.bt_depth > heredoc.active.last().map_or(0, |h| h.bt_depth)) {
                            let meta = active_hd_hdrs.remove(idx);
                            if meta.aborted || hd_sub.as_ref().is_some_and(|s| s.kind == HeredocSubKind::Param) {
                                mask_hd_header_tail(&mut imp_lines, &mut code_lines, &mut abort, meta, bash.bt_depth());
                            }
                        } else {
                            on_hd_close(&hd_sub, &mut active_hd_hdrs, &mut imp_lines, &mut code_lines, &mut abort, bash.bt_depth());
                        }
                    }
                    mask_unclosed_hd_sub(&mut hd_sub, &mut hd_sub_line, &mut imp_lines, &mut code_lines, None);
                    for _ in 0..j { acc.cur_imp.push(' '); acc.cur_code.push(' '); }
                    start_i = j;
                }
                (HeredocLine::UnquotedBody, bt_cut) => {
                    if active_hd_hdrs.first().is_some_and(|m| m.suppressed) {
                        if let Some(j) = bt_cut {
                            while active_hd_hdrs.len() > heredoc.active.len() {
                                active_hd_hdrs.pop();
                            }
                            for _ in 0..j { acc.cur_imp.push(' '); acc.cur_code.push(' '); }
                            start_i = j;
                        } else {
                            hd_acc.flush_eof(&mut imp_lines, &mut code_lines);
                            imp_lines.push(String::new());
                            code_lines.push(String::new());
                            continue;
                        }
                    } else {
                    let mut work_buf = String::new();
                    let ansi_sq = hd_sub
                        .as_ref()
                        .map(HeredocSubState::leaf)
                        .is_some_and(|s| matches!(s.state, ScanState::BashSq { ansi_c: true }));
                    let (work, skip_bs) = hd_acc.prepare(raw, ansi_sq, &mut work_buf);
                    let cur_ln = imp_lines.len();
                    let prefix_len = work.len() - raw.len();
                    let slice = bt_cut.map_or(work, |j| &work[..prefix_len + j]);
                    let mut param_aborted = false;
                    let step_res = step_heredoc_unquoted_line(
                        slice, cfg, &mut hd_sub, &mut hd_acc, skip_bs, &mut hd_sub_line,
                        cur_ln, hd_bt_ctx, bt_cut.is_none(), &mut param_aborted, (&mut imp_lines, &mut code_lines),
                    );
                    if param_aborted && let Some(m) = active_hd_hdrs.first_mut() { m.aborted = true; }
                    if let Some((bs, bt_d, dq_ctx, in_code, td, tlt)) = step_res {
                        if tlt != 9 {
                            hd_acc.on_cont(bs, bt_d, dq_ctx, in_code, td, tlt);
                        }
                        continue;
                    }
                    if let Some(j) = bt_cut {
                        while active_hd_hdrs.len() > heredoc.active.len() {
                            if let Some(idx) = active_hd_hdrs.iter().position(|m| m.bt_depth > heredoc.active.last().map_or(0, |h| h.bt_depth)) {
                                let m = active_hd_hdrs.remove(idx);
                                if m.aborted || hd_sub.as_ref().is_some_and(|s| s.kind == HeredocSubKind::Param) {
                                    mask_hd_header_tail(&mut imp_lines, &mut code_lines, &mut abort, m, bash.bt_depth());
                                }
                            } else {
                                active_hd_hdrs.pop();
                            }
                        }
                        mask_unclosed_hd_sub(&mut hd_sub, &mut hd_sub_line, &mut imp_lines, &mut code_lines, Some(&mut hd_acc));
                        acc.cont_slots += std::mem::take(&mut hd_acc.cont_slots);
                        acc.cur_imp.push_str(&std::mem::take(&mut hd_acc.cur_imp));
                        acc.cur_code.push_str(&std::mem::take(&mut hd_acc.cur_code));
                        start_i = j;
                    } else {
                        let (is_sq, bt_d) = hd_sub
                            .as_ref()
                            .map(HeredocSubState::leaf)
                            .map_or((false, 0), |s| {
                                (matches!(s.state, ScanState::BashSq { ansi_c: true }), s.bash.bt_depth())
                            });
                        hd_acc.finish_line(work, is_sq, bt_d, &mut imp_lines, &mut code_lines);
                        continue;
                    }
                    }
                }
                (HeredocLine::NotActive, _) => {}
            }
        }
        let mut work_buf = String::new();
        let (work, skip_bs) = acc.prepare(raw, matches!(state, ScanState::BashSq { ansi_c: true }), &mut work_buf);
        let prev_joined = acc.prev_joined();
        let eol_bs = {
            let mut bufs = BashBufs {
                imp_lines: &mut imp_lines,
                code_lines: &mut code_lines,
                imp: &mut acc.cur_imp,
                code: &mut acc.cur_code,
            };
            strip_line_bash(
                work, start_i, cfg, &mut state, &mut bash, &mut abort, &mut heredoc,
                prev_joined, None, skip_bs, true, &mut bufs,
            ).1
        };
        active_hd_hdrs.retain(|m| m.bt_depth <= bash.bt_depth());
        if let Some(bs) = eol_bs {
            let in_code = matches!(state, ScanState::Code);
            let in_sq = matches!(state, ScanState::BashSq { .. });
            if !bash.in_hd_multiline() && let Some((snap, ip, cp)) = bash.take_hd_snap()
                && acc.on_cont_hd(bs, bash.bt_depth(), in_sq, ip, cp)
            {
                bash = snap;
                state = ScanState::Code;
            } else {
                let (td, tlt) = bash.trail_state(bs, in_code);
                if !in_code && tlt == 7 { state = ScanState::Code; }
                acc.on_cont(bs, bash.bt_depth(), (matches!(state, ScanState::BashDq), bash.dq.in_ansi_sq()), in_code, td, tlt);
            }
        } else {
            if matches!(state, ScanState::Code) {
                while bash.pending_hd_cols.len() < heredoc.pending.len() {
                    let idx = bash.pending_hd_cols.len();
                    let bt_d = heredoc.pending[idx].bt_depth;
                    let pd = bash.paren_depth();
                    let bg = bash.case.brace_grp_depth();
                    let in_bt_top = bash.case.is_bt_top();
                    bash.pending_hd_cols.push(PendingHdCol {
                        bt_depth: bt_d,
                        col: acc.cur_imp.len(),
                        paren_depth: pd,
                        brace_grp_depth: bg,
                        in_inner_brace_grp: bash.case.in_inner_brace_grp(),
                        in_cond: bash.case.in_cond(),
                        outer_cond: bash.case.outer_cond_for_grp(),
                        outer_grp_bangs: bash.case.hd_group_outer_bangs(abort.bang_slice(), bash.bt_base),
                        in_case_arm: bash.case.in_case_body(),
                        cmd_id: abort.cur_cmd_id,
                        pre_suppressed: abort.has_active_floor_at(bt_d, pd),
                        in_bang: abort.has_bang_at(bt_d, pd, bg),
                        in_bt_top,
                    });
                }
                for h in bash.pending_hd_cols.drain(..) {
                    active_hd_hdrs.push(HdHdrMeta {
                        bt_depth: h.bt_depth,
                        line: imp_lines.len(),
                        col: h.col,
                        paren_depth: h.paren_depth,
                        brace_grp_depth: h.brace_grp_depth,
                        in_inner_brace_grp: h.in_inner_brace_grp,
                        in_cond: h.in_cond,
                        outer_cond: h.outer_cond,
                        outer_grp_bangs: h.outer_grp_bangs,
                        in_case_arm: h.in_case_arm,
                        aborted: false,
                        suppressed: h.pre_suppressed,
                        in_bang: h.in_bang,
                        in_bt_top: h.in_bt_top,
                    });
                }
                heredoc.flush_pending();
            }
            acc.finish_line(
                work,
                matches!(state, ScanState::BashSq { ansi_c: true }),
                bash.bt_depth(),
                &mut imp_lines,
                &mut code_lines,
            );
        }
    }
    hd_acc.flush_eof(&mut imp_lines, &mut code_lines);
    acc.flush_eof(&mut imp_lines, &mut code_lines);
    if !active_hd_hdrs.is_empty() && (active_hd_hdrs[0].aborted || hd_sub.as_ref().is_some_and(|s| s.kind == HeredocSubKind::Param)) {
        let meta = active_hd_hdrs.remove(0);
        mask_hd_header_tail(&mut imp_lines, &mut code_lines, &mut abort, meta, bash.bt_depth());
    }
    if bash.dq.has_sq() {
        let mut bufs = BashBufs {
            imp_lines: &mut imp_lines,
            code_lines: &mut code_lines,
            imp: &mut acc.cur_imp,
            code: &mut acc.cur_code,
        };
        abort.mask_sq_snap(&mut bufs);
    }
    (imp_lines, code_lines)
}
