use aice_lang_registry::LanguageId;

use crate::dep_callers_bash::{BashCaseTracker, CompoundEvent, CompoundKind};
use crate::dep_callers_bash_bt::{ansi_sq_dollar_or_bt_escaped, is_esc_dq_quote};
use crate::dep_callers_bash_dq::BashDqTracker;

pub(crate) const MAX_IMPORT_SPAN_LINES: usize = 512;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum StepKind { InQuote, QuoteStart, EnterTemplate, ExitTemplate, OpenBrace, CloseBrace, Other }

#[derive(Clone)]
pub(crate) struct QuoteDepthTracker {
    pub(crate) quote: Option<char>,
    pub(super) escaped: bool,
    pub(super) bash_ansi_sq: bool,
    pub(super) bash_bs: usize,
    pub(super) bash_bt_base: usize,
    pub(super) bash_bt_mask_base: u32,
    pub(super) bash_dq_bt_layers: usize,
    pub(super) bash_case: Option<BashCaseTracker>,
    pub(crate) bash_dq: BashDqTracker,
    pub(super) tpl_depths: Vec<usize>,
    pub(super) cmd_sub_depths: Vec<usize>,
    pub(crate) braces: usize,
    pub(crate) parens: usize,
    pub(crate) brackets: usize,
}

