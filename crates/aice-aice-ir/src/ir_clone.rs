use crate::ir::Trivia;
use crate::ir_clone_stmt::{StmtFinish, finish_stmt, push_stmt};
use crate::ir_code::{AssignOp, BinaryOp, CatchClause, FnBody, MemberKind, Stmt, UnaryOp};
use crate::ir_expr::{Expr, MatchCase, Pattern, RecordEntry};
use crate::ir_types::{AiceType, ParamDecl, PrimitiveType, RecordTypeField};

pub(crate) enum CloneTask<'a> {
    Stmt(&'a Stmt),
    FinishStmt(StmtFinish),
    Expr(&'a Expr),
    FinishExpr(ExprFinish),
    Pat(&'a Pattern),
    FinishPat(PatFinish),
    Ty(&'a AiceType),
    FinishTy(TyFinish),
    Body(&'a FnBody),
    FinishBody(Option<usize>),
    Catch(&'a CatchClause),
    FinishCatch { param: Option<String>, has_ty: bool, len: usize, trivia: Trivia },
    Case(&'a MatchCase),
    FinishCase { has_guard: bool, trivia: Trivia },
    Rec(&'a RecordEntry),
    FinishRec(Option<String>),
    Param(&'a ParamDecl),
    FinishParam(&'a ParamDecl),
    RecTy(&'a RecordTypeField),
    FinishRecTy { name: String, optional: bool },
}

pub(crate) enum ExprFinish {
    Template(Vec<String>),
    Binary(BinaryOp),
    Unary { op: UnaryOp, is_postfix: bool },
    Conditional,
    PostfixTry,
    Call { argc: usize, is_optional: bool, is_tagged: bool },
    Member { property: String, kind: MemberKind },
    Index { is_optional: bool },
    Array(usize),
    Record(usize),
    Closure { is_async: bool, param_len: usize, has_ret: bool },
    Assign(AssignOp),
    Await,
    Match(usize),
}

pub(crate) enum PatFinish {
    Ctor { name: String, len: usize },
    Or(usize),
    Range { inclusive: bool, negated: bool },
    TypeCheck(bool),
}

pub(crate) enum TyFinish {
    Array,
    Option,
    Tuple(usize),
    Union(usize),
    Intersection(usize),
    Named { path: Vec<String>, len: usize },
    Result,
    Record(usize),
    Refinement { param: String, base: PrimitiveType },
    Fn(usize),
}

#[derive(Default)]
pub(crate) struct CloneEnv<'a> {
    pub tasks: Vec<CloneTask<'a>>,
    pub stmts: Vec<Stmt>,
    pub exprs: Vec<Expr>,
    pub pats: Vec<Pattern>,
    pub tys: Vec<AiceType>,
    pub bodies: Vec<FnBody>,
    pub catches: Vec<CatchClause>,
    pub cases: Vec<MatchCase>,
    pub recs: Vec<RecordEntry>,
    pub params: Vec<ParamDecl>,
    pub rec_tys: Vec<RecordTypeField>,
}

impl<'a> CloneEnv<'a> {
    pub fn run(&mut self) {
        while let Some(task) = self.tasks.pop() {
            match task {
                CloneTask::Stmt(s) => push_stmt(self, s),
                CloneTask::FinishStmt(f) => finish_stmt(self, f),
                CloneTask::Expr(e) => self.push_expr(e),
                CloneTask::FinishExpr(f) => self.finish_expr(f),
                CloneTask::Pat(p) => self.push_pat(p),
                CloneTask::FinishPat(f) => self.finish_pat(f),
                CloneTask::Ty(t) => self.push_ty(t),
                CloneTask::FinishTy(f) => self.finish_ty(f),
                CloneTask::Body(b) => self.push_body(b),
                CloneTask::FinishBody(n) => {
                    let b = match n {
                        None => FnBody::Expr(self.exprs.pop().expect("body expr")),
                        Some(k) => FnBody::Block(self.stmts.split_off(self.stmts.len() - k)),
                    };
                    self.bodies.push(b);
                }
                CloneTask::Catch(c) => {
                    self.tasks.push(CloneTask::FinishCatch {
                        param: c.param.clone(),
                        has_ty: c.ty.is_some(),
                        len: c.body.len(),
                        trivia: c.trivia.clone(),
                    });
                    for s in c.body.iter().rev() {
                        self.tasks.push(CloneTask::Stmt(s));
                    }
                    if let Some(ref t) = c.ty {
                        self.tasks.push(CloneTask::Ty(t));
                    }
                }
                CloneTask::FinishCatch { param, has_ty, len, trivia } => {
                    let body = self.stmts.split_off(self.stmts.len() - len);
                    let ty = if has_ty { Some(self.tys.pop().expect("catch ty")) } else { None };
                    self.catches.push(CatchClause { param, ty, body, trivia });
                }
                CloneTask::Case(mc) => {
                    self.tasks.push(CloneTask::FinishCase {
                        has_guard: mc.guard.is_some(),
                        trivia: mc.trivia.clone(),
                    });
                    self.tasks.push(CloneTask::Body(&mc.body));
                    if let Some(ref g) = mc.guard {
                        self.tasks.push(CloneTask::Expr(g));
                    }
                    self.tasks.push(CloneTask::Pat(&mc.pattern));
                }
                CloneTask::FinishCase { has_guard, trivia } => {
                    let body = self.bodies.pop().expect("case body");
                    let guard = if has_guard { Some(self.exprs.pop().expect("case guard")) } else { None };
                    let pattern = self.pats.pop().expect("case pat");
                    self.cases.push(MatchCase { pattern, guard, body, trivia });
                }
                CloneTask::Rec(r) => match r {
                    RecordEntry::Spread(e) => {
                        self.tasks.push(CloneTask::FinishRec(None));
                        self.tasks.push(CloneTask::Expr(e));
                    }
                    RecordEntry::Field { key, value } => {
                        self.tasks.push(CloneTask::FinishRec(Some(key.clone().unwrap_or_default())));
                        let _ = key;
                        self.tasks.push(CloneTask::Expr(value));
                    }
                },
                CloneTask::FinishRec(k) => {
                    let e = self.exprs.pop().expect("rec expr");
                    let entry = match k {
                        None => RecordEntry::Spread(e),
                        Some(s) => RecordEntry::Field {
                            key: if s.is_empty() { None } else { Some(s) },
                            value: e,
                        },
                    };
                    self.recs.push(entry);
                }
                CloneTask::Param(p) => {
                    self.tasks.push(CloneTask::FinishParam(p));
                    if let Some(ref d) = p.default {
                        self.tasks.push(CloneTask::Expr(d));
                    }
                    if let Some(ref t) = p.ty {
                        self.tasks.push(CloneTask::Ty(t));
                    }
                }
                CloneTask::FinishParam(p) => {
                    let default = if p.default.is_some() { Some(self.exprs.pop().expect("p def")) } else { None };
                    let ty = if p.ty.is_some() { Some(self.tys.pop().expect("p ty")) } else { None };
                    self.params.push(ParamDecl {
                        name: p.name.clone(),
                        vis: p.vis,
                        is_readonly: p.is_readonly,
                        is_mut: p.is_mut,
                        is_optional: p.is_optional,
                        is_rest: p.is_rest,
                        ty,
                        default,
                        trivia: p.trivia.clone(),
                    });
                }
                CloneTask::RecTy(f) => {
                    self.tasks.push(CloneTask::FinishRecTy { name: f.name.clone(), optional: f.optional });
                    self.tasks.push(CloneTask::Ty(&f.ty));
                }
                CloneTask::FinishRecTy { name, optional } => {
                    let ty = self.tys.pop().expect("rec ty");
                    self.rec_tys.push(RecordTypeField { name, optional, ty });
                }
            }
        }
    }

    pub(crate) fn push_body(&mut self, b: &'a FnBody) {
        match b {
            FnBody::SignatureOnly => self.bodies.push(FnBody::SignatureOnly),
            FnBody::Expr(e) => {
                self.tasks.push(CloneTask::FinishBody(None));
                self.tasks.push(CloneTask::Expr(e));
            }
            FnBody::Block(st) => {
                self.tasks.push(CloneTask::FinishBody(Some(st.len())));
                for s in st.iter().rev() {
                    self.tasks.push(CloneTask::Stmt(s));
                }
            }
        }
    }
}
