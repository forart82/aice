use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::compile::expr_emit::{ExprEmitCtx, emit_expr};
use crate::compile::stmt_common::emit_brace_stmts;
use crate::compile::ts_js::{emit_ts_params, emit_ts_type_params};
use crate::ir::Visibility;
use crate::ir_domain::{ComponentDecl, LayoutNode};

pub(crate) fn emit_component(ec: &mut EmitCtx, comp: &ComponentDecl, target: LanguageId, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&comp.trivia, CommentStyle::Slash);
    let is_js = target == LanguageId::JavaScript;
    let exp = if comp.vis == Visibility::Public { "export " } else { "" };
    let tps = if is_js { String::new() } else { emit_ts_type_params(&comp.type_params, target) };
    let ps = emit_ts_params(&comp.params, target, !is_js);
    ec.line(&format!("{exp}function {}{tps}({ps}) {{", comp.name));
    ec.push();
    if !comp.body_stmts.is_empty() {
        emit_brace_stmts(&comp.body_stmts, target, ec, ectx, false);
    }
    if !comp.layout.is_empty() {
        ec.line("return (");
        ec.push();
        for node in &comp.layout { emit_jsx_node(ec, node, target, ectx); }
        ec.pop();
        ec.line(");");
    }
    ec.pop();
    ec.line("}");
}

fn emit_jsx_node(ec: &mut EmitCtx, root: &LayoutNode, target: LanguageId, ectx: &ExprEmitCtx) {
    enum JOp<'a> { Node(&'a LayoutNode), Close(String) }
    let mut tasks = vec![JOp::Node(root)];
    while let Some(op) = tasks.pop() {
        match op {
            JOp::Close(tag) => { ec.pop(); ec.line(&format!("</{tag}>")); }
            JOp::Node(node) => {
                let LayoutNode::Element { tag, attrs, text, child_expr, children, .. } = node else { continue };
                if tag == "#text" {
                    if let Some(t) = text { ec.line(t); }
                    continue;
                }
                if tag == "#expr" {
                    if let Some(ex) = child_expr { ec.line(&format!("{{{}}}", emit_expr(ex, target, ectx))); }
                    continue;
                }
                let mut attr_s = String::new();
                for a in attrs {
                    if a.name == "..." && let Some(ex) = &a.value {
                        attr_s.push_str(&format!(" {{...{}}}", emit_expr(ex, target, ectx)));
                        continue;
                    }
                    match &a.value {
                        Some(crate::ir_code::Expr::Literal(crate::ir_code::LiteralVal::Str { value, .. })) => {
                            attr_s.push_str(&format!(" {}=\"{value}\"", a.name));
                        }
                        Some(ex) => attr_s.push_str(&format!(" {}={{{}}}", a.name, emit_expr(ex, target, ectx))),
                        None => attr_s.push_str(&format!(" {}", a.name)),
                    }
                }
                if let Some(t) = text { ec.line(&format!("<{tag}{attr_s}>{t}</{tag}>")); }
                else if let Some(ex) = child_expr { ec.line(&format!("<{tag}{attr_s}>{{{}}}</{tag}>", emit_expr(ex, target, ectx))); }
                else if children.is_empty() { ec.line(&format!("<{tag}{attr_s} />")); }
                else {
                    ec.line(&format!("<{tag}{attr_s}>"));
                    ec.push();
                    tasks.push(JOp::Close(tag.clone()));
                    for ch in children.iter().rev() { tasks.push(JOp::Node(ch)); }
                }
            }
        }
    }
}
