use aice_lang_registry::{LanguageId, RdNode};

use crate::decompile::sql_rd_proc::try_parse_create_routine;
use crate::decompile::sql_rd_tbl::{
    parse_create_index_text, parse_create_table_text, push_utf8_char,
};
use crate::decompile::trivia::clean_comment;
use crate::ir::{AiceItem, TranspileOpts, Trivia, TriviaComment, TriviaKind};
use crate::ir_domain_db::{DbMigrationDecl, DbQueryDecl, DbQueryKind, DbSchemaDecl};

pub(crate) fn scan_rd_sql_items(
    lang: LanguageId,
    root: &RdNode,
    src: &str,
    opts: &TranspileOpts,
) -> (Vec<AiceItem>, Trivia) {
    if lang == LanguageId::DbMigration {
        return (vec![scan_migration(root, src, opts)], Trivia::default());
    }
    let (stmts, eof_trivia) = split_sql_statements(src, lang, opts);
    let items = stmts
        .into_iter()
        .map(|(s, tr)| parse_sql_stmt_to_item(lang, &s, tr, opts))
        .collect();
    (items, eof_trivia)
}

fn scan_migration(root: &RdNode, src: &str, opts: &TranspileOpts) -> AiceItem {
    let tool = if src.contains("-- +goose") { "goose" }
    else if src.contains("-- +migrate") { "migrate" }
    else if src.contains("-- migrate:") { "dbmate" }
    else { "sql" };
    let mut sections = Vec::new();
    for ch in &root.children {
        if ch.kind == "section" {
            let label = ch.label.clone().unwrap_or_else(|| "Up".into());
            let slice = src.get(ch.start_byte..ch.end_byte.min(src.len())).unwrap_or("");
            let (stmts, _) = split_sql_statements(slice, LanguageId::AnsiSql, opts);
            let sub_items: Vec<AiceItem> = stmts
                .into_iter()
                .map(|(s, tr)| parse_sql_stmt_to_item(LanguageId::AnsiSql, &s, tr, opts))
                .collect();
            sections.push((label, sub_items));
        }
    }
    if sections.is_empty() {
        let (stmts, _) = split_sql_statements(src, LanguageId::AnsiSql, opts);
        let items = stmts
            .into_iter()
            .map(|(s, tr)| parse_sql_stmt_to_item(LanguageId::AnsiSql, &s, tr, opts))
            .collect();
        sections.push(("Up".into(), items));
    }
    AiceItem::DbMigration(DbMigrationDecl { tool: tool.into(), sections, trivia: Trivia::default() })
}

fn starts_with_ci_word(s: &str, kw: &str) -> bool {
    s.get(..kw.len()).is_some_and(|p| p.eq_ignore_ascii_case(kw))
        && s.as_bytes().get(kw.len()).is_none_or(|c| !c.is_ascii_alphanumeric() && *c != b'_')
}

fn ends_with_ci_word(s: &str, kw: &str) -> bool {
    let t = s.trim_end();
    t.len() >= kw.len()
        && t.get(t.len() - kw.len()..).is_some_and(|p| p.eq_ignore_ascii_case(kw))
        && (t.len() == kw.len() || t.as_bytes()[t.len() - kw.len() - 1] != b'_' && !t.as_bytes()[t.len() - kw.len() - 1].is_ascii_alphanumeric())
}

fn is_create_table_prefix(s: &str) -> bool {
    let up = s.trim_start().to_ascii_uppercase();
    up.starts_with("CREATE TABLE ") || up.starts_with("CREATE TEMP TABLE ") || up.starts_with("CREATE TEMPORARY TABLE ")
}

fn push_stmt(
    out: &mut Vec<(String, Trivia)>,
    cur: &mut String,
    leading: &mut Vec<TriviaComment>,
    trailing: &mut Option<String>,
) -> Option<usize> {
    if cur.trim().is_empty() {
        *trailing = None;
        cur.clear();
        return None;
    }
    let tr = Trivia {
        leading: std::mem::take(leading),
        trailing: trailing.take(),
        blank_lines_before: 0,
    };
    out.push((cur.trim().to_string(), tr));
    cur.clear();
    Some(out.len() - 1)
}

