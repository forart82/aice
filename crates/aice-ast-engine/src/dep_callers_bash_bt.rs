use crate::dep_callers_bash::{BashCaseTracker, BashWrapper, CasePhase, LastDelim, OpenParenKind};

impl BashCaseTracker {
    pub(crate) fn is_bt_top(&self) -> bool {
        matches!(
            self.paren_stack.last(),
            Some((OpenParenKind::UnqBt | OpenParenKind::QuotedBt(_) | OpenParenKind::NestedBt(_), _))
        )
    }

    pub(crate) fn bt_depth(&self) -> usize {
        self.paren_stack
            .iter()
            .filter(|(k, _)| {
                matches!(
                    k,
                    OpenParenKind::UnqBt | OpenParenKind::QuotedBt(_) | OpenParenKind::NestedBt(_)
                )
            })
            .count()
    }

    pub(crate) fn bt_unescape_mask(&self, base_mask: u32, base_depth: usize) -> u32 {
        let mut mask = base_mask;
        let mut bit = base_depth;
        for (k, _) in &self.paren_stack {
            let u = match *k {
                OpenParenKind::QuotedBt(u) | OpenParenKind::NestedBt(u) => u,
                OpenParenKind::UnqBt => false,
                _ => continue,
            };
            if bit < 32 && u {
                mask |= 1u32 << bit;
            }
            bit += 1;
        }
        mask
    }

    pub(crate) fn on_enter_bt(&mut self, quoted: bool, unescape_dq: bool) {
        let kind = if quoted {
            OpenParenKind::QuotedBt(unescape_dq)
        } else {
            OpenParenKind::UnqBt
        };
        self.enter_bt_kind(kind, quoted);
    }

    pub(crate) fn on_enter_nested_bt(&mut self, in_esc_dq: bool) {
        self.enter_bt_kind(OpenParenKind::NestedBt(in_esc_dq), in_esc_dq);
    }

    fn enter_bt_kind(&mut self, kind: OpenParenKind, skip_word_finish: bool) {
        if !skip_word_finish {
            if !self.word_eq {
                self.finish_word(false, false);
            }
            self.mark_pat_chars();
        }
        self.paren_stack.push((kind, 0));
        self.cmd_sub_saved
            .push((self.boundary, self.env_ok, self.word_eq, self.wrapper, self.prev_semi, self.brace_grp_depth));
        self.brace_grp_depth = 0;
        self.set(true, true, BashWrapper::None, false);
        self.tok.clear();
        self.last_ch = Some('`');
        self.last_delim = LastDelim::OpenBt;
    }

    pub(crate) fn on_exit_bt(&mut self) -> Option<bool> {
        let ret_dq = match self.paren_stack.last() {
            Some(&(OpenParenKind::QuotedBt(_), _)) => true,
            Some(&(OpenParenKind::UnqBt, _)) => false,
            Some(&(OpenParenKind::NestedBt(ret_dq), _)) => ret_dq,
            _ => return None,
        };
        self.paren_stack.pop();
        self.restore_cmd_sub();
        self.last_ch = Some('`');
        if ret_dq {
            return Some(true);
        }
        if !self.word_eq {
            self.tok.push('\0');
            self.set(false, false, BashWrapper::None, false);
        }
        if let Some(c) = self.case_stack.last_mut()
            && c.scope_depth == self.paren_stack.len()
            && c.phase == CasePhase::ExpectPat
        {
            c.pat_has_chars = true;
        }
        Some(false)
    }

    pub(crate) fn on_exit_bt_layer(&mut self, target_level: usize) -> Option<(bool, usize)> {
        if target_level == 0 || target_level > self.bt_depth() {
            return None;
        }
        let before_bt = self.bt_depth();
        while self.bt_depth() > target_level {
            if let Some((kind, _)) = self.paren_stack.pop()
                && matches!(
                    kind,
                    OpenParenKind::UnqBt
                        | OpenParenKind::QuotedBt(_)
                        | OpenParenKind::NestedBt(_)
                        | OpenParenKind::UnqSub
                        | OpenParenKind::QuotedSub
                        | OpenParenKind::ProcSub
                )
            {
                self.restore_cmd_sub();
            }
        }
        while let Some(&(kind, _)) = self.paren_stack.last() {
            if matches!(
                kind,
                OpenParenKind::UnqBt | OpenParenKind::QuotedBt(_) | OpenParenKind::NestedBt(_)
            ) {
                break;
            }
            self.paren_stack.pop();
            if matches!(kind, OpenParenKind::UnqSub | OpenParenKind::QuotedSub | OpenParenKind::ProcSub) {
                self.restore_cmd_sub();
            }
        }
        let ret_dq = self.on_exit_bt()?;
        let depth = self.paren_stack.len();
        self.case_stack.retain(|c| c.scope_depth <= depth);
        self.compound_stack.retain(|&(_, _, d, _)| d <= depth);
        self.brace_grp_pds.retain(|&d| d <= depth);
        Some((ret_dq, before_bt - target_level + 1))
    }
}

pub(crate) use crate::dep_callers_bash_bt_bs::{
    EscDqBsAction, ansi_sq_dollar_or_bt_escaped, classify_esc_dq_bs, is_esc_dq_quote,
};
pub(crate) use crate::dep_callers_quote_bt::{
    QuoteBtCodeAction, QuoteEscDqOutcome, QuoteSqOutcome, classify_quote_bash_bt_bs,
    step_quote_bash_bt_delim, step_quote_bash_sq, step_quote_esc_dq_bs,
};
