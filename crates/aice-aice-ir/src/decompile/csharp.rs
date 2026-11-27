use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::csharp_java::{cs_has_mod, extract_cs_base_list, extract_cs_type_params};
use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_span, node_text, with_ts_root};
use crate::decompile::expr_common::decompile_expr;
use crate::decompile::stmt_common::decompile_block;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::decompile::ts_helpers::push_attrs_to_trivia;
use crate::ir::{AiceItem, AiceModule, ImportDecl, TranspileError, TranspileOpts, Trivia, Visibility};
use crate::ir_code::{AccessorKind, ClassDecl, FnBody, MethodDecl, PropDecl};
use crate::ir_types::{EnumDecl, EnumVariant, ParamDecl, TypeDecl, TypeKind, VariantPayload};

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    with_ts_root(tree, |root| {
        let mut m = AiceModule::new(LanguageId::CSharp, "csharp");
        for ch in named_children(root) {
            if is_comment_kind(ch.kind()) { continue; }
            collect_cs(ch, src, opts, &mut m);
        }
        Ok(m)
    })
}

fn collect_cs(root: Node<'_>, src: &str, opts: &TranspileOpts, m: &mut AiceModule) {
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        let tr = collect_trivia(node, src, opts);
        match node.kind() {
            "using_directive" => {
                let name = node_text(node, src).trim().trim_start_matches("using ").trim_end_matches(';').trim().to_string();
                m.items.push(AiceItem::Import(ImportDecl {
                    vis: Visibility::Default, source: name, specifiers: Vec::new(),
                    is_type_only: false, trivia: tr, span: node_span(node),
                }));
            }
            "namespace_declaration" | "file_scoped_namespace_declaration" => {
                if let Some(nm) = field_text(node, "name", src) {
                    m.module_name = nm.trim().to_string();
                }
                if let Some(body) = node.child_by_field_name("body") {
                    for ch in named_children(body).into_iter().rev() {
                        if !is_comment_kind(ch.kind()) { stack.push(ch); }
                    }
                }
            }
            "interface_declaration" => {
                let cd = decompile_cs_class(node, src, opts, tr.clone());
                m.items.push(AiceItem::Type(TypeDecl {
                    vis: cd.vis, kind: TypeKind::Interface, name: cd.name, type_params: cd.type_params,
                    extends: cd.implements, fields: Vec::new(), methods: cd.methods,
                    alias_target: None, trivia: tr, span: cd.span,
                }));
            }
            "class_declaration" | "struct_declaration" | "record_declaration" => {
                m.items.push(AiceItem::Class(decompile_cs_class(node, src, opts, tr)));
            }
            "enum_declaration" => {
                let name = field_text(node, "name", src).unwrap_or("Enum").to_string();
                let mut etr = tr;
                if let Some(bl) = child_by_kind(node, "base_list") {
                    let base = node_text(bl, src).trim().trim_start_matches(':').trim();
                    if !base.is_empty() { push_attrs_to_trivia(&mut etr, vec![format!("@base({base})")]); }
                }
                let mut variants = Vec::new();
                if let Some(body) = node.child_by_field_name("body") {
                    for ch in named_children(body) {
                        if ch.kind() == "enum_member_declaration" {
                            let vn = field_text(ch, "name", src).unwrap_or("V").to_string();
                            let disc = cs_init_expr(ch, src);
                            variants.push(EnumVariant {
                                name: vn, payload: VariantPayload::Unit, discriminant: disc,
                                trivia: collect_trivia(ch, src, opts),
                            });
                        }
                    }
                }
                m.items.push(AiceItem::Enum(EnumDecl { vis: cs_vis(node, src), name, type_params: Vec::new(), variants, trivia: etr, span: node_span(node) }));
            }
            _ => {}
        }
    }
}