fn split_sql_statements(
    src: &str,
    lang: LanguageId,
    opts: &TranspileOpts,
) -> (Vec<(String, Trivia)>, Trivia) {
    let mut stmts: Vec<(String, Trivia)> = Vec::new();
    let (mut cur, mut delim) = (String::new(), ";".to_string());
    let (mut in_sq, mut in_dq, mut in_block_comment, mut in_trivia_block) = (false, false, false, false);
    let (mut dollar_tag, mut begin_depth, mut paren_depth) = (None::<String>, 0usize, 0usize);
    let (mut pending_leading, mut pending_trailing) = (Vec::new(), None::<String>);
    let (mut trivia_block_buf, mut trivia_block_flushed) = (String::new(), None::<usize>);

    for raw_line in src.lines() {
        let trimmed = raw_line.trim();
        let mut flushed_on_line: Option<usize> = None;
        if lang == LanguageId::MySql
            && trimmed.get(..10).is_some_and(|p| p.eq_ignore_ascii_case("DELIMITER "))
            && !in_sq && !in_dq && !in_block_comment && !in_trivia_block && dollar_tag.is_none()
        {
            push_stmt(&mut stmts, &mut cur, &mut pending_leading, &mut pending_trailing);
            delim = trimmed[10..].trim().to_string();
            paren_depth = 0;
            continue;
        }
        if lang == LanguageId::TSql && trimmed.eq_ignore_ascii_case("GO") && !in_sq && !in_dq && !in_block_comment && !in_trivia_block {
            push_stmt(&mut stmts, &mut cur, &mut pending_leading, &mut pending_trailing);
            begin_depth = 0;
            paren_depth = 0;
            continue;
        }
        let b = raw_line.as_bytes();
        let mut i = 0usize;
        while i < b.len() {
            if in_trivia_block {
                if b[i] == b'*' && b.get(i + 1) == Some(&b'/') {
                    in_trivia_block = false;
                    if opts.preserve_docs {
                        let txt = clean_comment(&format!("/*{trivia_block_buf}*/"));
                        if !txt.is_empty() {
                            if let Some(idx) = trivia_block_flushed.take()
                                && stmts[idx].1.trailing.is_none()
                            {
                                stmts[idx].1.trailing = Some(txt);
                            } else {
                                pending_leading.push(TriviaComment { kind: TriviaKind::Line, text: txt });
                            }
                        }
                    }
                    trivia_block_flushed = None;
                    trivia_block_buf.clear();
                    i += 2;
                    continue;
                }
                i = push_utf8_char(raw_line, i, &mut trivia_block_buf);
                continue;
            }
            if in_block_comment {
                if b[i] == b'*' && b.get(i + 1) == Some(&b'/') {
                    in_block_comment = false; cur.push_str("*/"); i += 2; continue;
                }
                i = push_utf8_char(raw_line, i, &mut cur); continue;
            }
            if let Some(ref tag) = dollar_tag.clone() {
                if raw_line[i..].starts_with(tag) {
                    cur.push_str(tag); i += tag.len(); dollar_tag = None; continue;
                }
                i = push_utf8_char(raw_line, i, &mut cur); continue;
            }
            if !in_sq && !in_dq {
                if (b[i] == b'-' && b.get(i + 1) == Some(&b'-')) || (lang == LanguageId::MySql && b[i] == b'#') {
                    if !cur.trim().is_empty() && paren_depth > 0 && is_create_table_prefix(&cur) {
                        if opts.preserve_docs {
                            cur.push_str(&raw_line[i..]);
                        }
                        break;
                    }
                    if opts.preserve_docs {
                        let txt = clean_comment(&raw_line[i..]);
                        if !txt.is_empty() {
                            if cur.trim().is_empty() {
                                if let Some(idx) = flushed_on_line {
                                    if stmts[idx].1.trailing.is_none() { stmts[idx].1.trailing = Some(txt); }
                                } else {
                                    pending_leading.push(TriviaComment { kind: TriviaKind::Line, text: txt });
                                }
                            } else {
                                pending_trailing = Some(txt);
                            }
                        }
                    }
                    break;
                }
                if b[i] == b'/' && b.get(i + 1) == Some(&b'*') {
                    if cur.trim().is_empty() {
                        in_trivia_block = true;
                        trivia_block_buf.clear();
                        trivia_block_flushed = flushed_on_line;
                        i += 2;
                        continue;
                    }
                    in_block_comment = true; cur.push_str("/*"); i += 2; continue;
                }
                if lang == LanguageId::PostgreSql && b[i] == b'$'
                    && let Some(rel_end) = raw_line[i + 1..].find('$')
                    && raw_line[i + 1..i + 1 + rel_end].bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
                {
                    let tag = raw_line[i..i + 2 + rel_end].to_string();
                    cur.push_str(&tag); i += tag.len(); dollar_tag = Some(tag); continue;
                }
                if matches!(lang, LanguageId::TSql | LanguageId::Sqlite | LanguageId::MySql)
                    && (i == 0 || !b[i - 1].is_ascii_alphanumeric() && b[i - 1] != b'_')
                {
                    let rest = &raw_line[i..];
                    if starts_with_ci_word(rest, "BEGIN") {
                        let after = rest[5..].trim_start();
                        if !starts_with_ci_word(after, "TRAN") && !starts_with_ci_word(after, "WORK") && !after.starts_with(';') {
                            begin_depth += 1;
                        }
                    } else if starts_with_ci_word(rest, "END") {
                        let after = rest[3..].trim_start();
                        let ctrl = lang == LanguageId::MySql && ["IF", "WHILE", "LOOP", "REPEAT", "FOR"].iter().any(|kw| starts_with_ci_word(after, kw));
                        if !ctrl { begin_depth = begin_depth.saturating_sub(1); }
                    } else if lang == LanguageId::MySql && starts_with_ci_word(rest, "CASE") && !ends_with_ci_word(&cur, "END") {
                        begin_depth += 1;
                    }
                }
                if raw_line[i..].starts_with(&delim) && (delim != ";" || begin_depth == 0) {
                    if let Some(idx) = push_stmt(&mut stmts, &mut cur, &mut pending_leading, &mut pending_trailing) {
                        flushed_on_line = Some(idx);
                    }
                    paren_depth = 0;
                    i += delim.len();
                    continue;
                }
                if b[i] == b'(' { paren_depth += 1; }
                else if b[i] == b')' { paren_depth = paren_depth.saturating_sub(1); }
            }
            if b[i] == b'\'' && !in_dq { in_sq = !in_sq; }
            else if b[i] == b'"' && !in_sq { in_dq = !in_dq; }
            if !b[i].is_ascii_whitespace() { pending_trailing = None; }
            i = push_utf8_char(raw_line, i, &mut cur);
        }
        if in_trivia_block { trivia_block_buf.push('\n'); }
        else if !cur.trim().is_empty() { cur.push('\n'); }
    }
    push_stmt(&mut stmts, &mut cur, &mut pending_leading, &mut pending_trailing);
    let eof_trivia = if opts.preserve_docs && !pending_leading.is_empty() {
        Trivia { leading: pending_leading, trailing: None, blank_lines_before: 0 }
    } else {
        Trivia::default()
    };
    (stmts, eof_trivia)
}

