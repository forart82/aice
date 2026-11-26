use crate::r5::checks::ErrorSpan;
use crate::r6::plpgsql_stmt::{PgFrame, handle_end, parse_simple_stmt};
use crate::r6::sql_expr::{check_delimiters, strip_comments};
use crate::r6::sql_lex::{LexOpts, SqlTok, SqlTokKind, lex_sql, sp};
use crate::r6::sql_pratt::validate_pratt_expr;
use crate::ts_pool::ParserPool;

pub fn verify_plpgsql_body(
    body: &str,
    base_line: usize,
    base_col: usize,
    pool: &mut ParserPool,
) -> Vec<ErrorSpan> {
    let opts = LexOpts { nested_block_comments: true, ..LexOpts::default() };
    let (toks, mut errs, _) = lex_sql(body, opts);
    let clean = strip_comments(&toks);
    errs.extend(check_delimiters(&clean));
    if !clean.is_empty() {
        parse_plpgsql_tokens(&clean, body, pool, &mut errs);
    }
    for e in &mut errs {
        if e.line == 1 { e.column += base_col - 1; }
        e.line += base_line - 1;
        e.end_line += base_line - 1;
    }
    errs
}

fn parse_plpgsql_tokens(
    toks: &[SqlTok],
    body: &str,
    pool: &mut ParserPool,
    errs: &mut Vec<ErrorSpan>,
) {
    let mut i = skip_label(toks, body, 0);
    if toks.get(i).is_some_and(|t| t.is_kw(body, "DECLARE")) {
        i = parse_declare_section(toks, body, i + 1, errs);
    }
    if !toks.get(i).is_some_and(|t| t.is_kw(body, "BEGIN")) {
        crate::r6::plpgsql_stmt::validate_sql_block(toks, body, pool, errs);
        return;
    }
    let mut stack = vec![PgFrame::Block {
        line: toks[i].line,
        col: toks[i].col,
        in_exc: false,
    }];
    i += 1;

    while i < toks.len() {
        i = skip_label(toks, body, i);
        if i >= toks.len() { break; }
        let t = &toks[i];
        if stack.is_empty() {
            errs.push(sp(t.line, t.col, "Unexpected token after PL/pgSQL block END"));
            break;
        }
        if t.is_kw(body, "DECLARE") {
            i = parse_declare_section(toks, body, i + 1, errs);
            continue;
        }
        if t.is_kw(body, "BEGIN") {
            stack.push(PgFrame::Block { line: t.line, col: t.col, in_exc: false });
            i += 1;
            continue;
        }
        if t.is_kw(body, "EXCEPTION") {
            match stack.last_mut() {
                Some(PgFrame::Block { in_exc, .. }) if !*in_exc => *in_exc = true,
                _ => errs.push(sp(t.line, t.col, "Unexpected EXCEPTION outside BEGIN block")),
            }
            i += 1;
            continue;
        }
        if t.is_kw(body, "WHEN") {
            i = scan_to_kw(toks, body, i + 1, "THEN", errs);
            continue;
        }
        if t.is_kw(body, "IF") {
            let cond_start = i + 1;
            i = scan_if_then(toks, body, cond_start, errs);
            stack.push(PgFrame::If { line: t.line, col: t.col, seen_else: false });
            continue;
        }
        if t.is_kw(body, "ELSIF") || t.is_kw(body, "ELSEIF") {
            if !matches!(stack.last(), Some(PgFrame::If { seen_else: false, .. })) {
                errs.push(sp(t.line, t.col, "Unexpected ELSIF outside IF"));
            }
            i = scan_if_then(toks, body, i + 1, errs);
            continue;
        }
        if t.is_kw(body, "ELSE") {
            match stack.last_mut() {
                Some(PgFrame::If { seen_else, .. }) | Some(PgFrame::Case { seen_else, .. })
                    if !*seen_else => *seen_else = true,
                _ => errs.push(sp(t.line, t.col, "Unexpected ELSE")),
            }
            i += 1;
            continue;
        }
        if t.is_kw(body, "CASE") {
            let sel_start = i + 1;
            let (mut j, mut d, mut c) = (sel_start, 0usize, 0usize);
            while j < toks.len() {
                let not_dot = j == 0 || toks[j - 1].kind != SqlTokKind::Dot;
                if toks[j].kind == SqlTokKind::LParen { d += 1; }
                else if toks[j].kind == SqlTokKind::RParen { d = d.saturating_sub(1); }
                else if not_dot && toks[j].is_kw(body, "CASE") { c += 1; }
                else if not_dot && toks[j].is_kw(body, "END") && c > 0 { c -= 1; }
                else if d == 0 && c == 0 && (toks[j].kind == SqlTokKind::Semi || (not_dot && (toks[j].is_kw(body, "WHEN")
                    || toks[j].is_kw(body, "END") || toks[j].is_kw(body, "ELSE")))) { break; }
                j += 1;
            }
            if j > sel_start {
                let mut idx = 0;
                if let Err(e) = validate_pratt_expr(&toks[sel_start..j], body, &mut idx, 0, &[]) { errs.push(e); }
                else if sel_start + idx < j {
                    let u = &toks[sel_start + idx];
                    errs.push(sp(u.line, u.col, "Unexpected trailing token in PL/pgSQL CASE selector"));
                }
            }
            if !toks.get(j).is_some_and(|n| n.is_kw(body, "WHEN") && (j == 0 || toks[j - 1].kind != SqlTokKind::Dot)) {
                errs.push(sp(t.line, t.col, "Expected WHEN in PL/pgSQL CASE statement"));
            }
            stack.push(PgFrame::Case { line: t.line, col: t.col, seen_else: false });
            i = j;
            continue;
        }
        if t.is_kw(body, "LOOP") {
            stack.push(PgFrame::Loop { line: t.line, col: t.col });
            i += 1;
            continue;
        }
        if t.is_kw(body, "WHILE") || t.is_kw(body, "FOR") || t.is_kw(body, "FOREACH") {
            i = scan_to_kw(toks, body, i + 1, "LOOP", errs);
            stack.push(PgFrame::Loop { line: t.line, col: t.col });
            continue;
        }
        if t.is_kw(body, "END") {
            i = handle_end(toks, body, i, &mut stack, errs);
            continue;
        }
        i = parse_simple_stmt(toks, body, i, pool, errs);
    }

    for frame in stack {
        let (line, col, kind) = match frame {
            PgFrame::Block { line, col, .. } => (line, col, "BEGIN"),
            PgFrame::If { line, col, .. } => (line, col, "IF"),
            PgFrame::Loop { line, col } => (line, col, "LOOP"),
            PgFrame::Case { line, col, .. } => (line, col, "CASE"),
        };
        errs.push(sp(line, col, format!("Unclosed PL/pgSQL '{kind}' block")));
    }
}

