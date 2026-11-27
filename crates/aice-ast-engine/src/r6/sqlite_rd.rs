use aice_lang_registry::RdNode;

use crate::r5::checks::{ErrorSpan, collect_ts_error_spans};
use crate::r6::sql_expr::{check_sql_stmt_completeness, split_statements_semi, validate_and_collect_trim_masks};
use crate::r6::sql_lex::{LineIndex, SqlTok, SqlTokKind, sp};
use crate::r6::sql_pratt::validate_pratt_expr;
use crate::r6::sql_symbols::make_rd_node;
use crate::r6::sql_upsert::validate_and_collect_upsert_masks;
use crate::r6::sqlite::{is_pragma_kw_val, is_sqlite_ident};
use crate::ts_pool::{GrammarSlot, ParserPool};

pub fn validate_pragma(stmt: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    if stmt.len() < 2 { errs.push(sp(stmt[0].line, stmt[0].col, "Incomplete PRAGMA statement")); return; }
    let mut i = 1usize;
    if !is_sqlite_ident(&stmt[i]) { errs.push(sp(stmt[i].line, stmt[i].col, "Expected PRAGMA name")); return; }
    i += 1;
    if stmt.get(i).is_some_and(|t| t.kind == SqlTokKind::Dot) {
        i += 1;
        let Some(name_tok) = stmt.get(i).filter(|t| is_sqlite_ident(t)) else {
            let a = stmt.get(i).unwrap_or(&stmt[i - 1]);
            errs.push(sp(a.line, a.col, "Expected PRAGMA name after '.'"));
            return;
        };
        let _ = name_tok;
        i += 1;
    }
    let Some(next) = stmt.get(i) else { return; };
    if next.is_op(src, "=") {
        let mut idx = i + 1;
        if stmt.get(idx).is_some_and(|t| is_pragma_kw_val(t, src)) && idx + 1 == stmt.len() {
            return;
        }
        if let Err(e) = validate_pratt_expr(stmt, src, &mut idx, 0, &[]) { errs.push(e); }
        else if idx < stmt.len() { errs.push(sp(stmt[idx].line, stmt[idx].col, "Unexpected trailing token in PRAGMA")); }
    } else if next.kind == SqlTokKind::LParen {
        let mut idx = i + 1;
        if stmt.get(idx).is_some_and(|t| is_pragma_kw_val(t, src))
            && stmt.get(idx + 1).is_some_and(|t| t.kind == SqlTokKind::RParen)
            && idx + 2 == stmt.len()
        {
            return;
        }
        if let Err(e) = validate_pratt_expr(stmt, src, &mut idx, 0, &[]) { errs.push(e); }
        else if !stmt.get(idx).is_some_and(|t| t.kind == SqlTokKind::RParen) || idx + 1 != stmt.len() {
            errs.push(sp(next.line, next.col, "Malformed PRAGMA(...) argument"));
        }
    } else {
        errs.push(sp(next.line, next.col, "Expected '=' or '(' in PRAGMA"));
    }
}

pub fn validate_sqlite_table(
    stmt: &[SqlTok], src: &str, li: &LineIndex, pool: &mut ParserPool,
    errs: &mut Vec<ErrorSpan>, nodes: &mut Vec<RdNode>,
) {
    collect_sqlite_node(stmt, src, li, nodes);
    errs.extend(check_sql_stmt_completeness(stmt, src));
    let Some(lp) = stmt.iter().position(|t| t.kind == SqlTokKind::LParen) else {
        run_ts_on_tokens(stmt, src, pool, errs);
        return;
    };
    let Some(rp) = crate::r6::tsql_stmt::matching_rparen(stmt, lp) else { return; };
    let tail = &stmt[rp + 1..];
    if !tail.is_empty() && !stmt[..lp].iter().any(|t| t.is_kw(src, "AS")) {
        validate_sqlite_table_options(tail, src, errs);
        run_ts_on_tokens(&stmt[..=rp], src, pool, errs);
    } else {
        run_ts_on_tokens(stmt, src, pool, errs);
    }
}

