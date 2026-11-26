use crate::dep_callers_js_lex::JsRegexCtx;
use crate::dep_callers_js_scan::scan_ident_end;
use crate::dep_callers_tsx_lex::{JsxFrame, TagPunctOutcome};

pub(crate) fn step_jsx_open_tag_slash(
    b: &[u8],
    i: usize,
    ctx: &mut JsRegexCtx,
    imp: &mut String,
    code: &mut String,
) -> usize {
    if matches!(
        ctx.tsx.stack.last(),
        Some(JsxFrame::OpenTag { type_arg_depth: 0, .. })
    ) && b.get(i + 1) == Some(&b'>')
    {
        ctx.tsx.stack.pop();
        imp.push_str("/>");
        code.push_str("/>");
        if ctx.tsx.in_jsx_text() {
            ctx.on_regex_allowed();
        } else {
            ctx.on_expr_end();
        }
        return i + 2;
    }
    imp.push('/');
    code.push('/');
    ctx.on_regex_allowed();
    i + 1
}

pub(crate) fn step_jsx_text(
    raw: &str,
    b: &[u8],
    i: usize,
    ctx: &mut JsRegexCtx,
    tpl_stack: &mut [usize],
    imp: &mut String,
    code: &mut String,
) -> usize {
    if b[i] == b'{' {
        ctx.tsx.stack.push(JsxFrame::Expr { brace_depth: 1 });
        if let Some(d) = tpl_stack.last_mut() {
            *d += 1;
        }
        imp.push('{');
        code.push('{');
        ctx.on_regex_allowed();
        return i + 1;
    }
    if b[i] == b'<' && b.get(i + 1) == Some(&b'/') {
        ctx.tsx.stack.push(JsxFrame::CloseTag);
        imp.push_str("</");
        code.push_str("</");
        ctx.on_expr_end();
        return i + 2;
    }
    if let Some(next_i) = ctx.tsx.try_open_from_js(raw, b, i) {
        imp.push_str(&raw[i..next_i]);
        code.push_str(&raw[i..next_i]);
        ctx.on_regex_allowed();
        return next_i;
    }
    let ch = raw[i..].chars().next().unwrap();
    for _ in 0..ch.len_utf8() {
        imp.push(' ');
        code.push(' ');
    }
    i + ch.len_utf8()
}

pub(crate) fn step_jsx_tag_token(
    raw: &str,
    b: &[u8],
    i: usize,
    ctx: &mut JsRegexCtx,
    imp: &mut String,
    code: &mut String,
) -> Option<usize> {
    let ch = raw[i..].chars().next().unwrap();
    if ch.is_whitespace() {
        imp.push(ch);
        code.push(ch);
        ctx.tsx.on_tag_ws();
        return Some(i + ch.len_utf8());
    }
    if b[i] == b'=' && b.get(i + 1) == Some(&b'>') {
        ctx.tsx.on_tag_arrow();
        imp.push_str("=>");
        code.push_str("=>");
        ctx.on_regex_allowed();
        return Some(i + 2);
    }
    if ch.is_alphabetic() || ch == '_' || ch == '$' {
        let end = scan_ident_end(raw, i);
        let ident = &raw[i..end];
        imp.push_str(ident);
        code.push_str(ident);
        ctx.tsx.on_tag_ident(ident);
        if ctx.tsx.in_jsx_tag() {
            ctx.on_expr_end();
        } else {
            ctx.on_ident(ident);
        }
        return Some(end);
    }
    if b[i] == b'{' && ctx.tsx.on_lbrace() {
        imp.push('{');
        code.push('{');
        ctx.on_regex_allowed();
        return Some(i + 1);
    }
    match ctx.tsx.step_tag_punct(b[i]) {
        TagPunctOutcome::HandledRegexAllowed => {
            imp.push(ch);
            code.push(ch);
            ctx.on_regex_allowed();
            Some(i + ch.len_utf8())
        }
        TagPunctOutcome::HandledExprEnd => {
            imp.push(ch);
            code.push(ch);
            ctx.on_expr_end();
            Some(i + ch.len_utf8())
        }
        TagPunctOutcome::Fallthrough => None,
    }
}
