use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_span, node_text, with_ts_root};
use crate::decompile::stmt_common::decompile_block;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::decompile::ts_helpers::{normalize_single_line, push_attrs_to_trivia};
use crate::ir::{AiceItem, AiceModule, ImportDecl, TranspileError, TranspileOpts, Trivia, Visibility};
use crate::ir_code::{AccessorKind, ClassDecl, FnBody, FnDecl, MethodDecl, PropDecl};
use crate::ir_types::ParamDecl;

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    with_ts_root(tree, |root| {
        let mut m = AiceModule::new(LanguageId::Php, "php");
        let mut seen_ns = 0usize;
        let mut stack: Vec<Node<'_>> = named_children(root).into_iter().rev().collect();
        while let Some(ch) = stack.pop() {
            if is_comment_kind(ch.kind()) { continue; }
            let tr = collect_trivia(ch, src, opts);
            match ch.kind() {
                "php_tag" | "php_end_tag" => {}
                "declare_statement" => {
                    m.items.push(AiceItem::Directive { text: node_text(ch, src).trim().into(), trivia: tr, span: node_span(ch) });
                }
                "namespace_definition" => {
                    let body = ch
                        .child_by_field_name("body")
                        .or_else(|| child_by_kind(ch, "compound_statement"));
                    let name_node = ch.child_by_field_name("name");
                    let name = name_node
                        .map(|n| node_text(n, src).trim())
                        .filter(|s| !s.is_empty());
                    if let Some(nm) = name {
                        if seen_ns == 0 && m.module_name == "php" {
                            m.module_name = nm.replace('\\', "/");
                        } else {
                            let mut span = node_span(ch);
                            if let Some(b) = body {
                                span.end_byte = name_node
                                    .map(|n| n.end_byte())
                                    .unwrap_or_else(|| b.start_byte())
                                    .min(b.start_byte());
                            }
                            m.items.push(AiceItem::Directive {
                                text: format!("namespace {nm};"),
                                trivia: tr,
                                span,
                            });
                        }
                    }
                    seen_ns += 1;
                    if let Some(body) = body {
                        for item in named_children(body).into_iter().rev() {
                            stack.push(item);
                        }
                    }
                }
                "namespace_use_declaration" => {
                    let s = node_text(ch, src).trim().trim_start_matches("use ").trim_end_matches(';').trim().to_string();
                    m.items.push(AiceItem::Import(ImportDecl {
                        vis: Visibility::Default, source: s, specifiers: Vec::new(),
                        is_type_only: false, trivia: tr, span: node_span(ch),
                    }));
                }
                "class_declaration" | "interface_declaration" | "trait_declaration" => {
                    m.items.push(AiceItem::Class(decompile_php_class(ch, src, opts, tr)));
                }
                "function_definition" => m.items.push(AiceItem::Fn(decompile_php_fn(ch, src, opts, tr))),
                _ => {
                    let txt = node_text(ch, src).trim();
                    if !txt.is_empty() {
                        m.items.push(AiceItem::Directive { text: txt.into(), trivia: tr, span: node_span(ch) });
                    }
                }
            }
        }
        Ok(m)
    })
}

