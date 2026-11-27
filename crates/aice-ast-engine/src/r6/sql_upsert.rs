use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
use crate::r6::sql_pratt::validate_pratt_expr;
use crate::r6::sql_pratt_ext::skip_paren_group;

const ASSIGN_FORBIDDEN_KWS: &[&str] = &[
    "SELECT", "FROM", "WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET",
    "UNION", "INTERSECT", "EXCEPT", "INTO", "JOIN", "ON", "SET", "VALUES",
    "DO", "RETURNING", "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP",
    "AND", "OR", "NOT", "NOTHING",
];
const CONSTRAINT_FORBIDDEN_KWS: &[&str] = &[
    "DO", "WHERE", "SET", "UPDATE", "NOTHING", "RETURNING", "ON", "CONFLICT",
];

fn is_on_conflict_at(stmt: &[SqlTok], src: &str, i: usize, limit: usize) -> bool {
    i + 1 < limit
        && stmt[i].is_kw(src, "ON")
        && (i == 0 || stmt[i - 1].kind != SqlTokKind::Dot)
        && stmt[i + 1].is_kw(src, "CONFLICT")
        && !stmt.get(i + 2).is_some_and(|n| n.kind == SqlTokKind::Dot)
}

pub(crate) fn validate_and_collect_upsert_masks(
    stmt: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>,
) -> Vec<(usize, usize)> {
    let mut masks = Vec::new();
    let mut i = 0usize;
    while i + 1 < stmt.len() {
        if !is_on_conflict_at(stmt, src, i, stmt.len()) { i += 1; continue; }
        let Some(scope_end) = enclosing_insert_scope_end(stmt, src, i) else { i += 1; continue; };
        let clause_start = i;
        let mut ok = true;
        while is_on_conflict_at(stmt, src, i, scope_end) {
            if !parse_single_upsert_clause(stmt, src, &mut i, scope_end, errs) {
                ok = false;
                break;
            }
        }
        if ok && i < scope_end && !stmt[i].is_kw(src, "RETURNING") {
            errs.push(sp(stmt[i].line, stmt[i].col, format!("Unexpected token '{}' after ON CONFLICT clause", stmt[i].slice(src))));
        }
        if i > clause_start {
            masks.push((stmt[clause_start].start, stmt[i - 1].end));
        } else {
            i += 1;
        }
    }
    masks
}

pub(crate) fn validate_and_mask_upsert_clauses(
    stmt: &[SqlTok], src: &str, masked: &mut [u8], errs: &mut Vec<ErrorSpan>,
) {
    for (s, e) in validate_and_collect_upsert_masks(stmt, src, errs) {
        for b in &mut masked[s..e] {
            if *b != b'\n' { *b = b' '; }
        }
    }
}

fn enclosing_insert_scope_end(stmt: &[SqlTok], src: &str, pos: usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut open_lp = None;
    for k in (0..pos).rev() {
        match stmt[k].kind {
            SqlTokKind::RParen => depth += 1,
            SqlTokKind::LParen if depth == 0 => { open_lp = Some(k); break; }
            SqlTokKind::LParen => depth -= 1,
            _ => {}
        }
    }
    let (scope_start, scope_end) = match open_lp {
        Some(lp) => (lp + 1, skip_paren_group(stmt, lp).map_or(stmt.len(), |a| a - 1)),
        None => (0, stmt.len()),
    };
    let head = stmt.get(scope_start)?;
    if head.is_kw(src, "INSERT") { return Some(scope_end); }
    if !head.is_kw(src, "WITH") { return None; }
    let mut d = 0usize;
    for k in (scope_start + 1)..pos {
        match stmt[k].kind {
            SqlTokKind::LParen => d += 1,
            SqlTokKind::RParen => d = d.saturating_sub(1),
            SqlTokKind::Word if d == 0 && (k == scope_start || stmt[k - 1].kind != SqlTokKind::Dot) => {
                if stmt[k].is_kw(src, "INSERT") { return Some(scope_end); }
                if ["SELECT", "UPDATE", "DELETE", "MERGE"].iter().any(|kw| stmt[k].is_kw(src, kw)) {
                    return None;
                }
            }
            _ => {}
        }
    }
    None
}

fn parse_single_upsert_clause(
    stmt: &[SqlTok], src: &str, i: &mut usize, scope_end: usize, errs: &mut Vec<ErrorSpan>,
) -> bool {
    let on_tok = stmt[*i];
    *i += 2;
    if *i < scope_end && stmt[*i].kind == SqlTokKind::LParen {
        let lp = stmt[*i];
        let Some(rp_next) = skip_paren_group(&stmt[..scope_end], *i) else {
            errs.push(sp(lp.line, lp.col, "Unclosed '(' in ON CONFLICT target"));
            return false;
        };
        let inner = &stmt[*i + 1..rp_next - 1];
        if inner.is_empty() {
            errs.push(sp(lp.line, lp.col, "Empty '()' in ON CONFLICT target"));
            *i = rp_next;
            return false;
        }
        validate_conflict_target_list(inner, src, errs);
        *i = rp_next;
        if *i < scope_end && stmt[*i].is_kw(src, "WHERE") {
            *i += 1;
            if let Err(e) = validate_pratt_expr(&stmt[..scope_end], src, i, 0, &["DO"]) {
                errs.push(e);
                return false;
            }
        }
    } else if *i + 1 < scope_end && stmt[*i].is_kw(src, "ON") && stmt[*i + 1].is_kw(src, "CONSTRAINT") {
        let kw = stmt[*i + 1];
        *i += 2;
        if !stmt.get(*i).is_some_and(|t| *i < scope_end && is_ident_not_in(t, src, CONSTRAINT_FORBIDDEN_KWS)) {
            let a = stmt.get(*i).unwrap_or(&kw);
            errs.push(sp(a.line, a.col, "Expected constraint name after ON CONSTRAINT"));
            return false;
        }
        *i += 1;
    }

    if *i >= scope_end || !stmt[*i].is_kw(src, "DO") {
        let a = stmt.get(*i).unwrap_or(&on_tok);
        errs.push(sp(a.line, a.col, "Expected DO after ON CONFLICT"));
        return false;
    }
    let do_tok = stmt[*i];
    *i += 1;

    if *i < scope_end && stmt[*i].is_kw(src, "NOTHING") {
        *i += 1;
        return true;
    }
    if *i + 1 < scope_end && stmt[*i].is_kw(src, "UPDATE") && stmt[*i + 1].is_kw(src, "SET") {
        *i += 2;
        if !parse_set_assignments(stmt, src, i, scope_end, &do_tok, errs) { return false; }
        if *i < scope_end && stmt[*i].is_kw(src, "WHERE") {
            *i += 1;
            if let Err(e) = validate_pratt_expr(&stmt[..scope_end], src, i, 0, &["RETURNING", "ON"]) {
                errs.push(e);
                return false;
            }
        }
        return true;
    }
    errs.push(sp(do_tok.line, do_tok.col, "Invalid ON CONFLICT DO action"));
    false
}

