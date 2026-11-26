use crate::dep_callers_bash::{
    BashCaseTracker, BashWrapper, CaseFrame, CasePhase, CompoundEvent, CompoundKind, CompoundPhase,
    FnState, OpenParenKind, simple_lit_word,
};

impl BashCaseTracker {
    pub(crate) fn hd_group_ctx(&self) -> Option<(usize, usize, u8)> {
        let pd = self.paren_stack.len();
        let bg = self.brace_grp_depth;
        if pd == 0 && bg == 0 { return None; }
        if self.in_inner_brace_grp() { return Some((pd, bg, 0)); }
        let kind = match self.paren_stack.last().map(|p| p.0) {
            Some(OpenParenKind::Normal) => 0,
            Some(OpenParenKind::UnqSub) if self.cmd_sub_saved.last().is_some_and(|s| s.1) => 1,
            Some(OpenParenKind::QuotedSub) if self.cmd_sub_saved.last().is_some_and(|s| s.1) => 2,
            Some(OpenParenKind::UnqBt) if self.cmd_sub_saved.last().is_some_and(|s| s.1) => 3,
            Some(OpenParenKind::QuotedBt(_)) if self.cmd_sub_saved.last().is_some_and(|s| s.1) => 4,
            _ => return None,
        };
        Some((pd, bg, kind))
    }

    pub(crate) fn hd_group_outer_bangs(&self, bangs: &[(usize, usize, usize)], bt_base: usize) -> Vec<(usize, usize, usize, u8, bool)> {
        let (mut out, mut pd, mut bg, mut bt) = (Vec::new(), self.paren_stack.len(), self.brace_grp_depth, bt_base + self.bt_depth());
        let (mut bg_idx, mut sub_idx) = (self.brace_grp_pds.len(), self.cmd_sub_saved.len());
        loop {
            if bg_idx > 0 && self.brace_grp_pds[bg_idx - 1] == pd {
                bg_idx -= 1;
                bg = bg.saturating_sub(1);
                out.push((bt, pd, bg, 0, bangs.contains(&(bt, pd, bg))));
                continue;
            }
            if pd == 0 { break; }
            pd -= 1;
            let k = match self.paren_stack[pd].0 {
                OpenParenKind::Normal => 0,
                OpenParenKind::UnqSub | OpenParenKind::QuotedSub => {
                    bg = sub_idx.checked_sub(1).map_or(0, |i| { sub_idx = i; self.cmd_sub_saved[i].5 });
                    if self.paren_stack[pd].0 == OpenParenKind::UnqSub { 1 } else { 2 }
                }
                OpenParenKind::UnqBt | OpenParenKind::QuotedBt(_) | OpenParenKind::NestedBt(_) => {
                    bt = bt.saturating_sub(1);
                    bg = sub_idx.checked_sub(1).map_or(0, |i| { sub_idx = i; self.cmd_sub_saved[i].5 });
                    if self.paren_stack[pd].0 == OpenParenKind::UnqBt { 3 } else { 4 }
                }
                _ => break,
            };
            out.push((bt, pd, bg, k, bangs.contains(&(bt, pd, bg))));
        }
        out
    }

    pub(crate) fn outer_cond_for_grp(&self) -> Option<(CompoundKind, usize, usize, usize)> {
        let &(k, ph, sd, bd) = self.compound_stack.last()?;
        if matches!(k, CompoundKind::If | CompoundKind::While | CompoundKind::Until)
            && matches!(ph, CompoundPhase::Cond | CompoundPhase::ElifCond)
            && (sd < self.paren_stack.len() || bd < self.brace_grp_depth)
        {
            Some((k, self.compound_stack.len(), sd, bd))
        } else {
            None
        }
    }

    pub(crate) fn compound_depth(&self) -> usize {
        let sd = self.paren_stack.len();
        self.brace_grp_depth
            + self.compound_stack.iter().filter(|&&(_, _, d, _)| d == sd).count()
            + self.case_stack.iter().filter(|c| c.scope_depth == sd).count()
    }

