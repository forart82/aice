use aice_lang_registry::{IntraBlockKind, IntraBlockNode};

use crate::intra_ast_rd_sql_end::{EmitCtx, SqlFrame, SqlFrameKind, emit_frame, handle_begin, handle_end};
use crate::r6::sql_lex::{LineIndex, SqlTok, SqlTokKind};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RdSqlDialect { PgPlsql, TSql, MySql, Sqlite, Ansi }

pub(crate) fn extract_sql_blocks(
    sub: &str, base: usize, toks: &[SqlTok], dialect: RdSqlDialect,
    full_src: &str, li: &LineIndex, out: &mut Vec<IntraBlockNode>,
) {
    let mut ctx = EmitCtx { full: full_src, li, out };
    let mut stack: Vec<SqlFrame> = Vec::new();
    let (mut pdepth, mut i) = (0usize, 0usize);
    while i < toks.len() {
        let tok = toks[i];
        match tok.kind {
            SqlTokKind::LParen => { pdepth += 1; i += 1; continue; }
            SqlTokKind::RParen => { pdepth = pdepth.saturating_sub(1); i += 1; continue; }
            SqlTokKind::Semi if pdepth == 0 => {
                while let Some(top) = stack.last() {
                    let close = matches!(top.kind, SqlFrameKind::If { is_tsql: true, .. } | SqlFrameKind::Loop { is_tsql: true, .. } | SqlFrameKind::Handler { .. });
                    if !close || (matches!(top.kind, SqlFrameKind::If { is_tsql: true, .. }) && toks.get(i + 1).is_some_and(|n| n.is_kw(sub, "ELSE"))) {
                        break;
                    }
                    let frame = stack.pop().expect("top");
                    emit_frame(frame, base + tok.end, &mut ctx);
                }
                i += 1;
                continue;
            }
            SqlTokKind::Word if i == 0 || toks[i - 1].kind != SqlTokKind::Dot => {}
            _ => { i += 1; continue; }
        }
        if tok.is_kw(sub, "CASE") {
            stack.push(SqlFrame { start_byte: base + tok.start, kind: SqlFrameKind::Case });
        } else if tok.is_kw(sub, "BEGIN") {
            i = handle_begin(sub, base, toks, i, dialect, &mut stack);
            continue;
        } else if tok.is_kw(sub, "END") {
            i = handle_end(sub, base, toks, i, dialect, &mut stack, &mut ctx);
            continue;
        } else if tok.is_kw(sub, "EXCEPTION") && dialect == RdSqlDialect::PgPlsql
            && (i == 0 || !toks[i - 1].is_kw(sub, "RAISE"))
            && let Some(SqlFrame { kind: SqlFrameKind::Begin { exc_start, .. }, .. }) = stack.last_mut()
            && exc_start.is_none()
        {
            *exc_start = Some(base + tok.start);
        } else if tok.is_kw(sub, "WHEN") && dialect == RdSqlDialect::PgPlsql
            && let Some(SqlFrame { kind: SqlFrameKind::Begin { exc_start: Some(_), when_start, .. }, .. }) = stack.last_mut()
        {
            let cs = base + tok.start;
            if let Some((ps, plbl)) = when_start.take() {
                push_rd_node(IntraBlockKind::ErrorHandler, plbl, ps, cs, ctx.full, ctx.li, ctx.out);
            }
            *when_start = Some((cs, header_until(sub, toks, i, &["THEN"])));
        } else if tok.is_kw(sub, "DECLARE") && dialect == RdSqlDialect::MySql && pdepth == 0
            && has_kw_before_semi(sub, toks, i + 1, "HANDLER")
        {
            stack.push(SqlFrame {
                start_byte: base + tok.start,
                kind: SqlFrameKind::Handler { label: header_until(sub, toks, i, &["BEGIN"]) },
            });
        } else if tok.is_kw(sub, "IF") && pdepth == 0 && is_real_if_stmt(sub, toks, i, dialect) {
            let lbl = header_until(sub, toks, i, &["THEN", "BEGIN", "ELSE", "END"]);
            stack.push(SqlFrame {
                start_byte: base + tok.start,
                kind: SqlFrameKind::If {
                    arm_start: base + tok.start, arm_label: lbl.clone(), arms: Vec::new(),
                    overall_start: base + tok.start, overall_label: lbl, is_tsql: dialect == RdSqlDialect::TSql,
                },
            });
        } else if (tok.is_kw(sub, "ELSIF") || tok.is_kw(sub, "ELSEIF"))
            && matches!(dialect, RdSqlDialect::PgPlsql | RdSqlDialect::MySql)
            && let Some(SqlFrame { kind: SqlFrameKind::If { arm_start, arm_label, arms, .. }, .. }) = stack.last_mut()
        {
            let cs = base + tok.start;
            arms.push((*arm_start, cs, arm_label.clone()));
            *arm_start = cs;
            *arm_label = header_until(sub, toks, i, &["THEN"]);
        } else if tok.is_kw(sub, "ELSE")
            && let Some(SqlFrame { kind: SqlFrameKind::If { arm_start, arm_label, arms, .. }, .. }) = stack.last_mut()
        {
            let cs = base + tok.start;
            arms.push((*arm_start, cs, arm_label.clone()));
            *arm_start = cs;
            *arm_label = "ELSE".to_string();
        } else if pdepth == 0 && is_loop_kw(sub, toks, i, dialect) {
            if tok.is_kw(sub, "LOOP")
                && let Some(SqlFrame { kind: SqlFrameKind::Loop { awaiting_loop, .. }, .. }) = stack.last_mut()
                && *awaiting_loop
            {
                *awaiting_loop = false;
            } else {
                let awaiting = dialect == RdSqlDialect::PgPlsql && !tok.is_kw(sub, "LOOP");
                let lbl = header_until(sub, toks, i, &["LOOP", "DO", "BEGIN", "ELSE", "END"]);
                stack.push(SqlFrame {
                    start_byte: base + tok.start,
                    kind: SqlFrameKind::Loop { label: lbl, is_tsql: dialect == RdSqlDialect::TSql, awaiting_loop: awaiting },
                });
            }
        }
        i += 1;
    }
    if dialect == RdSqlDialect::TSql
        && let Some(last) = toks.last()
    {
        let eof_end = base + last.end;
        while let Some(top) = stack.last() {
            if !matches!(
                top.kind,
                SqlFrameKind::If { is_tsql: true, .. } | SqlFrameKind::Loop { is_tsql: true, .. }
            ) {
                break;
            }
            let frame = stack.pop().expect("top");
            emit_frame(frame, eof_end, &mut ctx);
        }
    }
}

