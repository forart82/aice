use crate::dep_callers_bash::{
    BashCaseTracker, BashWrapper, CasePhase, CaseTermKind, CompoundEvent, FnState, LastDelim,
    OpenParenKind,
};

impl BashCaseTracker {
    pub(crate) fn on_char(&mut self, ch: char) {
        if matches!(ch, ';' | '{' | '}' | '&' | '|') {
            let is_brace = matches!(ch, '{' | '}');
            if (self.active_braces() > 0 && !is_brace) || (is_brace && self.word_eq) {
                self.mark_pat_chars();
                let pd = self.paren_stack.len();
                let zero_braces = self.active_braces() == 0;
                if let Some(c) = self.case_stack.last_mut() && c.scope_depth == pd {
                    if ch == '|' && zero_braces {
                        c.check_pat_match(); c.cur_pat.clear();
                    } else {
                        c.cur_pat.push('\0');
                    }
                }
                if is_brace { self.step_brace(ch); } else if !self.word_eq { self.tok.push('\0'); }
                (self.prev_semi, self.boundary) = (false, false);
            } else {
                let brace_grp = ch == '{' && self.active_braces() == 0 && self.last_ch != Some('$')
                    && !self.in_case_pat_context() && (self.boundary || self.fn_state == FnState::Ready) && self.tok.is_empty();
                let closed_grp = ch == '}' && !brace_grp && self.active_braces() == 0 && self.brace_grp_depth > 0;
                self.finish_word(false, false);
                if is_brace {
                    self.mark_pat_chars(); self.step_brace(ch);
                    if brace_grp {
                        self.brace_grp_depth += 1;
                        self.brace_grp_pds.push(self.paren_stack.len());
                    } else if ch == '}' && self.active_braces() == 0 {
                        self.brace_grp_depth = self.brace_grp_depth.saturating_sub(1);
                        self.brace_grp_pds.pop();
                    }
                    if !brace_grp { self.tok.push('\0'); }
                }
                let case_depth = self.case_stack.len();
                let pd = self.paren_stack.len();
                let pat_pd = pd - usize::from(matches!(self.paren_stack.last(), Some(&(OpenParenKind::CasePat, _))));
                let dsemi_amp = ch == '&' && self.last_ch == Some(';')
                    && self.case_stack.last().is_some_and(|c| c.scope_depth == pd && c.phase == CasePhase::ExpectPat && !c.pat_has_chars);
                let case_term = matches!(ch, ';' | '&') && self.prev_semi;
                if let Some(c) = self.case_stack.last_mut() && c.scope_depth == pat_pd {
                    if ch == '|' && c.phase == CasePhase::ExpectPat {
                        c.check_pat_match(); c.cur_pat.clear();
                    } else if case_term && matches!(c.phase, CasePhase::InBody | CasePhase::ExpectPat) {
                        c.prev_arms_cannot_match &= c.arm_all_nonmatch_lits;
                        c.arm_all_nonmatch_lits = true;
                        (c.phase, c.pat_has_chars, c.arm_idx, c.pat_matches) = (CasePhase::ExpectPat, false, c.arm_idx + 1, false);
                        c.cur_pat.clear();
                        let kind = if ch == ';' { CaseTermKind::Dsemi } else { CaseTermKind::SemiAmp };
                        self.pending_event = CompoundEvent::CaseTerm(case_depth, kind);
                    } else if dsemi_amp {
                        self.pending_event = CompoundEvent::CaseTerm(case_depth, CaseTermKind::DsemiAmp);
                    }
                }
                let ok = if ch == '{' { brace_grp } else { ch != '}' && !case_term && !dsemi_amp && !self.in_case_pat_context() };
                self.set(ok, ok, BashWrapper::None, ch == ';' && !case_term);
                if closed_grp { self.compound_end = true; }
            }
        } else if ch.is_whitespace() {
            if self.active_braces() > 0 {
                self.mark_pat_chars();
                if !self.word_eq { self.tok.push('\0'); }
                (self.prev_semi, self.boundary) = (false, false);
            } else {
                self.finish_word(true, false);
                self.prev_semi = false;
            }
        } else {
            self.mark_pat_chars();
            let pd = self.paren_stack.len();
            let pat_pd = pd - usize::from(matches!(self.paren_stack.last(), Some(&(OpenParenKind::CasePat, _))));
            let zero_braces = self.active_braces() == 0;
            if let Some(c) = self.case_stack.last_mut() && c.scope_depth == pat_pd && c.phase == CasePhase::ExpectPat {
                if zero_braces { c.cur_pat.push(ch); } else { c.cur_pat.push('\0'); }
            }
            (self.prev_semi, self.boundary, self.for_kw) = (false, false, false);
            if self.fn_state == FnState::Ready { self.fn_state = FnState::None; }
            if !self.word_eq {
                let valid = !self.tok.is_empty() && !self.tok.as_bytes()[0].is_ascii_digit()
                    && self.tok.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_');
                if self.env_ok && ch == '=' && valid { self.word_eq = true; } else { self.tok.push(ch); }
            }
        }
        self.last_ch = if ch == '$' && self.last_ch == Some('$') { None } else { Some(ch) };
        self.last_delim = LastDelim::None;
    }

