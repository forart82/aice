use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_text};
use crate::decompile::stmt_common::find_body_node;
use crate::decompile::trivia::{collect_header_trailing, is_comment_kind};
use crate::ir::{TranspileOpts, Trivia};
use crate::ir_code::AssignOp;
use crate::ir_types::AiceType;

fn unwrap_c_decl_name(mut decl: Node<'_>, src: &str) -> String {
    loop {
        if matches!(
            decl.kind(),
            "init_declarator" | "pointer_declarator" | "array_declarator"
        ) {
            if let Some(inner) = decl.child_by_field_name("declarator") {
                decl = inner;
                continue;
            }
        } else if matches!(
            decl.kind(),
            "reference_declarator" | "parenthesized_declarator"
        ) && let Some(inner) = named_children(decl).into_iter().last()
        {
            decl = inner;
            continue;
        }
        break;
    }
    let txt = node_text(decl, src)
        .trim()
        .trim_start_matches(['*', '&'])
        .trim();
    if txt.is_empty() {
        "x".to_string()
    } else {
        txt.to_string()
    }
}

fn find_eq_rhs<'a>(decl: Node<'a>) -> Option<Node<'a>> {
    let mut cur = decl.walk();
    let mut seen_eq = false;
    for c in decl.children(&mut cur) {
        if c.kind() == "=" {
            seen_eq = true;
        } else if seen_eq && c.is_named() && !is_comment_kind(c.kind()) {
            return Some(c);
        }
    }
    None
}

pub(crate) fn find_var_decls<'a>(
    node: Node<'a>,
    src: &'a str,
    lang: LanguageId,
) -> Vec<(String, bool, Option<AiceType>, Option<Node<'a>>)> {
    let raw = node_text(node, src);
    let is_kt_prop = node.kind() == "property_declaration";
    let inner_node = if node.kind() == "local_declaration_statement" {
        child_by_kind(node, "variable_declaration").unwrap_or(node)
    } else if lang == LanguageId::Dart && node.kind() == "local_variable_declaration" {
        child_by_kind(node, "initialized_variable_declaration").unwrap_or(node)
    } else {
        node
    };
    let is_mut = if is_kt_prop {
        raw.trim_start().starts_with("var ") || raw.contains(" var ")
    } else {
        node.kind() == "short_var_declaration"
            || (lang == LanguageId::Rust
                && (child_by_kind(node, "mutable_specifier").is_some()
                    || raw.trim_start().starts_with("let mut ")))
            || (lang != LanguageId::Rust
                && (raw.contains("let mut") || raw.trim_start().starts_with("let ")))
            || raw.trim_start().starts_with("var ")
            || (matches!(
                node.kind(),
                "local_declaration_statement"
                    | "local_variable_declaration"
                    | "initialized_variable_definition"
                    | "declaration"
            ) && !raw.contains("const ")
                && !raw.contains("final ")
                && !raw.trim_start().starts_with("var "))
            || (lang == LanguageId::CSharp
                && node.kind() == "variable_declaration"
                && !raw.contains("const "))
    };
    let decls: Vec<Node<'a>> = if is_kt_prop {
        vec![child_by_kind(inner_node, "variable_declaration").unwrap_or(inner_node)]
    } else if inner_node.kind() == "declaration" {
        let mut cur = inner_node.walk();
        let ds: Vec<Node<'a>> = inner_node
            .children_by_field_name("declarator", &mut cur)
            .collect();
        if ds.is_empty() { vec![inner_node] } else { ds }
    } else if inner_node.kind() == "initialized_variable_declaration" {
        let mut ds = vec![inner_node];
        ds.extend(
            named_children(inner_node)
                .into_iter()
                .filter(|c| c.kind() == "initialized_identifier"),
        );
        ds
    } else {
        let ds: Vec<Node<'a>> = named_children(inner_node)
            .into_iter()
            .filter(|c| {
                c.kind().contains("declarator")
                    || matches!(
                        c.kind(),
                        "initialized_variable_declaration" | "initialized_variable_definition"
                    )
            })
            .collect();
        if ds.is_empty() { vec![inner_node] } else { ds }
    };
    let shared_ty = field_text(inner_node, "type", src).map(|t| map_type_str(t, lang));
    decls
        .into_iter()
        .map(|decl| {
            let name = if inner_node.kind() == "declaration" {
                unwrap_c_decl_name(decl, src)
            } else {
                field_text(decl, "name", src)
                    .or_else(|| field_text(decl, "pattern", src))
                    .or_else(|| field_text(decl, "declarator", src))
                    .or_else(|| {
                        if is_kt_prop {
                            child_by_kind(decl, "simple_identifier")
                                .or_else(|| child_by_kind(decl, "identifier"))
                                .map(|c| node_text(c, src))
                        } else {
                            None
                        }
                    })
                    .or_else(|| {
                        named_children(decl)
                            .into_iter()
                            .next()
                            .map(|c| node_text(c, src))
                    })
                    .unwrap_or("x")
                    .trim()
                    .trim_start_matches(['*', '&'])
                    .trim()
                    .to_string()
            };
            let ty = field_text(decl, "type", src)
                .map(|t| map_type_str(t, lang))
                .or_else(|| {
                    if is_kt_prop {
                        child_by_kind(decl, "user_type")
                            .or_else(|| child_by_kind(decl, "type"))
                            .map(|t| map_type_str(node_text(t, src), lang))
                    } else {
                        None
                    }
                })
                .or_else(|| shared_ty.clone());
            let init = decl
                .child_by_field_name("value")
                .or_else(|| decl.child_by_field_name("right"))
                .or_else(|| {
                    if is_kt_prop {
                        node.child_by_field_name("value")
                    } else {
                        None
                    }
                })
                .or_else(|| {
                    child_by_kind(decl, "equals_value_clause")
                        .and_then(|ev| named_children(ev).into_iter().next())
                })
                .or_else(|| {
                    if is_kt_prop {
                        named_children(node).into_iter().last().filter(|c| {
                            c.id() != decl.id()
                                && !matches!(
                                    c.kind(),
                                    "modifiers" | "binding_pattern_kind" | "user_type" | "type"
                                )
                        })
                    } else {
                        find_eq_rhs(decl)
                    }
                });
            (name, is_mut, ty, init)
        })
        .collect()
}

