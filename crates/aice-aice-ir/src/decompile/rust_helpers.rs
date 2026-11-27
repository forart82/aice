use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_span, node_text};
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::decompile::ts_helpers::{normalize_single_line, push_attrs_to_trivia};
use crate::ir::{TranspileOpts, Trivia, Visibility};
use crate::ir_types::{FieldDecl, FieldSigil, TypeDecl, TypeKind, TypeParam};

pub(crate) fn decompile_struct(
    node: Node<'_>,
    vis: Visibility,
    src: &str,
    opts: &TranspileOpts,
    mut tr: Trivia,
    type_params: Vec<TypeParam>,
    attrs: Vec<String>,
) -> TypeDecl {
    let name = field_text(node, "name", src).unwrap_or("Struct").to_string();
    push_attrs_to_trivia(&mut tr, attrs);
    let fields = match node.child_by_field_name("body") {
        Some(b) if b.kind() == "ordered_field_declaration_list" => {
            push_attrs_to_trivia(&mut tr, vec!["@tuple".into()]);
            extract_rs_tuple_fields(b, src, opts)
        }
        Some(b) => extract_rs_fields(b, src, opts, true),
        None => {
            push_attrs_to_trivia(&mut tr, vec!["@unit".into()]);
            Vec::new()
        }
    };
    TypeDecl {
        vis, kind: TypeKind::Struct, name, type_params, extends: Vec::new(),
        fields, methods: Vec::new(), alias_target: None, trivia: tr, span: node_span(node),
    }
}

pub(crate) fn extract_rs_fields(body: Node<'_>, src: &str, opts: &TranspileOpts, is_struct: bool) -> Vec<FieldDecl> {
    let (mut fields, mut pending_attrs) = (Vec::new(), Vec::new());
    for ch in named_children(body) {
        if is_comment_kind(ch.kind()) { continue; }
        if ch.kind() == "attribute_item" {
            pending_attrs.push(normalize_single_line(node_text(ch, src)));
        } else if ch.kind() == "field_declaration" {
            let mut ftr = collect_trivia(ch, src, opts);
            push_attrs_to_trivia(&mut ftr, std::mem::take(&mut pending_attrs));
            fields.push(FieldDecl {
                name: field_text(ch, "name", src).unwrap_or("f").to_string(),
                vis: if is_struct { rs_vis(ch, src) } else { Visibility::Default },
                is_readonly: is_struct, is_optional: false, sigil: FieldSigil::None,
                ty: field_text(ch, "type", src).map(|t| map_type_str(t, LanguageId::Rust)),
                default: None, trivia: ftr,
            });
        } else {
            pending_attrs.clear();
        }
    }
    fields
}

fn extract_rs_tuple_fields(body: Node<'_>, src: &str, opts: &TranspileOpts) -> Vec<FieldDecl> {
    let (mut fields, mut pending_attrs, mut pending_vis) = (Vec::new(), Vec::new(), Visibility::Private);
    let mut idx = 0usize;
    for ch in named_children(body) {
        if is_comment_kind(ch.kind()) { continue; }
        match ch.kind() {
            "attribute_item" => pending_attrs.push(normalize_single_line(node_text(ch, src))),
            "visibility_modifier" => pending_vis = rs_vis_text(node_text(ch, src)),
            _ => {
                let mut ftr = collect_trivia(ch, src, opts);
                push_attrs_to_trivia(&mut ftr, std::mem::take(&mut pending_attrs));
                fields.push(FieldDecl {
                    name: idx.to_string(),
                    vis: std::mem::replace(&mut pending_vis, Visibility::Private),
                    is_readonly: true,
                    is_optional: false,
                    sigil: FieldSigil::None,
                    ty: Some(map_type_str(node_text(ch, src), LanguageId::Rust)),
                    default: None,
                    trivia: ftr,
                });
                idx += 1;
            }
        }
    }
    fields
}

pub(crate) fn rs_vis_text(raw: &str) -> Visibility {
    match raw.trim() {
        "pub" => Visibility::Public,
        "pub(super)" => Visibility::Protected,
        _ => Visibility::Package,
    }
}

