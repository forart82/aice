use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_span, node_text, strip_quotes, with_ts_root};
use crate::decompile::dart_params::dart_params;
use crate::decompile::stmt_common::decompile_block;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::ir::{AiceItem, AiceModule, ImportDecl, TranspileError, TranspileOpts, Trivia, Visibility};
use crate::ir_code::{AccessorKind, ClassDecl, FnBody, FnDecl, MethodDecl, PropDecl};

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    with_ts_root(tree, |root| {
        let mut m = AiceModule::new(LanguageId::Dart, "dart");
        let children = named_children(root);
        let mut i = 0usize;
        while i < children.len() {
            let ch = children[i];
            if is_comment_kind(ch.kind()) { i += 1; continue; }
            let tr = collect_trivia(ch, src, opts);
            match ch.kind() {
                "import_or_export" => {
                    m.items.push(AiceItem::Import(ImportDecl {
                        vis: Visibility::Default, source: strip_quotes(node_text(ch, src).trim_start_matches("import ").trim_end_matches(';')),
                        specifiers: Vec::new(), is_type_only: false, trivia: tr, span: node_span(ch),
                    }));
                }
                "class_declaration" => m.items.push(AiceItem::Class(decompile_dart_class(ch, src, opts, tr))),
                "method_declaration" => {
                    if let Some(sig) = ch.child_by_field_name("signature").or_else(|| child_by_kind(ch, "method_signature")).or_else(|| child_by_kind(ch, "function_signature")) {
                        let b = ch.child_by_field_name("body").or_else(|| child_by_kind(ch, "function_body"));
                        let inner = child_by_kind(sig, "function_signature").unwrap_or(sig);
                        m.items.push(AiceItem::Fn(decompile_dart_fn_sig(inner, b, src, opts, tr)));
                    }
                }
                "lambda_expression" => {
                    if let Some(sig) = child_by_kind(ch, "function_signature") {
                        let b = child_by_kind(ch, "function_body");
                        m.items.push(AiceItem::Fn(decompile_dart_fn_sig(sig, b, src, opts, tr)));
                    }
                }
                "function_declaration" | "getter_declaration" | "setter_declaration" => {
                    if let Some(sig) = child_by_kind(ch, "function_signature")
                        .or_else(|| child_by_kind(ch, "getter_signature"))
                        .or_else(|| child_by_kind(ch, "setter_signature"))
                    {
                        let b = ch.child_by_field_name("body").or_else(|| child_by_kind(ch, "function_body"));
                        m.items.push(AiceItem::Fn(decompile_dart_fn_sig(sig, b, src, opts, tr)));
                    }
                }
                "function_signature" => {
                    let body_node = children.get(i + 1).filter(|n| n.kind() == "function_body").copied();
                    if body_node.is_some() { i += 1; }
                    m.items.push(AiceItem::Fn(decompile_dart_fn_sig(ch, body_node, src, opts, tr)));
                }
                "declaration" => {
                    if let Some(sig) = child_by_kind(ch, "function_signature") {
                        let body_node = children.get(i + 1).filter(|n| n.kind() == "function_body").copied();
                        if body_node.is_some() { i += 1; }
                        m.items.push(AiceItem::Fn(decompile_dart_fn_sig(sig, body_node, src, opts, tr)));
                    }
                }
                _ => {}
            }
            i += 1;
        }
        Ok(m)
    })
}

