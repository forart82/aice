use aice_lang_registry::RdNode;

use crate::r5::checks::ErrorSpan;
use crate::r6::sql_expr::{check_delimiters, strip_comments};
use crate::r6::sql_lex::{LexOpts, LineIndex, SqlTok, SqlTokKind, lex_sql, sp};
use crate::r6::sql_symbols::make_rd_node;
use crate::r6::tsql_stmt::{consume_simple, is_tsql_cond_stop, validate_tsql_cond};

pub const TSQL_LEX: LexOpts = LexOpts {
    allow_brackets: true,
    allow_backtick: false,
    allow_dollar: false,
    allow_hash_comment: false,
    nested_block_comments: true,
    backslash_escape: false,
    allow_at_var: true,
};

enum TsqlFrame {
    Begin(usize, usize),
    Try(usize, usize),
    Catch(usize, usize),
}

pub fn split_tsql_batches(src: &str, li: &LineIndex, errs: &mut Vec<ErrorSpan>) -> Vec<(usize, usize)> {
    let mut batches = Vec::new();
    let b = src.as_bytes();
    let (mut batch_start, mut i) = (0usize, 0usize);
    let (mut in_sq, mut in_dq, mut in_br, mut blk_depth) = (false, false, false, 0usize);

    while i < b.len() {
        let line_end = src[i..].find('\n').map_or(b.len(), |r| i + r);
        if !in_sq && !in_dq && !in_br && blk_depth == 0 {
            let line_str = strip_line_comment(&src[i..line_end]).trim();
            if is_go_line(line_str, i, li, errs) {
                if batch_start < i { batches.push((batch_start, i)); }
                i = if line_end < b.len() { line_end + 1 } else { b.len() };
                batch_start = i;
                continue;
            }
        }
        while i < line_end {
            let ch = b[i];
            if blk_depth > 0 {
                if ch == b'/' && i + 1 < line_end && b[i + 1] == b'*' { blk_depth += 1; i += 2; }
                else if ch == b'*' && i + 1 < line_end && b[i + 1] == b'/' { blk_depth -= 1; i += 2; }
                else { i += 1; }
            } else if in_sq {
                if ch == b'\'' { if i + 1 < line_end && b[i + 1] == b'\'' { i += 2; } else { in_sq = false; i += 1; } }
                else { i += 1; }
            } else if in_dq {
                if ch == b'"' { if i + 1 < line_end && b[i + 1] == b'"' { i += 2; } else { in_dq = false; i += 1; } }
                else { i += 1; }
            } else if in_br {
                if ch == b']' { if i + 1 < line_end && b[i + 1] == b']' { i += 2; } else { in_br = false; i += 1; } }
                else { i += 1; }
            } else if ch == b'-' && i + 1 < line_end && b[i + 1] == b'-' { i = line_end; }
            else if ch == b'/' && i + 1 < line_end && b[i + 1] == b'*' { blk_depth = 1; i += 2; }
            else if ch == b'\'' { in_sq = true; i += 1; }
            else if ch == b'"' { in_dq = true; i += 1; }
            else if ch == b'[' { in_br = true; i += 1; }
            else { i += 1; }
        }
        i = if line_end < b.len() { line_end + 1 } else { b.len() };
    }
    if batch_start < b.len() { batches.push((batch_start, b.len())); }
    batches
}

fn strip_line_comment(line: &str) -> &str {
    let b = line.as_bytes();
    for i in 0..b.len().saturating_sub(1) {
        if b[i] == b'-' && b[i + 1] == b'-' { return &line[..i]; }
    }
    line
}

fn is_go_line(trimmed: &str, line_byte: usize, li: &LineIndex, errs: &mut Vec<ErrorSpan>) -> bool {
    if trimmed.eq_ignore_ascii_case("GO") { return true; }
    let Some(head) = trimmed.get(..2) else { return false; };
    if !head.eq_ignore_ascii_case("GO") || !trimmed[2..].starts_with(char::is_whitespace) { return false; }
    if trimmed[2..].trim().parse::<usize>().is_err() {
        let (l, c) = li.line_col(line_byte);
        errs.push(sp(l, c, "Invalid GO batch count"));
    }
    true
}

