use crate::dep_callers_bash::{BashCaseTracker, BashClose, BashOpen};
use crate::dep_callers_bash_bt::{
    QuoteBtCodeAction, classify_quote_bash_bt_bs, step_quote_bash_bt_delim,
};
use crate::dep_callers_quote::{QuoteDepthTracker, StepKind};

impl QuoteDepthTracker {
    pub(super) fn step_bash_bt_delim(&mut self, layer: usize) -> StepKind {
        let Some(bc) = &mut self.bash_case else { return StepKind::Other; };
        let res = match step_quote_bash_bt_delim(bc, &mut self.bash_dq, self.bash_bt_base, layer) {
            Some(true) => {
                self.cmd_sub_depths.truncate(bc.quoted_sub_count());
                self.quote = Some('"');
                StepKind::ExitTemplate
            }
            Some(false) => {
                self.cmd_sub_depths.truncate(bc.quoted_sub_count());
                self.quote = None;
                StepKind::Other
            }
            None => {
                if self.bash_bt_base > 0 && bc.bt_depth() == 0 && layer <= self.bash_bt_base {
                    self.bash_dq.on_exit_bt_layers(usize::MAX);
                    (self.quote, self.bash_ansi_sq, self.escaped) = (None, false, false);
                }
                StepKind::Other
            }
        };
        self.braces = bc.active_braces();
        res
    }

    pub(super) fn try_abort_bt_sq_in_param(&mut self, bs: usize) -> Option<StepKind> {
        let (idx_sq, ansi, inner_bts) = self.bash_dq.bt_in_sq_in_param()?;
        let outer_d = self.bash_bt_depth().saturating_sub(inner_bts);
        if ansi && !crate::dep_callers_bash_bt::is_esc_dq_quote(bs, 0, outer_d) {
            return None;
        }
        let bc = self.bash_case.as_mut()?;
        if bc.bt_depth() < inner_bts {
            return None;
        }
        let target = bc.bt_depth() + 1 - inner_bts;
        bc.on_exit_bt_layer(target);
        self.bash_dq.abort_bt_to_sq_in_param(idx_sq, inner_bts);
        self.cmd_sub_depths.truncate(bc.quoted_sub_count());
        self.braces = bc.active_braces();
        self.quote = Some('"');
        self.bash_ansi_sq = false;
        self.escaped = false;
        Some(StepKind::ExitTemplate)
    }

    pub(crate) fn step(&mut self, ch: char, next: Option<char>) -> StepKind {
        if self.quote.is_some() {
            return self.step_quoted(ch, next);
        }
        if self.bash_case.is_some() && (self.in_bash_bt() || self.bash_bt_base > 0 || self.bash_dq_bt_layers > 0) {
            if ch == '\\' {
                self.bash_bs += 1;
                return StepKind::Other;
            }
            if self.bash_bs > 0 {
                let bs = std::mem::take(&mut self.bash_bs);
                if ch == '\'' && let Some(k) = self.try_abort_bt_sq_in_param(bs) { return k; }
                let (d, mask) = (self.bash_bt_depth(), self.bash_bt_unescape_mask());
                let act = self.bash_case.as_mut().map_or(QuoteBtCodeAction::Fallthrough, |bc| {
                    classify_quote_bash_bt_bs(bc, &mut self.bash_dq, bs, ch, d, mask)
                });
                match act {
                    QuoteBtCodeAction::BtDelim(layer) => return self.step_bash_bt_delim(layer),
                    QuoteBtCodeAction::OpenEscDq => { self.quote = Some('"'); return StepKind::QuoteStart; }
                    QuoteBtCodeAction::ReturnOther => return StepKind::Other,
                    QuoteBtCodeAction::Fallthrough => {}
                }
            }
        }
        if self.escaped {
            self.escaped = false;
            if let Some(bc) = &mut self.bash_case { bc.on_escape_char(); }
            return StepKind::Other;
        }
        if self.bash_case.is_some() && ch == '\\' {
            self.escaped = true;
            if let Some(bc) = &mut self.bash_case { bc.on_escape_char(); }
            return StepKind::Other;
        }
        match ch {
            '`' if self.bash_case.is_some() => self.step_bash_bt_delim(1),
            '\'' if self.bash_case.is_some() => {
                if let Some(k) = self.try_abort_bt_sq_in_param(0) { return k; }
                self.quote = Some('\'');
                self.bash_ansi_sq = self.bash_case.as_ref().is_some_and(BashCaseTracker::last_is_dollar);
                if let Some(bc) = &mut self.bash_case { bc.on_quote_start(); }
                StepKind::QuoteStart
            }
            '\'' | '"' | '`' => {
                self.quote = Some(ch);
                self.bash_ansi_sq = ch == '\'' && self.bash_case.as_ref().is_some_and(BashCaseTracker::last_is_dollar);
                if let Some(bc) = &mut self.bash_case {
                    bc.on_quote_start();
                    if ch == '"' { self.bash_dq.on_open_dq(); }
                }
                StepKind::QuoteStart
            }
            '{' => {
                if let Some(d) = self.tpl_depths.last_mut() { *d += 1; }
                else if let Some(bc) = &mut self.bash_case { bc.on_char('{'); self.braces = bc.active_braces(); }
                else { self.braces += 1; }
                StepKind::OpenBrace
            }
            '}' => {
                if let Some(d) = self.tpl_depths.last_mut() {
                    if *d == 0 { self.tpl_depths.pop(); self.quote = Some('`'); return StepKind::ExitTemplate; }
                    *d -= 1;
                } else if let Some(bc) = &mut self.bash_case { bc.on_char('}'); self.braces = bc.active_braces(); }
                else { self.braces = self.braces.saturating_sub(1); }
                StepKind::CloseBrace
            }
            '(' => {
                if let Some(bc) = &mut self.bash_case {
                    let open = bc.on_open_paren();
                    self.braces = bc.active_braces();
                    if open == BashOpen::InBraces { return StepKind::Other; }
                }
                if let Some(d) = self.cmd_sub_depths.last_mut() { *d += 1; } else { self.parens += 1; }
                StepKind::Other
            }
            ')' => {
                if let Some(bc) = &mut self.bash_case {
                    let close = bc.on_close_paren();
                    self.braces = bc.active_braces();
                    match close {
                        BashClose::BareCasePat | BashClose::InBraces => return StepKind::Other,
                        BashClose::ExitQuotedSub => {
                            self.cmd_sub_depths.pop();
                            self.bash_dq.on_exit_sub();
                            self.quote = Some('"');
                            return StepKind::ExitTemplate;
                        }
                        BashClose::ParenCasePat | BashClose::Normal | BashClose::NormalSub | BashClose::ExitUnqSub | BashClose::ProcSub => {
                            if let Some(d) = self.cmd_sub_depths.last_mut() { *d = d.saturating_sub(1); }
                            else { self.parens = self.parens.saturating_sub(1); }
                            return StepKind::Other;
                        }
                    }
                }
                self.parens = self.parens.saturating_sub(1);
                StepKind::Other
            }
            '[' => { if let Some(bc) = &mut self.bash_case { bc.on_char('['); } self.brackets += 1; StepKind::Other }
            ']' => { if let Some(bc) = &mut self.bash_case { bc.on_char(']'); } self.brackets = self.brackets.saturating_sub(1); StepKind::Other }
            _ => { if let Some(bc) = &mut self.bash_case { bc.on_char(ch); } StepKind::Other }
        }
    }
}
