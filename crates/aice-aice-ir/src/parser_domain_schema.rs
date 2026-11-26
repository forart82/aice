use crate::ir::{AiceItem, TranspileError, Trivia};
use crate::ir_domain_db::{DbColumn, DbSchemaDecl, GraphQlField, PrismaField};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_domain_db::parse_dialect_str;

pub(crate) fn parse_table(p: &mut Parser<'_>, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let if_not_exists = p.peek().lexeme == "if_not_exists" && { p.advance(); true };
    let name = p.expect(TokenKind::String, "Expected table name")?.lexeme;
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    let (mut columns, mut constraints, mut options) = (Vec::new(), Vec::new(), Vec::new());
    p.skip_newlines();
    if p.eat(TokenKind::Indent) {
        while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
            let mut ctr = p.collect_leading_trivia();
            if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
            let row_kw = p.expect_ident_or_kw("Expected col/constraint/option")?.lexeme;
            match row_kw.as_str() {
                "constraint" => { p.expect(TokenKind::Colon, "Expected ':'")?; constraints.push(p.advance().lexeme); }
                "option" => { p.expect(TokenKind::Colon, "Expected ':'")?; options.push(p.advance().lexeme); }
                _ => {
                    let cname = p.expect(TokenKind::String, "Expected col name")?.lexeme;
                    p.expect(TokenKind::Colon, "Expected ':'")?;
                    let sql_type = p.expect(TokenKind::String, "Expected sql type")?.lexeme;
                    let (mut col_c, mut default) = (Vec::new(), None);
                    while p.eat(TokenKind::Pipe) {
                        if p.eat(TokenKind::Equal) { default = Some(p.advance().lexeme); }
                        else { col_c.push(p.advance().lexeme); }
                    }
                    if ctr.trailing.is_none() { ctr.trailing = p.take_trailing_comment(); }
                    columns.push(DbColumn { name: cname, sql_type, constraints: col_c, default, trivia: ctr });
                }
            }
            let _ = p.take_trailing_comment();
            p.eat_stmt_end();
        }
        p.eat(TokenKind::Dedent);
    }
    Ok(AiceItem::DbSchema(DbSchemaDecl::Table { name, if_not_exists, columns, constraints, options, trivia: tr }))
}

pub(crate) fn parse_proc(p: &mut Parser<'_>, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let dialect = parse_dialect_str(&p.expect(TokenKind::String, "Expected dialect")?.lexeme);
    let is_fn = p.eat(TokenKind::Fn);
    let name = p.expect(TokenKind::String, "Expected proc name")?.lexeme;
    let mut params = Vec::new();
    if p.eat(TokenKind::LParen) {
        while p.peek_kind() != TokenKind::RParen && !p.at_eof() {
            params.push(p.advance().lexeme);
            if !p.eat(TokenKind::Comma) { break; }
        }
        p.expect(TokenKind::RParen, "Expected ')'")?;
    }
    let returns = if p.eat(TokenKind::Arrow) { Some(p.advance().lexeme) } else { None };
    let lang_tag = if p.eat(TokenKind::LBracket) {
        let lt = p.advance().lexeme;
        p.expect(TokenKind::RBracket, "Expected ']'")?;
        Some(lt)
    } else { None };
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    let (mut declares, mut body_lines) = (Vec::new(), Vec::new());
    p.skip_newlines();
    if p.eat(TokenKind::Indent) {
        while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
            let _ = p.collect_leading_trivia();
            if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
            let sec = p.expect_ident_or_kw("Expected declare/body")?.lexeme;
            p.expect(TokenKind::Colon, "Expected ':'")?;
            let line = p.advance().lexeme;
            let _ = p.take_trailing_comment();
            if sec == "declare" { declares.push(line); } else { body_lines.push(line); }
            p.eat_stmt_end();
        }
        p.eat(TokenKind::Dedent);
    }
    Ok(AiceItem::DbSchema(DbSchemaDecl::Procedure { dialect, is_fn, name, params, returns, lang_tag, declares, body_lines, trivia: tr }))
}