pub(crate) fn rs_vis(node: Node<'_>, src: &str) -> Visibility {
    let Some(vm) = child_by_kind(node, "visibility_modifier") else { return Visibility::Private; };
    rs_vis_text(node_text(vm, src))
}

fn rs_esc(s: &str) -> String { s.replace('\\', "\\\\").replace('"', "\\\"") }

pub(crate) fn decompile_rs_trait_assoc(node: Node<'_>, src: &str, mut tr: Trivia) -> FieldDecl {
    let raw = normalize_single_line(node_text(node, src));
    let name = field_text(node, "name", src).unwrap_or("Out").trim().to_string();
    let has_complex = node.child_by_field_name("type_parameters").is_some()
        || child_by_kind(node, "where_clause").is_some()
        || raw.contains('=');
    if has_complex {
        push_attrs_to_trivia(&mut tr, vec![format!("@assoc_raw(\"{}\")", rs_esc(&raw))]);
        FieldDecl {
            name, vis: Visibility::Default, is_readonly: false, is_optional: false,
            sigil: FieldSigil::None, ty: None, default: None, trivia: tr,
        }
    } else {
        push_attrs_to_trivia(&mut tr, vec!["@assoc_type".into()]);
        let ty = node.child_by_field_name("bounds").map(|b| {
            let txt = normalize_single_line(node_text(b, src));
            let clean = txt.trim_start_matches(':').trim();
            map_type_str(clean, LanguageId::Rust)
        });
        FieldDecl {
            name, vis: Visibility::Default, is_readonly: false, is_optional: false,
            sigil: FieldSigil::None, ty, default: None, trivia: tr,
        }
    }
}

pub(crate) fn decompile_rs_impl_assoc(node: Node<'_>, src: &str, mut tr: Trivia) -> crate::ir_code::PropDecl {
    let raw = normalize_single_line(node_text(node, src));
    let name = field_text(node, "name", src).unwrap_or("Out").trim().to_string();
    let has_complex = node.child_by_field_name("type_parameters").is_some()
        || child_by_kind(node, "where_clause").is_some();
    let ty = if has_complex {
        push_attrs_to_trivia(&mut tr, vec![format!("@assoc_raw(\"{}\")", rs_esc(&raw))]);
        None
    } else {
        push_attrs_to_trivia(&mut tr, vec!["@assoc_type".into()]);
        field_text(node, "type", src).map(|t| map_type_str(t, LanguageId::Rust))
    };
    crate::ir_code::PropDecl {
        name, aliases: Vec::new(), vis: Visibility::Default, is_static: false, is_readonly: false,
        is_mut: false, is_optional: false, ty, init: None, trivia: tr,
    }
}

pub(crate) fn rs_generic_attrs_match(tr: &Trivia, impl_attrs: &[String]) -> bool {
    let mut a: Vec<&str> = tr.leading.iter()
        .filter(|c| c.kind == crate::ir::TriviaKind::Attribute)
        .map(|c| c.text.trim().trim_start_matches('@'))
        .filter(|s| s.starts_with("lifetimes(") || s.starts_with("where("))
        .collect();
    let mut b: Vec<&str> = impl_attrs.iter()
        .map(|s| s.trim().trim_start_matches('@'))
        .filter(|s| s.starts_with("lifetimes(") || s.starts_with("where("))
        .collect();
    a.sort_unstable();
    b.sort_unstable();
    a == b
}

pub(crate) fn is_rs_non_tail_raw(s: &str) -> bool {
    let t = s.trim();
    t.ends_with(';')
        || t.starts_with("let ")
        || t.starts_with("fn ")
        || t.starts_with("pub ")
        || t.starts_with("const ")
        || t.starts_with("static ")
        || t.starts_with("struct ")
        || t.starts_with("enum ")
        || t.starts_with("type ")
        || t.starts_with("use ")
        || t.starts_with("impl ")
        || t.starts_with("trait ")
}
