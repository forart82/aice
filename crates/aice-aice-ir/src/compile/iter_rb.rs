use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::compile::expr_emit::assign_native;
use crate::compile::iter_emit::{CTask, EvalState};
use crate::compile::iter_match_pat::case_has_cond;
use crate::compile::pattern_emit::needs_if_lowering;
use crate::compile::type_map::emit_type;
use crate::ir_code::{Expr, FnBody, LiteralVal, MatchCase, Pattern, Stmt};

pub(crate) fn emit_rb_line(ec: &mut EmitCtx, s: &str) {
    if !s.contains('\n') || ec.indent == 0 {
        ec.line(s);
        return;
    }
    let pad = ec.tab.repeat(ec.indent);
    for (idx, line) in s.split('\n').enumerate() {
        if idx == 0 { ec.line(line); }
        else if line.is_empty() { ec.out.push('\n'); }
        else { ec.out.push_str(&pad); ec.out.push_str(line); ec.out.push('\n'); }
    }
}

pub(crate) fn step_rb_task<'a>(
    task: CTask<'a>,
    st: &mut EvalState,
    tasks: &mut Vec<CTask<'a>>,
) {
    let ec = st.ctxs.last_mut().expect("active EmitCtx");
    match task {
        CTask::RbPush => ec.push(),
        CTask::RbPop => ec.pop(),
        CTask::RbLine(s) => ec.line(s),
        CTask::RbOwnedLine(s) => ec.line(&s),
        CTask::RbLineVal => { let v = st.vals.pop().unwrap(); emit_rb_line(ec, &v); }
        CTask::RbStmts(stmts) => {
            for item in stmts.iter().rev() { tasks.push(CTask::RbStmt(item)); }
        }
        CTask::RbStmt(stmt) => push_rb_stmt(stmt, st, tasks),
        CTask::RbLet(name) => { let v = st.vals.pop().unwrap(); emit_rb_line(ec, &format!("{name} = {v}")); }
        CTask::RbAssign(op) => {
            let r = st.vals.pop().unwrap();
            let l = st.vals.pop().unwrap();
            emit_rb_line(ec, &format!("{l} {} {r}", assign_native(op, LanguageId::Ruby)));
        }
        CTask::RbReturn => { let v = st.vals.pop().unwrap(); emit_rb_line(ec, &format!("return {v}")); }
        CTask::RbIfHdr => { let c = st.vals.pop().unwrap(); ec.line(&format!("if {c}")); }
        CTask::RbElifHdr => { let c = st.vals.pop().unwrap(); ec.line(&format!("elsif {c}")); }
        CTask::RbWhileHdr => { let c = st.vals.pop().unwrap(); ec.line(&format!("while {c}")); }
        CTask::RbForHdr(b) => { let it = st.vals.pop().unwrap(); ec.line(&format!("for {b} in {it}")); }
        CTask::RbThrow => { let e = st.vals.pop().unwrap(); ec.line(&format!("raise {e}")); }
        CTask::RbDestructure(names) => { let v = st.vals.pop().unwrap(); ec.line(&format!("{} = {v}", names.join(", "))); }
        CTask::RbMatchStmt { target, cases } => push_rb_match_stmt(target, cases, st, tasks),
        CTask::RbMatchIfArm { first, has_cond } => {
            if has_cond {
                let c = st.vals.pop().unwrap();
                ec.line(&format!("{} {c}", if first { "if" } else { "elsif" }));
            } else if first { ec.line("if true"); } else { ec.line("else"); }
        }
        CTask::RbMatchWhenHdr => { let p = st.vals.pop().unwrap(); ec.line(&format!("when {p}")); }
        _ => unreachable!(),
    }
}

