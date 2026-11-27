use crate::ir::{AiceItem, AiceModule};
use crate::ir_code::{Expr, FnBody, LiteralVal, RecordEntry, Stmt};

fn fix_nil_target(e: &mut Expr) {
    let mut stack = vec![e];
    while let Some(cur) = stack.pop() {
        match cur {
            Expr::Literal(LiteralVal::Nil) => *cur = Expr::Ident("nil".into()),
            Expr::Array(items) => stack.extend(items.iter_mut()),
            _ => {}
        }
    }
}

enum NilTask<'a> {
    Stmt(&'a mut Stmt),
    Slice(&'a mut [Stmt]),
    Expr(&'a mut Expr),
    Body(&'a mut FnBody),
}

fn run_nil_tasks<'a>(init: NilTask<'a>) {
    let mut tasks = vec![init];
    while let Some(task) = tasks.pop() {
        match task {
            NilTask::Slice(stmts) => {
                for st in stmts.iter_mut().rev() { tasks.push(NilTask::Stmt(st)); }
            }
            NilTask::Body(body) => match body {
                FnBody::SignatureOnly => {}
                FnBody::Expr(e) => tasks.push(NilTask::Expr(e)),
                FnBody::Block(stmts) => {
                    for st in stmts.iter_mut().rev() { tasks.push(NilTask::Stmt(st)); }
                }
            },
            NilTask::Stmt(st) => match st {
                Stmt::Let { init, .. } | Stmt::Destructure { init, .. } => tasks.push(NilTask::Expr(init)),
                Stmt::Assign { target, value, .. } => {
                    fix_nil_target(target);
                    tasks.push(NilTask::Expr(value));
                    tasks.push(NilTask::Expr(target));
                }
                Stmt::Expr { expr, .. } => tasks.push(NilTask::Expr(expr)),
                Stmt::Return { value: Some(v), .. } => tasks.push(NilTask::Expr(v)),
                Stmt::Throw { expr, cause, .. } => {
                    if let Some(c) = cause { tasks.push(NilTask::Expr(c)); }
                    tasks.push(NilTask::Expr(expr));
                }
                Stmt::If { cond, then_body, elifs, else_body, .. } => {
                    if let Some(eb) = else_body { tasks.push(NilTask::Slice(eb)); }
                    for (ec, eb) in elifs.iter_mut().rev() {
                        tasks.push(NilTask::Slice(eb));
                        tasks.push(NilTask::Expr(ec));
                    }
                    tasks.push(NilTask::Slice(then_body));
                    tasks.push(NilTask::Expr(cond));
                }
                Stmt::While { cond, body, .. } => {
                    tasks.push(NilTask::Slice(body));
                    tasks.push(NilTask::Expr(cond));
                }
                Stmt::For { iter, body, .. } => {
                    tasks.push(NilTask::Slice(body));
                    tasks.push(NilTask::Expr(iter));
                }
                Stmt::Loop { body, .. } => tasks.push(NilTask::Slice(body)),
                Stmt::Match { target, cases, .. } => {
                    for c in cases.iter_mut().rev() {
                        tasks.push(NilTask::Body(&mut c.body));
                        if let Some(g) = &mut c.guard { tasks.push(NilTask::Expr(g)); }
                    }
                    tasks.push(NilTask::Expr(target));
                }
                Stmt::Try { try_body, catches, else_body, finally_body, .. } => {
                    if let Some(fb) = finally_body { tasks.push(NilTask::Slice(fb)); }
                    if let Some(eb) = else_body { tasks.push(NilTask::Slice(eb)); }
                    for cc in catches.iter_mut().rev() { tasks.push(NilTask::Slice(&mut cc.body)); }
                    tasks.push(NilTask::Slice(try_body));
                }
                _ => {}
            },
            NilTask::Expr(e) => match e {
                Expr::Assign { target, value, .. } => {
                    fix_nil_target(target);
                    tasks.push(NilTask::Expr(value));
                    tasks.push(NilTask::Expr(target));
                }
                Expr::Binary { left, right, .. } | Expr::Index { object: left, index: right, .. } => {
                    tasks.push(NilTask::Expr(right));
                    tasks.push(NilTask::Expr(left));
                }
                Expr::Unary { operand, .. } | Expr::Await(operand) | Expr::PostfixTry(operand) | Expr::Member { object: operand, .. } => {
                    tasks.push(NilTask::Expr(operand));
                }
                Expr::Call { callee, args, .. } => {
                    for a in args.iter_mut().rev() { tasks.push(NilTask::Expr(a)); }
                    tasks.push(NilTask::Expr(callee));
                }
                Expr::Array(items) | Expr::Template { exprs: items, .. } => {
                    for it in items.iter_mut().rev() { tasks.push(NilTask::Expr(it)); }
                }
                Expr::Record(entries) => {
                    for en in entries.iter_mut().rev() {
                        let (RecordEntry::Field { value, .. } | RecordEntry::Spread(value)) = en;
                        tasks.push(NilTask::Expr(value));
                    }
                }
                Expr::Conditional { cond, then_expr, else_expr } => {
                    tasks.push(NilTask::Expr(else_expr));
                    tasks.push(NilTask::Expr(then_expr));
                    tasks.push(NilTask::Expr(cond));
                }
                Expr::Closure { params, body, .. } => {
                    tasks.push(NilTask::Body(body));
                    for p in params.iter_mut().rev() {
                        if let Some(d) = &mut p.default { tasks.push(NilTask::Expr(d)); }
                    }
                }
                Expr::Match { target, cases } => {
                    for c in cases.iter_mut().rev() {
                        tasks.push(NilTask::Body(&mut c.body));
                        if let Some(g) = &mut c.guard { tasks.push(NilTask::Expr(g)); }
                    }
                    tasks.push(NilTask::Expr(target));
                }
                Expr::Comprehension { body, value, clauses, .. } => {
                    for cl in clauses.iter_mut().rev() {
                        for f in cl.filters.iter_mut().rev() { tasks.push(NilTask::Expr(f)); }
                        tasks.push(NilTask::Expr(&mut cl.iter));
                    }
                    if let Some(v) = value { tasks.push(NilTask::Expr(v)); }
                    tasks.push(NilTask::Expr(body));
                }
                _ => {}
            },
        }
    }
}

pub(crate) fn resolve_bound_nil_in_module(m: &mut AiceModule) {
    for it in &mut m.items {
        match it {
            AiceItem::Fn(f) => {
                for p in &mut f.params {
                    if let Some(d) = &mut p.default { run_nil_tasks(NilTask::Expr(d)); }
                }
                run_nil_tasks(NilTask::Body(&mut f.body));
            }
            AiceItem::Class(c) => {
                for prop in &mut c.props {
                    if let Some(init) = &mut prop.init { run_nil_tasks(NilTask::Expr(init)); }
                }
                for mth in &mut c.methods {
                    for p in &mut mth.params {
                        if let Some(d) = &mut p.default { run_nil_tasks(NilTask::Expr(d)); }
                    }
                    run_nil_tasks(NilTask::Body(&mut mth.body));
                }
                for sb in &mut c.static_blocks { run_nil_tasks(NilTask::Slice(sb)); }
            }
            AiceItem::Var(v) => run_nil_tasks(NilTask::Expr(&mut v.value)),
            AiceItem::Const(c) => run_nil_tasks(NilTask::Expr(&mut c.value)),
            AiceItem::Component(comp) => run_nil_tasks(NilTask::Slice(&mut comp.body_stmts)),
            _ => {}
        }
    }
}
