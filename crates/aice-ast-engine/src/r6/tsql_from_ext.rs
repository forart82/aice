use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
use crate::r6::sql_pratt::validate_pratt_expr;
use crate::r6::tsql_dml::{consume_with_hint, validate_col_list};
use crate::r6::tsql_query::is_tsql_ident_tok;
use crate::r6::tsql_stmt::{split_comma_top, validate_tsql_values};

const SYSTIME_STOP_KWS: &[&str] = &[
    "AS", "TABLESAMPLE", "WITH", "PIVOT", "UNPIVOT", "INNER", "LEFT", "RIGHT",
    "FULL", "CROSS", "OUTER", "JOIN", "APPLY", "ON", "WHERE", "OPTION",
    "ORDER", "GROUP", "HAVING", "WINDOW", "OFFSET", "FETCH", "UNION", "INTERSECT", "EXCEPT",
];

fn validate_full_expr(slice: &[SqlTok], ctx: &str, src: &str, errs: &mut Vec<ErrorSpan>) -> bool {
    let mut idx = 0;
    if let Err(e) = validate_pratt_expr(slice, src, &mut idx, 0, &[]) {
        errs.push(e);
        return false;
    }
    if idx < slice.len() {
        errs.push(sp(slice[idx].line, slice[idx].col, format!("Unexpected token '{}' in {ctx}", slice[idx].slice(src))));
        return false;
    }
    true
}