fn push_rb_stmt<'a>(stmt: &'a Stmt, st: &mut EvalState, tasks: &mut Vec<CTask<'a>>) {
    let ec = st.ctxs.last_mut().unwrap();
    match stmt {
        Stmt::Pass => {}
        Stmt::Comment(tr) => ec.emit_trivia(tr, CommentStyle::Hash),
        Stmt::Let { name, init, .. } => { tasks.push(CTask::RbLet(name)); tasks.push(CTask::EvalExpr(init)); }
        Stmt::Assign { target, op, value, .. } => {
            tasks.push(CTask::RbAssign(*op)); tasks.push(CTask::EvalExpr(value)); tasks.push(CTask::EvalExpr(target));
        }
        Stmt::Return { value: Some(e), .. } => { tasks.push(CTask::RbReturn); tasks.push(CTask::EvalExpr(e)); }
        Stmt::Return { value: None, .. } => ec.line("return"),
        Stmt::Expr { expr, .. } => { tasks.push(CTask::RbLineVal); tasks.push(CTask::EvalExpr(expr)); }
        Stmt::If { cond, then_body, elifs, else_body, .. } => {
            tasks.push(CTask::RbLine("end"));
            if let Some(eb) = else_body {
                tasks.push(CTask::RbPop); tasks.push(CTask::RbStmts(eb));
                tasks.push(CTask::RbPush); tasks.push(CTask::RbLine("else"));
            }
            for (c, b) in elifs.iter().rev() {
                tasks.push(CTask::RbPop); tasks.push(CTask::RbStmts(b));
                tasks.push(CTask::RbPush); tasks.push(CTask::RbElifHdr); tasks.push(CTask::EvalExpr(c));
            }
            tasks.push(CTask::RbPop); tasks.push(CTask::RbStmts(then_body));
            tasks.push(CTask::RbPush); tasks.push(CTask::RbIfHdr); tasks.push(CTask::EvalExpr(cond));
        }
        Stmt::While { cond, body, .. } => {
            tasks.push(CTask::RbLine("end")); tasks.push(CTask::RbPop);
            tasks.push(CTask::RbStmts(body)); tasks.push(CTask::RbPush);
            tasks.push(CTask::RbWhileHdr); tasks.push(CTask::EvalExpr(cond));
        }
        Stmt::Loop { body, .. } => {
            ec.line("loop do"); ec.push();
            tasks.push(CTask::RbLine("end")); tasks.push(CTask::RbPop); tasks.push(CTask::RbStmts(body));
        }
        Stmt::For { binding, iter, body, .. } => {
            tasks.push(CTask::RbLine("end")); tasks.push(CTask::RbPop);
            tasks.push(CTask::RbStmts(body)); tasks.push(CTask::RbPush);
            tasks.push(CTask::RbForHdr(binding)); tasks.push(CTask::EvalExpr(iter));
        }
        Stmt::Try { try_body, catches, else_body, finally_body, .. } => {
            tasks.push(CTask::RbLine("end"));
            if let Some(fb) = finally_body {
                tasks.push(CTask::RbPop); tasks.push(CTask::RbStmts(fb));
                tasks.push(CTask::RbPush); tasks.push(CTask::RbLine("ensure"));
            }
            if let Some(eb) = else_body {
                tasks.push(CTask::RbPop); tasks.push(CTask::RbStmts(eb));
                tasks.push(CTask::RbPush); tasks.push(CTask::RbLine("else"));
            }
            for cc in catches.iter().rev() {
                let ty_s = cc.ty.as_ref().map(|t| emit_type(t, LanguageId::Ruby)).unwrap_or_default();
                let p_opt = cc.param.as_deref().filter(|p| *p != "...")
                    .and_then(|s| s.split(',').next()).map(str::trim).filter(|s| !s.is_empty());
                let hdr = match (ty_s.is_empty(), p_opt) {
                    (true, Some(p)) => format!("rescue => {p}"), (true, None) => "rescue".into(),
                    (false, Some(p)) => format!("rescue {ty_s} => {p}"), (false, None) => format!("rescue {ty_s}"),
                };
                tasks.push(CTask::RbPop); tasks.push(CTask::RbStmts(&cc.body));
                tasks.push(CTask::RbPush); tasks.push(CTask::RbOwnedLine(hdr));
            }
            ec.line("begin"); ec.push();
            tasks.push(CTask::RbPop); tasks.push(CTask::RbStmts(try_body));
        }
        Stmt::Throw { expr, .. } => { tasks.push(CTask::RbThrow); tasks.push(CTask::EvalExpr(expr)); }
        Stmt::Break { .. } => ec.line("break"),
        Stmt::Continue { .. } => ec.line("next"),
        Stmt::Match { target, cases, .. } => { tasks.push(CTask::RbMatchStmt { target, cases }); tasks.push(CTask::EvalExpr(target)); }
        Stmt::Destructure { names, init, .. } => { tasks.push(CTask::RbDestructure(names)); tasks.push(CTask::EvalExpr(init)); }
    }
}

fn push_rb_match_stmt<'a>(target: &'a Expr, cases: &'a [MatchCase], st: &mut EvalState, tasks: &mut Vec<CTask<'a>>) {
    let subj = st.vals.pop().unwrap();
    let ec = st.ctxs.last_mut().unwrap();
    if needs_if_lowering(target, cases, LanguageId::Ruby) {
        let subjectless = matches!(target, Expr::Literal(LiteralVal::Bool(true))) && cases.iter().any(|c| c.guard.is_some());
        if !cases.is_empty() { tasks.push(CTask::RbLine("end")); }
        for (idx, mc) in cases.iter().enumerate().rev() {
            let hc = case_has_cond(mc, subjectless);
            tasks.push(CTask::RbPop);
            match &mc.body {
                FnBody::Expr(e) => { tasks.push(CTask::RbLineVal); tasks.push(CTask::EvalExpr(e)); }
                FnBody::Block(b) => tasks.push(CTask::RbStmts(b)),
                FnBody::SignatureOnly => {}
            }
            tasks.push(CTask::RbPush);
            tasks.push(CTask::RbMatchIfArm { first: idx == 0, has_cond: hc });
            if hc { tasks.push(CTask::EvalCaseCond { mc, subj: subj.clone(), subjectless }); }
        }
    } else {
        ec.line(&format!("case {subj}"));
        tasks.push(CTask::RbLine("end"));
        for mc in cases.iter().rev() {
            tasks.push(CTask::RbPop);
            match &mc.body {
                FnBody::Expr(e) => { tasks.push(CTask::RbLineVal); tasks.push(CTask::EvalExpr(e)); }
                FnBody::Block(b) => tasks.push(CTask::RbStmts(b)),
                FnBody::SignatureOnly => {}
            }
            tasks.push(CTask::RbPush);
            match &mc.pattern {
                Pattern::Wildcard => tasks.push(CTask::RbLine("else")),
                other => { tasks.push(CTask::RbMatchWhenHdr); tasks.push(CTask::EvalPat(other)); }
            }
        }
    }
}
