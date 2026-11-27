use crate::ir_code::{CompKind, Expr, FnBody, MemberKind, Pattern, RecordEntry, Stmt, UnaryOp};
use crate::ir_types::AiceType;
use crate::printer::assign_op_str;
use crate::printer_domain::format_ident_or_quoted;
use crate::printer_expr::{
    bin_op_str, escape_template, format_raw_expr, needs_binary_parens, print_lit,
    push_comp_print, push_new_tagged_print, unary_op_str,
};
use crate::printer_stmt_inline::push_inline_stmt;
use crate::printer_types::{push_pattern, push_type};

pub(crate) enum PTask<'a> {
    Lit(&'static str),
    Str(String),
    Expr(&'a Expr),
    Ty(&'a AiceType),
    Pat(&'a Pattern),
    InlineStmts(&'a [Stmt]),
    InlineStmt(&'a Stmt),
}

pub(crate) fn run_print_tasks<'a>(init: PTask<'a>) -> String {
    let mut tasks = vec![init];
    let mut out = String::new();
    while let Some(t) = tasks.pop() {
        match t {
            PTask::Lit(s) => out.push_str(s),
            PTask::Str(s) => out.push_str(&s),
            PTask::Expr(e) => push_expr(&mut tasks, e, &mut out),
            PTask::Ty(ty) => push_type(&mut tasks, ty, &mut out),
            PTask::Pat(p) => push_pattern(&mut tasks, p, &mut out),
            PTask::InlineStmts(stmts) => {
                let non_empty: Vec<&Stmt> =
                    stmts.iter().filter(|s| !matches!(s, Stmt::Comment(_))).collect();
                if non_empty.is_empty() {
                    out.push_str("pass");
                } else {
                    for (i, st) in non_empty.into_iter().enumerate().rev() {
                        tasks.push(PTask::InlineStmt(st));
                        if i > 0 { tasks.push(PTask::Lit("; ")); }
                    }
                }
            }
            PTask::InlineStmt(st) => push_inline_stmt(&mut tasks, st, &mut out),
        }
    }
    out
}

fn push_expr<'a>(tasks: &mut Vec<PTask<'a>>, expr: &'a Expr, out: &mut String) {
    match expr {
        Expr::Literal(l) => out.push_str(&print_lit(l)),
        Expr::Ident(s) => out.push_str(if s == "nil" { "\\#nil" } else { s }),
        Expr::Raw(s) => out.push_str(&format_raw_expr(s)),
        Expr::Template { quasis, exprs } => {
            out.push('`');
            tasks.push(PTask::Lit("`"));
            for (i, q) in quasis.iter().enumerate().rev() {
                if let Some(e) = exprs.get(i) {
                    tasks.push(PTask::Lit("}"));
                    tasks.push(PTask::Expr(e));
                    tasks.push(PTask::Lit("${"));
                }
                tasks.push(PTask::Str(escape_template(q)));
            }
        }
        Expr::Binary { op, left, right } => {
            let lp = needs_binary_parens(left, *op, false);
            let rp = needs_binary_parens(right, *op, true);
            if rp { tasks.push(PTask::Lit(")")); }
            tasks.push(PTask::Expr(right));
            if rp { tasks.push(PTask::Lit("(")); }
            tasks.push(PTask::Str(format!(" {} ", bin_op_str(*op))));
            if lp { tasks.push(PTask::Lit(")")); }
            tasks.push(PTask::Expr(left));
            if lp { tasks.push(PTask::Lit("(")); }
        }
        Expr::Unary { op, is_postfix, operand } => {
            if matches!(*op, UnaryOp::Generator | UnaryOp::Move)
                && let Expr::Closure { is_async, params, ret, body } = operand.as_ref()
            {
                push_closure_print(tasks, out, (*is_async, *op == UnaryOp::Generator, *op == UnaryOp::Move), params, ret.as_ref(), body);
                return;
            }
            let wrap = !matches!(*op, UnaryOp::Yield | UnaryOp::YieldStar | UnaryOp::Generator | UnaryOp::Move)
                && (matches!(operand.as_ref(), Expr::Binary { .. } | Expr::Conditional { .. } | Expr::Assign { .. })
                    || (*is_postfix && matches!(operand.as_ref(), Expr::Await(_) | Expr::Unary { is_postfix: false, .. })));
            if *is_postfix {
                tasks.push(PTask::Lit(unary_op_str(*op)));
                if wrap { tasks.push(PTask::Lit(")")); }
                tasks.push(PTask::Expr(operand));
                if wrap { tasks.push(PTask::Lit("(")); }
            } else {
                if wrap { tasks.push(PTask::Lit(")")); }
                tasks.push(PTask::Expr(operand));
                if wrap { tasks.push(PTask::Lit("(")); }
                out.push_str(unary_op_str(*op));
            }
        }
        Expr::Conditional { cond, then_expr, else_expr } => {
            tasks.push(PTask::Expr(else_expr));
            tasks.push(PTask::Lit(" : "));
            tasks.push(PTask::Expr(then_expr));
            tasks.push(PTask::Lit(" ? "));
            tasks.push(PTask::Expr(cond));
        }
        Expr::PostfixTry(e) => {
            let wrap = matches!(e.as_ref(), Expr::Binary { .. } | Expr::Conditional { .. });
            tasks.push(PTask::Lit(if wrap { ")?" } else { "?" }));
            tasks.push(PTask::Expr(e));
            if wrap { out.push('('); }
        }
        Expr::Call { callee, args, is_optional, is_tagged, is_new } => {
            if *is_new && *is_tagged {
                push_new_tagged_print(tasks, out, callee, args, *is_optional);
                return;
            }
            if *is_tagged && args.len() == 1 {
                tasks.push(PTask::Expr(&args[0]));
                tasks.push(PTask::Expr(callee));
                return;
            }
            let is_empty_callee = matches!(callee.as_ref(), Expr::Ident(s) if s.is_empty());
            if is_empty_callee && !*is_optional && !*is_new && args.len() == 2
                && matches!(&args[1], Expr::Ident(s) if s.is_empty())
            {
                tasks.push(PTask::Lit(",)"));
                tasks.push(PTask::Expr(&args[0]));
                out.push('(');
                return;
            }
            tasks.push(PTask::Lit(")"));
            if !is_empty_callee && !*is_optional && !*is_new && args.len() == 1
                && let Expr::Comprehension { kind: CompKind::Generator, body, value, clauses } = &args[0]
            {
                let mut dummy = String::new();
                push_comp_print(tasks, &mut dummy, CompKind::Generator, body, value.as_deref(), clauses, true);
            } else {
                for (i, a) in args.iter().enumerate().rev() {
                    tasks.push(PTask::Expr(a));
                    if i > 0 { tasks.push(PTask::Lit(", ")); }
                }
            }
            tasks.push(PTask::Lit(if *is_optional { "?.(" } else { "(" }));
            tasks.push(PTask::Expr(callee));
            if *is_new { out.push_str("new "); }
        }
        Expr::Member { object, property, kind } => {
            let wrap = matches!(object.as_ref(), Expr::Binary { .. } | Expr::Conditional { .. } | Expr::Assign { .. });
            let op = match kind { MemberKind::Dot => ".", MemberKind::SafeNav => "?.", MemberKind::Scope => "::" };
            tasks.push(PTask::Str(format!("{op}{property}")));
            if wrap { tasks.push(PTask::Lit(")")); }
            tasks.push(PTask::Expr(object));
            if wrap { out.push('('); }
        }
        Expr::Index { object, index, is_optional } => {
            let wrap = matches!(object.as_ref(), Expr::Binary { .. } | Expr::Conditional { .. } | Expr::Assign { .. });
            tasks.push(PTask::Lit("]"));
            if let Expr::Call { callee, args, .. } = index.as_ref()
                && matches!(callee.as_ref(), Expr::Ident(s) if s == "\0idx")
            {
                for (i, a) in args.iter().enumerate().rev() {
                    tasks.push(PTask::Expr(a));
                    if i > 0 { tasks.push(PTask::Lit(", ")); }
                }
            } else {
                tasks.push(PTask::Expr(index));
            }
            tasks.push(PTask::Lit(if *is_optional { "?.[" } else { "[" }));
            if wrap { tasks.push(PTask::Lit(")")); }
            tasks.push(PTask::Expr(object));
            if wrap { out.push('('); }
        }
        Expr::Array(items) => {
            tasks.push(PTask::Lit("]"));
            for (i, it) in items.iter().enumerate().rev() {
                tasks.push(PTask::Expr(it));
                if i > 0 { tasks.push(PTask::Lit(", ")); }
            }
            out.push('[');
        }
        Expr::Record(entries) => {
            if entries.is_empty() { out.push_str("{}"); return; }
            tasks.push(PTask::Lit(" }"));
            for (i, e) in entries.iter().enumerate().rev() {
                match e {
                    RecordEntry::Spread(ex) => {
                        tasks.push(PTask::Expr(ex));
                        tasks.push(PTask::Lit("..."));
                    }
                    RecordEntry::Field { key: Some(k), value } => {
                        tasks.push(PTask::Expr(value));
                        tasks.push(PTask::Str(format!("{}: ", format_ident_or_quoted(k))));
                    }
                    RecordEntry::Field { key: None, value } => tasks.push(PTask::Expr(value)),
                }
                if i > 0 { tasks.push(PTask::Lit(", ")); }
            }
            out.push_str("{ ");
        }
        Expr::Closure { is_async, params, ret, body } => {
            push_closure_print(tasks, out, (*is_async, false, false), params, ret.as_ref(), body);
        }
        Expr::Assign { target, op, value } => {
            tasks.push(PTask::Expr(value));
            tasks.push(PTask::Str(format!(" {} ", assign_op_str(*op))));
            tasks.push(PTask::Expr(target));
        }
        Expr::Await(e) => {
            out.push_str("await ");
            tasks.push(PTask::Expr(e));
        }
        Expr::Match { target, cases } => {
            tasks.push(PTask::Lit(" }"));
            for (i, c) in cases.iter().enumerate().rev() {
                match &c.body {
                    FnBody::Expr(e) => tasks.push(PTask::Expr(e)),
                    FnBody::Block(b) => {
                        tasks.push(PTask::Lit(" }"));
                        tasks.push(PTask::InlineStmts(b));
                        tasks.push(PTask::Lit("{ "));
                    }
                    FnBody::SignatureOnly => tasks.push(PTask::Lit("pass")),
                }
                tasks.push(PTask::Lit(" => "));
                if let Some(g) = &c.guard {
                    tasks.push(PTask::Expr(g));
                    tasks.push(PTask::Lit(" if "));
                }
                tasks.push(PTask::Pat(&c.pattern));
                if i > 0 { tasks.push(PTask::Lit("; ")); }
            }
            tasks.push(PTask::Lit(": { "));
            tasks.push(PTask::Expr(target));
            out.push_str("match ");
        }
        Expr::Comprehension { kind, body, value, clauses } => {
            push_comp_print(tasks, out, *kind, body, value.as_deref(), clauses, false);
        }
    }
}

fn push_closure_print<'a>(
    tasks: &mut Vec<PTask<'a>>,
    out: &mut String,
    flags: (bool, bool, bool),
    params: &'a [crate::ir_types::ParamDecl],
    ret: Option<&'a AiceType>,
    body: &'a FnBody,
) {
    let (is_async, is_generator, is_move) = flags;
    match body {
        FnBody::Expr(e) => {
            tasks.push(PTask::Expr(e));
            tasks.push(PTask::Lit(" = "));
        }
        FnBody::Block(stmts) => {
            tasks.push(PTask::Lit(" }"));
            tasks.push(PTask::InlineStmts(stmts));
            tasks.push(PTask::Lit(" { "));
        }
        FnBody::SignatureOnly => {}
    }
    if let Some(r) = ret {
        tasks.push(PTask::Ty(r));
        tasks.push(PTask::Lit(" -> "));
    }
    tasks.push(PTask::Lit(")"));
    for (i, p) in params.iter().enumerate().rev() {
        if let Some(d) = &p.default {
            tasks.push(PTask::Expr(d));
            tasks.push(PTask::Lit(" = "));
        }
        if let Some(t) = &p.ty {
            tasks.push(PTask::Ty(t));
            tasks.push(PTask::Lit(": "));
        }
        if p.is_optional { tasks.push(PTask::Lit("?")); }
        tasks.push(PTask::Str(p.name.clone()));
        if p.is_rest { tasks.push(PTask::Lit("...")); }
        if i > 0 { tasks.push(PTask::Lit(", ")); }
    }
    out.push_str(match (is_async, is_generator, is_move) {
        (true, true, _) => "async fn*(",
        (true, false, true) => "async move fn(",
        (true, false, false) => "async fn(",
        (false, true, _) => "fn*(",
        (false, false, true) => "move fn(",
        (false, false, false) => "fn(",
    });
}
