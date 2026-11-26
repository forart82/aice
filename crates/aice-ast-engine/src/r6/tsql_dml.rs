use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
use crate::r6::sql_pratt::validate_pratt_expr;
use crate::r6::tsql_dml_ops::{validate_delete, validate_insert, validate_merge, validate_update};
use crate::r6::tsql_query::is_tsql_ident_tok;
use crate::r6::tsql_stmt::{matching_rparen, split_comma_top};

const DML_KW_FORBIDDEN: &[&str] = &[
    "SELECT", "INSERT", "UPDATE", "DELETE", "MERGE", "WITH", "FROM", "WHERE", "SET", "VALUES",
    "INTO", "USING", "ON", "WHEN", "THEN", "ELSE", "END", "BEGIN", "CREATE", "ALTER", "DROP",
    "EXEC", "EXECUTE", "OUTPUT", "OPTION", "DEFAULT", "TOP", "PERCENT", "AS", "AND", "OR", "NOT",
    "NULL", "TRUE", "FALSE", "JOIN", "GROUP", "HAVING", "ORDER", "UNION", "INTERSECT", "EXCEPT",
    "CASE", "IF", "WHILE", "RETURN", "THROW", "GO",
];

pub(crate) fn validate_tsql_dml(stmt: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    if stmt[0].is_kw(src, "INSERT") { validate_insert(stmt, src, errs); }
    else if stmt[0].is_kw(src, "UPDATE") { validate_update(stmt, src, errs); }
    else if stmt[0].is_kw(src, "DELETE") { validate_delete(stmt, src, errs); }
    else if stmt[0].is_kw(src, "MERGE") { validate_merge(stmt, src, errs); }
}

pub(super) fn is_dml_ident(t: &SqlTok, src: &str) -> bool {
    match t.kind {
        SqlTokKind::QuotedIdent | SqlTokKind::BracketIdent => !t.ident_name(src).is_empty(),
        SqlTokKind::Word => !DML_KW_FORBIDDEN.iter().any(|k| t.is_kw(src, k)),
        _ => false,
    }
}

fn consume_temp_ident(stmt: &[SqlTok], mut i: usize, src: &str) -> Option<usize> {
    if !stmt.get(i).is_some_and(|t| t.is_op(src, "#")) { return None; }
    i += 1;
    if stmt.get(i).is_some_and(|t| t.is_op(src, "#")) { i += 1; }
    stmt.get(i).is_some_and(|t| t.kind == SqlTokKind::Word).then_some(i + 1)
}

pub(crate) fn consume_dml_target(stmt: &[SqlTok], mut i: usize, kw: &str, src: &str, errs: &mut Vec<ErrorSpan>) -> Option<usize> {
    let Some(first) = stmt.get(i) else {
        let a = &stmt[i.saturating_sub(1)];
        errs.push(sp(a.line, a.col, format!("Expected target table in T-SQL {kw}")));
        return None;
    };
    if first.kind == SqlTokKind::Var {
        if first.slice(src).starts_with("@@") || first.slice(src).len() <= 1 {
            errs.push(sp(first.line, first.col, format!("Invalid target variable in T-SQL {kw}")));
            return None;
        }
        return Some(i + 1);
    }
    if let Some(next_i) = consume_temp_ident(stmt, i, src) {
        i = next_i;
    } else if is_dml_ident(first, src) {
        i += 1;
    } else {
        errs.push(sp(first.line, first.col, format!("Invalid target '{}' in T-SQL {kw}", first.slice(src))));
        return None;
    }
    while stmt.get(i).is_some_and(|t| t.kind == SqlTokKind::Dot) {
        let dot = &stmt[i];
        i += 1;
        if stmt.get(i).is_some_and(|t| t.kind == SqlTokKind::Dot) { i += 1; }
        if let Some(next_i) = consume_temp_ident(stmt, i, src) {
            i = next_i;
            continue;
        }
        let Some(part) = stmt.get(i).filter(|t| is_tsql_ident_tok(t) && !t.ident_name(src).is_empty()) else {
            let a = stmt.get(i).unwrap_or(dot);
            errs.push(sp(a.line, a.col, format!("Expected identifier after '.' in T-SQL {kw}")));
            return None;
        };
        i += 1;
        let _ = part;
    }
    Some(i)
}

