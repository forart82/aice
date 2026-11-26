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
