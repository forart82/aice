use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, named_children, node_text, strip_quotes};
use crate::decompile::iter_env::{DTask, DecompEnv};
use crate::decompile::iter_expr::{ExprFin, ObjSlot};
use crate::decompile::trivia::is_comment_kind;
use crate::ir::Trivia;
use crate::ir_code::Expr;
use crate::ir_types::ParamDecl;

pub(crate) fn push_call_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>, raw: &str) {
    if node.kind() == "implicit_object_creation_expression" {
        let arg_nodes = node.child_by_field_name("arguments")
            .or_else(|| child_by_kind(node, "argument_list"))
            .map(named_children)
            .unwrap_or_default();
        env.tasks.push(DTask::FinishExpr(ExprFin::Call {
            has_callee_expr: false, callee_name: "new".into(), recv_prop: None,
            argc: arg_nodes.len(), has_ruby_blk: false, is_optional: false, is_new: false,
        }));
        for a in arg_nodes.into_iter().rev() { env.tasks.push(DTask::Expr(a)); }
        return;
    }
    if matches!(node.kind(), "new_expression" | "object_creation_expression") {
        let ctor_node = node.child_by_field_name("constructor").or_else(|| node.child_by_field_name("type"));
        let arg_nodes = node.child_by_field_name("arguments")
            .or_else(|| child_by_kind(node, "arguments"))
            .or_else(|| child_by_kind(node, "argument_list"))
            .map(named_children)
            .unwrap_or_default();
        if node.kind() == "new_expression"
            && let Some(cn) = ctor_node
            && matches!(cn.kind(), "identifier" | "member_expression" | "subscript_expression" | "call_expression")
        {
            env.tasks.push(DTask::FinishExpr(ExprFin::Call {
                has_callee_expr: true, callee_name: String::new(), recv_prop: None,
                argc: arg_nodes.len(), has_ruby_blk: false, is_optional: false, is_new: true,
            }));
            for a in arg_nodes.into_iter().rev() { env.tasks.push(DTask::Expr(a)); }
            env.tasks.push(DTask::Expr(cn));
            return;
        }
        let cls = ctor_node.map(|c| node_text(c, env.src))
            .or_else(|| named_children(node).first().map(|c| node_text(*c, env.src)))
            .unwrap_or("Object").trim().to_string();
        env.tasks.push(DTask::FinishExpr(ExprFin::Call {
            has_callee_expr: false, callee_name: cls, recv_prop: None,
            argc: arg_nodes.len(), has_ruby_blk: false, is_optional: false, is_new: true,
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
    let is_optional = child_by_kind(node, "optional_chain").is_some()
        || args_node.is_some_and(|an| {
            env.src.get(cn.end_byte()..an.start_byte()).is_some_and(|g| g.contains("?."))
        });
    env.tasks.push(DTask::FinishExpr(ExprFin::Call {
        has_callee_expr: true, callee_name: String::new(), recv_prop: obj.map(|_| prop),
        argc: arg_nodes.len(), has_ruby_blk: ruby_blk.is_some(), is_optional, is_new: false,
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

pub(crate) fn push_php_array_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>) {
    let elems: Vec<_> = named_children(node).into_iter()
        .filter(|c| c.kind() == "array_element_initializer")
        .collect();
    let is_assoc = elems.iter().any(|el| named_children(*el).len() >= 2);
    if is_assoc {
        let (mut slots, mut vals) = (Vec::new(), Vec::new());
        for el in elems {
            let kids = named_children(el);
            if kids.len() >= 2 {
                let k = strip_quotes(node_text(kids[0], env.src));
                slots.push(ObjSlot::Field(k));
                vals.push(kids[kids.len() - 1]);
            } else if let Some(&v) = kids.first() {
                slots.push(ObjSlot::Shorthand);
                vals.push(v);
            }
        }
        env.tasks.push(DTask::FinishExpr(ExprFin::Object(slots)));
        for v in vals.into_iter().rev() { env.tasks.push(DTask::Expr(v)); }
    } else {
        let vals: Vec<_> = elems.into_iter().filter_map(|el| named_children(el).into_iter().next()).collect();
        env.tasks.push(DTask::FinishExpr(ExprFin::Array(vals.len())));
        for v in vals.into_iter().rev() { env.tasks.push(DTask::Expr(v)); }
    }
}

pub(crate) fn push_object_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>, raw: &str) {
    let non_ty: Vec<_> = named_children(node)
        .into_iter()
        .filter(|c| !matches!(c.kind(), "type_arguments" | "type_argument_list") && !is_comment_kind(c.kind()))
        .collect();
    let (mut slots, mut vals) = (Vec::new(), Vec::new());
    for ch in &non_ty {
        match ch.kind() {
            "pair" | "field_initializer" | "map_entry" => {
                let k = field_text(*ch, "key", env.src)
                    .or_else(|| field_text(*ch, "field", env.src))
                    .or_else(|| field_text(*ch, "name", env.src))
                    .or_else(|| named_children(*ch).into_iter().next().map(|n| node_text(n, env.src)))
                    .map(strip_quotes);
                let vn = ch.child_by_field_name("value").or_else(|| named_children(*ch).into_iter().last());
                if let (Some(key), Some(v)) = (k, vn) {
                    slots.push(ObjSlot::Field(key));
                    vals.push(v);
                }
            }
            "method_definition" => {
                let name_node = ch.child_by_field_name("name").or_else(|| {
                    named_children(*ch).into_iter().find(|n| {
                        matches!(
                            n.kind(),
                            "property_identifier" | "string" | "computed_property_name" | "number" | "private_property_identifier"
                        )
                    })
                });
                if let Some(nn) = name_node {
                    let nm = strip_quotes(node_text(nn, env.src));
                    let hdr = env.src.get(ch.start_byte()..nn.start_byte()).unwrap_or("");
                    let key = if hdr.split_whitespace().any(|w| w == "get") {
                        format!("get {nm}")
                    } else if hdr.split_whitespace().any(|w| w == "set") {
                        format!("set {nm}")
                    } else {
                        nm
                    };
                    slots.push(ObjSlot::Field(key));
                    vals.push(*ch);
                }
            }
            "spread_element" => {
                if let Some(inner) = named_children(*ch).into_iter().next() {
                    slots.push(ObjSlot::Spread);
                    vals.push(inner);
                }
            }
            "shorthand_property_identifier" | "shorthand_property_identifier_pattern" => {
                slots.push(ObjSlot::Shorthand);
                vals.push(*ch);
            }
            _ => {}
        }
    }
    if slots.is_empty() && !non_ty.is_empty() {
        env.exprs.push(Expr::Ident(raw.to_string()));
    } else {
        env.tasks.push(DTask::FinishExpr(ExprFin::Object(slots)));
        for v in vals.into_iter().rev() { env.tasks.push(DTask::Expr(v)); }
    }
}
