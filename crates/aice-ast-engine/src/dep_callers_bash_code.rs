use crate::dep_callers_bash::{BashClose, BashOpen, CompoundEvent};
use crate::dep_callers_bash_abort::{BashAbortState, BashBufs, SnapKind};
use crate::dep_callers_bash_hd::{is_hd_delim_lt, next_trail_lt, step_code_backslash};
use crate::dep_callers_bash_param::ParamHdr;
use crate::dep_callers_bash_strip::BashStripState;

impl BashStripState {
    pub(crate) fn step_code_char(
        &mut self,
        raw: &str,
        b: &[u8],
        i: usize,
        abort: &mut BashAbortState,
        bufs: &mut BashBufs<'_>,
    ) -> Option<(usize, bool, bool)> {
        if b[i] == b'\\' && i + 1 < b.len() {
            return Some(step_code_backslash(self, abort, raw, b, i, bufs));
        }
        let ch = raw[i..].chars().next().unwrap();
        let (prev_dollar, prev_lt) = (self.trail_dollar, self.trail_lt);
        (self.trail_dollar, self.trail_lt) = (false, 0);
        match ch {
            '(' => {
                let sub_off = usize::from(
                    prev_dollar
                        && !self.in_arith()
                        && self.active_braces() == 0
                        && bufs.imp.ends_with('$')
                        && bufs.code.ends_with('$'),
                );
                if prev_dollar && is_hd_delim_lt(prev_lt) && self.hd_sub.is_none() {
                    let sq = if prev_lt == 8 { 8 } else { 7 };
                    self.hd_sub = Some((self.paren_depth(), self.active_braces(), sq));
                } else if !self.in_hd_delim() {
                    self.clear_hd_snap();
                    if !self.hd_need_ml_push {
                        self.hd_quoted = false;
                    }
                }
                if self.active_braces() == 0 {
                    if prev_dollar || prev_lt == 1 || self.case.last_ch == Some('>') {
                        let cur = (bufs.imp_lines.len(), bufs.imp.len(), bufs.code.len());
                        abort.on_part_open(self.bt_depth(), self.paren_depth(), cur, prev_dollar, bufs);
                    } else {
                        abort.mark_cmd_ready();
                    }
                } else {
                    self.mark_code_param_quote_or_dollar();
                }
                let pd_before = self.paren_depth();
                let open = self.case.on_open_paren();
                if self.case.take_bang() {
                    abort.toggle_bang(self.bt_depth(), pd_before, self.case.brace_grp_depth());
                }
                abort.on_compound_event(self.case.take_event(), self.bt_depth(), self.paren_depth(), self.case.brace_grp_depth());
                if self.active_braces() == 0 {
                    if prev_dollar {
                        abort.push_snap(SnapKind::Sub, self.bt_depth(), self.paren_depth(), bufs, sub_off);
                    } else if open == BashOpen::Normal {
                        abort.on_enter_normal_paren(self.bt_depth(), self.paren_depth());
                    }
                }
            }
            ')' => {
                let (pd_before, bg_before) = (self.paren_depth(), self.case.brace_grp_depth());
                let close = self.case.on_close_paren();
                let ev = self.case.take_event();
                let (ev_pd, ev_bg) = if matches!(ev, CompoundEvent::CaseEsac(_)) {
                    (pd_before, bg_before)
                } else {
                    (self.paren_depth(), self.case.brace_grp_depth())
                };
                abort.on_compound_event(ev, self.bt_depth(), ev_pd, ev_bg);
                while self
                    .arith_depths
                    .last()
                    .is_some_and(|&d| self.case.paren_depth() <= d)
                {
                    self.arith_depths.pop();
                }
                if close == BashClose::NormalSub {
                    abort.on_subshell_close(self.bt_depth(), self.paren_depth() + 1, self.paren_depth(), self.case.brace_grp_depth(), self.case.in_case_body());
                } else if matches!(close, BashClose::ExitUnqSub | BashClose::ExitQuotedSub) {
                    abort.on_cmdsub_close(self.bt_depth(), self.paren_depth() + 1, self.paren_depth(), self.case.brace_grp_depth(), self.case.in_case_body());
                } else if matches!(close, BashClose::BareCasePat | BashClose::ParenCasePat) {
                    abort.clear_cmd_at(self.bt_depth(), self.paren_depth());
                    abort.mark_cmd_ready();
                }
                abort.prune_paren(self.bt_depth(), self.paren_depth(), self.case.brace_grp_depth(), close == BashClose::NormalSub);
                abort.on_depth_change(self.bt_depth(), self.paren_depth());
                let (bd, pd) = (self.bt_depth(), self.paren_depth());
                self.code_param_stack.retain(|p| p.0 < bd || (p.0 == bd && p.1 <= pd));
                if let Some((bp, bbr, sq)) = self.hd_sub
                    && self.paren_depth() == bp
                    && self.active_braces() == bbr
                {
                    self.hd_sub = None;
                    if close == BashClose::ExitQuotedSub {
                        self.hd_q = sq;
                    } else if matches!(sq, 7 | 8) {
                        self.trail_lt = sq;
                    }
                } else if !self.in_hd_delim() {
                    self.clear_hd_snap();
                    if !self.hd_need_ml_push {
                        self.hd_quoted = false;
                    }
                }
                if close == BashClose::ExitQuotedSub {
                    self.dq.on_exit_sub();
                    bufs.imp.push(')');
                    bufs.code.push(')');
                    return Some((i + 1, true, true));
                }
                if matches!(close, BashClose::Normal | BashClose::NormalSub | BashClose::ExitUnqSub | BashClose::ProcSub) {
                    bufs.imp.push(')');
                    bufs.code.push(')');
                    return Some((i + 1, false, true));
                }
            }
            '`' => {
                if is_hd_delim_lt(prev_lt) && self.hd_sub.is_none() && self.bt_depth() == 0 {
                    let sq = if prev_lt == 8 { 8 } else { 7 };
                    self.hd_sub = Some((self.paren_depth(), self.active_braces(), sq));
                }
                let prev_bt = self.bt_depth();
                if self.active_braces() == 0 && prev_bt == 0 {
                    let cur = (bufs.imp_lines.len(), bufs.imp.len(), bufs.code.len());
                    abort.on_part_open(prev_bt, self.paren_depth(), cur, true, bufs);
                } else {
                    self.mark_code_param_quote_or_dollar();
                }
                let ga = crate::dep_callers_bash_mask::is_glued_after_byte(b.get(i + 1));
                let to_dq = self.step_bt_delim(1, abort, bufs, (false, ga));
                let dropped_q = self.dq.take_dropped_q();
                let c = if self.bt_depth() < prev_bt && dropped_q {
                    if abort.last_bt_glued_assign() { 'x' } else { ' ' }
                } else {
                    '`'
                };
                bufs.imp.push(c);
                bufs.code.push(c);
                if self.bt_depth() > prev_bt {
                    abort.push_snap(SnapKind::Bt, self.bt_depth(), self.paren_depth(), bufs, 1);
                }
                return Some((i + 1, to_dq, self.bt_depth() < prev_bt));
            }
            _ => {
                if ch == '<'
                    && prev_lt == 0
                    && !self.in_hd_delim()
                    && !self.in_arith()
                    && self.active_braces() == 0
                {
                    self.pre_lt1_snap =
                        Some(Box::new((self.clone_bare(), bufs.imp.len(), bufs.code.len())));
                } else if ch == '<' && prev_lt == 1 {
                    if let Some(snap) = self.pre_lt1_snap.take() {
                        self.hd_ltlt_pos = Some(snap.1);
                        self.hd_snap = Some(snap);
                    }
                    if !self.hd_need_ml_push {
                        (self.hd_quoted, self.hd_ml_bt) = (false, None);
                    }
                } else if ch == '{'
                    && prev_dollar
                    && is_hd_delim_lt(prev_lt)
                    && self.hd_sub.is_none()
                {
                    let sq = if prev_lt == 8 { 8 } else { 7 };
                    self.hd_sub = Some((self.paren_depth(), self.active_braces(), sq));
                }
                self.trail_dollar = ch == '$' && !prev_dollar;
                self.trail_lt = next_trail_lt(prev_lt, ch);
                if ch != '<' || prev_lt >= 2 {
                    self.pre_lt1_snap = None;
                    if !is_hd_delim_lt(self.trail_lt) && !self.in_hd_delim() {
                        self.clear_hd_snap();
                        if !self.hd_need_ml_push {
                            self.hd_quoted = false;
                        }
                    }
                }
                let prev_bg = self.case.brace_grp_depth();
                if ch == '{' && prev_dollar {
                    if self.active_braces() == 0 {
                        let cur = (bufs.imp_lines.len(), bufs.imp.len(), bufs.code.len());
                        abort.on_part_open(self.bt_depth(), self.paren_depth(), cur, false, bufs);
                    } else {
                        self.mark_code_param_quote_or_dollar();
                    }
                    abort.push_snap(SnapKind::Param, self.bt_depth(), self.paren_depth(), bufs, 1);
                    self.case.on_char('{');
                    abort.on_compound_event(self.case.take_event(), self.bt_depth(), self.paren_depth(), self.case.brace_grp_depth());
                    self.code_param_stack.push((self.bt_depth(), self.paren_depth(), self.active_braces(), ParamHdr::Init));
                } else {
                    if self.active_braces() > 0 && ch != '}' {
                        if ch == '$' && prev_dollar {
                            self.mark_code_param_quote_or_dollar();
                        } else {
                            self.mark_code_param_char(ch);
                        }
                    }
                    self.case.on_char(ch);
                    if self.case.take_bang() {
                        let bg_b = if ch == '{' && self.case.brace_grp_depth() > prev_bg { prev_bg } else { self.case.brace_grp_depth() };
                        abort.toggle_bang(self.bt_depth(), self.paren_depth(), bg_b);
                    }
                    if abort.on_compound_event(self.case.take_event(), self.bt_depth(), self.paren_depth(), self.case.brace_grp_depth()) {
                        if bufs.imp.ends_with(' ') { bufs.imp.pop(); bufs.imp.push(';'); }
                        if bufs.code.ends_with(' ') { bufs.code.pop(); bufs.code.push(';'); }
                    }
                    if ch == '}' {
                        if let Some(&(bt, pd, br, hdr)) = self.code_param_stack.last()
                            && (bt, pd, br) == (self.bt_depth(), self.paren_depth(), self.active_braces() + 1)
                        {
                            self.code_param_stack.pop();
                            if !hdr.is_valid_end() {
                                if let Some((sc, bd, pd)) = abort.trigger_bad_sub(&self.case, self.bt_depth(), bufs, true) {
                                    self.suppress_pending_hd_cols(abort.cur_cmd_id, sc, bd, pd);
                                }
                            } else {
                                abort.pop_snap_kind(SnapKind::Param);
                            }
                        }
                        if self.case.brace_grp_depth() < prev_bg {
                            abort.on_brace_grp_close(self.bt_depth(), self.paren_depth(), prev_bg, self.case.brace_grp_depth(), self.case.in_case_body());
                        }
                    }
                }
                if ch == '}'
                    && let Some((bp, bbr, sq)) = self.hd_sub
                    && self.paren_depth() == bp
                    && self.active_braces() == bbr
                    && matches!(sq, 7 | 8)
                {
                    self.hd_sub = None;
                    self.trail_lt = sq;
                }
            }
        }
        None
    }
}
