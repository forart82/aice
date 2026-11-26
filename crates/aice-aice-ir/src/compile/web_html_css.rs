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
            AiceItem::Import(imp) => {
                ec.emit_trivia(&imp.trivia, CommentStyle::CssBlock);
                let s = imp.source.trim();
                if s.starts_with("url(") || s.starts_with('"') || s.starts_with('\'') {
                    ec.line(&format!("@import {s};"));
                } else {
                    ec.line(&format!("@import \"{s}\";"));
                }
            }
            AiceItem::Directive { text, trivia, .. } => {
                ec.emit_trivia(trivia, CommentStyle::CssBlock);
                let t = text.trim();
                if t.ends_with(';') { ec.line(t); } else { ec.line(&format!("{t};")); }
            }
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

fn fmt_html_attrs(attrs: &[crate::ir_domain::LayoutAttr]) -> String {
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
    attr_s
}

fn can_render_inline(children: &[LayoutNode]) -> bool {
    let mut stack: Vec<&LayoutNode> = children.iter().collect();
    while let Some(n) = stack.pop() {
        match n {
            LayoutNode::Element { children: sub, trivia, .. } if trivia.is_empty() => {
                stack.extend(sub.iter());
            }
            _ => return false,
        }
    }
    true
}

fn render_html_inline(children: &[LayoutNode]) -> String {
    enum IOp<'a> { Node(&'a LayoutNode), Close(String) }
    let mut out = String::new();
    let mut tasks: Vec<IOp<'_>> = children.iter().rev().map(IOp::Node).collect();
    while let Some(op) = tasks.pop() {
        match op {
            IOp::Close(s) => out.push_str(&s),
            IOp::Node(LayoutNode::Element { tag, attrs, text, children: sub, .. }) => {
                if tag == "#text" {
                    if let Some(t) = text { out.push_str(t); }
                    continue;
                }
                let attr_s = fmt_html_attrs(attrs);
                if VOID_TAGS.contains(&tag.as_str()) {
                    out.push_str(&format!("<{tag}{attr_s} />"));
                } else if let Some(t) = text {
                    out.push_str(&format!("<{tag}{attr_s}>{t}</{tag}>"));
                } else if sub.is_empty() {
                    out.push_str(&format!("<{tag}{attr_s}></{tag}>"));
                } else {
                    out.push_str(&format!("<{tag}{attr_s}>"));
                    tasks.push(IOp::Close(format!("</{tag}>")));
                    for ch in sub.iter().rev() { tasks.push(IOp::Node(ch)); }
                }
            }
            IOp::Node(_) => {}
        }
    }
    out
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
                    if tag == "#text" {
                        if let Some(t) = text { ec.line(t); }
                        continue;
                    }
                    let attr_s = fmt_html_attrs(attrs);
                    if VOID_TAGS.contains(&tag.as_str()) {
                        ec.line(&format!("<{tag}{attr_s} />"));
                    } else if let Some(t) = text {
                        ec.line(&format!("<{tag}{attr_s}>{t}</{tag}>"));
                    } else if children.is_empty() {
                        ec.line(&format!("<{tag}{attr_s}></{tag}>"));
                    } else if children.iter().any(|c| matches!(c, LayoutNode::Element { tag, .. } if tag == "#text"))
                        && can_render_inline(children)
                    {
                        let inner = render_html_inline(children);
                        ec.line(&format!("<{tag}{attr_s}>{inner}</{tag}>"));
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
                        other if p.value.is_none() && other.starts_with('@') => {
                            let t = other.trim();
                            if t.ends_with(';') { ec.line(t); } else { ec.line(&format!("{t};")); }
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
        "bg" => "background-color", "disp" => "display", "p" => "padding",
        "m" => "margin", "c" => "color", "fz" => "font-size",
        "b" => "border", "rad" => "border-radius",
        "fw" => "font-weight", "ff" => "font-family",
        "ai" => "align-items", "jc" => "justify-content",
        "fd" => "flex-direction", "fsh" => "flex-shrink",
        "lh" => "line-height", "ls" => "letter-spacing",
        "ta" => "text-align", "td" => "text-decoration", "tt" => "text-transform",
        "ws" => "white-space", "bs" => "box-sizing",
        "mw" => "max-width", "mnw" => "min-width", "mh" => "max-height", "mnh" => "min-height",
        "zi" => "z-index", "lst" => "list-style", "gtc" => "grid-template-columns",
        "bb" => "border-bottom", "bt" => "border-top", "bl" => "border-left",
        "br" => "border-right", "bc" => "border-collapse",
        "mt" => "margin-top", "mb" => "margin-bottom", "ml" => "margin-left", "mr" => "margin-right",
        "pt" => "padding-top", "pb" => "padding-bottom", "pl" => "padding-left", "pr" => "padding-right",
        other => other,
    }
}
