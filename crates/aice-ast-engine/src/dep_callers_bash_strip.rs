use crate::dep_callers_bash::{BashCaseTracker, CompoundKind};
use crate::dep_callers_bash_abort::BashAbortState;
use crate::dep_callers_bash_dq::BashDqTracker;
use crate::dep_callers_bash_param::ParamHdr;

pub(crate) struct PendingHdCol {
    pub(crate) bt_depth: usize,
    pub(crate) col: usize,
    pub(crate) paren_depth: usize,
    pub(crate) brace_grp_depth: usize,
    pub(crate) in_inner_brace_grp: bool,
    pub(crate) in_cond: Option<(CompoundKind, usize)>,
    pub(crate) outer_cond: Option<(CompoundKind, usize, usize, usize)>,
    pub(crate) outer_grp_bangs: Vec<(usize, usize, usize, u8, bool)>,
    pub(crate) in_case_arm: Option<(usize, bool)>,
    pub(crate) cmd_id: usize,
    pub(crate) pre_suppressed: bool,
    pub(crate) in_bang: bool,
    pub(crate) in_bt_top: bool,
}

pub(crate) struct BashStripState {
    pub(crate) dq: BashDqTracker,
    pub(crate) case: BashCaseTracker,
    pub(super) arith_depths: Vec<usize>,
    pub(crate) bt_base: usize,
    pub(crate) bt_mask_base: u32,
    pub(crate) trail_dollar: bool,
    pub(crate) trail_lt: u8,
    pub(crate) hd_q: u8,
    pub(crate) hd_sub: Option<(usize, usize, u8)>,
    pub(crate) hd_quoted: bool,
    pub(crate) hd_need_ml_push: bool,
    pub(crate) hd_ml_bt: Option<(usize, u32)>,
    pub(crate) hd_ltlt_pos: Option<usize>,
    pub(crate) pre_lt1_snap: Option<Box<(BashStripState, usize, usize)>>,
    pub(crate) hd_snap: Option<Box<(BashStripState, usize, usize)>>,
    pub(crate) pending_hd_cols: Vec<PendingHdCol>,
    pub(crate) code_param_stack: Vec<(usize, usize, usize, ParamHdr)>,
}

impl BashStripState {
    pub(crate) fn new() -> Self {
        Self {
            dq: BashDqTracker::new(), case: BashCaseTracker::new(), arith_depths: Vec::new(),
            bt_base: 0, bt_mask_base: 0, trail_dollar: false, trail_lt: 0, hd_q: 0, hd_sub: None,
            hd_quoted: false, hd_need_ml_push: false, hd_ml_bt: None, hd_ltlt_pos: None,
            pre_lt1_snap: None, hd_snap: None, pending_hd_cols: Vec::new(),
            code_param_stack: Vec::new(),
        }
    }

    pub(crate) fn clone_bare(&self) -> Self {
        Self {
            dq: self.dq.clone(), case: self.case.clone(), arith_depths: self.arith_depths.clone(),
            bt_base: self.bt_base, bt_mask_base: self.bt_mask_base, trail_dollar: self.trail_dollar,
            trail_lt: self.trail_lt, hd_q: self.hd_q, hd_sub: self.hd_sub, hd_quoted: self.hd_quoted,
            hd_need_ml_push: self.hd_need_ml_push, hd_ml_bt: self.hd_ml_bt,
            hd_ltlt_pos: self.hd_ltlt_pos, pre_lt1_snap: None, hd_snap: None, pending_hd_cols: Vec::new(),
            code_param_stack: self.code_param_stack.clone(),
        }
    }

    pub(crate) fn mark_code_param_backslash(&mut self) {
        let (bt, pd) = (self.bt_depth(), self.paren_depth());
        if let Some(top) = self.code_param_stack.last_mut() && top.0 == bt && top.1 == pd {
            top.3.on_backslash();
        }
    }

