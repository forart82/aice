use crate::ir::AiceItem;
use crate::ir_code::{FnBody, Stmt};
use crate::ir_domain::{DataNode, DocSection, LayoutNode, StyleDecl};
use crate::ir_domain_db::{DbMigrationDecl, GraphQlField};
use crate::ir_drop_drain::{
    DropWork, drain_data, drain_expr, drain_layout, drain_stmt, drain_ty, is_leaf_expr,
    is_leaf_pat, is_leaf_stmt, is_leaf_ty, push_expr, push_opt_expr, push_opt_ty, push_pat,
    push_ty,
};
use crate::ir_expr::{Expr, Pattern, RecordEntry};
use crate::ir_types::AiceType;

fn drain_all(mut work: Vec<DropWork>) {
    while let Some(w) = work.pop() {
        match w {
            DropWork::Stmt(mut s) => drain_stmt(&mut s, &mut work),
            DropWork::Expr(mut e) => drain_expr(&mut e, &mut work),
            DropWork::Pat(mut p) => match &mut p {
                Pattern::Constructor { args, .. } | Pattern::Or(args) => {
                    work.extend(std::mem::take(args).into_iter().map(DropWork::Pat));
                }
                Pattern::Range { start, end, .. } => {
                    push_expr(start, &mut work);
                    push_expr(end, &mut work);
                }
                Pattern::TypeCheck { ty, .. } => push_ty(ty, &mut work),
                Pattern::Wildcard | Pattern::Literal(_) | Pattern::Ident(_) => {}
            },
            DropWork::Ty(mut t) => drain_ty(&mut t, &mut work),
            DropWork::FnBody(mut b) => match &mut b {
                FnBody::Block(st) => work.extend(std::mem::take(st).into_iter().map(DropWork::Stmt)),
                FnBody::Expr(e) => push_expr(e, &mut work),
                FnBody::SignatureOnly => {}
            },
            DropWork::Catch(mut c) => {
                push_opt_ty(&mut c.ty, &mut work);
                work.extend(std::mem::take(&mut c.body).into_iter().map(DropWork::Stmt));
            }
            DropWork::MatchCase(mut mc) => {
                push_pat(&mut mc.pattern, &mut work);
                push_opt_expr(&mut mc.guard, &mut work);
                work.push(DropWork::FnBody(std::mem::replace(&mut mc.body, FnBody::SignatureOnly)));
            }
            DropWork::Rec(r) => match r {
                RecordEntry::Spread(e) | RecordEntry::Field { value: e, .. } => work.push(DropWork::Expr(e)),
            },
            DropWork::Param(mut p) => {
                push_opt_ty(&mut p.ty, &mut work);
                push_opt_expr(&mut p.default, &mut work);
            }
            DropWork::RecTy(mut f) => push_ty(&mut f.ty, &mut work),
            DropWork::Layout(mut l) => drain_layout(&mut l, &mut work),
            DropWork::LayoutAttr(mut a) => push_opt_expr(&mut a.value, &mut work),
            DropWork::Data(mut d) => drain_data(&mut d, &mut work),
            DropWork::Item(mut it) => {
                if let AiceItem::DbMigration(ref mut dm) = it {
                    for (_, items) in std::mem::take(&mut dm.sections) {
                        work.extend(items.into_iter().map(DropWork::Item));
                    }
                }
            }
        }
    }
}

macro_rules! impl_iter_drop {
    ($ty:ty, $leaf:expr, $drain:ident) => {
        impl Drop for $ty {
            fn drop(&mut self) {
                if $leaf(self) {
                    return;
                }
                let mut work = Vec::new();
                $drain(self, &mut work);
                if !work.is_empty() {
                    drain_all(work);
                }
            }
        }
    };
}

impl_iter_drop!(Stmt, is_leaf_stmt, drain_stmt);
impl_iter_drop!(Expr, is_leaf_expr, drain_expr);
impl_iter_drop!(AiceType, is_leaf_ty, drain_ty);

impl Drop for Pattern {
    fn drop(&mut self) {
        if is_leaf_pat(self) {
            return;
        }
        let mut work = Vec::new();
        match self {
            Pattern::Constructor { args, .. } | Pattern::Or(args) => {
                work.extend(std::mem::take(args).into_iter().map(DropWork::Pat));
            }
            Pattern::Range { start, end, .. } => {
                push_expr(start, &mut work);
                push_expr(end, &mut work);
            }
            Pattern::TypeCheck { ty, .. } => push_ty(ty, &mut work),
            Pattern::Wildcard | Pattern::Literal(_) | Pattern::Ident(_) => {}
        }
        if !work.is_empty() {
            drain_all(work);
        }
    }
}

impl Drop for LayoutNode {
    fn drop(&mut self) {
        if matches!(self, LayoutNode::Comment(_)) {
            return;
        }
        let mut work = Vec::new();
        drain_layout(self, &mut work);
        if !work.is_empty() {
            drain_all(work);
        }
    }
}

impl Drop for DataNode {
    fn drop(&mut self) {
        if matches!(self, DataNode::Scalar { .. } | DataNode::DtdDecl { .. }) {
            return;
        }
        let mut work = Vec::new();
        drain_data(self, &mut work);
        if !work.is_empty() {
            drain_all(work);
        }
    }
}

impl Drop for StyleDecl {
    fn drop(&mut self) {
        while let Some(mut child) = self.children.pop() {
            self.children.append(&mut child.children);
        }
    }
}

impl Drop for DocSection {
    fn drop(&mut self) {
        while let Some(mut child) = self.children.pop() {
            self.children.append(&mut child.children);
        }
    }
}

impl Drop for GraphQlField {
    fn drop(&mut self) {
        while let Some(mut child) = self.children.pop() {
            self.children.append(&mut child.children);
        }
    }
}

impl Drop for DbMigrationDecl {
    fn drop(&mut self) {
        let mut work = Vec::new();
        for (_, items) in std::mem::take(&mut self.sections) {
            work.extend(items.into_iter().map(DropWork::Item));
        }
        if !work.is_empty() {
            drain_all(work);
        }
    }
}
