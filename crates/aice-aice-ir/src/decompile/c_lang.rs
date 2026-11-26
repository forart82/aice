use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_span, node_text, with_ts_root};
use crate::decompile::expr_common::decompile_expr;
use crate::decompile::stmt_common::decompile_block;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::ir::{AiceItem, AiceModule, ImportDecl, TranspileError, TranspileOpts, Trivia, Visibility};
use crate::ir_code::{FnBody, FnDecl};
use crate::ir_types::{EnumDecl, EnumVariant, FieldDecl, FieldSigil, ParamDecl, TypeDecl, TypeKind, VariantPayload};

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    with_ts_root(tree, |root| {
        let mut m = AiceModule::new(LanguageId::C, "c");
        for ch in named_children(root) {
            if is_comment_kind(ch.kind()) { continue; }
            let tr = collect_trivia(ch, src, opts);
            match ch.kind() {
                "preproc_include" => {
                    let path = field_text(ch, "path", src).unwrap_or("").trim().to_string();
                    m.items.push(AiceItem::Import(ImportDecl {
                        vis: Visibility::Default, source: path, specifiers: Vec::new(),
                        is_type_only: false, trivia: tr, span: node_span(ch),
                    }));
                }
                "type_definition" => {
                    if let Some(en) = child_by_kind(ch, "enum_specifier").filter(|e| e.child_by_field_name("body").is_some()) {
                        let nm = field_text(ch, "declarator", src)
                            .or_else(|| field_text(en, "name", src))
                            .unwrap_or("Enum").trim().to_string();
                        m.items.push(AiceItem::Enum(extract_c_enum(en, nm, src, tr)));
                    } else if let Some(st) = child_by_kind(ch, "struct_specifier").or_else(|| ch.child_by_field_name("type")) {
                        let nm = field_text(ch, "declarator", src).unwrap_or("Struct").trim().to_string();
                        m.items.push(AiceItem::Type(extract_c_struct(st, nm, src, tr)));
                    }
                }
                "enum_specifier" if ch.child_by_field_name("body").is_some() => {
                    let nm = field_text(ch, "name", src).unwrap_or("Enum").trim().to_string();
                    m.items.push(AiceItem::Enum(extract_c_enum(ch, nm, src, tr)));
                }
                "declaration"
                    if child_by_kind(ch, "enum_specifier").is_some_and(|e| e.child_by_field_name("body").is_some())
                        && ch.child_by_field_name("declarator").is_none() =>
                {
                    let en = child_by_kind(ch, "enum_specifier").expect("enum_specifier");
                    let nm = field_text(en, "name", src).unwrap_or("Enum").trim().to_string();
                    m.items.push(AiceItem::Enum(extract_c_enum(en, nm, src, tr)));
                }
                "struct_specifier" => {
                    let nm = field_text(ch, "name", src).unwrap_or("Struct").to_string();
                    m.items.push(AiceItem::Type(extract_c_struct(ch, nm, src, tr)));
                }
                "function_definition" => m.items.push(AiceItem::Fn(decompile_c_fn(ch, src, opts, tr))),
                _ => m.items.push(AiceItem::Directive { text: node_text(ch, src).trim().into(), trivia: tr, span: node_span(ch) }),
            }
        }
        Ok(m)
    })
}

fn extract_c_enum(node: Node<'_>, name: String, src: &str, tr: Trivia) -> EnumDecl {
    let mut variants = Vec::new();
    if let Some(body) = node.child_by_field_name("body") {
        for ch in named_children(body) {
            if ch.kind() == "enumerator" {
                let vn = field_text(ch, "name", src).unwrap_or("V").trim().to_string();
                let disc = ch.child_by_field_name("value").map(|v| decompile_expr(v, src, LanguageId::C));
                variants.push(EnumVariant { name: vn, payload: VariantPayload::Unit, discriminant: disc, trivia: Trivia::default() });
            }
        }
    }
    EnumDecl { vis: Visibility::Public, name, type_params: Vec::new(), variants, trivia: tr, span: node_span(node) }
}

fn extract_c_struct(node: Node<'_>, name: String, src: &str, tr: Trivia) -> TypeDecl {
    let mut fields = Vec::new();
    if let Some(body) = node.child_by_field_name("body") {
        for ch in named_children(body) {
            if ch.kind() == "field_declaration" {
                let fnm = field_text(ch, "declarator", src).unwrap_or("f").trim().to_string();
                let ty = field_text(ch, "type", src).map(|t| map_type_str(t, LanguageId::C));
                fields.push(FieldDecl {
                    name: fnm, vis: Visibility::Public, is_readonly: false, is_optional: false,
                    sigil: FieldSigil::None, ty, default: None, trivia: Trivia::default(),
                });
            }
        }
    }
    TypeDecl {
        vis: Visibility::Public, kind: TypeKind::Struct, name, type_params: Vec::new(),
        extends: Vec::new(), fields, methods: Vec::new(), alias_target: None, trivia: tr, span: node_span(node),
    }
}

fn decompile_c_fn(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> FnDecl {
    let raw = node_text(node, src);
    let vis = if raw.trim_start().starts_with("static ") { Visibility::Private } else { Visibility::Public };
    let return_type = field_text(node, "type", src).map(|t| map_type_str(t, LanguageId::C));
    let decl = node.child_by_field_name("declarator");
    let fn_decl = decl.and_then(|d| if d.kind() == "function_declarator" { Some(d) } else { child_by_kind(d, "function_declarator") });
    let name = fn_decl.and_then(|d| field_text(d, "declarator", src)).unwrap_or("fn_anon").trim().to_string();
    let mut params = Vec::new();
    if let Some(pl) = fn_decl.and_then(|d| d.child_by_field_name("parameters")) {
        for pd in named_children(pl) {
            if pd.kind() == "parameter_declaration" {
                let raw_ty = field_text(pd, "type", src).unwrap_or("void").trim();
                let (pnm, ptrs) = pd.child_by_field_name("declarator")
                    .map(|d| unwrap_c_declarator(d, src))
                    .unwrap_or_else(|| ("p".into(), String::new()));
                let full_ty = format!("{raw_ty}{ptrs}");
                let pty = Some(map_type_str(&full_ty, LanguageId::C));
                params.push(ParamDecl {
                    name: pnm, vis: Visibility::Default, is_readonly: false, is_mut: false,
                    is_optional: false, is_rest: false, ty: pty, default: None, trivia: Trivia::default(),
                });
            }
        }
    }
    let body = node.child_by_field_name("body").map(|b| FnBody::Block(decompile_block(b, src, LanguageId::C, opts))).unwrap_or(FnBody::SignatureOnly);
    FnDecl {
        vis, is_async: false, is_static: false, decorators: Vec::new(), name,
        type_params: Vec::new(), params, return_type, body, trivia: tr, span: node_span(node),
    }
}

pub(crate) fn unwrap_c_declarator(mut node: Node<'_>, src: &str) -> (String, String) {
    let mut quals = String::new();
    while matches!(node.kind(), "pointer_declarator" | "reference_declarator" | "abstract_pointer_declarator") {
        if node.kind() == "reference_declarator" {
            quals.push('&');
        } else {
            quals.push('*');
        }
        if let Some(inner) = node.child_by_field_name("declarator").or_else(|| named_children(node).into_iter().next()) {
            node = inner;
        } else {
            break;
        }
    }
    let name = node_text(node, src).trim().trim_start_matches(['*', '&']).trim().to_string();
    let clean = if name.is_empty() { "p".to_string() } else { name };
    (clean, quals)
}