pub fn parse_tsql_batch(
    src: &str, base_byte: usize, end_byte: usize, li: &LineIndex,
    errs: &mut Vec<ErrorSpan>, nodes: &mut Vec<RdNode>,
) {
    let sub = &src[base_byte..end_byte];
    let (base_l, _) = li.line_col(base_byte);
    let (toks, mut lex_errs, _) = lex_sql(sub, TSQL_LEX);
    for e in &mut lex_errs { e.line += base_l - 1; e.end_line += base_l - 1; }
    errs.extend(lex_errs);
    let mut clean = strip_comments(&toks);
    for t in &mut clean { t.start += base_byte; t.end += base_byte; t.line += base_l - 1; }
    errs.extend(check_delimiters(&clean));
    if clean.is_empty() { return; }

    let mut stack: Vec<TsqlFrame> = Vec::new();
    let mut i = 0usize;
    let mut active_proc: Option<usize> = None;

    while i < clean.len() {
        let t = &clean[i];
        if t.kind == SqlTokKind::Semi { i += 1; continue; }
        if t.is_kw(src, "BEGIN") {
            if clean.get(i + 1).is_some_and(|n| n.is_kw(src, "TRY")) {
                stack.push(TsqlFrame::Try(t.line, t.col)); i += 2; continue;
            }
            if clean.get(i + 1).is_some_and(|n| n.is_kw(src, "CATCH")) {
                stack.push(TsqlFrame::Catch(t.line, t.col)); i += 2; continue;
            }
            if clean.get(i + 1).is_some_and(|n| n.is_kw(src, "TRAN") || n.is_kw(src, "TRANSACTION") || n.is_kw(src, "DISTRIBUTED")) {
                i = consume_simple(&clean, i, src, errs); continue;
            }
            stack.push(TsqlFrame::Begin(t.line, t.col)); i += 1; continue;
        }
        if t.is_kw(src, "END") {
            if clean.get(i + 1).is_some_and(|n| n.is_kw(src, "TRY")) {
                if !matches!(stack.pop(), Some(TsqlFrame::Try(..))) { errs.push(sp(t.line, t.col, "Unmatched END TRY")); }
                i += 2;
                let j = if clean.get(i).is_some_and(|n| n.kind == SqlTokKind::Semi) { i + 1 } else { i };
                if !clean.get(j).is_some_and(|n| n.is_kw(src, "BEGIN") && clean.get(j + 1).is_some_and(|m| m.is_kw(src, "CATCH"))) {
                    errs.push(sp(t.line, t.col, "Expected BEGIN CATCH after END TRY"));
                }
                continue;
            }
            if clean.get(i + 1).is_some_and(|n| n.is_kw(src, "CATCH")) {
                if !matches!(stack.pop(), Some(TsqlFrame::Catch(..))) { errs.push(sp(t.line, t.col, "Unmatched END CATCH")); }
                i += 2; continue;
            }
            if !matches!(stack.pop(), Some(TsqlFrame::Begin(..))) { errs.push(sp(t.line, t.col, "Unmatched END")); }
            if stack.is_empty() && let Some(p_idx) = active_proc.take() {
                let end_b = if clean.get(i + 1).is_some_and(|n| n.kind == SqlTokKind::Semi) { clean[i + 1].end } else { t.end };
                nodes[p_idx].end_byte = end_b;
                nodes[p_idx].end_line = li.end_line(src, nodes[p_idx].start_byte, end_b);
            }
            i += 1; continue;
        }
        if t.is_kw(src, "CREATE") || t.is_kw(src, "ALTER") {
            let (next_i, proc_idx) = parse_tsql_ddl(&clean, i, src, li, errs, nodes);
            if proc_idx.is_some() { active_proc = proc_idx; }
            i = next_i; continue;
        }
        if t.is_kw(src, "IF") || t.is_kw(src, "WHILE") { i = consume_cond(&clean, i + 1, src, errs); continue; }
        if t.is_kw(src, "ELSE") { i += 1; continue; }
        if t.is_kw(src, "WITH") { collect_tsql_ctes(&clean, i, src, li, nodes); }
        i = consume_simple(&clean, i, src, errs);
    }
    for f in stack {
        let (l, c, k) = match f {
            TsqlFrame::Begin(l, c) => (l, c, "BEGIN"),
            TsqlFrame::Try(l, c) => (l, c, "BEGIN TRY"),
            TsqlFrame::Catch(l, c) => (l, c, "BEGIN CATCH"),
        };
        errs.push(sp(l, c, format!("Unclosed T-SQL '{k}' block")));
    }
    if let Some(p_idx) = active_proc.take() && let Some(last) = clean.last() {
        nodes[p_idx].end_byte = last.end;
        nodes[p_idx].end_line = last.line;
    }
}

