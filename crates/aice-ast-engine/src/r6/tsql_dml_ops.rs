use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
use crate::r6::sql_pratt::validate_pratt_expr;
use crate::r6::tsql_dml::{consume_dml_target, consume_option, consume_output, consume_top, consume_with_hint, is_dml_ident, scan_clause, validate_col_list, validate_set_items};
use crate::r6::tsql_dml_from::{consume_where, validate_tsql_from};
use crate::r6::tsql_exec::consume_exec_source;
use crate::r6::tsql_stmt::matching_rparen;
use crate::r6::tsql_with::{validate_tsql_embedded_queries, validate_tsql_query_only};

pub(super) fn validate_insert(stmt: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    let before = errs.len();
    let Some(mut i) = consume_top(stmt, 1, "INSERT", src, errs) else { return; };
    if stmt.get(i).is_some_and(|t| t.is_kw(src, "INTO")) { i += 1; }
    let Some(next_i) = consume_dml_target(stmt, i, "INSERT", src, errs) else { return; };
    let Some(mut i) = consume_with_hint(stmt, next_i, src, errs) else { return; };

    let mut has_cols = false;
    if stmt.get(i).is_some_and(|t| t.kind == SqlTokKind::LParen) {
        let is_q = stmt.get(i + 1).is_some_and(|n| {
            n.is_kw(src, "SELECT") || n.is_kw(src, "WITH") || n.kind == SqlTokKind::LParen
        });
        if !is_q {
            let Some(rp) = matching_rparen(stmt, i) else { return; };
            if !validate_col_list(&stmt[i + 1..rp], &stmt[i], "INSERT", src, errs) { return; }
            has_cols = true;
            i = rp + 1;
        }
    }
    let out_stops = &["VALUES", "SELECT", "EXEC", "EXECUTE", "DEFAULT"];
    let Some(mut i) = consume_output(stmt, i, "INSERT", src, errs, out_stops) else { return; };

    let Some(src_tok) = stmt.get(i) else {
        let a = &stmt[i.saturating_sub(1)];
        errs.push(sp(a.line, a.col, "Missing data source in T-SQL INSERT"));
        return;
    };
    if src_tok.is_kw(src, "VALUES") {
        if !stmt.get(i + 1).is_some_and(|t| t.kind == SqlTokKind::LParen) {
            let a = stmt.get(i + 1).unwrap_or(src_tok);
            errs.push(sp(a.line, a.col, "Expected '(' after VALUES in T-SQL INSERT"));
            return;
        }
        i += 1;
        while stmt.get(i).is_some_and(|t| t.kind == SqlTokKind::LParen) {
            let Some(rp) = matching_rparen(stmt, i) else { return; };
            i = rp + 1;
            if stmt.get(i).is_some_and(|t| t.kind == SqlTokKind::Comma) { i += 1; } else { break; }
        }
        let Some(end_i) = consume_option(stmt, i, "INSERT", src, errs) else { return; };
        if end_i < stmt.len() {
            errs.push(sp(stmt[end_i].line, stmt[end_i].col, format!("Unexpected token '{}' after VALUES in T-SQL INSERT", stmt[end_i].slice(src))));
        }
    } else if src_tok.is_kw(src, "SELECT") || src_tok.kind == SqlTokKind::LParen {
        if src_tok.kind == SqlTokKind::LParen {
            let Some(rp) = matching_rparen(stmt, i) else { return; };
            if rp == i + 1 || !stmt.get(i + 1).is_some_and(|n| n.is_kw(src, "SELECT") || n.is_kw(src, "WITH") || n.kind == SqlTokKind::LParen) {
                errs.push(sp(src_tok.line, src_tok.col, "Invalid parenthesized query in T-SQL INSERT"));
                return;
            }
        }
        validate_tsql_query_only(&stmt[i..], src, errs);
        if errs.len() == before { validate_tsql_embedded_queries(&stmt[..i], src, errs); }
        return;
    } else if src_tok.is_kw(src, "EXEC") || src_tok.is_kw(src, "EXECUTE") {
        consume_exec_source(stmt, i + 1, src_tok, src, errs);
    } else if src_tok.is_kw(src, "DEFAULT") {
        if has_cols {
            errs.push(sp(src_tok.line, src_tok.col, "Column list is not allowed with DEFAULT VALUES in T-SQL INSERT"));
            return;
        }
        if !stmt.get(i + 1).is_some_and(|t| t.is_kw(src, "VALUES")) {
            errs.push(sp(src_tok.line, src_tok.col, "Expected VALUES after DEFAULT in T-SQL INSERT"));
            return;
        }
        let Some(end_i) = consume_option(stmt, i + 2, "INSERT", src, errs) else { return; };
        if end_i < stmt.len() {
            errs.push(sp(stmt[end_i].line, stmt[end_i].col, format!("Unexpected token '{}' after DEFAULT VALUES in T-SQL INSERT", stmt[end_i].slice(src))));
        }
    } else {
        errs.push(sp(src_tok.line, src_tok.col, format!("Missing or invalid data source '{}' in T-SQL INSERT", src_tok.slice(src))));
        return;
    }
    if errs.len() == before { validate_tsql_embedded_queries(stmt, src, errs); }
}

