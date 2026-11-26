use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
use crate::r6::tsql_dml::validate_tsql_dml;
use crate::r6::tsql_dml_from::validate_tsql_from_slice;
use crate::r6::tsql_paren::{
    build_paren_maps, build_query_lp_map, find_select_from_end, is_is_distinct_from,
    paren_query_span, push_subqueries,
};
pub(crate) use crate::r6::tsql_paren::is_tsql_cte_ident;
use crate::r6::tsql_tail::validate_query_tail;

pub(crate) fn validate_tsql_with(stmt: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    validate_tsql_with_mode(stmt, src, true, errs);
}

pub(crate) fn validate_tsql_query_only(stmt: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    validate_tsql_with_mode(stmt, src, false, errs);
}

pub(crate) fn validate_tsql_with_mode(
    stmt: &[SqlTok], src: &str, allow_root_dml: bool, errs: &mut Vec<ErrorSpan>,
) {
    let (match_rp, next_non_lp) = build_paren_maps(stmt);
    let next_lp_q = build_query_lp_map(stmt, &next_non_lp, src);
    let work = vec![(0usize, stmt.len(), allow_root_dml)];
    run_with_work(stmt, &match_rp, &next_non_lp, &next_lp_q, work, src, errs);
}

pub(crate) fn validate_tsql_embedded_queries(
    stmt: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>,
) {
    if !stmt.windows(2).any(|w| {
        w[0].kind == SqlTokKind::LParen && (w[1].is_kw(src, "SELECT") || w[1].is_kw(src, "WITH"))
    }) {
        return;
    }
    let (match_rp, next_non_lp) = build_paren_maps(stmt);
    let next_lp_q = build_query_lp_map(stmt, &next_non_lp, src);
    let mut work = Vec::new();
    push_subqueries(0, stmt.len(), stmt, &match_rp, &next_non_lp, &next_lp_q, src, &mut work);
    if !work.is_empty() {
        run_with_work(stmt, &match_rp, &next_non_lp, &next_lp_q, work, src, errs);
    }
}

