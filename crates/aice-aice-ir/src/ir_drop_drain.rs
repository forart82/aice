use crate::ir::AiceItem;
use crate::ir_code::{CatchClause, FnBody, Stmt};
use crate::ir_domain::{DataNode, LayoutAttr, LayoutNode};
use crate::ir_expr::{Expr, MatchCase, Pattern, RecordEntry};
use crate::ir_types::{AiceType, ParamDecl, PrimitiveType, RecordTypeField};

pub(crate) enum DropWork {
    Stmt(Stmt),
    Expr(Expr),
    Pat(Pattern),
    Ty(AiceType),
    FnBody(FnBody),
    Catch(CatchClause),
    MatchCase(MatchCase),
    Rec(RecordEntry),
    Param(ParamDecl),
    RecTy(RecordTypeField),
    Layout(LayoutNode),
    LayoutAttr(LayoutAttr),
    Data(DataNode),
    Item(AiceItem),
}

pub(crate) const fn is_leaf_stmt(s: &Stmt) -> bool {
    matches!(s, Stmt::Pass | Stmt::Comment(_) | Stmt::Break { .. } | Stmt::Continue { .. })
}

pub(crate) const fn is_leaf_expr(e: &Expr) -> bool {
    matches!(e, Expr::Literal(_) | Expr::Ident(_))
}

pub(crate) const fn is_leaf_pat(p: &Pattern) -> bool {
    matches!(p, Pattern::Wildcard | Pattern::Literal(_) | Pattern::Ident(_))
}

pub(crate) const fn is_leaf_ty(t: &AiceType) -> bool {
    matches!(t, AiceType::Primitive(_) | AiceType::Raw(_))
}

pub(crate) fn push_expr(e: &mut Expr, work: &mut Vec<DropWork>) {
    if !is_leaf_expr(e) {
        work.push(DropWork::Expr(std::mem::replace(e, Expr::Ident(String::new()))));
    }
}

pub(crate) fn push_pat(p: &mut Pattern, work: &mut Vec<DropWork>) {
    if !is_leaf_pat(p) {
        work.push(DropWork::Pat(std::mem::replace(p, Pattern::Wildcard)));
    }
}

pub(crate) fn push_ty(t: &mut AiceType, work: &mut Vec<DropWork>) {
    if !is_leaf_ty(t) {
        work.push(DropWork::Ty(std::mem::replace(t, AiceType::Primitive(PrimitiveType::Void))));
    }
}

pub(crate) fn push_opt_expr(opt: &mut Option<Expr>, work: &mut Vec<DropWork>) {
    if let Some(e) = opt.take()
        && !is_leaf_expr(&e)
    {
        work.push(DropWork::Expr(e));
    }
}

pub(crate) fn push_opt_ty(opt: &mut Option<AiceType>, work: &mut Vec<DropWork>) {
    if let Some(t) = opt.take()
        && !is_leaf_ty(&t)
    {
        work.push(DropWork::Ty(t));
    }
}

pub(crate) fn drain_stmt(s: &mut Stmt, work: &mut Vec<DropWork>) {
    match s {
        Stmt::Let { ty, init, .. } | Stmt::Destructure { ty, init, .. } => {
            push_opt_ty(ty, work);
            push_expr(init, work);
        }
        Stmt::Assign { target, value, .. } => {
            push_expr(target, work);
            push_expr(value, work);
        }
        Stmt::Return { value, .. } => push_opt_expr(value, work),
        Stmt::Expr { expr, .. } | Stmt::Throw { expr, .. } => push_expr(expr, work),
        Stmt::If { cond, then_body, elifs, else_body, .. } => {
            push_expr(cond, work);
            work.extend(std::mem::take(then_body).into_iter().map(DropWork::Stmt));
            for (ec, eb) in std::mem::take(elifs) {
                work.push(DropWork::Expr(ec));
                work.extend(eb.into_iter().map(DropWork::Stmt));
            }
            if let Some(eb) = else_body.take() {
                work.extend(eb.into_iter().map(DropWork::Stmt));
            }
        }
        Stmt::Match { target, cases, .. } => {
            push_expr(target, work);
            work.extend(std::mem::take(cases).into_iter().map(DropWork::MatchCase));
        }
        Stmt::For { iter, body, .. } => {
            push_expr(iter, work);
            work.extend(std::mem::take(body).into_iter().map(DropWork::Stmt));
        }
        Stmt::While { cond, body, .. } => {
            push_expr(cond, work);
            work.extend(std::mem::take(body).into_iter().map(DropWork::Stmt));
        }
        Stmt::Loop { body, .. } => work.extend(std::mem::take(body).into_iter().map(DropWork::Stmt)),
        Stmt::Try { try_body, catches, finally_body, .. } => {
            work.extend(std::mem::take(try_body).into_iter().map(DropWork::Stmt));
            work.extend(std::mem::take(catches).into_iter().map(DropWork::Catch));
            if let Some(fb) = finally_body.take() {
                work.extend(fb.into_iter().map(DropWork::Stmt));
            }
        }
        Stmt::Break { .. } | Stmt::Continue { .. } | Stmt::Pass | Stmt::Comment(_) => {}
    }
}

