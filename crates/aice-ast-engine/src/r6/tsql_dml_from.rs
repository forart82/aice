use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
use crate::r6::sql_pratt::{validate_pratt_expr, validate_pratt_expr_rp};
use crate::r6::tsql_dml::{consume_dml_target, is_dml_ident, validate_col_list};
use crate::r6::tsql_from_ext::{
    consume_table_mods, parse_join_kw, validate_from_values, validate_pivot_clause, validate_tvf_args,
};
use crate::r6::tsql_paren::{build_paren_maps, build_query_lp_map, push_subqueries};
use crate::r6::tsql_with::validate_tsql_query_only;

const FROM_KW_RESERVED: &[&str] = &[
    "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "OUTER", "NATURAL", "JOIN", "APPLY",
    "PIVOT", "UNPIVOT", "TABLESAMPLE", "FOR", "LOOP", "HASH", "REMOTE", "ON", "USING",
    "WHERE", "OPTION", "ORDER", "GROUP", "HAVING", "WINDOW", "OFFSET", "FETCH",
    "OUTPUT", "SET", "WHEN", "UNION", "INTERSECT", "EXCEPT", "VALUES",
];

const ON_STOP_KWS: &[&str] = &[
    "ON", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "OUTER", "NATURAL",
    "JOIN", "APPLY", "PIVOT", "UNPIVOT", "WHERE", "OPTION", "WINDOW", "OFFSET", "FETCH",
];

fn is_from_kw_reserved(t: &SqlTok, src: &str) -> bool {
    t.kind == SqlTokKind::Word && FROM_KW_RESERVED.iter().any(|k| t.is_kw(src, k))
}

fn is_from_alias(t: &SqlTok, src: &str) -> bool {
    is_dml_ident(t, src) && !is_from_kw_reserved(t, src)
}

pub(super) fn consume_where(
    stmt: &[SqlTok], i: usize, kw: &str, src: &str, errs: &mut Vec<ErrorSpan>,
) -> Option<usize> {
    if !stmt.get(i).is_some_and(|t| t.is_kw(src, "WHERE")) {
        return Some(i);
    }
    let wt = &stmt[i];
    if stmt.get(i + 1).is_some_and(|n| n.is_kw(src, "CURRENT"))
        && stmt.get(i + 2).is_some_and(|n| n.is_kw(src, "OF"))
    {
        let mut cur = i + 3;
        if stmt.get(cur).is_some_and(|n| n.is_kw(src, "GLOBAL")) { cur += 1; }
        let Some(cname) = stmt.get(cur) else {
            errs.push(sp(wt.line, wt.col, format!("Expected cursor name in WHERE CURRENT OF of T-SQL {kw}")));
            return None;
        };
        if cname.kind == SqlTokKind::Var {
            if cname.slice(src).starts_with("@@") || cname.slice(src).len() <= 1 {
                errs.push(sp(cname.line, cname.col, "Invalid cursor variable in WHERE CURRENT OF"));
                return None;
            }
            return Some(cur + 1);
        }
        if is_dml_ident(cname, src) { return Some(cur + 1); }
        errs.push(sp(cname.line, cname.col, format!("Invalid cursor '{}' in WHERE CURRENT OF", cname.slice(src))));
        return None;
    }
    let mut idx = i + 1;
    if idx >= stmt.len() {
        errs.push(sp(wt.line, wt.col, format!("Empty WHERE clause in T-SQL {kw}")));
        return None;
    }
    if let Err(e) = validate_pratt_expr(stmt, src, &mut idx, 0, &["OPTION"]) {
        errs.push(e);
        return None;
    }
    Some(idx)
}

