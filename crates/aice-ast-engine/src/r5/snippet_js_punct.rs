use aice_lang_registry::LanguageId;

use super::snippet_js_lex::{JsLexState, PendingHeader, ScopeKind};

impl JsLexState {
    pub(super) fn step_js_punct(&mut self, lang: LanguageId, b: &[u8], i: &mut usize) {
        let ch = b[*i];
        let d = self.delim_stack.len();
        if self.type_decl_stage == 1 {
            self.type_decl_stage = 0;
        }
        if self.type_decl_stage == 2
            && self.ts_angle_stack.is_empty()
            && d == self.type_decl_depth
            && !matches!(ch, b'<' | b'=')
        {
            self.type_decl_stage = 0;
        }
        if matches!(ch, b'|' | b'&')
            && matches!(lang, LanguageId::TypeScript | LanguageId::Tsx)
            && self.type_rhs_asi_pending
            && d == self.type_rhs_asi_depth
        {
            self.type_decl_stage = 3;
            self.type_decl_depth = self.type_rhs_asi_depth;
            self.type_rhs_continues = true;
            self.type_rhs_asi_pending = false;
        }
        let cont_ret = self.ts_angle_stack.is_empty()
            && self.decl_stack.last().is_some_and(|f| f.d == d && f.in_ret_type);
        let at_type_rhs = self.type_decl_stage == 3
            && self.ts_angle_stack.is_empty()
            && d == self.type_decl_depth;
        if b[*i..].starts_with(b"...") || b[*i..].starts_with(b"??") {
            *i += if b[*i] == b'.' { 3 } else { 2 };
            self.on_open_delim();
        } else if b[*i..].starts_with(b"=>") {
            *i += 2;
            self.after_value();
            self.regex_allowed = true;
            self.after_stmt_header = true;
            self.expr_pos = true;
            if cont_ret {
                self.decl_stack.last_mut().unwrap().expecting_type_brace = true;
            }
            if at_type_rhs {
                self.type_rhs_continues = true;
            }
        } else if ch == b'.'
            || (ch == b'?' && b.get(*i + 1) == Some(&b'.') && !b.get(*i + 2).is_some_and(u8::is_ascii_digit))
        {
            *i += if ch == b'?' { 2 } else { 1 };
            self.after_value();
            self.after_dot = true;
        } else if b[*i..].starts_with(b"++") || b[*i..].starts_with(b"--") {
            *i += 2;
        } else if ch == b'(' {
            let kind = match self.pending_header {
                PendingHeader::Stmt => ScopeKind::StmtHeaderParen,
                PendingHeader::For => ScopeKind::ForHeaderParen,
                PendingHeader::None => ScopeKind::NormalParen,
            };
            self.lparen_pos_stack.push((d, *i));
            self.delim_stack.push(kind);
            self.on_open_delim();
            self.prev_was_lparen = true;
            *i += 1;
        } else if ch == b')' {
            let popped = self.pop_scope(|k| {
                matches!(k, ScopeKind::NormalParen | ScopeKind::StmtHeaderParen | ScopeKind::ForHeaderParen)
            });
            let new_d = self.delim_stack.len();
            self.after_value();
            if matches!(popped, Some(ScopeKind::StmtHeaderParen | ScopeKind::ForHeaderParen)) {
                self.regex_allowed = true;
                self.after_stmt_header = true;
            }
            if let Some(top) = self.decl_stack.last_mut()
                && top.d == new_d
                && !top.in_ret_type
                && !top.is_interface
            {
                top.saw_fn_paren = true;
            }
            *i += 1;
        } else if ch == b'[' {
            self.delim_stack.push(ScopeKind::Bracket);
            self.on_open_delim();
            *i += 1;
        } else if ch == b']' {
            self.pop_scope(|k| k == ScopeKind::Bracket);
            self.after_value();
            *i += 1;
        } else if ch == b'{' || ch == b'}' {
            if ch == b'{' { self.step_lbrace(); } else { self.step_rbrace(); }
            *i += 1;
        } else if ch == b';' {
            self.after_value();
            self.regex_allowed = true;
            while self.decl_stack.last().is_some_and(|f| f.d >= d) {
                self.decl_stack.pop();
            }
            while self.ts_angle_stack.last().is_some_and(|&ad| ad >= d) {
                self.ts_angle_stack.pop();
            }
            if self.type_decl_stage != 0 && d <= self.type_decl_depth && self.ts_angle_stack.is_empty() {
                self.type_decl_stage = 0;
                self.type_rhs_continues = false;
                self.type_rhs_asi_pending = false;
            }
            self.ternary_scopes.retain(|&td| td < d);
            *i += 1;
        } else if ch == b'?' {
            if self.ts_angle_stack.is_empty()
                && self
                    .decl_stack
                    .last()
                    .is_some_and(|f| f.d == d && !f.saw_fn_paren && !f.in_ret_type)
            {
                self.decl_stack.pop();
            }
            self.ternary_scopes.push(d);
            self.on_open_delim();
            if cont_ret {
                self.decl_stack.last_mut().unwrap().expecting_type_brace = true;
            }
            if at_type_rhs {
                self.type_rhs_continues = true;
            }
            *i += 1;
        } else if ch == b':' {
            let enter_ret = matches!(lang, LanguageId::TypeScript | LanguageId::Tsx)
                && self.ts_angle_stack.is_empty()
                && self.decl_stack.last().is_some_and(|f| f.d == d && f.saw_fn_paren);
            if enter_ret {
                self.on_open_delim();
                self.expr_pos = false;
                let top = self.decl_stack.last_mut().unwrap();
                top.saw_fn_paren = false;
                top.in_ret_type = true;
                top.expecting_type_brace = true;
            } else {
                if self.ts_angle_stack.is_empty()
                    && self
                        .decl_stack
                        .last()
                        .is_some_and(|f| f.d == d && !f.saw_fn_paren && !f.in_ret_type)
                {
                    self.decl_stack.pop();
                }
                let is_expr_colon = if self.ternary_scopes.last() == Some(&d) {
                    self.ternary_scopes.pop();
                    true
                } else {
                    self.delim_stack.last() == Some(&ScopeKind::ExprBrace)
                };
                self.on_open_delim();
                self.expr_pos = is_expr_colon;
                if cont_ret {
                    self.decl_stack.last_mut().unwrap().expecting_type_brace = true;
                }
                if at_type_rhs {
                    self.type_rhs_continues = true;
                }
            }
            *i += 1;
        } else if ch == b'<' {
            let in_ts_angle = matches!(lang, LanguageId::TypeScript | LanguageId::Tsx)
                && (self.ts_angle_stack.last() == Some(&d)
                    || (self.type_decl_stage == 2 && d == self.type_decl_depth)
                    || self.decl_stack.last().is_some_and(|f| {
                        f.d == d && (!f.saw_fn_paren || f.in_ret_type)
                    }));
            if in_ts_angle {
                self.ts_angle_stack.push(d);
            }
            self.on_open_delim();
            *i += 1;
        } else if ch == b'>' {
            if self.ts_angle_stack.last() == Some(&d) {
                self.ts_angle_stack.pop();
                let was_ret = self.decl_stack.last().is_some_and(|f| f.d == d && f.in_ret_type);
                self.after_value();
                if self.ts_angle_stack.is_empty()
                    && was_ret
                    && let Some(top) = self.decl_stack.last_mut()
                {
                    top.expecting_type_brace = false;
                }
            } else {
                self.on_open_delim();
            }
            *i += 1;
        } else if ch == b'=' {
            if self.ts_angle_stack.is_empty()
                && self
                    .decl_stack
                    .last()
                    .is_some_and(|f| f.d == d && !f.saw_fn_paren && !f.in_ret_type)
            {
                self.decl_stack.pop();
            }
            let start_type_rhs = self.type_decl_stage == 2
                && self.ts_angle_stack.is_empty()
                && d == self.type_decl_depth;
            self.on_open_delim();
            if start_type_rhs {
                self.type_decl_stage = 3;
                self.type_rhs_continues = true;
            }
            *i += 1;
        } else if matches!(ch, b'|' | b'&') {
            self.on_open_delim();
            if cont_ret {
                self.decl_stack.last_mut().unwrap().expecting_type_brace = true;
            }
            if at_type_rhs {
                self.type_rhs_continues = true;
            }
            *i += 1;
        } else if matches!(ch, b',' | b'!' | b'^' | b'~' | b'+' | b'-' | b'*' | b'/' | b'%') {
            self.on_open_delim();
            *i += 1;
        } else {
            self.after_value();
            *i += 1;
        }
    }

