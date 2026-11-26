use crate::ir::{AiceItem, Span, TranspileError, Trivia, Visibility};
use crate::ir_domain::{ComponentDecl, StyleDecl, StyleProp, TokenSheetDecl};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_decl::parse_param_list;
use crate::parser_domain_layout::parse_layout_nodes;
use crate::parser_stmt::{attach_stmt_trivia, parse_stmt};
use crate::parser_types::parse_type_params;

pub(crate) fn parse_component(p: &mut Parser<'_>, vis: Visibility, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let sp = p.peek().span;
    p.expect(TokenKind::Component, "Expected 'component'")?;
    let name = p.expect_ident_or_kw("Expected component name")?.lexeme;
    let is_doctype_tok = p.peek_kind() == TokenKind::LBracket
        && p.peek_n(1).lexeme == "doctype"
        && p.peek_n(2).kind == TokenKind::RBracket;
    let type_params = if p.peek_kind() == TokenKind::LBracket && !is_doctype_tok {
        parse_type_params(p)?
    } else {
        Vec::new()
    };
    let params = if p.eat(TokenKind::LParen) { parse_param_list(p)? } else { Vec::new() };
    let has_doctype = if p.eat(TokenKind::LBracket) {
        let kw = p.expect_ident_or_kw("Expected flag")?.lexeme;
        p.expect(TokenKind::RBracket, "Expected ']'")?;
        kw == "doctype"
    } else { false };
    let mut tr = trivia;
    let mut body_stmts = Vec::new();
    let mut layout = Vec::new();
    if p.eat(TokenKind::Colon) {
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        p.skip_newlines();
        if p.eat(TokenKind::Indent) {
            if has_component_ret_block(p) {
                while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
                    let st_tr = p.collect_leading_trivia();
                    if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
                    if p.peek_kind() == TokenKind::Ret && p.peek_n(1).kind == TokenKind::Colon {
                        p.advance();
                        p.advance();
                        let _ = p.take_trailing_comment();
                        p.skip_newlines();
                        if p.eat(TokenKind::Indent) {
                            layout = parse_layout_nodes(p)?;
                            p.eat(TokenKind::Dedent);
                        }
                        p.eat_stmt_end();
                        break;
                    }
                    let mut st = parse_stmt(p)?;
                    attach_stmt_trivia(&mut st, st_tr, p.take_trailing_comment());
                    body_stmts.push(st);
                    p.eat_stmt_end();
                }
                p.eat(TokenKind::Dedent);
            } else {
                layout = parse_layout_nodes(p)?;
                p.eat(TokenKind::Dedent);
            }
        }
    }
    Ok(AiceItem::Component(ComponentDecl {
        vis, name, type_params, params, has_doctype, body_stmts, layout, trivia: tr, span: sp,
    }))
}

fn has_component_ret_block(p: &Parser<'_>) -> bool {
    let mut idx = p.pos;
    let mut depth = 0isize;
    while idx < p.tokens.len() {
        match p.tokens[idx].kind {
            TokenKind::Indent => depth += 1,
            TokenKind::Dedent => {
                if depth == 0 { return false; }
                depth -= 1;
            }
            TokenKind::Ret if depth == 0 && p.tokens.get(idx + 1).is_some_and(|t| t.kind == TokenKind::Colon) => {
                return true;
            }
            TokenKind::Eof => return false,
            _ => {}
        }
        idx += 1;
    }
    false
}

pub(crate) fn parse_style(p: &mut Parser<'_>, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    Ok(AiceItem::Style(parse_style_decl(p, trivia)?))
}

struct StyleFrame {
    selector: String,
    props: Vec<StyleProp>,
    children: Vec<StyleDecl>,
    tr: Trivia,
    sp: Span,
    has_indent: bool,
}

