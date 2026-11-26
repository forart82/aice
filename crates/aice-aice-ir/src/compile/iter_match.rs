use aice_lang_registry::LanguageId;

use crate::compile::iter_emit::{CTask, EvalState, body_kind_of};
use crate::compile::iter_match_fmt::format_assembled_match;
use crate::compile::iter_match_pat::case_has_cond;
use crate::compile::pattern_emit::needs_if_lowering;
use crate::ir_code::{Expr, FnBody, LiteralVal, MatchCase, Pattern, Stmt};

pub(crate) fn can_be_expr_stmts(init: &[Stmt], allow_match: bool) -> bool {
    let mut work = vec![init];
    while let Some(s) = work.pop() {
        if s.is_empty() { return false; }
        if s.len() == 1 {
            match &s[0] {
                Stmt::Return { value: Some(_), .. } | Stmt::Expr { .. } => {}
                Stmt::Match { .. } if allow_match => {}
                Stmt::If { then_body, elifs, else_body: Some(eb), .. } => {
                    work.push(then_body);
                    for (_, b) in elifs { work.push(b); }
                    work.push(eb);
                }
                _ => return false,
            }
        } else if let Stmt::If { then_body, elifs, else_body: None, .. } = &s[0] {
            work.push(then_body);
            for (_, b) in elifs { work.push(b); }
            work.push(&s[1..]);
        } else {
            return false;
        }
    }
    true
}

pub(crate) fn step_match_expr_task<'a>(
    task: CTask<'a>,
    lang: LanguageId,
    st: &mut EvalState,
    tasks: &mut Vec<CTask<'a>>,
) {
    match task {
        CTask::EvalPyStmtsExpr(stmts) => push_stmt_expr(stmts, true, st, tasks),
        CTask::EvalCStmtsExpr(stmts, fb) => {
            if !can_be_expr_stmts(stmts, false) { st.vals.push(fb.into()); return; }
            push_stmt_expr(stmts, false, st, tasks);
        }
        CTask::MakeStmtExprTernary { elif_count, is_py } => {
            let n = 1 + elif_count;
            let mut tail = st.vals.pop().unwrap();
            for _ in 0..n {
                let t = st.vals.pop().unwrap();
                let c = st.vals.pop().unwrap();
                tail = if is_py { format!("{t} if {c} else {tail}") } else { format!("({c} ? {t} : {tail})") };
            }
            st.vals.push(tail);
        }
        CTask::PrepMatchExpr { target, cases } => {
            let subj = st.vals.pop().unwrap();
            let subjectless = matches!(target, Expr::Literal(LiteralVal::Bool(true))) && cases.iter().any(|c| c.guard.is_some());
            let if_low = needs_if_lowering(target, cases, lang);
            schedule_match_expr(subj, cases, subjectless, if_low, lang, tasks);
        }
        CTask::MakeMatchExpr { subj, cases, subjectless, if_low } => {
            let res = assemble_match_expr(&subj, cases, subjectless, if_low, lang, st);
            st.vals.push(res);
        }
        _ => unreachable!(),
    }
}

fn push_stmt_expr<'a>(stmts: &'a [Stmt], is_py: bool, st: &mut EvalState, tasks: &mut Vec<CTask<'a>>) {
    if is_py && !can_be_expr_stmts(stmts, true) { st.vals.push("None".into()); return; }
    if stmts.len() == 1 {
        match &stmts[0] {
            Stmt::Return { value: Some(e), .. } | Stmt::Expr { expr: e, .. } => {
                if is_py && matches!(e, Expr::Conditional { .. }) {
                    tasks.push(CTask::WrapParen);
                }
                tasks.push(CTask::EvalExpr(e));
            }
            Stmt::Match { target, cases, .. } if is_py => {
                tasks.push(CTask::PrepMatchExpr { target, cases });
                tasks.push(CTask::EvalExpr(target));
            }
            Stmt::If { cond, then_body, elifs, else_body: Some(eb), .. } => {
                tasks.push(CTask::MakeStmtExprTernary { elif_count: elifs.len(), is_py });
                tasks.push(eval_sub(eb, is_py));
                for (ec, eb_stmts) in elifs.iter().rev() {
                    tasks.push(eval_sub(eb_stmts, is_py));
                    tasks.push(CTask::EvalExpr(ec));
                }
                tasks.push(eval_sub(then_body, is_py));
                tasks.push(CTask::EvalExpr(cond));
            }
            _ => {}
        }
    } else if let Stmt::If { cond, then_body, elifs, else_body: None, .. } = &stmts[0] {
        tasks.push(CTask::MakeStmtExprTernary { elif_count: elifs.len(), is_py });
        tasks.push(eval_sub(&stmts[1..], is_py));
        for (ec, eb_stmts) in elifs.iter().rev() {
            tasks.push(eval_sub(eb_stmts, is_py));
            tasks.push(CTask::EvalExpr(ec));
        }
        tasks.push(eval_sub(then_body, is_py));
        tasks.push(CTask::EvalExpr(cond));
    }
}

