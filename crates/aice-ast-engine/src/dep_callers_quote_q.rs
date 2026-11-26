use crate::dep_callers_bash_bt::{
    QuoteEscDqOutcome, QuoteSqOutcome, step_quote_bash_sq, step_quote_esc_dq_bs,
};
use crate::dep_callers_bash_dq::BashDqAction;
use crate::dep_callers_quote::{QuoteDepthTracker, StepKind};

impl QuoteDepthTracker {
    pub(super) fn step_quoted(&mut self, ch: char, next: Option<char>) -> StepKind {
        if self.bash_case.is_some() && (self.bash_ansi_sq || self.quote == Some('\'')) {
            let bt_d = self.bash_bt_depth();
            let ansi_outer_d = self.bash_dq.ansi_sq_bt_ctx(bt_d).map(|c| c.0);
            match step_quote_bash_sq(&mut self.bash_bs, (self.bash_ansi_sq, ansi_outer_d), bt_d, ch) {
                QuoteSqOutcome::InQuote => return StepKind::InQuote,
                QuoteSqOutcome::ExitedSq => {
                    (self.quote, self.bash_ansi_sq) = (None, false);
                    if let Some(bc) = &mut self.bash_case { bc.on_quote_end(); }
                    return StepKind::InQuote;
                }
                QuoteSqOutcome::ExitBt(layer) => {
                    (self.quote, self.bash_ansi_sq) = (None, false);
                    return self.step_bash_bt_delim(layer);
                }
            }
        }
        if self.bash_case.is_some()
            && self.quote == Some('"')
            && (self.bash_dq.in_esc_dq_context(self.bash_dq_bt_layers.max(self.bash_bt_depth()))
                || self.bash_dq.in_ansi_sq())
        {
            if ch == '\\' { self.bash_bs += 1; return StepKind::InQuote; }
            if self.bash_bs > 0 {
                let bs = std::mem::take(&mut self.bash_bs);
                if ch == '\'' && let Some(k) = self.try_abort_bt_sq_in_param(bs) { return k; }
                let (d, mask) = (self.bash_bt_depth(), self.bash_bt_unescape_mask());
                match step_quote_esc_dq_bs(&mut self.bash_dq, self.bash_case.as_mut(), bs, ch, d, mask) {
                    QuoteEscDqOutcome::ConsumedQuote => { if ch != '\n' { self.bash_dq.reset_dollar(); } return StepKind::InQuote; }
                    QuoteEscDqOutcome::ExitedDq => { self.quote = None; return StepKind::InQuote; }
                    QuoteEscDqOutcome::OpenedBt => {
                        if let Some(bc) = &self.bash_case { self.braces = bc.active_braces(); }
                        self.quote = None;
                        return StepKind::Other;
                    }
                    QuoteEscDqOutcome::ExitBt(layer) => {
                        self.quote = None;
                        return self.step_bash_bt_delim(layer);
                    }
                    QuoteEscDqOutcome::Fallthrough => {}
                }
            }
        }
        if self.escaped { self.escaped = false; if ch != '\n' { self.bash_dq.reset_dollar(); } return StepKind::InQuote; }
        if ch == '\\'
            && (self.bash_case.is_none()
                || (self.quote == Some('"') && (!self.bash_dq.in_sq() || self.bash_dq.in_ansi_sq() || next != Some('\''))))
        {
            self.escaped = true;
            return StepKind::InQuote;
        }
        if self.bash_case.is_none() && self.quote == Some('`') && ch == '$' && next == Some('{') {
            self.tpl_depths.push(0);
            self.quote = None;
            return StepKind::EnterTemplate;
        }
        if self.bash_case.is_some() && self.quote == Some('"') {
            if ch == '`' && self.bash_bt_depth() > 0 {
                self.quote = None;
                return self.step_bash_bt_delim(1);
            }
            if ch == '\'' && let Some(k) = self.try_abort_bt_sq_in_param(0) {
                return k;
            }
            let bc = self.bash_case.as_mut().unwrap();
            return match self.bash_dq.step_dq(ch, next) {
                BashDqAction::EnterSub => {
                    self.cmd_sub_depths.push(0);
                    bc.on_enter_quoted_sub();
                    self.braces = bc.active_braces();
                    self.quote = None;
                    StepKind::EnterTemplate
                }
                BashDqAction::EnterBt => {
                    let u = self.bash_dq.last_bt_unescapes();
                    bc.on_enter_bt(true, u);
                    self.braces = bc.active_braces();
                    self.quote = None;
                    StepKind::Other
                }
                BashDqAction::EnterParam => StepKind::EnterTemplate,
                BashDqAction::ExitDq => {
                    self.quote = None;
                    bc.on_quote_end();
                    StepKind::InQuote
                }
                BashDqAction::Stay => StepKind::InQuote,
            };
        }
        if Some(ch) == self.quote {
            self.quote = None;
            if let Some(bc) = &mut self.bash_case { bc.on_quote_end(); }
        }
        StepKind::InQuote
    }
}
