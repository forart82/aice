use crate::dep_callers_js_scan::{scan_ident_end, scan_js_number_end, scan_js_regex_len};
use crate::dep_callers_tsx_lex::JsxLexState;
use crate::dep_callers_tsx_step::{step_jsx_open_tag_slash, step_jsx_tag_token};

#[derive(Clone, Copy, PartialEq, Eq)]
enum CondKw {
    None,
    Cond,
    For,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ParenKind {
    Normal,
    Cond,
    For,
}

pub(crate) struct JsRegexCtx {
    pub(crate) regex_allowed: bool,
    after_dot: bool,
    prev_was_rbrace: bool,
    had_newline: bool,
    prev_cond_kw: CondKw,
    paren_stack: Vec<ParenKind>,
    pub(crate) tsx: JsxLexState,
}

impl JsRegexCtx {
    pub(crate) fn new() -> Self {
        Self {
            regex_allowed: true,
            after_dot: false,
            prev_was_rbrace: false,
            had_newline: false,
            prev_cond_kw: CondKw::None,
            paren_stack: Vec::new(),
            tsx: JsxLexState::new(),
        }
    }

    pub(crate) fn on_newline(&mut self) {
        self.had_newline = true;
        self.tsx.on_newline();
    }

    pub(crate) fn on_regex_allowed(&mut self) {
        self.regex_allowed = true;
        self.after_dot = false;
        self.prev_was_rbrace = false;
        self.had_newline = false;
        self.prev_cond_kw = CondKw::None;
    }

    pub(crate) fn on_expr_end(&mut self) {
        self.regex_allowed = false;
        self.after_dot = false;
        self.prev_was_rbrace = false;
        self.had_newline = false;
        self.prev_cond_kw = CondKw::None;
    }

    pub(crate) fn on_rbrace(&mut self) {
        self.on_regex_allowed();
        self.prev_was_rbrace = true;
    }

    fn on_dot(&mut self) {
        self.on_expr_end();
        self.after_dot = true;
    }

    fn on_lparen(&mut self) {
        let kind = match self.prev_cond_kw {
            CondKw::None => ParenKind::Normal,
            CondKw::Cond => ParenKind::Cond,
            CondKw::For => ParenKind::For,
        };
        self.paren_stack.push(kind);
        self.on_regex_allowed();
    }

    fn on_rparen(&mut self) {
        match self.paren_stack.pop() {
            Some(ParenKind::Cond | ParenKind::For) => self.on_regex_allowed(),
            _ => self.on_expr_end(),
        }
    }

    fn in_for_paren(&self) -> bool {
        matches!(self.paren_stack.last(), Some(ParenKind::For))
    }

