use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_span, node_text, with_ts_root};
use crate::decompile::expr_common::decompile_expr;
use crate::decompile::stmt_common::decompile_block;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::decompile::ts_helpers::{normalize_single_line, push_attrs_to_trivia};
use crate::ir::{AiceItem, AiceModule, ImportDecl, TranspileError, TranspileOpts, Trivia, Visibility};
use crate::ir_code::{ClassDecl, ConstDecl, FnBody, FnDecl, MethodDecl, Stmt};
use crate::ir_types::{EnumDecl, EnumVariant, FieldDecl, FieldSigil, ParamDecl, TypeDecl, TypeKind, VariantPayload};

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    with_ts_root(tree, |root| {
        let mut m = AiceModule::new(LanguageId::Rust, "rust");
        let mut impls: Vec<(String, Vec<MethodDecl>)> = Vec::new();
        for ch in named_children(root) {
            if is_comment_kind(ch.kind()) { continue; }
            let tr = collect_trivia(ch, src, opts);
            let vis = rs_vis(ch, src);
            match ch.kind() {
                "use_declaration" => {
                    let arg = field_text(ch, "argument", src).unwrap_or("").trim().to_string();
                    m.items.push(AiceItem::Import(ImportDecl {
                        vis, source: arg, specifiers: Vec::new(), is_type_only: false, trivia: tr, span: node_span(ch),
                    }));
                }
                "struct_item" => m.items.push(AiceItem::Type(decompile_struct(ch, vis, src, opts, tr))),
                "enum_item" => m.items.push(AiceItem::Enum(decompile_enum(ch, vis, src, opts, tr))),
                "trait_item" => m.items.push(AiceItem::Type(decompile_trait(ch, vis, src, opts, tr))),
                "type_item" => {
                    let name = field_text(ch, "name", src).unwrap_or("Alias").to_string();
                    let rhs = field_text(ch, "type", src).map(|t| map_type_str(t, LanguageId::Rust));
                    m.items.push(AiceItem::Type(TypeDecl {
                        vis, kind: TypeKind::Alias, name, type_params: Vec::new(), extends: Vec::new(),
                        fields: Vec::new(), methods: Vec::new(), alias_target: rhs, trivia: tr, span: node_span(ch),
                    }));
                }
                "const_item" | "static_item" => {
                    let name = field_text(ch, "name", src).unwrap_or("CONST").to_string();
                    let ty = field_text(ch, "type", src).map(|t| map_type_str(t, LanguageId::Rust));
                    let value = ch.child_by_field_name("value").map(|v| decompile_expr(v, src, LanguageId::Rust))
                        .unwrap_or(crate::ir_code::Expr::Literal(crate::ir_expr::LiteralVal::Nil));
                    m.items.push(AiceItem::Const(ConstDecl { vis, name, ty, value, trivia: tr, span: node_span(ch) }));
                }
                "function_item" => m.items.push(AiceItem::Fn(decompile_rs_fn(ch, vis, src, opts, tr))),
                "impl_item" => {
                    let tname = field_text(ch, "type", src).unwrap_or("Self").trim().to_string();
                    let mut methods = Vec::new();
                    if let Some(body) = ch.child_by_field_name("body") {
                        for mc in named_children(body) {
                            if mc.kind() == "function_item" {
                                let mtr = collect_trivia(mc, src, opts);
                                let f = decompile_rs_fn(mc, rs_vis(mc, src), src, opts, mtr);
                                methods.push(MethodDecl {
                                    vis: f.vis, is_static: false, is_async: f.is_async, is_const: false,
                                    accessor: Default::default(), name: f.name, type_params: f.type_params,
                                    params: f.params, return_type: f.return_type, body: f.body, trivia: f.trivia, span: f.span,
                                });
                            }
                        }
                    }
                    impls.push((tname, methods));
                }
                _ => m.items.push(AiceItem::Directive { text: node_text(ch, src).trim().into(), trivia: tr, span: node_span(ch) }),
            }
        }
        // Attach impl methods onto matching struct ClassDecl or standalone impl ClassDecl
        for (tname, methods) in impls {
            if let Some(idx) = m.items.iter().position(|it| matches!(it, AiceItem::Type(t) if t.name == tname && t.kind == TypeKind::Struct)) {
                if let AiceItem::Type(td) = m.items.remove(idx) {
                    let props = td.fields.into_iter().map(|f| crate::ir_code::PropDecl {
                        name: f.name, aliases: Vec::new(), vis: f.vis, is_static: false,
                        is_readonly: true, is_mut: false, is_optional: f.is_optional,
                        ty: f.ty, init: f.default, trivia: f.trivia,
                    }).collect();
                    m.items.insert(idx, AiceItem::Class(ClassDecl {
                        vis: td.vis, is_abstract: false, decorators: Vec::new(), name: td.name,
                        type_params: td.type_params, primary_ctor: Vec::new(), extends: None,
                        implements: Vec::new(), props, methods, static_blocks: Vec::new(),
                        trivia: td.trivia, span: td.span,
                    }));
                }
            } else {
                m.items.push(AiceItem::Class(ClassDecl {
                    vis: Visibility::Default, is_abstract: false, decorators: Vec::new(), name: tname,
                    type_params: Vec::new(), primary_ctor: Vec::new(), extends: None, implements: Vec::new(),
                    props: Vec::new(), methods, static_blocks: Vec::new(), trivia: Trivia::default(), span: Default::default(),
                }));
            }
        }
        Ok(m)
    })
}

