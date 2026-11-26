use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
use crate::r6::sql_pratt::validate_pratt_expr_rp;

fn is_set_op(tok: Option<&SqlTok>, in_bounds: bool, src: &str) -> bool {
    in_bounds && tok.is_some_and(|t| t.is_kw(src, "UNION") || t.is_kw(src, "INTERSECT") || t.is_kw(src, "EXCEPT"))
}

pub(crate) fn validate_query_tail(
    stmt: &[SqlTok], mut k: usize, b_hi: usize, match_rp: &[usize],
    src: &str, errs: &mut Vec<ErrorSpan>,
) {
    if k < b_hi && stmt[k].is_kw(src, "ORDER") {
        let ord = &stmt[k];
        if k + 1 >= b_hi || !stmt[k + 1].is_kw(src, "BY") {
            errs.push(sp(ord.line, ord.col, "Expected BY after ORDER in T-SQL query"));
            return;
        }
        k += 2;
        loop {
            if k >= b_hi {
                errs.push(sp(ord.line, ord.col, "Incomplete ORDER BY clause in T-SQL query"));
                return;
            }
            let mut sub_idx = 0;
            let stops = &["ASC", "DESC", "OFFSET", "FOR", "OPTION", "UNION", "INTERSECT", "EXCEPT"];
            if let Err(e) = validate_pratt_expr_rp(&stmt[k..b_hi], src, &mut sub_idx, 0, stops, Some((match_rp, k))) {
                errs.push(e);
                return;
            }
            k += sub_idx;
            if k < b_hi && (stmt[k].is_kw(src, "ASC") || stmt[k].is_kw(src, "DESC")) { k += 1; }
            if k < b_hi && stmt[k].kind == SqlTokKind::Comma { k += 1; } else { break; }
        }
        if is_set_op(stmt.get(k), k < b_hi, src) {
            errs.push(sp(ord.line, ord.col, "ORDER BY is not allowed before set operator in T-SQL CTE/query"));
            return;
        }
        if k < b_hi && stmt[k].is_kw(src, "OFFSET") {
            k += 1;
            let mut sub_idx = 0;
            if let Err(e) = validate_pratt_expr_rp(&stmt[k..b_hi], src, &mut sub_idx, 0, &["ROW", "ROWS"], Some((match_rp, k))) {
                errs.push(e);
                return;
            }
            k += sub_idx;
            if k >= b_hi || !(stmt[k].is_kw(src, "ROW") || stmt[k].is_kw(src, "ROWS")) {
                let a = if k < b_hi { &stmt[k] } else { &stmt[k - 1] };
                errs.push(sp(a.line, a.col, "Expected ROW or ROWS after OFFSET expression"));
                return;
            }
            k += 1;
            if k < b_hi && stmt[k].is_kw(src, "FETCH") {
                k += 1;
                if k >= b_hi || !(stmt[k].is_kw(src, "FIRST") || stmt[k].is_kw(src, "NEXT")) {
                    let a = if k < b_hi { &stmt[k] } else { &stmt[k - 1] };
                    errs.push(sp(a.line, a.col, "Expected FIRST or NEXT after FETCH"));
                    return;
                }
                k += 1;
                let mut f_idx = 0;
                if let Err(e) = validate_pratt_expr_rp(&stmt[k..b_hi], src, &mut f_idx, 0, &["ROW", "ROWS"], Some((match_rp, k))) {
                    errs.push(e);
                    return;
                }
                k += f_idx;
                if k >= b_hi || !(stmt[k].is_kw(src, "ROW") || stmt[k].is_kw(src, "ROWS")) {
                    let a = if k < b_hi { &stmt[k] } else { &stmt[k - 1] };
                    errs.push(sp(a.line, a.col, "Expected ROW or ROWS after FETCH expression"));
                    return;
                }
                k += 1;
                if k >= b_hi || !stmt[k].is_kw(src, "ONLY") {
                    let a = if k < b_hi { &stmt[k] } else { &stmt[k - 1] };
                    errs.push(sp(a.line, a.col, "Expected ONLY in FETCH clause"));
                    return;
                }
                k += 1;
            }
            if is_set_op(stmt.get(k), k < b_hi, src) {
                errs.push(sp(ord.line, ord.col, "ORDER BY is not allowed before set operator in T-SQL CTE/query"));
                return;
            }
        }
    }
    if k < b_hi && stmt[k].is_kw(src, "FOR") {
        let Some(next_k) = consume_for_clause(stmt, k, b_hi, match_rp, src, errs) else { return; };
        k = next_k;
    }
    if k < b_hi && stmt[k].is_kw(src, "OPTION") {
        if k + 1 >= b_hi || stmt[k + 1].kind != SqlTokKind::LParen {
            errs.push(sp(stmt[k].line, stmt[k].col, "Expected '(' after OPTION in T-SQL query"));
            return;
        }
        let rp = match_rp[k + 1];
        if rp >= b_hi { return; }
        if rp == k + 2 {
            errs.push(sp(stmt[k + 1].line, stmt[k + 1].col, "Empty '()' in OPTION clause"));
            return;
        }
        k = rp + 1;
    }
    if k < b_hi {
        if stmt[k].kind == SqlTokKind::Semi {
            errs.push(sp(stmt[k].line, stmt[k].col, "Unexpected ';' inside T-SQL CTE/query"));
        } else {
            errs.push(sp(stmt[k].line, stmt[k].col, format!("Unexpected token '{}' in T-SQL query tail", stmt[k].slice(src))));
        }
    }
}

