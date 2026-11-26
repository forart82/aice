use aice_lang_registry::LanguageId;

use crate::ir::{AiceItem, TranspileError, Trivia};
use crate::ir_domain_db::{DbMigrationDecl, DbQueryDecl, DbQueryKind, DbSchemaDecl};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_domain_schema::{
    parse_db_atom, parse_dbtype, parse_gql, parse_prisma, parse_proc, parse_table, parse_trig,
};

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
            let text = if matches!(p.peek_kind(), TokenKind::RawLine | TokenKind::TripleString) {
                p.advance().lexeme
            } else {
                p.expect(TokenKind::Colon, "Expected ':'")?;
                p.advance().lexeme
            };
            let mut tr = trivia;
            if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
            Ok(AiceItem::DbSchema(DbSchemaDecl::RawDdl { text, trivia: tr }))
        }
        "pragma" => {
            let raw = if p.peek_kind() == TokenKind::RawLine {
                p.advance().lexeme
            } else {
                p.expect(TokenKind::Colon, "Expected ':'")?;
                p.line_rest_raw()
            };
            let sql = if raw.get(..7).is_some_and(|h| h.eq_ignore_ascii_case("PRAGMA ")) {
                raw
            } else {
                format!("PRAGMA {raw}")
            };
            let mut tr = trivia;
            if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
            Ok(AiceItem::DbQuery(DbQueryDecl {
                dialect: LanguageId::Sqlite, kind: DbQueryKind::Pragma, name: None,
                ctes: Vec::new(), clauses: vec![("sql".into(), sql)], trivia: tr,
            }))
        }
        "sql" => {
            p.expect(TokenKind::Colon, "Expected ':'")?;
            let body = if matches!(p.peek_kind(), TokenKind::RawLine | TokenKind::TripleString) {
                p.advance().lexeme
            } else {
                p.line_rest_raw()
            };
            let mut tr = trivia;
            if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
            Ok(AiceItem::DbQuery(DbQueryDecl {
                dialect: LanguageId::AnsiSql, kind: DbQueryKind::Exec, name: None,
                ctes: Vec::new(), clauses: vec![("sql".into(), body)], trivia: tr,
            }))
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
    let name = parse_db_atom(p, "Expected view name")?;
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let mut tr = trivia;
    let query_sql = if matches!(p.peek_kind(), TokenKind::Newline | TokenKind::Comment) {
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        p.skip_newlines();
        let mut lines = Vec::new();
        if p.eat(TokenKind::Indent) {
            while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
                if p.peek_kind() == TokenKind::RawLine { lines.push(p.advance().lexeme); }
                else { lines.push(p.line_rest_raw()); }
                p.eat_stmt_end();
            }
            p.eat(TokenKind::Dedent);
        }
        lines.join("\n")
    } else if matches!(p.peek_kind(), TokenKind::String | TokenKind::TripleString) {
        let s = p.advance().lexeme;
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        s
    } else {
        let s = p.line_rest_raw();
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        s
    };
    Ok(AiceItem::DbSchema(DbSchemaDecl::View { name, materialized, query_sql, trivia: tr }))
}

fn parse_index(p: &mut Parser<'_>, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let unique = p.peek().lexeme == "unique" && { p.advance(); true };
    let name = parse_db_atom(p, "Expected index name")?;
    p.expect_ident_or_kw("Expected 'on'")?;
    let table = parse_db_atom(p, "Expected table name")?;
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let mut cols = Vec::new();
    while !matches!(p.peek_kind(), TokenKind::Newline | TokenKind::Dedent | TokenKind::Eof | TokenKind::Comment) {
        if p.peek_kind() == TokenKind::String {
            cols.push(p.advance().lexeme);
        } else {
            let (mut s, mut e) = (None, 0usize);
            while !matches!(p.peek_kind(), TokenKind::Comma | TokenKind::Newline | TokenKind::Dedent | TokenKind::Eof | TokenKind::Comment) {
                let tok = p.advance();
                if tok.span.end_byte > tok.span.start_byte {
                    if s.is_none() { s = Some(tok.span.start_byte); }
                    e = tok.span.end_byte;
                }
            }
            if let Some(st) = s { cols.push(p.src[st..e].trim().to_string()); }
        }
        if !p.eat(TokenKind::Comma) { break; }
    }
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    Ok(AiceItem::DbSchema(DbSchemaDecl::Index { name, unique, table, cols, trivia: tr }))
}

