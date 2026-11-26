use std::rc::Rc;

use aice_lang_registry::LanguageId;

use crate::r5::snippet_lex::is_quote_opener;
use crate::r5::snippet_ml_lit::quote_allows_multiline;
pub(crate) fn is_js_like(lang: LanguageId) -> bool {
    matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StepQuote {
    NotInQuote,
    Consumed,
    EnteredInterp,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ScopeKind {
    NormalParen,
    StmtHeaderParen,
    ForHeaderParen,
    Bracket,
    BlockBrace,
    ExprBrace,
    ExprBlockBrace,
    ParenNlDeclBrace,
    TmplInterp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PendingHeader {
    None,
    Stmt,
    For,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct TmplFrame {
    pub(super) start: usize,
    pub(super) brace_depth: usize,
}

#[derive(Debug, Clone)]
pub(crate) struct JsLexState {
    pub(crate) regex_allowed: bool,
    pub(super) after_dot: bool,
    pub(super) expr_pos: bool,
    pub(super) after_stmt_header: bool,
    pub(super) after_export: bool,
    pub(super) after_export_default: bool,
    pub(super) after_declare: bool,
    pub(super) at_line_start: bool,
    pub(super) prev_was_lparen: bool,
    pub(super) after_lparen_nl: bool,
    pub(crate) just_closed_paren_nl_decl: bool,
    pub(crate) saw_paren_nl_decl: bool,
    pub(super) pending_header: PendingHeader,
    pub(super) decl_stack: Vec<super::snippet_js_decl::DeclFrame>,
    pub(super) ts_angle_stack: Vec<usize>,
    pub(super) asi_kw_pending: u8,
    pub(super) type_decl_stage: u8,
    pub(super) type_decl_depth: usize,
    pub(super) type_rhs_continues: bool,
    pub(super) type_rhs_asi_pending: bool,
    pub(super) type_rhs_asi_depth: usize,
    pub(super) ternary_scopes: Vec<usize>,
    pub(crate) no_rbrack_until: usize,
    pub(super) delim_stack: Vec<ScopeKind>,
    pub(super) lparen_pos_stack: Vec<(usize, usize)>,
    pub(super) discarded_unclosed_parens: Vec<usize>,
    pub(super) unclosed_parens: Option<Rc<Vec<usize>>>,
    pub(super) in_prepass: bool,
    pub(super) quote: Option<(u8, usize)>,
    pub(super) tmpl_stack: Vec<TmplFrame>,
}

impl JsLexState {
    pub(crate) fn new() -> Self {
        Self {
            regex_allowed: true,
            after_dot: false,
            expr_pos: false,
            after_stmt_header: false,
            after_export: false,
            after_export_default: false,
            after_declare: false,
            at_line_start: true,
            prev_was_lparen: false,
            after_lparen_nl: false,
            just_closed_paren_nl_decl: false,
            saw_paren_nl_decl: false,
            pending_header: PendingHeader::None,
            decl_stack: Vec::new(),
            ts_angle_stack: Vec::new(),
            asi_kw_pending: 0,
            type_decl_stage: 0,
            type_decl_depth: 0,
            type_rhs_continues: false,
            type_rhs_asi_pending: false,
            type_rhs_asi_depth: 0,
            ternary_scopes: Vec::new(),
            no_rbrack_until: 0,
            delim_stack: Vec::new(),
            lparen_pos_stack: Vec::new(),
            discarded_unclosed_parens: Vec::new(),
            unclosed_parens: None,
            in_prepass: false,
            quote: None,
            tmpl_stack: Vec::new(),
        }
    }

    pub(crate) fn has_open_quote(&self) -> bool {
        self.quote.is_some() || !self.tmpl_stack.is_empty()
    }

    pub(crate) fn active_quote_start(&self) -> Option<usize> {
        self.tmpl_stack.first().map(|t| t.start).or(self.quote.map(|(_, p)| p))
    }

    pub(crate) fn on_newline(&mut self, lang: LanguageId) -> bool {
        if let Some((q, _)) = self.quote {
            if !quote_allows_multiline(lang, q) {
                self.quote = None;
                return true;
            }
            return false;
        }
        if self.prev_was_lparen {
            self.after_lparen_nl = true;
            self.prev_was_lparen = false;
        }
        if is_js_like(lang) {
            self.at_line_start = true;
            if self.asi_kw_pending != 0 {
                self.after_value();
                self.regex_allowed = true;
            } else if matches!(self.type_decl_stage, 1 | 2) && self.ts_angle_stack.is_empty() {
                self.type_decl_stage = 0;
            } else if self.type_decl_stage == 3
                && !self.type_rhs_continues
                && self.ts_angle_stack.is_empty()
                && self.delim_stack.len() == self.type_decl_depth
            {
                self.type_decl_stage = 0;
                self.type_rhs_asi_pending = true;
                self.type_rhs_asi_depth = self.type_decl_depth;
                self.after_value();
                self.regex_allowed = true;
            }
            if self.ts_angle_stack.is_empty()
                && let Some(top) = self.decl_stack.last_mut()
                && top.d == self.delim_stack.len()
            {
                if !top.saw_fn_paren && !top.in_ret_type {
                    top.pending_asi_head = true;
                } else if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx) {
                    if top.is_declare && ((top.in_ret_type && !top.expecting_type_brace) || top.saw_fn_paren) {
                        self.decl_stack.pop();
                        self.regex_allowed = true;
                    } else if top.in_ret_type && !top.expecting_type_brace {
                        top.pending_asi_ret = true;
                    } else if top.saw_fn_paren && !top.in_ret_type {
                        top.pending_asi_fn_paren = true;
                    }
                }
            }
        }
        false
    }

    pub(crate) fn open_quote(&mut self, lang: LanguageId, b: &[u8], i: &mut usize) -> bool {
        if is_quote_opener(lang, b[*i]) {
            if is_js_like(lang) {
                self.before_token(lang, b, *i);
            }
            self.quote = Some((b[*i], *i));
            *i += 1;
            return true;
        }
        false
    }

    pub(crate) fn after_value(&mut self) {
        self.regex_allowed = false;
        self.after_dot = false;
        self.expr_pos = false;
        self.after_stmt_header = false;
        self.pending_header = PendingHeader::None;
        self.after_export = false;
        self.after_export_default = false;
        self.after_declare = false;
        self.at_line_start = false;
        self.prev_was_lparen = false;
        self.after_lparen_nl = false;
        self.just_closed_paren_nl_decl = false;
        self.asi_kw_pending = 0;
        let d = self.delim_stack.len();
        if self.ts_angle_stack.is_empty()
            && let Some(top) = self.decl_stack.last_mut()
            && top.d == d
            && top.in_ret_type
        {
            top.expecting_type_brace = false;
        }
        if self.type_decl_stage == 3
            && self.ts_angle_stack.is_empty()
            && d == self.type_decl_depth
        {
            self.type_rhs_continues = false;
        }
    }

    pub(crate) fn on_open_delim(&mut self) {
        self.regex_allowed = true;
        self.after_dot = false;
        self.expr_pos = true;
        self.after_stmt_header = false;
        self.pending_header = PendingHeader::None;
        self.after_export = false;
        self.after_export_default = false;
        self.after_declare = false;
        self.at_line_start = false;
        self.prev_was_lparen = false;
        self.after_lparen_nl = false;
        self.just_closed_paren_nl_decl = false;
        self.asi_kw_pending = 0;
        let d = self.delim_stack.len();
        if let Some(top) = self.decl_stack.last_mut()
            && top.d == d
        {
            top.expecting_type_brace = false;
        }
        self.type_rhs_continues = false;
    }

    pub(crate) fn step_masked(
        &mut self,
        lang: LanguageId,
        b: &[u8],
        m_idx: &mut usize,
        masked: &[(usize, usize)],
        i: &mut usize,
    ) -> bool {
        while *m_idx < masked.len() && masked[*m_idx].1 <= *i {
            *m_idx += 1;
        }
        if self.quote.is_none() && *m_idx < masked.len() && *i >= masked[*m_idx].0 && *i < masked[*m_idx].1 {
            let (s, e) = masked[*m_idx];
            if is_js_like(lang) && !(b[s..e].starts_with(b"//") || b[s..e].starts_with(b"/*")) {
                self.before_token(lang, b, s);
                self.after_value();
            }
            *i = e;
            return true;
        }
        false
    }
}