fn eval_sub<'a>(stmts: &'a [Stmt], is_py: bool) -> CTask<'a> {
    if is_py { CTask::EvalPyStmtsExpr(stmts) } else { CTask::EvalCStmtsExpr(stmts, "null") }
}

fn push_arm_body<'a>(body: &'a FnBody, lang: LanguageId, fallback: &'static str, tail: bool, tasks: &mut Vec<CTask<'a>>) {
    match body {
        FnBody::Expr(e) => {
            if lang == LanguageId::Python && matches!(e, Expr::Conditional { .. }) {
                tasks.push(CTask::WrapParen);
            }
            tasks.push(CTask::EvalExpr(e));
        }
        FnBody::Block(stmts) if lang == LanguageId::Python => tasks.push(CTask::EvalPyStmtsExpr(stmts)),
        FnBody::Block(stmts) if lang == LanguageId::Ruby => {
            tasks.push(CTask::PopSubCtxToVal);
            tasks.push(CTask::RbStmts(stmts));
            tasks.push(CTask::PushSubCtx { tab: "  ", indent: 1 });
        }
        FnBody::Block(stmts) if matches!(lang, LanguageId::Rust | LanguageId::Kotlin | LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript | LanguageId::Go) => {
            tasks.push(CTask::PopSubCtxToVal);
            tasks.push(CTask::BraceStmts { stmts, tail });
            tasks.push(CTask::PushSubCtx { tab: "  ", indent: 0 });
        }
        FnBody::Block(stmts) => tasks.push(CTask::EvalCStmtsExpr(stmts, fallback)),
        FnBody::SignatureOnly => {}
    }
}

fn schedule_match_expr<'a>(
    subj: String,
    cases: &'a [MatchCase],
    subjectless: bool,
    if_low: bool,
    lang: LanguageId,
    tasks: &mut Vec<CTask<'a>>,
) {
    let fb = if matches!(lang, LanguageId::C | LanguageId::Cpp) { "0" } else { "null" };
    tasks.push(CTask::MakeMatchExpr { subj: subj.clone(), cases, subjectless, if_low });
    for (idx, mc) in cases.iter().enumerate().rev() {
        let is_py_or_tern = lang == LanguageId::Python || !matches!(lang, LanguageId::Rust | LanguageId::Kotlin | LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript | LanguageId::Go | LanguageId::Ruby);
        let tail = lang == LanguageId::Rust;
        if is_py_or_tern {
            push_arm_body(&mc.body, lang, fb, false, tasks);
            if !(idx + 1 == cases.len() && matches!(mc.pattern, Pattern::Wildcard) && mc.guard.is_none())
                && case_has_cond(mc, subjectless)
            {
                tasks.push(CTask::EvalCaseCond { mc, subj: subj.clone(), subjectless });
            }
            continue;
        }
        push_arm_body(&mc.body, lang, fb, tail, tasks);
        match lang {
            LanguageId::Rust if !if_low => {
                if let Some(g) = &mc.guard { tasks.push(CTask::EvalExpr(g)); }
                tasks.push(CTask::EvalPat(&mc.pattern));
            }
            LanguageId::Kotlin if !if_low => {
                if subjectless { if let Some(g) = &mc.guard { tasks.push(CTask::EvalExpr(g)); } }
                else if !matches!(mc.pattern, Pattern::Wildcard) { tasks.push(CTask::EvalPat(&mc.pattern)); }
            }
            LanguageId::Rust | LanguageId::Kotlin => {
                if case_has_cond(mc, subjectless) {
                    tasks.push(CTask::EvalCaseCond { mc, subj: subj.clone(), subjectless });
                }
            }
            LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript => {
                if subjectless || if_low {
                    if case_has_cond(mc, subjectless) { tasks.push(CTask::EvalCaseCond { mc, subj: subj.clone(), subjectless }); }
                } else if let Pattern::Or(ps) = &mc.pattern {
                    for p in ps.iter().rev() { tasks.push(CTask::EvalPat(p)); }
                } else if !matches!(mc.pattern, Pattern::Wildcard) {
                    tasks.push(CTask::EvalPat(&mc.pattern));
                }
            }
            _ => {
                if subjectless || if_low {
                    if case_has_cond(mc, subjectless) { tasks.push(CTask::EvalCaseCond { mc, subj: subj.clone(), subjectless }); }
                } else if !matches!(mc.pattern, Pattern::Wildcard) {
                    tasks.push(CTask::EvalPat(&mc.pattern));
                }
            }
        }
    }
}