pub(super) fn validate_tsql_from(
    slice: &[SqlTok], kw: &str, src: &str, errs: &mut Vec<ErrorSpan>,
) -> bool {
    let (match_rp, next_non_lp) = build_paren_maps(slice);
    let next_lp_q = build_query_lp_map(slice, &next_non_lp, src);
    let mut derived = Vec::new();
    let ok = validate_tsql_from_slice(
        slice, 0, slice.len(), kw, &match_rp, &next_non_lp, &next_lp_q, src, errs, &mut derived,
    );
    if ok {
        for (qlo, qhi, _) in derived {
            validate_tsql_query_only(&slice[qlo..qhi], src, errs);
        }
    }
    ok
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn validate_tsql_from_slice(
    slice: &[SqlTok], lo: usize, hi: usize, kw: &str,
    match_rp: &[usize], next_non_lp: &[usize], next_lp_q: &[usize],
    src: &str, errs: &mut Vec<ErrorSpan>, derived: &mut Vec<(usize, usize, bool)>,
) -> bool {
    let mut work = vec![(lo, hi)];
    while let Some((lo, hi)) = work.pop() {
        let mut pos = lo;
        let mut need_on = 0usize;
        while pos < hi {
            let Some(next_p) = consume_table_source(
                slice, pos, hi, match_rp, next_non_lp, next_lp_q, &mut work, derived, kw, src, errs,
            ) else {
                return false;
            };
            pos = next_p;
            while need_on > 0 && pos < hi && slice[pos].is_kw(src, "ON") {
                need_on -= 1;
                pos += 1;
                let on_start = pos;
                if let Err(e) = validate_pratt_expr_rp(&slice[..hi], src, &mut pos, 0, ON_STOP_KWS, Some((match_rp, 0))) {
                    errs.push(e);
                    return false;
                }
                push_subqueries(on_start, pos, slice, match_rp, next_non_lp, next_lp_q, src, derived);
            }
            if pos >= hi { break; }
            if slice[pos].kind == SqlTokKind::Comma {
                if need_on > 0 {
                    errs.push(sp(slice[pos].line, slice[pos].col, "Missing ON condition for JOIN in T-SQL FROM"));
                    return false;
                }
                pos += 1;
                if pos >= hi {
                    errs.push(sp(slice[pos - 1].line, slice[pos - 1].col, "Trailing ',' in T-SQL FROM"));
                    return false;
                }
            } else if (slice[pos].is_kw(src, "CROSS") || slice[pos].is_kw(src, "OUTER"))
                && pos + 1 < hi && slice[pos + 1].is_kw(src, "APPLY")
            {
                if need_on > 0 {
                    errs.push(sp(slice[pos].line, slice[pos].col, "Missing ON condition for JOIN in T-SQL FROM"));
                    return false;
                }
                pos += 2;
                if pos >= hi { errs.push(sp(slice[pos - 1].line, slice[pos - 1].col, "Incomplete APPLY in T-SQL FROM")); return false; }
            } else if slice[pos].is_kw(src, "CROSS") && pos + 1 < hi && slice[pos + 1].is_kw(src, "JOIN") {
                if need_on > 0 {
                    errs.push(sp(slice[pos].line, slice[pos].col, "Missing ON condition for JOIN in T-SQL FROM"));
                    return false;
                }
                pos += 2;
                if pos >= hi { errs.push(sp(slice[pos - 1].line, slice[pos - 1].col, "Incomplete CROSS JOIN in T-SQL FROM")); return false; }
            } else if let Some(jpos) = parse_join_kw(slice, pos, hi, src) {
                pos = jpos;
                if pos >= hi { errs.push(sp(slice[pos - 1].line, slice[pos - 1].col, "Incomplete JOIN in T-SQL FROM")); return false; }
                need_on += 1;
            } else {
                errs.push(sp(slice[pos].line, slice[pos].col, format!("Unexpected token '{}' in T-SQL FROM", slice[pos].slice(src))));
                return false;
            }
        }
        if need_on > 0 {
            let a = &slice[hi.saturating_sub(1)];
            errs.push(sp(a.line, a.col, "Missing ON condition for JOIN in T-SQL FROM"));
            return false;
        }
    }
    true
}

#[allow(clippy::too_many_arguments)]
fn consume_table_source(
    slice: &[SqlTok], mut pos: usize, hi: usize,
    match_rp: &[usize], next_non_lp: &[usize], next_lp_q: &[usize],
    work: &mut Vec<(usize, usize)>, derived: &mut Vec<(usize, usize, bool)>,
    kw: &str, src: &str, errs: &mut Vec<ErrorSpan>,
) -> Option<usize> {
    if slice[pos].kind == SqlTokKind::LParen {
        let rp = match_rp[pos];
        if rp >= hi { return None; }
        if rp == pos + 1 {
            errs.push(sp(slice[pos].line, slice[pos].col, "Empty '()' in T-SQL FROM"));
            return None;
        }
        let (mut ilo, mut ihi) = (pos + 1, rp);
        while ilo < ihi && slice[ilo].kind == SqlTokKind::LParen && match_rp[ilo] == ihi - 1 {
            ilo += 1;
            ihi -= 1;
        }
        if ilo >= ihi {
            errs.push(sp(slice[pos].line, slice[pos].col, "Empty '()' in T-SQL FROM"));
            return None;
        }
        let probe = next_non_lp[ilo];
        let is_derived_query = probe < ihi
            && (slice[probe].is_kw(src, "SELECT") || slice[probe].is_kw(src, "WITH"))
            && (probe == ilo || {
                let after = match_rp[ilo].saturating_add(1);
                after < ihi && (
                    slice[after].is_kw(src, "UNION")
                        || slice[after].is_kw(src, "INTERSECT")
                        || slice[after].is_kw(src, "EXCEPT")
                        || slice[after].is_kw(src, "ORDER")
                        || slice[after].is_kw(src, "FOR")
                        || slice[after].is_kw(src, "OPTION")
                )
            });
        if is_derived_query {
            derived.push((pos + 1, rp, false));
            pos = rp + 1;
            pos = consume_opt_alias(slice, pos, hi, match_rp, src, errs)?;
        } else if slice[ilo].is_kw(src, "VALUES") {
            if !validate_from_values(&slice[ilo..ihi], ilo, match_rp, src, errs) { return None; }
            push_subqueries(ilo, ihi, slice, match_rp, next_non_lp, next_lp_q, src, derived);
            pos = rp + 1;
            pos = consume_opt_alias(slice, pos, hi, match_rp, src, errs)?;
        } else {
            work.push((ilo, ihi));
            pos = rp + 1;
        }
    } else {
        if is_from_kw_reserved(&slice[pos], src) {
            errs.push(sp(slice[pos].line, slice[pos].col, format!("Unexpected keyword '{}' in T-SQL FROM", slice[pos].slice(src))));
            return None;
        }
        pos = consume_dml_target(&slice[..hi], pos, &format!("{kw} FROM"), src, errs)?;
        if pos < hi && slice[pos].kind == SqlTokKind::LParen {
            let rp = match_rp[pos];
            if rp >= hi { return None; }
            if !validate_tvf_args(&slice[pos + 1..rp], &slice[pos], src, errs) { return None; }
            push_subqueries(pos + 1, rp, slice, match_rp, next_non_lp, next_lp_q, src, derived);
            pos = rp + 1;
        }
        let (mut seen_sys, mut seen_samp, mut seen_with) = (false, false, false);
        let mod1 = pos;
        pos = consume_table_mods(slice, pos, hi, match_rp, &mut seen_sys, &mut seen_samp, &mut seen_with, src, errs)?;
        push_subqueries(mod1, pos, slice, match_rp, next_non_lp, next_lp_q, src, derived);
        pos = consume_opt_alias(slice, pos, hi, match_rp, src, errs)?;
        let mod2 = pos;
        pos = consume_table_mods(slice, pos, hi, match_rp, &mut seen_sys, &mut seen_samp, &mut seen_with, src, errs)?;
        push_subqueries(mod2, pos, slice, match_rp, next_non_lp, next_lp_q, src, derived);
    }
    while pos < hi && (slice[pos].is_kw(src, "PIVOT") || slice[pos].is_kw(src, "UNPIVOT")) {
        let is_unpivot = slice[pos].is_kw(src, "UNPIVOT");
        if pos + 1 >= hi || slice[pos + 1].kind != SqlTokKind::LParen {
            errs.push(sp(slice[pos].line, slice[pos].col, "Expected '(' after PIVOT/UNPIVOT"));
            return None;
        }
        let rp = match_rp[pos + 1];
        if rp >= hi { return None; }
        if !validate_pivot_clause(slice, pos, rp, is_unpivot, match_rp, src, errs) { return None; }
        pos = consume_opt_alias(slice, rp + 1, hi, match_rp, src, errs)?;
    }
    Some(pos)
}

fn consume_opt_alias(
    slice: &[SqlTok], mut pos: usize, hi: usize, match_rp: &[usize], src: &str, errs: &mut Vec<ErrorSpan>,
) -> Option<usize> {
    if pos < hi && slice[pos].is_kw(src, "AS") {
        pos += 1;
        let Some(_) = slice.get(pos).filter(|t| pos < hi && is_from_alias(t, src)) else {
            let a = if pos < hi { &slice[pos] } else { &slice[pos - 1] };
            errs.push(sp(a.line, a.col, "Expected alias after AS in T-SQL FROM"));
            return None;
        };
        pos += 1;
    } else if pos < hi && is_from_alias(&slice[pos], src) {
        pos += 1;
    } else {
        return Some(pos);
    }
    if pos < hi && slice[pos].kind == SqlTokKind::LParen {
        let rp = match_rp[pos];
        if rp >= hi { return None; }
        if !validate_col_list(&slice[pos + 1..rp], &slice[pos], "FROM alias", src, errs) { return None; }
        pos = rp + 1;
    }
    Some(pos)
}
