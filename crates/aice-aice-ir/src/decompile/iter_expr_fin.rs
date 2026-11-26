use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, named_children, node_text};
use crate::decompile::iter_env::{DTask, DecompEnv};
use crate::decompile::iter_expr::ExprFin;
use crate::ir::Trivia;
use crate::ir_code::{BinaryOp, Expr, FnBody, LiteralVal, MemberKind, RecordEntry, UnaryOp};
use crate::ir_types::ParamDecl;

pub(crate) fn push_call_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>, raw: &str) {
    if matches!(node.kind(), "new_expression" | "object_creation_expression") {
        let cls = field_text(node, "constructor", env.src).or_else(|| field_text(node, "type", env.src))
            .or_else(|| named_children(node).first().map(|c| node_text(*c, env.src))).unwrap_or("Object").trim().to_string();
        let arg_nodes = node.child_by_field_name("arguments").map(named_children).unwrap_or_default();
        env.tasks.push(DTask::FinishExpr(ExprFin::Call {
            has_callee_expr: false, callee_name: cls, recv_prop: None, argc: arg_nodes.len(), has_ruby_blk: false,
        }));
        for a in arg_nodes.into_iter().rev() { env.tasks.push(DTask::Expr(a)); }
        return;
    }
    let callee_node = node.child_by_field_name("function").or_else(|| node.child_by_field_name("method"))
        .or_else(|| node.child_by_field_name("name")).or_else(|| named_children(node).into_iter().next());
    let args_node = node.child_by_field_name("arguments")
        .or_else(|| named_children(node).into_iter().find(|c| c.kind().contains("argument")));
    let Some(cn) = callee_node else { env.exprs.push(Expr::Ident(raw.to_string())); return; };
    let obj = node.child_by_field_name("object").or_else(|| node.child_by_field_name("receiver"));
    let prop = node_text(cn, env.src).trim().to_string();
    if let Some(o) = obj && env.lang == LanguageId::Ruby && prop == "nil?" && args_node.is_none() {
        env.tasks.push(DTask::FinishExpr(ExprFin::RubyNilCheck));
        env.tasks.push(DTask::Expr(o));
        return;
    }
    let arg_nodes = args_node.map(named_children).unwrap_or_default();
    let ruby_blk = (env.lang == LanguageId::Ruby).then(|| {
        node.child_by_field_name("block").or_else(|| child_by_kind(node, "block")).or_else(|| child_by_kind(node, "do_block"))
    }).flatten();
    env.tasks.push(DTask::FinishExpr(ExprFin::Call {
        has_callee_expr: true, callee_name: String::new(), recv_prop: obj.map(|_| prop),
        argc: arg_nodes.len(), has_ruby_blk: ruby_blk.is_some(),
    }));
    if let Some(blk) = ruby_blk { push_ruby_block_task(env, blk); }
    for a in arg_nodes.into_iter().rev() { env.tasks.push(DTask::Expr(a)); }
    if let Some(o) = obj { env.tasks.push(DTask::Expr(o)); } else { env.tasks.push(DTask::Expr(cn)); }
}

fn push_ruby_block_task<'a>(env: &mut DecompEnv<'a>, blk: Node<'a>) {
    let mut params = Vec::new();
    if let Some(pn) = blk.child_by_field_name("parameters").or_else(|| child_by_kind(blk, "block_parameters")) {
        for c in named_children(pn) {
            let nm = node_text(c, env.src).trim().to_string();
            if !nm.is_empty() {
                params.push(ParamDecl {
                    name: nm, vis: Default::default(), is_readonly: false, is_mut: false,
                    is_optional: false, is_rest: false, ty: None, default: None, trivia: Trivia::default(),
                });
            }
        }
    }
    let body_node = blk.child_by_field_name("body").or_else(|| child_by_kind(blk, "block_body")).or_else(|| child_by_kind(blk, "body_statement"));
    env.tasks.push(DTask::FinishExpr(ExprFin::RubyBlock { params, has_body: body_node.is_some() }));
    if let Some(b) = body_node { env.tasks.push(DTask::Block(b)); }
}

