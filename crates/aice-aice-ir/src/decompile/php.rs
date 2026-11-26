use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_span, node_text, with_ts_root};
use crate::decompile::stmt_common::decompile_block;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::ir::{AiceItem, AiceModule, ImportDecl, TranspileError, TranspileOpts, Trivia, Visibility};
use crate::ir_code::{AccessorKind, ClassDecl, FnBody, FnDecl, MethodDecl, PropDecl};
use crate::ir_types::ParamDecl;

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    with_ts_root(tree, |root| {
        let mut m = AiceModule::new(LanguageId::Php, "php");
        for ch in named_children(root) {
            if is_comment_kind(ch.kind()) { continue; }
            let tr = collect_trivia(ch, src, opts);
            match ch.kind() {
                "php_tag" => {}
                "declare_statement" => {
                    m.items.push(AiceItem::Directive { text: node_text(ch, src).trim().into(), trivia: tr, span: node_span(ch) });
                }
                "namespace_definition" => {
                    if let Some(nm) = field_text(ch, "name", src) {
                        m.module_name = nm.trim().replace('\\', "/");
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
                _ => {}
            }
        }
        Ok(m)
    })
}

fn decompile_php_class(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> ClassDecl {
    let name = field_text(node, "name", src).unwrap_or("Class").to_string();
    let mut props = Vec::new();
    let mut methods = Vec::new();
    if let Some(body) = node.child_by_field_name("body") {
        for ch in named_children(body) {
            if is_comment_kind(ch.kind()) { continue; }
            let mtr = collect_trivia(ch, src, opts);
            let mvis = php_vis(ch, src);
            match ch.kind() {
                "property_declaration" => {
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
        vis: Visibility::Public, is_abstract: false, decorators: Vec::new(), name,
        type_params: Vec::new(), primary_ctor: Vec::new(), extends: None, implements: Vec::new(),
        props, methods, static_blocks: Vec::new(), trivia: tr, span: node_span(node),
    }
}

fn decompile_php_fn(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> FnDecl {
    let name = field_text(node, "name", src).unwrap_or("fn_anon").to_string();
    let mut params = Vec::new();
    if let Some(pl) = node.child_by_field_name("parameters") {
        for ch in named_children(pl) {
            if ch.kind() == "simple_parameter" {
                let pnm = field_text(ch, "name", src).unwrap_or("$p").trim().trim_start_matches('$').to_string();
                let ty = ch.child_by_field_name("type").map(|t| map_type_str(node_text(t, src), LanguageId::Php));
                params.push(ParamDecl {
                    name: pnm, vis: Visibility::Default, is_readonly: false, is_mut: false,
                    is_optional: false, is_rest: false, ty, default: None, trivia: Trivia::default(),
                });
            }
        }
    }
    let return_type = node.child_by_field_name("return_type").map(|t| map_type_str(node_text(t, src), LanguageId::Php));
    let body = node.child_by_field_name("body").map(|b| FnBody::Block(decompile_block(b, src, LanguageId::Php, opts))).unwrap_or(FnBody::SignatureOnly);
    FnDecl {
        vis: php_vis(node, src), is_async: false, is_static: false, decorators: Vec::new(), name,
        type_params: Vec::new(), params, return_type, body, trivia: tr, span: node_span(node),
    }
}

fn php_vis(node: Node<'_>, src: &str) -> Visibility {
    let Some(vm) = child_by_kind(node, "visibility_modifier") else { return Visibility::Public; };
    match node_text(vm, src).trim() {
        "private" => Visibility::Private,
        "protected" => Visibility::Protected,
        _ => Visibility::Public,
    }
}