fn decompile_struct(node: Node<'_>, vis: Visibility, src: &str, opts: &TranspileOpts, tr: Trivia) -> TypeDecl {
    let name = field_text(node, "name", src).unwrap_or("Struct").to_string();
    let fields = node.child_by_field_name("body")
        .map(|b| extract_rs_fields(b, src, opts, true))
        .unwrap_or_default();
    TypeDecl {
        vis, kind: TypeKind::Struct, name, type_params: Vec::new(), extends: Vec::new(),
        fields, methods: Vec::new(), alias_target: None, trivia: tr, span: node_span(node),
    }
}

fn extract_rs_fields(body: Node<'_>, src: &str, opts: &TranspileOpts, is_struct: bool) -> Vec<FieldDecl> {
    let mut fields = Vec::new();
    let mut pending_attrs: Vec<String> = Vec::new();
    for ch in named_children(body) {
        if is_comment_kind(ch.kind()) { continue; }
        if ch.kind() == "attribute_item" {
            pending_attrs.push(normalize_single_line(node_text(ch, src)));
        } else if ch.kind() == "field_declaration" {
            let mut ftr = collect_trivia(ch, src, opts);
            push_attrs_to_trivia(&mut ftr, std::mem::take(&mut pending_attrs));
            let fnm = field_text(ch, "name", src).unwrap_or("f").to_string();
            let ty = field_text(ch, "type", src).map(|t| map_type_str(t, LanguageId::Rust));
            fields.push(FieldDecl {
                name: fnm, vis: if is_struct { rs_vis(ch, src) } else { Visibility::Default },
                is_readonly: is_struct, is_optional: false,
                sigil: FieldSigil::None, ty, default: None, trivia: ftr,
            });
        } else {
            pending_attrs.clear();
        }
    }
    fields
}

fn decompile_enum(node: Node<'_>, vis: Visibility, src: &str, opts: &TranspileOpts, tr: Trivia) -> EnumDecl {
    let name = field_text(node, "name", src).unwrap_or("Enum").to_string();
    let mut variants = Vec::new();
    if let Some(body) = node.child_by_field_name("body") {
        for ch in named_children(body) {
            if ch.kind() == "enum_variant" {
                let vn = field_text(ch, "name", src).unwrap_or("V").to_string();
                let payload = match ch.child_by_field_name("body") {
                    Some(b) if b.kind() == "field_declaration_list" => {
                        VariantPayload::Struct(extract_rs_fields(b, src, opts, false))
                    }
                    Some(b) if b.kind() == "ordered_field_declaration_list" => {
                        let ts = named_children(b).into_iter()
                            .map(|t| map_type_str(node_text(t, src), LanguageId::Rust))
                            .collect();
                        VariantPayload::Tuple(ts)
                    }
                    _ => VariantPayload::Unit,
                };
                variants.push(EnumVariant { name: vn, payload, discriminant: None, trivia: Trivia::default() });
            }
        }
    }
    EnumDecl { vis, name, type_params: Vec::new(), variants, trivia: tr, span: node_span(node) }
}

