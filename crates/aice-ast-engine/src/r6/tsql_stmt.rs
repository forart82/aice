use crate::r5::checks::ErrorSpan;
use crate::r6::sql_expr::check_sql_stmt_completeness;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
use crate::r6::sql_pratt::validate_pratt_expr;
use crate::r6::tsql_alter::validate_tsql_alter_table;
use crate::r6::tsql_ddl::{validate_tsql_create_table, validate_tsql_view};
use crate::r6::tsql_ddl_hdr::{find_create_index_kw, validate_tsql_create_index};
use crate::r6::tsql_dml::validate_tsql_dml;
use crate::r6::tsql_query::{validate_tsql_predicates, validate_tsql_selects};
use crate::r6::tsql_with::{validate_tsql_embedded_queries, validate_tsql_query_only, validate_tsql_with};

fn validate_expr_subqueries(slice: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    validate_tsql_embedded_queries(slice, src, errs);
    validate_tsql_values(slice, src, errs);
    validate_tsql_selects(slice, src, errs);
    validate_tsql_predicates(slice, src, errs);
}

const TSQL_STMT_KWS: &[&str] = &[
    "SELECT", "INSERT", "UPDATE", "DELETE", "MERGE", "WITH", "OUTPUT",
    "CREATE", "ALTER", "DROP", "TRUNCATE", "ENABLE", "DISABLE",
    "GRANT", "REVOKE", "DENY", "USE", "DECLARE", "SET", "RETURN",
    "THROW", "RAISERROR", "PRINT", "EXEC", "EXECUTE", "BREAK",
    "CONTINUE", "GOTO", "WAITFOR", "COMMIT", "ROLLBACK", "SAVE",
    "BEGIN", "TRANSACTION", "OPEN", "CLOSE", "FETCH", "DEALLOCATE",
    "CHECKPOINT", "DBCC", "BACKUP", "RESTORE", "BULK", "KILL",
    "RECONFIGURE", "SHUTDOWN", "RECEIVE", "SEND", "REVERT", "GO",
];

pub(crate) fn consume_simple(
    clean: &[SqlTok], start: usize, src: &str, errs: &mut Vec<ErrorSpan>,
) -> usize {
    let (mut i, mut d, mut cases) = (start, 0usize, 0usize);
    while i < clean.len() {
        let t = &clean[i];
        let not_dot = i == 0 || clean[i - 1].kind != SqlTokKind::Dot;
        if t.kind == SqlTokKind::LParen { d += 1; }
        else if t.kind == SqlTokKind::RParen { d = d.saturating_sub(1); }
        else if not_dot && t.is_kw(src, "CASE") { cases += 1; }
        else if not_dot && t.is_kw(src, "END") && cases > 0 { cases -= 1; }
        else if d == 0
            && (t.kind == SqlTokKind::Semi
                || (cases == 0 && i > start && not_dot
                    && (t.is_kw(src, "END")
                        || t.is_kw(src, "ELSE")
                        || t.is_kw(src, "CREATE")
                        || (t.is_kw(src, "ALTER")
                            && !(i == start + 2
                                && clean[start].is_kw(src, "CREATE")
                                && clean[start + 1].is_kw(src, "OR"))
                            && !(clean[start].is_kw(src, "ALTER")
                                && clean.get(start + 1).is_some_and(|n| n.is_kw(src, "TABLE"))
                                && clean.get(i + 1).is_some_and(|n| n.is_kw(src, "COLUMN"))))
                        || t.is_kw(src, "BEGIN"))))
        {
            break;
        }
        i += 1;
    }
    let stmt = &clean[start..i];
    if !stmt.is_empty() {
        validate_tsql_stmt(stmt, src, errs);
    }
    if i < clean.len() && clean[i].kind == SqlTokKind::Semi { i + 1 } else { i }
}

