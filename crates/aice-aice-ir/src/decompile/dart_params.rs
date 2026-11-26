use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_span, node_text};
use crate::decompile::dart::decompile_dart_body_nodes;
use crate::decompile::expr_common::decompile_expr;
use crate::decompile::kotlin_dart::{extract_dart_heritage, extract_dart_type_params};
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::decompile::ts_helpers::push_attrs_to_trivia;
use crate::ir::{AiceItem, TranspileOpts, Trivia, Visibility};
use crate::ir_code::{ClassDecl, Expr, MemberKind, PropDecl};
use crate::ir_types::{EnumDecl, EnumVariant, ParamDecl, VariantPayload};

pub(crate) fn decompile_dart_enum(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> AiceItem {
    let name = field_text(node, "name", src).unwrap_or("Enum").to_string();
    let vis = if name.starts_with('_') { Visibility::Private } else { Visibility::Public };
    let type_params = extract_dart_type_params(node, src);
    let (extends, implements, mut decorators) = extract_dart_heritage(node, src);
    let mut entries: Vec<(String, Option<Vec<Expr>>, Trivia)> = Vec::new();
    let mut member_nodes: Vec<Node<'_>> = Vec::new();
    if let Some(body) = node.child_by_field_name("body").or_else(|| child_by_kind(node, "enum_body")) {
        for ch in named_children(body) {
            if is_comment_kind(ch.kind()) { continue; }
            if matches!(ch.kind(), "enum_entry" | "enum_constant") {
                let vn = field_text(ch, "name", src)
                    .or_else(|| child_by_kind(ch, "identifier").map(|n| node_text(n, src)))
                    .unwrap_or("v")
                    .trim()
                    .to_string();
                let args = child_by_kind(ch, "arguments").map(|al| {
                    named_children(al).into_iter()
                        .filter(|a| !is_comment_kind(a.kind()))
                        .map(|a| decompile_expr(a, src, LanguageId::Dart))
                        .collect()
                });
                entries.push((vn, args, collect_trivia(ch, src, opts)));
            } else {
                member_nodes.push(ch);
            }
        }
    }
    let (mut props, mut methods) = (Vec::new(), Vec::new());
    decompile_dart_body_nodes(&member_nodes, &name, src, opts, &mut props, &mut methods);
    let has_args = entries.iter().any(|(_, a, _)| a.is_some());
    if has_args || !props.is_empty() || !methods.is_empty() || !implements.is_empty() || !decorators.is_empty() {
        decorators.insert(0, "enum".into());
        let mut all_props = Vec::with_capacity(entries.len() + props.len());
        for (vn, args, mut vtr) in entries {
            push_attrs_to_trivia(&mut vtr, vec!["@variant".into()]);
            let init = args.map(|a| Expr::Call {
                callee: Box::new(Expr::Ident(name.clone())),
                args: a,
                is_new: false,
                is_optional: false,
                is_tagged: false,
            });
            all_props.push(PropDecl {
                name: vn, aliases: Vec::new(), vis: Visibility::Default, is_static: false,
                is_readonly: false, is_mut: false, is_optional: false, ty: None, init, trivia: vtr,
            });
        }
        all_props.extend(props);
        AiceItem::Class(ClassDecl {
            vis, is_abstract: false, decorators, name, type_params,
            primary_ctor: Vec::new(), extends, implements,
            props: all_props, methods, static_blocks: Vec::new(), trivia: tr, span: node_span(node),
        })
    } else {
        let variants = entries.into_iter().map(|(vn, _, vtr)| EnumVariant {
            name: vn, payload: VariantPayload::Unit, discriminant: None, trivia: vtr,
        }).collect();
        AiceItem::Enum(EnumDecl { vis, name, type_params, variants, trivia: tr, span: node_span(node) })
    }
}

pub(crate) fn decompile_dart_mixin(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> ClassDecl {
    let name = field_text(node, "name", src)
        .or_else(|| child_by_kind(node, "identifier").map(|n| node_text(n, src)))
        .unwrap_or("Mixin")
        .to_string();
    let vis = if name.starts_with('_') { Visibility::Private } else { Visibility::Public };
    let type_params = extract_dart_type_params(node, src);
    let (extends, implements, mut decorators) = extract_dart_heritage(node, src);
    decorators.insert(0, "mixin".into());
    let mut on_types = Vec::new();
    let mut seen_on = false;
    for i in 0..node.child_count() {
        let Some(ch) = node.child(i) else { continue };
        if !ch.is_named() && ch.kind() == "on" { seen_on = true; continue; }
        if seen_on && matches!(ch.kind(), "interfaces" | "class_body") { break; }
        if seen_on && ch.is_named() && !is_comment_kind(ch.kind()) {
            let txt = node_text(ch, src).trim();
            if !txt.is_empty() { on_types.push(txt.to_string()); }
        }
    }
    if !on_types.is_empty() { decorators.push(format!("on({})", on_types.join(", "))); }
    let (mut props, mut methods) = (Vec::new(), Vec::new());
    if let Some(body) = node.child_by_field_name("body").or_else(|| child_by_kind(node, "class_body")) {
        decompile_dart_body_nodes(&named_children(body), &name, src, opts, &mut props, &mut methods);
    }
    ClassDecl {
        vis, is_abstract: false, decorators, name, type_params,
        primary_ctor: Vec::new(), extends, implements,
        props, methods, static_blocks: Vec::new(), trivia: tr, span: node_span(node),
    }
}

pub(crate) fn decompile_dart_extension(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> ClassDecl {
    let name = field_text(node, "name", src)
        .or_else(|| child_by_kind(node, "identifier").map(|n| node_text(n, src)))
        .unwrap_or("_")
        .to_string();
    let vis = if name != "_" && name.starts_with('_') { Visibility::Private } else { Visibility::Public };
    let type_params = extract_dart_type_params(node, src);
    let on_ty = node.child_by_field_name("class")
        .or_else(|| child_by_kind(node, "type"))
        .map(|t| node_text(t, src).trim().to_string())
        .unwrap_or_else(|| "dynamic".into());
    let (mut props, mut methods) = (Vec::new(), Vec::new());
    if let Some(body) = node.child_by_field_name("body")
        .or_else(|| child_by_kind(node, "extension_body"))
        .or_else(|| child_by_kind(node, "class_body"))
    {
        decompile_dart_body_nodes(&named_children(body), &name, src, opts, &mut props, &mut methods);
    }
    ClassDecl {
        vis, is_abstract: false, decorators: vec![format!("extension({on_ty})")], name, type_params,
        primary_ctor: Vec::new(), extends: None, implements: Vec::new(),
        props, methods, static_blocks: Vec::new(), trivia: tr, span: node_span(node),
    }
}

pub(crate) fn dart_params(pl: Node<'_>, src: &str) -> Vec<ParamDecl> {
    let mut out: Vec<ParamDecl> = Vec::new();
    for ch in named_children(pl) {
        if ch.kind() == "optional_formal_parameters" {
            let is_named = node_text(ch, src).trim_start().starts_with('{');
            let mut prev_end = ch.start_byte();
            for sub in named_children(ch) {
                if sub.kind().contains("parameter") {
                    if let Some(p) = extract_dart_param(sub, is_named, src) {
                        out.push(p);
                    }
                    prev_end = sub.end_byte();
                } else if let Some(last) = out.last_mut()
                    && last.default.is_none()
                    && src.get(prev_end..sub.start_byte()).is_some_and(|s| s.contains('='))
                {
                    last.default = Some(crate::decompile::expr_common::decompile_expr(sub, src, LanguageId::Dart));
                    prev_end = sub.end_byte();
                }
            }
        } else if let Some(p) = extract_dart_param(ch, false, src) {
            out.push(p);
        }
    }
    out
}

fn extract_dart_param(node: Node<'_>, is_optional: bool, src: &str) -> Option<ParamDecl> {
    let raw = node_text(node, src).trim();
    if raw.is_empty() {
        return None;
    }
    let fp = if node.kind() == "default_formal_parameter" {
        node.child_by_field_name("parameter")
            .or_else(|| child_by_kind(node, "formal_parameter"))
            .unwrap_or(node)
    } else {
        node
    };
    let fp_raw = node_text(fp, src).trim();
    let has_this = fp_raw.contains("this.");
    let ty = fp
        .child_by_field_name("type")
        .or_else(|| child_by_kind(fp, "type_identifier"))
        .or_else(|| child_by_kind(fp, "nullable_type"))
        .or_else(|| named_children(fp).into_iter().find(|c| c.kind().contains("type")))
        .map(|t| map_type_str(node_text(t, src), LanguageId::Dart));
    let name = fp
        .child_by_field_name("name")
        .or_else(|| named_children(fp).into_iter().rfind(|c| c.kind() == "identifier"))
        .map(|n| node_text(n, src).trim().trim_start_matches("this.").to_string())
        .unwrap_or_else(|| {
            fp_raw
                .split('=')
                .next()
                .unwrap_or("p")
                .split_whitespace()
                .last()
                .unwrap_or("p")
                .trim_start_matches("this.")
                .to_string()
        });
    let def_node = node
        .child_by_field_name("default_value")
        .or_else(|| fp.child_by_field_name("default_value"))
        .or_else(|| fp.child_by_field_name("value"))
        .or_else(|| {
            raw.find('=').and_then(|eq_off| {
                let cut = node.start_byte() + eq_off;
                named_children(node)
                    .into_iter()
                    .rev()
                    .find(|c| c.start_byte() > cut && c.id() != fp.id())
                    .or_else(|| named_children(fp).into_iter().rev().find(|c| c.start_byte() > cut))
            })
        });
    let default = def_node.map(|d| crate::decompile::expr_common::decompile_expr(d, src, LanguageId::Dart));
    Some(ParamDecl {
        name,
        vis: crate::ir::Visibility::Default,
        is_readonly: has_this,
        is_mut: false,
        is_optional,
        is_rest: false,
        ty,
        default,
        trivia: Trivia::default(),
    })
}

pub(crate) fn extract_dart_field_init(id: Node<'_>, src: &str) -> Option<Expr> {
    let mut cur = id.walk();
    let mut seen_eq = false;
    let mut rhs = Vec::new();
    for c in id.children(&mut cur) {
        if !seen_eq {
            if c.kind() == "=" || node_text(c, src).trim() == "=" {
                seen_eq = true;
            }
        } else if c.is_named() && !is_comment_kind(c.kind()) {
            rhs.push(c);
        }
    }
    let first = *rhs.first()?;
    let mut expr = decompile_expr(first, src, LanguageId::Dart);
    for sel in &rhs[1..] {
        expr = apply_dart_selector(expr, *sel, src);
    }
    Some(expr)
}

fn apply_dart_selector(base: Expr, sel: Node<'_>, src: &str) -> Expr {
    let txt = node_text(sel, src).trim();
    if let Some(prop) = txt.strip_prefix("?.") {
        return Expr::Member {
            object: Box::new(base),
            property: prop.trim().to_string(),
            kind: MemberKind::SafeNav,
        };
    }
    if let Some(prop) = txt.strip_prefix('.') {
        return Expr::Member {
            object: Box::new(base),
            property: prop.trim().to_string(),
            kind: MemberKind::Dot,
        };
    }
    if txt.starts_with('(') {
        let arg_box = child_by_kind(sel, "argument_part")
            .and_then(|ap| child_by_kind(ap, "arguments"))
            .or_else(|| child_by_kind(sel, "arguments"))
            .unwrap_or(sel);
        let args = named_children(arg_box)
            .into_iter()
            .filter(|a| !is_comment_kind(a.kind()))
            .map(|a| decompile_expr(a, src, LanguageId::Dart))
            .collect();
        return Expr::Call {
            callee: Box::new(base),
            args,
            is_new: false,
            is_optional: false,
            is_tagged: false,
        };
    }
    if txt.starts_with('[') || txt.starts_with("?[") {
        let is_optional = txt.starts_with("?[");
        let idx_node = child_by_kind(sel, "unconditional_assignable_selector")
            .or_else(|| child_by_kind(sel, "conditional_assignable_selector"))
            .or_else(|| child_by_kind(sel, "index_selector"))
            .and_then(|s| named_children(s).into_iter().find(|c| !is_comment_kind(c.kind())))
            .or_else(|| named_children(sel).into_iter().find(|c| !is_comment_kind(c.kind())));
        if let Some(idx) = idx_node {
            return Expr::Index {
                object: Box::new(base),
                index: Box::new(decompile_expr(idx, src, LanguageId::Dart)),
                is_optional,
            };
        }
    }
    base
}
