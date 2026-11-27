use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_span, node_text};
use crate::decompile::dart;
use crate::decompile::dart_params::extract_dart_field_init;
use crate::decompile::kotlin;
use crate::decompile::trivia::is_comment_kind;
use crate::decompile::ts_helpers::{normalize_single_line, push_attrs_to_trivia};
use crate::ir::{AiceItem, AiceModule, TranspileError, TranspileOpts, Trivia, Visibility};
use crate::ir_code::{ConstDecl, Expr, PropDecl, VarDecl};
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

pub(crate) fn kt_has_mod(node: Node<'_>, src: &str, kw: &str) -> bool {
    let Some(mods) = child_by_kind(node, "modifiers") else { return false; };
    named_children(mods).into_iter().any(|m| node_text(m, src).trim() == kw)
}

pub(crate) fn kt_param_has_kw(cp: Node<'_>, src: &str, kw: &str) -> bool {
    if child_by_kind(cp, "binding_pattern_kind").is_some_and(|b| node_text(b, src).trim() == kw) {
        return true;
    }
    (0..cp.child_count()).filter_map(|i| cp.child(i)).any(|c| !c.is_named() && c.kind() == kw)
}

pub(crate) fn kt_member_attrs(node: Node<'_>, src: &str) -> Vec<String> {
    let mut attrs = Vec::new();
    for kw in ["override", "open", "abstract", "const"] {
        if kt_has_mod(node, src, kw) {
            attrs.push(format!("@{kw}"));
        }
    }
    attrs
}

pub(crate) fn kt_supertypes(node: Node<'_>, src: &str) -> (Option<String>, Vec<String>) {
    let Some(ds) = child_by_kind(node, "delegation_specifiers") else { return (None, Vec::new()); };
    let mut extends = None;
    let mut implements = Vec::new();
    for ch in named_children(ds) {
        if is_comment_kind(ch.kind()) { continue; }
        let ctor = if ch.kind() == "constructor_invocation" { Some(ch) } else { child_by_kind(ch, "constructor_invocation") };
        if let Some(ci) = ctor {
            let txt = normalize_single_line(node_text(ci, src));
            if !txt.is_empty() {
                if extends.is_none() { extends = Some(txt); } else { implements.push(txt); }
            }
            continue;
        }
        let ut = if ch.kind() == "user_type" { Some(ch) } else { child_by_kind(ch, "user_type") };
        if let Some(tn) = ut {
            let txt = normalize_single_line(node_text(tn, src));
            if !txt.is_empty() { implements.push(txt); }
        }
    }
    (extends, implements)
}

pub(crate) fn decompile_kt_enum_entry(node: Node<'_>, enum_name: &str, src: &str, mut tr: Trivia) -> PropDecl {
    let name = child_by_kind(node, "identifier")
        .or_else(|| child_by_kind(node, "simple_identifier"))
        .map(|n| node_text(n, src).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "V".into());
    push_attrs_to_trivia(&mut tr, vec!["@variant".into()]);
    let vargs = child_by_kind(node, "value_arguments");
    let init = if let Some(cb) = child_by_kind(node, "class_body") {
        let s = vargs.map_or(cb.start_byte(), |va| va.start_byte());
        Some(Expr::Raw(src[s..node.end_byte()].trim().to_string()))
    } else if let Some(va) = vargs {
        let args: Vec<Node<'_>> = named_children(va).into_iter().filter(|c| !is_comment_kind(c.kind())).collect();
        if args.iter().all(|a| a.kind() == "value_argument" && a.named_child_count() == 1) {
            let exprs = args.into_iter().filter_map(|a| named_children(a).into_iter().next())
                .map(|e| crate::decompile::expr_common::decompile_expr(e, src, LanguageId::Kotlin)).collect();
            Some(Expr::Call { callee: Box::new(Expr::Ident(enum_name.into())), args: exprs, is_new: false, is_optional: false, is_tagged: false })
        } else {
            Some(Expr::Raw(node_text(va, src).trim().to_string()))
        }
    } else {
        None
    };
    PropDecl { name, aliases: Vec::new(), vis: Visibility::Default, is_static: false, is_readonly: false, is_mut: false, is_optional: false, ty: None, init, trivia: tr }
}

pub(crate) fn decompile_dart_top_var(node: Node<'_>, src: &str, tr: Trivia, m: &mut AiceModule) {
    let ty = child_by_kind(node, "type")
        .or_else(|| child_by_kind(node, "type_identifier"))
        .or_else(|| child_by_kind(node, "nullable_type"))
        .or_else(|| named_children(node).into_iter().find(|c| c.kind().contains("type")))
        .map(|t| map_type_str(node_text(t, src), LanguageId::Dart));
    let list_node = child_by_kind(node, "initialized_identifier_list")
        .or_else(|| child_by_kind(node, "static_final_declaration_list"));
    let hdr_end = list_node.map_or(node.end_byte(), |l| l.start_byte());
    let hdr = src.get(node.start_byte()..hdr_end).unwrap_or("");
    let is_const = hdr.split_whitespace().any(|w| w == "const");
    let is_final = hdr.split_whitespace().any(|w| w == "final");
    let is_late = hdr.split_whitespace().any(|w| w == "late");
    let ids: Vec<Node<'_>> = list_node.map(named_children).unwrap_or_else(|| vec![node]);
    if is_late || ids.is_empty() {
        m.items.push(AiceItem::Directive { text: node_text(node, src).trim().into(), trivia: tr, span: node_span(node) });
        return;
    }
    let mut emitted = false;
    for id in ids {
        let name = field_text(id, "name", src)
            .or_else(|| child_by_kind(id, "identifier").map(|n| node_text(n, src)))
            .unwrap_or_else(|| node_text(id, src).split('=').next().unwrap_or("v"))
            .trim()
            .to_string();
        let init = id.child_by_field_name("value")
            .map(|v| crate::decompile::expr_common::decompile_expr(v, src, LanguageId::Dart))
            .or_else(|| extract_dart_field_init(id, src));
        let Some(value) = init else {
            m.items.push(AiceItem::Directive { text: node_text(node, src).trim().into(), trivia: tr, span: node_span(node) });
            return;
        };
        let vis = if name.starts_with('_') { Visibility::Private } else { Visibility::Public };
        let item_tr = if emitted { Trivia::default() } else { tr.clone() };
        if is_const {
            m.items.push(AiceItem::Const(ConstDecl { vis, name, ty: ty.clone(), value, trivia: item_tr, span: node_span(id) }));
        } else {
            m.items.push(AiceItem::Var(VarDecl { vis, is_mut: !is_final, name, ty: ty.clone(), value, trivia: item_tr, span: node_span(id) }));
        }
        emitted = true;
    }
}