pub(crate) fn parse_trig(p: &mut Parser<'_>, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let name = p.expect(TokenKind::String, "Expected trig name")?.lexeme;
    let timing = p.expect(TokenKind::String, "Expected timing")?.lexeme;
    let events_raw = p.expect(TokenKind::String, "Expected events")?.lexeme;
    let events = events_raw.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    let table = p.expect(TokenKind::String, "Expected table")?.lexeme;
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    let (mut for_each, mut body_lines) = (None, Vec::new());
    p.skip_newlines();
    if p.eat(TokenKind::Indent) {
        while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
            let _ = p.collect_leading_trivia();
            if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
            let k = p.expect_ident_or_kw("Expected for_each/body")?.lexeme;
            p.expect(TokenKind::Colon, "Expected ':'")?;
            let v = p.advance().lexeme;
            let _ = p.take_trailing_comment();
            if k == "for_each" { for_each = Some(v); } else { body_lines.push(v); }
            p.eat_stmt_end();
        }
        p.eat(TokenKind::Dedent);
    }
    Ok(AiceItem::DbSchema(DbSchemaDecl::Trigger { name, timing, events, table, for_each, body_lines, trivia: tr }))
}

pub(crate) fn parse_dbtype(p: &mut Parser<'_>, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let is_enum = p.eat(TokenKind::Enum);
    let name = p.expect(TokenKind::String, "Expected type name")?.lexeme;
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    let mut members = Vec::new();
    p.skip_newlines();
    if p.eat(TokenKind::Indent) {
        while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
            let _ = p.collect_leading_trivia();
            if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
            members.push(p.advance().lexeme);
            let _ = p.take_trailing_comment();
            p.eat_stmt_end();
        }
        p.eat(TokenKind::Dedent);
    }
    Ok(AiceItem::DbSchema(DbSchemaDecl::TypeDef { name, is_enum, members, trivia: tr }))
}

pub(crate) fn parse_prisma(p: &mut Parser<'_>, kw: &str, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let kind = if kw == "prisma_enum" { "enum".to_string() } else { kw.to_string() };
    let name = p.expect(TokenKind::String, "Expected prisma block name")?.lexeme;
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    let (mut fields, mut attrs) = (Vec::new(), Vec::new());
    p.skip_newlines();
    if p.eat(TokenKind::Indent) {
        while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
            let mut ftr = p.collect_leading_trivia();
            if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
            if p.peek().lexeme == "attr" {
                p.advance(); p.expect(TokenKind::Colon, "Expected ':'")?;
                attrs.push(p.advance().lexeme);
            } else {
                if p.peek().lexeme == "field" { p.advance(); }
                let fname = p.expect(TokenKind::String, "Expected field name")?.lexeme;
                p.expect(TokenKind::Colon, "Expected ':'")?;
                let field_type = p.advance().lexeme;
                let mut fattrs = Vec::new();
                while p.eat(TokenKind::Pipe) { fattrs.push(p.advance().lexeme); }
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
    let kind = p.expect(TokenKind::String, "Expected gql kind")?.lexeme;
    let name = p.expect(TokenKind::String, "Expected gql name")?.lexeme;
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    let (mut implements, mut directives, mut fields) = (Vec::new(), Vec::new(), Vec::new());
    p.skip_newlines();
    if p.eat(TokenKind::Indent) {
        while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
            let ftr = p.collect_leading_trivia();
            if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
            match p.peek().lexeme.as_str() {
                "implements" => {
                    p.advance(); p.expect(TokenKind::Colon, "Expected ':'")?;
                    while matches!(p.peek_kind(), TokenKind::String | TokenKind::Ident) {
                        implements.push(p.advance().lexeme);
                        if !p.eat(TokenKind::Comma) { break; }
                    }
                    let _ = p.take_trailing_comment();
                }
                "directive" => {
                    p.advance(); p.expect(TokenKind::Colon, "Expected ':'")?;
                    directives.push(p.advance().lexeme);
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
    name: String,
    args: Vec<String>,
    field_type: String,
    directives: Vec<String>,
    children: Vec<GraphQlField>,
    tr: Trivia,
    has_indent: bool,
}

fn start_gql_field(p: &mut Parser<'_>, trivia: Trivia) -> Result<GqlFieldFrame, TranspileError> {
    if p.peek().lexeme == "field" { p.advance(); }
    let name = p.expect(TokenKind::String, "Expected gql field")?.lexeme;
    let mut args = Vec::new();
    if p.eat(TokenKind::LParen) {
        while p.peek_kind() != TokenKind::RParen && !p.at_eof() {
            args.push(p.advance().lexeme);
            if !p.eat(TokenKind::Comma) { break; }
        }
        p.expect(TokenKind::RParen, "Expected ')'")?;
    }
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let field_type = p.advance().lexeme;
    let mut directives = Vec::new();
    while p.eat(TokenKind::Pipe) { directives.push(p.advance().lexeme); }
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