fn validate_conflict_target_list(inner: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    let mut k = 0usize;
    loop {
        if let Err(e) = validate_pratt_expr(inner, src, &mut k, 0, &["ASC", "DESC", "NULLS"]) {
            errs.push(e);
            return;
        }
        if inner.get(k).is_some_and(|t| t.is_kw(src, "ASC") || t.is_kw(src, "DESC")) { k += 1; }
        if inner.get(k).is_some_and(|t| t.is_kw(src, "NULLS")) {
            if inner.get(k + 1).is_some_and(|n| n.is_kw(src, "FIRST") || n.is_kw(src, "LAST")) {
                k += 2;
            } else {
                errs.push(sp(inner[k].line, inner[k].col, "Expected FIRST or LAST after NULLS"));
                return;
            }
        }
        if k == inner.len() { return; }
        if inner[k].kind == SqlTokKind::Comma {
            k += 1;
            if k == inner.len() {
                errs.push(sp(inner[k - 1].line, inner[k - 1].col, "Trailing ',' in ON CONFLICT target"));
                return;
            }
        } else {
            errs.push(sp(inner[k].line, inner[k].col, format!("Unexpected token '{}' in ON CONFLICT target", inner[k].slice(src))));
            return;
        }
    }
}

fn parse_set_assignments(
    stmt: &[SqlTok], src: &str, i: &mut usize, scope_end: usize, do_tok: &SqlTok, errs: &mut Vec<ErrorSpan>,
) -> bool {
    loop {
        if *i >= scope_end {
            errs.push(sp(do_tok.line, do_tok.col, "Expected column assignment in DO UPDATE SET"));
            return false;
        }
        if stmt[*i].kind == SqlTokKind::LParen {
            let lp = stmt[*i];
            let Some(rp_next) = skip_paren_group(&stmt[..scope_end], *i) else {
                errs.push(sp(lp.line, lp.col, "Unclosed '(' in DO UPDATE SET target"));
                return false;
            };
            if !validate_col_tuple(&stmt[*i + 1..rp_next - 1], src, &lp, errs) { return false; }
            *i = rp_next;
        } else if is_ident_not_in(&stmt[*i], src, ASSIGN_FORBIDDEN_KWS) {
            *i += 1;
        } else {
            errs.push(sp(stmt[*i].line, stmt[*i].col, "Expected column name in DO UPDATE SET"));
            return false;
        }
        if *i >= scope_end || !stmt[*i].is_op(src, "=") {
            let a = stmt.get(*i).unwrap_or(do_tok);
            errs.push(sp(a.line, a.col, "Expected '=' in DO UPDATE SET assignment"));
            return false;
        }
        *i += 1;
        if let Err(e) = validate_pratt_expr(&stmt[..scope_end], src, i, 0, &["WHERE", "RETURNING", "ON"]) {
            errs.push(e);
            return false;
        }
        if *i < scope_end && stmt[*i].kind == SqlTokKind::Comma { *i += 1; } else { return true; }
    }
}

fn validate_col_tuple(cols: &[SqlTok], src: &str, lp: &SqlTok, errs: &mut Vec<ErrorSpan>) -> bool {
    if cols.is_empty() {
        errs.push(sp(lp.line, lp.col, "Empty '()' column list in DO UPDATE SET"));
        return false;
    }
    let mut k = 0usize;
    loop {
        if !cols.get(k).is_some_and(|t| is_ident_not_in(t, src, ASSIGN_FORBIDDEN_KWS)) {
            let a = cols.get(k).unwrap_or(lp);
            errs.push(sp(a.line, a.col, "Expected column name in DO UPDATE SET list"));
            return false;
        }
        k += 1;
        if k == cols.len() { return true; }
        if cols[k].kind != SqlTokKind::Comma {
            errs.push(sp(cols[k].line, cols[k].col, "Expected ',' in DO UPDATE SET column list"));
            return false;
        }
        k += 1;
        if k == cols.len() {
            errs.push(sp(cols[k - 1].line, cols[k - 1].col, "Trailing ',' in DO UPDATE SET column list"));
            return false;
        }
    }
}

fn is_ident_not_in(t: &SqlTok, src: &str, forbidden: &[&str]) -> bool {
    match t.kind {
        SqlTokKind::Word => !forbidden.iter().any(|k| t.is_kw(src, k)),
        SqlTokKind::QuotedIdent | SqlTokKind::BracketIdent | SqlTokKind::BacktickIdent => true,
        _ => false,
    }
}
