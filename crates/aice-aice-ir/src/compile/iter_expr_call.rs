use aice_lang_registry::LanguageId;

use crate::compile::expr_emit::ExprEmitCtx;
use crate::compile::iter_emit::{CTask, EvalState, body_kind_of};
use crate::ir_code::{Expr, FnBody, LiteralVal, RecordEntry};

pub(crate) fn push_eval_call<'a>(
    callee: &'a Expr,
    args: &'a [Expr],
    flags: (bool, bool, bool),
    lang: LanguageId,
    ectx: &ExprEmitCtx,
    tasks: &mut Vec<CTask<'a>>,
) {
    let (is_optional, is_tagged, is_new) = flags;
    if is_new && is_tagged {
        if let Some(init_rec @ Expr::Record(_)) = args.last() {
            let ctor_args = &args[..args.len() - 1];
            let tag = if is_optional || !ctor_args.is_empty() { "\0new_obj_parens" } else { "\0new_obj" };
            tasks.push(CTask::MakeCall {
                callee_lit: Some(tag.into()), class_new: None, n_args: args.len(), is_optional: false, is_new: true,
            });
            tasks.push(CTask::EvalExpr(init_rec));
            for a in ctor_args.iter().rev() { tasks.push(CTask::EvalExpr(a)); }
            tasks.push(CTask::EvalExpr(callee));
            return;
        }
        let init_elems = match args.first() {
            Some(Expr::Array(xs)) => Some(xs.as_slice()),
            _ => None,
        };
        let tag = if init_elems.is_some() { "\0new_arr_init" } else { "\0new_arr" };
        let n_args = init_elems.map_or(0, <[Expr]>::len);
        tasks.push(CTask::MakeCall {
            callee_lit: Some(tag.into()), class_new: None, n_args, is_optional: false, is_new: true,
        });
        if let Some(xs) = init_elems {
            for x in xs.iter().rev() { tasks.push(CTask::EvalExpr(x)); }
        }
        tasks.push(CTask::EvalExpr(callee));
        return;
    }
    if is_tagged && args.len() == 1 {
        tasks.push(CTask::MakeCall {
            callee_lit: Some("\0tagged".into()), class_new: None, n_args: 1, is_optional: false, is_new: false,
        });
        tasks.push(CTask::EvalExpr(&args[0]));
        tasks.push(CTask::EvalExpr(callee));
        return;
    }
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
    if let Expr::Ident(nm) = callee && (is_new || ectx.class_names.contains(nm))
        && matches!(lang, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript | LanguageId::CSharp | LanguageId::Java | LanguageId::Php)
    {
        tasks.push(CTask::MakeCall { callee_lit: None, class_new: Some(nm.clone()), n_args: args.len(), is_optional: false, is_new: false });
        for a in args.iter().rev() { tasks.push(CTask::EvalExpr(a)); }
        return;
    }
    let callee_lit = if lang == LanguageId::Php && let Expr::Ident(fn_name) = callee { Some(fn_name.clone()) } else { None };
    let need_eval = callee_lit.is_none();
    tasks.push(CTask::MakeCall { callee_lit, class_new: None, n_args: args.len(), is_optional, is_new });
    if !is_optional && !is_new && !matches!(callee, Expr::Ident(s) if s.is_empty()) && args.len() == 1
        && let Expr::Comprehension { kind: crate::ir_code::CompKind::Generator, body, value, clauses } = &args[0]
    {
        crate::compile::expr_emit::push_eval_comp(
            crate::ir_code::CompKind::Generator, body, value.as_deref(), clauses, true, tasks,
        );
    } else {
        for a in args.iter().rev() { tasks.push(CTask::EvalExpr(a)); }
    }
    if need_eval { tasks.push(CTask::EvalExpr(callee)); }
}

