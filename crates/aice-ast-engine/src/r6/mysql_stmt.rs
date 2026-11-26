use std::collections::HashMap;

use aice_lang_registry::RdNode;

use crate::r5::checks::ErrorSpan;
use crate::r6::mysql::mysql_ddl_object_idx;
use crate::r6::mysql_ctrl::{
    MyFrame, handle_mysql_end, is_labeled_compound, mark_has_stmt, scan_cond_to_kw,
    validate_mysql_cond, validate_mysql_jump,
};
use crate::r6::mysql_dml::validate_mysql_dml;
use crate::r6::mysql_rd::find_single_stmt_body_start;
use crate::r6::sql_expr::check_sql_stmt_completeness;
use crate::r6::sql_lex::{LineIndex, SqlTok, SqlTokKind, sp};
use crate::r6::sql_symbols::make_rd_node;
use crate::ts_pool::ParserPool;

fn find_routine_body_start(clean: &[SqlTok], src: &str) -> Option<usize> {
    (0..clean.len()).find(|&i| is_labeled_compound(clean, i, src) || clean[i].is_kw(src, "BEGIN"))
}

pub fn validate_mysql_routine(
    clean: &[SqlTok], src: &str, li: &LineIndex, pool: &mut ParserPool,
    errs: &mut Vec<ErrorSpan>, nodes: &mut Vec<RdNode>,
) {
    let Some(first) = clean.first() else { return; };
    let last = &clean[clean.len() - 1];
    let kw_idx = mysql_ddl_object_idx(clean, src).unwrap_or(1);
    let kind_str = if clean.get(kw_idx).is_some_and(|t| t.is_kw(src, "PROCEDURE")) { "procedure" }
        else if clean.get(kw_idx).is_some_and(|t| t.is_kw(src, "FUNCTION")) { "function" }
        else if clean.get(kw_idx).is_some_and(|t| t.is_kw(src, "TRIGGER")) { "trigger" }
        else { "event" };
    if let Some(name) = extract_routine_name(clean, src, kw_idx + 1) {
        nodes.push(make_rd_node(kind_str, Some(name), first.start, last.end, li, src));
    }
    let Some(body_start) = find_routine_body_start(clean, src) else {
        errs.extend(check_sql_stmt_completeness(clean, src));
        if let Some(stmt_start) = find_single_stmt_body_start(clean, kind_str, kw_idx, src, errs) {
            if stmt_start >= clean.len() {
                errs.push(sp(last.line, last.col, "Missing body in MySQL routine"));
            } else {
                let body = &clean[stmt_start..];
                if body[0].is_kw(src, "IF") || body[0].is_kw(src, "WHILE")
                    || body[0].is_kw(src, "LOOP") || body[0].is_kw(src, "REPEAT")
                    || body[0].is_kw(src, "CASE")
                {
                    validate_mysql_block(body, src, pool, errs);
                } else if body[0].kind == SqlTokKind::Semi {
                    errs.push(sp(body[0].line, body[0].col, "Empty ';' in MySQL routine body"));
                } else {
                    validate_mysql_dml(body, src, pool, errs);
                }
            }
        }
        return;
    };
    errs.extend(check_sql_stmt_completeness(&clean[..body_start], src));
    validate_mysql_block(&clean[body_start..], src, pool, errs);
}

fn extract_routine_name(clean: &[SqlTok], src: &str, mut i: usize) -> Option<String> {
    if clean.get(i).is_some_and(|t| t.is_kw(src, "IF")) {
        while i < clean.len() && !clean[i].is_kw(src, "EXISTS") { i += 1; }
        i += 1;
    }
    let first = clean.get(i)?;
    let mut name = first.ident_name(src);
    if clean.get(i + 1).is_some_and(|t| t.kind == SqlTokKind::Dot) && let Some(n2) = clean.get(i + 2) {
        name = format!("{name}.{}", n2.ident_name(src));
    }
    Some(name)
}

fn push_label(
    lbl: &Option<String>, is_loop: bool, labels: &mut HashMap<String, (usize, usize)>,
) {
    if let Some(name) = lbl {
        let entry = labels.entry(name.to_ascii_lowercase()).or_insert((0, 0));
        entry.0 += 1;
        if is_loop { entry.1 += 1; }
    }
}

