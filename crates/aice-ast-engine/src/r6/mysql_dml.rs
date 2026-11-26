use crate::r5::checks::{ErrorSpan, collect_ts_error_spans};
use crate::r6::mysql_rd::validate_mysql_set_special;
use crate::r6::mysql_ts_norm::{collect_mysql_clause_masks, validate_mysql_lock_tables};
use crate::r6::sql_expr::{check_sql_stmt_completeness, validate_and_collect_trim_masks};
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
use crate::r6::sql_pratt::validate_pratt_expr;
use crate::ts_pool::{GrammarSlot, ParserPool};

pub fn validate_mysql_dml(stmt: &[SqlTok], src: &str, pool: &mut ParserPool, errs: &mut Vec<ErrorSpan>) {
    if stmt.is_empty() { return; }
    errs.extend(check_sql_stmt_completeness(stmt, src));
    if validate_mysql_lock_tables(stmt, src, errs) { return; }
    if stmt[0].is_kw(src, "DECLARE") || stmt[0].is_kw(src, "LEAVE") || stmt[0].is_kw(src, "ITERATE") || stmt[0].is_kw(src, "SIGNAL") {
        if stmt.len() < 2 { errs.push(sp(stmt[0].line, stmt[0].col, "Incomplete MySQL control statement")); }
        return;
    }
    if stmt[0].is_kw(src, "RETURN") {
        if stmt.len() == 1 {
            errs.push(sp(stmt[0].line, stmt[0].col, "Expected expression after RETURN in MySQL"));
        } else {
            let mut idx = 1;
            if let Err(e) = validate_pratt_expr(stmt, src, &mut idx, 0, &[]) { errs.push(e); }
            else if idx < stmt.len() {
                errs.push(sp(stmt[idx].line, stmt[idx].col, "Unexpected trailing token in MySQL RETURN"));
            }
        }
        return;
    }
    if stmt[0].is_kw(src, "SET") {
        if stmt.len() >= 2 && (stmt[1].is_kw(src, "NAMES")
            || stmt[1].is_kw(src, "CHARSET")
            || (stmt[1].is_kw(src, "CHARACTER") && stmt.get(2).is_some_and(|t| t.is_kw(src, "SET")))
            || stmt[1].is_kw(src, "TRANSACTION")
            || ((stmt[1].is_kw(src, "SESSION") || stmt[1].is_kw(src, "GLOBAL"))
                && stmt.get(2).is_some_and(|t| t.is_kw(src, "TRANSACTION"))))
        {
            validate_mysql_set_special(stmt, src, errs);
            return;
        }
        if stmt.len() >= 3
            && let Some(eq) = stmt.iter().position(|t| t.is_op(src, "=") || t.is_op(src, ":="))
        {
            let mut idx = eq + 1;
            loop {
                if let Err(e) = validate_pratt_expr(stmt, src, &mut idx, 0, &[]) { errs.push(e); break; }
                if stmt.get(idx).is_some_and(|t| t.kind == SqlTokKind::Comma) {
                    idx += 1;
                    let Some(rel_eq) = stmt[idx..].iter().position(|t| t.is_op(src, "=") || t.is_op(src, ":=")) else {
                        if let Some(u) = stmt.get(idx) {
                            errs.push(sp(u.line, u.col, "Expected '=' in MySQL SET assignment"));
                        }
                        break;
                    };
                    idx += rel_eq + 1;
                    continue;
                }
                if idx < stmt.len() {
                    errs.push(sp(stmt[idx].line, stmt[idx].col, "Unexpected trailing token in MySQL SET"));
                }
                break;
            }
            return;
        }
    }
    let on_dup = stmt.windows(3).position(|w| w[0].is_kw(src, "ON") && w[1].is_kw(src, "DUPLICATE") && w[2].is_kw(src, "KEY"));
    let core = if let Some(pos) = on_dup {
        if let Some(u) = stmt[pos..].iter().position(|t| t.is_kw(src, "UPDATE")) {
            let assigns = &stmt[pos + u + 1..];
            if assigns.is_empty() {
                errs.push(sp(stmt[pos + u].line, stmt[pos + u].col, "Empty ON DUPLICATE KEY UPDATE clause"));
            } else {
                validate_on_dup_updates(assigns, src, errs);
            }
        } else {
            errs.push(sp(stmt[pos].line, stmt[pos].col, "Expected UPDATE after ON DUPLICATE KEY"));
        }
        strip_insert_row_alias(&stmt[..pos], src)
    } else {
        strip_insert_row_alias(stmt, src)
    };
    if let Some(f) = core.first() {
        let s = tokens_to_ts_sql(core, src, errs);
        if let Ok(tree) = pool.parse_slot(GrammarSlot::Sql, &s) {
            for mut spn in collect_ts_error_spans(&tree, &s) {
                if spn.line == 1 { spn.column += f.col - 1; }
                spn.line += f.line - 1;
                spn.end_line += f.line - 1;
                errs.push(spn);
            }
        }
    }
}

