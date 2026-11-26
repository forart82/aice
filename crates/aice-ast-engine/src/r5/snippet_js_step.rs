use std::rc::Rc;

use aice_lang_registry::LanguageId;

use super::snippet_js_decl::DeclFrame;
use super::snippet_js_lex::{JsLexState, PendingHeader, ScopeKind, StepQuote};

fn is_anon_decl(b: &[u8], mut j: usize, is_class: bool) -> bool {
    while j < b.len() && b[j].is_ascii_whitespace() {
        j += 1;
    }
    if !is_class {
        if b.get(j) == Some(&b'*') {
            j += 1;
            while j < b.len() && b[j].is_ascii_whitespace() {
                j += 1;
            }
        }
        return matches!(b.get(j), Some(b'(' | b'<'));
    }
    matches!(b.get(j), Some(b'{' | b'<'))
        || (b[j..].starts_with(b"extends")
            && !b.get(j + 7).is_some_and(|&c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$')))
}

fn compute_unclosed_parens(lang: LanguageId, b: &[u8]) -> Vec<usize> {
    let mut js = JsLexState::new();
    js.in_prepass = true;
    let mut i = 0usize;
    while i < b.len() {
        if b[i] == b'\n' {
            js.on_newline(lang);
            i += 1;
            continue;
        }
        if js.step_quote(lang, b, &mut i) != StepQuote::NotInQuote {
            continue;
        }
        if let Some((end, _)) = js.match_special(lang, b, i) {
            i = end;
            continue;
        }
        if js.open_quote(lang, b, &mut i) {
            continue;
        }
        if b[i..].starts_with(b"//") {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if b[i..].starts_with(b"/*") {
            let (Some(after), _) = crate::r5::snippet_blk::find_blk_comment_close(lang, b, i + 2, 1) else {
                break;
            };
            i = after;
            continue;
        }
        js.step_byte(lang, b, &mut i);
    }
    let mut unclosed = js.discarded_unclosed_parens;
    unclosed.extend(js.lparen_pos_stack.into_iter().map(|(_, p)| p));
    unclosed.sort_unstable();
    unclosed.dedup();
    unclosed
}
impl JsLexState {
    fn current_paren_is_closed(&mut self, lang: LanguageId, b: &[u8]) -> bool {
        if self.in_prepass {
            return false;
        }
        let Some(&(_, lp_pos)) = self.lparen_pos_stack.last() else {
            return false;
        };
        let unclosed = self
            .unclosed_parens
            .get_or_insert_with(|| Rc::new(compute_unclosed_parens(lang, b)));
        unclosed.binary_search(&lp_pos).is_err()
    }

    pub(super) fn step_js_ident(&mut self, lang: LanguageId, b: &[u8], i: &mut usize) {
        let start = *i;
        *i += 1;
        while *i < b.len() && (b[*i].is_ascii_alphanumeric() || matches!(b[*i], b'_' | b'$') || b[*i] >= 0x80) {
            *i += 1;
        }
        let prev_asi = self.asi_kw_pending;
        if self.after_dot {
            self.after_value();
            self.type_decl_stage = 0;
            return;
        }
        self.after_dot = false;
        if self.type_decl_stage == 1 {
            self.after_value();
            self.type_decl_stage = 2;
            return;
        }
        if self.type_decl_stage == 2 && self.ts_angle_stack.is_empty() {
            self.type_decl_stage = 0;
        }
        let d = self.delim_stack.len();
        let cont_ret = self.ts_angle_stack.is_empty()
            && self.decl_stack.last().is_some_and(|f| f.d == d && f.in_ret_type);
        let at_type_rhs = self.type_decl_stage == 3
            && self.ts_angle_stack.is_empty()
            && d == self.type_decl_depth;
        let in_class_heritage = self.ts_angle_stack.is_empty()
            && self.decl_stack.last().is_some_and(|f| f.d == d && !f.is_interface && !f.in_ret_type);
        match &b[start..*i] {
            b"if" | b"while" | b"with" | b"switch" | b"catch" => {
                self.after_value();
                self.pending_header = PendingHeader::Stmt;
            }
            b"for" => {
                self.after_value();
                self.pending_header = PendingHeader::For;
            }
            b"await" if self.pending_header == PendingHeader::For => {
                self.regex_allowed = false;
                self.expr_pos = false;
                self.after_stmt_header = false;
            }
            b"else" | b"do" | b"try" | b"finally" => {
                self.after_value();
                self.regex_allowed = true;
                self.after_stmt_header = true;
            }
            b"return" | b"throw" | b"case" | b"void" | b"delete" | b"in"
            | b"instanceof" | b"new" | b"yield" | b"await" => self.on_open_delim(),
            b"typeof" | b"is" | b"extends" | b"infer" | b"keyof" | b"readonly"
                if cont_ret || at_type_rhs =>
            {
                self.after_value();
                if cont_ret {
                    self.decl_stack.last_mut().unwrap().expecting_type_brace = true;
                }
                if at_type_rhs {
                    self.type_rhs_continues = true;
                }
            }
            b"extends" if in_class_heritage => {
                self.after_value();
                self.expr_pos = true;
                if let Some(top) = self.decl_stack.last_mut()
                    && top.d == d
                {
                    top.has_decl_name = true;
                    top.in_heritage = true;
                }
            }
            b"extends" | b"implements"
                if self.ts_angle_stack.is_empty()
                    && self.decl_stack.last().is_some_and(|f| f.d == d && !f.saw_fn_paren && !f.in_ret_type) =>
            {
                self.after_value();
                if let Some(top) = self.decl_stack.last_mut() {
                    top.has_decl_name = true;
                    top.in_heritage = true;
                }
            }
            b"typeof" => self.on_open_delim(),
            b"of" if self.delim_stack.last() == Some(&ScopeKind::ForHeaderParen) && !self.regex_allowed => {
                self.on_open_delim();
            }
            b"const" | b"let" | b"var" => {
                self.after_value();
                self.expr_pos = true;
            }
            b"export" => {
                self.after_value();
                self.after_export = true;
            }
            b"default" => {
                let was_exp = self.after_export;
                self.after_value();
                self.regex_allowed = true;
                self.expr_pos = was_exp;
                self.after_export_default = was_exp;
            }
            b"declare"
                if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx)
                    && (!self.expr_pos || self.after_export || self.after_lparen_nl) =>
            {
                let was_exp = self.after_export;
                self.after_value();
                self.after_export = was_exp;
                self.after_declare = true;
            }
            b"function" | b"class" => {
                let is_class = &b[start..*i] == b"class";
                let anon = is_anon_decl(b, *i, is_class);
                let is_paren_nl_named = self.after_lparen_nl && !anon;
                let closed_paren_expr = is_paren_nl_named && self.current_paren_is_closed(lang, b);
                let expr_ok = self.expr_pos && !self.after_export_default;
                let is_expr = expr_ok && (!self.after_lparen_nl || anon || closed_paren_expr);
                let from_paren_nl_named = is_paren_nl_named && !closed_paren_expr && expr_ok;
                let is_declare = self.after_declare;
                self.after_value();
                while self.decl_stack.last().is_some_and(|f| f.d >= d) {
                    self.decl_stack.pop();
                }
                self.decl_stack.push(DeclFrame {
                    d,
                    is_expr,
                    is_interface: false,
                    is_declare,
                    from_paren_nl_named,
                    saw_fn_paren: false,
                    in_ret_type: false,
                    expecting_type_brace: false,
                    pending_asi_ret: false,
                    pending_asi_fn_paren: false,
                    has_decl_name: false,
                    in_heritage: false,
                    pending_asi_head: false,
                });
            }
            b"interface"
                if prev_asi == 0
                    && matches!(lang, LanguageId::TypeScript | LanguageId::Tsx)
                    && !self.after_stmt_header
                    && (self.after_export
                        || self.after_export_default
                        || self.after_declare
                        || self.after_lparen_nl
                        || (!self.expr_pos && (self.regex_allowed || self.at_line_start))) =>
            {
                let is_declare = self.after_declare;
                self.after_value();
                while self.decl_stack.last().is_some_and(|f| f.d >= d) {
                    self.decl_stack.pop();
                }
                self.decl_stack.push(DeclFrame {
                    d,
                    is_expr: false,
                    is_interface: true,
                    is_declare,
                    from_paren_nl_named: false,
                    saw_fn_paren: false,
                    in_ret_type: false,
                    expecting_type_brace: false,
                    pending_asi_ret: false,
                    pending_asi_fn_paren: false,
                    has_decl_name: false,
                    in_heritage: false,
                    pending_asi_head: false,
                });
            }
            b"async" => {
                self.regex_allowed = false;
                self.after_stmt_header = false;
                self.pending_header = PendingHeader::None;
                self.after_export = false;
                self.after_declare = false;
                self.at_line_start = false;
                self.prev_was_lparen = false;
                self.asi_kw_pending = if prev_asi == 1 { 2 } else { 0 };
            }
            b"break" | b"continue" => {
                self.after_value();
                self.asi_kw_pending = 1;
            }
            b"debugger" => {
                self.after_value();
                self.asi_kw_pending = 2;
            }
            b"type"
                if prev_asi == 0
                    && matches!(lang, LanguageId::TypeScript | LanguageId::Tsx)
                    && !self.after_stmt_header
                    && (self.after_export
                        || self.after_declare
                        || self.after_lparen_nl
                        || (!self.expr_pos && (self.regex_allowed || self.at_line_start))) =>
            {
                self.after_value();
                self.type_decl_stage = 1;
                self.type_decl_depth = d;
            }
            _ => {
                self.after_value();
                if self.ts_angle_stack.is_empty()
                    && let Some(top) = self.decl_stack.last_mut()
                    && top.d == d
                    && !top.saw_fn_paren
                    && !top.in_ret_type
                {
                    top.has_decl_name = true;
                }
                if prev_asi == 1 {
                    self.asi_kw_pending = 2;
                }
            }
        }
    }
}