use crate::ir_code::{FnBody, Stmt};
use crate::printer::assign_op_str;
use crate::printer_expr_iter::PTask;

pub(crate) fn push_inline_stmt<'a>(tasks: &mut Vec<PTask<'a>>, st: &'a Stmt, out: &mut String) {
    match st {
        Stmt::Pass => out.push_str("pass"),
        Stmt::Comment(_) => {}
        Stmt::Return { value: Some(e), .. } => { out.push_str("ret "); tasks.push(PTask::Expr(e)); }
        Stmt::Return { value: None, .. } => out.push_str("ret"),
        Stmt::Expr { expr, .. } => tasks.push(PTask::Expr(expr)),
        Stmt::Let { name, is_mut, ty, init, .. } => {
            let op = if *is_mut { " ::= " } else { " := " };
            tasks.push(PTask::Expr(init));
            tasks.push(PTask::Lit(op));
            if let Some(t) = ty {
                tasks.push(PTask::Ty(t));
                tasks.push(PTask::Lit(": "));
            }
            out.push_str(name);
        }
        Stmt::Destructure { names, is_mut, init, .. } => {
            let op = if *is_mut { "::=" } else { ":=" };
            tasks.push(PTask::Expr(init));
            out.push_str(&format!("[{}] {op} ", names.join(", ")));
        }
        Stmt::Assign { target, op, value, .. } => {
            tasks.push(PTask::Expr(value));
            tasks.push(PTask::Str(format!(" {} ", assign_op_str(*op))));
            tasks.push(PTask::Expr(target));
        }
        Stmt::If { cond, then_body, elifs, else_body, .. } => {
            if let Some(eb) = else_body {
                tasks.push(PTask::Lit(" }"));
                tasks.push(PTask::InlineStmts(eb));
                tasks.push(PTask::Lit(" else: { "));
            }
            for (ec, eb) in elifs.iter().rev() {
                tasks.push(PTask::Lit(" }"));
                tasks.push(PTask::InlineStmts(eb));
                tasks.push(PTask::Lit(": { "));
                tasks.push(PTask::Expr(ec));
                tasks.push(PTask::Lit(" elif "));
            }
            tasks.push(PTask::Lit(" }"));
            tasks.push(PTask::InlineStmts(then_body));
            tasks.push(PTask::Lit(": { "));
            tasks.push(PTask::Expr(cond));
            out.push_str("if ");
        }
        Stmt::While { cond, body, .. } => {
            tasks.push(PTask::Lit(" }"));
            tasks.push(PTask::InlineStmts(body));
            tasks.push(PTask::Lit(": { "));
            tasks.push(PTask::Expr(cond));
            out.push_str("while ");
        }
        Stmt::Loop { body, .. } => {
            tasks.push(PTask::Lit(" }"));
            tasks.push(PTask::InlineStmts(body));
            out.push_str("loop: { ");
        }
        Stmt::For { binding, iter, body, .. } => {
            tasks.push(PTask::Lit(" }"));
            tasks.push(PTask::InlineStmts(body));
            tasks.push(PTask::Lit(": { "));
            tasks.push(PTask::Expr(iter));
            out.push_str(&format!("for {binding} in "));
        }
        Stmt::Try { try_body, catches, finally_body, .. } => {
            if let Some(fb) = finally_body {
                tasks.push(PTask::Lit(" }"));
                tasks.push(PTask::InlineStmts(fb));
                tasks.push(PTask::Lit(" finally: { "));
            }
            for cc in catches.iter().rev() {
                let p = match (&cc.param, &cc.ty) {
                    (Some(p), _) if p.contains(',') => format!("({p})"),
                    (Some(p), _) => p.clone(),
                    (None, Some(_)) => "()".to_string(),
                    (None, None) => "err".to_string(),
                };
                tasks.push(PTask::Lit(" }"));
                tasks.push(PTask::InlineStmts(&cc.body));
                tasks.push(PTask::Lit(": { "));
                if let Some(t) = &cc.ty {
                    tasks.push(PTask::Ty(t));
                    tasks.push(PTask::Lit(": "));
                }
                tasks.push(PTask::Str(format!(" catch {p}")));
            }
            tasks.push(PTask::Lit(" }"));
            tasks.push(PTask::InlineStmts(try_body));
            out.push_str("try: { ");
        }
        Stmt::Match { target, cases, .. } => {
            tasks.push(PTask::Lit(" }"));
            for (i, mc) in cases.iter().enumerate().rev() {
                match &mc.body {
                    FnBody::Expr(e) => tasks.push(PTask::Expr(e)),
                    FnBody::Block(b) => {
                        tasks.push(PTask::Lit(" }"));
                        tasks.push(PTask::InlineStmts(b));
                        tasks.push(PTask::Lit("{ "));
                    }
                    FnBody::SignatureOnly => tasks.push(PTask::Lit("pass")),
                }
                tasks.push(PTask::Lit(" => "));
                if let Some(g) = &mc.guard {
                    tasks.push(PTask::Expr(g));
                    tasks.push(PTask::Lit(" if "));
                }
                tasks.push(PTask::Pat(&mc.pattern));
                if i > 0 { tasks.push(PTask::Lit("; ")); }
            }
            tasks.push(PTask::Lit(": { "));
            tasks.push(PTask::Expr(target));
            out.push_str("match ");
        }
        Stmt::Throw { expr, .. } => { out.push_str("throw "); tasks.push(PTask::Expr(expr)); }
        Stmt::Break { label, .. } => {
            if let Some(l) = label { out.push_str(&format!("break {l}")); } else { out.push_str("break"); }
        }
        Stmt::Continue { label, .. } => {
            if let Some(l) = label { out.push_str(&format!("continue {l}")); } else { out.push_str("continue"); }
        }
    }
}
