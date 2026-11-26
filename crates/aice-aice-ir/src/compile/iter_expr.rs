use aice_lang_registry::LanguageId;

use crate::compile::expr_emit::{ExprEmitCtx, assign_native, bin_op_native, emit_ident, emit_lit, is_str_like};
use crate::compile::iter_emit::{CTask, EvalState, body_kind_of};
use crate::compile::iter_expr_call::{finish_make_call, make_inline_jsx, push_eval_call, push_eval_index};
use crate::compile::iter_expr_fmt::{
    format_closure, format_closure_param, format_record_entry, format_template,
    needs_walrus_parens, unary_op_native,
};
use crate::ir_code::{BinaryOp, Expr, FnBody, MemberKind, RecordEntry, UnaryOp};

pub(crate) fn step_expr_task<'a>(
    task: CTask<'a>,
    lang: LanguageId,
    ectx: &ExprEmitCtx,
    st: &mut EvalState,
    tasks: &mut Vec<CTask<'a>>,
) {
    match task {
        CTask::EvalExpr(e) => push_eval_expr(e, lang, ectx, st, tasks),
        CTask::MakeBinary { op, is_str } => {
            let r = st.vals.pop().unwrap();
            let l = st.vals.pop().unwrap();
            if op == BinaryOp::As && !matches!(lang, LanguageId::Rust | LanguageId::TypeScript | LanguageId::Tsx | LanguageId::Kotlin | LanguageId::CSharp | LanguageId::Dart) {
                st.vals.push(l);
                return;
            }
            if matches!(op, BinaryOp::In | BinaryOp::NotIn) {
                let neg = op == BinaryOp::NotIn;
                let s = match (lang, neg) {
                    (LanguageId::Python, false) => format!("{l} in {r}"),
                    (LanguageId::Python, true) => format!("{l} not in {r}"),
                    (LanguageId::Kotlin, false) => format!("{l} in {r}"),
                    (LanguageId::Kotlin, true) => format!("{l} !in {r}"),
                    (LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript, false) => format!("{l} in {r}"),
                    (LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript, true) => format!("!({l} in {r})"),
                    (LanguageId::Ruby, false) => format!("{r}.include?({l})"),
                    (LanguageId::Ruby, true) => format!("!{r}.include?({l})"),
                    (LanguageId::Php, false) => format!("in_array({l}, {r})"),
                    (LanguageId::Php, true) => format!("!in_array({l}, {r})"),
                    (LanguageId::Rust, false) => format!("{r}.contains(&{l})"),
                    (LanguageId::Rust, true) => format!("!{r}.contains(&{l})"),
                    (LanguageId::CSharp, false) => format!("{r}.Contains({l})"),
                    (LanguageId::CSharp, true) => format!("!{r}.Contains({l})"),
                    (LanguageId::Java | LanguageId::Dart, false) => format!("{r}.contains({l})"),
                    (LanguageId::Java | LanguageId::Dart, true) => format!("!{r}.contains({l})"),
                    (_, false) => format!("contains({r}, {l})"),
                    (_, true) => format!("!contains({r}, {l})"),
                };
                st.vals.push(s);
                return;
            }
            let op_s = match (op, lang) {
                (BinaryOp::And, LanguageId::Python | LanguageId::Ruby) => "and",
                (BinaryOp::And, _) => "&&",
                (BinaryOp::Or, LanguageId::Python | LanguageId::Ruby) => "or",
                (BinaryOp::Or, _) => "||",
                (BinaryOp::Eq, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript | LanguageId::Php) => "===",
                (BinaryOp::NotEq, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript | LanguageId::Php) => "!==",
                (BinaryOp::Concat, LanguageId::Php) => ".",
                (BinaryOp::Add, LanguageId::Php) if is_str => ".",
                (BinaryOp::FloorDiv, LanguageId::Python) => "//",
                (BinaryOp::FloorDiv, LanguageId::Dart) => "~/",
                (BinaryOp::Coalesce, LanguageId::Kotlin) => "?:",
                (BinaryOp::Elvis, LanguageId::Php | LanguageId::Kotlin) => "?:",
                (BinaryOp::Elvis, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript | LanguageId::Ruby) => "||",
                (BinaryOp::Elvis, _) => "??",
                (BinaryOp::Is, LanguageId::Python | LanguageId::CSharp | LanguageId::Kotlin | LanguageId::Dart) => "is",
                (BinaryOp::Is, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript | LanguageId::Php | LanguageId::Java) => "instanceof",
                (BinaryOp::Is, _) => "==",
                (BinaryOp::IsNot, LanguageId::Python | LanguageId::CSharp) => "is not",
                (BinaryOp::IsNot, LanguageId::Kotlin) => "!is",
                (BinaryOp::IsNot, LanguageId::Dart) => "is!",
                (BinaryOp::IsNot, _) => "!=",
                (o, _) => bin_op_native(o),
            };
            st.vals.push(format!("{l} {op_s} {r}"));
        }
        CTask::MakeUnary { op, is_postfix, wrap } => {
            let raw = st.vals.pop().unwrap();
            let op_s = unary_op_native(op, lang);
            let inner = if !op_s.is_empty() && wrap { format!("({raw})") } else { raw };
            st.vals.push(if is_postfix { format!("{inner}{op_s}") } else { format!("{op_s}{inner}") });
        }
        CTask::MakeCond => {
            let f = st.vals.pop().unwrap();
            let t = st.vals.pop().unwrap();
            let c = st.vals.pop().unwrap();
            let s = match lang {
                LanguageId::Python => format!("{t} if {c} else {f}"),
                LanguageId::Kotlin => format!("if ({c}) {t} else {f}"),
                LanguageId::Rust => format!("if {c} {{ {t} }} else {{ {f} }}"),
                LanguageId::Go => format!("func() any {{ if {c} {{ return {t} }} else {{ return {f} }} }}()"),
                _ => format!("{c} ? {t} : {f}"),
            };
            st.vals.push(s);
        }
        CTask::MakePostfixTry => {
            let s = st.vals.pop().unwrap();
            st.vals.push(if lang == LanguageId::Rust { format!("{s}?") } else { s });
        }
        CTask::MakeTemplate { quasis, n_exprs } => {
            let start = st.vals.len() - n_exprs;
            let exs: Vec<String> = st.vals.drain(start..).collect();
            st.vals.push(format_template(quasis, &exs, lang));
        }
        CTask::MakeRecord { entries, n_vals } => {
            let start = st.vals.len() - n_vals;
            let vs: Vec<String> = st.vals.drain(start..).collect();
            let ps: Vec<String> = entries
                .iter()
                .zip(vs)
                .map(|(e, v)| format_record_entry(e, v, lang))
                .collect();
            if lang == LanguageId::Php {
                st.vals.push(format!("[{}]", ps.join(", ")));
            } else {
                st.vals.push(format!("{{ {} }}", ps.join(", ")));
            }
        }
        CTask::MakeInlineJsx { tag, entries, n_attr_vals, children, n_child_vals } => {
            make_inline_jsx(tag, entries, n_attr_vals, children, n_child_vals, st);
        }
        CTask::MakeArray(n) => {
            let start = st.vals.len() - n;
            let ps: Vec<String> = st.vals.drain(start..).collect();
            let s = match lang {
                LanguageId::Go => format!("[]any{{{}}}", ps.join(", ")),
                LanguageId::Java => format!("java.util.List.of({})", ps.join(", ")),
                LanguageId::Cpp => format!("std::vector{{{}}}", ps.join(", ")),
                _ => format!("[{}]", ps.join(", ")),
            };
            st.vals.push(s);
        }
        CTask::MakeIndex { is_optional } => {
            let idx = st.vals.pop().unwrap();
            let obj = st.vals.pop().unwrap();
            let op = if !is_optional { "" }
                else if lang == LanguageId::CSharp { "?" }
                else if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript) { "?." }
                else { "" };
            st.vals.push(format!("{obj}{op}[{idx}]"));
        }
        CTask::MakeMember { property, kind } => {
            let obj = st.vals.pop().unwrap();
            if lang == LanguageId::Ruby && obj == "self" && kind == MemberKind::Dot {
                st.vals.push(format!("@{property}"));
                return;
            }
            let sep = match kind {
                MemberKind::SafeNav if lang == LanguageId::Ruby => "&.",
                MemberKind::SafeNav if lang == LanguageId::Php => "?->",
                MemberKind::SafeNav => "?.",
                MemberKind::Scope if matches!(lang, LanguageId::Rust | LanguageId::Cpp | LanguageId::Php) => "::",
                MemberKind::Dot if lang == LanguageId::Php => "->",
                MemberKind::Scope | MemberKind::Dot => ".",
            };
            st.vals.push(format!("{obj}{sep}{property}"));
        }
        CTask::MakeAssign(op) => {
            let v = st.vals.pop().unwrap();
            let t = st.vals.pop().unwrap();
            st.vals.push(format!("{t} {} {v}", assign_native(op, lang)));
        }
        CTask::MakeAwait => { let v = st.vals.pop().unwrap(); st.vals.push(format!("await {v}")); }
        CTask::MakeCall { callee_lit, class_new, n_args, is_optional, is_new } => {
            finish_make_call(callee_lit, class_new, n_args, is_optional, is_new, lang, st);
        }
        CTask::MakeRustStructCall => {
            let rec = st.vals.pop().unwrap();
            let cs = st.vals.pop().unwrap();
            st.vals.push(format!("{cs} {rec}"));
        }
        CTask::MakeRubyBlock { params, body_kind, n_prefix } => {
            let body_val = if body_kind > 0 { Some(st.vals.pop().unwrap()) } else { None };
            let start = st.vals.len() - n_prefix;
            let ps: Vec<String> = st.vals.drain(start..).collect();
            let callee_s = st.vals.pop().unwrap();
            let head = if ps.is_empty() { callee_s } else { format!("{callee_s}({})", ps.join(", ")) };
            let p_s = if params.is_empty() { String::new() } else { format!(" |{}|", params.iter().map(|p| p.name.as_str()).collect::<Vec<_>>().join(", ")) };
            let res = match body_kind {
                1 => format!("{head} {{{p_s} {} }}", body_val.unwrap()),
                2 => {
                    let inner = body_val.unwrap();
                    let inner = inner.trim_end();
                    if inner.is_empty() { format!("{head} {{{p_s} }}") }
                    else if !inner.contains('\n') { format!("{head} {{{p_s} {} }}", inner.trim()) }
                    else { format!("{head} do{p_s}\n{inner}\nend") }
                }
                _ => format!("{head} {{{p_s} }}"),
            };
            st.vals.push(res);
        }
        CTask::MakeClosure { is_async, params, ret, body_kind } => {
            let body_s = if body_kind > 0 { Some(st.vals.pop().unwrap()) } else { None };
            let n_defs = params.iter().filter(|p| p.default.is_some()).count();
            let start = st.vals.len() - n_defs;
            let defs: Vec<String> = st.vals.drain(start..).collect();
            let mut di = defs.into_iter();
            let ps: Vec<String> = params.iter().map(|p| {
                let d = if p.default.is_some() { Some(di.next().unwrap()) } else { None };
                format_closure_param(p, d.as_deref(), lang)
            }).collect();
            st.vals.push(format_closure(is_async, &ps, ret, body_kind, body_s.as_deref(), lang));
        }
        _ => unreachable!(),
    }
}