    pub(crate) fn on_quote_start(&mut self) {
        if !self.word_eq { self.finish_word(false, false); }
        self.for_kw = false;
        if self.fn_state == FnState::Ready { self.fn_state = FnState::None; }
        self.last_delim = LastDelim::None;
        self.mark_pat_chars();
        if let Some(c) = self.case_stack.last_mut() && c.scope_depth == self.paren_stack.len() && c.phase == CasePhase::ExpectPat {
            c.cur_pat.push('\0');
        }
    }
    pub(crate) fn on_quote_end(&mut self) {
        if !self.word_eq { self.tok.push('\0'); self.set(false, false, BashWrapper::None, false); }
        if let Some(c) = self.case_stack.last_mut() && c.scope_depth == self.paren_stack.len() {
            if c.phase == CasePhase::WaitInWord { c.phase = CasePhase::WaitIn; }
            else if c.phase == CasePhase::ExpectPat { c.pat_has_chars = true; }
        }
        (self.prev_semi, self.last_ch, self.last_delim) = (false, Some('"'), LastDelim::None);
    }
    pub(crate) fn on_escape_char(&mut self) {
        self.mark_pat_chars();
        if let Some(c) = self.case_stack.last_mut() && c.scope_depth == self.paren_stack.len() && c.phase == CasePhase::ExpectPat {
            c.cur_pat.push('\0');
        }
        self.for_kw = false;
        if !self.word_eq { self.tok.push('\0'); }
        if self.fn_state == FnState::Ready { self.fn_state = FnState::None; }
        (self.prev_semi, self.boundary, self.last_ch, self.last_delim) = (false, false, None, LastDelim::None);
    }
    pub(crate) fn on_cont_dollar(&mut self, pop_tok: bool) {
        if self.last_ch == Some('$') { self.last_ch = None; }
        if pop_tok && self.tok.ends_with('$') { self.tok.pop(); }
    }
    pub(crate) fn on_newline(&mut self) {
        if self.active_braces() > 0 {
            self.mark_pat_chars();
            if !self.word_eq { self.tok.push('\0'); }
            (self.prev_semi, self.boundary) = (false, false);
        } else {
            self.finish_word(true, false);
            let hold = matches!(self.paren_stack.last(), Some(&(OpenParenKind::CasePat, _)))
                || self.case_stack.last().is_some_and(|c| c.scope_depth == self.paren_stack.len() && c.phase != CasePhase::InBody);
            self.set(!hold, !hold, BashWrapper::None, false);
        }
        (self.last_ch, self.last_delim) = (None, LastDelim::None);
    }
    pub(crate) fn after_stmt_match(&mut self, ended_boundary: bool, ended_semi: bool) {
        self.set(ended_boundary, ended_boundary, BashWrapper::None, ended_semi);
        self.tok.clear(); self.last_ch = ended_semi.then_some(';'); self.pending_bang = false;
    }
    pub(crate) fn on_stmt_rejected(&mut self) {
        self.set(false, false, BashWrapper::None, false); self.tok.clear(); self.pending_bang = false;
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum IdentKind { Scalar, Subscript, Invalid }

pub(crate) fn tok_is_subscript_lhs_prefix(s: &str) -> bool {
    let b = s.as_bytes();
    let Some(lb) = b.iter().position(|&c| c == b'[') else { return false };
    let name = &b[..lb];
    !name.is_empty()
        && (name[0].is_ascii_alphabetic() || name[0] == b'_')
        && name[1..].iter().all(|&c| c.is_ascii_alphanumeric() || c == b'_')
}

pub(crate) fn ident_kind(s: &str) -> IdentKind {
    let b = s.as_bytes();
    let mut end = b.len();
    if end > 0 && b[end - 1] == b'+' { end -= 1; }
    let mut is_sub = false;
    if end > 1 && b[end - 1] == b']'
        && let Some(lb) = b[..end - 1].iter().position(|&c| c == b'[')
        && lb + 1 < end - 1
    {
        end = lb;
        is_sub = true;
    }
    let name = &b[..end];
    if !name.is_empty()
        && (name[0].is_ascii_alphabetic() || name[0] == b'_')
        && name[1..].iter().all(|&c| c.is_ascii_alphanumeric() || c == b'_')
    {
        if is_sub { IdentKind::Subscript } else { IdentKind::Scalar }
    } else {
        IdentKind::Invalid
    }
}

pub(crate) fn is_bash_kw(s: &str, time_state: u8) -> bool {
    (time_state == 1 && s == "-p")
        || (matches!(time_state, 1 | 2) && s == "--")
        || matches!(
            s,
            "if" | "then" | "elif" | "else" | "fi" | "while" | "until" | "do" | "done"
                | "for" | "select" | "case" | "esac" | "time" | "!"
        )
}