fn validate_sqlite_table_options(tail: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    let mut i = 0usize;
    let mut need_comma = false;
    while i < tail.len() {
        if need_comma {
            if tail[i].kind != SqlTokKind::Comma {
                errs.push(sp(tail[i].line, tail[i].col, "Expected ',' between SQLite table options"));
                return;
            }
            i += 1;
            if i >= tail.len() {
                errs.push(sp(tail[i - 1].line, tail[i - 1].col, "Trailing ',' in table options"));
                return;
            }
        }
        if tail[i].is_kw(src, "STRICT") {
            i += 1;
        } else if tail[i].is_kw(src, "WITHOUT") && tail.get(i + 1).is_some_and(|n| n.is_kw(src, "ROWID")) {
            i += 2;
        } else {
            errs.push(sp(tail[i].line, tail[i].col, format!("Invalid SQLite table option '{}'", tail[i].slice(src))));
            return;
        }
        need_comma = true;
    }
}

pub fn validate_sqlite_trigger(
    stmt: &[SqlTok], src: &str, li: &LineIndex, pool: &mut ParserPool,
    errs: &mut Vec<ErrorSpan>, nodes: &mut Vec<RdNode>,
) {
    collect_sqlite_node(stmt, src, li, nodes);
    let Some(begin_pos) = stmt.iter().position(|t| t.is_kw(src, "BEGIN")) else {
        errs.push(sp(stmt[0].line, stmt[0].col, "SQLite CREATE TRIGGER missing BEGIN"));
        return;
    };
    let Some(end_pos) = stmt.iter().rposition(|t| t.is_kw(src, "END")) else {
        errs.push(sp(stmt[begin_pos].line, stmt[begin_pos].col, "Unclosed SQLite trigger BEGIN..END"));
        return;
    };
    if end_pos <= begin_pos {
        errs.push(sp(stmt[begin_pos].line, stmt[begin_pos].col, "Malformed SQLite trigger BEGIN..END"));
        return;
    }
    if end_pos + 1 < stmt.len() {
        errs.push(sp(stmt[end_pos + 1].line, stmt[end_pos + 1].col, "Unexpected tokens after trigger END"));
    }
    validate_trigger_header(&stmt[..begin_pos], src, errs);
    for inner in split_statements_semi(&stmt[begin_pos + 1..end_pos]) {
        errs.extend(check_sql_stmt_completeness(inner, src));
        run_ts_on_tokens(inner, src, pool, errs);
    }
}

fn skip_qual_ident(toks: &[SqlTok], i: &mut usize) -> bool {
    if !toks.get(*i).is_some_and(is_sqlite_ident) { return false; }
    *i += 1;
    if toks.get(*i).is_some_and(|t| t.kind == SqlTokKind::Dot) && toks.get(*i + 1).is_some_and(is_sqlite_ident) { *i += 2; }
    true
}