fn is_loop_kw(sub: &str, toks: &[SqlTok], i: usize, d: RdSqlDialect) -> bool {
    let t = toks[i];
    t.is_kw(sub, "WHILE")
        || (matches!(d, RdSqlDialect::PgPlsql | RdSqlDialect::MySql)
            && (t.is_kw(sub, "LOOP") || t.is_kw(sub, "REPEAT")
                || ((t.is_kw(sub, "FOR") || t.is_kw(sub, "FOREACH")) && has_kw_before_semi(sub, toks, i + 1, "LOOP"))))
}

pub(crate) fn push_rd_node(
    kind: IntraBlockKind, label: impl Into<String>, start_byte: usize, raw_end: usize,
    src: &str, li: &LineIndex, out: &mut Vec<IntraBlockNode>,
) {
    let mut end_byte = raw_end.min(src.len());
    let b = src.as_bytes();
    while end_byte > start_byte && matches!(b[end_byte - 1], b' ' | b'\t') { end_byte -= 1; }
    if end_byte <= start_byte { return; }
    out.push(IntraBlockNode {
        kind, label: label.into(), start_line: li.line_col(start_byte).0,
        end_line: li.end_line(src, start_byte, end_byte), start_byte, end_byte,
    });
}

fn is_real_if_stmt(sub: &str, toks: &[SqlTok], i: usize, d: RdSqlDialect) -> bool {
    if i > 0 && d != RdSqlDialect::TSql && toks[i - 1].is_kw(sub, "END") {
        return false;
    }
    let ddl_prev = i > 0
        && [
            "DROP", "CREATE", "ALTER", "TABLE", "COLUMN", "CONSTRAINT", "INDEX", "VIEW",
            "TRIGGER", "PROCEDURE", "PROC", "FUNCTION", "DATABASE", "SCHEMA", "TYPE", "SEQUENCE",
        ]
        .iter()
        .any(|k| toks[i - 1].is_kw(sub, k));
    if toks.get(i + 1).is_some_and(|n| n.is_kw(sub, "EXISTS")) {
        let has_lparen = toks.get(i + 2).is_some_and(|n| n.kind == SqlTokKind::LParen);
        if ddl_prev || !has_lparen {
            return false;
        }
    } else if toks.get(i + 1).is_some_and(|n| n.is_kw(sub, "NOT"))
        && toks.get(i + 2).is_some_and(|n| n.is_kw(sub, "EXISTS"))
    {
        let has_lparen = toks.get(i + 3).is_some_and(|n| n.kind == SqlTokKind::LParen);
        if ddl_prev || !has_lparen {
            return false;
        }
    }
    match d {
        RdSqlDialect::PgPlsql | RdSqlDialect::MySql => has_kw_before_semi(sub, toks, i + 1, "THEN"),
        RdSqlDialect::TSql => true,
        _ => false,
    }
}

fn has_kw_before_semi(sub: &str, toks: &[SqlTok], mut j: usize, kw: &str) -> bool {
    let mut depth = 0usize;
    let limit = toks.len().min(j + 256);
    while j < limit {
        match toks[j].kind {
            SqlTokKind::LParen => depth += 1,
            SqlTokKind::RParen => depth = depth.saturating_sub(1),
            SqlTokKind::Semi if depth == 0 => return false,
            SqlTokKind::Word if depth == 0 && toks[j].is_kw(sub, kw) => return true,
            _ => {}
        }
        j += 1;
    }
    false
}

fn header_until(sub: &str, toks: &[SqlTok], start: usize, stops: &[&str]) -> String {
    let mut parts = Vec::new();
    let mut depth = 0usize;
    for t in &toks[start..toks.len().min(start + 12)] {
        match t.kind {
            SqlTokKind::LParen => depth += 1,
            SqlTokKind::RParen => depth = depth.saturating_sub(1),
            SqlTokKind::Semi if depth == 0 => break,
            SqlTokKind::Word
                if depth == 0 && stops.iter().any(|s| t.is_kw(sub, s)) && !parts.is_empty() =>
            {
                break;
            }
            _ => {}
        }
        parts.push(t.slice(sub));
    }
    let j = parts.join(" ");
    if j.chars().count() > 100 { j.chars().take(100).collect() } else { j }
}