pub(crate) fn find_assign_parts<'a>(
    node: Node<'a>,
    src: &'a str,
) -> Option<(AssignOp, Node<'a>, Node<'a>)> {
    let raw = node_text(node, src);
    let kids = named_children(node);
    if kids.len() < 2 {
        return None;
    }
    let op_slice = node
        .child_by_field_name("operator")
        .map(|o| node_text(o, src))
        .unwrap_or_else(|| {
            let (s, e) = (kids[0].end_byte(), kids[kids.len() - 1].start_byte());
            if s <= e { &src[s..e] } else { raw }
        });
    let op = if op_slice.contains("+=") { AssignOp::AddAssign }
    else if op_slice.contains("-=") { AssignOp::SubAssign }
    else if op_slice.contains("*=") { AssignOp::MulAssign }
    else if op_slice.contains("/=") { AssignOp::DivAssign }
    else { AssignOp::Assign };
    Some((op, kids[0], kids[kids.len() - 1]))
}

pub(crate) fn find_catch_parts<'a>(
    ch: Node<'a>,
    src: &'a str,
    lang: LanguageId,
    opts: &TranspileOpts,
) -> (Option<String>, Option<AiceType>, Trivia, Option<Node<'a>>) {
    let mut param = field_text(ch, "parameter", src).map(str::to_string);
    let mut ty = field_text(ch, "type", src).map(|t| map_type_str(t, lang));
    if param.is_none() {
        if let Some(pl) = child_by_kind(ch, "parameter_list") {
            if let Some(pd) = named_children(pl).into_iter().find(|n| n.kind() == "parameter_declaration") {
                let (pnm, ptrs) = pd.child_by_field_name("declarator")
                    .map(|d| crate::decompile::c_lang::unwrap_c_declarator(d, src))
                    .unwrap_or_else(|| ("err".into(), String::new()));
                if !pnm.is_empty() { param = Some(pnm); }
                if let Some(raw_ty) = field_text(pd, "type", src) {
                    let qual = child_by_kind(pd, "type_qualifier").map(|q| format!("{} ", node_text(q, src).trim())).unwrap_or_default();
                    ty = Some(map_type_str(&format!("{qual}{raw_ty}{ptrs}"), lang));
                }
            } else if lang == LanguageId::Cpp && node_text(pl, src).trim() == "(...)" {
                param = Some("...".to_string());
            }
        } else if let Some(fp) = child_by_kind(ch, "catch_formal_parameter")
            .or_else(|| child_by_kind(ch, "catch_declaration"))
        {
            param = field_text(fp, "name", src)
                .or_else(|| named_children(fp).into_iter().last().map(|n| node_text(n, src)))
                .map(|s| s.trim().to_string());
            ty = fp.child_by_field_name("type")
                .or_else(|| named_children(fp).into_iter().find(|c| c.kind().contains("type")))
                .map(|t| map_type_str(node_text(t, src), lang));
        }
    }
    let bn = find_body_node(ch);
    let hdr_tr = bn.and_then(|b| collect_header_trailing(b, src, opts));
    (param, ty, Trivia { trailing: hdr_tr, ..Trivia::default() }, bn)
}

pub(crate) fn find_dart_catch_parts<'a>(
    ty_n: Option<Node<'a>>, cc_n: Option<Node<'a>>, bn: Option<Node<'a>>, src: &'a str, opts: &TranspileOpts,
) -> (Option<String>, Option<AiceType>, Trivia, Option<Node<'a>>) {
    let ty = ty_n.map(|t| map_type_str(node_text(t, src), LanguageId::Dart));
    let param = cc_n.and_then(|cc| {
        let exc = field_text(cc, "exception", src).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
            .or_else(|| named_children(cc).into_iter().find(|n| n.kind() == "identifier").map(|n| node_text(n, src).trim().to_string()));
        let st = field_text(cc, "stack_trace", src).map(str::trim).filter(|s| !s.is_empty());
        match (exc, st) {
            (Some(e), Some(s)) => Some(format!("{e}, {s}")),
            (Some(e), None) => Some(e),
            (None, _) => None,
        }
    });
    let hdr_tr = bn.and_then(|b| collect_header_trailing(b, src, opts));
    (param, ty, Trivia { trailing: hdr_tr, ..Trivia::default() }, bn)
}