fn consume_cond(clean: &[SqlTok], mut i: usize, src: &str, errs: &mut Vec<ErrorSpan>) -> usize {
    let start = i;
    let kw = &clean[start.saturating_sub(1)];
    let (mut d, mut c) = (0usize, 0usize);
    while i < clean.len() {
        let t = &clean[i];
        let not_dot = i == 0 || clean[i - 1].kind != SqlTokKind::Dot;
        if t.kind == SqlTokKind::LParen { d += 1; }
        else if t.kind == SqlTokKind::RParen { d = d.saturating_sub(1); }
        else if not_dot && t.is_kw(src, "CASE") { c += 1; }
        else if not_dot && t.is_kw(src, "END") && c > 0 { c -= 1; }
        else if d == 0 && c == 0 && is_tsql_cond_stop(clean, i, src) { break; }
        i += 1;
    }
    validate_tsql_cond(&clean[start..i], kw, src, errs);
    i
}

fn parse_tsql_ddl(
    clean: &[SqlTok], start: usize, src: &str, li: &LineIndex, errs: &mut Vec<ErrorSpan>, nodes: &mut Vec<RdNode>,
) -> (usize, Option<usize>) {
    let is_create = clean[start].is_kw(src, "CREATE");
    let mut i = start + 1;
    let is_or = clean.get(i).is_some_and(|t| t.is_kw(src, "OR"));
    let is_or_alter = is_or && clean.get(i + 1).is_some_and(|t| t.is_kw(src, "ALTER"));
    if is_or_alter {
        if !is_create {
            errs.push(sp(clean[i].line, clean[i].col, "OR ALTER is only valid with CREATE in T-SQL"));
        }
        i += 2;
    } else if is_or {
        let msg = if is_create { "Expected ALTER after CREATE OR in T-SQL" } else { "Unexpected OR after ALTER in T-SQL" };
        errs.push(sp(clean[i].line, clean[i].col, msg));
    }
    let kind_tok = clean.get(i);
    let kind = if kind_tok.is_some_and(|t| t.is_kw(src, "PROC") || t.is_kw(src, "PROCEDURE")) { Some("procedure") }
        else if kind_tok.is_some_and(|t| t.is_kw(src, "FUNCTION")) { Some("function") }
        else if kind_tok.is_some_and(|t| t.is_kw(src, "VIEW")) { Some("view") }
        else if kind_tok.is_some_and(|t| t.is_kw(src, "TABLE")) { Some("table") }
        else if kind_tok.is_some_and(|t| t.is_kw(src, "TRIGGER")) { Some("trigger") }
        else if kind_tok.is_some_and(|t| t.is_kw(src, "INDEX")) { Some("index") }
        else { None };
    if is_or_alter && !matches!(kind, Some("procedure" | "function" | "view" | "trigger")) {
        errs.push(sp(clean[start].line, clean[start].col, "CREATE OR ALTER is only valid for VIEW, PROCEDURE, FUNCTION, or TRIGGER in T-SQL"));
    }
    i += 1;
    let Some(kind) = kind else { return (consume_simple(clean, start, src, errs), None); };
    let Some(mut name) = clean.get(i).map(|t| t.ident_name(src)) else {
        errs.push(sp(clean[start].line, clean[start].col, "Incomplete DDL missing object name"));
        return (clean.len(), None);
    };
    i += 1;
    while clean.get(i).is_some_and(|t| t.kind == SqlTokKind::Dot) {
        i += 1;
        if let Some(n) = clean.get(i) { name = format!("{name}.{}", n.ident_name(src)); i += 1; }
    }
    if matches!(kind, "procedure" | "function" | "trigger") {
        let mut d = 0usize;
        while i < clean.len() {
            if clean[i].kind == SqlTokKind::LParen { d += 1; }
            else if clean[i].kind == SqlTokKind::RParen { d = d.saturating_sub(1); }
            else if d == 0 && clean[i].is_kw(src, "AS") { i += 1; break; }
            i += 1;
        }
        let end_b = clean[i.min(clean.len() - 1)].end;
        nodes.push(make_rd_node(kind, Some(name), clean[start].start, end_b, li, src));
        return (i, Some(nodes.len() - 1));
    }
    let end_i = consume_simple(clean, start, src, errs);
    let end_tok = &clean[end_i.saturating_sub(1).max(start)];
    nodes.push(make_rd_node(kind, Some(name), clean[start].start, end_tok.end, li, src));
    (end_i, None)
}