fn skip_label(toks: &[SqlTok], body: &str, mut i: usize) -> usize {
    if toks.get(i).is_some_and(|t| t.is_op(body, "<"))
        && toks.get(i + 1).is_some_and(|t| t.is_op(body, "<"))
        && toks.get(i + 2).is_some_and(|t| t.kind == SqlTokKind::Word)
        && toks.get(i + 3).is_some_and(|t| t.is_op(body, ">"))
        && toks.get(i + 4).is_some_and(|t| t.is_op(body, ">"))
    {
        i += 5;
    }
    i
}

fn parse_declare_section(
    toks: &[SqlTok], body: &str, mut i: usize, errs: &mut Vec<ErrorSpan>,
) -> usize {
    while i < toks.len() && !toks[i].is_kw(body, "BEGIN") {
        let start = i;
        while i < toks.len() && toks[i].kind != SqlTokKind::Semi && !toks[i].is_kw(body, "BEGIN") {
            i += 1;
        }
        if i == start { i += 1; continue; }
        if i >= toks.len() || toks[i].is_kw(body, "BEGIN") {
            errs.push(sp(toks[start].line, toks[start].col, "Missing ';' in DECLARE section"));
            break;
        }
        let decl = &toks[start..i];
        if decl.len() < 2 {
            errs.push(sp(decl[0].line, decl[0].col, "Incomplete variable declaration"));
        } else if let Some(pos) = decl.iter().position(|t| t.is_op(body, ":=") || t.is_kw(body, "DEFAULT")) {
            let mut idx = pos + 1;
            if let Err(e) = validate_pratt_expr(decl, body, &mut idx, 0, &[]) { errs.push(e); }
            else if idx < decl.len() {
                errs.push(sp(decl[idx].line, decl[idx].col, "Unexpected trailing token in DECLARE initializer"));
            }
        }
        i += 1;
    }
    i
}