    pub(crate) fn mark_code_param_quote_or_dollar(&mut self) {
        let (bt, pd) = (self.bt_depth(), self.paren_depth());
        if let Some(top) = self.code_param_stack.last_mut() && top.0 == bt && top.1 == pd {
            top.3.on_quote_or_dollar_open();
        }
    }

    pub(crate) fn mark_code_param_char(&mut self, ch: char) {
        let (bt, pd) = (self.bt_depth(), self.paren_depth());
        if let Some(top) = self.code_param_stack.last_mut() && top.0 == bt && top.1 == pd {
            top.3.step_char(ch);
        }
    }

    pub(crate) fn suppress_pending_hd_cols(&mut self, cmd_id: usize, scope: u8, bt_depth: usize, paren_depth: usize) {
        if scope == 1 { return; }
        for h in &mut self.pending_hd_cols {
            if h.bt_depth == bt_depth && h.paren_depth == paren_depth && h.cmd_id == cmd_id {
                h.pre_suppressed = true;
            }
        }
    }

    pub(crate) fn in_bad_sub(&self, abort: &BashAbortState) -> bool {
        self.dq.in_bad_sub() || abort.is_active()
    }

    pub(crate) fn take_hd_snap(&mut self) -> Option<(BashStripState, usize, usize)> {
        self.hd_snap.take().map(|b| *b)
    }

    pub(crate) fn clear_hd_snap(&mut self) {
        (self.pre_lt1_snap, self.hd_snap, self.hd_ltlt_pos) = (None, None, None);
    }

    pub(crate) fn new_heredoc_in_bt(mode: u8, bt_base: usize, bt_mask_base: u32) -> Self {
        let mut s = Self::new();
        (s.bt_base, s.bt_mask_base) = (bt_base, bt_mask_base);
        match mode {
            0 => {
                s.dq.set_heredoc_param(true);
                s.dq.on_open_dq();
                s.dq.step_dq('$', Some('{'));
            }
            1 => {
                s.case.on_enter_bt(false, false);
                s.dq.on_enter_bt_from_code();
            }
            _ => {
                s.case.on_char('$');
                s.case.on_open_paren();
            }
        }
        s
    }

    pub(crate) fn bt_depth(&self) -> usize { self.bt_base + self.case.bt_depth() }
    pub(crate) fn local_bt_depth(&self) -> usize { self.case.bt_depth() }
    pub(crate) fn bt_unescape_mask(&self) -> u32 { self.case.bt_unescape_mask(self.bt_mask_base, self.bt_base) }
    pub(crate) fn last_is_dollar(&self) -> bool { self.case.last_is_dollar() }
    pub(crate) fn active_braces(&self) -> usize { self.case.active_braces() }
    pub(crate) fn param_depth(&self) -> usize { self.dq.param_depth() }
    pub(crate) fn paren_depth(&self) -> usize { self.case.paren_depth() }
    pub(crate) fn in_arith(&self) -> bool { !self.arith_depths.is_empty() }
    pub(crate) fn allows_arith_cmd(&self) -> bool { self.case.arith_boundary() }
    pub(crate) fn on_enter_arith(&mut self) { self.arith_depths.push(self.case.paren_depth()); }
    pub(crate) fn on_enter_arith_at(&mut self, depth: usize) { self.arith_depths.push(depth); }
    pub(crate) fn in_hd_delim(&self) -> bool { self.hd_q != 0 || self.trail_lt == 8 || self.hd_sub.is_some() }
    pub(crate) fn in_hd_multiline(&self) -> bool {
        matches!(self.hd_q, 2 | 4 | 5 | 6) || self.trail_lt == 8 || self.hd_sub.is_some_and(|(_, _, q)| matches!(q, 2 | 4 | 6 | 8))
    }
    pub(crate) fn trail_state(&mut self, bs: usize, in_code: bool) -> (bool, u8) {
        if !in_code && self.hd_q == 1 {
            self.case.on_quote_end();
            (self.trail_dollar, self.trail_lt, self.hd_q) = (false, 0, 0);
            return (false, 7);
        }
        if !in_code && self.hd_q == 3 && self.dq.param_depth() == 0 {
            if self.dq.in_esc_dq() { self.dq.on_exit_esc_dq(); } else { self.dq.on_exit_dq(); }
            self.case.on_quote_end();
            (self.trail_dollar, self.trail_lt, self.hd_q) = (false, 0, 0);
            return (false, 7);
        }
        let td = std::mem::take(&mut self.trail_dollar);
        if td && in_code {
            let surv = crate::dep_callers_bash_cont::bash_eol_surviving_bs(bs, self.bt_depth(), false);
            self.case.on_cont_dollar(surv == 0);
        }
        (td, std::mem::take(&mut self.trail_lt))
    }
    pub(crate) fn on_heredoc_token(&mut self) {
        self.case.on_escape_char();
        (self.trail_dollar, self.trail_lt, self.hd_q, self.hd_sub) = (false, 0, 0, None);
        (self.hd_quoted, self.hd_need_ml_push, self.hd_ml_bt) = (false, false, None);
        self.clear_hd_snap();
    }
    pub(crate) fn in_backtick(&self) -> bool { self.bt_base > 0 || self.case.in_bt() }

