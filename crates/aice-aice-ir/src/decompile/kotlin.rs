use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_span, node_text, with_ts_root};
use crate::decompile::stmt_common::decompile_block;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::ir::{AiceItem, AiceModule, ImportDecl, TranspileError, TranspileOpts, Trivia, Visibility};
use crate::ir_code::{ClassDecl, FnBody, FnDecl, MethodDecl, PropDecl};
use crate::ir_types::ParamDecl;

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    with_ts_root(tree, |root| {
        let mut m = AiceModule::new(LanguageId::Kotlin, "kotlin");
        for ch in named_children(root) {
            if is_comment_kind(ch.kind()) { continue; }
            let tr = collect_trivia(ch, src, opts);
            match ch.kind() {
                "package_header" => {
                    let pkg = node_text(ch, src).trim().trim_start_matches("package ").trim().to_string();
                    m.module_name = pkg;
                }
                "import" | "import_header" => {
                    let imp = node_text(ch, src).trim().trim_start_matches("import ").trim().to_string();
                    m.items.push(AiceItem::Import(ImportDecl {
                        vis: Visibility::Default, source: imp, specifiers: Vec::new(),
                        is_type_only: false, trivia: tr, span: node_span(ch),
                    }));
                }
                "class_declaration" | "object_declaration" => {
                    m.items.push(AiceItem::Class(decompile_kt_class(ch, src, opts, tr)));
                }
                "function_declaration" => m.items.push(AiceItem::Fn(decompile_kt_fn(ch, src, opts, tr))),
                _ => {}
            }
        }
        Ok(m)
    })
}

fn decompile_kt_class(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> ClassDecl {
    let name = field_text(node, "name", src)
        .or_else(|| child_by_kind(node, "type_identifier").map(|n| node_text(n, src)))
        .or_else(|| child_by_kind(node, "simple_identifier").map(|n| node_text(n, src)))
        .unwrap_or("Class")
        .trim()
        .to_string();
    let raw = node_text(node, src);
    let mut decorators = Vec::new();
    if raw.trim_start().starts_with("data ") { decorators.push("data".into()); }
    let mut primary_ctor = Vec::new();
    let mut props = Vec::new();
    if let Some(ctor) = child_by_kind(node, "primary_constructor") {
        let param_container = child_by_kind(ctor, "class_parameters").unwrap_or(ctor);
        for cp in named_children(param_container) {
            if cp.kind() == "class_parameter" {
                let c_raw = node_text(cp, src);
                let pvis = kt_vis(cp, src);
                let is_ro = c_raw.contains("val ");
                let pnm = child_by_kind(cp, "identifier")
                    .or_else(|| child_by_kind(cp, "simple_identifier"))
                    .map(|n| node_text(n, src).trim().to_string())
                    .unwrap_or_else(|| "p".into());
                let ty = child_by_kind(cp, "type")
                    .or_else(|| child_by_kind(cp, "user_type"))
                    .map(|t| map_type_str(node_text(t, src), LanguageId::Kotlin));
                primary_ctor.push(ParamDecl {
                    name: pnm.clone(), vis: pvis, is_readonly: is_ro, is_mut: !is_ro,
                    is_optional: false, is_rest: false, ty: ty.clone(), default: None, trivia: Trivia::default(),
                });
                if c_raw.contains("val ") || c_raw.contains("var ") {
                    props.push(PropDecl {
                        name: pnm, aliases: Vec::new(), vis: pvis, is_static: false, is_readonly: is_ro,
                        is_mut: !is_ro, is_optional: false, ty, init: None, trivia: Trivia::default(),
                    });
                }
            }
        }
    }
    let mut methods = Vec::new();
    if let Some(body) = child_by_kind(node, "class_body") {
        for ch in named_children(body) {
            if ch.kind() == "function_declaration" {
                let mtr = collect_trivia(ch, src, opts);
                let f = decompile_kt_fn(ch, src, opts, mtr);
                methods.push(MethodDecl {
                    vis: f.vis, is_static: false, is_async: f.is_async, is_const: false,
                    accessor: Default::default(), name: f.name, type_params: Vec::new(),
                    params: f.params, return_type: f.return_type, body: f.body, trivia: f.trivia, span: f.span,
                });
            }
        }
    }
    ClassDecl {
        vis: kt_vis(node, src), is_abstract: false, decorators, name, type_params: Vec::new(),
        primary_ctor, extends: None, implements: Vec::new(), props, methods,
        static_blocks: Vec::new(), trivia: tr, span: node_span(node),
    }
}

fn decompile_kt_fn(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> FnDecl {
    let name = field_text(node, "name", src)
        .or_else(|| child_by_kind(node, "identifier").map(|n| node_text(n, src)))
        .or_else(|| child_by_kind(node, "simple_identifier").map(|n| node_text(n, src)))
        .unwrap_or("fn_anon")
        .trim()
        .to_string();
    let mut params = Vec::new();
    if let Some(pl) = child_by_kind(node, "function_value_parameters") {
        for p in named_children(pl) {
            if p.kind() == "parameter" {
                let pnm = child_by_kind(p, "identifier")
                    .or_else(|| child_by_kind(p, "simple_identifier"))
                    .map(|n| node_text(n, src).trim().to_string())
                    .unwrap_or_else(|| "p".into());
                let ty = child_by_kind(p, "type")
                    .or_else(|| child_by_kind(p, "user_type"))
                    .map(|t| map_type_str(node_text(t, src), LanguageId::Kotlin));
                params.push(ParamDecl {
                    name: pnm, vis: Visibility::Default, is_readonly: false, is_mut: false,
                    is_optional: false, is_rest: false, ty, default: None, trivia: Trivia::default(),
                });
            }
        }
    }
    let return_type = child_by_kind(node, "type")
        .or_else(|| child_by_kind(node, "user_type"))
        .map(|t| map_type_str(node_text(t, src), LanguageId::Kotlin));
    let body = child_by_kind(node, "function_body")
        .map(|fb| {
            if let Some(b) = child_by_kind(fb, "block").or_else(|| child_by_kind(fb, "statements")) {
                FnBody::Block(decompile_block(b, src, LanguageId::Kotlin, opts))
            } else if fb.named_child_count() == 1
                && let Some(ch) = named_children(fb).into_iter().next()
            {
                FnBody::Expr(crate::decompile::expr_common::decompile_expr(ch, src, LanguageId::Kotlin))
            } else {
                FnBody::Block(decompile_block(fb, src, LanguageId::Kotlin, opts))
            }
        })
        .unwrap_or(FnBody::SignatureOnly);
    FnDecl {
        vis: kt_vis(node, src), is_async: node_text(node, src).contains("suspend "), is_static: false,
        decorators: Vec::new(), name, type_params: Vec::new(), params, return_type, body, trivia: tr, span: node_span(node),
    }
}

fn kt_vis(node: Node<'_>, src: &str) -> Visibility {
    if let Some(mods) = child_by_kind(node, "modifiers") {
        let t = node_text(mods, src);
        if t.contains("private") { return Visibility::Private; }
        if t.contains("protected") { return Visibility::Protected; }
        if t.contains("internal") { return Visibility::Package; }
    }
    Visibility::Public
}