pub(super) fn validate_update(stmt: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    let before = errs.len();
    let Some(i) = consume_top(stmt, 1, "UPDATE", src, errs) else { return; };
    let Some(i) = consume_dml_target(stmt, i, "UPDATE", src, errs) else { return; };
    let Some(mut i) = consume_with_hint(stmt, i, src, errs) else { return; };
    if !stmt.get(i).is_some_and(|t| t.is_kw(src, "SET")) {
        let a = stmt.get(i).unwrap_or(&stmt[i - 1]);
        errs.push(sp(a.line, a.col, "Expected SET clause in T-SQL UPDATE"));
        return;
    }
    i += 1;
    let set_end = scan_clause(stmt, i, src, &["OUTPUT", "FROM", "WHERE", "OPTION"]);
    if !validate_set_items(&stmt[i..set_end], src, errs) {
        if set_end == i {
            errs.push(sp(stmt[i - 1].line, stmt[i - 1].col, "Empty SET clause in T-SQL UPDATE"));
        }
        return;
    }
    let Some(mut i) = consume_output(stmt, set_end, "UPDATE", src, errs, &["FROM", "WHERE", "OPTION"]) else { return; };
    if stmt.get(i).is_some_and(|t| t.is_kw(src, "FROM")) {
        let f_end = scan_clause(stmt, i + 1, src, &["WHERE", "OPTION"]);
        if f_end == i + 1 { errs.push(sp(stmt[i].line, stmt[i].col, "Empty FROM clause in T-SQL UPDATE")); return; }
        if !validate_tsql_from(&stmt[i + 1..f_end], "UPDATE", src, errs) { return; }
        i = f_end;
    }
    let Some(i) = consume_where(stmt, i, "UPDATE", src, errs) else { return; };
    let Some(i) = consume_option(stmt, i, "UPDATE", src, errs) else { return; };
    if i < stmt.len() {
        errs.push(sp(stmt[i].line, stmt[i].col, format!("Unexpected token '{}' in T-SQL UPDATE", stmt[i].slice(src))));
        return;
    }
    if errs.len() == before { validate_tsql_embedded_queries(stmt, src, errs); }
}

pub(super) fn validate_delete(stmt: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    let before = errs.len();
    let Some(mut i) = consume_top(stmt, 1, "DELETE", src, errs) else { return; };
    let has_from = stmt.get(i).is_some_and(|t| t.is_kw(src, "FROM"));
    if has_from { i += 1; }
    let Some(i) = consume_dml_target(stmt, i, "DELETE", src, errs) else { return; };
    let Some(mut i) = consume_with_hint(stmt, i, src, errs) else { return; };
    if !has_from && stmt.get(i).is_some_and(|t| t.is_kw(src, "AS")) {
        let Some(alias) = stmt.get(i + 1).filter(|t| is_dml_ident(t, src)) else {
            let a = stmt.get(i + 1).unwrap_or(&stmt[i]);
            errs.push(sp(a.line, a.col, "Expected alias after AS in T-SQL DELETE"));
            return;
        };
        let _ = alias;
        i += 2;
    }
    let Some(mut i) = consume_output(stmt, i, "DELETE", src, errs, &["FROM", "WHERE", "OPTION"]) else { return; };
    if stmt.get(i).is_some_and(|t| t.is_kw(src, "FROM")) {
        let f_end = scan_clause(stmt, i + 1, src, &["WHERE", "OPTION"]);
        if f_end == i + 1 { errs.push(sp(stmt[i].line, stmt[i].col, "Empty FROM clause in T-SQL DELETE")); return; }
        if !validate_tsql_from(&stmt[i + 1..f_end], "DELETE", src, errs) { return; }
        i = f_end;
    }
    let Some(i) = consume_where(stmt, i, "DELETE", src, errs) else { return; };
    let Some(i) = consume_option(stmt, i, "DELETE", src, errs) else { return; };
    if i < stmt.len() {
        errs.push(sp(stmt[i].line, stmt[i].col, format!("Unexpected token '{}' in T-SQL DELETE", stmt[i].slice(src))));
        return;
    }
    if errs.len() == before { validate_tsql_embedded_queries(stmt, src, errs); }
}

