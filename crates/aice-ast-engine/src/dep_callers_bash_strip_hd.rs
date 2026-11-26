use crate::dep_callers_bash_abort::{BashAbortState, BashBufs};
use crate::dep_callers_bash_cmd::Cursor;
use crate::dep_callers_bash_strip::BashStripState;

impl BashStripState {
    pub(crate) fn try_abort_bt_sq_in_param(
        &mut self,
        bs: usize,
        abort: &mut BashAbortState,
        bufs: &mut BashBufs<'_>,
    ) -> bool {
        let Some((idx_sq, ansi, inner_bts)) = self.dq.bt_in_sq_in_param() else { return false };
        let outer_d = self.bt_depth().saturating_sub(inner_bts);
        if ansi && !crate::dep_callers_bash_bt::is_esc_dq_quote(bs, 0, outer_d) {
            return false;
        }
        if self.case.bt_depth() < inner_bts {
            return false;
        }
        let target = self.case.bt_depth() + 1 - inner_bts;
        self.case.on_exit_bt_layer(target);
        self.dq.abort_bt_to_sq_in_param(idx_sq, inner_bts);
        self.on_exit_bt_in_dq();
        abort.prune_bt(self.bt_depth());
        if let Some((sc, bd, pd)) = abort.trigger_bad_sub(&self.case, self.bt_depth(), bufs, false) {
            self.suppress_pending_hd_cols(abort.cur_cmd_id, sc, bd, pd);
        }
        true
    }

    pub(crate) fn step_bt_delim(
        &mut self,
        layer: usize,
        abort: &mut BashAbortState,
        bufs: &mut BashBufs<'_>,
        (from_unclosed_sq, glued_after): (bool, bool),
    ) -> bool {
        (self.trail_dollar, self.trail_lt, self.hd_q) = (false, 0, 0);
        let d = self.bt_depth();
        if d == 0 && layer == 1 {
            self.case.on_enter_bt(false, false);
            self.dq.on_enter_bt_from_code();
            false
        } else if layer <= d && self.case.bt_depth() > 0 {
            let (prev_bt, prev_pd) = (self.bt_depth(), self.paren_depth());
            let local_layer = layer.saturating_sub(self.bt_base).max(1);
            let (to_dq, popped) = self.case.on_exit_bt_layer(local_layer).unwrap_or((false, 0));
            let dropped_q = self.dq.on_exit_bt_layers(popped);
            self.on_exit_bt_in_dq();
            let (bd, pd) = (self.bt_depth(), self.paren_depth());
            self.code_param_stack.retain(|p| p.0 < bd || (p.0 == bd && p.1 <= pd));
            if from_unclosed_sq || dropped_q {
                abort.trigger_bt_unclosed_sq(self.bt_depth() + 1, !to_dq && glued_after, bufs);
            } else {
                abort.on_exit_bt_delim(
                    prev_bt, prev_pd, popped, self.bt_depth(), self.paren_depth(),
                    self.case.brace_grp_depth(), self.case.in_case_body(),
                );
                abort.prune_bt(self.bt_depth());
                abort.on_depth_change(self.bt_depth(), self.paren_depth());
            }
            to_dq
        } else if layer == d + 1 {
            self.case.on_enter_nested_bt(false);
            self.dq.on_enter_bt_from_code();
            false
        } else {
            self.case.on_escape_char();
            false
        }
    }

