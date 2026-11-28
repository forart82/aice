use crate::ir::Trivia;
use crate::ir_clone::{CloneEnv, CloneTask};
use crate::ir_code::{AssignOp, Stmt};

pub(crate) enum StmtFinish {
    Let { name: String, is_mut: bool, has_ty: bool, has_init: bool, trivia: Trivia },
    Destructure { names: Vec<String>, is_mut: bool, has_ty: bool, trivia: Trivia },
    Assign { op: AssignOp, trivia: Trivia },
    Return { has_val: bool, trivia: Trivia },
    Expr(Trivia),
    Throw { has_cause: bool, trivia: Trivia },
    If {
        then_len: usize,
        elif_lens: Vec<usize>,
        elif_trivias: Vec<Trivia>,
        else_len: Option<usize>,
        else_trivia: Trivia,
        trivia: Trivia,
    },
    Match { len: usize, trivia: Trivia },
    For { binding: String, len: usize, trivia: Trivia },
    While { len: usize, trivia: Trivia },
    Loop { len: usize, trivia: Trivia },
    Try {
        try_len: usize,
        catch_len: usize,
        else_len: Option<usize>,
        else_trivia: Trivia,
        finally_len: Option<usize>,
        finally_trivia: Trivia,
        trivia: Trivia,
    },
}

pub(crate) fn push_stmt<'a>(env: &mut CloneEnv<'a>, s: &'a Stmt) {
    match s {
        Stmt::Let { name, is_mut, ty, init, trivia } => {
            env.tasks.push(CloneTask::FinishStmt(StmtFinish::Let {
                name: name.clone(), is_mut: *is_mut, has_ty: ty.is_some(), has_init: init.is_some(), trivia: trivia.clone(),
            }));
            if let Some(e) = init { env.tasks.push(CloneTask::Expr(e)); }
            if let Some(t) = ty { env.tasks.push(CloneTask::Ty(t)); }
        }
        Stmt::Destructure { names, is_mut, ty, init, trivia } => {
            env.tasks.push(CloneTask::FinishStmt(StmtFinish::Destructure {
                names: names.clone(), is_mut: *is_mut, has_ty: ty.is_some(), trivia: trivia.clone(),
            }));
            env.tasks.push(CloneTask::Expr(init));
            if let Some(t) = ty { env.tasks.push(CloneTask::Ty(t)); }
        }
        Stmt::Assign { target, op, value, trivia } => {
            env.tasks.push(CloneTask::FinishStmt(StmtFinish::Assign { op: *op, trivia: trivia.clone() }));
            env.tasks.push(CloneTask::Expr(value));
            env.tasks.push(CloneTask::Expr(target));
        }
        Stmt::Return { value, trivia } => {
            env.tasks.push(CloneTask::FinishStmt(StmtFinish::Return {
                has_val: value.is_some(), trivia: trivia.clone(),
            }));
            if let Some(v) = value { env.tasks.push(CloneTask::Expr(v)); }
        }
        Stmt::Expr { expr, trivia } => {
            env.tasks.push(CloneTask::FinishStmt(StmtFinish::Expr(trivia.clone())));
            env.tasks.push(CloneTask::Expr(expr));
        }
        Stmt::Throw { expr, cause, trivia } => {
            env.tasks.push(CloneTask::FinishStmt(StmtFinish::Throw {
                has_cause: cause.is_some(),
                trivia: trivia.clone(),
            }));
            if let Some(c) = cause { env.tasks.push(CloneTask::Expr(c)); }
            env.tasks.push(CloneTask::Expr(expr));
        }
        Stmt::If { cond, then_body, elifs, elif_trivias, else_body, else_trivia, trivia } => {
            env.tasks.push(CloneTask::FinishStmt(StmtFinish::If {
                then_len: then_body.len(),
                elif_lens: elifs.iter().map(|(_, b)| b.len()).collect(),
                elif_trivias: elif_trivias.clone(),
                else_len: else_body.as_ref().map(Vec::len),
                else_trivia: else_trivia.clone(),
                trivia: trivia.clone(),
            }));
            if let Some(eb) = else_body {
                for st in eb.iter().rev() { env.tasks.push(CloneTask::Stmt(st)); }
            }
            for (ec, eb) in elifs.iter().rev() {
                for st in eb.iter().rev() { env.tasks.push(CloneTask::Stmt(st)); }
                env.tasks.push(CloneTask::Expr(ec));
            }
            for st in then_body.iter().rev() { env.tasks.push(CloneTask::Stmt(st)); }
            env.tasks.push(CloneTask::Expr(cond));
        }
        Stmt::Match { target, cases, trivia } => {
            env.tasks.push(CloneTask::FinishStmt(StmtFinish::Match { len: cases.len(), trivia: trivia.clone() }));
            for mc in cases.iter().rev() { env.tasks.push(CloneTask::Case(mc)); }
            env.tasks.push(CloneTask::Expr(target));
        }
        Stmt::For { binding, iter, body, trivia } => {
            env.tasks.push(CloneTask::FinishStmt(StmtFinish::For {
                binding: binding.clone(), len: body.len(), trivia: trivia.clone(),
            }));
            for st in body.iter().rev() { env.tasks.push(CloneTask::Stmt(st)); }
            env.tasks.push(CloneTask::Expr(iter));
        }
        Stmt::While { cond, body, trivia } => {
            env.tasks.push(CloneTask::FinishStmt(StmtFinish::While { len: body.len(), trivia: trivia.clone() }));
            for st in body.iter().rev() { env.tasks.push(CloneTask::Stmt(st)); }
            env.tasks.push(CloneTask::Expr(cond));
        }
        Stmt::Loop { body, trivia } => {
            env.tasks.push(CloneTask::FinishStmt(StmtFinish::Loop { len: body.len(), trivia: trivia.clone() }));
            for st in body.iter().rev() { env.tasks.push(CloneTask::Stmt(st)); }
        }
        Stmt::Try { try_body, catches, else_body, else_trivia, finally_body, finally_trivia, trivia } => {
            env.tasks.push(CloneTask::FinishStmt(StmtFinish::Try {
                try_len: try_body.len(),
                catch_len: catches.len(),
                else_len: else_body.as_ref().map(Vec::len),
                else_trivia: else_trivia.clone(),
                finally_len: finally_body.as_ref().map(Vec::len),
                finally_trivia: finally_trivia.clone(),
                trivia: trivia.clone(),
            }));
            if let Some(fb) = finally_body {
                for st in fb.iter().rev() { env.tasks.push(CloneTask::Stmt(st)); }
            }
            if let Some(eb) = else_body {
                for st in eb.iter().rev() { env.tasks.push(CloneTask::Stmt(st)); }
            }
            for cc in catches.iter().rev() { env.tasks.push(CloneTask::Catch(cc)); }
            for st in try_body.iter().rev() { env.tasks.push(CloneTask::Stmt(st)); }
        }
        Stmt::Break { label, trivia } => env.stmts.push(Stmt::Break { label: label.clone(), trivia: trivia.clone() }),
        Stmt::Continue { label, trivia } => env.stmts.push(Stmt::Continue { label: label.clone(), trivia: trivia.clone() }),
        Stmt::Pass => env.stmts.push(Stmt::Pass),
        Stmt::Comment(t) => env.stmts.push(Stmt::Comment(t.clone())),
        Stmt::Raw { text, trivia } => env.stmts.push(Stmt::Raw { text: text.clone(), trivia: trivia.clone() }),
    }
}

