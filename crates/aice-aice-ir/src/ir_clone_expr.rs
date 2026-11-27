use crate::ir_clone::{CloneEnv, CloneTask, ExprFinish, PatFinish, TyFinish};
use crate::ir_code::Stmt;
use crate::ir_expr::{Expr, Pattern};
use crate::ir_types::AiceType;

impl<'a> CloneEnv<'a> {
    pub(crate) fn push_expr(&mut self, e: &'a Expr) {
        match e {
            Expr::Literal(l) => self.exprs.push(Expr::Literal(l.clone())),
            Expr::Ident(s) => self.exprs.push(Expr::Ident(s.clone())),
            Expr::Raw(s) => self.exprs.push(Expr::Raw(s.clone())),
            Expr::Template { quasis, exprs } => {
                self.tasks.push(CloneTask::FinishExpr(ExprFinish::Template(quasis.clone())));
                for ex in exprs.iter().rev() { self.tasks.push(CloneTask::Expr(ex)); }
            }
            Expr::Binary { op, left, right } => {
                self.tasks.push(CloneTask::FinishExpr(ExprFinish::Binary(*op)));
                self.tasks.push(CloneTask::Expr(right));
                self.tasks.push(CloneTask::Expr(left));
            }
            Expr::Unary { op, is_postfix, operand } => {
                self.tasks.push(CloneTask::FinishExpr(ExprFinish::Unary { op: *op, is_postfix: *is_postfix }));
                self.tasks.push(CloneTask::Expr(operand));
            }
            Expr::Conditional { cond, then_expr, else_expr } => {
                self.tasks.push(CloneTask::FinishExpr(ExprFinish::Conditional));
                self.tasks.push(CloneTask::Expr(else_expr));
                self.tasks.push(CloneTask::Expr(then_expr));
                self.tasks.push(CloneTask::Expr(cond));
            }
            Expr::PostfixTry(op) => {
                self.tasks.push(CloneTask::FinishExpr(ExprFinish::PostfixTry));
                self.tasks.push(CloneTask::Expr(op));
            }
            Expr::Call { callee, args, is_optional, is_tagged, is_new } => {
                self.tasks.push(CloneTask::FinishExpr(ExprFinish::Call {
                    argc: args.len(), is_optional: *is_optional, is_tagged: *is_tagged, is_new: *is_new,
                }));
                for a in args.iter().rev() { self.tasks.push(CloneTask::Expr(a)); }
                self.tasks.push(CloneTask::Expr(callee));
            }
            Expr::Member { object, property, kind } => {
                self.tasks.push(CloneTask::FinishExpr(ExprFinish::Member { property: property.clone(), kind: *kind }));
                self.tasks.push(CloneTask::Expr(object));
            }
            Expr::Index { object, index, is_optional } => {
                self.tasks.push(CloneTask::FinishExpr(ExprFinish::Index { is_optional: *is_optional }));
                self.tasks.push(CloneTask::Expr(index));
                self.tasks.push(CloneTask::Expr(object));
            }
            Expr::Array(xs) => {
                self.tasks.push(CloneTask::FinishExpr(ExprFinish::Array(xs.len())));
                for x in xs.iter().rev() { self.tasks.push(CloneTask::Expr(x)); }
            }
            Expr::Record(rs) => {
                self.tasks.push(CloneTask::FinishExpr(ExprFinish::Record(rs.len())));
                for r in rs.iter().rev() { self.tasks.push(CloneTask::Rec(r)); }
            }
            Expr::Closure { is_async, params, ret, body } => {
                self.tasks.push(CloneTask::FinishExpr(ExprFinish::Closure {
                    is_async: *is_async, param_len: params.len(), has_ret: ret.is_some(),
                }));
                self.tasks.push(CloneTask::Body(body));
                if let Some(r) = ret { self.tasks.push(CloneTask::Ty(r)); }
                for p in params.iter().rev() { self.tasks.push(CloneTask::Param(p)); }
            }
            Expr::Assign { target, op, value } => {
                self.tasks.push(CloneTask::FinishExpr(ExprFinish::Assign(*op)));
                self.tasks.push(CloneTask::Expr(value));
                self.tasks.push(CloneTask::Expr(target));
            }
            Expr::Await(x) => {
                self.tasks.push(CloneTask::FinishExpr(ExprFinish::Await));
                self.tasks.push(CloneTask::Expr(x));
            }
            Expr::Match { target, cases } => {
                self.tasks.push(CloneTask::FinishExpr(ExprFinish::Match(cases.len())));
                for mc in cases.iter().rev() { self.tasks.push(CloneTask::Case(mc)); }
                self.tasks.push(CloneTask::Expr(target));
            }
            Expr::Comprehension { kind, body, value, clauses } => {
                self.tasks.push(CloneTask::FinishExpr(ExprFinish::Comp { kind: *kind, has_val: value.is_some(), n_clauses: clauses.len() }));
                for cl in clauses.iter().rev() { self.tasks.push(CloneTask::CompCl(cl)); }
                if let Some(v) = value { self.tasks.push(CloneTask::Expr(v)); }
                self.tasks.push(CloneTask::Expr(body));
            }
        }
    }

