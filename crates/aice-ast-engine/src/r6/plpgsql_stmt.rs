use crate::r5::checks::{ErrorSpan, collect_ts_error_spans};
use crate::r6::sql_expr::{
    check_sql_stmt_completeness, split_statements_semi, validate_and_collect_trim_masks,
    validate_and_mask_trim_calls,
};
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
use crate::r6::sql_pratt::validate_pratt_expr;
use crate::r6::sql_pratt_ext::check_pg_casts;
use crate::r6::sql_upsert::{validate_and_collect_upsert_masks, validate_and_mask_upsert_clauses};
use crate::ts_pool::{GrammarSlot, ParserPool};

pub enum PgFrame {
    Block { line: usize, col: usize, in_exc: bool },
    If { line: usize, col: usize, seen_else: bool },
    Loop { line: usize, col: usize },
    Case { line: usize, col: usize, seen_else: bool },
}

pub fn handle_end(
    toks: &[SqlTok], body: &str, i: usize, stack: &mut Vec<PgFrame>, errs: &mut Vec<ErrorSpan>,
) -> usize {
    let t = &toks[i];
    let next = toks.get(i + 1);
    let mut cur = i + 1;
    if next.is_some_and(|n| n.is_kw(body, "IF")) {
        if !matches!(stack.pop(), Some(PgFrame::If { .. })) { errs.push(sp(t.line, t.col, "Unmatched END IF")); }
        cur += 1;
    } else if next.is_some_and(|n| n.is_kw(body, "LOOP")) {
        if !matches!(stack.pop(), Some(PgFrame::Loop { .. })) { errs.push(sp(t.line, t.col, "Unmatched END LOOP")); }
        cur += 1;
    } else if next.is_some_and(|n| n.is_kw(body, "CASE")) {
        if !matches!(stack.pop(), Some(PgFrame::Case { .. })) { errs.push(sp(t.line, t.col, "Unmatched END CASE")); }
        cur += 1;
    } else if !matches!(stack.pop(), Some(PgFrame::Block { .. })) {
        errs.push(sp(t.line, t.col, "Unmatched END"));
    }
    if toks.get(cur).is_some_and(|n| n.kind == SqlTokKind::Word) { cur += 1; }
    if toks.get(cur).is_some_and(|n| n.kind == SqlTokKind::Semi) {
        cur + 1
    } else if stack.is_empty() && cur >= toks.len() {
        cur
    } else {
        errs.push(sp(t.line, t.col, "Expected ';' after END"));
        cur
    }
}

pub fn parse_simple_stmt(
    toks: &[SqlTok], body: &str, start: usize, pool: &mut ParserPool, errs: &mut Vec<ErrorSpan>,
) -> usize {
    let mut i = start;
    let mut depth = 0usize;
    let mut cases = 0usize;
    while i < toks.len() {
        let t = &toks[i];
        let not_dot = i == 0 || toks[i - 1].kind != SqlTokKind::Dot;
        if t.kind == SqlTokKind::LParen { depth += 1; }
        else if t.kind == SqlTokKind::RParen { depth = depth.saturating_sub(1); }
        else if not_dot && t.is_kw(body, "CASE") { cases += 1; }
        else if not_dot && t.is_kw(body, "END") && cases > 0 { cases -= 1; }
        else if depth == 0 && t.kind == SqlTokKind::Semi { break; }
        else if depth == 0 && cases == 0 && i > start && not_dot && (t.is_kw(body, "END") || t.is_kw(body, "ELSIF") || t.is_kw(body, "ELSE")
            || (t.is_kw(body, "EXCEPTION") && !(i == start + 1 && toks[start].is_kw(body, "RAISE")))) {
            errs.push(sp(toks[start].line, toks[start].col, "Missing ';' in PL/pgSQL statement"));
            return i;
        }
        i += 1;
    }
    if i >= toks.len() {
        errs.push(sp(toks[start].line, toks[start].col, "Missing ';' at end of PL/pgSQL statement"));
        return i;
    }
    let stmt = &toks[start..i];
    if stmt.is_empty() { return i + 1; }
    if is_dml_start(&stmt[0], body) {
        errs.extend(check_sql_stmt_completeness(stmt, body));
        validate_inner_sql_impl(stmt, body, false, pool, errs);
    } else if stmt[0].is_kw(body, "PERFORM") {
        validate_perform_stmt(stmt, body, pool, errs);
    } else if stmt.len() >= 2 && (stmt[1].is_op(body, ":=") || stmt[1].is_op(body, "=")) {
        let mut idx = 2;
        if let Err(e) = validate_pratt_expr(stmt, body, &mut idx, 0, &[]) { errs.push(e); }
        else if idx < stmt.len() {
            errs.push(sp(stmt[idx].line, stmt[idx].col, "Unexpected trailing token in PL/pgSQL assignment"));
        }
    } else if stmt[0].is_kw(body, "RETURN") && stmt.len() > 1 && !stmt[1].is_kw(body, "NEXT") && !stmt[1].is_kw(body, "QUERY") {
        let mut idx = 1;
        if let Err(e) = validate_pratt_expr(stmt, body, &mut idx, 0, &[]) { errs.push(e); }
        else if idx < stmt.len() {
            errs.push(sp(stmt[idx].line, stmt[idx].col, "Unexpected trailing token in PL/pgSQL RETURN"));
        }
    }
    i + 1
}

