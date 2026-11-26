use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, map_type_str, named_children, node_text};
use crate::ir::Trivia;
use crate::ir_types::ParamDecl;

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
