use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::CommentStyle;
use crate::compile::expr_emit::assign_native;
use crate::compile::iter_emit::{CTask, EvalState};
use crate::compile::iter_match_pat::case_has_cond;
use crate::compile::pattern_emit::needs_if_lowering;
use crate::compile::type_map::emit_type;
use crate::ir_code::{Expr, FnBody, LiteralVal, MatchCase, Stmt};

pub(crate) fn step_py_task<'a>(
    task: CTask<'a>,
    st: &mut EvalState,
    tasks: &mut Vec<CTask<'a>>,
) {
    let ec = st.ctxs.last_mut().expect("active EmitCtx");
    match task {
        CTask::PyPush => ec.push(),
        CTask::PyPop => ec.pop(),
        CTask::PyTrivia(tr) => ec.emit_trivia(tr, CommentStyle::Hash),
        CTask::PyLine(s) => ec.line(s),
        CTask::PyOwnedLine(s) => ec.line(&s),
        CTask::PyStmtsOrPass(stmts) => {
            if stmts.is_empty() { ec.line("pass"); } else { tasks.push(CTask::PyStmts(stmts)); }
        }
        CTask::PyStmts(stmts) => {
            for item in stmts.iter().rev() { tasks.push(CTask::PyStmt(item)); }
        }
        CTask::PyStmt(stmt) => push_py_stmt(stmt, st, tasks),
        CTask::PyLet { name, ty } => {
            let rhs = st.vals.pop().unwrap();
            let t = ty.map(|x| format!(": {}", emit_type(x, LanguageId::Python))).unwrap_or_default();
            ec.line(&format!("{name}{t} = {rhs}"));
        }
        CTask::PyAssign(op) => {
            let r = st.vals.pop().unwrap();
            let l = st.vals.pop().unwrap();
            ec.line(&format!("{l} {} {r}", assign_native(op, LanguageId::Python)));
        }
        CTask::PyReturn(has_val) => {
            if has_val { let v = st.vals.pop().unwrap(); ec.line(&format!("return {v}")); }
            else { ec.line("return"); }
        }
        CTask::PyExprStmt => { let v = st.vals.pop().unwrap(); ec.line(&v); }
        CTask::PyIfHdr => { let c = st.vals.pop().unwrap(); ec.line(&format!("if {c}:")); }
        CTask::PyElifHdr => { let c = st.vals.pop().unwrap(); ec.line(&format!("elif {c}:")); }
        CTask::PyWhileHdr => { let c = st.vals.pop().unwrap(); ec.line(&format!("while {c}:")); }
        CTask::PyForHdr(b) => { let it = st.vals.pop().unwrap(); ec.line(&format!("for {b} in {it}:")); }
        CTask::PyThrow => { let e = st.vals.pop().unwrap(); ec.line(&format!("raise {e}")); }
        CTask::PyMatchStmt { target, cases } => push_py_match_stmt(target, cases, st, tasks),
        CTask::PyMatchIfArm { first, has_cond } => {
            if has_cond {
                let c = st.vals.pop().unwrap();
                ec.line(&format!("{} {c}:", if first { "if" } else { "elif" }));
            } else if first { ec.line("if True:"); } else { ec.line("else:"); }
        }
        CTask::PyMatchCaseHdr(has_g) => {
            let g = if has_g { format!(" if {}", st.vals.pop().unwrap()) } else { String::new() };
            let pat = st.vals.pop().unwrap();
            ec.line(&format!("case {pat}{g}:"));
        }
        _ => unreachable!(),
    }
}