fn assemble_match_expr(
    subj: &str,
    cases: &[MatchCase],
    subjectless: bool,
    if_low: bool,
    lang: LanguageId,
    st: &mut EvalState,
) -> String {
    let mut arm_parts = Vec::with_capacity(cases.len());
    let is_py_or_tern = lang == LanguageId::Python || !matches!(lang, LanguageId::Rust | LanguageId::Kotlin | LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript | LanguageId::Go | LanguageId::Ruby);
    for (idx, mc) in cases.iter().enumerate().rev() {
        let bk = body_kind_of(&mc.body);
        let body_v = if bk > 0 { Some(st.vals.pop().unwrap()) } else { None };
        let hdr_v = if is_py_or_tern {
            if !(idx + 1 == cases.len() && matches!(mc.pattern, Pattern::Wildcard) && mc.guard.is_none()) && case_has_cond(mc, subjectless) {
                vec![st.vals.pop().unwrap()]
            } else { Vec::new() }
        } else {
            match lang {
                LanguageId::Rust if !if_low => {
                    let g = if mc.guard.is_some() { Some(st.vals.pop().unwrap()) } else { None };
                    let p = st.vals.pop().unwrap();
                    if let Some(gs) = g { vec![p, gs] } else { vec![p] }
                }
                LanguageId::Kotlin if !if_low => {
                    if (subjectless && mc.guard.is_some()) || (!subjectless && !matches!(mc.pattern, Pattern::Wildcard)) {
                        vec![st.vals.pop().unwrap()]
                    } else { Vec::new() }
                }
                LanguageId::Rust | LanguageId::Kotlin => {
                    if case_has_cond(mc, subjectless) { vec![st.vals.pop().unwrap()] } else { Vec::new() }
                }
                LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript if !(subjectless || if_low) => {
                    if let Pattern::Or(ps) = &mc.pattern {
                        let s = st.vals.len() - ps.len();
                        st.vals.drain(s..).collect()
                    } else if !matches!(mc.pattern, Pattern::Wildcard) {
                        vec![st.vals.pop().unwrap()]
                    } else { Vec::new() }
                }
                _ => {
                    if subjectless || if_low {
                        if case_has_cond(mc, subjectless) { vec![st.vals.pop().unwrap()] } else { Vec::new() }
                    } else if !matches!(mc.pattern, Pattern::Wildcard) {
                        vec![st.vals.pop().unwrap()]
                    } else { Vec::new() }
                }
            }
        };
        arm_parts.push((hdr_v, body_v));
    }
    arm_parts.reverse();
    format_assembled_match(subj, cases, subjectless, if_low, lang, arm_parts)
}
