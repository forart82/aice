use crate::ir::{AiceItem, TranspileError, Trivia};
use crate::ir_domain_db::{DbColumn, DbSchemaDecl};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_domain_db::parse_dialect_str;
pub(crate) use crate::parser_domain_gql::{parse_gql, parse_prisma};

pub(crate) fn parse_db_atom(p: &mut Parser<'_>, msg: &str) -> Result<String, TranspileError> {
    if p.peek_kind() == TokenKind::String {
        return Ok(p.advance().lexeme);
    }
    if p.peek_kind() == TokenKind::LBracket {
        let start = p.advance().span.start_byte;
        let mut end = start;
        while !p.at_eof() && p.peek_kind() != TokenKind::RBracket {
            end = p.advance().span.end_byte;
        }
        if p.peek_kind() == TokenKind::RBracket { end = p.advance().span.end_byte; }
        return Ok(p.src[start..end].to_string());
    }
    let first = p.expect_ident_or_kw(msg)?;
    let start = first.span.start_byte;
    let mut end = first.span.end_byte;
    while p.eat(TokenKind::Dot) {
        let seg = p.expect_ident_or_kw(msg)?;
        end = seg.span.end_byte;
    }
    Ok(p.src[start..end].to_string())
}

fn split_sql_type_and_constraint(raw: &str) -> (String, Option<String>) {
    let b = raw.as_bytes();
    let (mut depth, mut i, mut quote) = (0usize, 0usize, None::<u8>);
    while i < b.len() {
        let c = b[i];
        if let Some(q) = quote {
            if c == b'\\' && i + 1 < b.len() { i += 2; continue; }
            if c == q {
                if b.get(i + 1) == Some(&q) { i += 2; continue; }
                quote = None;
            }
            i += 1;
            continue;
        }
        match c {
            b'\'' | b'"' | b'`' => quote = Some(c),
            b'(' => depth += 1,
            b')' => depth = depth.saturating_sub(1),
            x if x.is_ascii_whitespace() && depth == 0 && !raw[i..].trim_start().starts_with('(') => {
                let ty = raw[..i].trim().to_string();
                let rest = raw[i..].trim();
                return (ty, if rest.is_empty() { None } else { Some(rest.to_string()) });
            }
            _ => {}
        }
        i += 1;
    }
    (raw.to_string(), None)
}

pub(crate) fn parse_db_segment(p: &mut Parser<'_>) -> String {
    if p.peek_kind() == TokenKind::String
        && matches!(p.peek_n(1).kind, TokenKind::Pipe | TokenKind::Newline | TokenKind::Dedent | TokenKind::Eof | TokenKind::Comment | TokenKind::Semicolon)
    {
        return p.advance().lexeme;
    }
    let (mut s, mut e) = (None, 0usize);
    while !matches!(p.peek_kind(), TokenKind::Pipe | TokenKind::Newline | TokenKind::Dedent | TokenKind::Eof | TokenKind::Comment | TokenKind::Semicolon) {
        let tok = p.advance();
        if tok.span.end_byte > tok.span.start_byte {
            if s.is_none() { s = Some(tok.span.start_byte); }
            e = tok.span.end_byte;
        }
    }
    s.map(|st| p.src[st..e].trim().to_string()).unwrap_or_default()
}

pub(crate) fn parse_paren_items(p: &mut Parser<'_>) -> Result<Vec<String>, TranspileError> {
    let mut out = Vec::new();
    while p.peek_kind() != TokenKind::RParen && !p.at_eof() {
        if p.peek_kind() == TokenKind::String && matches!(p.peek_n(1).kind, TokenKind::Comma | TokenKind::RParen) {
            out.push(p.advance().lexeme);
        } else {
            let (mut s, mut e, mut depth) = (None, 0usize, 0usize);
            while !p.at_eof() {
                let k = p.peek_kind();
                if depth == 0 && matches!(k, TokenKind::Comma | TokenKind::RParen) { break; }
                if matches!(k, TokenKind::LParen | TokenKind::LBracket | TokenKind::LBrace) { depth += 1; }
                else if matches!(k, TokenKind::RParen | TokenKind::RBracket | TokenKind::RBrace) { depth = depth.saturating_sub(1); }
                let tok = p.advance();
                if tok.span.end_byte > tok.span.start_byte {
                    if s.is_none() { s = Some(tok.span.start_byte); }
                    e = tok.span.end_byte;
                }
            }
            if let Some(st) = s { out.push(p.src[st..e].trim().to_string()); }
        }
        if !p.eat(TokenKind::Comma) { break; }
    }
    p.expect(TokenKind::RParen, "Expected ')'")?;
    Ok(out)
}