fn require_lparen_rp(
    slice: &[SqlTok], pos: usize, hi: usize, match_rp: &[usize], ctx: &str, errs: &mut Vec<ErrorSpan>,
) -> Option<usize> {
    if pos >= hi || slice[pos].kind != SqlTokKind::LParen {
        let a = slice.get(pos).unwrap_or(&slice[pos - 1]);
        errs.push(sp(a.line, a.col, format!("Expected '(' in {ctx}")));
        return None;
    }
    let rp = match_rp[pos];
    if rp >= hi {
        errs.push(sp(slice[pos].line, slice[pos].col, format!("Unclosed '(' in {ctx}")));
        return None;
    }
    if rp == pos + 1 {
        errs.push(sp(slice[pos].line, slice[pos].col, format!("Empty '()' in {ctx}")));
        return None;
    }
    Some(rp)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn consume_table_mods(
    slice: &[SqlTok], mut pos: usize, hi: usize, match_rp: &[usize],
    seen_sys: &mut bool, seen_samp: &mut bool, seen_with: &mut bool,
    src: &str, errs: &mut Vec<ErrorSpan>,
) -> Option<usize> {
    while pos < hi {
        if !*seen_sys && slice[pos].is_kw(src, "FOR") {
            *seen_sys = true;
            pos = consume_for_system_time(slice, pos, hi, match_rp, src, errs)?;
        } else if !*seen_samp && slice[pos].is_kw(src, "TABLESAMPLE") {
            *seen_samp = true;
            pos = consume_tablesample(slice, pos, hi, match_rp, src, errs)?;
        } else if !*seen_with && slice[pos].is_kw(src, "WITH")
            && pos + 1 < hi && slice[pos + 1].kind == SqlTokKind::LParen
        {
            *seen_with = true;
            pos = consume_with_hint(&slice[..hi], pos, src, errs)?;
        } else {
            break;
        }
    }
    Some(pos)
}

fn consume_for_system_time(
    slice: &[SqlTok], mut pos: usize, hi: usize, match_rp: &[usize],
    src: &str, errs: &mut Vec<ErrorSpan>,
) -> Option<usize> {
    if pos + 1 >= hi || !slice[pos + 1].is_kw(src, "SYSTEM_TIME") {
        errs.push(sp(slice[pos].line, slice[pos].col, "Expected SYSTEM_TIME after FOR in T-SQL FROM"));
        return None;
    }
    pos += 2;
    if pos < hi && slice[pos].is_kw(src, "ALL") { return Some(pos + 1); }
    if pos + 1 < hi && slice[pos].is_kw(src, "AS") && slice[pos + 1].is_kw(src, "OF") {
        pos += 2;
        validate_pratt_expr(&slice[..hi], src, &mut pos, 0, SYSTIME_STOP_KWS).map_err(|e| errs.push(e)).ok()?;
        return Some(pos);
    }
    let sep = if pos < hi && slice[pos].is_kw(src, "FROM") { Some("TO") }
        else if pos < hi && slice[pos].is_kw(src, "BETWEEN") { Some("AND") }
        else { None };
    if let Some(kw) = sep {
        pos += 1;
        validate_pratt_expr(&slice[..hi], src, &mut pos, 0, &[kw]).map_err(|e| errs.push(e)).ok()?;
        if pos >= hi || !slice[pos].is_kw(src, kw) {
            let a = slice.get(pos).unwrap_or(&slice[pos - 1]);
            errs.push(sp(a.line, a.col, format!("Expected {kw} in FOR SYSTEM_TIME")));
            return None;
        }
        pos += 1;
        validate_pratt_expr(&slice[..hi], src, &mut pos, 0, SYSTIME_STOP_KWS).map_err(|e| errs.push(e)).ok()?;
        return Some(pos);
    }
    if pos < hi && slice[pos].is_kw(src, "CONTAINED") {
        pos += 1;
        if pos >= hi || !slice[pos].is_kw(src, "IN") {
            let a = slice.get(pos).unwrap_or(&slice[pos - 1]);
            errs.push(sp(a.line, a.col, "Expected IN after CONTAINED in FOR SYSTEM_TIME"));
            return None;
        }
        let rp = require_lparen_rp(slice, pos + 1, hi, match_rp, "FOR SYSTEM_TIME CONTAINED IN", errs)?;
        let parts = split_comma_top(&slice[pos + 2..rp]);
        if parts.len() != 2 || parts[0].is_empty() || parts[1].is_empty() {
            errs.push(sp(slice[pos + 1].line, slice[pos + 1].col, "FOR SYSTEM_TIME CONTAINED IN requires two expressions"));
            return None;
        }
        for part in parts {
            if !validate_full_expr(part, "FOR SYSTEM_TIME CONTAINED IN", src, errs) { return None; }
        }
        return Some(rp + 1);
    }
    let a = slice.get(pos).unwrap_or(&slice[pos - 1]);
    errs.push(sp(a.line, a.col, "Invalid FOR SYSTEM_TIME clause in T-SQL FROM"));
    None
}

fn consume_tablesample(
    slice: &[SqlTok], mut pos: usize, hi: usize, match_rp: &[usize],
    src: &str, errs: &mut Vec<ErrorSpan>,
) -> Option<usize> {
    pos += 1;
    if pos < hi && slice[pos].is_kw(src, "SYSTEM") { pos += 1; }
    let rp = require_lparen_rp(slice, pos, hi, match_rp, "TABLESAMPLE", errs)?;
    let inner = &slice[pos + 1..rp];
    let mut idx = 0;
    validate_pratt_expr(inner, src, &mut idx, 0, &["PERCENT", "ROWS"]).map_err(|e| errs.push(e)).ok()?;
    if idx < inner.len() && (inner[idx].is_kw(src, "PERCENT") || inner[idx].is_kw(src, "ROWS")) { idx += 1; }
    if idx < inner.len() {
        errs.push(sp(inner[idx].line, inner[idx].col, format!("Unexpected token '{}' in TABLESAMPLE", inner[idx].slice(src))));
        return None;
    }
    pos = rp + 1;
    if pos < hi && slice[pos].is_kw(src, "REPEATABLE") {
        let rrp = require_lparen_rp(slice, pos + 1, hi, match_rp, "TABLESAMPLE REPEATABLE", errs)?;
        if !validate_full_expr(&slice[pos + 2..rrp], "TABLESAMPLE REPEATABLE", src, errs) { return None; }
        pos = rrp + 1;
    }
    Some(pos)
}

pub(super) fn validate_tvf_args(
    inner: &[SqlTok], lp: &SqlTok, src: &str, errs: &mut Vec<ErrorSpan>,
) -> bool {
    if inner.is_empty() { return true; }
    for arg in split_comma_top(inner) {
        if arg.is_empty() {
            errs.push(sp(lp.line, lp.col, "Empty argument in table-valued function"));
            return false;
        }
        if !validate_full_expr(arg, "table-valued function", src, errs) { return false; }
    }
    true
}

pub(super) fn validate_pivot_clause(
    slice: &[SqlTok], pos: usize, rp: usize, is_unpivot: bool, match_rp: &[usize],
    src: &str, errs: &mut Vec<ErrorSpan>,
) -> bool {
    let inner = &slice[pos + 2..rp];
    if inner.is_empty() {
        errs.push(sp(slice[pos + 1].line, slice[pos + 1].col, "Empty '()' in PIVOT/UNPIVOT"));
        return false;
    }
    let mut idx = 0usize;
    if is_unpivot {
        if !is_tsql_ident_tok(&inner[0]) || inner[0].ident_name(src).is_empty() || inner[0].is_kw(src, "FOR") {
            errs.push(sp(inner[0].line, inner[0].col, "Expected value column in UNPIVOT"));
            return false;
        }
        idx = 1;
    } else if let Err(e) = validate_pratt_expr(inner, src, &mut idx, 0, &["FOR"]) {
        errs.push(e);
        return false;
    }
    if !inner.get(idx).is_some_and(|t| t.is_kw(src, "FOR")) {
        let a = inner.get(idx).unwrap_or(&inner[idx.saturating_sub(1)]);
        errs.push(sp(a.line, a.col, "Expected FOR in PIVOT/UNPIVOT"));
        return false;
    }
    idx += 1;
    if !inner.get(idx).is_some_and(|t| is_tsql_ident_tok(t) && !t.ident_name(src).is_empty() && !t.is_kw(src, "IN")) {
        let a = inner.get(idx).unwrap_or(&inner[idx - 1]);
        errs.push(sp(a.line, a.col, "Expected pivot column after FOR in PIVOT/UNPIVOT"));
        return false;
    }
    idx += 1;
    if !inner.get(idx).is_some_and(|t| t.is_kw(src, "IN")) {
        let a = inner.get(idx).unwrap_or(&inner[idx - 1]);
        errs.push(sp(a.line, a.col, "Expected IN after pivot column in PIVOT/UNPIVOT"));
        return false;
    }
    idx += 1;
    if !inner.get(idx).is_some_and(|t| t.kind == SqlTokKind::LParen) {
        let a = inner.get(idx).unwrap_or(&inner[idx - 1]);
        errs.push(sp(a.line, a.col, "Expected '(' after IN in PIVOT/UNPIVOT"));
        return false;
    }
    let in_rp = match_rp[pos + 2 + idx];
    if in_rp >= rp {
        errs.push(sp(inner[idx].line, inner[idx].col, "Unclosed '(' in PIVOT/UNPIVOT IN list"));
        return false;
    }
    if in_rp + 1 != rp {
        let a = &slice[in_rp + 1];
        errs.push(sp(a.line, a.col, format!("Unexpected token '{}' in PIVOT/UNPIVOT", a.slice(src))));
        return false;
    }
    validate_col_list(&slice[pos + 2 + idx + 1..in_rp], &inner[idx], "PIVOT", src, errs)
}

pub(super) fn validate_from_values(
    vals: &[SqlTok], base: usize, match_rp: &[usize], src: &str, errs: &mut Vec<ErrorSpan>,
) -> bool {
    let mut k = 1usize;
    if k >= vals.len() || vals[k].kind != SqlTokKind::LParen {
        errs.push(sp(vals[0].line, vals[0].col, "Expected '(' after VALUES in T-SQL FROM"));
        return false;
    }
    while k < vals.len() && vals[k].kind == SqlTokKind::LParen {
        let rp_abs = match_rp[base + k];
        if rp_abs >= base + vals.len() { return false; }
        if rp_abs == base + k + 1 {
            errs.push(sp(vals[k].line, vals[k].col, "Empty '()' tuple in VALUES"));
            return false;
        }
        k = rp_abs - base + 1;
        if k < vals.len() && vals[k].kind == SqlTokKind::Comma {
            k += 1;
            if k >= vals.len() || vals[k].kind != SqlTokKind::LParen {
                errs.push(sp(vals[k - 1].line, vals[k - 1].col, "Expected '(' after ',' in VALUES"));
                return false;
            }
        } else { break; }
    }
    if k < vals.len() {
        errs.push(sp(vals[k].line, vals[k].col, format!("Unexpected token '{}' in VALUES", vals[k].slice(src))));
        return false;
    }
    let before = errs.len();
    validate_tsql_values(vals, src, errs);
    errs.len() == before
}

pub(super) fn parse_join_kw(slice: &[SqlTok], mut pos: usize, hi: usize, src: &str) -> Option<usize> {
    if slice[pos].is_kw(src, "JOIN") { return Some(pos + 1); }
    let mut dir_seen = false;
    if slice[pos].is_kw(src, "INNER") {
        pos += 1;
        dir_seen = true;
    } else if slice[pos].is_kw(src, "LEFT") || slice[pos].is_kw(src, "RIGHT") || slice[pos].is_kw(src, "FULL") {
        pos += 1;
        dir_seen = true;
        if pos < hi && slice[pos].is_kw(src, "OUTER") { pos += 1; }
    }
    if !dir_seen { return None; }
    if pos < hi && (slice[pos].is_kw(src, "LOOP") || slice[pos].is_kw(src, "HASH")
        || slice[pos].is_kw(src, "MERGE") || slice[pos].is_kw(src, "REMOTE"))
    {
        pos += 1;
    }
    (pos < hi && slice[pos].is_kw(src, "JOIN")).then_some(pos + 1)
}