fn is_perform_query_kw(t: &SqlTok, body: &str) -> bool {
    t.kind == SqlTokKind::Word && [
        "FROM", "WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET",
        "UNION", "INTERSECT", "EXCEPT", "INTO", "FETCH", "FOR",
    ].iter().any(|k| t.is_kw(body, k))
}

fn validate_perform_stmt(
    stmt: &[SqlTok], body: &str, pool: &mut ParserPool, errs: &mut Vec<ErrorSpan>,
) {
    if stmt.len() < 2 {
        errs.push(sp(stmt[0].line, stmt[0].col, "Empty PERFORM statement"));
        return;
    }
    let mut is_query = stmt[1].is_kw(body, "DISTINCT") || stmt[1].is_kw(body, "ALL");
    let (mut depth, mut cases) = (0usize, 0usize);
    for (idx, t) in stmt[1..].iter().enumerate() {
        let not_dot = stmt[idx].kind != SqlTokKind::Dot;
        if t.kind == SqlTokKind::LParen { depth += 1; }
        else if t.kind == SqlTokKind::RParen { depth = depth.saturating_sub(1); }
        else if not_dot && t.is_kw(body, "CASE") { cases += 1; }
        else if not_dot && t.is_kw(body, "END") && cases > 0 { cases -= 1; }
        else if depth == 0 && cases == 0 && (t.kind == SqlTokKind::Comma || (not_dot && is_perform_query_kw(t, body))) {
            is_query = true;
            break;
        }
    }
    if is_query {
        let p_off = usize::from(stmt[1].is_kw(body, "DISTINCT") || stmt[1].is_kw(body, "ALL"));
        if stmt.get(1 + p_off).is_none_or(|n| n.is_kw(body, "FROM")) {
            errs.push(sp(stmt[0].line, stmt[0].col, "Missing projection list in PERFORM"));
            return;
        }
        errs.extend(check_sql_stmt_completeness(stmt, body));
        validate_inner_sql_impl(stmt, body, true, pool, errs);
    } else {
        let mut idx = 1;
        if let Err(e) = validate_pratt_expr(stmt, body, &mut idx, 0, &[]) { errs.push(e); }
        else if idx < stmt.len() {
            errs.push(sp(stmt[idx].line, stmt[idx].col, "Unexpected trailing token in PL/pgSQL PERFORM"));
        }
    }
}