fn parse_style_header(p: &mut Parser<'_>, trivia: Trivia) -> Result<StyleFrame, TranspileError> {
    let sp = p.peek().span;
    p.expect(TokenKind::Style, "Expected 'style'")?;
    let selector = if p.peek_kind() == TokenKind::String { p.advance().lexeme } else { p.line_rest_raw_until_colon() };
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    p.skip_newlines();
    let has_indent = p.eat(TokenKind::Indent);
    Ok(StyleFrame { selector, props: Vec::new(), children: Vec::new(), tr, sp, has_indent })
}

fn parse_style_decl(p: &mut Parser<'_>, trivia: Trivia) -> Result<StyleDecl, TranspileError> {
    let mut stack = vec![parse_style_header(p, trivia)?];
    loop {
        let has_indent = stack.last().map(|f| f.has_indent).unwrap_or(false);
        if !has_indent || p.at_eof() || p.peek_kind() == TokenKind::Dedent {
            let cur = stack.pop().unwrap();
            if cur.has_indent { p.eat(TokenKind::Dedent); }
            let decl = StyleDecl {
                selector: cur.selector, props: cur.props, children: cur.children, trivia: cur.tr, span: cur.sp,
            };
            if let Some(parent) = stack.last_mut() {
                parent.children.push(decl);
                p.eat_stmt_end();
                continue;
            }
            return Ok(decl);
        }
        let mut ptr = p.collect_leading_trivia();
        if p.peek_kind() == TokenKind::Dedent || p.at_eof() { continue; }
        if p.peek_kind() == TokenKind::Style {
            stack.push(parse_style_header(p, ptr)?);
            continue;
        }
        let name = if p.peek_kind() == TokenKind::String { p.advance().lexeme } else { p.line_rest_raw_until_colon() };
        let value = if p.eat(TokenKind::Colon) {
            if matches!(p.peek_kind(), TokenKind::String | TokenKind::TripleString)
                && matches!(p.peek_n(1).kind, TokenKind::Newline | TokenKind::Dedent | TokenKind::Eof | TokenKind::Comment | TokenKind::Semicolon)
            {
                Some(p.advance().lexeme)
            } else {
                Some(p.line_rest_raw())
            }
        } else { None };
        if ptr.trailing.is_none() { ptr.trailing = p.take_trailing_comment(); }
        if let Some(cur) = stack.last_mut() {
            cur.props.push(StyleProp { name, value, trivia: ptr });
        }
        p.eat_stmt_end();
    }
}

pub(crate) fn parse_tokens(p: &mut Parser<'_>, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let sp = p.peek().span;
    p.expect(TokenKind::Tokens, "Expected 'tokens'")?;
    let namespace = p.expect_ident_or_kw("Expected tokens namespace")?.lexeme;
    let unit = if p.eat(TokenKind::LBracket) {
        let u = p.expect_ident_or_kw("Expected unit")?.lexeme;
        p.expect(TokenKind::RBracket, "Expected ']'")?;
        Some(u)
    } else { None };
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    let mut entries = Vec::new();
    if p.peek_kind() == TokenKind::Newline {
        p.skip_newlines();
        if p.eat(TokenKind::Indent) {
            while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
                let _ = p.collect_leading_trivia();
                if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
                let k = p.line_rest_raw_until_colon();
                p.expect(TokenKind::Colon, "Expected ':'")?;
                entries.push((k, p.line_rest_raw()));
                let _ = p.take_trailing_comment();
                p.eat_stmt_end();
            }
            p.eat(TokenKind::Dedent);
        }
    } else {
        loop {
            let k = p.expect_ident_or_kw("Expected token key")?.lexeme;
            p.expect(TokenKind::Colon, "Expected ':'")?;
            entries.push((k, p.advance().lexeme));
            if !p.eat(TokenKind::Comma) { break; }
        }
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    }
    Ok(AiceItem::TokenSheet(TokenSheetDecl { namespace, unit, entries, trivia: tr, span: sp }))
}