    pub(crate) fn finish_expr(&mut self, f: ExprFinish) {
        let e = match f {
            ExprFinish::Template(quasis) => {
                let n = quasis.len().saturating_sub(1);
                Expr::Template { quasis, exprs: self.exprs.split_off(self.exprs.len() - n) }
            }
            ExprFinish::Binary(op) => {
                let right = Box::new(self.exprs.pop().expect("bin r"));
                let left = Box::new(self.exprs.pop().expect("bin l"));
                Expr::Binary { op, left, right }
            }
            ExprFinish::Unary { op, is_postfix } => {
                Expr::Unary { op, is_postfix, operand: Box::new(self.exprs.pop().expect("un")) }
            }
            ExprFinish::Conditional => {
                let else_expr = Box::new(self.exprs.pop().expect("c else"));
                let then_expr = Box::new(self.exprs.pop().expect("c then"));
                let cond = Box::new(self.exprs.pop().expect("c cond"));
                Expr::Conditional { cond, then_expr, else_expr }
            }
            ExprFinish::PostfixTry => Expr::PostfixTry(Box::new(self.exprs.pop().expect("try"))),
            ExprFinish::Call { argc, is_optional, is_tagged, is_new } => {
                let args = self.exprs.split_off(self.exprs.len() - argc);
                let callee = Box::new(self.exprs.pop().expect("callee"));
                Expr::Call { callee, args, is_optional, is_tagged, is_new }
            }
            ExprFinish::Member { property, kind } => {
                Expr::Member { object: Box::new(self.exprs.pop().expect("mem")), property, kind }
            }
            ExprFinish::Index { is_optional } => {
                let index = Box::new(self.exprs.pop().expect("idx"));
                let object = Box::new(self.exprs.pop().expect("obj"));
                Expr::Index { object, index, is_optional }
            }
            ExprFinish::Array(n) => Expr::Array(self.exprs.split_off(self.exprs.len() - n)),
            ExprFinish::Record(n) => Expr::Record(self.recs.split_off(self.recs.len() - n)),
            ExprFinish::Closure { is_async, param_len, has_ret } => {
                let body = Box::new(self.bodies.pop().expect("cl body"));
                let ret = if has_ret { Some(self.tys.pop().expect("cl ret")) } else { None };
                let params = self.params.split_off(self.params.len() - param_len);
                Expr::Closure { is_async, params, ret, body }
            }
            ExprFinish::Assign(op) => {
                let value = Box::new(self.exprs.pop().expect("as val"));
                let target = Box::new(self.exprs.pop().expect("as tgt"));
                Expr::Assign { target, op, value }
            }
            ExprFinish::Await => Expr::Await(Box::new(self.exprs.pop().expect("await"))),
            ExprFinish::Match(n) => {
                let cases = self.cases.split_off(self.cases.len() - n);
                let target = Box::new(self.exprs.pop().expect("m tgt"));
                Expr::Match { target, cases }
            }
            ExprFinish::Comp { kind, has_val, n_clauses } => {
                let clauses = self.comp_clauses.split_off(self.comp_clauses.len() - n_clauses);
                let value = has_val.then(|| Box::new(self.exprs.pop().expect("c val")));
                Expr::Comprehension { kind, body: Box::new(self.exprs.pop().expect("c body")), value, clauses }
            }
        };
        self.exprs.push(e);
    }