fn validate_mysql_block(toks: &[SqlTok], src: &str, pool: &mut ParserPool, errs: &mut Vec<ErrorSpan>) {
    let mut stack: Vec<MyFrame> = Vec::new();
    let mut labels: HashMap<String, (usize, usize)> = HashMap::new();
    let mut i = 0usize;
    while i < toks.len() {
        let mut pending_lbl: Option<String> = None;
        if is_labeled_compound(toks, i, src) {
            let lbl_tok = &toks[i];
            let name = lbl_tok.ident_name(src);
            if name.is_empty() {
                errs.push(sp(lbl_tok.line, lbl_tok.col, "Empty MySQL block label"));
            } else if labels.contains_key(&name.to_ascii_lowercase()) {
                errs.push(sp(lbl_tok.line, lbl_tok.col, format!("Duplicate MySQL label '{name}'")));
            }
            if !name.is_empty() {
                pending_lbl = Some(name);
            }
            i += 2;
        }
        let t = &toks[i];
        if t.is_kw(src, "BEGIN") {
            mark_has_stmt(&mut stack);
            push_label(&pending_lbl, false, &mut labels);
            stack.push(MyFrame::Begin(t.line, t.col, pending_lbl, false));
            i += 1;
        } else if t.is_kw(src, "IF") {
            mark_has_stmt(&mut stack);
            stack.push(MyFrame::If(t.line, t.col, false, false));
            i = scan_cond_to_kw(toks, src, i + 1, t, "THEN", "Expected THEN after MySQL IF condition", errs);
        } else if t.is_kw(src, "ELSEIF") {
            match stack.last_mut() {
                Some(MyFrame::If(_, _, false, has)) => {
                    if !*has { errs.push(sp(t.line, t.col, "Empty branch in MySQL IF statement")); }
                    *has = false;
                }
                _ => errs.push(sp(t.line, t.col, "Unexpected ELSEIF outside IF")),
            }
            i = scan_cond_to_kw(toks, src, i + 1, t, "THEN", "Expected THEN after ELSEIF", errs);
        } else if t.is_kw(src, "ELSE") {
            match stack.last_mut() {
                Some(MyFrame::If(_, _, seen, has)) => {
                    if *seen { errs.push(sp(t.line, t.col, "Duplicate ELSE in MySQL block")); }
                    else {
                        if !*has { errs.push(sp(t.line, t.col, "Empty branch in MySQL IF statement")); }
                        *seen = true;
                        *has = false;
                    }
                }
                Some(MyFrame::Case(_, _, seen_when, seen_else, has)) => {
                    if !*seen_when { errs.push(sp(t.line, t.col, "Unexpected ELSE before WHEN in MySQL CASE")); }
                    else if *seen_else { errs.push(sp(t.line, t.col, "Duplicate ELSE in MySQL block")); }
                    else {
                        if !*has { errs.push(sp(t.line, t.col, "Empty branch in MySQL CASE statement")); }
                        *seen_else = true;
                        *has = false;
                    }
                }
                _ => errs.push(sp(t.line, t.col, "Unexpected ELSE outside MySQL IF/CASE")),
            }
            i += 1;
        } else if t.is_kw(src, "WHILE") {
            mark_has_stmt(&mut stack);
            push_label(&pending_lbl, true, &mut labels);
            stack.push(MyFrame::While(t.line, t.col, pending_lbl, false));
            i = scan_cond_to_kw(toks, src, i + 1, t, "DO", "Expected DO after WHILE", errs);
        } else if t.is_kw(src, "LOOP") {
            mark_has_stmt(&mut stack);
            push_label(&pending_lbl, true, &mut labels);
            stack.push(MyFrame::Loop(t.line, t.col, pending_lbl, false));
            i += 1;
        } else if t.is_kw(src, "REPEAT") {
            mark_has_stmt(&mut stack);
            push_label(&pending_lbl, true, &mut labels);
            stack.push(MyFrame::Repeat(t.line, t.col, false, pending_lbl, false));
            i += 1;
        } else if t.is_kw(src, "UNTIL") {
            match stack.last_mut() {
                Some(MyFrame::Repeat(_, _, seen, _, _)) => {
                    if *seen { errs.push(sp(t.line, t.col, "Duplicate UNTIL in REPEAT block")); }
                    *seen = true;
                }
                _ => errs.push(sp(t.line, t.col, "Unexpected UNTIL outside REPEAT")),
            }
            i += 1;
            let cond_start = i;
            let (mut d, mut c) = (0usize, 0usize);
            while i < toks.len() {
                let not_dot = i == 0 || toks[i - 1].kind != SqlTokKind::Dot;
                if toks[i].kind == SqlTokKind::LParen { d += 1; }
                else if toks[i].kind == SqlTokKind::RParen { d = d.saturating_sub(1); }
                else if not_dot && toks[i].is_kw(src, "CASE") { c += 1; }
                else if not_dot && toks[i].is_kw(src, "END") && c > 0 { c -= 1; }
                else if d == 0 && c == 0 && (toks[i].kind == SqlTokKind::Semi || (not_dot && toks[i].is_kw(src, "END"))) { break; }
                i += 1;
            }
            validate_mysql_cond(
                &toks[cond_start..i],
                src,
                t,
                "Empty UNTIL condition in REPEAT",
                "Unexpected trailing token in REPEAT UNTIL condition",
                errs,
            );
            if toks.get(i).is_some_and(|n| n.kind == SqlTokKind::Semi) {
                errs.push(sp(toks[i].line, toks[i].col, "Unexpected ';' before END REPEAT"));
                i += 1;
            }
        } else if t.is_kw(src, "CASE") {
            mark_has_stmt(&mut stack);
            let mut j = i + 1;
            let (mut d, mut c) = (0usize, 0usize);
            while j < toks.len() {
                let not_dot = j == 0 || toks[j - 1].kind != SqlTokKind::Dot;
                if toks[j].kind == SqlTokKind::LParen { d += 1; }
                else if toks[j].kind == SqlTokKind::RParen { d = d.saturating_sub(1); }
                else if not_dot && toks[j].is_kw(src, "CASE") { c += 1; }
                else if not_dot && toks[j].is_kw(src, "END") && c > 0 { c -= 1; }
                else if d == 0 && c == 0 && (toks[j].kind == SqlTokKind::Semi || (not_dot && (toks[j].is_kw(src, "WHEN")
                    || toks[j].is_kw(src, "END") || toks[j].is_kw(src, "ELSE")))) { break; }
                j += 1;
            }
            if j > i + 1 {
                validate_mysql_cond(
                    &toks[i + 1..j], src, t, "", "Unexpected trailing token in MySQL CASE selector", errs,
                );
            }
            if !toks.get(j).is_some_and(|n| n.is_kw(src, "WHEN")) {
                errs.push(sp(t.line, t.col, "Expected WHEN in MySQL CASE statement"));
            }
            stack.push(MyFrame::Case(t.line, t.col, false, false, false));
            i = j;
        } else if t.is_kw(src, "WHEN") {
            match stack.last_mut() {
                Some(MyFrame::Case(_, _, seen_when, seen_else, has)) => {
                    if *seen_else { errs.push(sp(t.line, t.col, "Unexpected WHEN after ELSE in MySQL CASE")); }
                    else if *seen_when && !*has {
                        errs.push(sp(t.line, t.col, "Empty branch in MySQL CASE statement"));
                    }
                    *seen_when = true;
                    *has = false;
                }
                _ => errs.push(sp(t.line, t.col, "Unexpected WHEN outside MySQL CASE")),
            }
            i = scan_cond_to_kw(toks, src, i + 1, t, "THEN", "Expected THEN after MySQL WHEN", errs);
        } else if t.is_kw(src, "END") {
            i = handle_mysql_end(toks, src, i, &mut stack, &mut labels, errs);
        } else {
            let start = i;
            let (mut depth, mut cases) = (0usize, 0usize);
            while i < toks.len() {
                let not_dot = i == 0 || toks[i - 1].kind != SqlTokKind::Dot;
                if toks[i].kind == SqlTokKind::LParen { depth += 1; }
                else if toks[i].kind == SqlTokKind::RParen { depth = depth.saturating_sub(1); }
                else if not_dot && toks[i].is_kw(src, "CASE") { cases += 1; }
                else if not_dot && toks[i].is_kw(src, "END") && cases > 0 { cases -= 1; }
                else if depth == 0
                    && (toks[i].kind == SqlTokKind::Semi
                        || (cases == 0 && i > start && not_dot && toks[i].is_kw(src, "END")))
                { break; }
                i += 1;
            }
            if i >= toks.len() || toks[i].kind != SqlTokKind::Semi {
                errs.push(sp(toks[start].line, toks[start].col, "Missing ';' in MySQL block statement"));
            }
            let stmt = &toks[start..i];
            if stmt.is_empty() {
                errs.push(sp(toks[start].line, toks[start].col, "Empty ';' statement in MySQL block"));
            } else {
                mark_has_stmt(&mut stack);
                if stmt[0].is_kw(src, "LEAVE") || stmt[0].is_kw(src, "ITERATE") {
                    validate_mysql_jump(stmt, src, &labels, errs);
                } else {
                    validate_mysql_dml(stmt, src, pool, errs);
                }
            }
            if i < toks.len() && toks[i].kind == SqlTokKind::Semi { i += 1; }
        }
    }
    for f in stack {
        let (l, c, k) = match f {
            MyFrame::Begin(l, c, ..) => (l, c, "BEGIN"),
            MyFrame::If(l, c, ..) => (l, c, "IF"),
            MyFrame::Loop(l, c, ..) => (l, c, "LOOP"),
            MyFrame::While(l, c, ..) => (l, c, "WHILE"),
            MyFrame::Repeat(l, c, ..) => (l, c, "REPEAT"),
            MyFrame::Case(l, c, ..) => (l, c, "CASE"),
        };
        errs.push(sp(l, c, format!("Unclosed MySQL '{k}' block")));
    }
}