fn consume_for_clause(
    stmt: &[SqlTok], mut k: usize, b_hi: usize, match_rp: &[usize],
    src: &str, errs: &mut Vec<ErrorSpan>,
) -> Option<usize> {
    let ftok = &stmt[k];
    k += 1;
    if k >= b_hi {
        errs.push(sp(ftok.line, ftok.col, "Incomplete FOR clause in T-SQL query"));
        return None;
    }
    if stmt[k].is_kw(src, "BROWSE") { return Some(k + 1); }
    if stmt[k].is_kw(src, "XML") {
        k += 1;
        if k >= b_hi || !(stmt[k].is_kw(src, "RAW") || stmt[k].is_kw(src, "AUTO")
            || stmt[k].is_kw(src, "EXPLICIT") || stmt[k].is_kw(src, "PATH"))
        {
            let a = if k < b_hi { &stmt[k] } else { ftok };
            errs.push(sp(a.line, a.col, "Invalid FOR XML mode in T-SQL query"));
            return None;
        }
        let has_arg = stmt[k].is_kw(src, "RAW") || stmt[k].is_kw(src, "PATH");
        k += 1;
        if has_arg && k < b_hi && stmt[k].kind == SqlTokKind::LParen {
            let rp = match_rp[k];
            if rp >= b_hi { return None; }
            if rp == k + 1 {
                errs.push(sp(stmt[k].line, stmt[k].col, "Empty '()' in FOR XML mode"));
                return None;
            }
            k = rp + 1;
        }
        while k < b_hi && stmt[k].kind == SqlTokKind::Comma {
            k += 1;
            if k < b_hi && stmt[k].is_kw(src, "BINARY") && k + 1 < b_hi && stmt[k + 1].is_kw(src, "BASE64") {
                k += 2;
            } else if k < b_hi && (stmt[k].is_kw(src, "TYPE") || stmt[k].is_kw(src, "XMLDATA")) {
                k += 1;
            } else if k < b_hi && stmt[k].is_kw(src, "ELEMENTS") {
                k += 1;
                if k < b_hi && (stmt[k].is_kw(src, "XSINIL") || stmt[k].is_kw(src, "ABSENT")) { k += 1; }
            } else if k < b_hi && (stmt[k].is_kw(src, "ROOT") || stmt[k].is_kw(src, "XMLSCHEMA")) {
                k += 1;
                if k < b_hi && stmt[k].kind == SqlTokKind::LParen {
                    let rp = match_rp[k];
                    if rp >= b_hi { return None; }
                    if rp != k + 2 || stmt[k + 1].kind != SqlTokKind::StringLit {
                        errs.push(sp(stmt[k].line, stmt[k].col, "Expected string literal in FOR XML option"));
                        return None;
                    }
                    k = rp + 1;
                }
            } else {
                let a = if k < b_hi { &stmt[k] } else { &stmt[k - 1] };
                errs.push(sp(a.line, a.col, "Invalid FOR XML option"));
                return None;
            }
        }
        return Some(k);
    }
    if stmt[k].is_kw(src, "JSON") {
        k += 1;
        if k >= b_hi || !(stmt[k].is_kw(src, "AUTO") || stmt[k].is_kw(src, "PATH")) {
            let a = if k < b_hi { &stmt[k] } else { ftok };
            errs.push(sp(a.line, a.col, "Expected AUTO or PATH after FOR JSON"));
            return None;
        }
        k += 1;
        while k < b_hi && stmt[k].kind == SqlTokKind::Comma {
            k += 1;
            if k < b_hi && (stmt[k].is_kw(src, "INCLUDE_NULL_VALUES") || stmt[k].is_kw(src, "WITHOUT_ARRAY_WRAPPER")) {
                k += 1;
            } else if k < b_hi && stmt[k].is_kw(src, "ROOT") {
                k += 1;
                if k < b_hi && stmt[k].kind == SqlTokKind::LParen {
                    let rp = match_rp[k];
                    if rp >= b_hi { return None; }
                    if rp != k + 2 || stmt[k + 1].kind != SqlTokKind::StringLit {
                        errs.push(sp(stmt[k].line, stmt[k].col, "Expected string literal in FOR JSON ROOT"));
                        return None;
                    }
                    k = rp + 1;
                }
            } else {
                let a = if k < b_hi { &stmt[k] } else { &stmt[k - 1] };
                errs.push(sp(a.line, a.col, "Invalid FOR JSON option"));
                return None;
            }
        }
        return Some(k);
    }
    errs.push(sp(ftok.line, ftok.col, "Expected XML, JSON, or BROWSE after FOR in T-SQL query"));
    None
}
