use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
use crate::r6::sql_pratt::validate_pratt_expr_rp;
use crate::r6::tsql_paren::{
    build_paren_maps, is_alias_tok, is_clause_reset_kw, is_is_distinct_from, is_select_end_kw,
};
pub(crate) use crate::r6::tsql_paren::is_tsql_ident_tok;
use crate::r6::tsql_stmt::{matching_rparen, split_comma_top};

const PREDICATE_STOP_KWS: &[&str] = &[
    "FROM", "WHERE", "GROUP", "HAVING", "ORDER", "UNION", "INTERSECT", "EXCEPT",
    "FOR", "OPTION", "OFFSET", "FETCH", "INNER", "LEFT", "RIGHT", "FULL",
    "CROSS", "OUTER", "JOIN", "APPLY", "SET", "OUTPUT", "WHEN", "THEN",
    "PIVOT", "UNPIVOT", "USING", "WITH", "WINDOW",
];

pub(crate) fn validate_tsql_selects(stmt: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    if !stmt.iter().any(|t| t.is_kw(src, "SELECT")) { return; }
    let (match_rp, _) = build_paren_maps(stmt);
    for (s_idx, tok) in stmt.iter().enumerate() {
        if !tok.is_kw(src, "SELECT") || (s_idx > 0 && stmt[s_idx - 1].kind == SqlTokKind::Dot) { continue; }
        let mut j = s_idx + 1;
        while stmt.get(j).is_some_and(|t| t.is_kw(src, "DISTINCT") || t.is_kw(src, "ALL")) { j += 1; }
        if stmt.get(j).is_some_and(|t| t.is_kw(src, "TOP")) {
            j += 1;
            if stmt.get(j).is_some_and(|t| t.kind == SqlTokKind::LParen) {
                j = if match_rp[j] < stmt.len() { match_rp[j] + 1 } else { stmt.len() };
            } else if j < stmt.len() { j += 1; }
            if stmt.get(j).is_some_and(|t| t.is_kw(src, "PERCENT")) { j += 1; }
            if stmt.get(j).is_some_and(|t| t.is_kw(src, "WITH"))
                && stmt.get(j + 1).is_some_and(|t| t.is_kw(src, "TIES"))
            {
                j += 2;
            }
        }
        let proj_start = j;
        let mut cd = 0usize;
        while j < stmt.len() {
            let t = &stmt[j];
            if t.kind == SqlTokKind::LParen {
                if match_rp[j] < stmt.len() { j = match_rp[j] + 1; continue; }
                j = stmt.len();
                break;
            }
            if t.kind == SqlTokKind::RParen { break; }
            let not_dot = j == 0 || stmt[j - 1].kind != SqlTokKind::Dot;
            if not_dot && t.is_kw(src, "CASE") { cd += 1; }
            else if not_dot && t.is_kw(src, "END") && cd > 0 { cd -= 1; }
            else if cd == 0 && is_select_end_kw(t, src)
                && (j == proj_start || stmt[j - 1].kind != SqlTokKind::Dot)
                && !is_is_distinct_from(stmt, j, proj_start, src)
                && !(t.is_kw(src, "GROUP") && j > proj_start && stmt[j - 1].is_kw(src, "WITHIN"))
            {
                break;
            }
            j += 1;
        }
        let (mut item_lo, mut k) = (proj_start, proj_start);
        while k <= j {
            if k < j && stmt[k].kind == SqlTokKind::LParen {
                k = if match_rp[k] < j { match_rp[k] + 1 } else { j };
                continue;
            }
            if k == j || stmt[k].kind == SqlTokKind::Comma {
                validate_select_item(&stmt[item_lo..k], item_lo, &match_rp, src, errs);
                item_lo = k + 1;
            }
            k += 1;
        }
    }
}

fn validate_select_item(
    item: &[SqlTok], item_lo: usize, match_rp: &[usize], src: &str, errs: &mut Vec<ErrorSpan>,
) {
    if item.is_empty() { return; }
    if item.len() >= 3 && item[0].kind == SqlTokKind::Var
        && matches!(item[1].slice(src), "=" | "+=" | "-=" | "*=" | "/=")
    {
        let mut idx = 2;
        if let Err(e) = validate_pratt_expr_rp(item, src, &mut idx, 0, &[], Some((match_rp, item_lo))) { errs.push(e); }
        else if idx < item.len() {
            errs.push(sp(item[idx].line, item[idx].col, format!("Unexpected token '{}' in SELECT assignment", item[idx].slice(src))));
        }
        return;
    }
    let mut idx = 0;
    if let Err(e) = validate_pratt_expr_rp(item, src, &mut idx, 0, &["AS"], Some((match_rp, item_lo))) {
        errs.push(e);
        return;
    }
    let tail = &item[idx..];
    let ok = tail.is_empty()
        || (tail.len() == 1 && is_alias_tok(&tail[0]))
        || (tail.len() == 2 && tail[0].is_kw(src, "AS") && is_alias_tok(&tail[1]));
    if !ok {
        errs.push(sp(tail[0].line, tail[0].col, format!("Expected ',' or alias before '{}' in SELECT list", tail[0].slice(src))));
    }
}