fn is_ident_tok(t: &SqlTok) -> bool {
    matches!(t.kind, SqlTokKind::Word | SqlTokKind::BacktickIdent | SqlTokKind::QuotedIdent)
}

fn has_top_level_values(toks: &[SqlTok], src: &str) -> bool {
    let mut d = 0usize;
    for t in toks {
        match t.kind {
            SqlTokKind::LParen => d += 1,
            SqlTokKind::RParen => d = d.saturating_sub(1),
            _ if d == 0 && (t.is_kw(src, "VALUES") || t.is_kw(src, "VALUE")) => return true,
            _ => {}
        }
    }
    false
}

fn is_ident_list(toks: &[SqlTok]) -> bool {
    !toks.is_empty()
        && toks.len() % 2 == 1
        && toks.iter().enumerate().all(|(i, t)| {
            if i % 2 == 0 { is_ident_tok(t) } else { t.kind == SqlTokKind::Comma }
        })
}

fn strip_insert_row_alias<'a>(core: &'a [SqlTok], src: &str) -> &'a [SqlTok] {
    if !core.first().is_some_and(|t| t.is_kw(src, "INSERT")) || !has_top_level_values(core, src) {
        return core;
    }
    let n = core.len();
    if n >= 3 && core[n - 2].is_kw(src, "AS") && is_ident_tok(&core[n - 1]) && core[n - 3].kind == SqlTokKind::RParen {
        return &core[..n - 2];
    }
    if core.last().is_some_and(|t| t.kind == SqlTokKind::RParen) {
        let mut d = 0usize;
        for idx in (0..n).rev() {
            match core[idx].kind {
                SqlTokKind::RParen => d += 1,
                SqlTokKind::LParen => {
                    d -= 1;
                    if d == 0 {
                        if idx >= 3
                            && core[idx - 2].is_kw(src, "AS")
                            && is_ident_tok(&core[idx - 1])
                            && core[idx - 3].kind == SqlTokKind::RParen
                            && is_ident_list(&core[idx + 1..n - 1])
                        {
                            return &core[..idx - 2];
                        }
                        break;
                    }
                }
                _ => {}
            }
        }
    }
    core
}

fn validate_on_dup_updates(assigns: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    let (mut start, mut d) = (0usize, 0usize);
    for idx in 0..=assigns.len() {
        let at_end = idx == assigns.len();
        let at_comma = !at_end && assigns[idx].kind == SqlTokKind::Comma && d == 0;
        if !at_end {
            match assigns[idx].kind {
                SqlTokKind::LParen => d += 1,
                SqlTokKind::RParen => d = d.saturating_sub(1),
                _ => {}
            }
        }
        if at_end || at_comma {
            let item = &assigns[start..idx];
            if !item.is_empty() {
                if !is_ident_tok(&item[0]) {
                    errs.push(sp(item[0].line, item[0].col, "Expected column name in ON DUPLICATE KEY UPDATE"));
                } else {
                    let mut j = 1usize;
                    if item.get(j).is_some_and(|t| t.kind == SqlTokKind::Dot) && item.get(j + 1).is_some_and(is_ident_tok) {
                        j += 2;
                    }
                    if !item.get(j).is_some_and(|t| t.is_op(src, "=")) {
                        let a = item.get(j).unwrap_or(&item[0]);
                        errs.push(sp(a.line, a.col, "Expected '=' in ON DUPLICATE KEY UPDATE"));
                    } else {
                        let mut p = j + 1;
                        if let Err(e) = validate_pratt_expr(item, src, &mut p, 0, &[]) {
                            errs.push(e);
                        } else if p < item.len() {
                            errs.push(sp(
                                item[p].line,
                                item[p].col,
                                format!("Unexpected token '{}' in ON DUPLICATE KEY UPDATE", item[p].slice(src)),
                            ));
                        }
                    }
                }
            }
            start = idx + 1;
        }
    }
}

