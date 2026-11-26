use aice_lang_registry::LanguageId;

use crate::ir::{AiceItem, TranspileError, Trivia};
use crate::ir_domain_db::{DbMigrationDecl, DbQueryDecl, DbQueryKind, DbSchemaDecl};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_domain_schema::{parse_dbtype, parse_gql, parse_prisma, parse_proc, parse_table, parse_trig};

pub(crate) fn parse_db_item(p: &mut Parser<'_>, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let kw = p.advance().lexeme;
    match kw.as_str() {
        "table" => parse_table(p, trivia),
        "view" => parse_view(p, trivia),
        "index" => parse_index(p, trivia),
        "proc" => parse_proc(p, trivia),
        "trig" => parse_trig(p, trivia),
        "dbtype" => parse_dbtype(p, trivia),
        "ddl" => {
            p.expect(TokenKind::Colon, "Expected ':'")?;
            let text = p.advance().lexeme;
            let mut tr = trivia;
            if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
            Ok(AiceItem::DbSchema(DbSchemaDecl::RawDdl { text, trivia: tr }))
        }
        "model" | "datasource" | "generator" | "prisma_enum" => parse_prisma(p, &kw, trivia),
        "gql" => parse_gql(p, trivia),
        "query" | "cypher" => parse_query(p, &kw, trivia),
        "migration" => parse_migration(p, trivia),
        _ => Err(TranspileError::at(format!("Unknown DB construct '{kw}'"), p.peek().span)),
    }
}

fn parse_view(p: &mut Parser<'_>, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let materialized = p.peek().lexeme == "materialized" && { p.advance(); true };
    let name = p.expect(TokenKind::String, "Expected view name")?.lexeme;
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let query_sql = p.advance().lexeme;
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    Ok(AiceItem::DbSchema(DbSchemaDecl::View { name, materialized, query_sql, trivia: tr }))
}

fn parse_index(p: &mut Parser<'_>, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let unique = p.peek().lexeme == "unique" && { p.advance(); true };
    let name = p.expect(TokenKind::String, "Expected index name")?.lexeme;
    p.expect_ident_or_kw("Expected 'on'")?;
    let table = p.expect(TokenKind::String, "Expected table name")?.lexeme;
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let mut cols = Vec::new();
    while matches!(p.peek_kind(), TokenKind::String | TokenKind::Ident) {
        cols.push(p.advance().lexeme);
        if !p.eat(TokenKind::Comma) { break; }
    }
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    Ok(AiceItem::DbSchema(DbSchemaDecl::Index { name, unique, table, cols, trivia: tr }))
}

fn parse_query(p: &mut Parser<'_>, kw: &str, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let (dialect, kind) = if kw == "cypher" {
        (LanguageId::Cypher, DbQueryKind::Cypher)
    } else {
        let d = parse_dialect_str(&p.expect(TokenKind::String, "Expected dialect")?.lexeme);
        let k = match p.expect(TokenKind::String, "Expected query kind")?.lexeme.as_str() {
            "insert" => DbQueryKind::Insert, "update" => DbQueryKind::Update,
            "delete" => DbQueryKind::Delete, "pragma" => DbQueryKind::Pragma,
            "do" => DbQueryKind::DoBlock, "exec" => DbQueryKind::Exec,
            "gql" => DbQueryKind::GraphQlOp, "cypher" => DbQueryKind::Cypher,
            _ => DbQueryKind::Select,
        };
        (d, k)
    };
    let name = if p.peek_kind() == TokenKind::String { Some(p.advance().lexeme) } else { None };
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    let (mut ctes, mut clauses) = (Vec::new(), Vec::new());
    p.skip_newlines();
    if p.eat(TokenKind::Indent) {
        while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
            let _ = p.collect_leading_trivia();
            if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
            let tag = p.expect_ident_or_kw("Expected with/clause")?.lexeme;
            let k = p.expect(TokenKind::String, "Expected clause key")?.lexeme;
            p.expect(TokenKind::Colon, "Expected ':'")?;
            let v = p.advance().lexeme;
            let _ = p.take_trailing_comment();
            if tag == "with" { ctes.push((k, v)); } else { clauses.push((k, v)); }
            p.eat_stmt_end();
        }
        p.eat(TokenKind::Dedent);
    }
    Ok(AiceItem::DbQuery(DbQueryDecl { dialect, kind, name, ctes, clauses, trivia: tr }))
}