pub(crate) fn validate_tsql_predicates(stmt: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    if !stmt.iter().any(|t| t.is_kw(src, "WHERE") || t.is_kw(src, "HAVING") || t.is_kw(src, "JOIN") || t.is_kw(src, "MERGE")) {
        return;
    }
    let (match_rp, _) = build_paren_maps(stmt);
    let mut expect_on = vec![false];
    let mut i = 0usize;
    while i < stmt.len() {
        let t = &stmt[i];
        if t.kind == SqlTokKind::LParen {
            expect_on.push(false);
            i += 1;
            continue;
        }
        if t.kind == SqlTokKind::RParen {
            if expect_on.len() > 1 { expect_on.pop(); }
            i += 1;
            continue;
        }
        let is_member = i > 0 && stmt[i - 1].kind == SqlTokKind::Dot;
        if !is_member && (t.is_kw(src, "JOIN") || t.is_kw(src, "MERGE")) {
            if let Some(top) = expect_on.last_mut() { *top = true; }
            i += 1;
            continue;
        }
        let is_on_pred = !is_member && t.is_kw(src, "ON") && expect_on.last().copied().unwrap_or(false);
        let is_wh = !is_member && (t.is_kw(src, "WHERE") || t.is_kw(src, "HAVING"));
        if is_wh || is_on_pred {
            if let Some(top) = expect_on.last_mut() { *top = false; }
            if t.is_kw(src, "WHERE")
                && stmt.get(i + 1).is_some_and(|n| n.is_kw(src, "CURRENT"))
                && stmt.get(i + 2).is_some_and(|n| n.is_kw(src, "OF"))
            {
                i += 3;
                continue;
            }
            let mut idx = i + 1;
            match validate_pratt_expr_rp(stmt, src, &mut idx, 0, PREDICATE_STOP_KWS, Some((&match_rp, 0))) {
                Err(e) => errs.push(e),
                Ok(()) => {
                    if let Some(bad) = stmt.get(idx)
                        && !(matches!(bad.kind, SqlTokKind::RParen | SqlTokKind::Comma | SqlTokKind::Semi)
                            || PREDICATE_STOP_KWS.iter().any(|k| bad.is_kw(src, k)))
                    {
                        errs.push(sp(
                            bad.line,
                            bad.col,
                            format!("Unexpected token '{}' in {} clause", bad.slice(src), t.slice(src)),
                        ));
                    }
                }
            }
            i += 1;
            continue;
        }
        if !is_member && is_clause_reset_kw(t, src) && let Some(top) = expect_on.last_mut() {
            *top = false;
        }
        i += 1;
    }
}

fn validate_col_list(item: &[SqlTok], lp: usize, allow_dir: bool, src: &str, errs: &mut Vec<ErrorSpan>) -> Option<usize> {
    if !item.get(lp).is_some_and(|t| t.kind == SqlTokKind::LParen) {
        let a = item.get(lp).unwrap_or(&item[lp - 1]);
        errs.push(sp(a.line, a.col, "Expected '(' in constraint column list"));
        return None;
    }
    let rp = matching_rparen(item, lp)?;
    let cols = split_comma_top(&item[lp + 1..rp]);
    if cols.is_empty() || (cols.len() == 1 && cols[0].is_empty()) {
        errs.push(sp(item[lp].line, item[lp].col, "Empty column list in constraint"));
        return None;
    }
    for col in cols {
        let ok = !col.is_empty() && is_tsql_ident_tok(&col[0]) && (col.len() == 1
            || (allow_dir && col.len() == 2 && (col[1].is_kw(src, "ASC") || col[1].is_kw(src, "DESC"))));
        if !ok {
            let a = col.first().unwrap_or(&item[lp]);
            errs.push(sp(a.line, a.col, "Invalid column entry in constraint"));
            return None;
        }
    }
    Some(rp + 1)
}

