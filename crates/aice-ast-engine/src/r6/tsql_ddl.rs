use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
use crate::r6::sql_pratt::validate_pratt_expr;
use crate::r6::tsql_ctbl::validate_ctbl_tail;
use crate::r6::tsql_dml::{consume_dml_target, validate_col_list};
use crate::r6::tsql_query::{is_tsql_ident_tok, validate_fk_constraint, validate_key_constraint};
use crate::r6::tsql_stmt::{matching_rparen, split_comma_top};
use crate::r6::tsql_with::validate_tsql_query_only;

const COL_CONSTRAINT_KWS: &[&str] = &[
    "NULL", "NOT", "PRIMARY", "KEY", "UNIQUE", "IDENTITY", "DEFAULT",
    "CHECK", "REFERENCES", "CONSTRAINT", "COLLATE", "ROWGUIDCOL",
    "SPARSE", "FILESTREAM", "MASKED", "GENERATED", "HIDDEN", "ENCRYPTED",
    "WITH", "ON", "CLUSTERED", "NONCLUSTERED", "PERSISTED", "FOREIGN",
    "FOR", "REPLICATION", "ACTION", "CASCADE", "NO", "SET", "ASC", "DESC",
];

const TBL_CONSTRAINT_KWS: &[&str] = &[
    "CONSTRAINT", "PRIMARY", "UNIQUE", "CHECK", "FOREIGN", "INDEX", "PERIOD",
];

pub(crate) fn validate_tsql_view(
    stmt: &[SqlTok], view_i: usize, src: &str, errs: &mut Vec<ErrorSpan>,
) -> Option<usize> {
    let mut i = view_i + 1;
    let Some(first) = stmt.get(i).filter(|t| is_tsql_ident_tok(t) && !t.ident_name(src).is_empty() && !t.is_kw(src, "AS") && !t.is_kw(src, "WITH")) else {
        let a = stmt.get(i).unwrap_or(&stmt[view_i]);
        errs.push(sp(a.line, a.col, "Expected view name in T-SQL VIEW definition"));
        return None;
    };
    let _ = first;
    i += 1;
    while stmt.get(i).is_some_and(|t| t.kind == SqlTokKind::Dot) {
        let dot = &stmt[i];
        i += 1;
        if !stmt.get(i).is_some_and(|t| is_tsql_ident_tok(t) && !t.ident_name(src).is_empty()) {
            let a = stmt.get(i).unwrap_or(dot);
            errs.push(sp(a.line, a.col, "Expected identifier after '.' in T-SQL VIEW name"));
            return None;
        }
        i += 1;
    }
    if stmt.get(i).is_some_and(|t| t.kind == SqlTokKind::LParen) {
        let rp = matching_rparen(stmt, i)?;
        if !validate_col_list(&stmt[i + 1..rp], &stmt[i], "VIEW", src, errs) { return None; }
        i = rp + 1;
    }
    if stmt.get(i).is_some_and(|t| t.is_kw(src, "WITH")) {
        i += 1;
        loop {
            if !stmt.get(i).is_some_and(|t| {
                t.is_kw(src, "ENCRYPTION") || t.is_kw(src, "SCHEMABINDING") || t.is_kw(src, "VIEW_METADATA")
            }) {
                let a = stmt.get(i).unwrap_or(&stmt[i - 1]);
                errs.push(sp(a.line, a.col, "Invalid view attribute after WITH in T-SQL VIEW"));
                return None;
            }
            i += 1;
            if stmt.get(i).is_some_and(|t| t.kind == SqlTokKind::Comma) { i += 1; } else { break; }
        }
    }
    if !stmt.get(i).is_some_and(|t| t.is_kw(src, "AS")) {
        let a = stmt.get(i).unwrap_or(&stmt[i.saturating_sub(1)]);
        errs.push(sp(a.line, a.col, "Expected AS in T-SQL VIEW definition"));
        return None;
    }
    i += 1;
    let body_end = if stmt.len() >= i + 3
        && stmt[stmt.len() - 3].is_kw(src, "WITH")
        && stmt[stmt.len() - 2].is_kw(src, "CHECK")
        && stmt[stmt.len() - 1].is_kw(src, "OPTION")
    { stmt.len() - 3 } else { stmt.len() };
    if i >= body_end
        || !(stmt[i].is_kw(src, "WITH") || stmt[i].is_kw(src, "SELECT") || stmt[i].kind == SqlTokKind::LParen)
    {
        let a = stmt.get(i).unwrap_or(&stmt[i - 1]);
        errs.push(sp(a.line, a.col, "Expected SELECT or WITH query after AS in T-SQL VIEW"));
        return None;
    }
    validate_tsql_query_only(&stmt[i..body_end], src, errs);
    Some(body_end)
}