pub(crate) fn drain_expr(e: &mut Expr, work: &mut Vec<DropWork>) {
    match e {
        Expr::Literal(_) | Expr::Ident(_) => {}
        Expr::Template { exprs, .. } | Expr::Array(exprs) => {
            work.extend(std::mem::take(exprs).into_iter().map(DropWork::Expr));
        }
        Expr::Binary { left, right, .. } => {
            push_expr(left, work);
            push_expr(right, work);
        }
        Expr::Unary { operand, .. } | Expr::PostfixTry(operand) | Expr::Await(operand) => {
            push_expr(operand, work);
        }
        Expr::Conditional { cond, then_expr, else_expr } => {
            push_expr(cond, work);
            push_expr(then_expr, work);
            push_expr(else_expr, work);
        }
        Expr::Call { callee, args, .. } => {
            push_expr(callee, work);
            work.extend(std::mem::take(args).into_iter().map(DropWork::Expr));
        }
        Expr::Member { object, .. } => push_expr(object, work),
        Expr::Index { object, index } => {
            push_expr(object, work);
            push_expr(index, work);
        }
        Expr::Record(entries) => work.extend(std::mem::take(entries).into_iter().map(DropWork::Rec)),
        Expr::Closure { params, ret, body, .. } => {
            work.extend(std::mem::take(params).into_iter().map(DropWork::Param));
            push_opt_ty(ret, work);
            work.push(DropWork::FnBody(std::mem::replace(&mut **body, FnBody::SignatureOnly)));
        }
        Expr::Assign { target, value, .. } => {
            push_expr(target, work);
            push_expr(value, work);
        }
        Expr::Match { target, cases } => {
            push_expr(target, work);
            work.extend(std::mem::take(cases).into_iter().map(DropWork::MatchCase));
        }
    }
}

pub(crate) fn drain_ty(t: &mut AiceType, work: &mut Vec<DropWork>) {
    match t {
        AiceType::Primitive(_) | AiceType::Raw(_) => {}
        AiceType::Array(inner) | AiceType::Option(inner) => push_ty(inner, work),
        AiceType::Tuple(ts) | AiceType::Union(ts) | AiceType::Intersection(ts) | AiceType::Named { args: ts, .. } => {
            work.extend(std::mem::take(ts).into_iter().map(DropWork::Ty));
        }
        AiceType::Record(fs) => work.extend(std::mem::take(fs).into_iter().map(DropWork::RecTy)),
        AiceType::Result { ok, err } => {
            push_ty(ok, work);
            push_ty(err, work);
        }
        AiceType::Refinement { predicate, .. } => push_expr(predicate, work),
        AiceType::Fn { params, ret } => {
            work.extend(std::mem::take(params).into_iter().map(DropWork::Ty));
            push_ty(ret, work);
        }
    }
}

pub(crate) fn drain_layout(l: &mut LayoutNode, work: &mut Vec<DropWork>) {
    match l {
        LayoutNode::Element { attrs, child_expr, children, .. } => {
            work.extend(std::mem::take(attrs).into_iter().map(DropWork::LayoutAttr));
            push_opt_expr(child_expr, work);
            work.extend(std::mem::take(children).into_iter().map(DropWork::Layout));
        }
        LayoutNode::TemplateCtrl { children, branches, .. } => {
            work.extend(std::mem::take(children).into_iter().map(DropWork::Layout));
            for (_, br) in std::mem::take(branches) {
                work.extend(br.into_iter().map(DropWork::Layout));
            }
        }
        LayoutNode::Comment(_) => {}
    }
}

pub(crate) fn drain_data(d: &mut DataNode, work: &mut Vec<DropWork>) {
    match d {
        DataNode::Seq { items, .. } => work.extend(std::mem::take(items).into_iter().map(DropWork::Data)),
        DataNode::Map { entries, .. } | DataNode::TableSection { entries, .. } => {
            work.extend(std::mem::take(entries).into_iter().map(DropWork::Data));
        }
        DataNode::XmlElem { children, .. } => {
            work.extend(std::mem::take(children).into_iter().map(DropWork::Data));
        }
        DataNode::Scalar { .. } | DataNode::DtdDecl { .. } => {}
    }
}