pub(crate) fn parse_table(p: &mut Parser<'_>, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let if_not_exists = p.peek().lexeme == "if_not_exists" && { p.advance(); true };
    let name = parse_db_atom(p, "Expected table name")?;
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    let (mut columns, mut constraints, mut options) = (Vec::new(), Vec::new(), Vec::new());
    p.skip_newlines();
    if p.eat(TokenKind::Indent) {
        while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
            let mut ctr = p.collect_leading_trivia();
            if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
            if p.peek_kind() == TokenKind::Ident && p.peek_n(1).kind == TokenKind::RawLine {
                let tag = p.advance().lexeme;
                let val = p.advance().lexeme;
                if tag == "con" { constraints.push(val); } else { options.push(val); }
            } else if p.peek().lexeme == "constraint" && p.peek_n(1).kind == TokenKind::Colon {
                p.advance(); p.advance();
                constraints.push(parse_db_segment(p));
            } else if p.peek().lexeme == "option" && p.peek_n(1).kind == TokenKind::Colon {
                p.advance(); p.advance();
                options.push(parse_db_segment(p));
            } else {
                if p.peek().lexeme == "col" && p.peek_n(1).kind != TokenKind::Colon { p.advance(); }
                let cname = parse_db_atom(p, "Expected col name")?;
                let _ = p.eat(TokenKind::Colon);
                let was_quoted = p.peek_kind() == TokenKind::String
                    && matches!(p.peek_n(1).kind, TokenKind::Pipe | TokenKind::Newline | TokenKind::Dedent | TokenKind::Eof | TokenKind::Comment | TokenKind::Semicolon);
                let raw_type = parse_db_segment(p);
                let (mut col_c, mut default) = (Vec::new(), None);
                let sql_type = if !was_quoted {
                    let (t, tail) = split_sql_type_and_constraint(&raw_type);
                    if let Some(c) = tail { col_c.push(c); }
                    t
                } else {
                    raw_type
                };
                while p.eat(TokenKind::Pipe) {
                    if p.eat(TokenKind::Equal) { default = Some(parse_db_segment(p)); }
                    else { col_c.push(parse_db_segment(p)); }
                }
                if ctr.trailing.is_none() { ctr.trailing = p.take_trailing_comment(); }
                columns.push(DbColumn { name: cname, sql_type, constraints: col_c, default, trivia: ctr });
            }
            let _ = p.take_trailing_comment();
            p.eat_stmt_end();
        }
        p.eat(TokenKind::Dedent);
    }
    Ok(AiceItem::DbSchema(DbSchemaDecl::Table { name, if_not_exists, columns, constraints, options, trivia: tr }))
}