    fn start_quote_hd(&mut self, sl: u8, ml: u8) {
        if self.hd_sub.is_none() && crate::dep_callers_bash_hd::is_hd_delim_lt(self.trail_lt) {
            self.hd_q = if self.trail_lt == 8 { ml } else { sl };
            self.hd_quoted = true;
        } else {
            self.hd_q = 0;
            if self.hd_sub.is_none() { self.clear_hd_snap(); if !self.hd_need_ml_push { self.hd_quoted = false; } }
        }
        (self.trail_dollar, self.trail_lt) = (false, 0); self.case.on_quote_start();
    }
    pub(crate) fn push_dq(&mut self) { self.start_quote_hd(3, 6); self.dq.on_open_dq(); }
    pub(crate) fn on_sq_start(&mut self) { self.start_quote_hd(1, 5); }
    fn record_hd_ml_bt(&mut self) {
        if self.hd_ml_bt.is_none() { self.hd_ml_bt = Some((self.bt_depth(), self.bt_unescape_mask())); }
    }
    pub(crate) fn finish_sq_hd(&mut self) {
        if self.hd_q == 2 { self.hd_need_ml_push = true; self.record_hd_ml_bt(); self.trail_lt = 8; }
        else { self.trail_lt = match self.hd_q { 1 => 7, 5 => 8, _ => 0 }; }
        (self.trail_dollar, self.hd_q) = (false, 0); self.case.on_quote_end();
    }
    pub(crate) fn finish_dq_hd(&mut self) {
        if self.hd_q == 4 { self.hd_need_ml_push = true; self.record_hd_ml_bt(); (self.trail_lt, self.hd_q) = (8, 0); }
        else if self.hd_q == 6 { (self.trail_lt, self.hd_q) = (8, 0); }
    }
    pub(crate) fn flush_ml_hd_if_ready(&mut self, heredoc: &mut crate::dep_callers_heredoc::HeredocTracker) {
        if self.hd_need_ml_push && self.hd_sub.is_none() && self.hd_q == 0 {
            let (bd, bm) = self.hd_ml_bt.take().unwrap_or_else(|| (self.bt_depth(), self.bt_unescape_mask()));
            if bd <= self.bt_depth() {
                crate::dep_callers_bash_hd::push_multiline_hd_entry(heredoc, bd, bm, self.hd_quoted);
            }
            (self.hd_need_ml_push, self.hd_quoted) = (false, false);
        }
    }
    pub(crate) fn on_newline(
        &mut self,
        in_code: bool,
        heredoc: &mut crate::dep_callers_heredoc::HeredocTracker,
        abort: &mut BashAbortState,
        cur: Cursor,
    ) -> (bool, Option<usize>) {
        (self.trail_dollar, self.trail_lt) = (false, 0); self.dq.reset_dollar();
        let mask_imp = matches!(self.hd_q, 1 | 3) || self.hd_sub.is_some_and(|(_, _, q)| matches!(q, 3 | 7));
        let ltlt_pos = self.hd_ltlt_pos.take();
        (self.pre_lt1_snap, self.hd_snap) = (None, None);
        self.hd_q = match self.hd_q { 1 => 2, 3 => 4, 5 => 2, 6 => 4, x => x };
        if let Some((_, _, ref mut q)) = self.hd_sub { *q = match *q { 3 | 6 => 4, 7 => 8, x => x }; }
        if matches!(self.hd_q, 2 | 4) || self.hd_sub.is_some_and(|(_, _, q)| matches!(q, 4 | 8)) {
            self.hd_need_ml_push = true;
            self.record_hd_ml_bt();
        } else if self.hd_sub.is_none() && self.hd_q == 0 {
            if self.hd_need_ml_push { self.flush_ml_hd_if_ready(heredoc); }
            else { (self.hd_quoted, self.hd_ml_bt) = (false, None); }
        }
        if in_code {
            self.case.on_newline();
            if self.case.take_bang() {
                abort.toggle_bang(self.bt_depth(), self.paren_depth(), self.case.brace_grp_depth());
            }
            abort.on_compound_event(self.case.take_event(), self.bt_depth(), self.paren_depth(), self.case.brace_grp_depth());
        }
        abort.on_newline(
            in_code,
            self.bt_depth(),
            self.paren_depth(),
            self.case.compound_depth(),
            self.case.brace_grp_depth(),
            self.case.in_cond(),
            cur,
        );
        (mask_imp, ltlt_pos)
    }
}
