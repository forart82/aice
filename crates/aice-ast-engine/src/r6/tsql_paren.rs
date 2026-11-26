use crate::r6::sql_lex::{SqlTok, SqlTokKind};

pub(crate) fn build_paren_maps(slice: &[SqlTok]) -> (Vec<usize>, Vec<usize>) {
    let n = slice.len();
    let mut match_rp = vec![usize::MAX; n];
    let mut pstack = Vec::new();
    for (idx, tok) in slice.iter().enumerate() {
        if tok.kind == SqlTokKind::LParen {
            pstack.push(idx);
        } else if tok.kind == SqlTokKind::RParen
            && let Some(lp) = pstack.pop()
        {
            match_rp[lp] = idx;
        }
    }
    let mut next_non_lp = vec![n; n + 1];
    for idx in (0..n).rev() {
        next_non_lp[idx] = if slice[idx].kind == SqlTokKind::LParen {
            next_non_lp[idx + 1]
        } else {
            idx
        };
    }
    (match_rp, next_non_lp)
}

pub(crate) fn build_query_lp_map(
    slice: &[SqlTok],
    next_non_lp: &[usize],
    src: &str,
) -> Vec<usize> {
    let n = slice.len();
    let mut next_lp_q = vec![n; n + 1];
    for idx in (0..n).rev() {
        let f = next_non_lp[idx + 1];
        let lp_q = slice[idx].kind == SqlTokKind::LParen
            && f < n
            && (slice[f].is_kw(src, "WITH") || slice[f].is_kw(src, "SELECT"));
        next_lp_q[idx] = if lp_q { idx } else { next_lp_q[idx + 1] };
    }
    next_lp_q
}

