#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum BashClose {
    BareCasePat, ParenCasePat, ExitQuotedSub, ExitUnqSub, ProcSub, InBraces, NormalSub, Normal,
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum BashOpen { Normal, InBraces }
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum OpenParenKind {
    Normal, CasePat, UnqSub, QuotedSub, ProcSub, UnqBt, QuotedBt(bool), NestedBt(bool),
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum LastDelim { None, OpenBt, CloseCommentParen }
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum CasePhase { WaitInWord, WaitIn, ExpectPat, InBody }
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum CaseTermKind { Dsemi, SemiAmp, DsemiAmp }

pub(crate) fn simple_lit_word(s: &str) -> Option<&str> {
    if s.is_empty() || s.contains(['\0', '$', '`', '\\', '*', '?', '[', '(', '\'', '"']) {
        None
    } else {
        Some(s)
    }
}

#[derive(Clone)]
pub(super) struct CaseFrame {
    pub(super) phase: CasePhase,
    pub(super) scope_depth: usize,
    pub(super) brace_depth: usize,
    pub(super) pat_has_chars: bool,
    pub(super) arm_idx: usize,
    pub(super) pat_matches: bool,
    pub(super) prev_arms_cannot_match: bool,
    pub(super) arm_all_nonmatch_lits: bool,
    pub(super) word_lit: Option<String>,
    pub(super) cur_pat: String,
}
impl CaseFrame {
    pub(super) fn check_pat_match(&mut self) {
        let p = self.cur_pat.trim();
        if p == "*" {
            self.pat_matches = true;
            self.arm_all_nonmatch_lits = false;
            return;
        }
        if let Some(w) = self.word_lit.as_deref() && let Some(pl) = simple_lit_word(p) {
            if pl == w {
                self.pat_matches = true;
                self.arm_all_nonmatch_lits = false;
            }
        } else {
            self.arm_all_nonmatch_lits = false;
        }
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum BashWrapper { None, Time, Builtin, Command }
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum FnState { None, WaitName, Ready }
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum CompoundKind { If, While, Until, Loop }
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum CompoundPhase { Cond, ElifCond, Body, Else }
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum CompoundEvent {
    None,
    IfThen(usize, bool),
    IfElif(usize),
    IfElse(usize),
    IfFi(usize, CompoundPhase),
    WhileDo(usize),
    WhileDone(usize),
    CaseTerm(usize, CaseTermKind),
    CaseArm(usize, bool),
    CaseEsac(usize),
}

#[derive(Clone)]
pub(crate) struct BashCaseTracker {
    pub(crate) boundary: bool, pub(super) env_ok: bool, pub(super) word_eq: bool, pub(super) wrapper: BashWrapper,
    pub(super) fn_state: FnState, pub(super) for_kw: bool, pub(super) compound_end: bool,
    pub(super) tok: String, pub(super) prev_semi: bool, pub(super) last_ch: Option<char>, pub(super) last_delim: LastDelim,
    pub(super) paren_stack: Vec<(OpenParenKind, usize)>, top_braces: usize, pub(super) brace_grp_depth: usize,
    pub(super) brace_grp_pds: Vec<usize>,
    pub(super) case_stack: Vec<CaseFrame>, pub(super) compound_stack: Vec<(CompoundKind, CompoundPhase, usize, usize)>,
    pub(super) cmd_sub_saved: Vec<(bool, bool, bool, BashWrapper, bool, usize)>,
    pub(super) pending_event: CompoundEvent,
    pub(super) pending_bang: bool,
}

impl BashCaseTracker {
    pub(crate) fn new() -> Self {
        Self {
            boundary: true, env_ok: true, word_eq: false, wrapper: BashWrapper::None,
            fn_state: FnState::None, for_kw: false, compound_end: false,
            tok: String::new(), prev_semi: false, last_ch: None, last_delim: LastDelim::None,
            paren_stack: Vec::new(), top_braces: 0, brace_grp_depth: 0, brace_grp_pds: Vec::new(),
            case_stack: Vec::new(), compound_stack: Vec::new(), cmd_sub_saved: Vec::new(),
            pending_event: CompoundEvent::None, pending_bang: false,
        }
    }
    pub(crate) fn take_event(&mut self) -> CompoundEvent { std::mem::replace(&mut self.pending_event, CompoundEvent::None) }
    pub(crate) fn take_bang(&mut self) -> bool { std::mem::take(&mut self.pending_bang) }
    pub(crate) fn active_braces(&self) -> usize { self.paren_stack.last().map_or(self.top_braces, |p| p.1) }
    pub(crate) fn paren_depth(&self) -> usize { self.paren_stack.len() }
    pub(crate) fn brace_grp_depth(&self) -> usize { self.brace_grp_depth }
    pub(crate) fn in_inner_brace_grp(&self) -> bool {
        let pd = self.paren_stack.len();
        self.brace_grp_pds.last().is_some_and(|&p| p == pd)
    }
    pub(crate) fn in_normal_subshell(&self) -> bool {
        matches!(self.paren_stack.last(), Some(&(OpenParenKind::Normal, _)))
    }
    pub(crate) fn cond_depth(&self) -> usize { self.compound_stack.len() }
    pub(crate) fn quoted_sub_count(&self) -> usize { self.paren_stack.iter().filter(|(k, _)| *k == OpenParenKind::QuotedSub).count() }
    pub(crate) fn arith_boundary(&self) -> bool {
        self.boundary || self.for_kw || self.fn_state == FnState::Ready
            || (self.active_braces() == 0 && self.env_ok && !self.word_eq && self.tok == "for")
    }
    pub(crate) fn last_is_dollar(&self) -> bool { self.last_ch == Some('$') }
    pub(crate) fn total_braces(&self) -> usize { self.top_braces + self.paren_stack.iter().map(|p| p.1).sum::<usize>() }
    pub(crate) fn in_bt(&self) -> bool {
        self.paren_stack.iter().any(|(k, _)| matches!(k, OpenParenKind::UnqBt | OpenParenKind::QuotedBt(_) | OpenParenKind::NestedBt(_)))
    }
    pub(crate) fn last_open_bt(&self) -> bool { self.last_delim == LastDelim::OpenBt }
    pub(crate) fn last_close_allows_hash(&self) -> bool { self.last_delim == LastDelim::CloseCommentParen }
    pub(super) fn set(&mut self, b: bool, e: bool, w: BashWrapper, semi: bool) {
        (self.boundary, self.env_ok, self.word_eq, self.wrapper, self.prev_semi, self.fn_state, self.for_kw, self.compound_end, self.last_delim) =
            (b, e, false, w, semi, FnState::None, false, false, LastDelim::None);
    }
    fn in_pat_at_depth(&self) -> bool {
        self.case_stack.last().is_some_and(|c| c.scope_depth == self.paren_stack.len() && c.phase == CasePhase::ExpectPat)
    }
    pub(crate) fn in_case_pat_context(&self) -> bool {
        self.in_pat_at_depth() || matches!(self.paren_stack.last(), Some(&(OpenParenKind::CasePat, _)))
    }
    pub(crate) fn case_depth(&self) -> usize { self.case_stack.len() }
    pub(crate) fn unentered_case_scope(&self) -> Option<usize> {
        self.case_stack.last().filter(|c| c.scope_depth == self.paren_stack.len() && c.phase != CasePhase::InBody).map(|c| c.scope_depth)
    }
    pub(crate) fn in_case_body(&self) -> Option<(usize, bool)> {
        let c = self.case_stack.last()?;
        (c.scope_depth == self.paren_stack.len() && c.brace_depth == self.brace_grp_depth && c.phase == CasePhase::InBody)
            .then_some((self.case_stack.len(), c.prev_arms_cannot_match && c.pat_matches))
    }
    pub(crate) fn in_cond(&self) -> Option<(CompoundKind, usize)> {
        let &(k, ph, sd, bd) = self.compound_stack.last()?;
        (sd == self.paren_stack.len() && bd == self.brace_grp_depth
            && matches!(k, CompoundKind::If | CompoundKind::While | CompoundKind::Until)
            && matches!(ph, CompoundPhase::Cond | CompoundPhase::ElifCond))
            .then_some((k, self.compound_stack.len()))
    }
    pub(crate) fn if_branch_kind(&self) -> Option<(usize, bool)> {
        let &(k, ph, sd, bd) = self.compound_stack.last()?;
        if k != CompoundKind::If || sd != self.paren_stack.len() || bd != self.brace_grp_depth { return None; }
        match ph {
            CompoundPhase::Body | CompoundPhase::Else => Some((self.compound_stack.len(), false)),
            CompoundPhase::ElifCond => Some((self.compound_stack.len(), true)),
            CompoundPhase::Cond => None,
        }
    }
    pub(super) fn mark_pat_chars(&mut self) {
        if let Some(c) = self.case_stack.last_mut() && c.scope_depth == self.paren_stack.len() && c.phase == CasePhase::ExpectPat { c.pat_has_chars = true; }
    }
    pub(super) fn step_brace(&mut self, ch: char) {
        let target = self.paren_stack.last_mut().map_or(&mut self.top_braces, |p| &mut p.1);
        if ch == '{' && self.last_ch == Some('$') { *target += 1; } else if ch == '}' { *target = target.saturating_sub(1); }
    }
    pub(super) fn restore_cmd_sub(&mut self) {
        if let Some((b, e, eq, w, s, bg)) = self.cmd_sub_saved.pop() {
            (self.boundary, self.env_ok, self.word_eq, self.wrapper, self.prev_semi, self.fn_state, self.for_kw, self.last_delim, self.brace_grp_depth) =
                (b, e, eq, w, s, FnState::None, false, LastDelim::None, bg);
        } else { self.set(false, false, BashWrapper::None, false); self.brace_grp_depth = 0; }
        self.tok.clear();
        self.pending_bang = false;
        if let Some(c) = self.case_stack.last_mut() && c.scope_depth == self.paren_stack.len() && c.phase == CasePhase::WaitInWord { c.phase = CasePhase::WaitIn; }
    }
    pub(crate) fn on_enter_quoted_sub(&mut self) {
        self.paren_stack.push((OpenParenKind::QuotedSub, 0));
        self.cmd_sub_saved.push((self.boundary, self.env_ok, self.word_eq, self.wrapper, self.prev_semi, self.brace_grp_depth));
        self.brace_grp_depth = 0; self.set(true, true, BashWrapper::None, false); self.tok.clear(); self.last_ch = Some('('); self.pending_bang = false;
    }
    pub(crate) fn on_open_paren(&mut self) -> BashOpen {
        if self.active_braces() > 0 && !matches!(self.last_ch, Some('$' | '<' | '>')) {
            self.mark_pat_chars();
            (self.prev_semi, self.boundary, self.last_delim) = (false, false, LastDelim::None);
            if self.fn_state == FnState::Ready { self.fn_state = FnState::None; }
            if !self.word_eq { self.tok.push('\0'); }
            self.last_ch = Some('(');
            return BashOpen::InBraces;
        }
        if !(self.word_eq && matches!(self.last_ch, Some('$' | '<' | '>'))) {
            let allow_for_paren = !matches!(self.last_ch, Some('$' | '<' | '>'));
            self.finish_word(false, allow_for_paren);
        }
        self.for_kw = false;
        let in_pat = self.in_pat_at_depth();
        let pat_empty = self.case_stack.last().is_some_and(|c| !c.pat_has_chars);
        if in_pat && pat_empty && !matches!(self.last_ch, Some('$' | '<' | '>')) {
            self.paren_stack.push((OpenParenKind::CasePat, 0));
            self.set(false, false, BashWrapper::None, false);
        } else if matches!(self.last_ch, Some('$' | '<' | '>')) {
            let k = if self.last_ch == Some('$') { OpenParenKind::UnqSub } else { OpenParenKind::ProcSub };
            self.paren_stack.push((k, 0));
            self.cmd_sub_saved.push((self.boundary, self.env_ok, self.word_eq, self.wrapper, self.prev_semi, self.brace_grp_depth));
            self.brace_grp_depth = 0; self.set(true, true, BashWrapper::None, false); self.tok.clear();
        } else {
            self.paren_stack.push((OpenParenKind::Normal, 0));
            let ok = !in_pat && (self.boundary || self.fn_state == FnState::Ready);
            self.set(ok, ok, BashWrapper::None, false);
        }
        self.last_ch = Some('(');
        BashOpen::Normal
    }
    pub(crate) fn on_close_paren(&mut self) -> BashClose {
        if self.active_braces() > 0 {
            (self.last_ch, self.last_delim) = (Some(')'), LastDelim::None);
            self.mark_pat_chars();
            (self.prev_semi, self.boundary) = (false, false);
            if !self.word_eq { self.tok.push('\0'); }
            return BashClose::InBraces;
        }
        self.finish_word(false, false);
        self.last_ch = Some(')');
        let case_d = self.case_stack.len();
        if matches!(self.paren_stack.last(), Some(&(OpenParenKind::CasePat, _))) {
            self.paren_stack.pop();
            if let Some(c) = self.case_stack.last_mut() && c.scope_depth == self.paren_stack.len() && c.phase == CasePhase::ExpectPat {
                c.check_pat_match(); c.cur_pat.clear(); c.phase = CasePhase::InBody;
                self.pending_event = CompoundEvent::CaseArm(case_d, c.arm_all_nonmatch_lits);
            }
            self.set(true, true, BashWrapper::None, false);
            self.last_delim = LastDelim::CloseCommentParen;
            return BashClose::ParenCasePat;
        }
        if let Some(c) = self.case_stack.last_mut() && c.scope_depth == self.paren_stack.len() && c.phase == CasePhase::ExpectPat {
            c.check_pat_match(); c.cur_pat.clear(); c.phase = CasePhase::InBody;
            self.pending_event = CompoundEvent::CaseArm(case_d, c.arm_all_nonmatch_lits);
            self.set(true, true, BashWrapper::None, false);
            self.last_delim = LastDelim::CloseCommentParen;
            return BashClose::BareCasePat;
        }
        let popped = self.paren_stack.pop();
        let depth = self.paren_stack.len();
        self.case_stack.retain(|c| c.scope_depth <= depth);
        self.compound_stack.retain(|&(_, _, d, _)| d <= depth);
        self.brace_grp_pds.retain(|&d| d <= depth);
        match popped {
            Some((OpenParenKind::QuotedSub, _)) => { self.restore_cmd_sub(); BashClose::ExitQuotedSub }
            Some((OpenParenKind::UnqSub, _)) => { self.restore_cmd_sub(); BashClose::ExitUnqSub }
            Some((OpenParenKind::ProcSub, _)) => { self.restore_cmd_sub(); BashClose::ProcSub }
            Some((OpenParenKind::Normal, _)) => {
                self.set(false, false, BashWrapper::None, false);
                self.fn_state = FnState::Ready; self.compound_end = true; self.last_delim = LastDelim::CloseCommentParen;
                BashClose::NormalSub
            }
            _ => { self.set(false, false, BashWrapper::None, false); BashClose::Normal }
        }
    }
}