fn validate_tsql_stmt(stmt: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    errs.extend(check_sql_stmt_completeness(stmt, src));
    let is_label = stmt.len() == 2 && stmt[0].kind == SqlTokKind::Word && stmt[1].is_op(src, ":");
    let is_paren_q = stmt[0].kind == SqlTokKind::LParen;
    if !is_label && !is_paren_q
        && !(stmt[0].kind == SqlTokKind::Word && TSQL_STMT_KWS.iter().any(|k| stmt[0].is_kw(src, k)))
    {
        errs.push(sp(stmt[0].line, stmt[0].col, format!("Unknown T-SQL statement keyword '{}'", stmt[0].slice(src))));
        return;
    }
    if stmt[0].is_kw(src, "GO") {
        if !(stmt.len() == 1 || (stmt.len() == 2 && stmt[1].kind == SqlTokKind::Number)) {
            errs.push(sp(stmt[0].line, stmt[0].col, "Invalid GO batch separator"));
        }
        return;
    }
    if stmt[0].is_kw(src, "SET") {
        if stmt.len() < 2 {
            errs.push(sp(stmt[0].line, stmt[0].col, "Incomplete T-SQL SET statement"));
            return;
        }
        if stmt[1].kind == SqlTokKind::Var {
            if !stmt.get(2).is_some_and(|x| x.kind == SqlTokKind::Op && matches!(
                x.slice(src), "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "&=" | "^=" | "|="
            )) {
                let a = stmt.get(2).unwrap_or(&stmt[1]);
                errs.push(sp(a.line, a.col, "Expected assignment operator after variable in T-SQL SET"));
                return;
            }
            let mut idx = 3;
            if let Err(e) = validate_pratt_expr(stmt, src, &mut idx, 0, &[]) { errs.push(e); }
            else if idx < stmt.len() {
                errs.push(sp(stmt[idx].line, stmt[idx].col, "Unexpected trailing token in T-SQL SET"));
            } else {
                validate_expr_subqueries(stmt, src, errs);
            }
            return;
        }
    }
    if stmt[0].is_kw(src, "RETURN") {
        if stmt.len() > 1 {
            let mut idx = 1;
            if let Err(e) = validate_pratt_expr(stmt, src, &mut idx, 0, &[]) { errs.push(e); }
            else if idx < stmt.len() {
                errs.push(sp(stmt[idx].line, stmt[idx].col, "Unexpected trailing token in T-SQL RETURN"));
            } else {
                validate_expr_subqueries(stmt, src, errs);
            }
        }
        return;
    }
    let obj_i = if stmt[0].is_kw(src, "CREATE")
        && stmt.get(1).is_some_and(|t| t.is_kw(src, "OR"))
        && stmt.get(2).is_some_and(|t| t.is_kw(src, "ALTER"))
    {
        3
    } else {
        1
    };
    let mut query_end = stmt.len();
    let mut ran_query_val = false;
    if stmt[0].is_kw(src, "WITH") {
        validate_tsql_with(stmt, src, errs);
        ran_query_val = true;
    } else if stmt[0].is_kw(src, "SELECT") || stmt[0].kind == SqlTokKind::LParen {
        validate_tsql_query_only(stmt, src, errs);
        ran_query_val = true;
    } else if (stmt[0].is_kw(src, "CREATE") || stmt[0].is_kw(src, "ALTER"))
        && stmt.get(obj_i).is_some_and(|t| t.is_kw(src, "VIEW"))
        && let Some(end) = validate_tsql_view(stmt, obj_i, src, errs)
    {
        query_end = end;
        ran_query_val = true;
    }
    if stmt[0].is_kw(src, "CREATE") && obj_i == 1 && stmt.get(1).is_some_and(|t| t.is_kw(src, "TABLE")) {
        validate_tsql_create_table(stmt, src, errs);
    } else if stmt[0].is_kw(src, "ALTER") && obj_i == 1 && stmt.get(1).is_some_and(|t| t.is_kw(src, "TABLE")) {
        validate_tsql_alter_table(stmt, src, errs);
    } else if obj_i == 1 && let Some((idx_kw, is_cs, is_ft)) = find_create_index_kw(stmt, src) {
        validate_tsql_create_index(stmt, idx_kw, is_cs, is_ft, src, errs);
    }
    if stmt[0].is_kw(src, "INSERT")
        || stmt[0].is_kw(src, "UPDATE")
        || stmt[0].is_kw(src, "DELETE")
        || stmt[0].is_kw(src, "MERGE")
    {
        validate_tsql_dml(stmt, src, errs);
        ran_query_val = true;
    }
    let qstmt = &stmt[..query_end];
    if !ran_query_val { validate_tsql_embedded_queries(qstmt, src, errs); }
    validate_tsql_values(qstmt, src, errs);
    validate_tsql_selects(qstmt, src, errs);
    validate_tsql_predicates(qstmt, src, errs);
}