fn decompile_php_class(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> ClassDecl {
    let name = field_text(node, "name", src).unwrap_or("Class").to_string();
    let decorators = extract_php_attrs(node, src);
    let extends = child_by_kind(node, "base_clause")
        .and_then(|bc| named_children(bc).into_iter().next())
        .map(|n| node_text(n, src).trim().to_string())
        .filter(|s| !s.is_empty());
    let implements = child_by_kind(node, "class_interface_clause")
        .map(|ic| {
            named_children(ic).into_iter()
                .map(|n| node_text(n, src).trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();
    let is_abstract = child_by_kind(node, "abstract_modifier").is_some();
    let mut props = Vec::new();
    let mut methods = Vec::new();
    if let Some(body) = node.child_by_field_name("body") {
        for ch in named_children(body) {
            if is_comment_kind(ch.kind()) { continue; }
            let mut mtr = collect_trivia(ch, src, opts);
            let mvis = php_vis(ch, src);
            match ch.kind() {
                "property_declaration" => {
                    push_attrs_to_trivia(&mut mtr, extract_php_attrs(ch, src));
                    let ty = ch.child_by_field_name("type").map(|t| map_type_str(node_text(t, src), LanguageId::Php));
                    for el in named_children(ch) {
                        if el.kind() == "property_element" {
                            let pnm = node_text(el, src).trim().trim_start_matches('$').split('=').next().unwrap_or("p").trim().to_string();
                            props.push(PropDecl {
                                name: pnm, aliases: Vec::new(), vis: mvis, is_static: false, is_readonly: false,
                                is_mut: true, is_optional: false, ty: ty.clone(), init: None, trivia: mtr.clone(),
                            });
                        }
                    }
                }
                "method_declaration" => {
                    push_attrs_to_trivia(&mut mtr, extract_php_attrs(ch, src));
                    let f = decompile_php_fn(ch, src, opts, mtr);
                    let accessor = if f.name == "__construct" { AccessorKind::Constructor } else { AccessorKind::Normal };
                    methods.push(MethodDecl {
                        vis: mvis, is_static: node_text(ch, src).contains("static "), is_async: false,
                        is_const: false, accessor, name: f.name, type_params: Vec::new(),
                        params: f.params, return_type: f.return_type, body: f.body, trivia: f.trivia, span: f.span,
                    });
                }
                _ => {}
            }
        }
    }
    ClassDecl {
        vis: Visibility::Public, is_abstract, decorators, name,
        type_params: Vec::new(), primary_ctor: Vec::new(), extends, implements,
        props, methods, static_blocks: Vec::new(), trivia: tr, span: node_span(node),
    }
}

fn decompile_php_fn(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> FnDecl {
    let name = field_text(node, "name", src).unwrap_or("fn_anon").to_string();
    let decorators = extract_php_attrs(node, src);
    let mut params = Vec::new();
    if let Some(pl) = node.child_by_field_name("parameters") {
        for ch in named_children(pl) {
            if matches!(ch.kind(), "simple_parameter" | "property_promotion_parameter") {
                let pnm = field_text(ch, "name", src).unwrap_or("$p").trim().trim_start_matches('$').to_string();
                let ty = ch.child_by_field_name("type").map(|t| map_type_str(node_text(t, src), LanguageId::Php));
                let default = php_param_default(ch, src);
                let is_ro = child_by_kind(ch, "readonly_modifier").is_some();
                let vis = if ch.kind() == "property_promotion_parameter" { php_vis(ch, src) } else { Visibility::Default };
                params.push(ParamDecl {
                    name: pnm, vis, is_readonly: is_ro, is_mut: false,
                    is_optional: false, is_rest: false, ty, default, trivia: Trivia::default(),
                });
            }
        }
    }
    let return_type = node.child_by_field_name("return_type").map(|t| map_type_str(node_text(t, src), LanguageId::Php));
    let body = node.child_by_field_name("body").map(|b| FnBody::Block(decompile_block(b, src, LanguageId::Php, opts))).unwrap_or(FnBody::SignatureOnly);
    FnDecl {
        vis: php_vis(node, src), is_async: false, is_static: false, decorators, name,
        type_params: Vec::new(), params, return_type, body, trivia: tr, span: node_span(node),
    }
}

fn extract_php_attrs(node: Node<'_>, src: &str) -> Vec<String> {
    let mut out = Vec::new();
    let Some(list) = node.child_by_field_name("attributes").or_else(|| child_by_kind(node, "attribute_list")) else {
        return out;
    };
    for ch in named_children(list) {
        if ch.kind() == "attribute_group" {
            let txt = normalize_single_line(node_text(ch, src));
            if !txt.is_empty() {
                out.push(txt);
            }
        }
    }
    out
}

fn php_param_default(ch: Node<'_>, src: &str) -> Option<crate::ir_code::Expr> {
    let val = ch.child_by_field_name("default_value").or_else(|| {
        let mut seen_eq = false;
        for i in 0..ch.child_count() {
            let Some(c) = ch.child(i) else { continue };
            if !seen_eq {
                if c.kind() == "=" || node_text(c, src).trim() == "=" { seen_eq = true; }
            } else if c.is_named() {
                return Some(c);
            }
        }
        None
    })?;
    Some(crate::decompile::expr_common::decompile_expr(val, src, LanguageId::Php))
}

fn php_vis(node: Node<'_>, src: &str) -> Visibility {
    let Some(vm) = child_by_kind(node, "visibility_modifier") else { return Visibility::Public; };
    match node_text(vm, src).trim() {
        "private" => Visibility::Private,
        "protected" => Visibility::Protected,
        _ => Visibility::Public,
    }
}