pub(super) fn consume_top(stmt: &[SqlTok], mut i: usize, kw: &str, src: &str, errs: &mut Vec<ErrorSpan>) -> Option<usize> {
    if !stmt.get(i).is_some_and(|t| t.is_kw(src, "TOP")) { return Some(i); }
    let top_tok = &stmt[i];
    i += 1;
    if stmt.get(i).is_some_and(|t| t.kind == SqlTokKind::LParen) {
        let rp = matching_rparen(stmt, i)?;
        if rp == i + 1 {
            errs.push(sp(stmt[i].line, stmt[i].col, format!("Empty '()' in TOP clause of T-SQL {kw}")));
            return None;
        }
        let inner = &stmt[i + 1..rp];
        let mut idx = 0;
        if let Err(e) = validate_pratt_expr(inner, src, &mut idx, 0, &[]) { errs.push(e); return None; }
        if idx < inner.len() {
            errs.push(sp(inner[idx].line, inner[idx].col, format!("Unexpected token '{}' in TOP clause", inner[idx].slice(src))));
            return None;
        }
        i = rp + 1;
    } else if stmt.get(i).is_some_and(|t| matches!(t.kind, SqlTokKind::Number | SqlTokKind::Var)) {
        i += 1;
    } else {
        let a = stmt.get(i).unwrap_or(top_tok);
        errs.push(sp(a.line, a.col, format!("Expected TOP expression in T-SQL {kw}")));
        return None;
    }
    if stmt.get(i).is_some_and(|t| t.is_kw(src, "PERCENT")) { i += 1; }
    Some(i)
}

fn consume_paren_opt(stmt: &[SqlTok], i: usize, label: &str, errs: &mut Vec<ErrorSpan>) -> Option<usize> {
    let rp = matching_rparen(stmt, i)?;
    if rp == i + 1 {
        errs.push(sp(stmt[i].line, stmt[i].col, format!("Empty '()' in {label}")));
        return None;
    }
    Some(rp + 1)
}

pub(super) fn consume_with_hint(stmt: &[SqlTok], i: usize, src: &str, errs: &mut Vec<ErrorSpan>) -> Option<usize> {
    if stmt.get(i).is_some_and(|t| t.is_kw(src, "WITH"))
        && stmt.get(i + 1).is_some_and(|t| t.kind == SqlTokKind::LParen)
    {
        consume_paren_opt(stmt, i + 1, "WITH table hint", errs)
    } else {
        Some(i)
    }
}

pub(crate) fn validate_col_list(cols: &[SqlTok], lp: &SqlTok, kw: &str, src: &str, errs: &mut Vec<ErrorSpan>) -> bool {
    if cols.is_empty() {
        errs.push(sp(lp.line, lp.col, format!("Empty column list '()' in T-SQL {kw}")));
        return false;
    }
    let mut k = 0usize;
    while k < cols.len() {
        if !is_tsql_ident_tok(&cols[k]) || cols[k].ident_name(src).is_empty() {
            errs.push(sp(cols[k].line, cols[k].col, format!("Invalid column '{}' in T-SQL {kw}", cols[k].slice(src))));
            return false;
        }
        k += 1;
        if k < cols.len() {
            if cols[k].kind != SqlTokKind::Comma {
                errs.push(sp(cols[k].line, cols[k].col, format!("Expected ',' before '{}' in {kw} columns", cols[k].slice(src))));
                return false;
            }
            k += 1;
            if k == cols.len() {
                errs.push(sp(cols[k - 1].line, cols[k - 1].col, format!("Trailing ',' in {kw} column list")));
                return false;
            }
        }
    }
    true
}

