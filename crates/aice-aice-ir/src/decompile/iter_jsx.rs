use tree_sitter::Node;

use crate::decompile::cst_util::{field_text, named_children, node_text, strip_quotes};
use crate::decompile::iter_env::{DTask, DecompEnv};
use crate::ir::Trivia;
use crate::ir_code::{Expr, LiteralVal, RecordEntry};
use crate::ir_domain::{LayoutAttr, LayoutNode};

pub(crate) enum JsxFin {
    Elem { tag: String, attr_specs: Vec<(String, u8, String)>, items: Vec<JsxSlot>, trivia: Trivia },
}

pub(crate) enum JsxSlot {
    Child,
    Expr,
    Text(String),
}

pub(crate) fn push_jsx_node<'a>(env: &mut DecompEnv<'a>, node: Node<'a>) {
    if node.kind() == "jsx_self_closing_element" {
        let tag = field_text(node, "name", env.src).unwrap_or("div").to_string();
        let (attr_specs, exprs) = scan_jsx_attrs(node, env.src);
        env.tasks.push(DTask::FinishJsx(JsxFin::Elem { tag, attr_specs, items: Vec::new(), trivia: Trivia::default() }));
        for e in exprs.into_iter().rev() { env.tasks.push(DTask::Expr(e)); }
        return;
    }
    let open = node.child_by_field_name("open_tag")
        .or_else(|| named_children(node).into_iter().find(|c| c.kind() == "jsx_opening_element"));
    let tag = open.and_then(|o| field_text(o, "name", env.src)).unwrap_or("Fragment").to_string();
    let (attr_specs, attr_exprs) = open.map(|o| scan_jsx_attrs(o, env.src)).unwrap_or_default();

    let mut slots = Vec::new();
    let mut child_nodes = Vec::new();
    let mut expr_nodes = Vec::new();
    let mut has_prev_item = false;
    for ch in named_children(node) {
        match ch.kind() {
            "jsx_element" | "jsx_self_closing_element" | "jsx_fragment" => {
                slots.push(JsxSlot::Child);
                child_nodes.push(ch);
                has_prev_item = true;
            }
            "jsx_expression" => {
                if let Some(ex) = named_children(ch).into_iter().next() {
                    slots.push(JsxSlot::Expr);
                    expr_nodes.push(ex);
                    has_prev_item = true;
                }
            }
            "jsx_text" => {
                let raw_t = node_text(ch, env.src);
                let norm = raw_t.split_whitespace().collect::<Vec<_>>().join(" ");
                if !norm.is_empty() {
                    let preserved = if raw_t.starts_with(' ') && has_prev_item { format!(" {norm}") } else { norm };
                    slots.push(JsxSlot::Text(preserved));
                    has_prev_item = true;
                }
            }
            _ => {}
        }
    }
    env.tasks.push(DTask::FinishJsx(JsxFin::Elem { tag, attr_specs, items: slots, trivia: Trivia::default() }));
    for e in expr_nodes.into_iter().rev() { env.tasks.push(DTask::Expr(e)); }
    for c in child_nodes.into_iter().rev() { env.tasks.push(DTask::JsxNode(c)); }
    for e in attr_exprs.into_iter().rev() { env.tasks.push(DTask::Expr(e)); }
}

fn scan_jsx_attrs<'a>(tag_node: Node<'a>, src: &'a str) -> (Vec<(String, u8, String)>, Vec<Node<'a>>) {
    let mut specs = Vec::new();
    let mut exprs = Vec::new();
    for ch in named_children(tag_node) {
        if ch.kind() == "jsx_attribute" {
            let kids = named_children(ch);
            if let Some(k) = kids.first() {
                let name = node_text(*k, src).trim().to_string();
                match kids.get(1) {
                    Some(v) if v.kind() == "jsx_expression" => {
                        if let Some(e) = named_children(*v).into_iter().next() {
                            specs.push((name, 2, String::new()));
                            exprs.push(e);
                        } else {
                            specs.push((name, 1, node_text(*v, src).trim().to_string()));
                        }
                    }
                    Some(v) => specs.push((name, 3, strip_quotes(node_text(*v, src).trim()))),
                    None => specs.push((name, 0, String::new())),
                }
            }
        }
    }
    (specs, exprs)
}