impl QuoteDepthTracker {
    pub(crate) fn new() -> Self { Self::new_for(LanguageId::PlainText) }
    pub(crate) fn new_for(lang: LanguageId) -> Self {
        Self {
            quote: None, escaped: false, bash_ansi_sq: false, bash_bs: 0, bash_bt_base: 0, bash_bt_mask_base: 0, bash_dq_bt_layers: 0,
            bash_case: (lang == LanguageId::Bash).then(BashCaseTracker::new),
            bash_dq: BashDqTracker::new(), tpl_depths: Vec::new(), cmd_sub_depths: Vec::new(), braces: 0, parens: 0, brackets: 0,
        }
    }
    pub(crate) fn bash_boundary(&self) -> bool { self.bash_case.as_ref().is_some_and(|b| b.boundary) }
    pub(crate) fn bash_arith_boundary(&self) -> bool { self.bash_case.as_ref().is_some_and(BashCaseTracker::arith_boundary) }
    pub(crate) fn bash_last_is_dollar(&self) -> bool { self.bash_case.as_ref().is_some_and(BashCaseTracker::last_is_dollar) }
    pub(crate) fn bash_paren_depth(&self) -> usize { self.bash_case.as_ref().map_or(self.parens, BashCaseTracker::paren_depth) }
    pub(crate) fn bash_allows_hash(&self, b: &[u8], i: usize, line_start: usize) -> bool {
        self.bash_case.as_ref().is_some_and(|bc| {
            bc.active_braces() == 0
                && (i == line_start
                    || b[i - 1] == b'\n'
                    || matches!(b[i - 1], b' ' | b'\t' | b';' | b'&' | b'|' | b'(')
                    || (b[i - 1] == b')' && bc.last_close_allows_hash())
                    || (b[i - 1] == b'`' && bc.last_open_bt()))
        })
    }
    pub(crate) fn in_bash_bt(&self) -> bool { self.bash_case.as_ref().is_some_and(BashCaseTracker::in_bt) }
    pub(crate) fn bash_bt_depth(&self) -> usize { self.bash_bt_base + self.bash_case.as_ref().map_or(0, BashCaseTracker::bt_depth) }
    pub(crate) fn bash_bt_unescape_mask(&self) -> u32 {
        self.bash_case.as_ref().map_or(self.bash_bt_mask_base, |bc| bc.bt_unescape_mask(self.bash_bt_mask_base, self.bash_bt_base))
    }
    pub(crate) fn bash_esc_dq_layers(&self) -> usize { self.bash_dq.esc_dq_layers(self.bash_dq_bt_layers) }
    pub(crate) fn bash_hd_group_ctx(&self) -> Option<(usize, usize, usize, u8)> {
        let bc = self.bash_case.as_ref()?;
        let (pd, bg, kind) = bc.hd_group_ctx()?;
        Some((self.bash_bt_base + bc.bt_depth(), pd, bg, kind))
    }
    pub(crate) fn bash_hd_group_outer_bangs(&self, bangs: &[(usize, usize, usize)]) -> Vec<(usize, usize, usize, u8, bool)> {
        self.bash_case.as_ref().map_or_else(Vec::new, |bc| bc.hd_group_outer_bangs(bangs, self.bash_bt_base))
    }
    pub(crate) fn bash_in_cond(&self) -> Option<(CompoundKind, usize)> { self.bash_case.as_ref()?.in_cond() }
    pub(crate) fn bash_outer_cond_for_grp(&self) -> Option<(CompoundKind, usize, usize, usize)> {
        self.bash_case.as_ref()?.outer_cond_for_grp()
    }
    pub(crate) fn bash_case_depth(&self) -> usize { self.bash_case.as_ref().map_or(0, BashCaseTracker::case_depth) }
    pub(crate) fn bash_cond_depth(&self) -> usize { self.bash_case.as_ref().map_or(0, BashCaseTracker::cond_depth) }
    pub(crate) fn bash_in_normal_subshell(&self) -> bool { self.bash_case.as_ref().is_some_and(BashCaseTracker::in_normal_subshell) }
    pub(crate) fn bash_in_case_body(&self) -> Option<(usize, bool)> { self.bash_case.as_ref()?.in_case_body() }
    pub(crate) fn bash_take_event(&mut self) -> CompoundEvent {
        self.bash_case.as_mut().map_or(CompoundEvent::None, BashCaseTracker::take_event)
    }
    pub(crate) fn bash_take_bang(&mut self) -> bool {
        self.bash_case.as_mut().is_some_and(BashCaseTracker::take_bang)
    }
    pub(crate) fn bash_brace_grp_depth(&self) -> usize {
        self.bash_case.as_ref().map_or(0, BashCaseTracker::brace_grp_depth)
    }
    pub(crate) fn bash_active_braces(&self) -> usize { self.bash_case.as_ref().map_or(self.braces, BashCaseTracker::active_braces) }
    pub(crate) fn bash_param_depth(&self) -> usize { self.bash_case.as_ref().map_or(self.braces, BashCaseTracker::total_braces) + self.bash_dq.param_depth() }
    pub(crate) fn set_bash_stmt_ctx(&mut self, bt_base: usize, bt_mask_base: u32, dq_bt_layers: usize) {
        (self.bash_bt_base, self.bash_bt_mask_base, self.bash_dq_bt_layers) = (bt_base, bt_mask_base, dq_bt_layers);
    }
    pub(crate) fn bash_on_escape_char(&mut self) { if let Some(bc) = &mut self.bash_case { bc.on_escape_char(); } }
    pub(crate) fn is_escaped(&self) -> bool { self.escaped || (self.bash_bs % 2 == 1) }
    pub(crate) fn is_bash_escaped(&self, dollar: bool) -> bool {
        self.escaped || if self.bash_case.is_some() && (self.bash_bt_depth() > 0 || (dollar && self.bash_dq.in_ansi_sq())) {
            if dollar {
                ansi_sq_dollar_or_bt_escaped(self.bash_bs, self.bash_bt_depth(), self.bash_dq.in_ansi_sq())
            } else {
                !is_esc_dq_quote(self.bash_bs, 0, self.bash_bt_depth())
            }
        } else {
            self.bash_bs % 2 == 1
        }
    }
    pub(crate) fn bash_after_stmt(&mut self, ended_boundary: bool, ended_semi: bool) { if let Some(b) = &mut self.bash_case { b.after_stmt_match(ended_boundary, ended_semi); } }
    pub(crate) fn bash_stmt_rejected(&mut self) { if let Some(b) = &mut self.bash_case { b.on_stmt_rejected(); } }
    pub(crate) fn reset_after_stmt(&mut self, keep_parens: bool) {
        (self.quote, self.escaped, self.bash_ansi_sq, self.bash_bs, self.brackets) = (None, false, false, 0, 0);
        self.tpl_depths.clear();
        if !keep_parens { self.parens = 0; }
        if let Some(bc) = &self.bash_case { self.braces = bc.active_braces(); }
    }
    pub(crate) fn at_top_level(&self) -> bool {
        self.quote.is_none() && self.tpl_depths.is_empty() && self.cmd_sub_depths.is_empty()
            && self.braces == 0 && self.parens == 0 && self.brackets == 0
            && !self.in_bash_bt()
    }
    pub(crate) fn bash_in_dq_sq(&self) -> bool { self.quote == Some('"') && self.bash_dq.in_sq() }
    pub(crate) fn bash_in_dq_ansi_sq(&self) -> bool { self.quote == Some('"') && self.bash_dq.in_ansi_sq() }
    pub(crate) fn bash_in_param(&self) -> bool { self.quote == Some('"') && self.bash_dq.in_param() }
    pub(crate) fn bash_dq_prev_dollar(&self) -> bool { self.quote == Some('"') && self.bash_dq.prev_dollar() }
    pub(crate) fn bash_dq_reset_dollar(&mut self) { self.bash_dq.reset_dollar(); }
    pub(crate) fn bash_end_continuation(&mut self, bs: usize) {
        if self.bash_in_dq_sq()
            && crate::dep_callers_bash_cont::bash_sq_suppresses_dollar_ansi(bs, self.bash_bt_depth(), self.bash_in_dq_ansi_sq())
        {
            self.bash_dq.reset_dollar();
        }
        (self.escaped, self.bash_bs) = (false, 0);
    }
    pub(crate) fn end_line(&mut self) {
        if self.bash_case.is_none() && matches!(self.quote, Some('\'' | '"')) { self.quote = None; }
        let (d, in_dq_sq, in_ansi_sq) = (self.bash_bt_depth(), self.bash_in_dq_sq(), self.bash_in_dq_ansi_sq());
        if let Some(bc) = &mut self.bash_case {
            if self.quote.is_none() { bc.on_newline(); self.braces = bc.active_braces(); }
            else if crate::dep_callers_bash_cont::bash_end_line_reset_dollar(self.bash_bs, d, in_dq_sq, in_ansi_sq, self.escaped) {
                self.bash_dq.reset_dollar();
            }
        }
        self.escaped = false;
        self.bash_bs = crate::dep_callers_bash_cont::bash_end_line_bs(self.quote == Some('\''), d, self.bash_bs);
    }
}

pub(crate) fn is_js_ident_char(c: char) -> bool { c.is_alphanumeric() || c == '_' || c == '$' }
pub(crate) fn is_js_ident_start(c: char) -> bool { is_js_ident_char(c) && !c.is_ascii_digit() }
pub(crate) use crate::dep_callers_span::{find_matching_open_brace, mask_span, prev_non_ws_char, skip_ws_forward};