pub(super) fn scan_clause(stmt: &[SqlTok], mut i: usize, src: &str, stops: &[&str]) -> usize {
    let (mut d, mut cases) = (0usize, 0usize);
    while i < stmt.len() {
        let t = &stmt[i];
        let not_dot = i == 0 || stmt[i - 1].kind != SqlTokKind::Dot;
        if t.kind == SqlTokKind::LParen { d += 1; }
        else if t.kind == SqlTokKind::RParen { d = d.saturating_sub(1); }
        else if d == 0 && not_dot && t.is_kw(src, "CASE") { cases += 1; }
        else if d == 0 && not_dot && t.is_kw(src, "END") && cases > 0 { cases -= 1; }
        else if d == 0 && cases == 0 && not_dot && stops.iter().any(|k| t.is_kw(src, k)) { break; }
        i += 1;
    }
    i
}

pub(super) use crate::r6::tsql_output::consume_output;

pub(super) fn consume_option(stmt: &[SqlTok], i: usize, kw: &str, src: &str, errs: &mut Vec<ErrorSpan>) -> Option<usize> {
    if !stmt.get(i).is_some_and(|t| t.is_kw(src, "OPTION")) { return Some(i); }
    if !stmt.get(i + 1).is_some_and(|t| t.kind == SqlTokKind::LParen) {
        errs.push(sp(stmt[i].line, stmt[i].col, format!("Expected '(' after OPTION in T-SQL {kw}")));
        return None;
    }
    consume_paren_opt(stmt, i + 1, "OPTION clause", errs)
}

pub(super) fn validate_set_items(set_slice: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) -> bool {
    if set_slice.is_empty() { return false; }
    for item in split_comma_top(set_slice) {
        if item.is_empty() {
            errs.push(sp(set_slice[0].line, set_slice[0].col, "Empty assignment in T-SQL UPDATE SET"));
            return false;
        }
        let mut d = 0usize;
        let mut op_pos: Option<(usize, usize)> = None;
        for j in 0..item.len() {
            if item[j].kind == SqlTokKind::LParen { d += 1; }
            else if item[j].kind == SqlTokKind::RParen { d = d.saturating_sub(1); }
            else if d == 0 && item[j].kind == SqlTokKind::Op {
                if matches!(item[j].slice(src), "=" | "+=" | "-=" | "*=" | "/=") {
                    op_pos = Some((j, j + 1));
                    break;
                }
                if matches!(item[j].slice(src), "%" | "&" | "^" | "|")
                    && item.get(j + 1).is_some_and(|n| n.is_op(src, "="))
                {
                    op_pos = Some((j, j + 2));
                    break;
                }
            }
        }
        let Some((lhs_end, rhs_start)) = op_pos else {
            let ok_method = consume_dml_target(item, 0, "UPDATE", src, &mut Vec::new())
                .is_some_and(|p| {
                    p < item.len()
                        && item[..p].iter().any(|t| t.kind == SqlTokKind::Dot)
                        && item[p].kind == SqlTokKind::LParen
                        && matching_rparen(item, p) == Some(item.len() - 1)
                });
            if !ok_method {
                errs.push(sp(item[0].line, item[0].col, "Expected assignment in T-SQL UPDATE SET"));
                return false;
            }
            continue;
        };
        if lhs_end == 0 || consume_dml_target(&item[..lhs_end], 0, "UPDATE", src, errs) != Some(lhs_end) {
            if lhs_end == 0 { errs.push(sp(item[0].line, item[0].col, "Missing target before '=' in SET")); }
            return false;
        }
        let rhs = &item[rhs_start..];
        if rhs.is_empty() {
            errs.push(sp(item[lhs_end].line, item[lhs_end].col, "Missing expression after assignment operator in T-SQL UPDATE SET"));
            return false;
        }
        let mut idx = 0;
        if let Err(e) = validate_pratt_expr(rhs, src, &mut idx, 0, &[]) { errs.push(e); return false; }
        if idx < rhs.len() {
            errs.push(sp(rhs[idx].line, rhs[idx].col, format!("Unexpected token '{}' in UPDATE SET", rhs[idx].slice(src))));
            return false;
        }
    }
    true
}