pub(crate) fn finish_jsx_task(env: &mut DecompEnv<'_>, f: JsxFin) {
    let JsxFin::Elem { tag, attr_specs, items, trivia } = f;
    let attr_expr_cnt = attr_specs.iter().filter(|(_, k, _)| *k == 2).count();
    let child_cnt = items.iter().filter(|s| matches!(s, JsxSlot::Child)).count();
    let expr_cnt = items.iter().filter(|s| matches!(s, JsxSlot::Expr)).count();

    let mut ex_vals = env.exprs.split_off(env.exprs.len() - expr_cnt).into_iter();
    let mut ch_vals = env.layouts.split_off(env.layouts.len() - child_cnt).into_iter();
    let mut at_exprs = env.exprs.split_off(env.exprs.len() - attr_expr_cnt).into_iter();

    let attrs: Vec<LayoutAttr> = attr_specs.into_iter().map(|(name, kind, raw)| {
        let value = match kind {
            1 => Some(Expr::Ident(raw)),
            2 => at_exprs.next(),
            3 => Some(Expr::Literal(LiteralVal::Str { value: raw, multiline: false })),
            _ => None,
        };
        LayoutAttr { name, value }
    }).collect();

    let mut built = Vec::with_capacity(items.len());
    for slot in items {
        match slot {
            JsxSlot::Child => built.push(ch_vals.next().expect("jsx ch")),
            JsxSlot::Expr => built.push(LayoutNode::Element {
                tag: "#expr".into(), attrs: Vec::new(), text: None,
                child_expr: ex_vals.next(), children: Vec::new(), trivia: Trivia::default(),
            }),
            JsxSlot::Text(t) => built.push(LayoutNode::Element {
                tag: "#text".into(), attrs: Vec::new(), text: Some(t),
                child_expr: None, children: Vec::new(), trivia: Trivia::default(),
            }),
        }
    }
    let (mut text, mut child_expr, mut children) = (None, None, Vec::new());
    if built.len() == 1 {
        let mut first = built.remove(0);
        match &mut first {
            LayoutNode::Element { tag: t, text: Some(s), .. } if t == "#text" => text = Some(std::mem::take(s)),
            LayoutNode::Element { tag: t, child_expr: Some(e), .. } if t == "#expr" => child_expr = Some(std::mem::replace(e, Expr::Ident(String::new()))),
            _ => children.push(first),
        }
    } else {
        children = built;
    }
    env.layouts.push(LayoutNode::Element { tag, attrs, text, child_expr, children, trivia });
}

pub(crate) fn finish_layout_to_expr(env: &mut DecompEnv<'_>, mut ln: LayoutNode, force_empty_tag: bool) {
    let LayoutNode::Element { tag, attrs, text, child_expr, children, .. } = &mut ln else {
        env.exprs.push(Expr::Literal(LiteralVal::Nil));
        return;
    };
    let tag = std::mem::take(tag);
    let attrs = std::mem::take(attrs);
    let text = text.take();
    let child_expr = child_expr.take();
    let children = std::mem::take(children);
    if tag == "#text" {
        env.exprs.push(Expr::Literal(LiteralVal::Str { value: text.unwrap_or_default(), multiline: false }));
        return;
    }
    if tag == "#expr" {
        env.exprs.push(child_expr.unwrap_or(Expr::Literal(LiteralVal::Nil)));
        return;
    }
    let eff_tag = if force_empty_tag { String::new() } else { tag };
    let rec_entries = attrs.into_iter().map(|a| match a.value {
        Some(v) => RecordEntry::Field { key: Some(a.name), value: v },
        None => RecordEntry::Field { key: None, value: Expr::Literal(LiteralVal::Str { value: a.name, multiline: false }) },
    }).collect();
    if let Some(t) = text {
        env.exprs.push(Expr::Call {
            callee: Box::new(Expr::Ident("__jsx".into())),
            args: vec![Expr::Literal(LiteralVal::Str { value: eff_tag, multiline: false }), Expr::Record(rec_entries), Expr::Literal(LiteralVal::Str { value: t, multiline: false })],
            is_optional: false, is_tagged: false, is_new: false,
        });
    } else if let Some(ex) = child_expr {
        env.exprs.push(Expr::Call {
            callee: Box::new(Expr::Ident("__jsx".into())),
            args: vec![Expr::Literal(LiteralVal::Str { value: eff_tag, multiline: false }), Expr::Record(rec_entries), ex],
            is_optional: false, is_tagged: false, is_new: false,
        });
    } else {
        env.tasks.push(DTask::FinishLayoutToExpr { eff_tag, rec_entries, len: children.len() });
        for ch in children.into_iter().rev() {
            env.tasks.push(DTask::LayoutToExpr(ch, false));
        }
    }
}