pub(crate) fn validate_tsql_create_table(stmt: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    if stmt.get(2).is_some_and(|t| t.kind == SqlTokKind::Var) {
        errs.push(sp(stmt[2].line, stmt[2].col, "Invalid table name in CREATE TABLE"));
        return;
    }
    let Some(i) = consume_dml_target(stmt, 2, "CREATE TABLE", src, errs) else { return; };
    if stmt.get(i).is_some_and(|t| t.is_kw(src, "AS")) {
        let next = stmt.get(i + 1);
        if next.is_some_and(|t| t.is_kw(src, "FILETABLE") || t.is_kw(src, "NODE") || t.is_kw(src, "EDGE")) {
            validate_ctbl_tail(&stmt[i + 2..], false, src, errs);
        } else if next.is_some_and(|t| t.is_kw(src, "SELECT") || t.is_kw(src, "WITH") || t.kind == SqlTokKind::LParen) {
            validate_tsql_query_only(&stmt[i + 1..], src, errs);
        } else {
            let a = next.unwrap_or(&stmt[i]);
            errs.push(sp(a.line, a.col, "Invalid AS clause in CREATE TABLE"));
        }
        return;
    }
    if !stmt.get(i).is_some_and(|t| t.kind == SqlTokKind::LParen) {
        let a = stmt.get(i).unwrap_or(&stmt[i - 1]);
        errs.push(sp(a.line, a.col, "Expected '(' or AS in CREATE TABLE"));
        return;
    }
    let lp = i;
    let Some(rp) = matching_rparen(stmt, lp) else { return; };
    if rp == lp + 1 {
        errs.push(sp(stmt[lp].line, stmt[lp].col, "Empty column definition list '()' in CREATE TABLE"));
        return;
    }
    for item in split_comma_top(&stmt[lp + 1..rp]) {
        if item.is_empty() {
            errs.push(sp(stmt[lp].line, stmt[lp].col, "Empty column definition in CREATE TABLE"));
            continue;
        }
        if TBL_CONSTRAINT_KWS.iter().any(|k| item[0].is_kw(src, k)) {
            validate_tbl_constraint(item, src, errs);
            continue;
        }
        if item.len() < 2 {
            errs.push(sp(item[0].line, item[0].col, "Column missing data type in CREATE TABLE"));
            continue;
        }
        let mut j = 1usize;
        if item[j].is_kw(src, "AS") {
            j += 1;
            if item.get(j).is_some_and(|t| t.kind == SqlTokKind::LParen) {
                let Some(next_j) = validate_paren_expr(item, j, "computed column", src, errs) else { continue; };
                j = next_j;
            } else {
                let a = item.get(j).unwrap_or(&item[j - 1]);
                errs.push(sp(a.line, a.col, "Expected '(' after AS in computed column"));
                continue;
            }
        } else {
            j += 1;
            while item.get(j).is_some_and(|t| t.kind == SqlTokKind::Dot) { j += 2.min(item.len() - j); }
            if item.get(j).is_some_and(|t| t.is_kw(src, "VARYING") || t.is_kw(src, "PRECISION")) { j += 1; }
            if item.get(j).is_some_and(|t| t.kind == SqlTokKind::LParen) {
                j = matching_rparen(item, j).map_or(item.len(), |r| r + 1);
            }
        }
        while j < item.len() {
            let t = &item[j];
            if t.kind == SqlTokKind::LParen {
                let rp = matching_rparen(item, j);
                if j > 0 && item[j - 1].is_kw(src, "WITH") && rp == Some(j + 1) {
                    errs.push(sp(t.line, t.col, "Empty '()' in WITH options"));
                    break;
                }
                j = rp.map_or(item.len(), |r| r + 1);
            } else if t.is_kw(src, "CONSTRAINT") || t.is_kw(src, "COLLATE") {
                j += 2.min(item.len() - j);
            } else if t.is_kw(src, "DEFAULT") {
                let Some(next_j) = validate_default(item, j, COL_CONSTRAINT_KWS, src, errs) else { break; };
                j = next_j;
            } else if t.is_kw(src, "CHECK") {
                let Some(next_j) = validate_check(item, j, src, errs) else { break; };
                j = next_j;
            } else if t.is_kw(src, "REFERENCES") {
                j += 2.min(item.len() - j);
                while item.get(j).is_some_and(|n| n.kind == SqlTokKind::Dot) { j += 2.min(item.len() - j); }
            } else if t.is_kw(src, "ON") {
                if item.get(j + 1).is_some_and(|n| n.is_kw(src, "DELETE") || n.is_kw(src, "UPDATE")) {
                    j += 2;
                    if item.get(j).is_some_and(|n| n.is_kw(src, "SET"))
                        && item.get(j + 1).is_some_and(|n| n.is_kw(src, "DEFAULT") || n.is_kw(src, "NULL"))
                    {
                        j += 2;
                    }
                } else if item.get(j + 1).is_some_and(|n| {
                    matches!(n.kind, SqlTokKind::Word | SqlTokKind::BracketIdent | SqlTokKind::QuotedIdent | SqlTokKind::StringLit)
                }) {
                    j += 2;
                } else {
                    errs.push(sp(t.line, t.col, "Expected filegroup or DELETE/UPDATE after ON in CREATE TABLE"));
                    break;
                }
            } else if t.is_kw(src, "GENERATED") {
                j += 1;
                while j < item.len() && !COL_CONSTRAINT_KWS.iter().any(|k| item[j].is_kw(src, k)) { j += 1; }
            } else if COL_CONSTRAINT_KWS.iter().any(|k| t.is_kw(src, k)) {
                j += 1;
            } else {
                errs.push(sp(t.line, t.col, format!("Expected ',' before '{}' in CREATE TABLE", t.slice(src))));
                break;
            }
        }
    }
    validate_ctbl_tail(&stmt[rp + 1..], true, src, errs);
}