fn decompile_cs_class(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> ClassDecl {
    let name = field_text(node, "name", src).unwrap_or("Class").to_string();
    let vis = cs_vis(node, src);
    let is_abstract = cs_has_mod(node, src, "abstract");
    let mut decorators = Vec::new();
    if cs_has_mod(node, src, "static") { decorators.push("static".into()); }
    if node.kind() == "record_declaration" { decorators.push("record".into()); }
    else if node.kind() == "struct_declaration" { decorators.push("struct".into()); }
    let implements = extract_cs_base_list(node, src);
    let primary_ctor = node.child_by_field_name("parameters")
        .or_else(|| child_by_kind(node, "parameter_list"))
        .map(|pl| cs_params(pl, src))
        .unwrap_or_default();
    let mut props = Vec::new();
    let mut methods = Vec::new();
    if let Some(body) = node.child_by_field_name("body") {
        for ch in named_children(body) {
            if is_comment_kind(ch.kind()) { continue; }
            let mtr = collect_trivia(ch, src, opts);
            let mvis = cs_vis(ch, src);
            match ch.kind() {
                "property_declaration" => {
                    let pname = field_text(ch, "name", src).unwrap_or("Prop").to_string();
                    let ty = field_text(ch, "type", src).map(|t| map_type_str(t, LanguageId::CSharp));
                    let init = ch.child_by_field_name("value")
                        .or_else(|| child_by_kind(ch, "arrow_expression_clause"))
                        .map(|v| {
                            let inner = if v.kind() == "arrow_expression_clause" {
                                named_children(v).into_iter().next().unwrap_or(v)
                            } else {
                                v
                            };
                            decompile_expr(inner, src, LanguageId::CSharp)
                        });
                    let pr = node_text(ch, src);
                    props.push(PropDecl {
                        name: pname, aliases: Vec::new(), vis: mvis, is_static: cs_has_mod(ch, src, "static") || pr.contains("static "),
                        is_readonly: !pr.contains("set;"), is_mut: pr.contains("set;"), is_optional: false,
                        ty, init, trivia: mtr,
                    });
                }
                "field_declaration" => {
                    if let Some(vd) = named_children(ch).into_iter().find(|c| c.kind() == "variable_declaration") {
                        let ty = field_text(vd, "type", src).map(|t| map_type_str(t, LanguageId::CSharp));
                        let mods = named_children(ch);
                        let is_const = mods.iter().any(|c| c.kind() == "modifier" && node_text(*c, src).trim() == "const");
                        let is_readonly = !is_const
                            && (mods.iter().any(|c| c.kind() == "modifier" && node_text(*c, src).trim() == "readonly")
                                || node_text(ch, src).contains("readonly "));
                        let is_static = !is_const
                            && mods.iter().any(|c| c.kind() == "modifier" && node_text(*c, src).trim() == "static");
                        let mut ftr = mtr;
                        if is_const { push_attrs_to_trivia(&mut ftr, vec!["@const".into()]); }
                        for dec in named_children(vd) {
                            if dec.kind() == "variable_declarator" {
                                let fnm = field_text(dec, "name", src)
                                    .or_else(|| child_by_kind(dec, "identifier").map(|n| node_text(n, src)))
                                    .unwrap_or("f")
                                    .trim()
                                    .to_string();
                                let init = cs_init_expr(dec, src);
                                props.push(PropDecl {
                                    name: fnm, aliases: Vec::new(), vis: mvis, is_static,
                                    is_readonly, is_mut: !is_const && !is_readonly,
                                    is_optional: false, ty: ty.clone(), init, trivia: ftr.clone(),
                                });
                            }
                        }
                    }
                }
                "method_declaration" | "constructor_declaration" => {
                    let is_ctor = ch.kind() == "constructor_declaration";
                    let mname = field_text(ch, "name", src).unwrap_or(&name).to_string();
                    let params = ch.child_by_field_name("parameters").map(|p| cs_params(p, src)).unwrap_or_default();
                    let ret = if is_ctor { None } else { field_text(ch, "returns", src).map(|t| map_type_str(t, LanguageId::CSharp)) };
                    let mbody = if let Some(arrow) = ch
                        .child_by_field_name("body")
                        .filter(|b| b.kind() == "arrow_expression_clause")
                        .or_else(|| child_by_kind(ch, "arrow_expression_clause"))
                    {
                        let expr_n = named_children(arrow).into_iter().next().unwrap_or(arrow);
                        FnBody::Expr(decompile_expr(expr_n, src, LanguageId::CSharp))
                    } else if let Some(b) = ch.child_by_field_name("body") {
                        FnBody::Block(decompile_block(b, src, LanguageId::CSharp, opts))
                    } else {
                        FnBody::SignatureOnly
                    };
                    let mut mtr = mtr;
                    if !is_ctor {
                        let mut mattrs = Vec::new();
                        if cs_has_mod(ch, src, "abstract") { mattrs.push("@abstract".into()); }
                        if cs_has_mod(ch, src, "override") { mattrs.push("@override".into()); }
                        if cs_has_mod(ch, src, "virtual") { mattrs.push("@virtual".into()); }
                        if !mattrs.is_empty() { push_attrs_to_trivia(&mut mtr, mattrs); }
                    }
                    methods.push(MethodDecl {
                        vis: mvis, is_static: cs_has_mod(ch, src, "static"), is_async: cs_has_mod(ch, src, "async"),
                        is_const: false, accessor: if is_ctor { AccessorKind::Constructor } else { AccessorKind::Normal },
                        name: if is_ctor { "constructor".into() } else { mname },
                        type_params: if is_ctor { Vec::new() } else { extract_cs_type_params(ch, src) },
                        params, return_type: ret, body: mbody, trivia: mtr, span: node_span(ch),
                    });
                }
                _ => {}
            }
        }
    }
    ClassDecl {
        vis, is_abstract, decorators, name, type_params: extract_cs_type_params(node, src),
        primary_ctor, extends: None, implements,
        props, methods, static_blocks: Vec::new(), trivia: tr, span: node_span(node),
    }
}

fn cs_init_expr(node: Node<'_>, src: &str) -> Option<crate::ir_code::Expr> {
    let raw = node.child_by_field_name("initializer")
        .or_else(|| node.child_by_field_name("value"))
        .or_else(|| child_by_kind(node, "equals_value_clause"))
        .or_else(|| {
            let mut seen_eq = false;
            for i in 0..node.child_count() {
                let Some(ch) = node.child(i) else { continue };
                if !seen_eq {
                    if ch.kind() == "=" || node_text(ch, src).trim() == "=" { seen_eq = true; }
                } else if ch.is_named() {
                    return Some(ch);
                }
            }
            None
        })?;
    let inner = if raw.kind() == "equals_value_clause" {
        named_children(raw).into_iter().next().unwrap_or(raw)
    } else {
        raw
    };
    Some(decompile_expr(inner, src, LanguageId::CSharp))
}

fn cs_params(pl: Node<'_>, src: &str) -> Vec<ParamDecl> {
    let mut out = Vec::new();
    for ch in named_children(pl) {
        if ch.kind() == "parameter" {
            let name = field_text(ch, "name", src).unwrap_or("p").to_string();
            let mods: Vec<&str> = (0..ch.child_count())
                .filter_map(|i| ch.child(i))
                .filter(|c| c.kind() == "modifier" || (!c.is_named() && c.kind() == "params"))
                .map(|c| node_text(c, src).trim())
                .filter(|s| matches!(*s, "ref" | "out" | "in" | "readonly" | "scoped" | "this" | "params"))
                .collect();
            let ty = field_text(ch, "type", src).map(|t| {
                if mods.is_empty() {
                    map_type_str(t, LanguageId::CSharp)
                } else {
                    crate::ir_types::AiceType::Raw(format!("{} {}", mods.join(" "), t.trim()))
                }
            });
            let default = cs_init_expr(ch, src);
            out.push(ParamDecl {
                name, vis: Visibility::Default, is_readonly: false, is_mut: false,
                is_optional: false, is_rest: false, ty, default, trivia: Trivia::default(),
            });
        }
    }
    out
}

fn cs_vis(node: Node<'_>, src: &str) -> Visibility {
    for ch in named_children(node) {
        if ch.kind() == "modifier" {
            match node_text(ch, src).trim() {
                "public" => return Visibility::Public,
                "private" => return Visibility::Private,
                "protected" => return Visibility::Protected,
                "internal" => return Visibility::Package,
                _ => {}
            }
        }
    }
    Visibility::Default
}