fn parse_sql_stmt_to_item(
    lang: LanguageId,
    stmt: &str,
    trivia: Trivia,
    opts: &TranspileOpts,
) -> AiceItem {
    let trimmed = stmt.trim();
    let up = trimmed.to_ascii_uppercase();
    let q_kind = if starts_with_ci_word(&up, "PRAGMA") { Some(DbQueryKind::Pragma) }
        else if starts_with_ci_word(&up, "SELECT") || starts_with_ci_word(&up, "WITH") { Some(DbQueryKind::Select) }
        else if starts_with_ci_word(&up, "INSERT") { Some(DbQueryKind::Insert) }
        else if starts_with_ci_word(&up, "UPDATE") { Some(DbQueryKind::Update) }
        else if starts_with_ci_word(&up, "DELETE") { Some(DbQueryKind::Delete) }
        else { None };
    if let Some(kind) = q_kind {
        return AiceItem::DbQuery(DbQueryDecl {
            dialect: lang, kind, name: None, ctes: Vec::new(),
            clauses: vec![("sql".into(), trimmed.into())], trivia,
        });
    }
    if up.starts_with("CREATE TABLE ") || up.starts_with("CREATE TEMP TABLE ") || up.starts_with("CREATE TEMPORARY TABLE ") {
        return AiceItem::DbSchema(parse_create_table_text(stmt, lang, trivia, opts));
    }
    if up.starts_with("CREATE INDEX ") || up.starts_with("CREATE UNIQUE INDEX ") {
        return AiceItem::DbSchema(parse_create_index_text(stmt, up.starts_with("CREATE UNIQUE"), trivia));
    }
    if up.starts_with("CREATE ") && (up.contains(" TRIGGER ") || up.contains(" VIEW ")) {
        return AiceItem::DbSchema(DbSchemaDecl::RawDdl { text: trimmed.into(), trivia });
    }
    if let Some(proc_decl) = try_parse_create_routine(lang, stmt, trimmed, trivia.clone()) {
        return AiceItem::DbSchema(proc_decl);
    }
    AiceItem::DbSchema(DbSchemaDecl::RawDdl { text: trimmed.into(), trivia })
}