fn validate_check(item: &[SqlTok], mut j: usize, src: &str, errs: &mut Vec<ErrorSpan>) -> Option<usize> {
    let t = &item[j];
    j += 1;
    if item.get(j).is_some_and(|n| n.is_kw(src, "NOT"))
        && item.get(j + 1).is_some_and(|n| n.is_kw(src, "FOR"))
        && item.get(j + 2).is_some_and(|n| n.is_kw(src, "REPLICATION"))
    {
        j += 3;
    }
    if item.get(j).is_some_and(|n| n.kind == SqlTokKind::LParen) {
        validate_paren_expr(item, j, "CHECK constraint", src, errs)
    } else {
        errs.push(sp(t.line, t.col, "Expected '(' after CHECK"));
        None
    }
}

fn validate_default(
    item: &[SqlTok], j: usize, stops: &[&str], src: &str, errs: &mut Vec<ErrorSpan>,
) -> Option<usize> {
    let j = j + 1;
    if item.get(j).is_some_and(|n| n.kind == SqlTokKind::LParen) {
        return validate_paren_expr(item, j, "DEFAULT constraint", src, errs);
    }
    if item.get(j).is_some_and(|n| n.is_kw(src, "NULL")) {
        return Some(j + 1);
    }
    let mut idx = j;
    validate_pratt_expr(item, src, &mut idx, 0, stops).map(|()| idx).map_err(|e| errs.push(e)).ok()
}

fn validate_tbl_constraint(item: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    let j = if item[0].is_kw(src, "CONSTRAINT") {
        if item.len() < 3 || !is_tsql_ident_tok(&item[1]) {
            errs.push(sp(item[0].line, item[0].col, "Incomplete CONSTRAINT definition"));
            return;
        }
        2
    } else {
        0
    };
    if item[j].is_kw(src, "CHECK") {
        if let Some(next_j) = validate_check(item, j, src, errs) && next_j < item.len() {
            errs.push(sp(item[next_j].line, item[next_j].col, "Unexpected token after CHECK constraint"));
        }
    } else if item[j].is_kw(src, "DEFAULT") {
        if let Some(next_j) = validate_default(item, j, &["FOR", "WITH"], src, errs) {
            if next_j >= item.len() {
                errs.push(sp(item[j].line, item[j].col, "Expected FOR <column> in table-level DEFAULT constraint"));
            } else if !item[next_j].is_kw(src, "FOR") {
                errs.push(sp(item[next_j].line, item[next_j].col, "Unexpected token in DEFAULT constraint"));
            } else if !item.get(next_j + 1).is_some_and(is_tsql_ident_tok) {
                errs.push(sp(item[next_j].line, item[next_j].col, "Expected column name after FOR in DEFAULT constraint"));
            } else if next_j + 2 < item.len() {
                errs.push(sp(item[next_j + 2].line, item[next_j + 2].col, "Unexpected token after DEFAULT constraint"));
            }
        }
    } else if item[j].is_kw(src, "PRIMARY") || item[j].is_kw(src, "UNIQUE") {
        validate_key_constraint(item, j, src, errs);
    } else if item[j].is_kw(src, "FOREIGN") {
        validate_fk_constraint(item, j, src, errs);
    } else if !item[j].is_kw(src, "INDEX") && !item[j].is_kw(src, "PERIOD") {
        errs.push(sp(item[j].line, item[j].col, format!("Invalid table constraint '{}'", item[j].slice(src))));
    }
}

fn validate_paren_expr(
    item: &[SqlTok], lp: usize, ctx: &str, src: &str, errs: &mut Vec<ErrorSpan>,
) -> Option<usize> {
    let rp = matching_rparen(item, lp)?;
    if rp == lp + 1 {
        errs.push(sp(item[lp].line, item[lp].col, format!("Empty '()' in {ctx}")));
        return None;
    }
    let inner = &item[lp + 1..rp];
    let mut idx = 0;
    if let Err(e) = validate_pratt_expr(inner, src, &mut idx, 0, &[]) { errs.push(e); return None; }
    if idx < inner.len() {
        errs.push(sp(inner[idx].line, inner[idx].col, format!("Unexpected token '{}' in {ctx}", inner[idx].slice(src))));
        return None;
    }
    Some(rp + 1)
}