fn restore_cypher_prefix(k: &str, v: String) -> String {
    if !matches!(k, "MATCH" | "RETURN" | "MERGE" | "WITH" | "CREATE" | "DELETE" | "SET" | "UNWIND") {
        return v;
    }
    if v.get(..k.len()).is_some_and(|h| h.eq_ignore_ascii_case(k))
        && v.as_bytes().get(k.len()).is_none_or(|b| b.is_ascii_whitespace())
    {
        return v;
    }
    if v.is_empty() { k.to_string() } else if v.starts_with('\n') { format!("{k}{v}") } else { format!("{k} {v}") }
}

fn parse_query(p: &mut Parser<'_>, kw: &str, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let (dialect, kind) = if kw == "cypher" {
        (LanguageId::Cypher, DbQueryKind::Cypher)
    } else {
        let d = parse_dialect_str(&parse_db_atom(p, "Expected dialect")?);
        let k = match parse_db_atom(p, "Expected query kind")?.as_str() {
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
    if matches!(p.peek_kind(), TokenKind::TripleString | TokenKind::RawLine) {
        let body = p.advance().lexeme;
        let key = if kind == DbQueryKind::GraphQlOp { "query" } else { "sql" };
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        return Ok(AiceItem::DbQuery(DbQueryDecl {
            dialect, kind, name, ctes: Vec::new(), clauses: vec![(key.into(), body)], trivia: tr,
        }));
    }
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    let mut ctes: Vec<(String, String)> = Vec::new();
    let mut clauses: Vec<(String, String)> = Vec::new();
    let mut raw_body: Vec<String> = Vec::new();
    p.skip_newlines();
    if p.eat(TokenKind::Indent) {
        while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
            let _ = p.collect_leading_trivia();
            if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
            if p.peek_kind() == TokenKind::RawLine {
                let line = p.advance().lexeme;
                if let Some((_, last_v)) = clauses.last_mut() {
                    last_v.push('\n');
                    last_v.push_str(&line);
                } else if let Some((_, last_v)) = ctes.last_mut() {
                    last_v.push('\n');
                    last_v.push_str(&line);
                } else {
                    raw_body.push(line);
                }
                p.eat_stmt_end();
                continue;
            }
            let (tag, k) = if !matches!(p.peek().lexeme.as_str(), "with" | "clause") && p.peek_n(1).kind == TokenKind::Colon {
                ("clause".to_string(), parse_db_atom(p, "Expected clause key")?)
            } else {
                let t = p.expect_ident_or_kw("Expected with/clause")?.lexeme;
                let key = parse_db_atom(p, "Expected clause key")?;
                (t, key)
            };
            let v = if p.peek_kind() == TokenKind::RawLine {
                let raw = p.advance().lexeme;
                if kind == DbQueryKind::Cypher && tag != "with" { restore_cypher_prefix(&k, raw) } else { raw }
            } else {
                p.expect(TokenKind::Colon, "Expected ':'")?;
                let raw = p.advance().lexeme;
                if kind == DbQueryKind::Cypher && tag != "with" { restore_cypher_prefix(&k, raw) } else { raw }
            };
            let _ = p.take_trailing_comment();
            if tag == "with" { ctes.push((k, v)); } else { clauses.push((k, v)); }
            p.eat_stmt_end();
        }
        p.eat(TokenKind::Dedent);
    }
    if !raw_body.is_empty() && clauses.is_empty() {
        let key = if kind == DbQueryKind::GraphQlOp { "query" } else { "sql" };
        clauses.push((key.into(), raw_body.join("\n")));
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
    let tool = parse_db_atom(p, "Expected migration tool")?;
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
        let sname = parse_db_atom(p, "Expected section name")?;
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
