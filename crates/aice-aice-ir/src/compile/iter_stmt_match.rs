use aice_lang_registry::LanguageId;

use crate::compile::iter_emit::{CTask, EvalState};
use crate::compile::iter_match_pat::case_has_cond;
use crate::compile::pattern_emit::needs_if_lowering;
use crate::ir_code::{Expr, FnBody, LiteralVal, MatchCase, Pattern, Stmt};

pub(crate) fn step_brace_match_task<'a>(
    task: CTask<'a>,
    lang: LanguageId,
    st: &mut EvalState,
    tasks: &mut Vec<CTask<'a>>,
    semi: &str,
) {
    let ec = st.ctxs.last_mut().expect("active EmitCtx");
    match task {
        CTask::BraceMatchStmt { target, cases } => push_brace_match_stmt(target, cases, lang, semi, st, tasks),
        CTask::BraceRustArmHdr(has_g) => {
            let g = if has_g { format!(" if {}", st.vals.pop().unwrap()) } else { String::new() };
            let pat = st.vals.pop().unwrap();
            ec.line(&format!("{pat}{g} => {{"));
        }
        CTask::BraceRustArmExpr(has_g) => {
            let rhs = st.vals.pop().unwrap();
            let g = if has_g { format!(" if {}", st.vals.pop().unwrap()) } else { String::new() };
            let pat = st.vals.pop().unwrap();
            ec.line(&format!("{pat}{g} => {rhs},"));
        }
        CTask::BraceKtArmHdr(or_else) => {
            let pat = if or_else { st.vals.pop().unwrap() } else { "else".into() };
            ec.line(&format!("{pat} -> {{"));
        }
        CTask::BraceKtArmExpr(or_else) => {
            let rhs = st.vals.pop().unwrap();
            let pat = if or_else { st.vals.pop().unwrap() } else { "else".into() };
            ec.line(&format!("{pat} -> {rhs}"));
        }
        CTask::BraceCaseHdr(pfx) => { let p = st.vals.pop().unwrap(); ec.line(&format!("{pfx}{p}:")); }
        CTask::BraceMatchIfArm { first, has_cond } => {
            let bare = matches!(lang, LanguageId::Rust | LanguageId::Go);
            if has_cond {
                let c = st.vals.pop().unwrap();
                let hdr = match (first, bare) {
                    (true, true) => format!("if {c} {{"), (true, false) => format!("if ({c}) {{"),
                    (false, true) => format!("}} else if {c} {{"), (false, false) => format!("}} else if ({c}) {{"),
                };
                ec.line(&hdr);
            } else if first { ec.line(if bare { "if true {" } else { "if (true) {" }); }
            else { ec.line("} else {"); }
        }
        _ => unreachable!(),
    }
}