fn collect_tsql_ctes(clean: &[SqlTok], start: usize, src: &str, li: &LineIndex, nodes: &mut Vec<RdNode>) {
    let mut i = start + 1;
    if clean.get(i).is_some_and(|t| t.is_kw(src, "XMLNAMESPACES"))
        && clean.get(i + 1).is_some_and(|t| t.kind == SqlTokKind::LParen)
    {
        let mut d = 1usize; i += 2;
        while i < clean.len() && d > 0 {
            if clean[i].kind == SqlTokKind::LParen { d += 1; } else if clean[i].kind == SqlTokKind::RParen { d -= 1; }
            i += 1;
        }
        if clean.get(i).is_some_and(|t| t.kind == SqlTokKind::Comma) { i += 1; } else { return; }
    }
    while i < clean.len() {
        let Some(name_tok) = clean.get(i) else { break; };
        if !crate::r6::tsql_with::is_tsql_cte_ident(name_tok, src) { break; }
        let name = name_tok.ident_name(src);
        i += 1;
        if clean.get(i).is_some_and(|t| t.kind == SqlTokKind::LParen) {
            let mut d = 1usize; i += 1;
            while i < clean.len() && d > 0 {
                if clean[i].kind == SqlTokKind::LParen { d += 1; } else if clean[i].kind == SqlTokKind::RParen { d -= 1; }
                i += 1;
            }
        }
        if !clean.get(i).is_some_and(|t| t.is_kw(src, "AS")) || !clean.get(i + 1).is_some_and(|t| t.kind == SqlTokKind::LParen) { break; }
        i += 2;
        let mut d = 1usize;
        while i < clean.len() && d > 0 {
            if clean[i].kind == SqlTokKind::LParen { d += 1; } else if clean[i].kind == SqlTokKind::RParen { d -= 1; }
            i += 1;
        }
        nodes.push(make_rd_node("cte", Some(name), name_tok.start, clean[i.saturating_sub(1)].end, li, src));
        if clean.get(i).is_some_and(|t| t.kind == SqlTokKind::Comma) { i += 1; } else { break; }
    }
}