struct MigFrame {
    tool: String,
    sections: Vec<(String, Vec<AiceItem>)>,
    tr: Trivia,
    has_indent: bool,
    cur_sec: Option<(String, Vec<AiceItem>, bool)>,
}

fn start_migration(p: &mut Parser<'_>, trivia: Trivia) -> Result<MigFrame, TranspileError> {
    let tool = p.expect(TokenKind::String, "Expected migration tool")?.lexeme;
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    p.skip_newlines();
    let has_indent = p.eat(TokenKind::Indent);
    Ok(MigFrame { tool, sections: Vec::new(), tr, has_indent, cur_sec: None })
}

fn parse_migration(p: &mut Parser<'_>, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let mut stack = vec![start_migration(p, trivia)?];
    loop {
        let in_sec = stack.last().map(|f| f.cur_sec.is_some()).unwrap_or(false);
        if in_sec {
            let sec_indent = stack.last().unwrap().cur_sec.as_ref().unwrap().2;
            if !sec_indent || p.at_eof() || p.peek_kind() == TokenKind::Dedent {
                if sec_indent { p.eat(TokenKind::Dedent); }
                let cur = stack.last_mut().unwrap();
                let (sname, items, _) = cur.cur_sec.take().unwrap();
                cur.sections.push((sname, items));
                p.eat_stmt_end();
                continue;
            }
            let itr = p.collect_leading_trivia();
            if p.peek_kind() == TokenKind::Dedent || p.at_eof() { continue; }
            if p.peek_kind() == TokenKind::Ident && p.peek().lexeme == "migration" {
                p.advance();
                stack.push(start_migration(p, itr)?);
                continue;
            }
            let item = p.parse_item(itr)?;
            stack.last_mut().unwrap().cur_sec.as_mut().unwrap().1.push(item);
            p.eat_stmt_end();
            continue;
        }
        let has_indent = stack.last().map(|f| f.has_indent).unwrap_or(false);
        if !has_indent || p.at_eof() || p.peek_kind() == TokenKind::Dedent {
            let cur = stack.pop().unwrap();
            if cur.has_indent { p.eat(TokenKind::Dedent); }
            let mig = AiceItem::DbMigration(DbMigrationDecl { tool: cur.tool, sections: cur.sections, trivia: cur.tr });
            if let Some(parent) = stack.last_mut() {
                if let Some(sec) = parent.cur_sec.as_mut() { sec.1.push(mig); }
                p.eat_stmt_end();
                continue;
            }
            return Ok(mig);
        }
        let _ = p.collect_leading_trivia();
        if p.peek_kind() == TokenKind::Dedent || p.at_eof() { continue; }
        p.expect_ident_or_kw("Expected 'section'")?;
        let sname = p.expect(TokenKind::String, "Expected section name")?.lexeme;
        p.expect(TokenKind::Colon, "Expected ':'")?;
        let _ = p.take_trailing_comment();
        p.skip_newlines();
        let sec_indent = p.eat(TokenKind::Indent);
        stack.last_mut().unwrap().cur_sec = Some((sname, Vec::new(), sec_indent));
    }
}

pub(crate) fn parse_dialect_str(s: &str) -> LanguageId {
    match s {
        "postgresql" => LanguageId::PostgreSql,
        "mysql" => LanguageId::MySql,
        "sqlite" => LanguageId::Sqlite,
        "tsql" => LanguageId::TSql,
        "migration" => LanguageId::DbMigration,
        "graphql" => LanguageId::GraphQl,
        "cypher" => LanguageId::Cypher,
        _ => LanguageId::AnsiSql,
    }
}