fn push_eval_expr<'a>(e: &'a Expr, lang: LanguageId, ectx: &ExprEmitCtx, st: &mut EvalState, tasks: &mut Vec<CTask<'a>>) {
    match e {
        Expr::Literal(l) => st.vals.push(emit_lit(l, lang)),
        Expr::Ident(s) => st.vals.push(emit_ident(s, lang)),
        Expr::Template { quasis, exprs } => {
            tasks.push(CTask::MakeTemplate { quasis, n_exprs: exprs.len() });
            for ex in exprs.iter().rev() { tasks.push(CTask::EvalExpr(ex)); }
        }
        Expr::Binary { op, left, right } => {
            let lp = crate::printer_expr::needs_binary_parens(left, *op, false) || needs_walrus_parens(left);
            let rp = crate::printer_expr::needs_binary_parens(right, *op, true) || needs_walrus_parens(right);
            tasks.push(CTask::MakeBinary { op: *op, is_str: is_str_like(left) || is_str_like(right) });
            if rp { tasks.push(CTask::WrapParen); }
            tasks.push(CTask::EvalExpr(right));
            if lp { tasks.push(CTask::WrapParen); }
            tasks.push(CTask::EvalExpr(left));
        }
        Expr::Unary { op, is_postfix, operand } => {
            let wrap = *op != UnaryOp::Yield
                && (matches!(operand.as_ref(), Expr::Binary { .. } | Expr::Conditional { .. } | Expr::Assign { .. })
                    || needs_walrus_parens(operand));
            tasks.push(CTask::MakeUnary { op: *op, is_postfix: *is_postfix, wrap });
            tasks.push(CTask::EvalExpr(operand));
        }
        Expr::Conditional { cond, then_expr, else_expr } => {
            tasks.push(CTask::MakeCond);
            tasks.push(CTask::EvalExpr(else_expr));
            tasks.push(CTask::EvalExpr(then_expr));
            tasks.push(CTask::EvalExpr(cond));
        }
        Expr::PostfixTry(inner) => { tasks.push(CTask::MakePostfixTry); tasks.push(CTask::EvalExpr(inner)); }
        Expr::Call { callee, args, is_optional, is_tagged, is_new } => push_eval_call(callee, args, (*is_optional, *is_tagged, *is_new), lang, ectx, tasks),
        Expr::Member { object, property, kind } => {
            tasks.push(CTask::MakeMember { property, kind: *kind });
            tasks.push(CTask::EvalExpr(object));
        }
        Expr::Index { object, index, is_optional } => push_eval_index(object, index, *is_optional, tasks),
        Expr::Array(items) => {
            tasks.push(CTask::MakeArray(items.len()));
            for it in items.iter().rev() { tasks.push(CTask::EvalExpr(it)); }
        }
        Expr::Record(entries) => {
            if entries.is_empty() { st.vals.push(if lang == LanguageId::Php { "[]" } else { "{}" }.to_string()); return; }
            tasks.push(CTask::MakeRecord { entries, n_vals: entries.len() });
            for en in entries.iter().rev() {
                let ex = match en { RecordEntry::Spread(x) | RecordEntry::Field { value: x, .. } => x };
                tasks.push(CTask::EvalExpr(ex));
            }
        }
        Expr::Closure { is_async, params, ret, body } => {
            let bk = body_kind_of(body);
            tasks.push(CTask::MakeClosure { is_async: *is_async, params, ret: ret.as_ref(), body_kind: bk });
            match body.as_ref() {
                FnBody::Expr(ex) => tasks.push(CTask::EvalExpr(ex)),
                FnBody::Block(stmts) if lang == LanguageId::Python => tasks.push(CTask::EvalPyStmtsExpr(stmts)),
                FnBody::Block(stmts) if lang == LanguageId::Ruby => {
                    tasks.push(CTask::PopSubCtxToVal);
                    tasks.push(CTask::RbStmts(stmts));
                    tasks.push(CTask::PushSubCtx { tab: "  ", indent: 0 });
                }
                FnBody::Block(stmts) => {
                    tasks.push(CTask::PopSubCtxToVal);
                    tasks.push(CTask::BraceStmts { stmts, tail: lang == LanguageId::Rust });
                    tasks.push(CTask::PushSubCtx { tab: "  ", indent: 0 });
                }
                FnBody::SignatureOnly => {}
            }
            for p in params.iter().rev() { if let Some(d) = &p.default { tasks.push(CTask::EvalExpr(d)); } }
        }
        Expr::Assign { target, op, value } => {
            tasks.push(CTask::MakeAssign(*op));
            tasks.push(CTask::EvalExpr(value));
            tasks.push(CTask::EvalExpr(target));
        }
        Expr::Await(inner) => { tasks.push(CTask::MakeAwait); tasks.push(CTask::EvalExpr(inner)); }
        Expr::Match { target, cases } => {
            tasks.push(CTask::PrepMatchExpr { target, cases });
            tasks.push(CTask::EvalExpr(target));
        }
    }
}
