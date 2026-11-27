use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, named_children, node_text};
use crate::decompile::iter_env::{DTask, DecompEnv};
use crate::decompile::iter_expr::{ExprFin, ObjSlot};
use crate::decompile::op_map::{map_binary_op, map_unary_op};
use crate::ir_code::{BinaryOp, Expr, FnBody, LiteralVal, MemberKind, RecordEntry, UnaryOp};

pub(crate) fn push_lambda_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>) {
    let (params, default_nodes) = crate::decompile::tsx_jsx::extract_lambda_params(node, env.src, env.lang);
    let default_mask: Vec<bool> = default_nodes.iter().map(Option::is_some).collect();
    let destruct_stmts = if matches!(env.lang, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript) {
        node.child_by_field_name("parameters")
            .filter(|pn| pn.kind() == "formal_parameters")
            .map(|pn| crate::decompile::ts_helpers::extract_ts_destructured_param_stmts(pn, env.src, env.lang))
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let ret_node = node.child_by_field_name("return_type").or_else(|| {
        (env.lang == LanguageId::Cpp)
            .then(|| {
                node.child_by_field_name("declarator")
                    .or_else(|| child_by_kind(node, "lambda_declarator"))
                    .and_then(|d| child_by_kind(d, "trailing_return_type"))
            })
            .flatten()
    });
    let ret = ret_node.map(|r| {
        let txt = node_text(r, env.src).trim().trim_start_matches("->").trim();
        crate::decompile::cst_util::map_type_str(txt, env.lang)
    });
    let body_node = node.child_by_field_name("body").or_else(|| named_children(node).into_iter().last());
    let (body_kind, target_n) = match body_node {
        Some(b) if b.kind() == "function_expression_body" => {
            if let Some(blk) = child_by_kind(b, "block") { (1u8, Some(blk)) }
            else if let Some(ex) = named_children(b).into_iter().next() { (2u8, Some(ex)) }
            else { (0u8, None) }
        }
        Some(b) if matches!(b.kind(), "statement_block" | "block" | "compound_statement") => (1u8, Some(b)),
        Some(b) => (2u8, Some(b)),
        None => (0u8, None),
    };
    let hdr_end = node
        .child_by_field_name("name")
        .or_else(|| node.child_by_field_name("parameters"))
        .or_else(|| node.child_by_field_name("parameter"))
        .or_else(|| node.child_by_field_name("body"))
        .map(|n| n.start_byte())
        .unwrap_or(node.end_byte());
    let hdr = env.src.get(node.start_byte()..hdr_end).unwrap_or("");
    let is_async = hdr.split_whitespace().any(|w| w == "async");
    let is_generator = matches!(env.lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx)
        && (node.kind() == "generator_function" || hdr.contains('*'));
    env.tasks.push(DTask::FinishExpr(ExprFin::Closure {
        is_async, is_generator, params, default_mask, destruct_stmts, ret, body_kind,
    }));
    if let Some(tn) = target_n {
        if body_kind == 1 { env.tasks.push(DTask::Block(tn)); } else { env.tasks.push(DTask::Expr(tn)); }
    }
    for dn in default_nodes.into_iter().flatten().rev() { env.tasks.push(DTask::Expr(dn)); }
}

pub(crate) fn push_binary_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>, raw: &str) {
    let kids = named_children(node);
    if kids.len() < 2 { env.exprs.push(Expr::Ident(raw.to_string())); return; }
    let op_str = node.child_by_field_name("operator").map(|o| node_text(o, env.src).trim())
        .unwrap_or_else(|| {
            let (l_end, r_start) = (kids[0].end_byte(), kids[kids.len() - 1].start_byte());
            if l_end <= r_start { env.src[l_end..r_start].trim() } else { "+" }
        });
    let Some(op) = map_binary_op(op_str, env.lang) else {
        env.exprs.push(Expr::Ident(raw.to_string()));
        return;
    };
    let rhs = kids[kids.len() - 1];
    if env.lang == LanguageId::Python
        && matches!(op, BinaryOp::Is | BinaryOp::IsNot)
        && node_text(rhs, env.src).trim() == "None"
    {
        env.tasks.push(DTask::FinishExpr(ExprFin::BinaryIdentRhs(op, "None".into())));
        env.tasks.push(DTask::Expr(kids[0]));
        return;
    }
    env.tasks.push(DTask::FinishExpr(ExprFin::Binary(op)));
    env.tasks.push(DTask::Expr(rhs));
    env.tasks.push(DTask::Expr(kids[0]));
}