    pub(super) fn finish_word(&mut self, is_ws: bool, allow_for_paren: bool) {
        let (tok, word_eq) = (std::mem::take(&mut self.tok), std::mem::take(&mut self.word_eq));
        let depth = self.paren_stack.len();
        if self.active_braces() == 0 && !word_eq {
            if tok == "case" && (self.boundary || self.env_ok) {
                self.case_stack.push(CaseFrame {
                    phase: CasePhase::WaitInWord,
                    scope_depth: depth,
                    brace_depth: self.brace_grp_depth,
                    pat_has_chars: false,
                    arm_idx: 0,
                    pat_matches: false,
                    prev_arms_cannot_match: true,
                    arm_all_nonmatch_lits: true,
                    word_lit: None,
                    cur_pat: String::new(),
                });
                return self.set(false, false, BashWrapper::None, self.prev_semi);
            }
            if let Some(c) = self.case_stack.last_mut() && c.scope_depth == depth {
                if tok == "in" && c.phase == CasePhase::WaitIn {
                    (c.phase, c.pat_has_chars, c.arm_idx, c.pat_matches) = (CasePhase::ExpectPat, false, 0, false);
                    (c.prev_arms_cannot_match, c.arm_all_nonmatch_lits) = (true, true);
                    c.cur_pat.clear();
                    return self.set(false, false, BashWrapper::None, self.prev_semi);
                }
                if c.phase == CasePhase::WaitInWord && !tok.is_empty() {
                    c.word_lit = simple_lit_word(&tok).map(str::to_string);
                    c.phase = CasePhase::WaitIn;
                    return self.set(false, false, BashWrapper::None, self.prev_semi);
                }
                if tok == "esac" && (self.boundary || self.env_ok || self.compound_end || c.phase == CasePhase::ExpectPat) {
                    let prev_depth = self.case_stack.len();
                    self.case_stack.pop();
                    self.pending_event = CompoundEvent::CaseEsac(prev_depth);
                    self.set(false, false, BashWrapper::None, self.prev_semi);
                    self.compound_end = true;
                    return;
                }
            }
            if !self.in_case_pat_context() && (self.boundary || self.env_ok || self.compound_end) {
                let comp_idx = self.compound_stack.len();
                let bd = self.brace_grp_depth;
                match tok.as_str() {
                    "then" => {
                        if let Some(&mut (CompoundKind::If, ref mut ph, d, b)) = self.compound_stack.last_mut()
                            && d == depth && b == bd && matches!(*ph, CompoundPhase::Cond | CompoundPhase::ElifCond)
                        {
                            let was_elif = *ph == CompoundPhase::ElifCond;
                            *ph = CompoundPhase::Body;
                            self.pending_event = CompoundEvent::IfThen(comp_idx, was_elif);
                            return self.set(true, true, BashWrapper::None, false);
                        }
                    }
                    "elif" => {
                        if let Some(&mut (CompoundKind::If, ref mut ph, d, b)) = self.compound_stack.last_mut()
                            && d == depth && b == bd
                        {
                            *ph = CompoundPhase::ElifCond;
                            self.pending_event = CompoundEvent::IfElif(comp_idx);
                            return self.set(true, true, BashWrapper::None, false);
                        }
                    }
                    "else" => {
                        if let Some(&mut (CompoundKind::If, ref mut ph, d, b)) = self.compound_stack.last_mut()
                            && d == depth && b == bd
                        {
                            *ph = CompoundPhase::Else;
                            self.pending_event = CompoundEvent::IfElse(comp_idx);
                            return self.set(true, true, BashWrapper::None, false);
                        }
                    }
                    "do" => {
                        if let Some(&mut (k @ (CompoundKind::While | CompoundKind::Until | CompoundKind::Loop), ref mut ph, d, b)) = self.compound_stack.last_mut()
                            && d == depth && b == bd && *ph == CompoundPhase::Cond
                        {
                            *ph = CompoundPhase::Body;
                            if matches!(k, CompoundKind::While | CompoundKind::Until) {
                                self.pending_event = CompoundEvent::WhileDo(comp_idx);
                            }
                            return self.set(true, true, BashWrapper::None, false);
                        }
                    }
                    "fi" => {
                        if let Some(&(CompoundKind::If, ph, d, _)) = self.compound_stack.last() && d == depth {
                            self.compound_stack.pop();
                            self.pending_event = CompoundEvent::IfFi(comp_idx, ph);
                            self.set(false, false, BashWrapper::None, self.prev_semi);
                            self.compound_end = true;
                            return;
                        }
                    }
                    "done" => {
                        if let Some(&(k @ (CompoundKind::While | CompoundKind::Until | CompoundKind::Loop), _, d, _)) = self.compound_stack.last() && d == depth {
                            self.compound_stack.pop();
                            if matches!(k, CompoundKind::While | CompoundKind::Until) {
                                self.pending_event = CompoundEvent::WhileDone(comp_idx);
                            }
                            self.set(false, false, BashWrapper::None, self.prev_semi);
                            self.compound_end = true;
                            return;
                        }
                    }
                    _ => {}
                }
            }
        }
        if is_ws && self.fn_state == FnState::WaitName && (!tok.is_empty() || word_eq) {
            self.set(false, false, BashWrapper::None, self.prev_semi);
            self.fn_state = FnState::Ready;
            return;
        }
        if (is_ws || allow_for_paren) && tok == "for" && !word_eq && (self.boundary || self.env_ok) {
            if self.active_braces() == 0 && !self.in_case_pat_context()
                && matches!(self.wrapper, BashWrapper::None | BashWrapper::Time)
            {
                self.compound_stack.push((CompoundKind::Loop, CompoundPhase::Cond, depth, self.brace_grp_depth));
            }
            self.set(false, false, BashWrapper::None, self.prev_semi);
            self.for_kw = true;
            return;
        }
        if (is_ws || allow_for_paren)
            && tok == "!"
            && !word_eq
            && (self.boundary || self.env_ok)
            && self.active_braces() == 0
            && !self.in_case_pat_context()
        {
            self.pending_bang = !self.pending_bang;
            self.set(true, true, self.wrapper, false);
            return;
        }
        if !is_ws || !self.env_ok || (tok.is_empty() && !word_eq) {
            if is_ws && !self.boundary {
                (self.env_ok, self.wrapper) = (false, BashWrapper::None);
            }
            return;
        }
        if tok == "function" && self.wrapper == BashWrapper::None {
            self.set(false, false, BashWrapper::None, self.prev_semi);
            self.fn_state = FnState::WaitName;
            return;
        }
        if self.active_braces() == 0 && !self.in_case_pat_context()
            && matches!(self.wrapper, BashWrapper::None | BashWrapper::Time)
        {
            match tok.as_str() {
                "if" => self.compound_stack.push((CompoundKind::If, CompoundPhase::Cond, depth, self.brace_grp_depth)),
                "while" => self.compound_stack.push((CompoundKind::While, CompoundPhase::Cond, depth, self.brace_grp_depth)),
                "until" => self.compound_stack.push((CompoundKind::Until, CompoundPhase::Cond, depth, self.brace_grp_depth)),
                "select" => self.compound_stack.push((CompoundKind::Loop, CompoundPhase::Cond, depth, self.brace_grp_depth)),
                _ => {}
            }
        }
        let next_w = match tok.as_str() {
            "time" => Some(BashWrapper::Time),
            "builtin" => Some(BashWrapper::Builtin),
            "command" => Some(BashWrapper::Command),
            "if" | "then" | "elif" | "else" | "do" | "while" | "until" => Some(BashWrapper::None),
            "--" if self.wrapper != BashWrapper::None => Some(BashWrapper::None),
            "-p" if matches!(self.wrapper, BashWrapper::Time | BashWrapper::Command) => Some(self.wrapper),
            _ if word_eq => Some(self.wrapper),
            _ => None,
        };
        if let Some(w) = next_w {
            (self.wrapper, self.boundary, self.fn_state) = (w, true, FnState::None);
        } else {
            self.set(false, false, BashWrapper::None, self.prev_semi);
        }
    }
}