    pub(crate) fn push_pat(&mut self, p: &'a Pattern) {
        match p {
            Pattern::Wildcard => self.pats.push(Pattern::Wildcard),
            Pattern::Literal(l) => self.pats.push(Pattern::Literal(l.clone())),
            Pattern::Ident(s) => self.pats.push(Pattern::Ident(s.clone())),
            Pattern::Constructor { name, args } => {
                self.tasks.push(CloneTask::FinishPat(PatFinish::Ctor { name: name.clone(), len: args.len() }));
                for a in args.iter().rev() { self.tasks.push(CloneTask::Pat(a)); }
            }
            Pattern::Or(ps) => {
                self.tasks.push(CloneTask::FinishPat(PatFinish::Or(ps.len())));
                for a in ps.iter().rev() { self.tasks.push(CloneTask::Pat(a)); }
            }
            Pattern::Range { start, end, inclusive, negated } => {
                self.tasks.push(CloneTask::FinishPat(PatFinish::Range { inclusive: *inclusive, negated: *negated }));
                self.tasks.push(CloneTask::Expr(end));
                self.tasks.push(CloneTask::Expr(start));
            }
            Pattern::TypeCheck { ty, negated } => {
                self.tasks.push(CloneTask::FinishPat(PatFinish::TypeCheck(*negated)));
                self.tasks.push(CloneTask::Ty(ty));
            }
        }
    }

    pub(crate) fn finish_pat(&mut self, f: PatFinish) {
        let p = match f {
            PatFinish::Ctor { name, len } => Pattern::Constructor { name, args: self.pats.split_off(self.pats.len() - len) },
            PatFinish::Or(len) => Pattern::Or(self.pats.split_off(self.pats.len() - len)),
            PatFinish::Range { inclusive, negated } => {
                let end = Box::new(self.exprs.pop().expect("r end"));
                let start = Box::new(self.exprs.pop().expect("r start"));
                Pattern::Range { start, end, inclusive, negated }
            }
            PatFinish::TypeCheck(negated) => Pattern::TypeCheck { ty: self.tys.pop().expect("pt ty"), negated },
        };
        self.pats.push(p);
    }

