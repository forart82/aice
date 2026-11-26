use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::EmitCtx;
use crate::compile::expr_emit::ExprEmitCtx;
use crate::compile::iter_expr::step_expr_task;
use crate::compile::iter_match::step_match_expr_task;
use crate::compile::iter_match_pat::step_pat_task;
use crate::compile::iter_py::step_py_task;
use crate::compile::iter_rb::step_rb_task;
use crate::compile::iter_stmt::step_stmt_task;
use crate::ir::Trivia;
use crate::ir_code::{AssignOp, BinaryOp, Expr, FnBody, MatchCase, MemberKind, Pattern, RecordEntry, Stmt, UnaryOp};
use crate::ir_types::{AiceType, ParamDecl};

pub(crate) struct EvalState {
    pub ctxs: Vec<EmitCtx>,
    pub vals: Vec<String>,
}

pub(crate) enum CTask<'a> {
    PushSubCtx { tab: &'static str, indent: usize },
    PopSubCtxToVal,
    WrapParen,
    EvalLiteralStr(&'static str),

    EvalExpr(&'a Expr),
    MakeBinary { op: BinaryOp, is_str: bool },
    MakeUnary { op: UnaryOp, is_postfix: bool, wrap: bool },
    MakeCond,
    MakePostfixTry,
    MakeTemplate { quasis: &'a [String], n_exprs: usize },
    MakeRecord { entries: &'a [RecordEntry], n_vals: usize },
    MakeInlineJsx { tag: &'a str, entries: Option<&'a [RecordEntry]>, n_attr_vals: usize, children: &'a [Expr], n_child_vals: usize },
    MakeArray(usize),
    MakeIndex { is_optional: bool },
    MakeMember { property: &'a str, kind: MemberKind },
    MakeAssign(AssignOp),
    MakeAwait,
    MakeCall { callee_lit: Option<String>, class_new: Option<String>, n_args: usize, is_optional: bool },
    MakeRustStructCall,
    MakeRubyBlock { params: &'a [ParamDecl], body_kind: u8, n_prefix: usize },
    MakeClosure { is_async: bool, params: &'a [ParamDecl], ret: Option<&'a AiceType>, body_kind: u8 },

    EvalPat(&'a Pattern),
    MakePatCtor { name: &'a str, n_args: usize },
    MakePatOr { n_parts: usize },
    MakePatRange { start: &'a Expr, end: &'a Expr, inclusive: bool, negated: bool },
    EvalPatCond { pat: &'a Pattern, subj: String },
    MakePatCondCtor { subj: String },
    MakePatCondOr(usize),
    MakePatCondRange { start: &'a Expr, end: &'a Expr, inclusive: bool, negated: bool, subj: String },
    EvalCaseCond { mc: &'a MatchCase, subj: String, subjectless: bool },
    MakeCaseCond { has_guard: bool },
    PrepMatchExpr { target: &'a Expr, cases: &'a [MatchCase] },
    MakeMatchExpr { subj: String, cases: &'a [MatchCase], subjectless: bool, if_low: bool },
    EvalPyStmtsExpr(&'a [Stmt]),
    EvalCStmtsExpr(&'a [Stmt], &'static str),
    MakeStmtExprTernary { elif_count: usize, is_py: bool },

    BraceStmts { stmts: &'a [Stmt], tail: bool },
    BraceStmt { st: &'a Stmt, tail: bool },
    BracePush,
    BracePop,
    BraceTrivia(&'a Trivia),
    BraceLine(&'static str),
    BraceOwnedLine(String),
    BraceLet { name: &'a str, is_mut: bool, ty: Option<&'a AiceType> },
    BraceDestructure { names: &'a [String], is_mut: bool },
    BraceAssign(AssignOp),
    BraceGoReturn(usize),
    BraceReturn { as_tail: bool },
    BraceExprStmt { as_tail: bool },
    BraceIfHdr,
    BraceElifHdr,
    BraceWhileHdr,
    BraceForHdr(&'a str),
    BraceThrow,
    BraceMatchStmt { target: &'a Expr, cases: &'a [MatchCase] },
    BraceRustArmHdr(bool),
    BraceRustArmExpr(bool),
    BraceKtArmHdr(bool),
    BraceKtArmExpr(bool),
    BraceCaseHdr(&'static str),
    BraceMatchIfArm { first: bool, has_cond: bool },

    PyStmts(&'a [Stmt]),
    PyStmtsOrPass(&'a [Stmt]),
    PyStmt(&'a Stmt),
    PyPush,
    PyPop,
    PyTrivia(&'a Trivia),
    PyLine(&'static str),
    PyOwnedLine(String),
    PyLet { name: &'a str, ty: Option<&'a AiceType> },
    PyAssign(AssignOp),
    PyReturn(bool),
    PyExprStmt,
    PyIfHdr,
    PyElifHdr,
    PyWhileHdr,
    PyForHdr(&'a str),
    PyThrow,
    PyMatchStmt { target: &'a Expr, cases: &'a [MatchCase] },
    PyMatchIfArm { first: bool, has_cond: bool },
    PyMatchCaseHdr(bool),

    RbStmts(&'a [Stmt]),
    RbStmt(&'a Stmt),
    RbPush,
    RbPop,
    RbLine(&'static str),
    RbOwnedLine(String),
    RbLineVal,
    RbLet(&'a str),
    RbAssign(AssignOp),
    RbReturn,
    RbIfHdr,
    RbElifHdr,
    RbWhileHdr,
    RbForHdr(&'a str),
    RbThrow,
    RbDestructure(&'a [String]),
    RbMatchStmt { target: &'a Expr, cases: &'a [MatchCase] },
    RbMatchIfArm { first: bool, has_cond: bool },
    RbMatchWhenHdr,
}

pub(crate) fn run_expr(e: &Expr, lang: LanguageId, ectx: &ExprEmitCtx) -> String {
    let mut st = EvalState { ctxs: Vec::new(), vals: Vec::new() };
    let mut tasks = vec![CTask::EvalExpr(e)];
    run_tasks(lang, ectx, &mut st, &mut tasks);
    st.vals.pop().unwrap_or_default()
}

pub(crate) fn run_brace_stmts(stmts: &[Stmt], lang: LanguageId, ec: &mut EmitCtx, ectx: &ExprEmitCtx, tail: bool) {
    let owned = std::mem::replace(ec, EmitCtx::new(ec.tab));
    let mut st = EvalState { ctxs: vec![owned], vals: Vec::new() };
    let mut tasks = vec![CTask::BraceStmts { stmts, tail }];
    run_tasks(lang, ectx, &mut st, &mut tasks);
    *ec = st.ctxs.pop().unwrap();
}

pub(crate) fn run_py_stmts(ec: &mut EmitCtx, stmts: &[Stmt], ectx: &ExprEmitCtx) {
    let owned = std::mem::replace(ec, EmitCtx::new(ec.tab));
    let mut st = EvalState { ctxs: vec![owned], vals: Vec::new() };
    let mut tasks = vec![CTask::PyStmts(stmts)];
    run_tasks(LanguageId::Python, ectx, &mut st, &mut tasks);
    *ec = st.ctxs.pop().unwrap();
}

pub(crate) fn run_rb_stmts(ec: &mut EmitCtx, stmts: &[Stmt], ectx: &ExprEmitCtx) {
    let owned = std::mem::replace(ec, EmitCtx::new(ec.tab));
    let mut st = EvalState { ctxs: vec![owned], vals: Vec::new() };
    let mut tasks = vec![CTask::RbStmts(stmts)];
    run_tasks(LanguageId::Ruby, ectx, &mut st, &mut tasks);
    *ec = st.ctxs.pop().unwrap();
}

pub(crate) fn body_kind_of(b: &FnBody) -> u8 {
    match b { FnBody::SignatureOnly => 0, FnBody::Expr(_) => 1, FnBody::Block(_) => 2 }
}

fn run_tasks<'a>(lang: LanguageId, ectx: &ExprEmitCtx, st: &mut EvalState, tasks: &mut Vec<CTask<'a>>) {
    while let Some(task) = tasks.pop() {
        match task {
            CTask::PushSubCtx { tab, indent } => { let mut c = EmitCtx::new(tab); c.indent = indent; st.ctxs.push(c); }
            CTask::PopSubCtxToVal => { let c = st.ctxs.pop().expect("sub ctx"); st.vals.push(c.out); }
            CTask::WrapParen => { let v = st.vals.pop().unwrap(); st.vals.push(format!("({v})")); }
            CTask::EvalLiteralStr(s) => st.vals.push(s.to_string()),
            CTask::EvalExpr(_) | CTask::MakeBinary { .. } | CTask::MakeUnary { .. }
            | CTask::MakeCond | CTask::MakePostfixTry | CTask::MakeTemplate { .. }
            | CTask::MakeRecord { .. } | CTask::MakeInlineJsx { .. } | CTask::MakeArray(_)
            | CTask::MakeIndex { .. } | CTask::MakeMember { .. } | CTask::MakeAssign(_)
            | CTask::MakeAwait | CTask::MakeCall { .. } | CTask::MakeRustStructCall
            | CTask::MakeRubyBlock { .. } | CTask::MakeClosure { .. } => step_expr_task(task, lang, ectx, st, tasks),
            CTask::EvalPat(_) | CTask::MakePatCtor { .. } | CTask::MakePatOr { .. }
            | CTask::MakePatRange { .. } | CTask::EvalPatCond { .. } | CTask::MakePatCondCtor { .. }
            | CTask::MakePatCondOr(_) | CTask::MakePatCondRange { .. } | CTask::EvalCaseCond { .. }
            | CTask::MakeCaseCond { .. } => step_pat_task(task, lang, ectx, st, tasks),
            CTask::PrepMatchExpr { .. } | CTask::MakeMatchExpr { .. } | CTask::EvalPyStmtsExpr(_)
            | CTask::EvalCStmtsExpr(_, _) | CTask::MakeStmtExprTernary { .. } => step_match_expr_task(task, lang, st, tasks),
            CTask::BraceStmts { .. } | CTask::BraceStmt { .. } | CTask::BracePush | CTask::BracePop
            | CTask::BraceTrivia(_) | CTask::BraceLine(_) | CTask::BraceOwnedLine(_)
            | CTask::BraceLet { .. } | CTask::BraceDestructure { .. } | CTask::BraceAssign(_)
            | CTask::BraceGoReturn(_) | CTask::BraceReturn { .. } | CTask::BraceExprStmt { .. }
            | CTask::BraceIfHdr | CTask::BraceElifHdr | CTask::BraceWhileHdr | CTask::BraceForHdr(_)
            | CTask::BraceThrow | CTask::BraceMatchStmt { .. } | CTask::BraceRustArmHdr(_)
            | CTask::BraceRustArmExpr(_) | CTask::BraceKtArmHdr(_) | CTask::BraceKtArmExpr(_)
            | CTask::BraceCaseHdr(_) | CTask::BraceMatchIfArm { .. } => step_stmt_task(task, lang, st, tasks),
            CTask::PyStmts(_) | CTask::PyStmtsOrPass(_) | CTask::PyStmt(_) | CTask::PyPush
            | CTask::PyPop | CTask::PyTrivia(_) | CTask::PyLine(_) | CTask::PyOwnedLine(_)
            | CTask::PyLet { .. } | CTask::PyAssign(_) | CTask::PyReturn(_) | CTask::PyExprStmt
            | CTask::PyIfHdr | CTask::PyElifHdr | CTask::PyWhileHdr | CTask::PyForHdr(_)
            | CTask::PyThrow | CTask::PyMatchStmt { .. } | CTask::PyMatchIfArm { .. }
            | CTask::PyMatchCaseHdr(_) => step_py_task(task, st, tasks),
            _ => step_rb_task(task, st, tasks),
        }
    }
}
