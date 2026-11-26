use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::ir::{AiceItem, AiceModule, TranspileError};
use crate::ir_code::{Expr, LiteralVal};
use crate::ir_domain::{ComponentDecl, LayoutNode, StyleDecl};

const VOID_TAGS: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
];

pub fn compile(module: &AiceModule, target: LanguageId) -> Result<String, TranspileError> {
    if module.items.is_empty() && !module.raw_fallback.is_empty() {
        return Ok(module.raw_fallback.clone());
    }
    if target == LanguageId::Html {
        let mut ec = EmitCtx::new("  ");
        for it in &module.items {
            if let AiceItem::Component(c) = it { emit_html_comp(&mut ec, c); }
        }
        return Ok(ec.out);
    }
    let mut ec = EmitCtx::new("  ");
    ec.emit_trivia(&module.module_trivia, CommentStyle::CssBlock);
    for it in &module.items {
        match it {
            AiceItem::Import(imp) => ec.line(&format!("@import \"{}\";", imp.source)),
            AiceItem::Style(st) => emit_css_rule(&mut ec, st),
            _ => {}
        }
    }
    Ok(ec.out)
}

fn emit_html_comp(ec: &mut EmitCtx, comp: &ComponentDecl) {
    ec.emit_trivia(&comp.trivia, CommentStyle::Html);
    if comp.has_doctype { ec.line("<!doctype html>"); }
    for n in &comp.layout { emit_html_node(ec, n); }
}

fn emit_html_node(ec: &mut EmitCtx, root: &LayoutNode) {
    enum HOp<'a> { Node(&'a LayoutNode), PopLine(String) }
    let mut tasks = vec![HOp::Node(root)];
    while let Some(op) = tasks.pop() {
        match op {
            HOp::PopLine(s) => { ec.pop(); ec.line(&s); }
            HOp::Node(node) => match node {
                LayoutNode::Comment(t) => ec.line(&format!("<!-- {t} -->")),
                LayoutNode::Element { tag, attrs, text, children, trivia, .. } => {
                    ec.emit_trivia(trivia, CommentStyle::Html);
                    let mut attr_s = String::new();
                    for a in attrs {
                        match &a.value {
                            Some(Expr::Literal(LiteralVal::Str { value, .. })) => {
                                attr_s.push_str(&format!(" {}=\"{}\"", a.name, esc_attr(value)));
                            }
                            Some(ex) => attr_s.push_str(&format!(" {}=\"{:?}\"", a.name, ex)),
                            None => attr_s.push_str(&format!(" {}", a.name)),
                        }
                    }
                    if VOID_TAGS.contains(&tag.as_str()) {
                        ec.line(&format!("<{tag}{attr_s} />"));
                    } else if let Some(t) = text {
                        ec.line(&format!("<{tag}{attr_s}>{t}</{tag}>"));
                    } else if children.is_empty() {
                        ec.line(&format!("<{tag}{attr_s}></{tag}>"));
                    } else {
                        ec.line(&format!("<{tag}{attr_s}>"));
                        ec.push();
                        tasks.push(HOp::PopLine(format!("</{tag}>")));
                        for ch in children.iter().rev() { tasks.push(HOp::Node(ch)); }
                    }
                }
                LayoutNode::TemplateCtrl { .. } => {}
            },
        }
    }
}

fn esc_attr(s: &str) -> String {
    s.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;").replace('>', "&gt;")
}

fn emit_css_rule(ec: &mut EmitCtx, root: &StyleDecl) {
    enum COp<'a> { Rule(&'a StyleDecl), Close }
    let mut tasks = vec![COp::Rule(root)];
    while let Some(op) = tasks.pop() {
        match op {
            COp::Close => { ec.pop(); ec.line("}"); }
            COp::Rule(st) => {
                ec.blank();
                ec.emit_trivia(&st.trivia, CommentStyle::CssBlock);
                ec.line(&format!("{} {{", st.selector));
                ec.push();
                for p in &st.props {
                    ec.emit_trivia(&p.trivia, CommentStyle::CssBlock);
                    match p.name.as_str() {
                        "fl-center" if p.value.is_none() => {
                            ec.line("display: flex;");
                            ec.line("align-items: center;");
                            ec.line("justify-content: center;");
                        }
                        "fl-row" if p.value.is_none() => {
                            ec.line("display: flex;");
                            ec.line("flex-direction: row;");
                        }
                        "fl-col" if p.value.is_none() => {
                            ec.line("display: flex;");
                            ec.line("flex-direction: column;");
                        }
                        other => {
                            let prop = expand_css_prop(other);
                            let val = p.value.as_deref().unwrap_or("");
                            ec.line(&format!("{prop}: {val};"));
                        }
                    }
                }
                tasks.push(COp::Close);
                for ch in st.children.iter().rev() { tasks.push(COp::Rule(ch)); }
            }
        }
    }
}

fn expand_css_prop(p: &str) -> &str {
    match p {
        "bg" => "background-color",
        "disp" => "display",
        "p" => "padding",
        "m" => "margin",
        "c" => "color",
        "fz" => "font-size",
        "b" => "border",
        "rad" => "border-radius",
        other => other,
    }
}
