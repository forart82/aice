use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, named_children, node_span, node_text, strip_quotes, with_ts_root};
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::ir::{AiceItem, AiceModule, ImportDecl, Span, TranspileError, TranspileOpts, Trivia, Visibility};
use crate::ir_code::{Expr, LiteralVal};
use crate::ir_domain::{ComponentDecl, LayoutAttr, LayoutNode, StyleDecl, StyleProp};

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    let lang = tree.language();
    with_ts_root(tree, |root| match lang {
        LanguageId::Html => decompile_html(root, src, opts),
        _ => decompile_css(root, src, opts),
    })
}

fn decompile_html(root: Node<'_>, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    let mut m = AiceModule::new(LanguageId::Html, "html");
    let mut has_doctype = false;
    let mut layout = Vec::new();
    for ch in named_children(root) {
        if is_comment_kind(ch.kind()) { continue; }
        match ch.kind() {
            "doctype" => has_doctype = true,
            "element" | "script_element" | "style_element" => layout.push(decompile_html_elem(ch, src, opts)),
            _ => {}
        }
    }
    m.items.push(AiceItem::Component(ComponentDecl {
        vis: Visibility::Public, name: "Page".into(), type_params: Vec::new(), params: Vec::new(),
        has_doctype, body_stmts: Vec::new(), layout, trivia: Trivia::default(), span: node_span(root),
    }));
    Ok(m)
}

fn decompile_html_elem(root: Node<'_>, src: &str, opts: &TranspileOpts) -> LayoutNode {
    enum HTask<'a> {
        Enter(Node<'a>),
        Finish { tag: String, attrs: Vec<LayoutAttr>, text: Option<String>, len: usize, trivia: Trivia },
    }
    let mut tasks = vec![HTask::Enter(root)];
    let mut out: Vec<LayoutNode> = Vec::new();
    while let Some(t) = tasks.pop() {
        match t {
            HTask::Enter(node) => {
                let tr = collect_trivia(node, src, opts);
                let tag_n = child_by_kind(node, "start_tag").or_else(|| child_by_kind(node, "self_closing_tag"));
                let tag = tag_n.and_then(|tn| child_by_kind(tn, "tag_name"))
                    .map(|n| node_text(n, src).trim().to_string())
                    .unwrap_or_else(|| "div".into());
                let mut attrs = Vec::new();
                if let Some(tn) = tag_n {
                    for ch in named_children(tn) {
                        if ch.kind() == "attribute" {
                            let k = child_by_kind(ch, "attribute_name").map(|n| node_text(n, src).trim().to_string()).unwrap_or_default();
                            let v = child_by_kind(ch, "quoted_attribute_value")
                                .or_else(|| child_by_kind(ch, "attribute_value"))
                                .map(|n| Expr::Literal(LiteralVal::Str { value: strip_quotes(node_text(n, src)), multiline: false }));
                            if !k.is_empty() { attrs.push(LayoutAttr { name: k, value: v }); }
                        }
                    }
                }
                let mut child_elems = Vec::new();
                let mut text = None;
                for ch in named_children(node) {
                    if is_comment_kind(ch.kind()) { continue; }
                    match ch.kind() {
                        "element" | "script_element" | "style_element" => child_elems.push(ch),
                        "text" | "raw_text" => {
                            let txt = node_text(ch, src).trim();
                            if !txt.is_empty() { text = Some(txt.to_string()); }
                        }
                        _ => {}
                    }
                }
                tasks.push(HTask::Finish { tag, attrs, text, len: child_elems.len(), trivia: tr });
                for ch in child_elems.into_iter().rev() { tasks.push(HTask::Enter(ch)); }
            }
            HTask::Finish { tag, attrs, text, len, trivia } => {
                let children = out.split_off(out.len() - len);
                out.push(LayoutNode::Element {
                    tag, attrs, text: if children.is_empty() { text } else { None }, child_expr: None, children, trivia,
                });
            }
        }
    }
    out.pop().expect("html elem")
}

fn decompile_css(root: Node<'_>, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    let mut m = AiceModule::new(LanguageId::Css, "css");
    for ch in named_children(root) {
        if is_comment_kind(ch.kind()) { continue; }
        let tr = collect_trivia(ch, src, opts);
        match ch.kind() {
            "import_statement" => {
                m.items.push(AiceItem::Import(ImportDecl {
                    vis: Visibility::Default, source: strip_quotes(node_text(ch, src).trim_start_matches("@import ").trim_end_matches(';')),
                    specifiers: Vec::new(), is_type_only: false, trivia: tr, span: node_span(ch),
                }));
            }
            "rule_set" => m.items.push(AiceItem::Style(decompile_css_rule(ch, src, opts, tr))),
            _ if is_css_at_block(ch) => m.items.push(AiceItem::Style(decompile_css_rule(ch, src, opts, tr))),
            _ => {}
        }
    }
    Ok(m)
}