fn push_py_stmt<'a>(stmt: &'a Stmt, st: &mut EvalState, tasks: &mut Vec<CTask<'a>>) {
    let ec = st.ctxs.last_mut().unwrap();
    match stmt {
        Stmt::Pass => ec.line("pass"),
        Stmt::Comment(tr) => ec.emit_trivia(tr, CommentStyle::Hash),
        Stmt::Let { name, ty, init, trivia, .. } => {
            ec.emit_trivia(trivia, CommentStyle::Hash);
            tasks.push(CTask::PyLet { name, ty: ty.as_ref() });
            tasks.push(CTask::EvalExpr(init));
        }
        Stmt::Assign { target, op, value, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::Hash);
            tasks.push(CTask::PyAssign(*op));
            tasks.push(CTask::EvalExpr(value));
            tasks.push(CTask::EvalExpr(target));
        }
        Stmt::Return { value: Some(e), trivia } => {
            ec.emit_trivia(trivia, CommentStyle::Hash);
            tasks.push(CTask::PyReturn(true));
            tasks.push(CTask::EvalExpr(e));
        }
        Stmt::Return { value: None, trivia } => { ec.emit_trivia(trivia, CommentStyle::Hash); ec.line("return"); }
        Stmt::Expr { expr, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::Hash);
            tasks.push(CTask::PyExprStmt);
            tasks.push(CTask::EvalExpr(expr));
        }
        Stmt::If { cond, then_body, elifs, elif_trivias, else_body, else_trivia, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::Hash);
            if let Some(eb) = else_body {
                tasks.push(CTask::PyPop); tasks.push(CTask::PyStmtsOrPass(eb));
                tasks.push(CTask::PyPush); tasks.push(CTask::PyLine("else:")); tasks.push(CTask::PyTrivia(else_trivia));
            }
            for (idx, (c, b)) in elifs.iter().enumerate().rev() {
                tasks.push(CTask::PyPop); tasks.push(CTask::PyStmtsOrPass(b));
                tasks.push(CTask::PyPush); tasks.push(CTask::PyElifHdr); tasks.push(CTask::EvalExpr(c));
                if let Some(etr) = elif_trivias.get(idx) { tasks.push(CTask::PyTrivia(etr)); }
            }
            tasks.push(CTask::PyPop); tasks.push(CTask::PyStmtsOrPass(then_body));
            tasks.push(CTask::PyPush); tasks.push(CTask::PyIfHdr); tasks.push(CTask::EvalExpr(cond));
        }
        Stmt::While { cond, body, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::Hash);
            tasks.push(CTask::PyPop); tasks.push(CTask::PyStmtsOrPass(body));
            tasks.push(CTask::PyPush); tasks.push(CTask::PyWhileHdr); tasks.push(CTask::EvalExpr(cond));
        }
        Stmt::For { binding, iter, body, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::Hash);
            tasks.push(CTask::PyPop); tasks.push(CTask::PyStmtsOrPass(body));
            tasks.push(CTask::PyPush); tasks.push(CTask::PyForHdr(binding)); tasks.push(CTask::EvalExpr(iter));
        }
        Stmt::Try { try_body, catches, finally_body, finally_trivia, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::Hash);
            if let Some(fb) = finally_body {
                tasks.push(CTask::PyPop); tasks.push(CTask::PyStmtsOrPass(fb));
                tasks.push(CTask::PyPush); tasks.push(CTask::PyLine("finally:")); tasks.push(CTask::PyTrivia(finally_trivia));
            }
            for cc in catches.iter().rev() {
                let p = cc.param.as_deref().filter(|s| *s != "...")
                    .and_then(|s| s.split(',').next()).map(str::trim).filter(|s| !s.is_empty()).unwrap_or("err");
                tasks.push(CTask::PyPop); tasks.push(CTask::PyStmtsOrPass(&cc.body));
                tasks.push(CTask::PyPush); tasks.push(CTask::PyOwnedLine(format!("except Exception as {p}:")));
                tasks.push(CTask::PyTrivia(&cc.trivia));
            }
            ec.line("try:"); ec.push();
            tasks.push(CTask::PyPop); tasks.push(CTask::PyStmtsOrPass(try_body));
        }
        Stmt::Throw { expr, .. } => { tasks.push(CTask::PyThrow); tasks.push(CTask::EvalExpr(expr)); }
        Stmt::Break { .. } => ec.line("break"),
        Stmt::Continue { .. } => ec.line("continue"),
        Stmt::Match { target, cases, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::Hash);
            tasks.push(CTask::PyMatchStmt { target, cases });
            tasks.push(CTask::EvalExpr(target));
        }
        _ => ec.line("pass"),
    }
}

fn push_py_match_stmt<'a>(target: &'a Expr, cases: &'a [MatchCase], st: &mut EvalState, tasks: &mut Vec<CTask<'a>>) {
    let subj = st.vals.pop().unwrap();
    let ec = st.ctxs.last_mut().unwrap();
    if needs_if_lowering(target, cases, LanguageId::Python) {
        let subjectless = matches!(target, Expr::Literal(LiteralVal::Bool(true))) && cases.iter().any(|c| c.guard.is_some());
        for (idx, mc) in cases.iter().enumerate().rev() {
            let hc = case_has_cond(mc, subjectless);
            tasks.push(CTask::PyPop);
            match &mc.body {
                FnBody::Expr(e) => { tasks.push(CTask::PyExprStmt); tasks.push(CTask::EvalExpr(e)); }
                FnBody::Block(b) => tasks.push(CTask::PyStmtsOrPass(b)),
                FnBody::SignatureOnly => tasks.push(CTask::PyLine("pass")),
            }
            tasks.push(CTask::PyPush);
            tasks.push(CTask::PyMatchIfArm { first: idx == 0, has_cond: hc });
            if hc { tasks.push(CTask::EvalCaseCond { mc, subj: subj.clone(), subjectless }); }
        }
    } else {
        ec.line(&format!("match {subj}:")); ec.push();
        tasks.push(CTask::PyPop);
        for mc in cases.iter().rev() {
            let hg = mc.guard.is_some();
            tasks.push(CTask::PyPop);
            match &mc.body {
                FnBody::Expr(e) => { tasks.push(CTask::PyExprStmt); tasks.push(CTask::EvalExpr(e)); }
                FnBody::Block(b) => tasks.push(CTask::PyStmtsOrPass(b)),
                FnBody::SignatureOnly => tasks.push(CTask::PyLine("pass")),
            }
            tasks.push(CTask::PyPush);
            tasks.push(CTask::PyMatchCaseHdr(hg));
            if let Some(g) = &mc.guard { tasks.push(CTask::EvalExpr(g)); }
            tasks.push(CTask::EvalPat(&mc.pattern));
        }
    }
}