    pub(super) fn paren_nl_regex_ok(b: &[u8], i: usize, end: usize) -> bool {
        let has_blk = b[i..end].windows(2).any(|w| w == b"/*");
        if b.get(end) == Some(&b'*') && !has_blk {
            return false;
        }
        let (mut k, mut saw_nl) = (end, false);
        while k < b.len() {
            if matches!(b[k], b' ' | b'\t') {
                k += 1;
            } else if matches!(b[k], b'\n' | b'\r') {
                saw_nl = true;
                k += 1;
            } else if b[k..].starts_with(b"//") {
                k += 2;
                while k < b.len() && !matches!(b[k], b'\n' | b'\r') {
                    k += 1;
                }
            } else if b[k..].starts_with(b"/*") {
                let (Some(after), _) =
                    crate::r5::snippet_blk::find_blk_comment_close(LanguageId::JavaScript, b, k + 2, 1)
                else {
                    return true;
                };
                if b[k + 2..after - 2].iter().any(|&c| matches!(c, b'\n' | b'\r')) {
                    saw_nl = true;
                }
                k = after;
            } else {
                break;
            }
        }
        match b.get(k).copied() {
            None => true,
            Some(b'/') => has_blk,
            Some(
                b'.' | b';' | b',' | b')' | b']' | b'}' | b'+' | b'-' | b'*' | b'%'
                | b'=' | b'!' | b'<' | b'>' | b'&' | b'|' | b'^' | b'?' | b':',
            ) => true,
            Some(b'{') => saw_nl,
            Some(c) if saw_nl && (c.is_ascii_alphabetic() || c == b'_' || c == b'$') => {
                let mut e = k + 1;
                while e < b.len()
                    && (b[e].is_ascii_alphanumeric() || matches!(b[e], b'_' | b'$'))
                {
                    e += 1;
                }
                matches!(
                    &b[k..e],
                    b"const" | b"let" | b"var" | b"function" | b"class" | b"if" | b"for"
                        | b"while" | b"switch" | b"try" | b"return" | b"throw" | b"break"
                        | b"continue" | b"debugger" | b"export" | b"import" | b"with" | b"do"
                        | b"interface" | b"type" | b"enum" | b"async" | b"await" | b"yield"
                        | b"declare" | b"abstract" | b"public" | b"private" | b"protected"
                        | b"readonly" | b"static" | b"namespace" | b"module" | b"using"
                )
            }
            _ => false,
        }
    }
}
