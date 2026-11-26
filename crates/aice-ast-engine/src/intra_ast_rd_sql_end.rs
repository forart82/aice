use aice_lang_registry::{IntraBlockKind, IntraBlockNode};

use crate::intra_ast_rd_sql::{RdSqlDialect, push_rd_node};
use crate::r6::sql_lex::{LineIndex, SqlTok, SqlTokKind};

pub(crate) enum SqlFrameKind {
    Begin { exc_start: Option<usize>, when_start: Option<(usize, String)>, label: String },
    Try,
    Catch,
    If {
        arm_start: usize, arm_label: String, arms: Vec<(usize, usize, String)>,
        overall_start: usize, overall_label: String, is_tsql: bool,
    },
    Loop { label: String, is_tsql: bool, awaiting_loop: bool },
    Case,
    Handler { label: String },
}

pub(crate) struct SqlFrame {
    pub(crate) start_byte: usize,
    pub(crate) kind: SqlFrameKind,
}

pub(crate) struct EmitCtx<'a> {
    pub(crate) full: &'a str,
    pub(crate) li: &'a LineIndex,
    pub(crate) out: &'a mut Vec<IntraBlockNode>,
}

pub(crate) fn handle_begin(
    sub: &str, base: usize, toks: &[SqlTok], i: usize, d: RdSqlDialect, stack: &mut Vec<SqlFrame>,
) -> usize {
    if let Some(n) = toks.get(i + 1) {
        if d == RdSqlDialect::TSql && n.is_kw(sub, "TRY") {
            stack.push(SqlFrame { start_byte: base + toks[i].start, kind: SqlFrameKind::Try });
            return i + 2;
        }
        if d == RdSqlDialect::TSql && n.is_kw(sub, "CATCH") {
            stack.push(SqlFrame { start_byte: base + toks[i].start, kind: SqlFrameKind::Catch });
            return i + 2;
        }
        if ["TRAN", "TRANSACTION", "DISTRIBUTED", "WORK", "ATOMIC"].iter().any(|k| n.is_kw(sub, k)) {
            return i + 2;
        }
    }
    stack.push(SqlFrame {
        start_byte: base + toks[i].start,
        kind: SqlFrameKind::Begin { exc_start: None, when_start: None, label: "BEGIN".to_string() },
    });
    i + 1
}

pub(crate) fn handle_end(
    sub: &str, base: usize, toks: &[SqlTok], i: usize, d: RdSqlDialect,
    stack: &mut Vec<SqlFrame>, ctx: &mut EmitCtx<'_>,
) -> usize {
    let next = toks.get(i + 1);
    type FramePred = fn(&SqlFrameKind) -> bool;
    let pairs: &[(&str, FramePred)] = &[
        ("IF", |k| matches!(k, SqlFrameKind::If { .. })),
        ("LOOP", |k| matches!(k, SqlFrameKind::Loop { .. })),
        ("WHILE", |k| matches!(k, SqlFrameKind::Loop { .. })),
        ("REPEAT", |k| matches!(k, SqlFrameKind::Loop { .. })),
        ("CASE", |k| matches!(k, SqlFrameKind::Case)),
    ];
    if d == RdSqlDialect::TSql && next.is_some_and(|n| n.is_kw(sub, "TRY")) {
        pop_tsql_try_catch(stack, false, base + toks[i].start, base + toks[i + 1].end, ctx);
        return i + 2;
    }
    if d == RdSqlDialect::TSql && next.is_some_and(|n| n.is_kw(sub, "CATCH")) {
        let end_b = base + toks[i + 1].end;
        if pop_tsql_try_catch(stack, true, base + toks[i].start, end_b, ctx) {
            unwind_tsql(sub, toks, i + 2, end_b, stack, ctx);
        }
        return i + 2;
    }
    if d != RdSqlDialect::TSql {
        for (kw, pred) in pairs {
            if next.is_some_and(|n| n.is_kw(sub, kw)) {
                let end_b = base + toks[i + 1].end;
                pop_matching(stack, *pred, end_b, ctx);
                if d == RdSqlDialect::MySql && matches!(stack.last().map(|f| &f.kind), Some(SqlFrameKind::Handler { .. })) {
                    let outer = stack.pop().expect("handler");
                    emit_frame(outer, end_b, ctx);
                }
                return i + 2;
            }
        }
    }
    if d == RdSqlDialect::TSql {
        let start_b = base + toks[i].start;
        let end_b = base + toks[i].end;
        let target_pos = stack.iter().rposition(|f| {
            matches!(
                f.kind,
                SqlFrameKind::Begin { .. }
                    | SqlFrameKind::Case
                    | SqlFrameKind::Try
                    | SqlFrameKind::Catch
                    | SqlFrameKind::Handler { .. }
            )
        });
        if let Some(pos) = target_pos
            && matches!(stack[pos].kind, SqlFrameKind::Begin { .. } | SqlFrameKind::Case)
        {
            while stack.len() > pos + 1 {
                if !matches!(
                    stack.last().expect("top").kind,
                    SqlFrameKind::If { is_tsql: true, .. } | SqlFrameKind::Loop { is_tsql: true, .. }
                ) {
                    break;
                }
                let inner = stack.pop().expect("inner");
                emit_frame(inner, start_b, ctx);
            }
            if stack.len() == pos + 1
                && matches!(stack[pos].kind, SqlFrameKind::Begin { .. } | SqlFrameKind::Case)
            {
                let f = stack.pop().expect("top");
                let closes_tsql = matches!(f.kind, SqlFrameKind::Begin { .. });
                emit_frame(f, end_b, ctx);
                if closes_tsql {
                    unwind_tsql(sub, toks, i + 1, end_b, stack, ctx);
                }
            }
        }
        return i + 1;
    }
    if let Some(f) = stack.pop() {
        let end_b = base + toks[i].end;
        emit_frame(f, end_b, ctx);
        if d == RdSqlDialect::MySql
            && matches!(stack.last().map(|f| &f.kind), Some(SqlFrameKind::Handler { .. }))
        {
            let outer = stack.pop().expect("handler");
            emit_frame(outer, end_b, ctx);
        }
    }
    i + 1
}

