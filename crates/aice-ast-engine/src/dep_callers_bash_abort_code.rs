use crate::dep_callers_bash::CompoundKind;
use crate::dep_callers_bash_abort::{BashAbortState, BashBufs};
use crate::dep_callers_bash_cmd::Cursor;
use crate::dep_callers_bash_span::{cmd_has_static_word_ahead, mask_cursor_span};

impl BashAbortState {
    pub(crate) fn on_enter_case(&mut self, bt_depth: usize, paren_depth: usize, bg: usize) {
        let had_bang = self.has_bang_at(bt_depth, paren_depth, bg);
        self.bang_stack.retain(|&x| x != (bt_depth, paren_depth, bg));
        self.case_outer_bangs.push(had_bang);
    }

    pub(crate) fn sync_case_outer_bangs(&mut self, len: usize) {
        self.case_outer_bangs.truncate(len);
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn on_code_char(
        &mut self,
        ch: char,
        next: Option<char>,
        raw_tail: &str,
        (is_heredoc_op, in_case_pat): (bool, bool),
        (bt_depth, paren_depth, active_braces, bg): (usize, usize, usize, usize),
        in_cond: Option<(CompoundKind, usize)>,
        bufs: &mut BashBufs<'_>,
    ) {
        let prev = self.prev_ch;
        if active_braces == 0 {
            let cur = (bufs.imp_lines.len(), bufs.imp.len(), bufs.code.len());
            let (mut cleared_r, mut cleared_a, mut has_active_part, mut has_non_sub, mut lhs_sub_fl) =
                (false, false, false, false, false);
            let mut mask_subs = Vec::new();
            if let Some(c) = self.active_cmd_mut(bt_depth, paren_depth) {
                let (was_redir, was_assign) = (c.cur_redir.is_some(), c.cur_assign.is_some());
                c.step_char(ch, next, prev, is_heredoc_op, cur);
                cleared_r = was_redir && c.cur_redir.is_none();
                cleared_a = was_assign && c.cur_assign.is_none();
                lhs_sub_fl = c.take_lhs_sub_floor();
                has_active_part = c.has_cmd_word || c.cur_assign.is_some() || c.cur_redir.is_some();
                has_non_sub = c.has_non_sub_word;
                if has_non_sub && !c.sub_assign_spans.is_empty() {
                    mask_subs = std::mem::take(&mut c.sub_assign_spans);
                }
            }
            for (s, e) in mask_subs {
                mask_cursor_span(bufs, s, e);
            }
            if lhs_sub_fl && !(matches!(ch, ' ' | '\t') && cmd_has_static_word_ahead(raw_tail, 0)) {
                self.trigger_lhs_sub_floor(bt_depth, paren_depth);
            }
            if has_active_part && !matches!(ch, ';' | '&' | '|' | ')' | '}') {
                self.clear_pending_hd_at(bt_depth, paren_depth);
            }
            if !matches!(ch, ';' | '&' | '|' | ')' | '}') && !ch.is_ascii_whitespace() {
                if self.pending_exit_abort.is_some_and(|(bd, pd, _, _, _, _)| bd == bt_depth && pd == paren_depth) {
                    self.pending_exit_abort = None;
                }
                if self.bt_hd_abort.is_some_and(|(bd, pd, _)| bd == bt_depth && pd == paren_depth) {
                    self.bt_hd_abort = None;
                }
                if matches!(ch, '>' | '<' | '=') {
                    self.cond_candidate_abort = None;
                }
            } else {
                self.cond_candidate_abort = None;
            }
            if has_non_sub {
                if self.abort_floor == Some((bt_depth, paren_depth)) {
                    self.fd0_in_redir_abort = false;
                }
                if self.pending_bt_assign_abort.is_some_and(|(bd, pd, _)| (bd, pd) == (bt_depth, paren_depth)) {
                    self.pending_bt_assign_abort = None;
                    if self.pending_case_bt_abort.is_some_and(|(cbd, cpd, _, _, _)| (cbd, cpd) == (bt_depth, paren_depth)) {
                        self.pending_case_bt_abort = None;
                    }
                }
                if self.sub_assign_abort == Some((bt_depth, paren_depth)) {
                    self.clear_abort_floor();
                }
            }
            if (self.abort_scope == 1 && cleared_r) || (self.abort_scope == 2 && cleared_a) {
                self.in_failed_part = false;
                if cleared_a && self.sub_assign_abort == Some((bt_depth, paren_depth)) && cmd_has_static_word_ahead(raw_tail, 0) {
                    self.clear_abort_floor();
                }
            }
            if ch == '{' {
                self.clear_pending_hd_at(bt_depth, paren_depth);
                self.cond_candidate_abort = None;
                if self.pending_exit_abort.is_some_and(|(bd, pd, _, _, _, _)| bd == bt_depth && pd == paren_depth) {
                    self.pending_exit_abort = None;
                }
            }
            if matches!(ch, ';' | '{') || (ch == '|' && prev != Some('>'))
                || (ch == '&' && next != Some('>') && !matches!(prev, Some('>' | '<')))
            {
                self.cmd_ready = true;
            }
            let is_bg_amp = ch == '&' && next != Some('&') && next != Some('>') && !matches!(prev, Some('&' | '>' | '<' | '|' | ';'));
            let is_pipe = !in_case_pat && ch == '|' && next != Some('|') && !matches!(prev, Some('|' | '>'));
            let is_and_start = ch == '&' && next == Some('&');
            let is_or_start = ch == '|' && next == Some('|');
            if !matches!(ch, ' ' | '\t') && !is_pipe && !(ch == '&' && prev == Some('|')) {
                self.continues_pipe = false;
            }
            if is_and_start {
                self.on_subshell_sep(bt_depth, paren_depth, bg, true);
                if self.step_and_or_op(true, ch, bt_depth, paren_depth, bg) { return; }
            }
            if is_or_start {
                self.on_subshell_sep(bt_depth, paren_depth, bg, true);
                if self.step_and_or_op(false, ch, bt_depth, paren_depth, bg) { return; }
            }
            if is_pipe {
                self.on_subshell_sep(bt_depth, paren_depth, bg, true);
                self.clear_pending_hd_at(bt_depth, paren_depth);
                self.cur_cmd_id += 1;
                if self.pending_exit_abort.is_some_and(|(bd, pd, _, _, _, _)| bd == bt_depth && pd == paren_depth) {
                    self.pending_exit_abort = None;
                }
                if self.pending_bt_assign_abort.is_some_and(|(bd, pd, _)| (bd, pd) == (bt_depth, paren_depth)) {
                    self.pending_bt_assign_abort = None;
                }
                if self.pending_case_bt_abort.is_some_and(|(bd, pd, _, _, _)| (bd, pd) == (bt_depth, paren_depth)) {
                    self.pending_case_bt_abort = None;
                }
                if !self.in_rhs_list && !self.and_only_abort && !self.or_only_abort {
                    if !self.in_pipe_stage(bt_depth, paren_depth, bg) {
                        self.pipe_stages.push((bt_depth, paren_depth, bg));
                    }
                    self.continues_pipe = true;
                }
            }
            if ch == ';' || is_bg_amp {
                self.cur_cmd_id += 1;
                self.on_subshell_sep(bt_depth, paren_depth, bg, is_bg_amp);
                if is_bg_amp {
                    if self.pending_exit_abort.is_some_and(|(bd, pd, _, _, _, _)| bd == bt_depth && pd == paren_depth) {
                        self.pending_exit_abort = None;
                    }
                    if self.pending_bt_assign_abort.is_some_and(|(bd, pd, _)| (bd, pd) == (bt_depth, paren_depth)) {
                        self.pending_bt_assign_abort = None;
                    }
                    if self.pending_case_bt_abort.is_some_and(|(bd, pd, _, _, _)| (bd, pd) == (bt_depth, paren_depth)) {
                        self.pending_case_bt_abort = None;
                    }
                } else {
                    if let Some((kind, idx)) = in_cond {
                        if let Some((bd, pd, _, in_bang, _, _)) = self.pending_exit_abort
                            && (bd, pd) == (bt_depth, paren_depth)
                        {
                            self.pending_cond_hd_abort = Some((bt_depth, paren_depth, kind, idx, in_bang));
                        } else if let Some((bd, pd, in_b)) = self.pending_bt_assign_abort
                            && (bd, pd) == (bt_depth, paren_depth)
                        {
                            self.pending_cond_hd_abort = Some((bt_depth, paren_depth, kind, idx, in_b));
                        } else if self.fd0_in_redir_abort && self.abort_floor == Some((bt_depth, paren_depth)) {
                            self.pending_cond_hd_abort = Some((bt_depth, paren_depth, kind, idx, self.has_bang_at(bt_depth, paren_depth, bg)));
                        } else if (self.and_only_abort || self.or_only_abort)
                            && self.abort_floor == Some((bt_depth, paren_depth))
                        {
                            self.pending_cond_hd_abort = Some((bt_depth, paren_depth, kind, idx, self.or_only_abort));
                        }
                    }
                    if bg > 0 || paren_depth > 0 {
                        if let Some((bd, pd, pbg, in_bang, _, fh)) = self.pending_exit_abort
                            && (bd, pd) == (bt_depth, paren_depth)
                        {
                            self.pending_exit_abort = Some((bd, pd, pbg, in_bang, true, fh));
                        }
                    } else if next != Some(';') && next != Some('&') && prev != Some(';') {
                        if self.pending_exit_abort.is_some_and(|(bd, pd, _, _, _, _)| bd == bt_depth && pd == 0) {
                            self.pending_exit_abort = None;
                        }
                        if self.pending_bt_assign_abort.is_some_and(|(bd, pd, _)| bd == bt_depth && pd == 0) {
                            self.pending_bt_assign_abort = None;
                        }
                        if self.pending_case_bt_abort.is_some_and(|(bd, pd, _, _, _)| bd == bt_depth && pd == 0) {
                            self.pending_case_bt_abort = None;
                        }
                    }
                }
                if ((self.and_only_abort || self.or_only_abort || self.fd0_in_redir_abort) && self.abort_floor.is_some_and(|(bf, pf)| bt_depth <= bf && paren_depth <= pf))
                    || (self.abort_floor == Some((bt_depth, paren_depth)) && self.in_pipe_stage(bt_depth, paren_depth, bg))
                {
                    self.clear_abort_floor();
                }
                self.clear_bang_pipe_at(bt_depth, paren_depth, bg, true);
            }
        }
        let Some((bf, pf)) = self.abort_floor else { self.prev_ch = Some(ch); return; };
        if active_braces == 0 && bt_depth <= bf && paren_depth <= pf {
            if !self.in_rhs_list && !in_case_pat && ch == '|' && next != Some('|') && !matches!(prev, Some('|' | '>')) {
                self.clear_abort_floor();
                self.prev_ch = Some(ch);
                return;
            }
            if ch == '&' && next != Some('&') && next != Some('>') && !matches!(prev, Some('&' | '>' | '<' | '|' | ';')) {
                self.clear_abort_floor();
                self.prev_ch = Some(ch);
                return;
            }
            if (ch == '&' && (next == Some('&') || prev == Some('&')))
                || (ch == '|' && (next == Some('|') || prev == Some('|')))
            {
                (self.abort_scope, self.in_failed_part, self.continues_list, self.in_rhs_list) = (0, false, true, true);
            } else if ch == ';' {
                (self.abort_scope, self.in_failed_part, self.continues_list, self.in_rhs_list) = (0, false, false, false);
            } else if !matches!(ch, ' ' | '\t') {
                self.continues_list = false;
            }
        }
        self.prev_ch = Some(ch);
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn on_newline(
        &mut self,
        in_code: bool,
        bt_depth: usize,
        paren_depth: usize,
        compound_depth: usize,
        bg: usize,
        in_cond: Option<(CompoundKind, usize)>,
        cur: Cursor,
    ) {
        if in_code {
            self.cmd_ready = true;
            self.cur_cmd_id += 1;
            self.cond_candidate_abort = None;
            let (mut active_part, mut lhs_sub_fl) = (false, false);
            if let Some(c) = self.active_cmd_mut(bt_depth, paren_depth) {
                c.flush_on_newline(cur);
                lhs_sub_fl = c.take_lhs_sub_floor();
                active_part = c.has_cmd_word || c.cur_assign.is_some() || c.cur_redir.is_some();
            }
            if lhs_sub_fl {
                self.trigger_lhs_sub_floor(bt_depth, paren_depth);
            }
            if active_part {
                self.clear_pending_hd_at(bt_depth, paren_depth);
            }
            self.clear_cmd_at(bt_depth, paren_depth);
            (self.abort_scope, self.in_failed_part) = (0, false);
            if let Some((kind, idx)) = in_cond && !self.continues_list && self.abort_floor == Some((bt_depth, paren_depth)) {
                if self.and_only_abort || self.or_only_abort {
                    self.pending_cond_hd_abort = Some((bt_depth, paren_depth, kind, idx, self.or_only_abort));
                } else if self.fd0_in_redir_abort {
                    self.pending_cond_hd_abort = Some((bt_depth, paren_depth, kind, idx, self.has_bang_at(bt_depth, paren_depth, bg)));
                }
            }
            if paren_depth == 0 && bg == 0 && compound_depth == 0 {
                if self.pending_exit_abort.is_some_and(|(bd, pd, _, _, _, _)| bd == bt_depth && pd == 0) {
                    self.pending_exit_abort = None;
                }
                if self.pending_bt_assign_abort.is_some_and(|(bd, pd, _)| bd == bt_depth && pd == 0) {
                    self.pending_bt_assign_abort = None;
                }
                if self.pending_case_bt_abort.is_some_and(|(bd, pd, _, _, _)| bd == bt_depth && pd == 0) {
                    self.pending_case_bt_abort = None;
                }
            } else if (bg > 0 || paren_depth > 0)
                && let Some((bd, pd, pbg, in_bang, _, fh)) = self.pending_exit_abort
                && (bd, pd) == (bt_depth, paren_depth)
            {
                self.pending_exit_abort = Some((bd, pd, pbg, in_bang, true, fh));
            }
            if !self.continues_pipe {
                self.on_subshell_sep(bt_depth, paren_depth, bg, false);
                if (self.abort_floor == Some((bt_depth, paren_depth)) && self.in_pipe_stage(bt_depth, paren_depth, bg))
                    || (self.fd0_in_redir_abort && !self.continues_list && self.abort_floor == Some((bt_depth, paren_depth)))
                {
                    self.clear_abort_floor();
                }
                self.clear_bang_pipe_at(bt_depth, paren_depth, bg, true);
            }
        }
        if in_code && !self.continues_list && compound_depth == 0
            && self.abort_floor.is_some_and(|(bf, _)| bt_depth <= bf) && self.nl_clear_depth == Some(paren_depth)
        {
            self.clear_abort_floor();
        }
        (self.continues_list, self.continues_pipe, self.in_rhs_list, self.prev_ch) = (false, false, false, None);
    }
}
