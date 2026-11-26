use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{field_text, map_type_str, named_children, node_span, node_text};
use crate::decompile::expr_common::decompile_expr;
use crate::decompile::iter_env::{DTask, DecompEnv};
use crate::ir::{TranspileOpts, Trivia};
use crate::ir_domain::ComponentDecl;
use crate::ir_types::{AiceType, ParamDecl, TypeParam};

pub(crate) fn extract_ts_params_with_nodes<'a>(
    param_list: Node<'a>,
    src: &'a str,
    lang: LanguageId,
) -> (Vec<ParamDecl>, Vec<Option<Node<'a>>>) {
    let mut out = Vec::new();
    let mut def_nodes = Vec::new();
    for (idx, ch) in named_children(param_list).into_iter().enumerate() {
        if !matches!(
            ch.kind(),
            "required_parameter" | "optional_parameter" | "identifier" | "object_pattern" | "array_pattern" | "rest_pattern"
        ) {
            continue;
        }
        let raw_txt = node_text(ch, src);
        let is_optional = ch.kind() == "optional_parameter"
            || raw_txt.split(':').next().unwrap_or("").contains('?');
        let pat_node = ch.child_by_field_name("pattern").or_else(|| ch.child_by_field_name("name"));
        let is_destructured = pat_node.is_some_and(|p| matches!(p.kind(), "object_pattern" | "array_pattern"))
            || matches!(ch.kind(), "object_pattern" | "array_pattern");
        let name = if is_destructured {
            if idx == 0 && lang == LanguageId::Tsx { "props".to_string() } else { format!("arg{idx}") }
        } else {
            pat_node.map(|n| node_text(n, src))
                .unwrap_or_else(|| raw_txt.split([':', '=', '?']).next().unwrap_or("p"))
                .trim().trim_start_matches("...").trim().to_string()
        };
        let name = if name.is_empty() || name.starts_with('{') || name.starts_with('[') { format!("arg{idx}") } else { name };
        let ty = ch.child_by_field_name("type").map(|t| map_ts_type_node(t, src, lang));
        def_nodes.push(ch.child_by_field_name("value"));
        out.push(ParamDecl {
            name, vis: Default::default(), is_readonly: raw_txt.trim_start().starts_with("readonly "),
            is_mut: false, is_optional, is_rest: raw_txt.trim_start().starts_with("..."),
            ty, default: None, trivia: Trivia::default(),
        });
    }
    (out, def_nodes)
}

pub(crate) fn extract_ts_params(param_list: Node<'_>, src: &str, lang: LanguageId) -> Vec<ParamDecl> {
    let (mut params, def_nodes) = extract_ts_params_with_nodes(param_list, src, lang);
    for (p, dn) in params.iter_mut().zip(def_nodes) {
        if let Some(v) = dn { p.default = Some(decompile_expr(v, src, lang)); }
    }
    params
}

pub(crate) fn extract_lambda_params<'a>(
    node: Node<'a>,
    src: &'a str,
    lang: LanguageId,
) -> (Vec<ParamDecl>, Vec<Option<Node<'a>>>) {
    let mut params = Vec::new();
    let mut def_nodes = Vec::new();
    if let Some(pn) = node.child_by_field_name("parameters").or_else(|| node.child_by_field_name("parameter")) {
        if pn.kind() == "identifier" {
            params.push(ParamDecl { name: node_text(pn, src).into(), vis: Default::default(), is_readonly: false, is_mut: false, is_optional: false, is_rest: false, ty: None, default: None, trivia: Trivia::default() });
            def_nodes.push(None);
        } else if lang == LanguageId::Dart && pn.kind() == "formal_parameter_list" {
            params = crate::decompile::dart_params::dart_params(pn, src);
            def_nodes.resize(params.len(), None);
        } else if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript) && pn.kind() == "formal_parameters" {
            return extract_ts_params_with_nodes(pn, src, lang);
        } else {
            for c in named_children(pn) {
                let nm = node_text(c, src).trim().to_string();
                if !nm.is_empty() {
                    params.push(ParamDecl { name: nm, vis: Default::default(), is_readonly: false, is_mut: false, is_optional: false, is_rest: false, ty: None, default: None, trivia: Trivia::default() });
                    def_nodes.push(None);
                }
            }
        }
    }
    (params, def_nodes)
}

pub(crate) fn extract_ts_type_params(node: Node<'_>, src: &str, lang: LanguageId) -> Vec<TypeParam> {
    let Some(tps) = node.child_by_field_name("type_parameters") else { return Vec::new(); };
    let mut out = Vec::new();
    for ch in named_children(tps) {
        if ch.kind() != "type_parameter" { continue; }
        let name = field_text(ch, "name", src)
            .unwrap_or_else(|| node_text(ch, src).split([' ', '=', ':']).next().unwrap_or("T")).trim().to_string();
        let bounds = ch.child_by_field_name("constraint")
            .map(|c| vec![map_type_str(node_text(c, src).trim().strip_prefix("extends").unwrap_or(node_text(c, src)).trim(), lang)])
            .unwrap_or_default();
        let default = ch.child_by_field_name("value")
            .map(|v| map_type_str(node_text(v, src).trim().strip_prefix('=').unwrap_or(node_text(v, src)).trim(), lang));
        out.push(TypeParam { name, bounds, default });
    }
    out
}

pub(crate) fn map_ts_type_node(n: Node<'_>, src: &str, lang: LanguageId) -> AiceType {
    map_type_str(node_text(n, src).trim().trim_start_matches(':').trim(), lang)
}

pub(crate) fn try_extract_jsx_component(
    fn_node: Node<'_>,
    name: &str,
    params: Vec<ParamDecl>,
    src: &str,
    lang: LanguageId,
    trivia: Trivia,
) -> Option<ComponentDecl> {
    let body = fn_node.child_by_field_name("body")?;
    let jsx_root = find_returned_jsx_iter(body)?;
    let opts = TranspileOpts::default();
    let mut env = DecompEnv::new(src, lang, &opts);
    env.tasks.push(DTask::JsxNode(jsx_root));
    env.run();
    let ln = env.layouts.pop()?;
    Some(ComponentDecl {
        vis: crate::ir::Visibility::Public,
        name: name.to_string(),
        params,
        has_doctype: false,
        layout: vec![ln],
        trivia,
        span: node_span(fn_node),
    })
}

fn find_returned_jsx_iter(root: Node<'_>) -> Option<Node<'_>> {
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        if matches!(node.kind(), "jsx_element" | "jsx_self_closing_element" | "jsx_fragment") {
            return Some(node);
        }
        for ch in named_children(node).into_iter().rev() {
            if matches!(ch.kind(), "jsx_element" | "jsx_self_closing_element" | "jsx_fragment") {
                return Some(ch);
            }
            if matches!(ch.kind(), "return_statement" | "parenthesized_expression") {
                stack.push(ch);
            }
        }
    }
    None
}
