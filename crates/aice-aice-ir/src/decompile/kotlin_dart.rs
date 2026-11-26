use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_text};
use crate::decompile::dart;
use crate::decompile::kotlin;
use crate::decompile::trivia::is_comment_kind;
use crate::ir::{AiceModule, TranspileError, TranspileOpts};
use crate::ir_types::{AiceType, PrimitiveType, TypeParam};

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    match tree.language() {
        LanguageId::Kotlin => kotlin::decompile(tree, src, opts),
        _ => dart::decompile(tree, src, opts),
    }
}

fn is_kt_type_kind(k: &str) -> bool {
    matches!(k, "type" | "user_type" | "nullable_type" | "function_type" | "parenthesized_type")
}

pub(crate) fn kt_type_node(node: Node<'_>, src: &str) -> Option<AiceType> {
    named_children(node)
        .into_iter()
        .find(|c| is_kt_type_kind(c.kind()))
        .map(|t| map_kt_type_node(t, src))
}

pub(crate) fn kt_return_type(node: Node<'_>, src: &str) -> Option<AiceType> {
    let cut = child_by_kind(node, "function_value_parameters").map(|p| p.end_byte()).unwrap_or(0);
    named_children(node)
        .into_iter()
        .find(|c| c.start_byte() >= cut && is_kt_type_kind(c.kind()))
        .map(|t| map_kt_type_node(t, src))
}

pub(crate) fn map_kt_type_node(t: Node<'_>, src: &str) -> AiceType {
    match t.kind() {
        "parenthesized_type" => named_children(t)
            .into_iter()
            .find(|c| !is_comment_kind(c.kind()))
            .map(|inner| map_kt_type_node(inner, src))
            .unwrap_or_else(|| map_type_str(node_text(t, src), LanguageId::Kotlin)),
        "nullable_type" => named_children(t)
            .into_iter()
            .find(|c| !is_comment_kind(c.kind()))
            .map(|inner| AiceType::Option(Box::new(map_kt_type_node(inner, src))))
            .unwrap_or_else(|| map_type_str(node_text(t, src), LanguageId::Kotlin)),
        "function_type" => {
            let Some(pl) = child_by_kind(t, "function_type_parameters") else {
                return AiceType::Raw(node_text(t, src).trim().to_string());
            };
            if named_children(t)
                .into_iter()
                .any(|c| c.end_byte() <= pl.start_byte() && !is_comment_kind(c.kind()))
            {
                return AiceType::Raw(node_text(t, src).trim().to_string());
            }
            let mut params = Vec::new();
            for p in named_children(pl) {
                if is_comment_kind(p.kind()) { continue; }
                if p.kind() == "parameter" {
                    if let Some(ty) = kt_type_node(p, src) { params.push(ty); }
                } else {
                    params.push(map_kt_type_node(p, src));
                }
            }
            let ret = named_children(t)
                .into_iter()
                .find(|c| c.start_byte() >= pl.end_byte() && is_kt_type_kind(c.kind()))
                .map(|r| map_kt_type_node(r, src))
                .unwrap_or(AiceType::Primitive(PrimitiveType::Void));
            AiceType::Fn { params, ret: Box::new(ret) }
        }
        "type" => {
            if let Some(inner) = named_children(t).into_iter().find(|c| matches!(c.kind(), "function_type" | "nullable_type" | "parenthesized_type")) {
                return map_kt_type_node(inner, src);
            }
            map_type_str(node_text(t, src), LanguageId::Kotlin)
        }
        _ => map_type_str(node_text(t, src), LanguageId::Kotlin),
    }
}