    pub(crate) fn on_ident(&mut self, ident: &str) {
        if self.after_dot {
            self.on_expr_end();
        } else if ident == "for" {
            self.on_expr_end();
            self.prev_cond_kw = CondKw::For;
        } else if matches!(ident, "if" | "while" | "with") {
            self.on_expr_end();
            self.prev_cond_kw = CondKw::Cond;
        } else if ident == "await" {
            let was_for = self.prev_cond_kw == CondKw::For;
            self.on_regex_allowed();
            if was_for {
                self.prev_cond_kw = CondKw::For;
            }
        } else if (ident == "of"
            && (!self.regex_allowed || self.prev_was_rbrace)
            && self.in_for_paren())
            || matches!(
                ident,
                "return" | "throw" | "case" | "delete" | "void" | "typeof"
                    | "yield" | "in" | "instanceof" | "new" | "else" | "do" | "default"
            )
        {
            self.on_regex_allowed();
        } else {
            self.on_expr_end();
        }
    }
}

pub(crate) fn try_consume_js_slash(
    raw: &str,
    b: &[u8],
    i: usize,
    is_tsx: bool,
    ctx: &mut JsRegexCtx,
    imp: &mut String,
    code: &mut String,
) -> usize {
    if is_tsx && ctx.tsx.in_jsx_open_tag() {
        return step_jsx_open_tag_slash(b, i, ctx, imp, code);
    }
    if ctx.regex_allowed && let Some(len) = scan_js_regex_len(raw, b, i) {
        imp.push_str("/0/");
        code.push_str("/0/");
        for _ in 0..len.saturating_sub(3) {
            imp.push(' ');
            code.push(' ');
        }
        ctx.on_expr_end();
        return i + len;
    }
    if !ctx.regex_allowed && b.get(i + 1) == Some(&b'=') {
        imp.push_str("/=");
        code.push_str("/=");
        ctx.on_regex_allowed();
        return i + 2;
    }
    imp.push('/');
    code.push('/');
    ctx.on_regex_allowed();
    i + 1
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn step_js_code_token(
    raw: &str,
    b: &[u8],
    i: usize,
    is_tsx: bool,
    ctx: &mut JsRegexCtx,
    imp: &mut String,
    code: &mut String,
) -> usize {
    if is_tsx
        && ctx.tsx.in_jsx_tag()
        && let Some(next_i) = step_jsx_tag_token(raw, b, i, ctx, imp, code)
    {
        return next_i;
    }
    if b[i] == b'=' && b.get(i + 1) == Some(&b'>') {
        imp.push_str("=>");
        code.push_str("=>");
        ctx.on_regex_allowed();
        return i + 2;
    }
    if is_tsx
        && ctx.regex_allowed
        && let Some(next_i) = ctx.tsx.try_open_from_js(raw, b, i)
    {
        imp.push_str(&raw[i..next_i]);
        code.push_str(&raw[i..next_i]);
        ctx.on_regex_allowed();
        return next_i;
    }
    if is_tsx && b[i] == b'<' && b.get(i + 1) == Some(&b'/') {
        imp.push_str("</");
        code.push_str("</");
        ctx.on_expr_end();
        return i + 2;
    }
    let ch = raw[i..].chars().next().unwrap();
    if ch.is_whitespace() {
        imp.push(ch);
        code.push(ch);
        return i + ch.len_utf8();
    }
    if (b[i] == b'+' && b.get(i + 1) == Some(&b'+'))
        || (b[i] == b'-' && b.get(i + 1) == Some(&b'-'))
    {
        imp.push_str(&raw[i..i + 2]);
        code.push_str(&raw[i..i + 2]);
        ctx.on_expr_end();
        return i + 2;
    }
    if b[i] == b'!' {
        if b.get(i + 1) == Some(&b'=') {
            imp.push_str("!=");
            code.push_str("!=");
            ctx.on_regex_allowed();
            return i + 2;
        }
        imp.push('!');
        code.push('!');
        if !ctx.regex_allowed && !ctx.had_newline { ctx.on_expr_end(); } else { ctx.on_regex_allowed(); }
        return i + 1;
    }
    if b[i] == b'.' && b.get(i + 1..i + 3) == Some(b"..") {
        imp.push_str("...");
        code.push_str("...");
        ctx.on_regex_allowed();
        return i + 3;
    }
    if b[i] == b'?' && b.get(i + 1) == Some(&b'.') && !b.get(i + 2).is_some_and(u8::is_ascii_digit) {
        imp.push_str("?.");
        code.push_str("?.");
        ctx.on_dot();
        return i + 2;
    }
    if b[i] == b'.' && !b.get(i + 1).is_some_and(u8::is_ascii_digit) {
        imp.push('.');
        code.push('.');
        ctx.on_dot();
        return i + 1;
    }
    if b[i].is_ascii_digit() || (b[i] == b'.' && b.get(i + 1).is_some_and(u8::is_ascii_digit)) {
        let j = scan_js_number_end(raw, b, i);
        imp.push_str(&raw[i..j]);
        code.push_str(&raw[i..j]);
        ctx.on_expr_end();
        return j;
    }
    if ch.is_alphabetic() || ch == '_' || ch == '$' {
        let end = scan_ident_end(raw, i);
        let ident = &raw[i..end];
        imp.push_str(ident);
        code.push_str(ident);
        ctx.on_ident(ident);
        return end;
    }
    imp.push(ch);
    code.push(ch);
    match b[i] {
        b'(' => ctx.on_lparen(),
        b')' => ctx.on_rparen(),
        b'{' => {
            if is_tsx {
                ctx.tsx.on_lbrace();
            }
            ctx.on_regex_allowed();
        }
        b'[' => ctx.on_regex_allowed(),
        b'}' => {
            if is_tsx {
                ctx.tsx.on_rbrace();
            }
            ctx.on_rbrace();
        }
        b']' => ctx.on_expr_end(),
        _ => ctx.on_regex_allowed(),
    }
    i + ch.len_utf8()
}