pub(crate) fn finish_stmt(env: &mut CloneEnv<'_>, f: StmtFinish) {
    let s = match f {
        StmtFinish::Let { name, is_mut, has_ty, has_init, trivia } => {
            let init = if has_init { Some(env.exprs.pop().expect("let init")) } else { None };
            let ty = if has_ty { Some(env.tys.pop().expect("let ty")) } else { None };
            Stmt::Let { name, is_mut, ty, init, trivia }
        }
        StmtFinish::Destructure { names, is_mut, has_ty, trivia } => {
            let init = env.exprs.pop().expect("destr init");
            let ty = if has_ty { Some(env.tys.pop().expect("destr ty")) } else { None };
            Stmt::Destructure { names, is_mut, ty, init, trivia }
        }
        StmtFinish::Assign { op, trivia } => {
            let value = env.exprs.pop().expect("assign val");
            let target = env.exprs.pop().expect("assign tgt");
            Stmt::Assign { target, op, value, trivia }
        }
        StmtFinish::Return { has_val, trivia } => {
            let value = if has_val { Some(env.exprs.pop().expect("ret val")) } else { None };
            Stmt::Return { value, trivia }
        }
        StmtFinish::Expr(trivia) => Stmt::Expr { expr: env.exprs.pop().expect("stmt expr"), trivia },
        StmtFinish::Throw { has_cause, trivia } => {
            let cause = if has_cause { Some(env.exprs.pop().expect("throw cause")) } else { None };
            let expr = env.exprs.pop().expect("throw expr");
            Stmt::Throw { expr, cause, trivia }
        }
        StmtFinish::If { then_len, elif_lens, elif_trivias, else_len, else_trivia, trivia } => {
            let else_body = else_len.map(|n| env.stmts.split_off(env.stmts.len() - n));
            let mut elifs = Vec::with_capacity(elif_lens.len());
            for n in elif_lens.into_iter().rev() {
                let eb = env.stmts.split_off(env.stmts.len() - n);
                let ec = env.exprs.pop().expect("elif cond");
                elifs.push((ec, eb));
            }
            elifs.reverse();
            let then_body = env.stmts.split_off(env.stmts.len() - then_len);
            let cond = env.exprs.pop().expect("if cond");
            Stmt::If { cond, then_body, elifs, elif_trivias, else_body, else_trivia, trivia }
        }
        StmtFinish::Match { len, trivia } => {
            let cases = env.cases.split_off(env.cases.len() - len);
            let target = env.exprs.pop().expect("match tgt");
            Stmt::Match { target, cases, trivia }
        }
        StmtFinish::For { binding, len, trivia } => {
            let body = env.stmts.split_off(env.stmts.len() - len);
            let iter = env.exprs.pop().expect("for iter");
            Stmt::For { binding, iter, body, trivia }
        }
        StmtFinish::While { len, trivia } => {
            let body = env.stmts.split_off(env.stmts.len() - len);
            let cond = env.exprs.pop().expect("while cond");
            Stmt::While { cond, body, trivia }
        }
        StmtFinish::Loop { len, trivia } => {
            Stmt::Loop { body: env.stmts.split_off(env.stmts.len() - len), trivia }
        }
        StmtFinish::Try { try_len, catch_len, else_len, else_trivia, finally_len, finally_trivia, trivia } => {
            let finally_body = finally_len.map(|n| env.stmts.split_off(env.stmts.len() - n));
            let else_body = else_len.map(|n| env.stmts.split_off(env.stmts.len() - n));
            let catches = env.catches.split_off(env.catches.len() - catch_len);
            let try_body = env.stmts.split_off(env.stmts.len() - try_len);
            Stmt::Try { try_body, catches, else_body, else_trivia, finally_body, finally_trivia, trivia }
        }
    };
    env.stmts.push(s);
}
