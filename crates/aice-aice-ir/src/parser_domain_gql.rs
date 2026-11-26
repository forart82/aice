use crate::ir::{AiceItem, TranspileError, Trivia};
use crate::ir_domain_db::{DbSchemaDecl, GraphQlField, PrismaField};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_domain_schema::{parse_db_atom, parse_db_segment, parse_paren_items};

fn split_prisma_type_and_attrs(raw: &str) -> (String, Vec<String>) {
    let b = raw.as_bytes();
    let (mut depth, mut in_q, mut cut) = (0usize, None::<u8>, None::<usize>);
    for (i, &c) in b.iter().enumerate() {
        if let Some(q) = in_q { if c == q { in_q = None; } continue; }
        if c == b'"' || c == b'\'' { in_q = Some(c); }
        else if matches!(c, b'(' | b'[' | b'{') { depth += 1; }
        else if matches!(c, b')' | b']' | b'}') { depth = depth.saturating_sub(1); }
        else if c == b'@' && depth == 0 && i > 0 && b[i - 1].is_ascii_whitespace() {
            cut = Some(i);
            break;
        }
    }
    let Some(pos) = cut else { return (raw.trim().to_string(), Vec::new()); };
    let ty = raw[..pos].trim().to_string();
    let tail = &raw[pos..];
    let mut attrs = Vec::new();
    let (mut start, mut d, mut q) = (0usize, 0usize, None::<u8>);
    for (i, &c) in tail.as_bytes().iter().enumerate() {
        if let Some(qc) = q { if c == qc { q = None; } continue; }
        if c == b'"' || c == b'\'' { q = Some(c); }
        else if matches!(c, b'(' | b'[' | b'{') { d += 1; }
        else if matches!(c, b')' | b']' | b'}') { d = d.saturating_sub(1); }
        else if c == b'@' && d == 0 && i > start && tail.as_bytes()[i - 1].is_ascii_whitespace() {
            attrs.push(tail[start..i].trim().to_string());
            start = i;
        }
    }
    if start < tail.len() { attrs.push(tail[start..].trim().to_string()); }
    (ty, attrs)
}

pub(crate) fn parse_prisma(p: &mut Parser<'_>, kw: &str, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let kind = if kw == "prisma_enum" { "enum".to_string() } else { kw.to_string() };
    let name = parse_db_atom(p, "Expected prisma block name")?;
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    let (mut fields, mut attrs) = (Vec::new(), Vec::new());
    p.skip_newlines();
    if p.eat(TokenKind::Indent) {
        while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
            let mut ftr = p.collect_leading_trivia();
            if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
            if p.peek().lexeme == "con" && p.peek_n(1).kind == TokenKind::RawLine {
                p.advance(); attrs.push(p.advance().lexeme);
            } else if p.peek().lexeme == "attr" && p.peek_n(1).kind == TokenKind::Colon {
                p.advance(); p.advance(); attrs.push(parse_db_segment(p));
            } else {
                let is_legacy = p.peek().lexeme == "field" && p.peek_n(1).kind != TokenKind::Colon;
                if is_legacy { p.advance(); }
                let fname = parse_db_atom(p, "Expected field name")?;
                let is_ds = kind == "datasource" || kind == "generator";
                let (field_type, mut fattrs) = if p.eat(TokenKind::Colon) {
                    if is_legacy && p.peek_kind() == TokenKind::String && matches!(p.peek_n(1).kind, TokenKind::Pipe | TokenKind::Newline | TokenKind::Dedent | TokenKind::Eof | TokenKind::Comment) {
                        (p.advance().lexeme, Vec::new())
                    } else if is_ds {
                        (p.line_rest_raw(), Vec::new())
                    } else {
                        split_prisma_type_and_attrs(&parse_db_segment(p))
                    }
                } else if !matches!(p.peek_kind(), TokenKind::Newline | TokenKind::Dedent | TokenKind::Eof | TokenKind::Comment | TokenKind::Pipe) {
                    split_prisma_type_and_attrs(&parse_db_segment(p))
                } else { (String::new(), Vec::new()) };
                while p.eat(TokenKind::Pipe) { fattrs.push(parse_db_segment(p)); }
                if ftr.trailing.is_none() { ftr.trailing = p.take_trailing_comment(); }
                fields.push(PrismaField { name: fname, field_type, attrs: fattrs, trivia: ftr });
            }
            let _ = p.take_trailing_comment();
            p.eat_stmt_end();
        }
        p.eat(TokenKind::Dedent);
    }
    Ok(AiceItem::DbSchema(DbSchemaDecl::PrismaBlock { kind, name, fields, attrs, trivia: tr }))
}