fn scan_if_then(toks: &[SqlTok], body: &str, mut i: usize, errs: &mut Vec<ErrorSpan>) -> usize {
    let start = i;
    let mut depth = 0usize;
    let mut cases = 0usize;
    while i < toks.len() {
        let t = &toks[i];
        let not_dot = i == 0 || toks[i - 1].kind != SqlTokKind::Dot;
        if t.kind == SqlTokKind::LParen { depth += 1; }
        else if t.kind == SqlTokKind::RParen { depth = depth.saturating_sub(1); }
        else if not_dot && t.is_kw(body, "CASE") { cases += 1; }
        else if not_dot && t.is_kw(body, "END") && cases > 0 { cases -= 1; }
        else if depth == 0 && cases == 0 && not_dot && t.is_kw(body, "THEN") {
            if i == start { errs.push(sp(t.line, t.col, "Empty condition before THEN")); }
            else {
                let mut idx = 0;
                if let Err(e) = validate_pratt_expr(&toks[start..i], body, &mut idx, 0, &[]) {
                    errs.push(e);
                } else if start + idx < i {
                    let u = &toks[start + idx];
                    errs.push(sp(u.line, u.col, "Unexpected trailing token in IF/ELSIF condition"));
                }
            }
            return i + 1;
        } else if depth == 0 && cases == 0 && (t.kind == SqlTokKind::Semi || (not_dot && (is_stmt_starter(t, body) || t.is_kw(body, "END")))) {
            let anchor = toks.get(start).unwrap_or(t);
            errs.push(sp(anchor.line, anchor.col, "Expected THEN after IF/ELSIF condition"));
            return i;
        }
        i += 1;
    }
    let anchor = toks.get(start).or(toks.last());
    if let Some(a) = anchor { errs.push(sp(a.line, a.col, "Expected THEN after IF/ELSIF condition")); }
    i
}

fn scan_to_kw(toks: &[SqlTok], body: &str, mut i: usize, target: &str, errs: &mut Vec<ErrorSpan>) -> usize {
    let start = i;
    let (mut depth, mut cases) = (0usize, 0usize);
    while i < toks.len() {
        let t = &toks[i];
        let not_dot = i == 0 || toks[i - 1].kind != SqlTokKind::Dot;
        if t.kind == SqlTokKind::LParen { depth += 1; }
        else if t.kind == SqlTokKind::RParen { depth = depth.saturating_sub(1); }
        else if not_dot && t.is_kw(body, "CASE") { cases += 1; }
        else if not_dot && t.is_kw(body, "END") && cases > 0 { cases -= 1; }
        else if depth == 0 && cases == 0 && not_dot && t.is_kw(body, target) {
            if i == start { errs.push(sp(t.line, t.col, format!("Empty clause before {target}"))); }
            return i + 1;
        } else if depth == 0 && cases == 0 && (t.kind == SqlTokKind::Semi || (not_dot && t.is_kw(body, "END"))) {
            let a = toks.get(start).unwrap_or(t);
            errs.push(sp(a.line, a.col, format!("Expected {target}")));
            return i;
        }
        i += 1;
    }
    if let Some(a) = toks.get(start).or(toks.last()) {
        errs.push(sp(a.line, a.col, format!("Expected {target}")));
    }
    i
}

fn is_stmt_starter(t: &SqlTok, body: &str) -> bool {
    ["RETURN", "RAISE", "PERFORM", "EXECUTE", "EXIT", "CONTINUE", "SELECT", "INSERT", "UPDATE", "DELETE", "WITH"]
        .iter().any(|k| t.is_kw(body, k))
}
