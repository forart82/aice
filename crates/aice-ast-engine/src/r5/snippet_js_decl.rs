use aice_lang_registry::LanguageId;

use crate::r5::snippet_lit::match_js_regex_body;
use crate::r5::snippet_ml_lit::{match_ml_literal_end, step_quote};

use super::snippet_js_lex::{JsLexState, ScopeKind, StepQuote, TmplFrame, is_js_like};
#[derive(Debug, Clone, Copy)]
pub(super) struct DeclFrame {
    pub(super) d: usize,
    pub(super) is_expr: bool,
    pub(super) is_interface: bool,
    pub(super) is_declare: bool,
    pub(super) from_paren_nl_named: bool,
    pub(super) saw_fn_paren: bool,
    pub(super) in_ret_type: bool,
    pub(super) expecting_type_brace: bool,
    pub(super) pending_asi_ret: bool,
    pub(super) pending_asi_fn_paren: bool,
    pub(super) has_decl_name: bool,
    pub(super) in_heritage: bool,
    pub(super) pending_asi_head: bool,
}

impl JsLexState {
    pub(super) fn before_token(&mut self, lang: LanguageId, b: &[u8], i: usize) {
        if !is_js_like(lang) || b[i..].starts_with(b"//") || b[i..].starts_with(b"/*") {
            return;
        }
        let ch = b[i];
        if let Some(top) = self.decl_stack.last_mut()
            && top.d == self.delim_stack.len()
            && top.pending_asi_head
        {
            let is_kw = |kw: &[u8]| {
                b[i..].starts_with(kw)
                    && !b
                        .get(i + kw.len())
                        .is_some_and(|&c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$') || c >= 0x80)
            };
            let is_ident_cont = (ch.is_ascii_alphabetic() || matches!(ch, b'_' | b'$') || ch >= 0x80)
                && (!top.has_decl_name || top.in_heritage);
            if matches!(ch, b'*' | b'<' | b'(' | b'{')
                || is_kw(b"extends")
                || is_kw(b"implements")
                || is_ident_cont
            {
                top.pending_asi_head = false;
            } else {
                self.decl_stack.pop();
                self.regex_allowed = true;
            }
        }
        if !matches!(lang, LanguageId::TypeScript | LanguageId::Tsx) {
            return;
        }
        if self.type_rhs_asi_pending
            && (self.delim_stack.len() != self.type_rhs_asi_depth || !matches!(ch, b'|' | b'&'))
        {
            self.type_rhs_asi_pending = false;
        }
        if let Some(top) = self.decl_stack.last_mut()
            && top.d == self.delim_stack.len()
        {
            if top.pending_asi_ret {
                if matches!(ch, b'{' | b'|' | b'&') {
                    top.pending_asi_ret = false;
                } else {
                    self.decl_stack.pop();
                    self.regex_allowed = true;
                }
            } else if top.pending_asi_fn_paren {
                if matches!(ch, b'{' | b':') {
                    top.pending_asi_fn_paren = false;
                } else {
                    self.decl_stack.pop();
                    self.regex_allowed = true;
                }
            }
        }
    }

    pub(super) fn step_lbrace(&mut self) {
        if let Some(top) = self.tmpl_stack.last_mut() {
            top.brace_depth += 1;
        }
        let d = self.delim_stack.len();
        let at_decl = self.decl_stack.last().is_some_and(|f| f.d == d);
        let in_type_brace = (!self.ts_angle_stack.is_empty() && (at_decl || self.type_decl_stage >= 2))
            || self
                .decl_stack
                .last()
                .is_some_and(|f| f.d == d && f.in_ret_type && f.expecting_type_brace);
        let scope = if in_type_brace {
            ScopeKind::ExprBrace
        } else if at_decl {
            let frame = self.decl_stack.pop().unwrap();
            if frame.from_paren_nl_named {
                ScopeKind::ParenNlDeclBrace
            } else if frame.is_expr {
                ScopeKind::ExprBlockBrace
            } else {
                ScopeKind::BlockBrace
            }
        } else if (self.type_decl_stage == 3
            && self.ts_angle_stack.is_empty()
            && d == self.type_decl_depth)
            || self.after_stmt_header
            || !self.expr_pos
        {
            ScopeKind::BlockBrace
        } else {
            ScopeKind::ExprBrace
        };
        self.delim_stack.push(scope);
        self.after_value();
        self.regex_allowed = true;
        self.expr_pos = scope == ScopeKind::ExprBrace;
    }

    pub(super) fn step_rbrace(&mut self) {
        if let Some(top) = self.tmpl_stack.last_mut() {
            top.brace_depth -= 1;
            if top.brace_depth == 0 {
                let frame = self.tmpl_stack.pop().unwrap();
                self.pop_scope(|k| k == ScopeKind::TmplInterp);
                self.quote = Some((b'`', frame.start));
                return;
            }
        }
        let popped = self.pop_scope(|k| {
            matches!(
                k,
                ScopeKind::BlockBrace
                    | ScopeKind::ExprBrace
                    | ScopeKind::ExprBlockBrace
                    | ScopeKind::ParenNlDeclBrace
            )
        });
        self.after_value();
        if popped == Some(ScopeKind::BlockBrace) {
            self.regex_allowed = true;
        } else if popped == Some(ScopeKind::ParenNlDeclBrace) {
            self.just_closed_paren_nl_decl = true;
            self.saw_paren_nl_decl = true;
        }
    }

    pub(super) fn pop_scope(&mut self, pred: impl Fn(ScopeKind) -> bool) -> Option<ScopeKind> {
        let pos = self.delim_stack.iter().rposition(|&k| pred(k))?;
        let found = self.delim_stack[pos];
        self.delim_stack.truncate(pos);
        let is_paren_pop = matches!(
            found,
            ScopeKind::NormalParen | ScopeKind::StmtHeaderParen | ScopeKind::ForHeaderParen
        );
        while let Some(&(idx, lp_pos)) = self.lparen_pos_stack.last()
            && idx >= self.delim_stack.len()
        {
            self.lparen_pos_stack.pop();
            if !(is_paren_pop && idx == self.delim_stack.len()) {
                self.discarded_unclosed_parens.push(lp_pos);
            }
        }
        while self.ternary_scopes.last().is_some_and(|&d| d > self.delim_stack.len()) {
            self.ternary_scopes.pop();
        }
        while self.decl_stack.last().is_some_and(|f| f.d > self.delim_stack.len()) {
            self.decl_stack.pop();
        }
        while self.ts_angle_stack.last().is_some_and(|&d| d > self.delim_stack.len()) {
            self.ts_angle_stack.pop();
        }
        if self.type_decl_stage != 0 && self.delim_stack.len() < self.type_decl_depth {
            self.type_decl_stage = 0;
            self.type_rhs_continues = false;
            self.type_rhs_asi_pending = false;
        }
        if self.type_rhs_asi_pending && self.delim_stack.len() < self.type_rhs_asi_depth {
            self.type_rhs_asi_pending = false;
        }
        Some(found)
    }
    pub(crate) fn step_quote(&mut self, lang: LanguageId, b: &[u8], i: &mut usize) -> StepQuote {
        let Some((q, start)) = self.quote else {
            return StepQuote::NotInQuote;
        };
        if is_js_like(lang) && q == b'`' {
            if b[*i] == b'\\' {
                if *i + 1 >= b.len() {
                    *i += 1;
                } else {
                    *i += if b[*i + 1] == b'\r' && b.get(*i + 2) == Some(&b'\n') { 3 } else { 2 };
                    while *i < b.len() && (b[*i] & 0xC0) == 0x80 {
                        *i += 1;
                    }
                }
                return StepQuote::Consumed;
            }
            if b[*i..].starts_with(b"${") {
                self.tmpl_stack.push(TmplFrame { start, brace_depth: 1 });
                self.delim_stack.push(ScopeKind::TmplInterp);
                self.quote = None;
                self.on_open_delim();
                *i += 2;
                return StepQuote::EnteredInterp;
            }
            if b[*i] == b'`' {
                self.quote = None;
                self.after_value();
            }
            *i += 1;
            return StepQuote::Consumed;
        }
        let mut q_opt = Some(q);
        step_quote(lang, b, i, &mut q_opt);
        if q_opt.is_none() {
            self.quote = None;
            self.after_value();
        }
        StepQuote::Consumed
    }

    pub(crate) fn match_special(&mut self, lang: LanguageId, b: &[u8], i: usize) -> Option<(usize, bool)> {
        if is_js_like(lang)
            && !b[i].is_ascii_whitespace()
            && !b[i..].starts_with(b"//")
            && !b[i..].starts_with(b"/*")
        {
            self.before_token(lang, b, i);
        }
        let res = if is_js_like(lang) {
            if self.regex_allowed {
                match_js_regex_body(b, i, &mut self.no_rbrack_until).map(|e| (e, true))
            } else if self.just_closed_paren_nl_decl && b[i] == b'/' {
                let mut nr = self.no_rbrack_until;
                let matched = match_js_regex_body(b, i, &mut nr);
                if matched.is_none() {
                    self.no_rbrack_until = nr;
                }
                matched
                    .filter(|&end| Self::paren_nl_regex_ok(b, i, end))
                    .map(|e| (e, true))
            } else {
                None
            }
        } else {
            match_ml_literal_end(lang, b, i)
        }?;
        debug_assert!(res.0 > i && res.0 <= b.len());
        self.after_value();
        Some(res)
    }

    pub(crate) fn step_byte(&mut self, lang: LanguageId, b: &[u8], i: &mut usize) {
        if !is_js_like(lang) {
            *i += 1;
            return;
        }
        let ch = b[*i];
        if ch.is_ascii_whitespace() {
            *i += 1;
            return;
        }
        self.before_token(lang, b, *i);
        if ch.is_ascii_alphabetic() || matches!(ch, b'_' | b'$' | b'#') || ch >= 0x80 {
            self.step_js_ident(lang, b, i);
        } else if ch.is_ascii_digit() {
            while *i < b.len() && (b[*i].is_ascii_alphanumeric() || matches!(b[*i], b'_' | b'$')) {
                *i += 1;
            }
            self.after_value();
        } else {
            self.step_js_punct(lang, b, i);
        }
    }
}