pub(super) fn validate_tsql_values(stmt: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    let mut i = 0usize;
    while i < stmt.len() {
        let not_dot = i == 0 || stmt[i - 1].kind != SqlTokKind::Dot;
        if not_dot && stmt[i].is_kw(src, "VALUES") && stmt.get(i + 1).is_some_and(|t| t.kind == SqlTokKind::LParen) {
            let in_paren = i > 0 && stmt[i - 1].kind == SqlTokKind::LParen;
            i += 1;
            while i < stmt.len() && stmt[i].kind == SqlTokKind::LParen {
                let Some(rp) = matching_rparen(stmt, i) else { break; };
                if rp == i + 1 {
                    errs.push(sp(stmt[i].line, stmt[i].col, "Empty '()' tuple in VALUES"));
                }
                for arg in split_comma_top(&stmt[i + 1..rp]) {
                    if arg.is_empty() { continue; }
                    let mut idx = 0;
                    if let Err(e) = validate_pratt_expr(arg, src, &mut idx, 0, &[]) { errs.push(e); }
                    else if idx < arg.len() {
                        errs.push(sp(arg[idx].line, arg[idx].col, format!("Expected ',' before '{}' in VALUES", arg[idx].slice(src))));
                    }
                }
                i = rp + 1;
                if stmt.get(i).is_some_and(|t| t.kind == SqlTokKind::Comma) {
                    i += 1;
                    if !stmt.get(i).is_some_and(|t| t.kind == SqlTokKind::LParen) {
                        let a = stmt.get(i).unwrap_or(&stmt[i - 1]);
                        errs.push(sp(a.line, a.col, "Expected '(' after ',' in VALUES"));
                        break;
                    }
                } else {
                    if let Some(next) = stmt.get(i) {
                        if next.kind == SqlTokKind::LParen {
                            errs.push(sp(next.line, next.col, "Expected ',' before '(' in VALUES"));
                        } else if in_paren && next.kind != SqlTokKind::RParen {
                            errs.push(sp(next.line, next.col, format!("Unexpected token '{}' in VALUES", next.slice(src))));
                        }
                    }
                    break;
                }
            }
        } else {
            i += 1;
        }
    }
}

pub(crate) fn matching_rparen(toks: &[SqlTok], lp: usize) -> Option<usize> {
    let mut d = 0usize;
    for (idx, t) in toks.iter().enumerate().skip(lp) {
        if t.kind == SqlTokKind::LParen { d += 1; }
        else if t.kind == SqlTokKind::RParen { d -= 1; if d == 0 { return Some(idx); } }
    }
    None
}

pub(crate) fn split_comma_top(toks: &[SqlTok]) -> Vec<&[SqlTok]> {
    let (mut out, mut start, mut d) = (Vec::new(), 0usize, 0usize);
    for (i, t) in toks.iter().enumerate() {
        if t.kind == SqlTokKind::LParen { d += 1; }
        else if t.kind == SqlTokKind::RParen { d = d.saturating_sub(1); }
        else if t.kind == SqlTokKind::Comma && d == 0 {
            out.push(&toks[start..i]);
            start = i + 1;
        }
    }
    out.push(&toks[start..]);
    out
}

pub(crate) fn is_tsql_cond_stop(clean: &[SqlTok], i: usize, src: &str) -> bool {
    if i > 0 && clean[i - 1].kind == SqlTokKind::Dot { return false; }
    let t = &clean[i];
    if t.kind == SqlTokKind::Semi { return true; }
    if t.kind != SqlTokKind::Word { return false; }
    if t.is_kw(src, "UPDATE") {
        return !clean.get(i + 1).is_some_and(|n| n.kind == SqlTokKind::LParen);
    }
    TSQL_STMT_KWS.iter().any(|k| t.is_kw(src, k))
        || t.is_kw(src, "IF") || t.is_kw(src, "WHILE")
        || t.is_kw(src, "ELSE") || t.is_kw(src, "END")
}

pub(crate) fn validate_tsql_cond(cond: &[SqlTok], kw: &SqlTok, src: &str, errs: &mut Vec<ErrorSpan>) {
    if cond.is_empty() {
        errs.push(sp(kw.line, kw.col, "Empty IF/WHILE condition"));
        return;
    }
    let mut idx = 0;
    if let Err(e) = validate_pratt_expr(cond, src, &mut idx, 0, &[]) {
        errs.push(e);
    } else if idx < cond.len() {
        errs.push(sp(
            cond[idx].line,
            cond[idx].col,
            format!("Unexpected token '{}' in IF/WHILE condition", cond[idx].slice(src)),
        ));
    } else {
        validate_expr_subqueries(cond, src, errs);
    }
}