fn is_bt_sep_neighbor(k: SqlTokKind) -> bool {
    matches!(
        k,
        SqlTokKind::Word
            | SqlTokKind::Number
            | SqlTokKind::BacktickIdent
            | SqlTokKind::QuotedIdent
            | SqlTokKind::StringLit
            | SqlTokKind::Var
            | SqlTokKind::Param
    )
}

pub(crate) fn tokens_to_ts_sql(toks: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) -> String {
    let Some(first) = toks.first() else { return ";".to_string(); };
    let mut raw_masks = validate_and_collect_trim_masks(toks, src, errs);
    raw_masks.extend(collect_mysql_clause_masks(toks, src, errs));
    raw_masks.sort_unstable_by_key(|m| m.0);
    let mut masks: Vec<(usize, usize)> = Vec::with_capacity(raw_masks.len());
    for (s, e) in raw_masks {
        if let Some(last) = masks.last_mut() && s <= last.1 {
            last.1 = last.1.max(e);
        } else {
            masks.push((s, e));
        }
    }
    let mut out = String::with_capacity(toks.last().map_or(0, |l| l.end - first.start) + 8);
    let mut cur = first.start;
    let mut mi = 0usize;
    for (idx, t) in toks.iter().enumerate() {
        if t.start > cur {
            let gap = &src[cur..t.start];
            for ch in gap.chars() {
                out.push(if ch == '\n' { '\n' } else { ' ' });
            }
        }
        while mi < masks.len() && t.start >= masks[mi].1 {
            mi += 1;
        }
        let is_masked = mi < masks.len() && t.start >= masks[mi].0 && t.end <= masks[mi].1;
        if t.kind == SqlTokKind::BacktickIdent {
            if t.ident_name(src).is_empty() {
                errs.push(sp(t.line, t.col, "Empty backtick identifier"));
            }
            if is_masked {
                for ch in t.slice(src).chars() {
                    out.push(if ch == '\n' { '\n' } else { ' ' });
                }
            } else {
                let need_lead = idx > 0
                    && toks[idx - 1].end == t.start
                    && !out.ends_with(' ')
                    && !out.ends_with('\n')
                    && is_bt_sep_neighbor(toks[idx - 1].kind);
                let need_trail = toks
                    .get(idx + 1)
                    .is_some_and(|n| n.start == t.end && is_bt_sep_neighbor(n.kind));
                let sep = usize::from(need_lead) + usize::from(need_trail);
                let w = t.slice(src).chars().count();
                let ph = match w.saturating_sub(sep) {
                    0 | 1 => "_",
                    2 => "_b",
                    _ => "_bt",
                };
                if need_lead { out.push(' '); }
                out.push_str(ph);
                for _ in (sep + ph.len())..w { out.push(' '); }
                if need_trail { out.push(' '); }
            }
        } else if is_masked {
            for ch in t.slice(src).chars() {
                out.push(if ch == '\n' { '\n' } else { ' ' });
            }
        } else if idx > 0
            && (t.is_kw(src, "UNSIGNED") || t.is_kw(src, "SIGNED"))
            && toks[idx - 1].is_kw(src, "AS")
            && toks.get(idx + 1).is_some_and(|n| n.kind == SqlTokKind::RParen)
        {
            let w = t.slice(src).len();
            out.push_str("INT");
            for _ in 3..w { out.push(' '); }
        } else {
            out.push_str(t.slice(src));
        }
        cur = t.end;
    }
    out.push(';');
    out
}