pub(crate) fn push_unary_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>, raw: &str) {
    let op_node = node.child_by_field_name("operator");
    let arg = node
        .child_by_field_name("argument")
        .or_else(|| node.child_by_field_name("operand"))
        .or_else(|| {
            named_children(node).into_iter().find(|c| {
                Some(*c) != op_node
                    && !matches!(
                        c.kind(),
                        "prefix_operator" | "negation_operator" | "increment_operator"
                    )
            })
        });
    let Some(arg) = arg else {
        env.exprs.push(Expr::Ident(raw.to_string()));
        return;
    };
    if op_node.is_none() && arg.kind() == "await_expression" {
        env.tasks.push(DTask::Expr(arg));
        return;
    }
    let op_str = op_node
        .map(|o| node_text(o, env.src).trim())
        .unwrap_or_else(|| {
            let pre = env
                .src
                .get(node.start_byte()..arg.start_byte())
                .unwrap_or("")
                .trim();
            if !pre.is_empty() {
                pre
            } else {
                env.src
                    .get(arg.end_byte()..node.end_byte())
                    .unwrap_or("")
                    .trim()
            }
        });
    let Some(op) = map_unary_op(op_str, node.kind(), env.lang) else {
        env.exprs.push(Expr::Ident(raw.to_string()));
        return;
    };
    let is_postfix = matches!(op, UnaryOp::Inc | UnaryOp::Dec)
        && (op_node.is_some_and(|o| o.start_byte() >= arg.end_byte())
            || (op_node.is_none()
                && env
                    .src
                    .get(arg.end_byte()..node.end_byte())
                    .unwrap_or("")
                    .trim()
                    == op_str));
    env.tasks.push(DTask::FinishExpr(ExprFin::Unary { op, is_postfix }));
    env.tasks.push(DTask::Expr(arg));
}