fn is_css_at_block(node: Node<'_>) -> bool {
    matches!(
        node.kind(),
        "media_statement" | "supports_statement" | "scope_statement" | "keyframes_statement" | "at_rule"
    ) && child_by_kind(node, "block").or_else(|| child_by_kind(node, "keyframe_block_list")).is_some()
}

fn decompile_css_rule(root: Node<'_>, src: &str, opts: &TranspileOpts, init_tr: Trivia) -> StyleDecl {
    enum CTask<'a> {
        Enter(Node<'a>, Trivia),
        Finish { selector: String, props: Vec<StyleProp>, len: usize, trivia: Trivia, span: Span },
    }
    let mut tasks = vec![CTask::Enter(root, init_tr)];
    let mut out: Vec<StyleDecl> = Vec::new();
    while let Some(t) = tasks.pop() {
        match t {
            CTask::Enter(node, tr) => {
                let selector = if is_css_at_block(node) {
                    node_text(node, src).trim().split('{').next().unwrap_or("@rule").trim().to_string()
                } else {
                    child_by_kind(node, "selectors")
                        .or_else(|| child_by_kind(node, "keyframe_selector"))
                        .map(|s| node_text(s, src).trim().to_string())
                        .or_else(|| {
                            (node.kind() == "keyframe_block")
                                .then(|| node_text(node, src).split('{').next().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))
                                .flatten()
                        })
                        .unwrap_or_else(|| "*".into())
                };
                let mut props = Vec::new();
                let mut child_rules = Vec::new();
                if let Some(blk) = child_by_kind(node, "block").or_else(|| child_by_kind(node, "keyframe_block_list")) {
                    for ch in named_children(blk) {
                        if is_comment_kind(ch.kind()) { continue; }
                        let ptr = collect_trivia(ch, src, opts);
                        if ch.kind() == "declaration" {
                            let raw_prop = child_by_kind(ch, "property_name").map(|n| node_text(n, src).trim()).unwrap_or("");
                            let raw_line = node_text(ch, src).trim().trim_end_matches(';');
                            let val = raw_line.split_once(':').map(|(_, v)| v.trim().to_string()).unwrap_or_default();
                            props.push(StyleProp { name: compress_css_prop(raw_prop).to_string(), value: Some(val), trivia: ptr });
                        } else if matches!(ch.kind(), "rule_set" | "keyframe_block") || is_css_at_block(ch) {
                            child_rules.push((ch, ptr));
                        }
                    }
                }
                tasks.push(CTask::Finish { selector, props, len: child_rules.len(), trivia: tr, span: node_span(node) });
                for (ch, ptr) in child_rules.into_iter().rev() { tasks.push(CTask::Enter(ch, ptr)); }
            }
            CTask::Finish { selector, props, len, trivia, span } => {
                let children = out.split_off(out.len() - len);
                out.push(StyleDecl { selector, props, children, trivia, span });
            }
        }
    }
    out.pop().expect("css rule")
}

fn compress_css_prop(p: &str) -> &str {
    match p {
        "background-color" => "bg", "display" => "disp", "padding" => "p",
        "margin" => "m", "color" => "c", "font-size" => "fz",
        "border" => "b", "border-radius" => "rad",
        "font-weight" => "fw", "font-family" => "ff",
        "align-items" => "ai", "justify-content" => "jc",
        "flex-direction" => "fd", "flex-shrink" => "fsh",
        "line-height" => "lh", "letter-spacing" => "ls",
        "text-align" => "ta", "text-decoration" => "td", "text-transform" => "tt",
        "white-space" => "ws", "box-sizing" => "bs",
        "max-width" => "mw", "min-width" => "mnw", "max-height" => "mh", "min-height" => "mnh",
        "z-index" => "zi", "list-style" => "lst", "grid-template-columns" => "gtc",
        "border-bottom" => "bb", "border-top" => "bt", "border-left" => "bl",
        "border-right" => "br", "border-collapse" => "bc",
        "margin-top" => "mt", "margin-bottom" => "mb", "margin-left" => "ml", "margin-right" => "mr",
        "padding-top" => "pt", "padding-bottom" => "pb", "padding-left" => "pl", "padding-right" => "pr",
        other => other,
    }
}
