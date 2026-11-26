use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::c_lang;
use crate::decompile::cpp_lang;
use crate::decompile::cst_util::{field_text, map_type_str, named_children, node_text};
use crate::ir::{AiceModule, TranspileError, TranspileOpts};
use crate::ir_types::AiceType;

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    match tree.language() {
        LanguageId::C => c_lang::decompile(tree, src, opts),
        _ => cpp_lang::decompile(tree, src, opts),
    }
}

pub(crate) fn extract_c_type_quals(node: Node<'_>, src: &str) -> String {
    let decl_start = node
        .child_by_field_name("declarator")
        .map(|d| d.start_byte())
        .unwrap_or(node.end_byte());
    let mut quals: Vec<&str> = Vec::new();
    let mut cur = node.walk();
    for ch in node.children(&mut cur) {
        if ch.start_byte() >= decl_start {
            break;
        }
        if ch.kind() == "type_qualifier" {
            let txt = node_text(ch, src).trim();
            if matches!(txt, "const" | "volatile") && !quals.contains(&txt) {
                quals.push(txt);
            }
        }
    }
    if quals.is_empty() {
        String::new()
    } else {
        format!("{} ", quals.join(" "))
    }
}

pub(crate) fn prepend_c_type_quals(quals: &str, raw_ty: &str, ptrs: &str) -> String {
    let prefix_part = raw_ty.split('<').next().unwrap_or(raw_ty);
    let mut pfx = String::new();
    for q in quals.split_whitespace() {
        if !prefix_part.split_whitespace().any(|w| w == q) {
            pfx.push_str(q);
            pfx.push(' ');
        }
    }
    format!("{pfx}{raw_ty}{ptrs}")
}

pub(crate) fn find_c_fn_declarator<'a>(node: Node<'a>, src: &str) -> Option<(Node<'a>, String)> {
    let mut cur = node.child_by_field_name("declarator")?;
    let mut quals = String::new();
    while matches!(cur.kind(), "pointer_declarator" | "reference_declarator") {
        if cur.kind() == "reference_declarator" {
            if node_text(cur, src).trim_start().starts_with("&&") {
                quals.push_str("&&");
            } else {
                quals.push('&');
            }
        } else {
            quals.push('*');
        }
        cur = cur
            .child_by_field_name("declarator")
            .or_else(|| {
                named_children(cur).into_iter().find(|c| {
                    matches!(
                        c.kind(),
                        "function_declarator" | "pointer_declarator" | "reference_declarator"
                    )
                })
            })?;
    }
    if cur.kind() != "function_declarator"
        || cur
            .child_by_field_name("declarator")
            .is_some_and(|d| d.kind() == "parenthesized_declarator")
    {
        return None;
    }
    Some((cur, quals))
}

pub(crate) fn build_c_return_type(
    node: Node<'_>,
    ret_quals: &str,
    src: &str,
    lang: LanguageId,
) -> Option<AiceType> {
    field_text(node, "type", src).map(|t| {
        let quals = extract_c_type_quals(node, src);
        let full = prepend_c_type_quals(&quals, t.trim(), ret_quals);
        map_type_str(&full, lang)
    })
}

pub(crate) fn unwrap_c_param_declarator(mut node: Node<'_>, src: &str) -> (String, String) {
    let mut quals = String::new();
    while matches!(
        node.kind(),
        "pointer_declarator"
            | "reference_declarator"
            | "abstract_pointer_declarator"
            | "abstract_reference_declarator"
    ) {
        if matches!(
            node.kind(),
            "reference_declarator" | "abstract_reference_declarator"
        ) {
            if node_text(node, src).trim_start().starts_with("&&") {
                quals.push_str("&&");
            } else {
                quals.push('&');
            }
        } else {
            quals.push('*');
        }
        if let Some(inner) = node.child_by_field_name("declarator").or_else(|| {
            named_children(node)
                .into_iter()
                .rfind(|c| c.kind() != "type_qualifier")
        }) {
            node = inner;
        } else {
            break;
        }
    }
    let name = node_text(node, src)
        .trim()
        .trim_start_matches(['*', '&'])
        .trim()
        .to_string();
    let clean = if name.is_empty() { "p".to_string() } else { name };
    (clean, quals)
}