pub(crate) fn push_lambda_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>) {
    let (params, default_nodes) = crate::decompile::tsx_jsx::extract_lambda_params(node, env.src, env.lang);
    let default_mask: Vec<bool> = default_nodes.iter().map(Option::is_some).collect();
    let ret = node.child_by_field_name("return_type").map(|r| crate::decompile::tsx_jsx::map_ts_type_node(r, env.src, env.lang));
    let body_node = node.child_by_field_name("body").or_else(|| named_children(node).into_iter().last());
    let (body_kind, target_n) = match body_node {
        Some(b) if b.kind() == "function_expression_body" => {
            if let Some(blk) = child_by_kind(b, "block") { (1u8, Some(blk)) }
            else if let Some(ex) = named_children(b).into_iter().next() { (2u8, Some(ex)) }
            else { (0u8, None) }
        }
        Some(b) if matches!(b.kind(), "statement_block" | "block") => (1u8, Some(b)),
        Some(b) => (2u8, Some(b)),
        None => (0u8, None),
    };
    let is_async = node_text(node, env.src).trim_start().starts_with("async ");
    env.tasks.push(DTask::FinishExpr(ExprFin::Closure { is_async, params, default_mask, ret, body_kind }));
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
    let op = match op_str {
        "+" | "." if op_str == "+" || env.lang == LanguageId::Php => BinaryOp::Add,
        "-" => BinaryOp::Sub, "*" => BinaryOp::Mul, "/" => BinaryOp::Div, "%" => BinaryOp::Mod,
        "**" => BinaryOp::Pow, "==" | "===" => BinaryOp::Eq, "!=" | "!==" => BinaryOp::NotEq,
        "<" => BinaryOp::Lt, "<=" => BinaryOp::LtEq, ">" => BinaryOp::Gt, ">=" => BinaryOp::GtEq,
        "&&" | "and" => BinaryOp::And, "||" | "or" => BinaryOp::Or, "??" => BinaryOp::Coalesce,
        "&" => BinaryOp::BitAnd, "|" => BinaryOp::BitOr, "^" => BinaryOp::BitXor,
        "<<" => BinaryOp::Shl, ">>" => BinaryOp::Shr, ">>>" => BinaryOp::Ushr,
        "in" => BinaryOp::In, "instanceof" => BinaryOp::Instanceof,
        _ => { env.exprs.push(Expr::Ident(raw.to_string())); return; }
    };
    env.tasks.push(DTask::FinishExpr(ExprFin::Binary(op)));
    env.tasks.push(DTask::Expr(kids[kids.len() - 1]));
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
    let op = match op_str {
        "!" | "not" => UnaryOp::Not,
        "&mut" | "& mut" => UnaryOp::RefMut,
        "&" => UnaryOp::Ref,
        "*" => UnaryOp::Deref,
        "++" => UnaryOp::Inc,
        "--" => UnaryOp::Dec,
        "-" => UnaryOp::Neg,
        "~" => UnaryOp::BitNot,
        _ => match node.kind() {
            "inc_statement" => UnaryOp::Inc,
            "dec_statement" => UnaryOp::Dec,
            _ => {
                env.exprs.push(Expr::Ident(raw.to_string()));
                return;
            }
        },
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
        ExprFin::Index => {
            let index = Box::new(env.exprs.pop().expect("idx"));
            let object = Box::new(env.exprs.pop().expect("obj"));
            Expr::Index { object, index }
        }
        ExprFin::RubyNilCheck => Expr::Binary { op: BinaryOp::Eq, left: Box::new(env.exprs.pop().expect("nilchk")), right: Box::new(Expr::Literal(LiteralVal::Nil)) },
        ExprFin::Call { has_callee_expr, callee_name, recv_prop, argc, has_ruby_blk } => {
            let blk_expr = has_ruby_blk.then(|| env.exprs.pop().expect("rb blk"));
            let mut args = env.exprs.split_off(env.exprs.len() - argc);
            if let Some(b) = blk_expr { args.push(b); }
            let callee = if !has_callee_expr { Expr::Ident(callee_name) }
            else {
                let c = env.exprs.pop().expect("callee");
                if let Some(prop) = recv_prop { Expr::Member { object: Box::new(c), property: prop, kind: MemberKind::Dot } } else { c }
            };
            Expr::Call { callee: Box::new(callee), args, is_optional: false, is_tagged: false }
        }
        ExprFin::Binary(op) => {
            let right = Box::new(env.exprs.pop().expect("bin r"));
            let left = Box::new(env.exprs.pop().expect("bin l"));
            Expr::Binary { op, left, right }
        }
        ExprFin::Unary { op, is_postfix } => Expr::Unary { op, is_postfix, operand: Box::new(env.exprs.pop().expect("un")) },
        ExprFin::Assign(op) => {
            let value = Box::new(env.exprs.pop().expect("as val"));
            let target = Box::new(env.exprs.pop().expect("as tgt"));
            Expr::Assign { target, op, value }
        }
        ExprFin::StructExpr { sname, keys } => {
            let vals = env.exprs.split_off(env.exprs.len() - keys.len());
            let recs = keys.into_iter().zip(vals).map(|(k, v)| RecordEntry::Field { key: Some(k), value: v }).collect();
            Expr::Call { callee: Box::new(Expr::Ident(sname)), args: vec![Expr::Record(recs)], is_optional: false, is_tagged: false }
        }
        ExprFin::Object(keys) => {
            let vals = env.exprs.split_off(env.exprs.len() - keys.len());
            Expr::Record(keys.into_iter().zip(vals).map(|(k, v)| RecordEntry::Field { key: Some(k), value: v }).collect())
        }
        ExprFin::Array(n) => Expr::Array(env.exprs.split_off(env.exprs.len() - n)),
        ExprFin::TypeCast(ty_name) => Expr::Binary { op: BinaryOp::As, left: Box::new(env.exprs.pop().expect("cast")), right: Box::new(Expr::Ident(ty_name)) },
        ExprFin::Await => Expr::Await(Box::new(env.exprs.pop().expect("await"))),
        ExprFin::Closure { is_async, mut params, default_mask, ret, body_kind } => {
            let body = match body_kind {
                1 => FnBody::Block(env.blocks.pop().unwrap_or_default()),
                2 => FnBody::Expr(env.exprs.pop().expect("cl expr")),
                _ => FnBody::SignatureOnly,
            };
            let def_cnt = default_mask.iter().filter(|&&b| b).count();
            let mut defs = env.exprs.split_off(env.exprs.len() - def_cnt).into_iter();
            for (p, has_d) in params.iter_mut().zip(default_mask) {
                if has_d { p.default = defs.next(); }
            }
            Expr::Closure { is_async, params, ret, body: Box::new(body) }
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