fn unwind_tsql(
    sub: &str, toks: &[SqlTok], after_idx: usize, end_b: usize,
    stack: &mut Vec<SqlFrame>, ctx: &mut EmitCtx<'_>,
) {
    let after = toks.get(after_idx);
    let has_else = after.is_some_and(|n| n.is_kw(sub, "ELSE"))
        || (after.is_some_and(|n| n.kind == SqlTokKind::Semi)
            && toks.get(after_idx + 1).is_some_and(|n| n.is_kw(sub, "ELSE")));
    while let Some(top) = stack.last()
        && (matches!(top.kind, SqlFrameKind::Loop { is_tsql: true, .. })
            || (matches!(top.kind, SqlFrameKind::If { is_tsql: true, .. }) && !has_else))
    {
        let outer = stack.pop().expect("top");
        emit_frame(outer, end_b, ctx);
    }
}

fn pop_tsql_try_catch(
    stack: &mut Vec<SqlFrame>, is_catch: bool, start_b: usize, end_b: usize, ctx: &mut EmitCtx<'_>,
) -> bool {
    let pred = |k: &SqlFrameKind| if is_catch { matches!(k, SqlFrameKind::Catch) } else { matches!(k, SqlFrameKind::Try) };
    let Some(pos) = stack.iter().rposition(|f| pred(&f.kind)) else { return false };
    while stack.len() > pos + 1 {
        if !matches!(stack.last().expect("top").kind, SqlFrameKind::If { is_tsql: true, .. } | SqlFrameKind::Loop { is_tsql: true, .. }) {
            break;
        }
        let inner = stack.pop().expect("inner");
        emit_frame(inner, start_b, ctx);
    }
    if pos < stack.len() && pred(&stack[pos].kind) {
        let f = stack.remove(pos);
        emit_frame(f, end_b, ctx);
        return true;
    }
    false
}

fn pop_matching(stack: &mut Vec<SqlFrame>, pred: fn(&SqlFrameKind) -> bool, end_b: usize, ctx: &mut EmitCtx<'_>) {
    if let Some(pos) = stack.iter().rposition(|f| pred(&f.kind)) {
        let f = stack.remove(pos);
        emit_frame(f, end_b, ctx);
    }
}

pub(crate) fn emit_frame(f: SqlFrame, end_b: usize, ctx: &mut EmitCtx<'_>) {
    let (full, li, out) = (ctx.full, ctx.li, &mut *ctx.out);
    match f.kind {
        SqlFrameKind::Begin { exc_start, when_start, label } => {
            if let Some((ws, wlbl)) = when_start {
                push_rd_node(IntraBlockKind::ErrorHandler, wlbl, ws, end_b.saturating_sub(3).max(ws), full, li, out);
            }
            if let Some(es) = exc_start {
                push_rd_node(IntraBlockKind::ErrorHandler, "EXCEPTION", es, end_b, full, li, out);
            }
            push_rd_node(IntraBlockKind::RuleBlock, label, f.start_byte, end_b, full, li, out);
        }
        SqlFrameKind::Try => push_rd_node(IntraBlockKind::ErrorHandler, "BEGIN TRY", f.start_byte, end_b, full, li, out),
        SqlFrameKind::Catch => push_rd_node(IntraBlockKind::ErrorHandler, "BEGIN CATCH", f.start_byte, end_b, full, li, out),
        SqlFrameKind::Handler { label } => push_rd_node(IntraBlockKind::ErrorHandler, label, f.start_byte, end_b, full, li, out),
        SqlFrameKind::If { arm_start, arm_label, arms, overall_start, overall_label, .. } => {
            if !arms.is_empty() {
                for (s, e, lbl) in arms { push_rd_node(IntraBlockKind::Branch, lbl, s, e, full, li, out); }
                push_rd_node(IntraBlockKind::Branch, arm_label, arm_start, end_b, full, li, out);
            }
            push_rd_node(IntraBlockKind::Branch, overall_label, overall_start, end_b, full, li, out);
        }
        SqlFrameKind::Loop { label, .. } => push_rd_node(IntraBlockKind::Loop, label, f.start_byte, end_b, full, li, out),
        SqlFrameKind::Case => push_rd_node(IntraBlockKind::Branch, "CASE", f.start_byte, end_b, full, li, out),
    }
}
