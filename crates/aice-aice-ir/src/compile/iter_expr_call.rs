use aice_lang_registry::LanguageId;

use crate::compile::expr_emit::ExprEmitCtx;
use crate::compile::iter_emit::{CTask, EvalState, body_kind_of};
use crate::ir_code::{Expr, FnBody, LiteralVal, RecordEntry};

pub(crate) fn push_eval_call<'a>(
    callee: &'a Expr,
    args: &'a [Expr],
    is_optional: bool,
    lang: LanguageId,
    ectx: &ExprEmitCtx,
    tasks: &mut Vec<CTask<'a>>,
) {
    if lang == LanguageId::Tsx && let Expr::Ident(nm) = callee && nm == "__jsx" && args.len() >= 2 {
        let tag = match &args[0] { Expr::Literal(LiteralVal::Str { value, .. }) => value.as_str(), _ => "div" };
        let mut attr_exprs = Vec::new();
        let entries = if let Expr::Record(ents) = &args[1] {
            for e in ents {
                match e {
                    RecordEntry::Spread(ex) => attr_exprs.push(ex),
                    RecordEntry::Field { key: Some(_), value } if !matches!(value, Expr::Literal(LiteralVal::Str { .. })) => attr_exprs.push(value),
                    _ => {}
                }
            }
            Some(ents.as_slice())
        } else { None };
        let children = &args[2..];
        let mut child_exprs = Vec::new();
        for ch in children { if !matches!(ch, Expr::Literal(LiteralVal::Str { .. })) { child_exprs.push(ch); } }
        tasks.push(CTask::MakeInlineJsx { tag, entries, n_attr_vals: attr_exprs.len(), children, n_child_vals: child_exprs.len() });
        for ce in child_exprs.into_iter().rev() { tasks.push(CTask::EvalExpr(ce)); }
        for ae in attr_exprs.into_iter().rev() { tasks.push(CTask::EvalExpr(ae)); }
        return;
    }
    if lang == LanguageId::Rust && args.len() == 1 && matches!(&args[0], Expr::Record(_)) {
        tasks.push(CTask::MakeRustStructCall);
        tasks.push(CTask::EvalExpr(&args[0]));
        tasks.push(CTask::EvalExpr(callee));
        return;
    }
    if lang == LanguageId::Ruby && let Some(Expr::Closure { params, body, .. }) = args.last() {
        let bk = body_kind_of(body);
        let n_prefix = args.len() - 1;
        tasks.push(CTask::MakeRubyBlock { params, body_kind: bk, n_prefix });
        match body.as_ref() {
            FnBody::Expr(ex) => tasks.push(CTask::EvalExpr(ex)),
            FnBody::Block(stmts) => {
                tasks.push(CTask::PopSubCtxToVal);
                tasks.push(CTask::RbStmts(stmts));
                tasks.push(CTask::PushSubCtx { tab: "  ", indent: 1 });
            }
            FnBody::SignatureOnly => {}
        }
        for a in args[..n_prefix].iter().rev() { tasks.push(CTask::EvalExpr(a)); }
        tasks.push(CTask::EvalExpr(callee));
        return;
    }
    if let Expr::Ident(nm) = callee && ectx.class_names.contains(nm)
        && matches!(lang, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript | LanguageId::CSharp | LanguageId::Java | LanguageId::Php)
    {
        tasks.push(CTask::MakeCall { callee_lit: None, class_new: Some(nm.clone()), n_args: args.len(), is_optional: false });
        for a in args.iter().rev() { tasks.push(CTask::EvalExpr(a)); }
        return;
    }
    let callee_lit = if lang == LanguageId::Php && let Expr::Ident(fn_name) = callee { Some(fn_name.clone()) } else { None };
    let need_eval = callee_lit.is_none();
    tasks.push(CTask::MakeCall { callee_lit, class_new: None, n_args: args.len(), is_optional });
    for a in args.iter().rev() { tasks.push(CTask::EvalExpr(a)); }
    if need_eval { tasks.push(CTask::EvalExpr(callee)); }
}

pub(crate) fn make_inline_jsx(
    tag: &str,
    entries: Option<&[RecordEntry]>,
    n_attr_vals: usize,
    children: &[Expr],
    n_child_vals: usize,
    st: &mut EvalState,
) {
    let cs = st.vals.len() - n_child_vals;
    let ch_vals: Vec<String> = st.vals.drain(cs..).collect();
    let as_ = st.vals.len() - n_attr_vals;
    let attr_vals: Vec<String> = st.vals.drain(as_..).collect();
    let mut attrs_s = String::new();
    if let Some(ents) = entries {
        let mut av = attr_vals.into_iter();
        for e in ents {
            match e {
                RecordEntry::Spread(_) => attrs_s.push_str(&format!(" {{...{}}}", av.next().unwrap_or_default())),
                RecordEntry::Field { key: Some(k), value } => {
                    if let Expr::Literal(LiteralVal::Str { value: s, .. }) = value { attrs_s.push_str(&format!(" {k}=\"{s}\"")); }
                    else { attrs_s.push_str(&format!(" {k}={{{}}}", av.next().unwrap_or_default())); }
                }
                RecordEntry::Field { key: None, value } => {
                    if let Expr::Literal(LiteralVal::Str { value: k, .. }) = value { attrs_s.push_str(&format!(" {k}")); }
                }
            }
        }
    }
    if children.is_empty() {
        st.vals.push(if tag.is_empty() { "<></>".into() } else { format!("<{tag}{attrs_s} />") });
        return;
    }
    let mut children_s = String::new();
    let mut cv = ch_vals.into_iter();
    for ch in children {
        match ch {
            Expr::Literal(LiteralVal::Str { value, .. }) => children_s.push_str(value),
            Expr::Call { callee, args: sub, .. } if matches!(callee.as_ref(), Expr::Ident(n) if n == "__jsx") && sub.len() >= 2 => {
                children_s.push_str(&cv.next().unwrap_or_default());
            }
            _ => children_s.push_str(&format!("{{{}}}", cv.next().unwrap_or_default())),
        }
    }
    st.vals.push(if tag.is_empty() { format!("<>{children_s}</>") } else { format!("<{tag}{attrs_s}>{children_s}</{tag}>") });
}