pub(crate) fn paren_query_span(
    stmt: &[SqlTok],
    lp: usize,
    rp: usize,
    match_rp: &[usize],
    next_non_lp: &[usize],
    src: &str,
) -> (usize, Option<(usize, usize)>) {
    let mut ilo = lp + 1;
    let mut ihi = rp;
    while ilo < ihi && stmt[ilo].kind == SqlTokKind::LParen && match_rp[ilo] == ihi - 1 {
        ilo += 1;
        ihi -= 1;
    }
    if ilo >= ihi {
        return (ilo, None);
    }
    let first = next_non_lp[ilo];
    let is_q = first < ihi && (stmt[first].is_kw(src, "WITH") || stmt[first].is_kw(src, "SELECT"));
    if !is_q {
        return (ilo, None);
    }
    if first == ilo {
        return (ilo, Some((ilo, ihi)));
    }
    let after = match_rp[ilo].saturating_add(1);
    let set_or_tail = after < ihi
        && (stmt[after].is_kw(src, "UNION")
            || stmt[after].is_kw(src, "INTERSECT")
            || stmt[after].is_kw(src, "EXCEPT")
            || stmt[after].is_kw(src, "ORDER")
            || stmt[after].is_kw(src, "FOR")
            || stmt[after].is_kw(src, "OPTION"));
    if set_or_tail {
        (ilo, Some((ilo, ihi)))
    } else {
        (ilo, None)
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn push_subqueries(
    lo: usize,
    hi: usize,
    stmt: &[SqlTok],
    match_rp: &[usize],
    next_non_lp: &[usize],
    next_lp_q: &[usize],
    src: &str,
    work: &mut Vec<(usize, usize, bool)>,
) {
    let mut p = next_lp_q[lo];
    while p < hi {
        let prp = match_rp[p];
        if prp >= hi {
            break;
        }
        let (pilo, qspan) = paren_query_span(stmt, p, prp, match_rp, next_non_lp, src);
        if let Some((qlo, qhi)) = qspan {
            work.push((qlo, qhi, false));
            p = next_lp_q[prp + 1];
        } else {
            p = next_lp_q[pilo];
        }
    }
}

pub(crate) fn find_select_from_end(
    stmt: &[SqlTok],
    mut f: usize,
    b_hi: usize,
    match_rp: &[usize],
    src: &str,
) -> usize {
    let mut cd = 0usize;
    while f < b_hi {
        let t = &stmt[f];
        if t.kind == SqlTokKind::LParen {
            let rp = match_rp[f];
            if rp >= b_hi {
                return b_hi;
            }
            f = rp + 1;
            continue;
        }
        if t.kind == SqlTokKind::Semi {
            break;
        }
        let not_dot = f == 0 || stmt[f - 1].kind != SqlTokKind::Dot;
        if not_dot && t.is_kw(src, "CASE") {
            cd += 1;
        } else if not_dot && t.is_kw(src, "END") && cd > 0 {
            cd -= 1;
        } else if cd == 0
            && not_dot
            && !stmt[f - 1].is_kw(src, "AS")
            && (t.is_kw(src, "WHERE")
                || t.is_kw(src, "GROUP")
                || t.is_kw(src, "HAVING")
                || t.is_kw(src, "WINDOW")
                || t.is_kw(src, "ORDER")
                || t.is_kw(src, "OFFSET")
                || t.is_kw(src, "FETCH")
                || t.is_kw(src, "OPTION")
                || t.is_kw(src, "UNION")
                || t.is_kw(src, "INTERSECT")
                || t.is_kw(src, "EXCEPT")
                || (t.is_kw(src, "FOR")
                    && !stmt.get(f + 1).is_some_and(|n| n.is_kw(src, "SYSTEM_TIME"))))
        {
            break;
        }
        f += 1;
    }
    f
}

pub(crate) fn is_tsql_cte_ident(t: &SqlTok, src: &str) -> bool {
    match t.kind {
        SqlTokKind::BracketIdent | SqlTokKind::QuotedIdent => !t.ident_name(src).is_empty(),
        SqlTokKind::Word => ![
            "SELECT", "INSERT", "UPDATE", "DELETE", "MERGE", "WITH", "AS", "FROM", "WHERE",
            "GROUP", "HAVING", "ORDER", "UNION", "INTERSECT", "EXCEPT", "INTO", "VALUES",
            "SET", "JOIN", "ON", "CREATE", "ALTER", "DROP", "BEGIN", "END", "IF", "ELSE",
            "WHILE", "CASE", "WHEN", "THEN", "RETURN", "GO", "AND", "OR", "NOT", "NULL",
            "TRUE", "FALSE", "EXISTS", "IN", "IS", "LIKE", "BETWEEN",
        ].iter().any(|k| t.is_kw(src, k)),
        _ => false,
    }
}

pub(crate) fn is_is_distinct_from(stmt: &[SqlTok], k: usize, lo: usize, src: &str) -> bool {
    if k <= lo || !stmt[k].is_kw(src, "FROM") || !stmt[k - 1].is_kw(src, "DISTINCT") {
        return false;
    }
    let is_idx = if k >= lo + 3 && stmt[k - 2].is_kw(src, "NOT") {
        k - 3
    } else if k >= lo + 2 {
        k - 2
    } else {
        return false;
    };
    stmt[is_idx].is_kw(src, "IS") && (is_idx == lo || stmt[is_idx - 1].kind != SqlTokKind::Dot)
}

pub(crate) fn is_clause_reset_kw(t: &SqlTok, src: &str) -> bool {
    t.kind == SqlTokKind::Word && [
        "GROUP", "ORDER", "UNION", "INTERSECT", "EXCEPT", "SET", "OUTPUT", "WHEN",
    ].iter().any(|k| t.is_kw(src, k))
}

pub(crate) fn is_select_end_kw(t: &SqlTok, src: &str) -> bool {
    t.kind == SqlTokKind::Word && [
        "FROM", "INTO", "WHERE", "GROUP", "HAVING", "ORDER", "WINDOW", "UNION", "INTERSECT", "EXCEPT", "FOR", "OPTION",
    ].iter().any(|k| t.is_kw(src, k))
}

pub(crate) fn is_alias_tok(t: &SqlTok) -> bool {
    matches!(t.kind, SqlTokKind::Word | SqlTokKind::QuotedIdent | SqlTokKind::BracketIdent | SqlTokKind::StringLit)
}

pub(crate) fn is_tsql_ident_tok(t: &SqlTok) -> bool {
    matches!(t.kind, SqlTokKind::Word | SqlTokKind::QuotedIdent | SqlTokKind::BracketIdent)
}
