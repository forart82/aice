use crate::ir::{AiceItem, AiceModule};
use crate::ir_code::{AssignOp, Expr, FnBody, LiteralVal, Pattern, RecordEntry, Stmt};

fn name_binds_nil(s: &str) -> bool {
    s == "nil" || s.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_')).any(|w| w == "nil")
}

fn pat_binds_nil(p: &Pattern) -> bool {
    let mut stack = vec![p];
    while let Some(cur) = stack.pop() {
        match cur {
            Pattern::Ident(n) if name_binds_nil(n) => return true,
            Pattern::Constructor { args, .. } | Pattern::Or(args) => stack.extend(args.iter()),
            _ => {}
        }
    }
    false
}

fn expr_is_nil_target(e: &Expr) -> bool {
    let mut stack = vec![e];
    while let Some(cur) = stack.pop() {
        match cur {
            Expr::Ident(n) if n == "nil" => return true,
            Expr::Literal(LiteralVal::Nil) => return true,
            Expr::Array(items) => stack.extend(items.iter()),
            _ => {}
        }
    }
    false
}

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
    SetBound,
    BeginBranch,
    BranchStart(bool),
    PopMergeBranch,
    FinishBranch,
    PushScope(bool),
    PopScope,
}

fn run_nil_tasks<'a>(init: NilTask<'a>, init_bound: bool) {
    let mut tasks = vec![init];
    let mut scopes = vec![init_bound];
    let mut branches: Vec<(bool, bool)> = Vec::new();
    while let Some(task) = tasks.pop() {
        let cur_bound = *scopes.last().unwrap_or(&false);
        match task {
            NilTask::SetBound => {
                if let Some(top) = scopes.last_mut() { *top = true; }
            }
            NilTask::BeginBranch => branches.push((cur_bound, cur_bound)),
            NilTask::BranchStart(extra) => {
                let orig = branches.last().map(|b| b.0).unwrap_or(cur_bound);
                scopes.push(orig || extra);
            }
            NilTask::PopMergeBranch => {
                let b = scopes.pop().unwrap_or(false);
                if let Some(br) = branches.last_mut() { br.1 |= b; }
            }
            NilTask::FinishBranch => {
                if let Some((_, acc)) = branches.pop()
                    && let Some(top) = scopes.last_mut()
                {
                    *top |= acc;
                }
            }
            NilTask::PushScope(extra) => scopes.push(cur_bound || extra),
            NilTask::PopScope => { scopes.pop(); }
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
                Stmt::Let { name, init, .. } => {
                    if name_binds_nil(name) { tasks.push(NilTask::SetBound); }
                    tasks.push(NilTask::Expr(init));
                }
                Stmt::Destructure { names, init, .. } => {
                    if names.iter().any(|n| name_binds_nil(n)) { tasks.push(NilTask::SetBound); }
                    tasks.push(NilTask::Expr(init));
                }
                Stmt::Assign { target, op, value, .. } => {
                    if expr_is_nil_target(target) {
                        fix_nil_target(target);
                        if *op != AssignOp::Assign {
                            if let Some(top) = scopes.last_mut() { *top = true; }
                        } else {
                            tasks.push(NilTask::SetBound);
                        }
                        tasks.push(NilTask::Expr(value));
                    } else {
                        tasks.push(NilTask::Expr(value));
                        tasks.push(NilTask::Expr(target));
                    }
                }
                Stmt::Expr { expr, .. } => tasks.push(NilTask::Expr(expr)),
                Stmt::Return { value: Some(v), .. } => tasks.push(NilTask::Expr(v)),
                Stmt::Throw { expr, cause, .. } => {
                    if let Some(c) = cause { tasks.push(NilTask::Expr(c)); }
                    tasks.push(NilTask::Expr(expr));
                }
                Stmt::If { cond, then_body, elifs, else_body, .. } => {
                    tasks.push(NilTask::FinishBranch);
                    if let Some(eb) = else_body {
                        tasks.push(NilTask::PopMergeBranch);
                        for s in eb.iter_mut().rev() { tasks.push(NilTask::Stmt(s)); }
                        tasks.push(NilTask::BranchStart(false));
                    }
                    for (ec, eb) in elifs.iter_mut().rev() {
                        tasks.push(NilTask::PopMergeBranch);
                        for s in eb.iter_mut().rev() { tasks.push(NilTask::Stmt(s)); }
                        tasks.push(NilTask::BranchStart(false));
                        tasks.push(NilTask::Expr(ec));
                    }
                    tasks.push(NilTask::PopMergeBranch);
                    for s in then_body.iter_mut().rev() { tasks.push(NilTask::Stmt(s)); }
                    tasks.push(NilTask::BranchStart(false));
                    tasks.push(NilTask::BeginBranch);
                    tasks.push(NilTask::Expr(cond));
                }
                Stmt::While { cond, body, .. } => {
                    for s in body.iter_mut().rev() { tasks.push(NilTask::Stmt(s)); }
                    tasks.push(NilTask::Expr(cond));
                }
                Stmt::For { binding, iter, body, .. } => {
                    for s in body.iter_mut().rev() { tasks.push(NilTask::Stmt(s)); }
                    if name_binds_nil(binding) { tasks.push(NilTask::SetBound); }
                    tasks.push(NilTask::Expr(iter));
                }
                Stmt::Loop { body, .. } => {
                    for s in body.iter_mut().rev() { tasks.push(NilTask::Stmt(s)); }
                }
                Stmt::Match { target, cases, .. } => {
                    tasks.push(NilTask::FinishBranch);
                    for c in cases.iter_mut().rev() {
                        let pb = pat_binds_nil(&c.pattern);
                        tasks.push(NilTask::PopMergeBranch);
                        tasks.push(NilTask::Body(&mut c.body));
                        if let Some(g) = &mut c.guard { tasks.push(NilTask::Expr(g)); }
                        tasks.push(NilTask::BranchStart(pb));
                    }
                    tasks.push(NilTask::BeginBranch);
                    tasks.push(NilTask::Expr(target));
                }
                Stmt::Try { try_body, catches, else_body, finally_body, .. } => {
                    if let Some(fb) = finally_body {
                        for s in fb.iter_mut().rev() { tasks.push(NilTask::Stmt(s)); }
                    }
                    tasks.push(NilTask::FinishBranch);
                    if let Some(eb) = else_body {
                        tasks.push(NilTask::PopMergeBranch);
                        for s in eb.iter_mut().rev() { tasks.push(NilTask::Stmt(s)); }
                        tasks.push(NilTask::BranchStart(false));
                    }
                    for cc in catches.iter_mut().rev() {
                        let cb = cc.param.as_deref().is_some_and(name_binds_nil);
                        tasks.push(NilTask::PopMergeBranch);
                        for s in cc.body.iter_mut().rev() { tasks.push(NilTask::Stmt(s)); }
                        tasks.push(NilTask::BranchStart(cb));
                    }
                    tasks.push(NilTask::BeginBranch);
                    for s in try_body.iter_mut().rev() { tasks.push(NilTask::Stmt(s)); }
                }
                _ => {}
            },
            NilTask::Expr(e) => match e {
                Expr::Literal(LiteralVal::Nil) if cur_bound => *e = Expr::Ident("nil".into()),
                Expr::Assign { target, op, value } => {
                    if expr_is_nil_target(target) {
                        fix_nil_target(target);
                        if *op != AssignOp::Assign {
                            if let Some(top) = scopes.last_mut() { *top = true; }
                        } else {
                            tasks.push(NilTask::SetBound);
                        }
                        tasks.push(NilTask::Expr(value));
                    } else {
                        tasks.push(NilTask::Expr(value));
                        tasks.push(NilTask::Expr(target));
                    }
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
                    let binds_p = params.iter().any(|p| p.name == "nil");
                    tasks.push(NilTask::PopScope);
                    tasks.push(NilTask::Body(body));
                    tasks.push(NilTask::PushScope(binds_p));
                    for p in params.iter_mut().rev() {
                        if let Some(d) = &mut p.default { tasks.push(NilTask::Expr(d)); }
                    }
                }
                Expr::Match { target, cases } => {
                    tasks.push(NilTask::FinishBranch);
                    for c in cases.iter_mut().rev() {
                        let pb = pat_binds_nil(&c.pattern);
                        tasks.push(NilTask::PopMergeBranch);
                        tasks.push(NilTask::Body(&mut c.body));
                        if let Some(g) = &mut c.guard { tasks.push(NilTask::Expr(g)); }
                        tasks.push(NilTask::BranchStart(pb));
                    }
                    tasks.push(NilTask::BeginBranch);
                    tasks.push(NilTask::Expr(target));
                }
                _ => {}
            },
        }
    }
}