pub(crate) fn push_eval_index<'a>(
    object: &'a Expr,
    index: &'a Expr,
    is_optional: bool,
    tasks: &mut Vec<CTask<'a>>,
) {
    tasks.push(CTask::MakeIndex { is_optional });
    if let Expr::Call { callee, args, .. } = index
        && matches!(callee.as_ref(), Expr::Ident(s) if s == "\0idx")
    {
        tasks.push(CTask::MakeCall {
            callee_lit: Some("\0join_comma".into()), class_new: None,
            n_args: args.len(), is_optional: false, is_new: false,
        });
        for a in args.iter().rev() { tasks.push(CTask::EvalExpr(a)); }
    } else {
        tasks.push(CTask::EvalExpr(index));
    }
    if matches!(object, Expr::Binary { .. } | Expr::Conditional { .. } | Expr::Assign { .. }) {
        tasks.push(CTask::WrapParen);
    }
    tasks.push(CTask::EvalExpr(object));
}

pub(crate) fn finish_make_call(
    callee_lit: Option<String>,
    class_new: Option<String>,
    n_args: usize,
    is_optional: bool,
    is_new: bool,
    lang: LanguageId,
    st: &mut EvalState,
) {
    if matches!(callee_lit.as_deref(), Some("\0new_obj" | "\0new_obj_parens")) {
        let start = st.vals.len() - n_args;
        let mut ps: Vec<String> = st.vals.drain(start..).collect();
        let init_s = ps.pop().unwrap_or_else(|| "{}".into());
        let cs = st.vals.pop().unwrap();
        let has_parens = callee_lit.as_deref() == Some("\0new_obj_parens");
        let out = if cs.is_empty() {
            if has_parens { format!("new({}) {init_s}", ps.join(", ")) } else { format!("new {init_s}") }
        } else if has_parens {
            format!("new {cs}({}) {init_s}", ps.join(", "))
        } else {
            format!("new {cs} {init_s}")
        };
        st.vals.push(out);
        return;
    }
    if matches!(callee_lit.as_deref(), Some("\0new_arr" | "\0new_arr_init")) {
        let start = st.vals.len() - n_args;
        let ps: Vec<String> = st.vals.drain(start..).collect();
        let cs = st.vals.pop().unwrap();
        let pfx = if cs.starts_with('[') { "new" } else { "new " };
        if callee_lit.as_deref() == Some("\0new_arr_init") {
            let body = if ps.is_empty() { "{}".into() } else { format!("{{ {} }}", ps.join(", ")) };
            st.vals.push(format!("{pfx}{cs} {body}"));
        } else {
            st.vals.push(format!("{pfx}{cs}"));
        }
        return;
    }
    if callee_lit.as_deref() == Some("\0tagged") && n_args == 1 {
        let tpl = st.vals.pop().unwrap();
        let cs = st.vals.pop().unwrap();
        if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript) {
            st.vals.push(format!("{cs}{tpl}"));
        } else {
            st.vals.push(format!("{cs}({tpl})"));
        }
        return;
    }
    let start = st.vals.len() - n_args;
    let ps: Vec<String> = st.vals.drain(start..).collect();
    if callee_lit.as_deref() == Some("\0join_comma") {
        st.vals.push(ps.join(", "));
        return;
    }
    if let Some(nm) = class_new { st.vals.push(format!("new {nm}({})", ps.join(", "))); return; }
    let cs = match callee_lit { Some(s) => s, None => st.vals.pop().unwrap() };
    if cs.is_empty() && !is_optional && !is_new && ps.len() == 2 && ps[1].is_empty() {
        st.vals.push(format!("({},)", ps[0]));
        return;
    }
    let op = if is_optional && matches!(lang, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript) { "?." } else { "" };
    let pfx = if is_new && matches!(lang, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript | LanguageId::CSharp | LanguageId::Java | LanguageId::Php | LanguageId::Cpp) {
        "new "
    } else { "" };
    st.vals.push(format!("{pfx}{cs}{op}({})", ps.join(", ")));
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