fn validate_trigger_header(hdr: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    let mut i = 1usize;
    if hdr.get(i).is_some_and(|t| t.is_kw(src, "TEMP") || t.is_kw(src, "TEMPORARY")) { i += 1; }
    if !hdr.get(i).is_some_and(|t| t.is_kw(src, "TRIGGER")) { return; }
    i += 1;
    if hdr.get(i).is_some_and(|t| t.is_kw(src, "IF")) {
        if hdr.get(i + 1).is_some_and(|t| t.is_kw(src, "NOT")) && hdr.get(i + 2).is_some_and(|t| t.is_kw(src, "EXISTS")) { i += 3; }
        else { errs.push(sp(hdr[i].line, hdr[i].col, "Expected IF NOT EXISTS in trigger")); return; }
    }
    if !skip_qual_ident(hdr, &mut i) { errs.push(sp(hdr[0].line, hdr[0].col, "Expected trigger name")); return; }
    if hdr.get(i).is_some_and(|t| t.is_kw(src, "BEFORE") || t.is_kw(src, "AFTER")) { i += 1; }
    else if hdr.get(i).is_some_and(|t| t.is_kw(src, "INSTEAD")) && hdr.get(i + 1).is_some_and(|t| t.is_kw(src, "OF")) { i += 2; }
    else { let a = hdr.get(i).unwrap_or(&hdr[0]); errs.push(sp(a.line, a.col, "Expected BEFORE/AFTER/INSTEAD OF in trigger")); return; }
    if hdr.get(i).is_some_and(|t| t.is_kw(src, "DELETE") || t.is_kw(src, "INSERT")) { i += 1; }
    else if hdr.get(i).is_some_and(|t| t.is_kw(src, "UPDATE")) {
        i += 1;
        if hdr.get(i).is_some_and(|t| t.is_kw(src, "OF")) {
            i += 1;
            if !skip_qual_ident(hdr, &mut i) { errs.push(sp(hdr[i - 1].line, hdr[i - 1].col, "Expected column after UPDATE OF")); return; }
            while hdr.get(i).is_some_and(|t| t.kind == SqlTokKind::Comma) {
                i += 1;
                if !skip_qual_ident(hdr, &mut i) { errs.push(sp(hdr[i - 1].line, hdr[i - 1].col, "Expected column after ','")); return; }
            }
        }
    } else { let a = hdr.get(i).unwrap_or(&hdr[0]); errs.push(sp(a.line, a.col, "Expected DELETE/INSERT/UPDATE in trigger")); return; }
    if !hdr.get(i).is_some_and(|t| t.is_kw(src, "ON")) {
        let a = hdr.get(i).unwrap_or(&hdr[0]); errs.push(sp(a.line, a.col, "Expected ON <table> in trigger")); return;
    }
    i += 1;
    if !skip_qual_ident(hdr, &mut i) { errs.push(sp(hdr[i - 1].line, hdr[i - 1].col, "Expected table name after ON")); return; }
    if hdr.get(i).is_some_and(|t| t.is_kw(src, "FOR")) {
        if hdr.get(i + 1).is_some_and(|t| t.is_kw(src, "EACH")) && hdr.get(i + 2).is_some_and(|t| t.is_kw(src, "ROW")) { i += 3; }
        else { errs.push(sp(hdr[i].line, hdr[i].col, "Expected FOR EACH ROW in trigger")); return; }
    }
    if hdr.get(i).is_some_and(|t| t.is_kw(src, "WHEN")) {
        let mut idx = i + 1;
        if let Err(e) = validate_pratt_expr(hdr, src, &mut idx, 0, &[]) { errs.push(e); }
        else if idx < hdr.len() { errs.push(sp(hdr[idx].line, hdr[idx].col, "Unexpected token in trigger WHEN clause")); }
    } else if i < hdr.len() {
        errs.push(sp(hdr[i].line, hdr[i].col, "Unexpected token in SQLite CREATE TRIGGER header"));
    }
}

pub fn collect_sqlite_node(stmt: &[SqlTok], src: &str, li: &LineIndex, nodes: &mut Vec<RdNode>) {
    let (Some(f), Some(l)) = (stmt.first(), stmt.last()) else { return; };
    if f.is_kw(src, "CREATE") {
        let mut i = 1usize;
        while i < stmt.len() && (stmt[i].is_kw(src, "TEMP") || stmt[i].is_kw(src, "TEMPORARY") || stmt[i].is_kw(src, "UNIQUE")) {
            i += 1;
        }
        let kind = if stmt.get(i).is_some_and(|t| t.is_kw(src, "TABLE")) { Some("table") }
            else if stmt.get(i).is_some_and(|t| t.is_kw(src, "VIEW")) { Some("view") }
            else if stmt.get(i).is_some_and(|t| t.is_kw(src, "TRIGGER")) { Some("trigger") }
            else if stmt.get(i).is_some_and(|t| t.is_kw(src, "INDEX")) { Some("index") }
            else { None };
        if let Some(k) = kind {
            let mut ni = i + 1;
            if stmt.get(ni).is_some_and(|t| t.is_kw(src, "IF")) { ni += 3; }
            if let Some(tok) = stmt.get(ni) {
                let mut name = tok.ident_name(src);
                if stmt.get(ni + 1).is_some_and(|t| t.kind == SqlTokKind::Dot)
                    && let Some(n2) = stmt.get(ni + 2) { name = format!("{name}.{}", n2.ident_name(src)); }
                nodes.push(make_rd_node(k, Some(name), f.start, l.end, li, src));
            }
        }
    } else if f.is_kw(src, "WITH") && let Some(n) = stmt.get(1) {
        nodes.push(make_rd_node("cte", Some(n.ident_name(src)), f.start, l.end, li, src));
    }
}