    pub(crate) fn push_ty(&mut self, t: &'a AiceType) {
        match t {
            AiceType::Primitive(p) => self.tys.push(AiceType::Primitive(*p)),
            AiceType::Raw(s) => self.tys.push(AiceType::Raw(s.clone())),
            AiceType::Array(inner) => {
                self.tasks.push(CloneTask::FinishTy(TyFinish::Array));
                self.tasks.push(CloneTask::Ty(inner));
            }
            AiceType::Option(inner) => {
                self.tasks.push(CloneTask::FinishTy(TyFinish::Option));
                self.tasks.push(CloneTask::Ty(inner));
            }
            AiceType::Tuple(ts) => {
                self.tasks.push(CloneTask::FinishTy(TyFinish::Tuple(ts.len())));
                for x in ts.iter().rev() { self.tasks.push(CloneTask::Ty(x)); }
            }
            AiceType::Union(ts) => {
                self.tasks.push(CloneTask::FinishTy(TyFinish::Union(ts.len())));
                for x in ts.iter().rev() { self.tasks.push(CloneTask::Ty(x)); }
            }
            AiceType::Intersection(ts) => {
                self.tasks.push(CloneTask::FinishTy(TyFinish::Intersection(ts.len())));
                for x in ts.iter().rev() { self.tasks.push(CloneTask::Ty(x)); }
            }
            AiceType::Named { path, args } => {
                self.tasks.push(CloneTask::FinishTy(TyFinish::Named { path: path.clone(), len: args.len() }));
                for x in args.iter().rev() { self.tasks.push(CloneTask::Ty(x)); }
            }
            AiceType::Result { ok, err } => {
                self.tasks.push(CloneTask::FinishTy(TyFinish::Result));
                self.tasks.push(CloneTask::Ty(err));
                self.tasks.push(CloneTask::Ty(ok));
            }
            AiceType::Record(fs) => {
                self.tasks.push(CloneTask::FinishTy(TyFinish::Record(fs.len())));
                for f in fs.iter().rev() { self.tasks.push(CloneTask::RecTy(f)); }
            }
            AiceType::Refinement { param, base, predicate } => {
                self.tasks.push(CloneTask::FinishTy(TyFinish::Refinement { param: param.clone(), base: *base }));
                self.tasks.push(CloneTask::Expr(predicate));
            }
            AiceType::Fn { params, ret } => {
                self.tasks.push(CloneTask::FinishTy(TyFinish::Fn(params.len())));
                self.tasks.push(CloneTask::Ty(ret));
                for p in params.iter().rev() { self.tasks.push(CloneTask::Ty(p)); }
            }
        }
    }

    pub(crate) fn finish_ty(&mut self, f: TyFinish) {
        let t = match f {
            TyFinish::Array => AiceType::Array(Box::new(self.tys.pop().expect("arr"))),
            TyFinish::Option => AiceType::Option(Box::new(self.tys.pop().expect("opt"))),
            TyFinish::Tuple(n) => AiceType::Tuple(self.tys.split_off(self.tys.len() - n)),
            TyFinish::Union(n) => AiceType::Union(self.tys.split_off(self.tys.len() - n)),
            TyFinish::Intersection(n) => AiceType::Intersection(self.tys.split_off(self.tys.len() - n)),
            TyFinish::Named { path, len } => AiceType::Named { path, args: self.tys.split_off(self.tys.len() - len) },
            TyFinish::Result => {
                let err = Box::new(self.tys.pop().expect("res err"));
                let ok = Box::new(self.tys.pop().expect("res ok"));
                AiceType::Result { ok, err }
            }
            TyFinish::Record(n) => AiceType::Record(self.rec_tys.split_off(self.rec_tys.len() - n)),
            TyFinish::Refinement { param, base } => {
                AiceType::Refinement { param, base, predicate: Box::new(self.exprs.pop().expect("ref pred")) }
            }
            TyFinish::Fn(n) => {
                let ret = Box::new(self.tys.pop().expect("fn ret"));
                let params = self.tys.split_off(self.tys.len() - n);
                AiceType::Fn { params, ret }
            }
        };
        self.tys.push(t);
    }
}

impl Clone for Stmt {
    fn clone(&self) -> Self { let mut e = CloneEnv::default(); e.tasks.push(CloneTask::Stmt(self)); e.run(); e.stmts.pop().expect("stmt") }
}
impl Clone for Expr {
    fn clone(&self) -> Self { let mut e = CloneEnv::default(); e.tasks.push(CloneTask::Expr(self)); e.run(); e.exprs.pop().expect("expr") }
}
impl Clone for Pattern {
    fn clone(&self) -> Self { let mut e = CloneEnv::default(); e.tasks.push(CloneTask::Pat(self)); e.run(); e.pats.pop().expect("pat") }
}
impl Clone for AiceType {
    fn clone(&self) -> Self { let mut e = CloneEnv::default(); e.tasks.push(CloneTask::Ty(self)); e.run(); e.tys.pop().expect("ty") }
}
