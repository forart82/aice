use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::csharp;
use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_text};
use crate::decompile::java_lang;
use crate::decompile::trivia::is_comment_kind;
use crate::ir::{AiceModule, TranspileError, TranspileOpts};
use crate::ir_types::TypeParam;

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    match tree.language() {
        LanguageId::CSharp => csharp::decompile(tree, src, opts),
        _ => java_lang::decompile(tree, src, opts),
    }
}

pub(crate) fn extract_java_type_params(node: Node<'_>, src: &str) -> Vec<TypeParam> {
    let Some(tps) = node.child_by_field_name("type_parameters").or_else(|| child_by_kind(node, "type_parameters")) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for ch in named_children(tps) {
        if ch.kind() != "type_parameter" { continue; }
        let name = child_by_kind(ch, "type_identifier")
            .or_else(|| child_by_kind(ch, "identifier"))
            .map(|n| node_text(n, src).trim().to_string())
            .unwrap_or_else(|| node_text(ch, src).split_whitespace().next().unwrap_or("T").to_string());
        let mut bounds = Vec::new();
        if let Some(tb) = child_by_kind(ch, "type_bound") {
            for b in named_children(tb) {
                if !is_comment_kind(b.kind()) {
                    let txt = node_text(b, src).trim();
                    if !txt.is_empty() {
                        bounds.push(map_type_str(txt, LanguageId::Java));
                    }
                }
            }
        }
        if !name.is_empty() {
            out.push(TypeParam { name, bounds, default: None });
        }
    }
    out
}

pub(crate) fn extract_cs_type_params(node: Node<'_>, src: &str) -> Vec<TypeParam> {
    let Some(tps) = node.child_by_field_name("type_parameters").or_else(|| child_by_kind(node, "type_parameter_list")) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for ch in named_children(tps) {
        if ch.kind() != "type_parameter" { continue; }
        let name = field_text(ch, "name", src)
            .or_else(|| child_by_kind(ch, "identifier").map(|n| node_text(n, src)))
            .unwrap_or("T")
            .trim()
            .to_string();
        if !name.is_empty() {
            out.push(TypeParam { name, bounds: Vec::new(), default: None });
        }
    }
    for cl in named_children(node) {
        if cl.kind() != "type_parameter_constraints_clause" { continue; }
        let target = field_text(cl, "target", src)
            .or_else(|| child_by_kind(cl, "identifier").map(|n| node_text(n, src)))
            .unwrap_or("")
            .trim();
        let Some(tp) = out.iter_mut().find(|tp| tp.name == target) else { continue; };
        for c in named_children(cl) {
            if c.kind() == "type_parameter_constraint" {
                let txt = node_text(c, src).trim();
                if !txt.is_empty() {
                    tp.bounds.push(map_type_str(txt, LanguageId::CSharp));
                }
            }
        }
    }
    out
}

pub(crate) fn java_has_mod(node: Node<'_>, src: &str, kw: &str) -> bool {
    let Some(mods) = child_by_kind(node, "modifiers") else { return false; };
    let mut cur = mods.walk();
    mods.children(&mut cur).any(|c| !c.is_named() && node_text(c, src).trim() == kw)
}

fn collect_java_type_list(container: Node<'_>, src: &str) -> Vec<String> {
    let list = child_by_kind(container, "type_list").unwrap_or(container);
    named_children(list)
        .into_iter()
        .filter(|c| !is_comment_kind(c.kind()))
        .map(|c| node_text(c, src).trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

pub(crate) fn extract_java_heritage(node: Node<'_>, src: &str) -> (Option<String>, Vec<String>) {
    let extends = node
        .child_by_field_name("superclass")
        .or_else(|| child_by_kind(node, "superclass"))
        .and_then(|sc| {
            named_children(sc)
                .into_iter()
                .find(|c| !is_comment_kind(c.kind()))
                .map(|t| node_text(t, src).trim().to_string())
        })
        .filter(|s| !s.is_empty());
    let implements = node
        .child_by_field_name("interfaces")
        .or_else(|| child_by_kind(node, "super_interfaces"))
        .map(|si| collect_java_type_list(si, src))
        .unwrap_or_default();
    (extends, implements)
}

pub(crate) fn extract_java_iface_extends(node: Node<'_>, src: &str) -> Vec<String> {
    child_by_kind(node, "extends_interfaces")
        .map(|ei| collect_java_type_list(ei, src))
        .unwrap_or_default()
}

pub(crate) fn java_body_has_unhandled(body: Node<'_>) -> bool {
    named_children(body).into_iter().any(|ch| {
        !is_comment_kind(ch.kind())
            && !matches!(
                ch.kind(),
                "static_initializer" | "field_declaration" | "method_declaration"
                    | "constructor_declaration" | "record_declaration" | "class_declaration"
                    | "interface_declaration" | "enum_declaration"
            )
    })
}

pub(crate) fn cs_has_mod(node: Node<'_>, src: &str, kw: &str) -> bool {
    named_children(node)
        .into_iter()
        .any(|c| c.kind() == "modifier" && node_text(c, src).trim() == kw)
}

pub(crate) fn extract_cs_base_list(node: Node<'_>, src: &str) -> Vec<String> {
    let Some(bl) = child_by_kind(node, "base_list") else { return Vec::new(); };
    let mut out = Vec::new();
    for ch in named_children(bl) {
        if is_comment_kind(ch.kind()) || ch.kind() == "argument_list" { continue; }
        let txt = node_text(ch, src).trim();
        if !txt.is_empty() && !txt.contains('(') {
            out.push(txt.to_string());
        }
    }
    out
}