pub fn run_ts_on_tokens(stmt: &[SqlTok], src: &str, pool: &mut ParserPool, errs: &mut Vec<ErrorSpan>) {
    let trim_masks = validate_and_collect_trim_masks(stmt, src, errs);
    let is_ddl = stmt.first().is_some_and(|t| t.is_kw(src, "CREATE"));
    let upsert_masks = if is_ddl { Vec::new() } else { validate_and_collect_upsert_masks(stmt, src, errs) };
    let (Some(f), Some(l)) = (stmt.first(), stmt.last()) else { return; };
    let mut buf = String::with_capacity(l.end - f.start + 4);
    let (mut i, mut mi, mut ui) = (0usize, 0usize, 0usize);
    while i < stmt.len() {
        let t = &stmt[i];
        if t.is_kw(src, "AUTOINCREMENT") { i += 1; continue; }
        if is_ddl && t.is_kw(src, "ON") && stmt.get(i + 1).is_some_and(|n| n.is_kw(src, "CONFLICT")) {
            let algo_ok = stmt.get(i + 2).is_some_and(|a| {
                ["ROLLBACK", "ABORT", "FAIL", "IGNORE", "REPLACE"].iter().any(|k| a.is_kw(src, k))
            });
            if !algo_ok {
                errs.push(sp(t.line, t.col, "Invalid SQLite ON CONFLICT resolution algorithm"));
                i += 2;
            } else {
                i += 3;
            }
            continue;
        }
        while mi < trim_masks.len() && t.start >= trim_masks[mi].1 { mi += 1; }
        while ui < upsert_masks.len() && t.start >= upsert_masks[ui].1 { ui += 1; }
        if (mi < trim_masks.len() && t.start >= trim_masks[mi].0 && t.end <= trim_masks[mi].1)
            || (ui < upsert_masks.len() && t.start >= upsert_masks[ui].0 && t.end <= upsert_masks[ui].1)
        {
            i += 1;
            continue;
        }
        match t.kind {
            SqlTokKind::BracketIdent | SqlTokKind::BacktickIdent | SqlTokKind::QuotedIdent => {
                let name = t.ident_name(src);
                if name.is_empty() && t.kind != SqlTokKind::QuotedIdent {
                    errs.push(sp(t.line, t.col, "Empty quoted identifier"));
                }
                if t.kind == SqlTokKind::QuotedIdent && !name.contains(['"', '\\', '\n', '\r']) {
                    buf.push_str(t.slice(src));
                } else if name.contains(['"', '\\', '\n', '\r']) || name.is_empty() {
                    buf.push_str("_sq");
                } else {
                    buf.push('"');
                    buf.push_str(&name);
                    buf.push('"');
                }
            }
            _ => buf.push_str(t.slice(src)),
        }
        buf.push(' ');
        i += 1;
    }
    buf.push(';');
    if let Ok(tree) = pool.parse_slot(GrammarSlot::Sql, &buf) {
        for mut spn in collect_ts_error_spans(&tree, &buf) {
            spn.line = f.line;
            spn.column = f.col;
            spn.end_line = f.line;
            errs.push(spn);
        }
    }
}