fn decompile_trait(node: Node<'_>, vis: Visibility, src: &str, opts: &TranspileOpts, tr: Trivia) -> TypeDecl {
    let name = field_text(node, "name", src).unwrap_or("Trait").to_string();
    let mut methods = Vec::new();
    if let Some(body) = node.child_by_field_name("body") {
        for ch in named_children(body) {
            if matches!(ch.kind(), "function_item" | "function_signature_item") {
                let f = decompile_rs_fn(ch, Visibility::Default, src, opts, Trivia::default());
                methods.push(MethodDecl {
                    vis: f.vis, is_static: false, is_async: f.is_async, is_const: false,
                    accessor: Default::default(), name: f.name, type_params: f.type_params,
                    params: f.params, return_type: f.return_type, body: f.body, trivia: f.trivia, span: f.span,
                });
            }
        }
    }
    TypeDecl {
        vis, kind: TypeKind::Trait, name, type_params: Vec::new(), extends: Vec::new(),
        fields: Vec::new(), methods, alias_target: None, trivia: tr, span: node_span(node),
    }
}

fn decompile_rs_fn(node: Node<'_>, vis: Visibility, src: &str, opts: &TranspileOpts, tr: Trivia) -> FnDecl {
    let name = field_text(node, "name", src).unwrap_or("fn_anon").to_string();
    let is_async = node_text(node, src).trim_start().contains("async fn");
    let mut params = Vec::new();
    if let Some(plist) = node.child_by_field_name("parameters") {
        for ch in named_children(plist) {
            match ch.kind() {
                "self_parameter" => params.push(ParamDecl {
                    name: node_text(ch, src).trim().into(), vis: Visibility::Default,
                    is_readonly: false, is_mut: false, is_optional: false, is_rest: false,
                    ty: None, default: None, trivia: Trivia::default(),
                }),
                "parameter" => {
                    let pname = field_text(ch, "pattern", src).unwrap_or("p").trim().to_string();
                    let ty = field_text(ch, "type", src).map(|t| map_type_str(t, LanguageId::Rust));
                    params.push(ParamDecl {
                        name: pname, vis: Visibility::Default, is_readonly: false, is_mut: false,
                        is_optional: false, is_rest: false, ty, default: None, trivia: Trivia::default(),
                    });
                }
                _ => {}
            }
        }
    }
    let return_type = field_text(node, "return_type", src).map(|t| map_type_str(t, LanguageId::Rust));
    let body = node.child_by_field_name("body").map(|b| {
        let mut stmts = decompile_block(b, src, LanguageId::Rust, opts);
        if matches!(stmts.last(), Some(Stmt::Expr { .. }))
            && let Some(mut last_st) = stmts.pop()
            && let Stmt::Expr { expr, trivia } = &mut last_st
        {
            let e = std::mem::replace(expr, crate::ir_code::Expr::Ident(String::new()));
            let tr = std::mem::take(trivia);
            stmts.push(Stmt::Return { value: Some(e), trivia: tr });
        }
        FnBody::Block(stmts)
    }).unwrap_or(FnBody::SignatureOnly);
    FnDecl {
        vis, is_async, is_static: false, decorators: Vec::new(), name,
        type_params: Vec::new(), params, return_type, body, trivia: tr, span: node_span(node),
    }
}

fn rs_vis(node: Node<'_>, src: &str) -> Visibility {
    let Some(vm) = child_by_kind(node, "visibility_modifier") else { return Visibility::Private; };
    match node_text(vm, src).trim() {
        "pub" => Visibility::Public,
        "pub(super)" => Visibility::Protected,
        _ => Visibility::Package,
    }
}
