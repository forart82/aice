use crate::dep_callers_bash_abort::{BashAbortState, BashBufs, SnapKind};
use crate::dep_callers_bash_dq::BashDqAction;
use crate::dep_callers_bash_strip::BashStripState;
use crate::dep_callers_strip::ScanState;

pub(crate) use crate::dep_callers_bash_dq_state::step_bash_quoted_state;

impl BashStripState {
    pub(crate) fn step_dq(
        &mut self,
        raw: &str,
        b: &[u8],
        mut i: usize,
        (stop_param, in_heredoc, allow_eol_cont): (bool, bool, bool),
        abort: &mut BashAbortState,
        bufs: &mut BashBufs<'_>,
    ) -> (usize, Option<ScanState>, Option<usize>, bool) {
        while i < b.len() {
            if allow_eol_cont && b[i] == b'\\' && b[i..].iter().all(|&c| c == b'\\') {
                let bs = b.len() - i;
                let ansi_sq = self.dq.in_ansi_sq() && !in_heredoc;
                if crate::dep_callers_bash_cont::bash_dq_eol_continues(bs, self.bt_depth(), ansi_sq) {
                    if self.trail_dollar {
                        if self.dq.in_sq()
                            && !in_heredoc
                            && crate::dep_callers_bash_cont::bash_sq_suppresses_dollar_ansi(bs, self.bt_depth(), ansi_sq)
                        {
                            self.dq.reset_dollar();
                            self.trail_dollar = false;
                            if bufs.imp.ends_with('$') { bufs.imp.pop(); bufs.imp.push(' '); }
                        } else if crate::dep_callers_bash_cont::bash_dq_eol_surviving_bs(bs, self.bt_depth(), ansi_sq) == 0 {
                            self.dq.reset_dollar();
                        }
                    }
                    return (i, None, Some(bs), false);
                }
                (self.trail_dollar, self.trail_lt) = (false, 0);
                self.dq.reset_dollar();
                bufs.imp.push_str(&raw[i..]);
                for _ in 0..bs { bufs.code.push(' '); }
                return (b.len(), None, None, false);
            }
            if self.dq.in_esc_dq_context(self.bt_depth()) && b[i] == b'\\' {
                if let Some(res) = self.step_dq_esc_bs(raw, b, &mut i, abort, bufs) {
                    return res;
                }
            } else if b[i] == b'\\' && i + 1 < b.len() && (!self.dq.in_sq() || self.dq.in_ansi_sq() || b[i + 1] != b'\'') {
                (self.trail_dollar, self.trail_lt) = (false, 0);
                self.dq.reset_dollar();
                if self.dq.in_ansi_sq() {
                    let mut bs = 0usize;
                    while i + bs < b.len() && b[i + bs] == b'\\' { bs += 1; }
                    if i + bs < b.len() && matches!(b[i + bs], b'\'' | b'$' | b'`') {
                        if b[i + bs] == b'\'' {
                            if bs % 4 == 1 {
                                let was_bad_dq = self.dq.in_bad_sub();
                                self.dq.on_ansi_sq_esc_sq(1);
                                if !was_bad_dq && self.dq.in_bad_sub()
                                    && let Some((sc, bd, pd)) = abort.trigger_bad_sub(&self.case, self.bt_depth(), bufs, false)
                                {
                                    self.suppress_pending_hd_cols(abort.cur_cmd_id, sc, bd, pd);
                                }
                            } else if bs % 4 == 2
                                && crate::dep_callers_bash_dq_lex::dq_ansi_close_escapes_brace(
                                    b, i + bs + 1, (0, 0), self.dq.param_depth(),
                                )
                            {
                                let was_bad_dq = self.dq.in_bad_sub();
                                self.dq.trigger_bad_sub_on_enclosing_dq();
                                if !was_bad_dq && self.dq.in_bad_sub()
                                    && let Some((sc, bd, pd)) = abort.trigger_bad_sub(&self.case, self.bt_depth(), bufs, false)
                                {
                                    self.suppress_pending_hd_cols(abort.cur_cmd_id, sc, bd, pd);
                                }
                            }
                        }
                        let esc = if b[i + bs] == b'\'' { bs % 2 == 1 } else { matches!(bs % 4, 1 | 2) };
                        let take = bs + usize::from(esc);
                        bufs.imp.push_str(&raw[i..i + take]);
                        for _ in 0..take { bufs.code.push(' '); }
                        i += take;
                        continue;
                    }
                }
                let nch = raw[i + 1..].chars().next().unwrap();
                if nch != '\n' {
                    self.dq.mark_param_backslash();
                    if self.dq.in_dq() { abort.mark_dq_non_sub_word(self.bt_depth(), self.paren_depth()); }
                }
                bufs.imp.push('\\');
                bufs.imp.push(nch);
                for _ in 0..(1 + nch.len_utf8()) { bufs.code.push(' '); }
                i += 1 + nch.len_utf8();
            } else if !self.trail_dollar && b[i] == b'$' && i + 1 < b.len() && b[i + 1] == b'$' {
                (self.trail_dollar, self.trail_lt) = (false, 0);
                self.dq.reset_dollar();
                self.dq.mark_param_quote_or_dollar();
                if self.dq.in_dq() { abort.mark_dq_non_sub_word(self.bt_depth(), self.paren_depth()); }
                bufs.imp.push_str("$$");
                bufs.code.push_str("  ");
                i += 2;
            } else {
                let ch = raw[i..].chars().next().unwrap();
                if ch == '`' && self.case.bt_depth() > 0 {
                    let glued_after = crate::dep_callers_bash_mask::is_glued_after_byte(b.get(i + 1));
                    let to_dq = self.step_bt_delim(1, abort, bufs, (false, glued_after));
                    let dropped_q = self.dq.take_dropped_q();
                    let c = if dropped_q { if abort.last_bt_glued_assign() { 'x' } else { ' ' } } else { '`' };
                    bufs.imp.push(c);
                    bufs.code.push(c);
                    return (i + 1, Some(if to_dq { ScanState::BashDq } else { ScanState::Code }), None, true);
                }
                if ch == '\'' && self.try_abort_bt_sq_in_param(0, abort, bufs) {
                    bufs.imp.push(' ');
                    bufs.code.push(' ');
                    return (i + 1, Some(ScanState::BashDq), None, true);
                }
                let next = raw[i + ch.len_utf8()..].chars().next();
                let was_dq = self.dq.in_dq();
                let was_sq = self.dq.in_sq();
                let had_sq = self.dq.has_sq();
                let was_bad_dq = self.dq.in_bad_sub();
                let prev_pd = self.dq.param_depth();
                match self.dq.step_dq(ch, next) {
                    BashDqAction::EnterSub => {
                        if matches!(self.hd_q, 3 | 4 | 6) {
                            self.hd_sub = Some((self.paren_depth(), self.active_braces(), self.hd_q));
                        }
                        (self.trail_dollar, self.trail_lt, self.hd_q) = (false, 0, 0);
                        if raw[i..].starts_with("$((") { self.on_enter_arith(); }
                        self.case.on_enter_quoted_sub();
                        abort.push_snap(SnapKind::Sub, self.bt_depth(), self.paren_depth(), bufs, 0);
                        bufs.imp.push_str("$(");
                        bufs.code.push_str("$(");
                        return (i + 2, Some(ScanState::Code), None, false);
                    }
                    BashDqAction::EnterBt => {
                        if matches!(self.hd_q, 3 | 4 | 6) {
                            self.hd_sub = Some((self.paren_depth(), self.active_braces(), self.hd_q));
                        }
                        (self.trail_dollar, self.trail_lt, self.hd_q) = (false, 0, 0);
                        let u = self.dq.last_bt_unescapes();
                        self.case.on_enter_bt(true, u);
                        bufs.imp.push('`');
                        bufs.code.push('`');
                        abort.push_snap(SnapKind::Bt, self.bt_depth(), self.paren_depth(), bufs, 1);
                        return (i + 1, Some(ScanState::Code), None, false);
                    }
                    BashDqAction::EnterParam => {
                        if was_dq { abort.mark_dq_non_sub_word(self.bt_depth(), self.paren_depth()); }
                        (self.trail_dollar, self.trail_lt) = (false, 0);
                        abort.push_snap(SnapKind::Param, self.bt_depth(), self.paren_depth(), bufs, 1);
                        bufs.imp.push_str("${");
                        bufs.code.push_str("  ");
                        i += 2;
                    }
                    BashDqAction::ExitDq => {
                        self.trail_lt = match self.hd_q { 3 => 7, 6 => 8, _ => 0 };
                        if matches!(self.hd_q, 3 | 6) { self.hd_q = 0; }
                        self.trail_dollar = false;
                        abort.pop_snap_kind(SnapKind::Dq);
                        bufs.imp.push('"');
                        bufs.code.push('"');
                        self.case.on_quote_end();
                        return (i + 1, Some(ScanState::Code), None, false);
                    }
                    BashDqAction::Stay => {
                        if was_dq && self.dq.in_dq() { abort.mark_dq_non_sub_word(self.bt_depth(), self.paren_depth()); }
                        self.trail_dollar = ch == '$' && !self.trail_dollar;
                        self.trail_lt = 0;
                        let closed_bad = self.dq.take_closed_param_bad();
                        let closed_param = self.dq.param_depth() < prev_pd;
                        if !was_bad_dq && self.dq.in_bad_sub() {
                            if let Some((sc, bd, pd)) = abort.trigger_bad_sub(&self.case, self.bt_depth(), bufs, closed_bad) {
                                self.suppress_pending_hd_cols(abort.cur_cmd_id, sc, bd, pd);
                            }
                        } else if closed_param {
                            abort.pop_snap_kind(SnapKind::Param);
                        }
                        let sq_delim = stop_param && ch == '\'' && (was_sq != self.dq.in_sq());
                        if !had_sq && self.dq.has_sq() {
                            abort.set_sq_snap(bufs.imp_lines.len(), bufs.imp.len(), bufs.code.len());
                        } else if had_sq && !self.dq.has_sq() {
                            abort.clear_sq_snap();
                        }
                        bufs.imp.push(if sq_delim || self.dq.in_bad_sub() { ' ' } else { ch });
                        for _ in 0..ch.len_utf8() { bufs.code.push(' '); }
                        i += ch.len_utf8();
                        if stop_param && self.dq.param_depth() == 0 {
                            return (i, None, None, false);
                        }
                    }
                }
            }
        }
        (i, None, None, false)
    }
}