pub(crate) fn validate_key_constraint(item: &[SqlTok], j: usize, src: &str, errs: &mut Vec<ErrorSpan>) {
    let mut k = j + 1;
    if item[j].is_kw(src, "PRIMARY") {
        if !item.get(k).is_some_and(|t| t.is_kw(src, "KEY")) {
            errs.push(sp(item[j].line, item[j].col, "Expected KEY after PRIMARY"));
            return;
        }
        k += 1;
    }
    if item.get(k).is_some_and(|t| t.is_kw(src, "CLUSTERED") || t.is_kw(src, "NONCLUSTERED")) { k += 1; }
    let Some(mut k) = validate_col_list(item, k, true, src, errs) else { return; };
    while k < item.len() {
        if item[k].is_kw(src, "WITH") && item.get(k + 1).is_some_and(|t| t.kind == SqlTokKind::LParen) {
            let Some(rp) = matching_rparen(item, k + 1) else {
                errs.push(sp(item[k + 1].line, item[k + 1].col, "Unclosed '(' in WITH options"));
                return;
            };
            if rp == k + 2 {
                errs.push(sp(item[k + 1].line, item[k + 1].col, "Empty '()' in WITH options"));
                return;
            }
            k = rp + 1;
        } else if item[k].is_kw(src, "ON") && item.get(k + 1).is_some_and(|t| is_tsql_ident_tok(t) || t.kind == SqlTokKind::StringLit) {
            k += 2;
            if item.get(k).is_some_and(|t| t.kind == SqlTokKind::LParen) {
                k = matching_rparen(item, k).map_or(item.len(), |r| r + 1);
            }
        } else if item[k].is_kw(src, "FILESTREAM_ON")
            && item.get(k + 1).is_some_and(|t| is_tsql_ident_tok(t) || t.kind == SqlTokKind::StringLit)
        {
            k += 2;
        } else {
            errs.push(sp(item[k].line, item[k].col, format!("Unexpected token '{}' in key constraint", item[k].slice(src))));
            return;
        }
    }
}

pub(crate) fn validate_fk_constraint(item: &[SqlTok], j: usize, src: &str, errs: &mut Vec<ErrorSpan>) {
    if !item.get(j + 1).is_some_and(|t| t.is_kw(src, "KEY")) {
        errs.push(sp(item[j].line, item[j].col, "Expected KEY after FOREIGN"));
        return;
    }
    let Some(mut k) = validate_col_list(item, j + 2, false, src, errs) else { return; };
    if !item.get(k).is_some_and(|t| t.is_kw(src, "REFERENCES")) {
        let a = item.get(k).unwrap_or(&item[j]);
        errs.push(sp(a.line, a.col, "Expected REFERENCES in FOREIGN KEY constraint"));
        return;
    }
    k += 1;
    if !item.get(k).is_some_and(is_tsql_ident_tok) {
        let a = item.get(k).unwrap_or(&item[k - 1]);
        errs.push(sp(a.line, a.col, "Expected referenced table name"));
        return;
    }
    k += 1;
    while item.get(k).is_some_and(|t| t.kind == SqlTokKind::Dot) {
        if !item.get(k + 1).is_some_and(is_tsql_ident_tok) {
            errs.push(sp(item[k].line, item[k].col, "Expected table name after '.'"));
            return;
        }
        k += 2;
    }
    if item.get(k).is_some_and(|t| t.kind == SqlTokKind::LParen) {
        let Some(next_k) = validate_col_list(item, k, false, src, errs) else { return; };
        k = next_k;
    }
    while k < item.len() {
        if item[k].is_kw(src, "ON") && item.get(k + 1).is_some_and(|t| t.is_kw(src, "DELETE") || t.is_kw(src, "UPDATE")) {
            k += 2;
            if item.get(k).is_some_and(|t| t.is_kw(src, "CASCADE")) { k += 1; }
            else if (item.get(k).is_some_and(|t| t.is_kw(src, "NO")) && item.get(k + 1).is_some_and(|t| t.is_kw(src, "ACTION")))
                || (item.get(k).is_some_and(|t| t.is_kw(src, "SET"))
                    && item.get(k + 1).is_some_and(|t| t.is_kw(src, "NULL") || t.is_kw(src, "DEFAULT")))
            {
                k += 2;
            } else {
                let a = item.get(k).unwrap_or(&item[k - 1]);
                errs.push(sp(a.line, a.col, "Invalid ON DELETE/UPDATE action"));
                return;
            }
        } else if item[k].is_kw(src, "NOT") && item.get(k + 1).is_some_and(|t| t.is_kw(src, "FOR"))
            && item.get(k + 2).is_some_and(|t| t.is_kw(src, "REPLICATION"))
        {
            k += 3;
        } else {
            errs.push(sp(item[k].line, item[k].col, format!("Unexpected token '{}' in FOREIGN KEY constraint", item[k].slice(src))));
            return;
        }
    }
}