fn push_brace_match_stmt<'a>(target: &'a Expr, cases: &'a [MatchCase], lang: LanguageId, semi: &str, st: &mut EvalState, tasks: &mut Vec<CTask<'a>>) {
    let subj = st.vals.pop().unwrap();
    let has_guard = cases.iter().any(|c| c.guard.is_some());
    let subjectless = matches!(target, Expr::Literal(LiteralVal::Bool(true))) && has_guard;
    let go_tsw = if lang == LanguageId::Go { go_type_switch_hdr(target) } else { None };
    let ec = st.ctxs.last_mut().unwrap();
    if !(lang == LanguageId::Go && (subj == "__select" || go_tsw.is_some())) && needs_if_lowering(target, cases, lang) {
        if !cases.is_empty() { tasks.push(CTask::BraceLine("}")); }
        for (idx, mc) in cases.iter().enumerate().rev() {
            let hc = case_has_cond(mc, subjectless);
            tasks.push(CTask::BracePop);
            match &mc.body {
                FnBody::Expr(e) => { tasks.push(CTask::BraceExprStmt { as_tail: false }); tasks.push(CTask::EvalExpr(e)); }
                FnBody::Block(b) => tasks.push(CTask::BraceStmts { stmts: b, tail: false }),
                FnBody::SignatureOnly => {}
            }
            tasks.push(CTask::BracePush);
            tasks.push(CTask::BraceMatchIfArm { first: idx == 0, has_cond: hc });
            if hc { tasks.push(CTask::EvalCaseCond { mc, subj: subj.clone(), subjectless }); }
        }
        return;
    }
    if lang == LanguageId::Rust {
        ec.line(&format!("match {subj} {{")); ec.push();
        tasks.push(CTask::BraceLine("}")); tasks.push(CTask::BracePop);
        for mc in cases.iter().rev() {
            let hg = mc.guard.is_some();
            match &mc.body {
                FnBody::Expr(e) => {
                    tasks.push(CTask::BraceRustArmExpr(hg)); tasks.push(CTask::EvalExpr(e));
                    if let Some(g) = &mc.guard { tasks.push(CTask::EvalExpr(g)); }
                    tasks.push(CTask::EvalPat(&mc.pattern));
                }
                FnBody::Block(b) => {
                    tasks.push(CTask::BraceLine("}")); tasks.push(CTask::BracePop);
                    tasks.push(CTask::BraceStmts { stmts: b, tail: true }); tasks.push(CTask::BracePush);
                    tasks.push(CTask::BraceRustArmHdr(hg));
                    if let Some(g) = &mc.guard { tasks.push(CTask::EvalExpr(g)); }
                    tasks.push(CTask::EvalPat(&mc.pattern));
                }
                FnBody::SignatureOnly => {
                    tasks.push(CTask::BraceRustArmExpr(hg));
                    tasks.push(CTask::EvalLiteralStr("()"));
                    if let Some(g) = &mc.guard { tasks.push(CTask::EvalExpr(g)); }
                    tasks.push(CTask::EvalPat(&mc.pattern));
                }
            }
        }
    } else if lang == LanguageId::Kotlin {
        if subjectless { ec.line("when {"); } else { ec.line(&format!("when ({subj}) {{")); }
        ec.push(); tasks.push(CTask::BraceLine("}")); tasks.push(CTask::BracePop);
        for mc in cases.iter().rev() {
            let oe = if subjectless { mc.guard.is_some() } else { !matches!(mc.pattern, Pattern::Wildcard) };
            match &mc.body {
                FnBody::Expr(e) => { tasks.push(CTask::BraceKtArmExpr(oe)); tasks.push(CTask::EvalExpr(e)); }
                FnBody::Block(b) => {
                    tasks.push(CTask::BraceLine("}")); tasks.push(CTask::BracePop);
                    tasks.push(CTask::BraceStmts { stmts: b, tail: false }); tasks.push(CTask::BracePush);
                    tasks.push(CTask::BraceKtArmHdr(oe));
                }
                FnBody::SignatureOnly => { tasks.push(CTask::BraceKtArmExpr(oe)); tasks.push(CTask::EvalLiteralStr("Unit")); }
            }
            if subjectless { if let Some(g) = &mc.guard { tasks.push(CTask::EvalExpr(g)); } }
            else if !matches!(mc.pattern, Pattern::Wildcard) { tasks.push(CTask::EvalPat(&mc.pattern)); }
        }
    } else if lang == LanguageId::Go && (subj == "__select" || go_tsw.is_some()) {
        let hdr = match go_tsw {
            Some(h) => format!("switch {h} {{"),
            None => "select {".to_string(),
        };
        ec.line(&hdr); ec.push(); tasks.push(CTask::BraceLine("}")); tasks.push(CTask::BracePop);
        for mc in cases.iter().rev() {
            tasks.push(CTask::BracePop);
            match &mc.body {
                FnBody::Expr(e) => { tasks.push(CTask::BraceExprStmt { as_tail: true }); tasks.push(CTask::EvalExpr(e)); }
                FnBody::Block(b) => tasks.push(CTask::BraceStmts { stmts: b, tail: false }),
                FnBody::SignatureOnly => {}
            }
            tasks.push(CTask::BracePush);
            match &mc.pattern {
                Pattern::Wildcard => tasks.push(CTask::BraceLine("default:")),
                Pattern::Literal(LiteralVal::Str { value, .. }) => tasks.push(CTask::BraceOwnedLine(format!("case {value}:"))),
                other => { tasks.push(CTask::BraceCaseHdr("case ")); tasks.push(CTask::EvalPat(other)); }
            }
        }
    } else {
        ec.line(&format!("switch ({subj}) {{")); ec.push(); tasks.push(CTask::BraceLine("}")); tasks.push(CTask::BracePop);
        for mc in cases.iter().rev() {
            tasks.push(CTask::BracePop);
            if lang != LanguageId::Go && !arm_ends_with_terminator(&mc.body) {
                tasks.push(CTask::BraceOwnedLine(format!("break{semi}")));
            }
            match &mc.body {
                FnBody::Expr(e) => { tasks.push(CTask::BraceExprStmt { as_tail: false }); tasks.push(CTask::EvalExpr(e)); }
                FnBody::Block(b) => tasks.push(CTask::BraceStmts { stmts: b, tail: false }),
                FnBody::SignatureOnly => {}
            }
            tasks.push(CTask::BracePush);
            match &mc.pattern {
                Pattern::Wildcard => tasks.push(CTask::BraceLine("default:")),
                Pattern::Or(ps) if lang != LanguageId::Go => {
                    for sub in ps.iter().rev() { tasks.push(CTask::BraceCaseHdr("case ")); tasks.push(CTask::EvalPat(sub)); }
                }
                other => { tasks.push(CTask::BraceCaseHdr("case ")); tasks.push(CTask::EvalPat(other)); }
            }
        }
    }
}

fn go_type_switch_hdr(target: &Expr) -> Option<&str> {
    if let Expr::Call { callee, args, .. } = target
        && matches!(callee.as_ref(), Expr::Ident(n) if n == "__type_switch")
        && let Some(Expr::Literal(LiteralVal::Str { value, .. })) = args.first()
    {
        Some(value.as_str())
    } else {
        None
    }
}

fn arm_ends_with_terminator(body: &FnBody) -> bool {
    let FnBody::Block(stmts) = body else { return false };
    let mut stack = vec![stmts.as_slice()];
    while let Some(cur) = stack.pop() {
        let Some(last) = cur.iter().rev().find(|s| !matches!(s, Stmt::Comment(_) | Stmt::Pass)) else {
            return false;
        };
        match last {
            Stmt::Break { .. } | Stmt::Return { .. } | Stmt::Throw { .. } | Stmt::Continue { .. } => {}
            Stmt::If { then_body, elifs, else_body: Some(eb), .. } => {
                stack.push(then_body.as_slice());
                for (_, b) in elifs { stack.push(b.as_slice()); }
                stack.push(eb.as_slice());
            }
            _ => return false,
        }
    }
    true
}