fn validate_inner_sql_impl(
    stmt: &[SqlTok], body: &str, replace_first_with_select: bool,
    pool: &mut ParserPool, errs: &mut Vec<ErrorSpan>,
) {
    let cast_masks = check_pg_casts(stmt, body, errs);
    let trim_masks = validate_and_collect_trim_masks(stmt, body, errs);
    let upsert_masks = validate_and_collect_upsert_masks(stmt, body, errs);
    let raw = &body[stmt[0].start..stmt[stmt.len() - 1].end];
    let mut cleaned = String::with_capacity(raw.len() + 8);
    let (mut into_state, mut into_has_target, mut into_tok) = (0u8, false, None);
    let (mut mi, mut ci, mut ui) = (0usize, 0usize, 0usize);
    for (idx, t) in stmt.iter().enumerate() {
        while mi < trim_masks.len() && t.start >= trim_masks[mi].1 { mi += 1; }
        while ci < cast_masks.len() && t.start >= cast_masks[ci].1 { ci += 1; }
        while ui < upsert_masks.len() && t.start >= upsert_masks[ui].1 { ui += 1; }
        if (mi < trim_masks.len() && t.start >= trim_masks[mi].0 && t.end <= trim_masks[mi].1)
            || (ci < cast_masks.len() && t.start >= cast_masks[ci].0 && t.end <= cast_masks[ci].1)
            || (ui < upsert_masks.len() && t.start >= upsert_masks[ui].0 && t.end <= upsert_masks[ui].1)
        {
            continue;
        }
        if idx > 0
            && t.is_kw(body, "INTO")
            && stmt[idx - 1].kind != SqlTokKind::Dot
            && !stmt[idx - 1].is_kw(body, "INSERT")
            && !stmt[idx - 1].is_kw(body, "MERGE")
        {
            if into_tok.is_some() {
                errs.push(sp(t.line, t.col, "Duplicate INTO clause in PL/pgSQL statement"));
                into_state = 0;
            } else {
                into_state = 1;
                into_has_target = false;
                into_tok = Some(t);
            }
            continue;
        }
        if into_state > 0 {
            if into_state == 1 && t.is_kw(body, "STRICT") {
                into_state = 2;
                continue;
            }
            let is_ident = matches!(t.kind, SqlTokKind::Word | SqlTokKind::QuotedIdent)
                && !is_into_stop_kw(t, body);
            if matches!(into_state, 1 | 2 | 4) && is_ident {
                into_has_target = true;
                into_state = 3;
                continue;
            }
            if into_state == 3 && t.kind == SqlTokKind::Comma {
                into_state = 2;
                continue;
            }
            if into_state == 3 && t.kind == SqlTokKind::Dot {
                into_state = 4;
                continue;
            }
            if into_state == 3 && (is_into_stop_kw(t, body) || t.kind == SqlTokKind::Semi) {
                into_state = 0;
            } else if into_state == 3 && is_ident {
                errs.push(sp(t.line, t.col, "Expected ',' between INTO target variables"));
                into_state = 0;
            } else {
                if !into_has_target && let Some(it) = into_tok {
                    errs.push(sp(it.line, it.col, "Missing target variable after INTO"));
                } else {
                    errs.push(sp(t.line, t.col, "Malformed INTO target list"));
                }
                into_state = 0;
            }
        }
        if idx == 0 && replace_first_with_select {
            cleaned.push_str("SELECT ");
        } else {
            cleaned.push_str(t.slice(body));
            cleaned.push(' ');
        }
    }
    if into_state > 0 && into_state != 3 {
        if !into_has_target && let Some(it) = into_tok {
            errs.push(sp(it.line, it.col, "Missing target variable after INTO"));
        } else if let Some(it) = into_tok {
            errs.push(sp(it.line, it.col, "Incomplete INTO target list"));
        }
    }
    cleaned.push(';');
    if let Ok(tree) = pool.parse_slot(GrammarSlot::Sql, &cleaned) {
        for mut spn in collect_ts_error_spans(&tree, &cleaned) {
            spn.line = stmt[0].line;
            spn.column = stmt[0].col;
            spn.end_line = stmt[0].line;
            errs.push(spn);
        }
    }
}

pub fn validate_sql_block(toks: &[SqlTok], body: &str, pool: &mut ParserPool, errs: &mut Vec<ErrorSpan>) {
    let mut masked = body.as_bytes().to_vec();
    for stmt in split_statements_semi(toks) {
        errs.extend(check_sql_stmt_completeness(stmt, body));
        for (s, e) in check_pg_casts(stmt, body, errs) {
            for b in &mut masked[s..e] {
                if *b != b'\n' { *b = b' '; }
            }
        }
        validate_and_mask_trim_calls(stmt, body, &mut masked, errs);
        validate_and_mask_upsert_clauses(stmt, body, &mut masked, errs);
    }
    let norm = String::from_utf8(masked).unwrap_or_else(|_| body.to_string());
    if let Ok(tree) = pool.parse_slot(GrammarSlot::Sql, &norm) {
        errs.extend(collect_ts_error_spans(&tree, &norm));
    }
}

fn is_dml_start(t: &SqlTok, body: &str) -> bool {
    ["SELECT", "INSERT", "UPDATE", "DELETE", "WITH"].iter().any(|k| t.is_kw(body, k))
}

fn is_into_stop_kw(t: &SqlTok, body: &str) -> bool {
    t.kind == SqlTokKind::Word && [
        "FROM", "WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET",
        "UNION", "INTERSECT", "EXCEPT", "RETURNING", "FETCH", "FOR", "VALUES", "SET",
    ].iter().any(|k| t.is_kw(body, k))
}