pub(crate) fn finish_expr_task(env: &mut DecompEnv<'_>, f: ExprFin) {
    let e = match f {
        ExprFin::Conditional => {
            let else_expr = Box::new(env.exprs.pop().expect("c else"));
            let then_expr = Box::new(env.exprs.pop().expect("c then"));
            let cond = Box::new(env.exprs.pop().expect("c cond"));
            Expr::Conditional { cond, then_expr, else_expr }
        }
        ExprFin::Member { property, kind } => Expr::Member { object: Box::new(env.exprs.pop().expect("mem")), property, kind },
        ExprFin::Index { is_optional, argc } => {
            let index = if argc == 1 {
                Box::new(env.exprs.pop().expect("idx"))
            } else {
                let args = env.exprs.split_off(env.exprs.len() - argc);
                Box::new(Expr::Call {
                    callee: Box::new(Expr::Ident("\0idx".into())), args,
                    is_optional: false, is_tagged: false, is_new: false,
                })
            };
            let object = Box::new(env.exprs.pop().expect("obj"));
            Expr::Index { object, index, is_optional }
        }
        ExprFin::EmptyIndex(sep) => {
            let object = Box::new(env.exprs.pop().expect("eidx obj"));
            Expr::Index { object, index: Box::new(Expr::Ident(sep)), is_optional: false }
        }
        ExprFin::NewArray { has_init } => {
            let args = if has_init { vec![env.exprs.pop().expect("narr init")] } else { Vec::new() };
            let callee = Box::new(env.exprs.pop().expect("narr callee"));
            Expr::Call { callee, args, is_optional: false, is_tagged: true, is_new: true }
        }
        ExprFin::NewObjInit { callee_name, argc, has_parens } => {
            let init = env.exprs.pop().expect("obj init");
            let mut args = env.exprs.split_off(env.exprs.len() - argc);
            args.push(init);
            Expr::Call { callee: Box::new(Expr::Ident(callee_name)), args, is_optional: has_parens, is_tagged: true, is_new: true }
        }
        ExprFin::Template { quasis } => {
            let n = quasis.len().saturating_sub(1);
            let exprs = env.exprs.split_off(env.exprs.len() - n);
            Expr::Template { quasis, exprs }
        }
        ExprFin::TaggedTemplate => {
            let tpl = env.exprs.pop().expect("tagged tpl");
            let callee = Box::new(env.exprs.pop().expect("tagged callee"));
            Expr::Call { callee, args: vec![tpl], is_optional: false, is_tagged: true, is_new: false }
        }
        ExprFin::RubyNilCheck => Expr::Binary { op: BinaryOp::Eq, left: Box::new(env.exprs.pop().expect("nilchk")), right: Box::new(Expr::Literal(LiteralVal::Nil)) },
        ExprFin::Call { has_callee_expr, callee_name, recv_prop, recv_safe, argc, has_ruby_blk, is_optional, is_new } => {
            let blk_expr = has_ruby_blk.then(|| env.exprs.pop().expect("rb blk"));
            let mut args = env.exprs.split_off(env.exprs.len() - argc);
            if let Some(b) = blk_expr { args.push(b); }
            let callee = if !has_callee_expr { Expr::Ident(callee_name) }
            else {
                let c = env.exprs.pop().expect("callee");
                let kind = if recv_safe { MemberKind::SafeNav } else { MemberKind::Dot };
                if let Some(prop) = recv_prop { Expr::Member { object: Box::new(c), property: prop, kind } } else { c }
            };
            Expr::Call { callee: Box::new(callee), args, is_optional, is_tagged: false, is_new }
        }
        ExprFin::Binary(op) => {
            let right = Box::new(env.exprs.pop().expect("bin r"));
            let left = Box::new(env.exprs.pop().expect("bin l"));
            Expr::Binary { op, left, right }
        }
        ExprFin::BinaryIdentRhs(op, rhs) => {
            let left = Box::new(env.exprs.pop().expect("bin l"));
            Expr::Binary { op, left, right: Box::new(Expr::Ident(rhs)) }
        }
        ExprFin::Unary { op, is_postfix } => Expr::Unary { op, is_postfix, operand: Box::new(env.exprs.pop().expect("un")) },
        ExprFin::PostfixTry => Expr::PostfixTry(Box::new(env.exprs.pop().expect("try"))),
        ExprFin::Assign(op) => {
            let value = Box::new(env.exprs.pop().expect("as val"));
            let target = Box::new(env.exprs.pop().expect("as tgt"));
            Expr::Assign { target, op, value }
        }
        ExprFin::StructExpr { sname, slots } => {
            let vals = env.exprs.split_off(env.exprs.len() - slots.len());
            let recs = build_record_entries(slots, vals);
            Expr::Call { callee: Box::new(Expr::Ident(sname)), args: vec![Expr::Record(recs)], is_optional: false, is_tagged: false, is_new: false }
        }
        ExprFin::Object(slots) => {
            let vals = env.exprs.split_off(env.exprs.len() - slots.len());
            Expr::Record(build_record_entries(slots, vals))
        }
        ExprFin::Array(n) => Expr::Array(env.exprs.split_off(env.exprs.len() - n)),
        ExprFin::TypeCast { ty, quote_mode } => {
            let rhs = if quote_mode == 0 || (quote_mode == 1 && crate::decompile::expr_common::is_simple_cast_ident(&ty)) {
                Expr::Ident(ty)
            } else {
                Expr::Literal(LiteralVal::Str { value: ty, multiline: false })
            };
            Expr::Binary { op: BinaryOp::As, left: Box::new(env.exprs.pop().expect("cast")), right: Box::new(rhs) }
        }
        ExprFin::Await => Expr::Await(Box::new(env.exprs.pop().expect("await"))),
        ExprFin::Closure { is_async, is_generator, mut params, default_mask, mut destruct_stmts, ret, body_kind } => {
            let body = match body_kind {
                1 => {
                    let mut stmts = env.blocks.pop().unwrap_or_default();
                    if !destruct_stmts.is_empty() {
                        destruct_stmts.append(&mut stmts);
                        FnBody::Block(destruct_stmts)
                    } else {
                        FnBody::Block(stmts)
                    }
                }
                2 => {
                    let expr = env.exprs.pop().expect("cl expr");
                    if !destruct_stmts.is_empty() {
                        destruct_stmts.push(crate::ir_code::Stmt::Return {
                            value: Some(expr),
                            trivia: Default::default(),
                        });
                        FnBody::Block(destruct_stmts)
                    } else {
                        FnBody::Expr(expr)
                    }
                }
                _ => FnBody::SignatureOnly,
            };
            let def_cnt = default_mask.iter().filter(|&&b| b).count();
            let mut defs = env.exprs.split_off(env.exprs.len() - def_cnt).into_iter();
            for (p, has_d) in params.iter_mut().zip(default_mask) {
                if has_d { p.default = defs.next(); }
            }
            let cl = Expr::Closure { is_async, params, ret, body: Box::new(body) };
            if is_generator {
                Expr::Unary { op: UnaryOp::Generator, is_postfix: false, operand: Box::new(cl) }
            } else {
                cl
            }
        }
        ExprFin::RubyBlock { params, has_body } => {
            let stmts = if has_body { env.blocks.pop().unwrap_or_default() } else { Vec::new() };
            Expr::Closure { is_async: false, params, ret: None, body: Box::new(FnBody::Block(stmts)) }
        }
        ExprFin::InlineJsx(force) => {
            let ln = env.layouts.pop().expect("jsx ln");
            env.tasks.push(DTask::LayoutToExpr(ln, force));
            return;
        }
    };
    env.exprs.push(e);
}

fn build_record_entries(slots: Vec<ObjSlot>, vals: Vec<Expr>) -> Vec<RecordEntry> {
    slots.into_iter().zip(vals).map(|(slot, value)| match slot {
        ObjSlot::Field(k) => RecordEntry::Field { key: Some(k), value },
        ObjSlot::Shorthand => RecordEntry::Field { key: None, value },
        ObjSlot::Spread => RecordEntry::Spread(value),
    }).collect()
}