pub(super) fn validate_merge(stmt: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    let before = errs.len();
    let Some(mut i) = consume_top(stmt, 1, "MERGE", src, errs) else { return; };
    if stmt.get(i).is_some_and(|t| t.is_kw(src, "INTO")) { i += 1; }
    let Some(i) = consume_dml_target(stmt, i, "MERGE", src, errs) else { return; };
    let Some(mut i) = consume_with_hint(stmt, i, src, errs) else { return; };
    if stmt.get(i).is_some_and(|t| t.is_kw(src, "AS")) {
        if !stmt.get(i + 1).is_some_and(|t| is_dml_ident(t, src)) {
            let a = stmt.get(i + 1).unwrap_or(&stmt[i]);
            errs.push(sp(a.line, a.col, "Expected alias after AS in T-SQL MERGE"));
            return;
        }
        i += 2;
    } else if stmt.get(i).is_some_and(|t| !t.is_kw(src, "USING") && is_dml_ident(t, src)) {
        i += 1;
    }
    if !stmt.get(i).is_some_and(|t| t.is_kw(src, "USING")) {
        let a = stmt.get(i).unwrap_or(&stmt[i - 1]);
        errs.push(sp(a.line, a.col, "Expected USING clause in T-SQL MERGE"));
        return;
    }
    let on_i = scan_clause(stmt, i + 1, src, &["ON"]);
    if on_i == i + 1 || on_i >= stmt.len() {
        errs.push(sp(stmt[i].line, stmt[i].col, "Expected source and ON clause in T-SQL MERGE"));
        return;
    }
    if !validate_tsql_from(&stmt[i + 1..on_i], "MERGE", src, errs) { return; }
    let when_i = scan_clause(stmt, on_i + 1, src, &["WHEN"]);
    if when_i == on_i + 1 || when_i >= stmt.len() {
        errs.push(sp(stmt[on_i].line, stmt[on_i].col, "Expected ON condition and WHEN clause in T-SQL MERGE"));
        return;
    }
    i = when_i;
    while stmt.get(i).is_some_and(|t| t.is_kw(src, "WHEN")) {
        let then_i = scan_clause(stmt, i + 1, src, &["THEN"]);
        if !validate_merge_when_hdr(&stmt[i + 1..then_i], &stmt[i], then_i >= stmt.len(), src, errs) { return; }
        i = then_i + 1;
        let Some(act) = stmt.get(i) else {
            errs.push(sp(stmt[then_i].line, stmt[then_i].col, "Expected action after THEN in MERGE"));
            return;
        };
        if act.is_kw(src, "UPDATE") {
            if !stmt.get(i + 1).is_some_and(|t| t.is_kw(src, "SET")) {
                errs.push(sp(act.line, act.col, "Expected UPDATE SET after THEN in MERGE"));
                return;
            }
            let end_s = scan_clause(stmt, i + 2, src, &["WHEN", "OUTPUT", "OPTION"]);
            if end_s == i + 2 { errs.push(sp(act.line, act.col, "Empty UPDATE SET in MERGE")); return; }
            if !validate_set_items(&stmt[i + 2..end_s], src, errs) { return; }
            i = end_s;
        } else if act.is_kw(src, "DELETE") {
            i += 1;
        } else if act.is_kw(src, "INSERT") {
            i += 1;
            let mut has_cols = false;
            if stmt.get(i).is_some_and(|t| t.kind == SqlTokKind::LParen) {
                let Some(rp) = matching_rparen(stmt, i) else { return; };
                if !validate_col_list(&stmt[i + 1..rp], &stmt[i], "MERGE INSERT", src, errs) { return; }
                has_cols = true;
                i = rp + 1;
            }
            if stmt.get(i).is_some_and(|t| t.is_kw(src, "VALUES")) && stmt.get(i + 1).is_some_and(|t| t.kind == SqlTokKind::LParen) {
                let Some(rp) = matching_rparen(stmt, i + 1) else { return; };
                i = rp + 1;
            } else if stmt.get(i).is_some_and(|t| t.is_kw(src, "DEFAULT")) && stmt.get(i + 1).is_some_and(|t| t.is_kw(src, "VALUES")) {
                if has_cols {
                    errs.push(sp(stmt[i].line, stmt[i].col, "Column list is not allowed with DEFAULT VALUES in MERGE INSERT"));
                    return;
                }
                i += 2;
            } else {
                let a = stmt.get(i).unwrap_or(act);
                errs.push(sp(a.line, a.col, "Expected VALUES (...) or DEFAULT VALUES in MERGE INSERT"));
                return;
            }
        } else {
            errs.push(sp(act.line, act.col, format!("Invalid action '{}' after THEN in MERGE", act.slice(src))));
            return;
        }
    }
    let Some(i) = consume_output(stmt, i, "MERGE", src, errs, &["OPTION"]) else { return; };
    let Some(i) = consume_option(stmt, i, "MERGE", src, errs) else { return; };
    if i < stmt.len() {
        errs.push(sp(stmt[i].line, stmt[i].col, format!("Unexpected token '{}' in T-SQL MERGE", stmt[i].slice(src))));
        return;
    }
    if errs.len() == before { validate_tsql_embedded_queries(stmt, src, errs); }
}