pub(crate) fn parse_gql(p: &mut Parser<'_>, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let kind = parse_db_atom(p, "Expected gql kind")?;
    let name = parse_db_atom(p, "Expected gql name")?;
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let mut tr = trivia;
    let (mut implements, mut directives, mut fields) = (Vec::new(), Vec::new(), Vec::new());
    if !matches!(p.peek_kind(), TokenKind::Newline | TokenKind::Comment | TokenKind::Dedent | TokenKind::Eof) {
        while !matches!(p.peek_kind(), TokenKind::Newline | TokenKind::Comment | TokenKind::Dedent | TokenKind::Eof) {
            let fname = parse_db_atom(p, "Expected gql field")?;
            let fty = if p.eat(TokenKind::Colon) {
                let (mut s, mut e) = (None, 0usize);
                while !matches!(p.peek_kind(), TokenKind::Comma | TokenKind::Newline | TokenKind::Comment | TokenKind::Dedent | TokenKind::Eof) {
                    let t = p.advance();
                    if t.span.end_byte > t.span.start_byte {
                        if s.is_none() { s = Some(t.span.start_byte); }
                        e = t.span.end_byte;
                    }
                }
                s.map(|st| p.src[st..e].trim().to_string()).unwrap_or_default()
            } else { String::new() };
            fields.push(GraphQlField { name: fname, args: Vec::new(), field_type: fty, directives: Vec::new(), children: Vec::new(), trivia: Trivia::default() });
            if !p.eat(TokenKind::Comma) { break; }
        }
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        return Ok(AiceItem::DbSchema(DbSchemaDecl::GraphQlType { kind, name, implements, directives, fields, trivia: tr }));
    }
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    p.skip_newlines();
    if p.eat(TokenKind::Indent) {
        while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
            let ftr = p.collect_leading_trivia();
            if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
            match p.peek().lexeme.as_str() {
                "implements" if p.peek_n(1).kind == TokenKind::Colon => {
                    p.advance(); p.advance();
                    while matches!(p.peek_kind(), TokenKind::String | TokenKind::Ident) {
                        implements.push(p.advance().lexeme);
                        if !p.eat(TokenKind::Comma) { break; }
                    }
                    let _ = p.take_trailing_comment();
                }
                "directive" if p.peek_n(1).kind == TokenKind::Colon => {
                    p.advance(); p.advance();
                    directives.push(parse_db_segment(p));
                    let _ = p.take_trailing_comment();
                }
                _ => fields.push(parse_gql_field(p, ftr)?),
            }
            p.eat_stmt_end();
        }
        p.eat(TokenKind::Dedent);
    }
    Ok(AiceItem::DbSchema(DbSchemaDecl::GraphQlType { kind, name, implements, directives, fields, trivia: tr }))
}

struct GqlFieldFrame {
    name: String, args: Vec<String>, field_type: String, directives: Vec<String>,
    children: Vec<GraphQlField>, tr: Trivia, has_indent: bool,
}

fn start_gql_field(p: &mut Parser<'_>, trivia: Trivia) -> Result<GqlFieldFrame, TranspileError> {
    if p.peek().lexeme == "field" && !matches!(p.peek_n(1).kind, TokenKind::Colon | TokenKind::LParen | TokenKind::Newline | TokenKind::Comment | TokenKind::Dedent | TokenKind::Eof) {
        p.advance();
    }
    let name = parse_db_atom(p, "Expected gql field")?;
    let args = if p.eat(TokenKind::LParen) { parse_paren_items(p)? } else { Vec::new() };
    let field_type = if p.eat(TokenKind::Colon) { parse_db_segment(p) } else { String::new() };
    let mut directives = Vec::new();
    while p.eat(TokenKind::Pipe) { directives.push(parse_db_segment(p)); }
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    let mut has_indent = false;
    if p.peek_kind() == TokenKind::Newline {
        let saved = p.pos;
        p.skip_newlines();
        if p.eat(TokenKind::Indent) { has_indent = true; } else { p.pos = saved; }
    }
    Ok(GqlFieldFrame { name, args, field_type, directives, children: Vec::new(), tr, has_indent })
}

fn parse_gql_field(p: &mut Parser<'_>, trivia: Trivia) -> Result<GraphQlField, TranspileError> {
    let mut stack = vec![start_gql_field(p, trivia)?];
    loop {
        let has_indent = stack.last().map(|f| f.has_indent).unwrap_or(false);
        if !has_indent || p.at_eof() || p.peek_kind() == TokenKind::Dedent {
            let cur = stack.pop().unwrap();
            if cur.has_indent { p.eat(TokenKind::Dedent); }
            let gf = GraphQlField {
                name: cur.name, args: cur.args, field_type: cur.field_type,
                directives: cur.directives, children: cur.children, trivia: cur.tr,
            };
            if let Some(parent) = stack.last_mut() {
                parent.children.push(gf);
                p.eat_stmt_end();
                continue;
            }
            return Ok(gf);
        }
        let ctr = p.collect_leading_trivia();
        if p.peek_kind() == TokenKind::Dedent || p.at_eof() { continue; }
        stack.push(start_gql_field(p, ctr)?);
    }
}
