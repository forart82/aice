use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{field_text, map_type_str, named_children, node_span, node_text};
use crate::decompile::expr_common::decompile_expr;
use crate::decompile::iter_env::{DTask, DecompEnv, flatten_block_children};
use crate::decompile::stmt_common::decompile_stmt_nodes;
use crate::decompile::ts_helpers::{extract_ts_param_vis, is_ts_readonly_prefix};
use crate::ir::{TranspileOpts, Trivia, Visibility};
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
            "required_parameter" | "optional_parameter" | "assignment_pattern"
                | "identifier" | "object_pattern" | "array_pattern" | "rest_pattern"
        ) {
            continue;
        }
        if ch.kind() == "assignment_pattern" {
            let left = ch.child_by_field_name("left").or_else(|| named_children(ch).into_iter().next());
            let right = ch.child_by_field_name("right").or_else(|| named_children(ch).into_iter().nth(1));
            let is_destructured = left.is_some_and(|l| matches!(l.kind(), "object_pattern" | "array_pattern"));
            let is_rest = left.is_some_and(|l| l.kind() == "rest_pattern");
            let name = if is_destructured {
                if idx == 0 && lang == LanguageId::Tsx { "props".to_string() } else { format!("arg{idx}") }
            } else {
                let n = left.map(|l| node_text(l, src)).unwrap_or("p")
                    .trim().trim_start_matches("...").trim().to_string();
                if n.is_empty() || n.starts_with('{') || n.starts_with('[') { format!("arg{idx}") } else { n }
            };
            def_nodes.push(right);
            out.push(ParamDecl {
                name, vis: Visibility::Default, is_readonly: false, is_mut: false,
                is_optional: false, is_rest, ty: None, default: None, trivia: Trivia::default(),
            });
            continue;
        }
        let raw_txt = node_text(ch, src);
        let pat_node = ch.child_by_field_name("pattern").or_else(|| ch.child_by_field_name("name"));
        let is_optional = ch.kind() == "optional_parameter"
            || pat_node.map(|p| {
                let end = ch.child_by_field_name("type")
                    .or_else(|| ch.child_by_field_name("value"))
                    .map(|n| n.start_byte())
                    .unwrap_or(ch.end_byte());
                src.get(p.end_byte()..end).is_some_and(|s| s.contains('?'))
            }).unwrap_or_else(|| raw_txt.split([':', '=']).next().unwrap_or("").contains('?'));
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
        let vis = extract_ts_param_vis(ch, src);
        let is_readonly = is_ts_readonly_prefix(ch, "pattern", src);
        let is_rest = ch.kind() == "rest_pattern"
            || pat_node.is_some_and(|p| p.kind() == "rest_pattern")
            || raw_txt.trim_start().starts_with("...");
        def_nodes.push(ch.child_by_field_name("value"));
        out.push(ParamDecl {
            name, vis, is_readonly, is_mut: false, is_optional, is_rest, ty, default: None, trivia: Trivia::default(),
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
    if lang == LanguageId::CSharp {
        return extract_cs_lambda_params(node, src);
    }
    if lang == LanguageId::Cpp {
        return crate::decompile::ts_helpers::extract_cpp_lambda_params(node, src);
    }
    let mut params = Vec::new();
    let mut def_nodes = Vec::new();
    if let Some(pn) = node.child_by_field_name("parameters").or_else(|| node.child_by_field_name("parameter")) {
        if pn.kind() == "identifier" {
            params.push(ParamDecl { name: node_text(pn, src).into(), vis: Default::default(), is_readonly: false, is_mut: false, is_optional: false, is_rest: false, ty: None, default: None, trivia: Trivia::default() });
            def_nodes.push(None);
        } else if lang == LanguageId::Rust && pn.kind() == "closure_parameters" {
            return crate::decompile::ts_helpers::extract_rust_closure_params(pn, src);
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

fn extract_cs_lambda_params<'a>(node: Node<'a>, src: &'a str) -> (Vec<ParamDecl>, Vec<Option<Node<'a>>>) {
    let mut params = Vec::new();
    let mut def_nodes = Vec::new();
    let body_id = node.child_by_field_name("body").map(|b| b.id());
    let pn = node.child_by_field_name("parameters")
        .or_else(|| node.child_by_field_name("parameter"))
        .or_else(|| crate::decompile::cst_util::child_by_kind(node, "parameter_list"))
        .or_else(|| crate::decompile::cst_util::child_by_kind(node, "implicit_parameter"))
        .or_else(|| {
            named_children(node).into_iter().find(|c| {
                Some(c.id()) != body_id
                    && matches!(c.kind(), "identifier" | "implicit_parameter" | "parameter_list")
            })
        });
    let Some(pn) = pn else { return (params, def_nodes); };
    if pn.kind() == "parameter_list" {
        for c in named_children(pn) {
            if c.kind() == "parameter" {
                let name = field_text(c, "name", src)
                    .or_else(|| crate::decompile::cst_util::child_by_kind(c, "identifier").map(|n| node_text(n, src)))
                    .unwrap_or_else(|| node_text(c, src))
                    .trim().to_string();
                if name.is_empty() { continue; }
                let ty = field_text(c, "type", src).map(|t| map_type_str(t, LanguageId::CSharp));
                let def = crate::decompile::cst_util::child_by_kind(c, "equals_value_clause")
                    .and_then(|eq| named_children(eq).into_iter().next());
                params.push(ParamDecl { name, vis: Default::default(), is_readonly: false, is_mut: false, is_optional: false, is_rest: false, ty, default: None, trivia: Trivia::default() });
                def_nodes.push(def);
            } else {
                let nm = node_text(c, src).trim().to_string();
                if !nm.is_empty() {
                    params.push(ParamDecl { name: nm, vis: Default::default(), is_readonly: false, is_mut: false, is_optional: false, is_rest: false, ty: None, default: None, trivia: Trivia::default() });
                    def_nodes.push(None);
                }
            }
        }
    } else {
        let nm = node_text(pn, src).trim().to_string();
        if !nm.is_empty() {
            params.push(ParamDecl { name: nm, vis: Default::default(), is_readonly: false, is_mut: false, is_optional: false, is_rest: false, ty: None, default: None, trivia: Trivia::default() });
            def_nodes.push(None);
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

#[allow(clippy::too_many_arguments)]
pub(crate) fn try_extract_jsx_component(
    fn_node: Node<'_>,
    vis: Visibility,
    name: &str,
    type_params: Vec<TypeParam>,
    params: Vec<ParamDecl>,
    src: &str,
    lang: LanguageId,
    opts: &TranspileOpts,
    trivia: Trivia,
) -> Option<ComponentDecl> {
    let body = fn_node.child_by_field_name("body")?;
    let (body_stmts, jsx_root) = if body.kind() == "statement_block" {
        let kids = flatten_block_children(body);
        let (ret_idx, jsx_node) = kids.iter().enumerate().rev().find_map(|(i, n)| {
            if n.kind() == "return_statement" {
                unwrap_returned_jsx(*n).map(|j| (i, j))
            } else {
                None
            }
        })?;
        let pre: Vec<Node<'_>> = kids.into_iter().enumerate()
            .filter(|(i, _)| *i != ret_idx)
            .map(|(_, n)| n)
            .collect();
        let stmts = if pre.is_empty() { Vec::new() } else { decompile_stmt_nodes(pre, src, lang, opts) };
        (stmts, jsx_node)
    } else {
        (Vec::new(), unwrap_returned_jsx(body)?)
    };
    let mut env = DecompEnv::new(src, lang, opts);
    env.tasks.push(DTask::JsxNode(jsx_root));
    env.run();
    let ln = env.layouts.pop()?;
    Some(ComponentDecl {
        vis, name: name.to_string(), type_params, params, has_doctype: false,
        body_stmts, layout: vec![ln], trivia, span: node_span(fn_node),
    })
}

fn unwrap_returned_jsx(node: Node<'_>) -> Option<Node<'_>> {
    let mut cur = if node.kind() == "return_statement" {
        named_children(node).into_iter().next()?
    } else {
        node
    };
    while cur.kind() == "parenthesized_expression" {
        cur = named_children(cur).into_iter().next()?;
    }
    matches!(cur.kind(), "jsx_element" | "jsx_self_closing_element" | "jsx_fragment").then_some(cur)
}