fn run_with_work(
    stmt: &[SqlTok], match_rp: &[usize], next_non_lp: &[usize], next_lp_q: &[usize],
    mut work: Vec<(usize, usize, bool)>, src: &str, errs: &mut Vec<ErrorSpan>,
) {
    'outer: while let Some((mut lo, mut hi, mut can_dml)) = work.pop() {
        while lo < hi && stmt[lo].kind == SqlTokKind::LParen && match_rp[lo] == hi - 1 {
            lo += 1;
            hi -= 1;
            can_dml = false;
        }
        if lo >= hi {
            let a = &stmt[lo.saturating_sub(1)];
            errs.push(sp(a.line, a.col, "Empty query body in T-SQL WITH"));
            continue;
        }
        if stmt[lo].is_kw(src, "WITH") {
            let mut i = lo + 1;
            if i < hi && stmt[i].is_kw(src, "XMLNAMESPACES") && i + 1 < hi && stmt[i + 1].kind == SqlTokKind::LParen {
                let rp = match_rp[i + 1];
                if rp >= hi { continue; }
                if rp == i + 2 {
                    errs.push(sp(stmt[i + 1].line, stmt[i + 1].col, "Empty '()' in WITH XMLNAMESPACES"));
                    continue;
                }
                i = rp + 1;
                if i < hi && stmt[i].kind == SqlTokKind::Comma {
                    i += 1;
                } else {
                    validate_with_main(stmt, i, hi, can_dml, src, &mut work, errs);
                    continue;
                }
            }
            loop {
                if i >= hi || !is_tsql_cte_ident(&stmt[i], src) {
                    let a = if i < hi { &stmt[i] } else { &stmt[i - 1] };
                    errs.push(sp(a.line, a.col, "Expected CTE name in T-SQL WITH clause"));
                    continue 'outer;
                }
                i += 1;
                if i < hi && stmt[i].kind == SqlTokKind::LParen {
                    let rp = match_rp[i];
                    if rp >= hi { continue 'outer; }
                    validate_cte_cols(&stmt[i + 1..rp], &stmt[i], src, errs);
                    i = rp + 1;
                }
                if i >= hi || !stmt[i].is_kw(src, "AS") {
                    let a = if i < hi { &stmt[i] } else { &stmt[i - 1] };
                    errs.push(sp(a.line, a.col, "Expected AS in T-SQL CTE definition"));
                    continue 'outer;
                }
                i += 1;
                if i >= hi || stmt[i].kind != SqlTokKind::LParen {
                    let a = if i < hi { &stmt[i] } else { &stmt[i - 1] };
                    errs.push(sp(a.line, a.col, "Expected '(' for T-SQL CTE body"));
                    continue 'outer;
                }
                let rp = match_rp[i];
                if rp >= hi { continue 'outer; }
                if rp == i + 1 {
                    errs.push(sp(stmt[i].line, stmt[i].col, "Empty CTE query body in T-SQL WITH"));
                } else {
                    work.push((i + 1, rp, false));
                }
                i = rp + 1;
                if i < hi && stmt[i].kind == SqlTokKind::Comma { i += 1; } else { break; }
            }
            if i >= hi {
                errs.push(sp(stmt[lo].line, stmt[lo].col, "Missing main statement after T-SQL WITH CTE"));
            } else {
                validate_with_main(stmt, i, hi, can_dml, src, &mut work, errs);
            }
            continue;
        }
        validate_cte_query_body(stmt, lo, hi, match_rp, next_non_lp, next_lp_q, src, &mut work, errs);
    }
}

fn validate_cte_cols(cols: &[SqlTok], lp: &SqlTok, src: &str, errs: &mut Vec<ErrorSpan>) {
    if cols.is_empty() {
        errs.push(sp(lp.line, lp.col, "Empty column list in T-SQL CTE"));
        return;
    }
    let mut k = 0usize;
    while k < cols.len() {
        if !is_tsql_cte_ident(&cols[k], src) {
            errs.push(sp(cols[k].line, cols[k].col, format!("Invalid column '{}' in T-SQL CTE", cols[k].slice(src))));
            return;
        }
        k += 1;
        if k < cols.len() {
            if cols[k].kind != SqlTokKind::Comma {
                errs.push(sp(cols[k].line, cols[k].col, format!("Expected ',' before '{}' in T-SQL CTE", cols[k].slice(src))));
                return;
            }
            k += 1;
            if k == cols.len() {
                errs.push(sp(cols[k - 1].line, cols[k - 1].col, "Trailing ',' in T-SQL CTE column list"));
                return;
            }
        }
    }
}

fn validate_with_main(
    stmt: &[SqlTok], i: usize, hi: usize, allow_dml: bool, src: &str,
    work: &mut Vec<(usize, usize, bool)>, errs: &mut Vec<ErrorSpan>,
) {
    if i >= hi {
        errs.push(sp(stmt[i - 1].line, stmt[i - 1].col, "Missing main statement after T-SQL WITH"));
    } else if stmt[i].is_kw(src, "SELECT") || stmt[i].kind == SqlTokKind::LParen {
        work.push((i, hi, false));
    } else if allow_dml && (stmt[i].is_kw(src, "INSERT")
        || stmt[i].is_kw(src, "UPDATE")
        || stmt[i].is_kw(src, "DELETE")
        || stmt[i].is_kw(src, "MERGE"))
    {
        validate_tsql_dml(&stmt[i..hi], src, errs);
    } else {
        errs.push(sp(stmt[i].line, stmt[i].col, format!("Invalid main statement '{}' after T-SQL WITH CTE", stmt[i].slice(src))));
    }
}

#[allow(clippy::too_many_arguments)]
fn validate_cte_query_body(
    stmt: &[SqlTok], b_lo: usize, b_hi: usize, match_rp: &[usize],
    next_non_lp: &[usize], next_lp_q: &[usize],
    src: &str, work: &mut Vec<(usize, usize, bool)>, errs: &mut Vec<ErrorSpan>,
) {
    let (mut k, mut expect_branch, mut after_paren, mut case_depth, mut in_post_from) =
        (b_lo, true, false, 0usize, false);
    while k < b_hi {
        let t = &stmt[k];
        let not_dot = k == b_lo || stmt[k - 1].kind != SqlTokKind::Dot;
        if expect_branch {
            if t.kind == SqlTokKind::LParen {
                let rp = match_rp[k];
                if rp < b_hi { work.push((k + 1, rp, false)); k = rp + 1; } else { break; }
                expect_branch = false;
                after_paren = true;
                continue;
            }
            if not_dot && t.is_kw(src, "SELECT") {
                expect_branch = false;
                after_paren = false;
                case_depth = 0;
                in_post_from = false;
                k += 1;
                continue;
            }
            errs.push(sp(t.line, t.col, format!("Expected SELECT query in T-SQL CTE/query, found '{}'", t.slice(src))));
            break;
        }
        if t.kind == SqlTokKind::Semi {
            errs.push(sp(t.line, t.col, "Unexpected ';' inside T-SQL CTE/query"));
            break;
        }
        if not_dot && (t.is_kw(src, "UNION") || t.is_kw(src, "INTERSECT") || t.is_kw(src, "EXCEPT")) {
            k += 1;
            if k < b_hi && (stmt[k].is_kw(src, "ALL") || stmt[k].is_kw(src, "DISTINCT")) { k += 1; }
            if k >= b_hi {
                errs.push(sp(t.line, t.col, format!("Expected query after '{}' in T-SQL CTE/query", t.slice(src))));
                break;
            }
            expect_branch = true;
            after_paren = false;
            case_depth = 0;
            in_post_from = false;
            continue;
        }
        if after_paren {
            if not_dot && (t.is_kw(src, "ORDER") || t.is_kw(src, "FOR") || t.is_kw(src, "OPTION")) {
                validate_query_tail(stmt, k, b_hi, match_rp, src, errs);
                push_subqueries(k, b_hi, stmt, match_rp, next_non_lp, next_lp_q, src, work);
            } else {
                errs.push(sp(t.line, t.col, format!("Unexpected token '{}' after parenthesized query", t.slice(src))));
            }
            break;
        }
        let is_alias = k > b_lo && stmt[k - 1].is_kw(src, "AS");
        if not_dot && t.is_kw(src, "CASE") {
            case_depth += 1;
            k += 1;
            continue;
        }
        if not_dot && t.is_kw(src, "END") && case_depth > 0 {
            case_depth -= 1;
            k += 1;
            continue;
        }
        if case_depth == 0 && not_dot && !is_alias {
            if t.is_kw(src, "WHERE") || t.is_kw(src, "HAVING") || t.is_kw(src, "WINDOW")
                || (t.is_kw(src, "GROUP") && !(k > b_lo && stmt[k - 1].is_kw(src, "WITHIN")))
            {
                in_post_from = true;
            } else if t.is_kw(src, "FROM") && !is_is_distinct_from(stmt, k, b_lo, src) {
                if in_post_from {
                    errs.push(sp(t.line, t.col, "Unexpected FROM clause in T-SQL SELECT"));
                    break;
                }
                let f = find_select_from_end(stmt, k + 1, b_hi, match_rp, src);
                if f == k + 1 {
                    errs.push(sp(t.line, t.col, "Empty FROM clause in T-SQL SELECT"));
                    break;
                }
                validate_tsql_from_slice(
                    stmt, k + 1, f, "SELECT", match_rp, next_non_lp, next_lp_q, src, errs, work,
                );
                in_post_from = true;
                k = f;
                continue;
            } else if t.is_kw(src, "ORDER")
                || t.is_kw(src, "OFFSET")
                || t.is_kw(src, "FETCH")
                || (t.is_kw(src, "FOR") && !stmt.get(k + 1).is_some_and(|n| n.is_kw(src, "SYSTEM_TIME")))
                || t.is_kw(src, "OPTION")
            {
                validate_query_tail(stmt, k, b_hi, match_rp, src, errs);
                push_subqueries(k, b_hi, stmt, match_rp, next_non_lp, next_lp_q, src, work);
                break;
            }
        }
        if t.kind == SqlTokKind::LParen {
            let rp = match_rp[k];
            if rp >= b_hi { break; }
            let (ilo, qspan) = paren_query_span(stmt, k, rp, match_rp, next_non_lp, src);
            if let Some((qlo, qhi)) = qspan {
                work.push((qlo, qhi, false));
            } else {
                push_subqueries(ilo, rp, stmt, match_rp, next_non_lp, next_lp_q, src, work);
            }
            k = rp + 1;
            continue;
        }
        k += 1;
    }
}