pub(crate) fn extract_kt_type_params(node: Node<'_>, src: &str) -> Vec<TypeParam> {
    let Some(tps) = child_by_kind(node, "type_parameters") else { return Vec::new(); };
    let mut out = Vec::new();
    for ch in named_children(tps) {
        if ch.kind() != "type_parameter" { continue; }
        let name = child_by_kind(ch, "type_identifier")
            .or_else(|| child_by_kind(ch, "identifier"))
            .or_else(|| child_by_kind(ch, "simple_identifier"))
            .map(|n| node_text(n, src).trim().to_string())
            .unwrap_or_default();
        if name.is_empty() { continue; }
        let bounds = kt_type_node(ch, src).into_iter().collect();
        out.push(TypeParam { name, bounds, default: None });
    }
    if let Some(tcs) = child_by_kind(node, "type_constraints") {
        for tc in named_children(tcs) {
            if tc.kind() != "type_constraint" { continue; }
            let target = child_by_kind(tc, "identifier")
                .or_else(|| child_by_kind(tc, "simple_identifier"))
                .or_else(|| child_by_kind(tc, "type_identifier"))
                .map(|n| node_text(n, src).trim().to_string())
                .unwrap_or_default();
            if let Some(bound) = kt_type_node(tc, src)
                && let Some(tp) = out.iter_mut().find(|tp| tp.name == target)
            {
                tp.bounds.push(bound);
            }
        }
    }
    out
}

pub(crate) fn extract_dart_type_params(node: Node<'_>, src: &str) -> Vec<TypeParam> {
    let Some(tps) = node.child_by_field_name("type_parameters").or_else(|| child_by_kind(node, "type_parameters")) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for ch in named_children(tps) {
        if ch.kind() != "type_parameter" { continue; }
        let name = field_text(ch, "name", src)
            .or_else(|| child_by_kind(ch, "type_identifier").map(|n| node_text(n, src)))
            .unwrap_or("T")
            .trim()
            .to_string();
        let bounds = ch.child_by_field_name("bound")
            .or_else(|| child_by_kind(ch, "type"))
            .map(|b| vec![map_type_str(node_text(b, src), LanguageId::Dart)])
            .unwrap_or_default();
        if !name.is_empty() {
            out.push(TypeParam { name, bounds, default: None });
        }
    }
    out
}

pub(crate) fn is_simple_type_path(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.')
}

pub(crate) fn extract_dart_heritage(node: Node<'_>, src: &str) -> (Option<String>, Vec<String>, Vec<String>) {
    let mut extends = None;
    let mut implements = Vec::new();
    let mut decs = Vec::new();
    let mut mixins = Vec::new();
    if let Some(sc) = node.child_by_field_name("superclass").or_else(|| child_by_kind(node, "superclass")) {
        if let Some(t) = sc.child_by_field_name("type").or_else(|| child_by_kind(sc, "type")) {
            let txt = node_text(t, src).trim();
            if is_simple_type_path(txt) { extends = Some(txt.to_string()); }
            else if !txt.is_empty() { decs.push(format!("extends({txt})")); }
        }
        if let Some(mx) = child_by_kind(sc, "mixins") {
            for t in named_children(mx) {
                let txt = node_text(t, src).trim();
                if !txt.is_empty() { mixins.push(txt.to_string()); }
            }
        }
    }
    if let Some(mx) = child_by_kind(node, "mixins") {
        for t in named_children(mx) {
            let txt = node_text(t, src).trim();
            if !txt.is_empty() { mixins.push(txt.to_string()); }
        }
    }
    if !mixins.is_empty() {
        decs.push(format!("with({})", mixins.join(", ")));
    }
    if let Some(ifaces) = node.child_by_field_name("interfaces").or_else(|| child_by_kind(node, "interfaces")) {
        let mut raw_imps = Vec::new();
        for t in named_children(ifaces) {
            let txt = node_text(t, src).trim();
            if is_simple_type_path(txt) { implements.push(txt.to_string()); }
            else if !txt.is_empty() { raw_imps.push(txt.to_string()); }
        }
        if !raw_imps.is_empty() {
            decs.push(format!("implements({})", raw_imps.join(", ")));
        }
    }
    (extends, implements, decs)
}