pub(crate) fn parse_proc(p: &mut Parser<'_>, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let dialect = parse_dialect_str(&parse_db_atom(p, "Expected dialect")?);
    let is_fn = p.eat(TokenKind::Fn);
    let name = parse_db_atom(p, "Expected proc name")?;
    let params = if p.eat(TokenKind::LParen) { parse_paren_items(p)? } else { Vec::new() };
    let returns = if p.eat(TokenKind::Arrow) {
        if p.peek_kind() == TokenKind::String { Some(p.advance().lexeme) }
        else {
            let (mut s, mut e) = (None, 0usize);
            while !matches!(p.peek_kind(), TokenKind::LBracket | TokenKind::Colon | TokenKind::Newline | TokenKind::Eof) {
                let tok = p.advance();
                if tok.span.end_byte > tok.span.start_byte {
                    if s.is_none() { s = Some(tok.span.start_byte); }
                    e = tok.span.end_byte;
                }
            }
            s.map(|st| p.src[st..e].trim().to_string())
        }
    } else { None };
    let lang_tag = if p.eat(TokenKind::LBracket) {
        let lt = parse_db_atom(p, "Expected lang tag")?;
        p.expect(TokenKind::RBracket, "Expected ']'")?;
        Some(lt)
    } else { None };
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let mut tr = trivia;
    if matches!(p.peek_kind(), TokenKind::TripleString | TokenKind::RawLine) {
        let body = p.advance().lexeme;
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        return Ok(AiceItem::DbSchema(DbSchemaDecl::Procedure {
            dialect, is_fn, name, params, returns, lang_tag, declares: Vec::new(), body_lines: vec![body], trivia: tr,
        }));
    }
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    let (mut declares, mut body_lines) = (Vec::new(), Vec::new());
    p.skip_newlines();
    if p.eat(TokenKind::Indent) {
        while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
            let _ = p.collect_leading_trivia();
            if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
            if p.peek_kind() == TokenKind::RawLine {
                body_lines.push(p.advance().lexeme);
            } else if p.peek().lexeme == "dec" && p.peek_n(1).kind == TokenKind::RawLine {
                p.advance(); declares.push(p.advance().lexeme);
            } else {
                let sec = p.expect_ident_or_kw("Expected declare/body")?.lexeme;
                p.expect(TokenKind::Colon, "Expected ':'")?;
                let line = p.advance().lexeme;
                if sec == "declare" { declares.push(line); } else { body_lines.push(line); }
            }
            let _ = p.take_trailing_comment();
            p.eat_stmt_end();
        }
        p.eat(TokenKind::Dedent);
    }
    Ok(AiceItem::DbSchema(DbSchemaDecl::Procedure { dialect, is_fn, name, params, returns, lang_tag, declares, body_lines, trivia: tr }))
}

pub(crate) fn parse_trig(p: &mut Parser<'_>, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let name = parse_db_atom(p, "Expected trig name")?;
    let timing = parse_db_atom(p, "Expected timing")?;
    let events_raw = parse_db_atom(p, "Expected events")?;
    let events = events_raw.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    let table = parse_db_atom(p, "Expected table")?;
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    let (mut for_each, mut body_lines) = (None, Vec::new());
    p.skip_newlines();
    if p.eat(TokenKind::Indent) {
        while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
            let _ = p.collect_leading_trivia();
            if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
            if p.peek_kind() == TokenKind::RawLine {
                body_lines.push(p.advance().lexeme);
            } else {
                let k = p.expect_ident_or_kw("Expected for_each/body")?.lexeme;
                p.expect(TokenKind::Colon, "Expected ':'")?;
                let v = parse_db_segment(p);
                if k == "for_each" { for_each = Some(v); } else { body_lines.push(v); }
            }
            let _ = p.take_trailing_comment();
            p.eat_stmt_end();
        }
        p.eat(TokenKind::Dedent);
    }
    Ok(AiceItem::DbSchema(DbSchemaDecl::Trigger { name, timing, events, table, for_each, body_lines, trivia: tr }))
}

pub(crate) fn parse_dbtype(p: &mut Parser<'_>, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let is_enum = p.eat(TokenKind::Enum);
    let name = parse_db_atom(p, "Expected type name")?;
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    let mut members = Vec::new();
    p.skip_newlines();
    if p.eat(TokenKind::Indent) {
        while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
            let _ = p.collect_leading_trivia();
            if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
            members.push(parse_db_segment(p));
            let _ = p.take_trailing_comment();
            p.eat_stmt_end();
        }
        p.eat(TokenKind::Dedent);
    }
    Ok(AiceItem::DbSchema(DbSchemaDecl::TypeDef { name, is_enum, members, trivia: tr }))
}