pub(crate) fn resolve_bound_nil_in_module(m: &mut AiceModule) {
    let mod_binds_nil = m.items.iter().any(|it| match it {
        AiceItem::Var(v) => v.name == "nil",
        AiceItem::Const(c) => c.name == "nil",
        AiceItem::Fn(f) => f.name == "nil",
        _ => false,
    });
    for it in &mut m.items {
        match it {
            AiceItem::Fn(f) => {
                for p in &mut f.params {
                    if let Some(d) = &mut p.default { run_nil_tasks(NilTask::Expr(d), mod_binds_nil); }
                }
                let b = mod_binds_nil || f.params.iter().any(|p| p.name == "nil");
                run_nil_tasks(NilTask::Body(&mut f.body), b);
            }
            AiceItem::Class(c) => {
                for prop in &mut c.props {
                    if let Some(init) = &mut prop.init { run_nil_tasks(NilTask::Expr(init), mod_binds_nil); }
                }
                for mth in &mut c.methods {
                    for p in &mut mth.params {
                        if let Some(d) = &mut p.default { run_nil_tasks(NilTask::Expr(d), mod_binds_nil); }
                    }
                    let b = mod_binds_nil || mth.params.iter().any(|p| p.name == "nil");
                    run_nil_tasks(NilTask::Body(&mut mth.body), b);
                }
                for sb in &mut c.static_blocks { run_nil_tasks(NilTask::Slice(sb), mod_binds_nil); }
            }
            AiceItem::Var(v) => run_nil_tasks(NilTask::Expr(&mut v.value), mod_binds_nil),
            AiceItem::Const(c) => run_nil_tasks(NilTask::Expr(&mut c.value), mod_binds_nil),
            AiceItem::Component(comp) => {
                let b = mod_binds_nil || comp.params.iter().any(|p| p.name == "nil");
                run_nil_tasks(NilTask::Slice(&mut comp.body_stmts), b);
            }
            _ => {}
        }
    }
}
