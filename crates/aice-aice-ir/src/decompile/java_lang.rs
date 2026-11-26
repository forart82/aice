use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_span, node_text, with_ts_root};
use crate::decompile::stmt_common::decompile_block;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::ir::{AiceItem, AiceModule, ImportDecl, TranspileError, TranspileOpts, Trivia, Visibility};
use crate::ir_code::{AccessorKind, ClassDecl, FnBody, MethodDecl, PropDecl};
use crate::ir_types::{EnumDecl, EnumVariant, ParamDecl, TypeDecl, TypeKind, VariantPayload};

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    with_ts_root(tree, |root| {
        let mut m = AiceModule::new(LanguageId::Java, "java");
        for ch in named_children(root) {
            if is_comment_kind(ch.kind()) { continue; }
            let tr = collect_trivia(ch, src, opts);
            match ch.kind() {
                "package_declaration" => {
                    let pkg = node_text(ch, src).trim().trim_start_matches("package ").trim_end_matches(';').trim().to_string();
                    m.module_name = pkg;
                }
                "import_declaration" => {
                    let imp = node_text(ch, src).trim().trim_start_matches("import ").trim_end_matches(';').trim().to_string();
                    m.items.push(AiceItem::Import(ImportDecl {
                        vis: Visibility::Default, source: imp, specifiers: Vec::new(),
                        is_type_only: false, trivia: tr, span: node_span(ch),
                    }));
                }
                "interface_declaration" => {
                    let cd = decompile_java_class(ch, src, opts, tr.clone());
                    m.items.push(AiceItem::Type(TypeDecl {
                        vis: cd.vis, kind: TypeKind::Interface, name: cd.name, type_params: cd.type_params,
                        extends: Vec::new(), fields: Vec::new(), methods: cd.methods,
                        alias_target: None, trivia: tr, span: cd.span,
                    }));
                }
                "class_declaration" | "record_declaration" => {
                    m.items.push(AiceItem::Class(decompile_java_class(ch, src, opts, tr)));
                }
                "enum_declaration" => {
                    let name = field_text(ch, "name", src).unwrap_or("Enum").to_string();
                    let mut variants = Vec::new();
                    if let Some(body) = ch.child_by_field_name("body") {
                        for c in named_children(body) {
                            if c.kind() == "enum_constant" {
                                let vn = field_text(c, "name", src).unwrap_or("V").to_string();
                                variants.push(EnumVariant { name: vn, payload: VariantPayload::Unit, discriminant: None, trivia: Trivia::default() });
                            }
                        }
                    }
                    m.items.push(AiceItem::Enum(EnumDecl { vis: java_vis(ch, src), name, type_params: Vec::new(), variants, trivia: tr, span: node_span(ch) }));
                }
                _ => {}
            }
        }
        Ok(m)
    })
}

fn decompile_java_class(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> ClassDecl {
    let name = field_text(node, "name", src).unwrap_or("Class").to_string();
    let vis = java_vis(node, src);
    let mut props = Vec::new();
    let mut methods = Vec::new();
    if let Some(body) = node.child_by_field_name("body") {
        for ch in named_children(body) {
            if is_comment_kind(ch.kind()) { continue; }
            let mtr = collect_trivia(ch, src, opts);
            let mvis = java_vis(ch, src);
            match ch.kind() {
                "field_declaration" => {
                    let ty = field_text(ch, "type", src).map(|t| map_type_str(t, LanguageId::Java));
                    let mod_txt = child_by_kind(ch, "modifiers").map(|m| node_text(m, src)).unwrap_or("");
                    for d in named_children(ch) {
                        if d.kind() == "variable_declarator" {
                            let fnm = field_text(d, "name", src).unwrap_or("f").to_string();
                            props.push(PropDecl {
                                name: fnm, aliases: Vec::new(), vis: mvis,
                                is_static: mod_txt.contains("static"), is_readonly: mod_txt.contains("final"),
                                is_mut: !mod_txt.contains("final"), is_optional: false, ty: ty.clone(), init: None, trivia: mtr.clone(),
                            });
                        }
                    }
                }
                "method_declaration" | "constructor_declaration" => {
                    let is_ctor = ch.kind() == "constructor_declaration";
                    let mname = field_text(ch, "name", src).unwrap_or(&name).to_string();
                    let params = ch.child_by_field_name("parameters").map(|p| java_params(p, src)).unwrap_or_default();
                    let ret = if is_ctor { None } else { field_text(ch, "type", src).map(|t| map_type_str(t, LanguageId::Java)) };
                    let mbody = ch.child_by_field_name("body").map(|b| FnBody::Block(decompile_block(b, src, LanguageId::Java, opts))).unwrap_or(FnBody::SignatureOnly);
                    let mod_txt = child_by_kind(ch, "modifiers").map(|m| node_text(m, src)).unwrap_or("");
                    methods.push(MethodDecl {
                        vis: mvis, is_static: mod_txt.contains("static"), is_async: false, is_const: false,
                        accessor: if is_ctor { AccessorKind::Constructor } else { AccessorKind::Normal },
                        name: if is_ctor { "constructor".into() } else { mname },
                        type_params: Vec::new(), params, return_type: ret, body: mbody, trivia: mtr, span: node_span(ch),
                    });
                }
                _ => {}
            }
        }
    }
    let decorators = if node.kind() == "record_declaration" { vec!["record".into()] } else { Vec::new() };
    let primary_ctor = node.child_by_field_name("parameters")
        .or_else(|| child_by_kind(node, "formal_parameters"))
        .map(|p| java_params(p, src))
        .unwrap_or_default();
    ClassDecl {
        vis, is_abstract: false, decorators, name, type_params: Vec::new(),
        primary_ctor, extends: None, implements: Vec::new(),
        props, methods, static_blocks: Vec::new(), trivia: tr, span: node_span(node),
    }
}

fn java_params(pl: Node<'_>, src: &str) -> Vec<ParamDecl> {
    let mut out = Vec::new();
    for ch in named_children(pl) {
        if ch.kind() == "formal_parameter" {
            let name = field_text(ch, "name", src).unwrap_or("p").to_string();
            let ty = field_text(ch, "type", src).map(|t| map_type_str(t, LanguageId::Java));
            out.push(ParamDecl {
                name, vis: Visibility::Default, is_readonly: false, is_mut: false,
                is_optional: false, is_rest: false, ty, default: None, trivia: Trivia::default(),
            });
        }
    }
    out
}

fn java_vis(node: Node<'_>, src: &str) -> Visibility {
    let Some(mods) = child_by_kind(node, "modifiers") else { return Visibility::Package; };
    let txt = node_text(mods, src);
    if txt.contains("public") { Visibility::Public }
    else if txt.contains("private") { Visibility::Private }
    else if txt.contains("protected") { Visibility::Protected }
    else { Visibility::Package }
}