fn validate_merge_when_hdr(
    hdr: &[SqlTok], when_tok: &SqlTok, missing_then: bool, src: &str, errs: &mut Vec<ErrorSpan>,
) -> bool {
    if missing_then || hdr.is_empty() {
        errs.push(sp(when_tok.line, when_tok.col, "Expected condition and THEN in MERGE WHEN"));
        return false;
    }
    let mut k = if hdr[0].is_kw(src, "MATCHED") {
        1
    } else if hdr[0].is_kw(src, "NOT") && hdr.get(1).is_some_and(|t| t.is_kw(src, "MATCHED")) {
        let mut p = 2;
        if hdr.get(p).is_some_and(|t| t.is_kw(src, "BY")) {
            if !hdr.get(p + 1).is_some_and(|t| t.is_kw(src, "TARGET") || t.is_kw(src, "SOURCE")) {
                let a = hdr.get(p + 1).unwrap_or(&hdr[p]);
                errs.push(sp(a.line, a.col, "Expected TARGET or SOURCE after BY in MERGE WHEN"));
                return false;
            }
            p += 2;
        }
        p
    } else {
        errs.push(sp(hdr[0].line, hdr[0].col, "Expected MATCHED or NOT MATCHED in MERGE WHEN"));
        return false;
    };
    if k < hdr.len() {
        if !hdr[k].is_kw(src, "AND") {
            errs.push(sp(hdr[k].line, hdr[k].col, format!("Unexpected token '{}' in MERGE WHEN", hdr[k].slice(src))));
            return false;
        }
        k += 1;
        if k >= hdr.len() {
            errs.push(sp(hdr[k - 1].line, hdr[k - 1].col, "Expected condition after AND in MERGE WHEN"));
            return false;
        }
        let mut idx = 0;
        if let Err(e) = validate_pratt_expr(&hdr[k..], src, &mut idx, 0, &[]) { errs.push(e); return false; }
        if idx < hdr.len() - k {
            errs.push(sp(hdr[k + idx].line, hdr[k + idx].col, format!("Unexpected token '{}' in MERGE WHEN", hdr[k + idx].slice(src))));
            return false;
        }
    }
    true
}
