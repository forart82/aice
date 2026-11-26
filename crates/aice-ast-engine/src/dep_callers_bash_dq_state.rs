use crate::dep_callers_bash_abort::{BashAbortState, BashBufs, SnapKind};
use crate::dep_callers_bash_bt::{EscDqBsAction, classify_esc_dq_bs};
use crate::dep_callers_bash_cont::step_bash_sq;
use crate::dep_callers_bash_delim::{mask_bash_hd, mask_tail_spaces};
use crate::dep_callers_bash_hd::{HeredocSubKind, heredoc_sub_done};
use crate::dep_callers_bash_strip::BashStripState;
use crate::dep_callers_heredoc::HeredocTracker;
use crate::dep_callers_strip::ScanState;

impl BashStripState {
    pub(super) fn step_dq_esc_bs(
        &mut self,
        raw: &str,
        b: &[u8],
        i: &mut usize,
        abort: &mut BashAbortState,
        bufs: &mut BashBufs<'_>,
    ) -> Option<(usize, Option<ScanState>, Option<usize>, bool)> {
        let mut bs = 0usize;
        while *i + bs < b.len() && b[*i + bs] == b'\\' { bs += 1; }
        if crate::dep_callers_bash_hd::keep_bt_dollar(b, *i + bs, bs, self.bt_depth()) { self.trail_lt = 0; }
        else { (self.trail_dollar, self.trail_lt) = (false, 0); self.dq.reset_dollar(); }
        let was_bad_dq = self.dq.in_bad_sub();
        let (prev_bt, prev_pd) = (self.bt_depth(), self.paren_depth());
        match classify_esc_dq_bs(&mut self.dq, &mut self.case, (self.bt_base, self.bt_mask_base), raw, *i, bs) {
            EscDqBsAction::ExitEscDq(take) => {
                if matches!(self.hd_q, 3 | 6) {
                    (self.trail_lt, self.hd_q) = (if self.hd_q == 6 { 8 } else { 7 }, 0);
                }
                abort.pop_snap_kind(SnapKind::Dq);
                bufs.imp.push_str(&raw[*i..*i + take]);
                bufs.code.push_str(&raw[*i..*i + take]);
                Some((*i + take, Some(ScanState::Code), None, false))
            }
            EscDqBsAction::OpenEscBt(take) => {
                if matches!(self.hd_q, 3 | 4 | 6) {
                    self.hd_sub = Some((self.paren_depth().saturating_sub(1), self.active_braces(), self.hd_q));
                }
                self.hd_q = 0;
                bufs.imp.push_str(&raw[*i..*i + take]);
                bufs.code.push_str(&raw[*i..*i + take]);
                abort.push_snap(SnapKind::Bt, self.bt_depth(), self.paren_depth(), bufs, take);
                Some((*i + take, Some(ScanState::Code), None, false))
            }
            EscDqBsAction::ExitBt { take, to_dq, dropped_q } => {
                let _ = self.dq.take_dropped_q();
                self.on_exit_bt_in_dq();
                if dropped_q {
                    let ga = crate::dep_callers_bash_mask::is_glued_after_byte(b.get(*i + take));
                    abort.trigger_bt_unclosed_sq(self.bt_depth() + 1, !to_dq && ga, bufs);
                    let fill = if abort.last_bt_glued_assign() { 'x' } else { ' ' };
                    for _ in 0..take { bufs.imp.push(fill); bufs.code.push(fill); }
                } else {
                    let popped = prev_bt.saturating_sub(self.bt_depth());
                    abort.on_exit_bt_delim(
                        prev_bt, prev_pd, popped, self.bt_depth(), self.paren_depth(),
                        self.case.brace_grp_depth(), self.case.in_case_body(),
                    );
                    abort.prune_bt(self.bt_depth());
                    abort.on_depth_change(self.bt_depth(), self.paren_depth());
                    bufs.imp.push_str(&raw[*i..*i + take]);
                    bufs.code.push_str(&raw[*i..*i + take]);
                }
                Some((*i + take, Some(if to_dq { ScanState::BashDq } else { ScanState::Code }), None, true))
            }
            EscDqBsAction::Mask(take) => {
                if *i + bs < b.len() && b[*i + bs] == b'\''
                    && self.try_abort_bt_sq_in_param(bs, abort, bufs)
                {
                    for _ in 0..=bs { bufs.imp.push(' '); bufs.code.push(' '); }
                    return Some((*i + bs + 1, Some(ScanState::BashDq), None, true));
                }
                if take > 0 && !(*i + bs < b.len() && b[*i + bs] == b'$') {
                    self.dq.mark_param_backslash();
                }
                if !was_bad_dq && self.dq.in_bad_sub()
                    && let Some((sc, bd, pd)) = abort.trigger_bad_sub(&self.case, self.bt_depth(), bufs, false)
                {
                    self.suppress_pending_hd_cols(abort.cur_cmd_id, sc, bd, pd);
                }
                bufs.imp.push_str(&raw[*i..*i + take]);
                for _ in 0..take { bufs.code.push(' '); }
                *i += take;
                None
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn step_bash_quoted_state(
    raw: &str,
    b: &[u8],
    i: &mut usize,
    state: &mut ScanState,
    bash: &mut BashStripState,
    abort: &mut BashAbortState,
    heredoc: &mut HeredocTracker,
    stop_kind: Option<HeredocSubKind>,
    skip_imp_bs: &mut usize,
    allow_eol_cont: bool,
    bufs: &mut BashBufs<'_>,
) -> Option<(Option<usize>, Option<usize>)> {
    let (was_hd, starts) = ((bash.in_hd_delim(), bash.in_hd_multiline()), (bufs.imp.len(), bufs.code.len()));
    let was_bad = bash.in_bad_sub(abort);
    match *state {
        ScanState::BashDq => {
            let flags = (
                stop_kind == Some(HeredocSubKind::Param),
                stop_kind.is_some() && bash.local_bt_depth() == 0,
                allow_eol_cont,
            );
            let (ni, next_st, eol_bs, exited_bt) = bash.step_dq(raw, b, *i, flags, abort, bufs);
            let bad_now = bash.in_bad_sub(abort);
            mask_bash_hd((bash.in_hd_delim(), bash.in_hd_multiline()), was_hd, bufs.imp, bufs.code, starts);
            if was_bad || bad_now {
                if exited_bt && !bad_now && bufs.imp.ends_with('`') && bufs.imp.len() > starts.0 && bufs.code.len() > starts.1 {
                    let keep_imp = bufs.imp.pop();
                    let keep_code = bufs.code.pop();
                    mask_tail_spaces(bufs.imp, starts.0);
                    mask_tail_spaces(bufs.code, starts.1);
                    if let Some(c) = keep_imp { bufs.imp.push(c); }
                    if let Some(c) = keep_code { bufs.code.push(c); }
                } else if !exited_bt || bad_now {
                    mask_bash_hd((true, true), (false, false), bufs.imp, bufs.code, starts);
                }
            }
            if eol_bs.is_some() { return Some((None, eol_bs)); }
            if let Some(ns) = next_st { *state = ns; if ns == ScanState::Code { bash.finish_dq_hd(); } }
            heredoc.prune_bt_above(bash.bt_depth());
            let bd = bash.bt_depth(); bash.pending_hd_cols.retain(|h| h.bt_depth <= bd);
            *i = ni;
            if let Some(k) = stop_kind && heredoc_sub_done(k, *state, bash) { return Some((Some(*i), None)); }
        }
        ScanState::BashSq { ansi_c } => {
            let ansi_outer_d = bash.dq.ansi_sq_bt_ctx(bash.bt_depth()).map(|c| c.0);
            let (ni, done, eol_bs, exit_bt) = step_bash_sq(
                raw, *i, (ansi_c, allow_eol_cont && bash.hd_q == 1), (bash.bt_depth(), ansi_outer_d), *skip_imp_bs, bufs.imp, bufs.code,
            );
            mask_bash_hd((bash.in_hd_delim(), bash.in_hd_multiline()), was_hd, bufs.imp, bufs.code, starts);
            if eol_bs.is_some() { return Some((None, eol_bs)); }
            *skip_imp_bs = 0;
            if let Some(layer) = exit_bt {
                let ga = crate::dep_callers_bash_mask::is_glued_after_byte(b.get(ni));
                let to_dq = bash.step_bt_delim(layer, abort, bufs, (true, ga));
                let _ = bash.dq.take_dropped_q();
                let c = if abort.last_bt_glued_assign() { 'x' } else { ' ' };
                bufs.imp.push(c); bufs.code.push(c);
                *state = if to_dq { ScanState::BashDq } else { ScanState::Code };
                heredoc.prune_bt_above(bash.bt_depth());
                let bd = bash.bt_depth(); bash.pending_hd_cols.retain(|h| h.bt_depth <= bd);
                *i = ni;
                if let Some(k) = stop_kind && heredoc_sub_done(k, *state, bash) { return Some((Some(*i), None)); }
                return None;
            }
            if done { *state = ScanState::Code; bash.finish_sq_hd(); }
            *i = ni;
        }
        _ => unreachable!(),
    }
    None
}