fn decompile_dart_class(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> ClassDecl {
    let name = field_text(node, "name", src).unwrap_or("Class").to_string();
    let vis = if name.starts_with('_') { Visibility::Private } else { Visibility::Public };
    let mut props = Vec::new();
    let mut methods = Vec::new();
    if let Some(body) = child_by_kind(node, "class_body") {
        let kids = named_children(body);
        let mut i = 0usize;
        while i < kids.len() {
            let ch = kids[i];
            if is_comment_kind(ch.kind()) { i += 1; continue; }
            let mtr = collect_trivia(ch, src, opts);
            match ch.kind() {
                "member_declaration" => {
                    if let Some(decl) = child_by_kind(ch, "declaration") {
                        extract_dart_member(decl, &name, src, opts, mtr, (&mut props, &mut methods));
                    } else if let Some(md) = child_by_kind(ch, "method_declaration") {
                        let sig = md.child_by_field_name("signature")
                            .or_else(|| child_by_kind(md, "method_signature"))
                            .or_else(|| child_by_kind(md, "function_signature"));
                        let b = md.child_by_field_name("body").or_else(|| child_by_kind(md, "function_body"));
                        if let Some(sig) = sig {
                            extract_dart_sig(sig, b, &name, src, opts, mtr, &mut methods);
                        }
                    } else if let Some(sig) = child_by_kind(ch, "method_signature").or_else(|| child_by_kind(ch, "function_signature")) {
                        let b = child_by_kind(ch, "function_body");
                        extract_dart_sig(sig, b, &name, src, opts, mtr, &mut methods);
                    }
                }
                "method_declaration" => {
                    let sig = ch.child_by_field_name("signature")
                        .or_else(|| child_by_kind(ch, "method_signature"))
                        .or_else(|| child_by_kind(ch, "function_signature"));
                    let b = ch.child_by_field_name("body").or_else(|| child_by_kind(ch, "function_body"));
                    if let Some(sig) = sig {
                        extract_dart_sig(sig, b, &name, src, opts, mtr, &mut methods);
                    }
                }
                "class_member_definition" => {
                    if let Some(decl) = child_by_kind(ch, "declaration") {
                        extract_dart_member(decl, &name, src, opts, mtr, (&mut props, &mut methods));
                    } else if let Some(sig) = child_by_kind(ch, "method_signature").or_else(|| child_by_kind(ch, "function_signature")) {
                        let b = child_by_kind(ch, "function_body");
                        extract_dart_sig(sig, b, &name, src, opts, mtr, &mut methods);
                    }
                }
                "declaration" => {
                    extract_dart_member(ch, &name, src, opts, mtr, (&mut props, &mut methods));
                }
                "method_signature" => {
                    let b = kids.get(i + 1).filter(|n| n.kind() == "function_body").copied();
                    if b.is_some() { i += 1; }
                    extract_dart_sig(ch, b, &name, src, opts, mtr, &mut methods);
                }
                _ => {}
            }
            i += 1;
        }
    }
    ClassDecl {
        vis, is_abstract: false, decorators: Vec::new(), name, type_params: Vec::new(),
        primary_ctor: Vec::new(), extends: None, implements: Vec::new(),
        props, methods, static_blocks: Vec::new(), trivia: tr, span: node_span(node),
    }
}

fn extract_dart_member(
    decl: Node<'_>,
    cls_name: &str,
    src: &str,
    opts: &TranspileOpts,
    tr: Trivia,
    out: (&mut Vec<PropDecl>, &mut Vec<MethodDecl>),
) {
    let (props, methods) = out;
    if let Some(cs) = child_by_kind(decl, "constant_constructor_signature")
        .or_else(|| child_by_kind(decl, "constructor_signature"))
    {
        let params = child_by_kind(cs, "formal_parameter_list").map(|p| dart_params(p, src)).unwrap_or_default();
        methods.push(MethodDecl {
            vis: Visibility::Public, is_static: false, is_async: false,
            is_const: cs.kind() == "constant_constructor_signature", accessor: AccessorKind::Constructor,
            name: cls_name.into(), type_params: Vec::new(), params, return_type: None,
            body: FnBody::SignatureOnly, trivia: tr, span: node_span(decl),
        });
        return;
    }
    if let Some(sig) = child_by_kind(decl, "function_signature")
        .or_else(|| child_by_kind(decl, "method_signature"))
        .or_else(|| child_by_kind(decl, "getter_signature"))
        .or_else(|| child_by_kind(decl, "setter_signature"))
    {
        extract_dart_sig(sig, None, cls_name, src, opts, tr, methods);
        return;
    }
    let raw = node_text(decl, src);
    let ty = child_by_kind(decl, "type_identifier")
        .or_else(|| child_by_kind(decl, "nullable_type"))
        .or_else(|| named_children(decl).into_iter().find(|c| c.kind().contains("type")))
        .map(|t| map_type_str(node_text(t, src), LanguageId::Dart));
    for iv in named_children(decl) {
        if matches!(iv.kind(), "initialized_identifier_list" | "static_final_declaration_list") {
            for id in named_children(iv) {
                let pnm = field_text(id, "name", src)
                    .or_else(|| child_by_kind(id, "identifier").map(|n| node_text(n, src)))
                    .unwrap_or_else(|| node_text(id, src).split('=').next().unwrap_or("f"))
                    .trim()
                    .to_string();
                props.push(PropDecl {
                    vis: if pnm.starts_with('_') { Visibility::Private } else { Visibility::Public },
                    name: pnm, aliases: Vec::new(), is_static: raw.contains("static "),
                    is_readonly: raw.contains("final ") || raw.contains("const "),
                    is_mut: !raw.contains("final "), is_optional: false, ty: ty.clone(), init: None, trivia: tr.clone(),
                });
            }
        }
    }
}

fn extract_dart_sig(sig: Node<'_>, body: Option<Node<'_>>, cls: &str, src: &str, opts: &TranspileOpts, tr: Trivia, methods: &mut Vec<MethodDecl>) {
    if let Some(cs) = child_by_kind(sig, "constant_constructor_signature")
        .or_else(|| child_by_kind(sig, "constructor_signature"))
    {
        let params = child_by_kind(cs, "formal_parameter_list").map(|p| dart_params(p, src)).unwrap_or_default();
        let fbody = body.and_then(|b| child_by_kind(b, "block").or(Some(b)))
            .map(|b| FnBody::Block(decompile_block(b, src, LanguageId::Dart, opts)))
            .unwrap_or(FnBody::SignatureOnly);
        methods.push(MethodDecl {
            vis: Visibility::Public, is_static: false, is_async: false,
            is_const: cs.kind() == "constant_constructor_signature", accessor: AccessorKind::Constructor,
            name: cls.into(), type_params: Vec::new(), params, return_type: None,
            body: fbody, trivia: tr, span: node_span(sig),
        });
        return;
    }
    let accessor = if child_by_kind(sig, "getter_signature").is_some() || sig.kind() == "getter_signature" {
        AccessorKind::Get
    } else if child_by_kind(sig, "setter_signature").is_some() || sig.kind() == "setter_signature" {
        AccessorKind::Set
    } else {
        AccessorKind::Normal
    };
    let inner = child_by_kind(sig, "function_signature")
        .or_else(|| child_by_kind(sig, "getter_signature"))
        .or_else(|| child_by_kind(sig, "setter_signature"))
        .unwrap_or(sig);
    let f = decompile_dart_fn_sig(inner, body, src, opts, tr);
    methods.push(MethodDecl {
        vis: f.vis, is_static: node_text(sig, src).trim_start().starts_with("static "), is_async: f.is_async, is_const: false,
        accessor, name: f.name, type_params: Vec::new(),
        params: f.params, return_type: f.return_type, body: f.body, trivia: f.trivia, span: f.span,
    });
}

fn decompile_dart_fn_sig(sig: Node<'_>, body: Option<Node<'_>>, src: &str, opts: &TranspileOpts, tr: Trivia) -> FnDecl {
    let name = field_text(sig, "name", src)
        .or_else(|| child_by_kind(sig, "identifier").map(|n| node_text(n, src)))
        .unwrap_or("fn_anon")
        .trim()
        .to_string();
    let vis = if name.starts_with('_') { Visibility::Private } else { Visibility::Public };
    let return_type = sig.child_by_field_name("return_type")
        .or_else(|| child_by_kind(sig, "type_identifier"))
        .or_else(|| child_by_kind(sig, "void_type"))
        .or_else(|| named_children(sig).into_iter().find(|c| c.kind().contains("type")))
        .map(|t| map_type_str(node_text(t, src), LanguageId::Dart));
    let params = child_by_kind(sig, "formal_parameter_list").map(|p| dart_params(p, src)).unwrap_or_default();
    let fbody = body.map(|b| decompile_dart_fn_body(b, src, opts)).unwrap_or(FnBody::SignatureOnly);
    FnDecl {
        vis, is_async: false, is_static: false, decorators: Vec::new(), name,
        type_params: Vec::new(), params, return_type, body: fbody, trivia: tr, span: node_span(sig),
    }
}

fn decompile_dart_fn_body(b: Node<'_>, src: &str, opts: &TranspileOpts) -> FnBody {
    if let Some(blk) = child_by_kind(b, "block") {
        return FnBody::Block(decompile_block(blk, src, LanguageId::Dart, opts));
    }
    if node_text(b, src).trim_start().starts_with("=>")
        && let Some(ex) = named_children(b).into_iter().next()
    {
        return FnBody::Expr(crate::decompile::expr_common::decompile_expr(ex, src, LanguageId::Dart));
    }
    FnBody::Block(decompile_block(b, src, LanguageId::Dart, opts))
}