    pub(crate) fn allows_hash_comment(&self, b: &[u8], i: usize, prev_joined: Option<u8>) -> bool {
        if self.case.active_braces() != 0 {
            return false;
        }
        let prev = if i > 0 { Some(b[i - 1]) } else { prev_joined };
        match prev {
            None => true,
            Some(c) => {
                matches!(c, b' ' | b'\t' | b';' | b'&' | b'|' | b'(')
                    || (c == b')' && self.case.last_close_allows_hash())
                    || (c == b'`' && self.case.last_open_bt())
            }
        }
    }

    pub(crate) fn push_pending_hd_range(
        &mut self,
        abort: &BashAbortState,
        heredoc: &crate::dep_callers_heredoc::HeredocTracker,
        pend_before: usize,
        col: usize,
    ) {
        let pre_sup = abort.has_active_floor_at(self.bt_depth(), self.paren_depth());
        let (pd, bg, in_bt_top) = (self.paren_depth(), self.case.brace_grp_depth(), self.case.is_bt_top());
        let outer_cond = self.case.outer_cond_for_grp();
        let outer_grp_bangs = self.case.hd_group_outer_bangs(abort.bang_slice(), self.bt_base);
        for k in pend_before..heredoc.pending.len() {
            let bd = heredoc.pending[k].bt_depth;
            self.pending_hd_cols.push(PendingHdCol {
                bt_depth: bd,
                col,
                paren_depth: pd,
                brace_grp_depth: bg,
                in_inner_brace_grp: self.case.in_inner_brace_grp(),
                in_cond: self.case.in_cond(),
                outer_cond,
                outer_grp_bangs: outer_grp_bangs.clone(),
                in_case_arm: self.case.in_case_body(),
                cmd_id: abort.cur_cmd_id,
                pre_suppressed: pre_sup,
                in_bang: abort.has_bang_at(bd, pd, bg),
                in_bt_top,
            });
        }
    }

    pub(crate) fn on_exit_bt_in_dq(&mut self) {
        (self.trail_dollar, self.trail_lt, self.hd_q) = (false, 0, 0);
        while self.arith_depths.last().is_some_and(|&pd| pd >= self.case.paren_depth()) {
            self.arith_depths.pop();
        }
        if self.hd_ml_bt.is_some_and(|(bd, _)| self.bt_depth() < bd) {
            (self.hd_ml_bt, self.hd_need_ml_push) = (None, false);
        }
        let bd = self.bt_depth();
        self.pending_hd_cols.retain(|h| h.bt_depth <= bd);
        if let Some((bp, bbr, sq)) = self.hd_sub
            && self.paren_depth() == bp && self.active_braces() == bbr
        {
            self.hd_sub = None;
            if matches!(sq, 3 | 4 | 6) { self.hd_q = sq; } else if matches!(sq, 7 | 8) { self.trail_lt = sq; }
        }
    }
}
