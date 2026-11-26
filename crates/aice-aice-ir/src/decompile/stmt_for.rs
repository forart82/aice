use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, named_children, node_text};
use crate::decompile::trivia::is_comment_kind;

pub(crate) struct CForParts<'a> {
    pub inits: Vec<Node<'a>>,
    pub cond: Option<Node<'a>>,
    pub upds: Vec<Node<'a>>,
    pub is_loop: bool,
}

fn clean_cond<'a>(n: Option<Node<'a>>) -> Option<Node<'a>> {
    n.filter(|c| !matches!(c.kind(), "empty_statement" | ";"))
}

fn collect_for_exprs<'a>(node: Node<'a>, field: &str) -> Vec<Node<'a>> {
    let mut cur = node.walk();
    let raw: Vec<Node<'a>> = node.children_by_field_name(field, &mut cur).collect();
    let mut stack: Vec<Node<'a>> = raw.into_iter().rev().collect();
    let mut out = Vec::new();
    while let Some(n) = stack.pop() {
        if matches!(n.kind(), "empty_statement" | ";" | ",")
            || !n.is_named()
            || is_comment_kind(n.kind())
        {
            continue;
        }
        if matches!(n.kind(), "comma_expression" | "sequence_expression") {
            let kids = named_children(n);
            for k in kids.into_iter().rev() {
                stack.push(k);
            }
        } else {
            out.push(n);
        }
    }
    out
}

pub(crate) fn extract_c_for_parts<'a>(
    node: Node<'a>,
    lang: LanguageId,
    bn: Option<Node<'a>>,
) -> Option<CForParts<'a>> {
    if node.kind() != "for_statement" {
        return None;
    }
    let (inits, cond, upds) = match lang {
        LanguageId::Go => {
            if let Some(fc) = child_by_kind(node, "for_clause") {
                (
                    collect_for_exprs(fc, "initializer"),
                    clean_cond(fc.child_by_field_name("condition")),
                    collect_for_exprs(fc, "update"),
                )
            } else if child_by_kind(node, "range_clause").is_some() {
                return None;
            } else {
                let cond = named_children(node)
                    .into_iter()
                    .find(|c| Some(*c) != bn && !is_comment_kind(c.kind()));
                return Some(CForParts {
                    inits: Vec::new(),
                    cond,
                    upds: Vec::new(),
                    is_loop: cond.is_none(),
                });
            }
        }
        LanguageId::Python | LanguageId::Kotlin | LanguageId::Rust | LanguageId::Ruby => {
            return None;
        }
        LanguageId::Dart => {
            if node.child_by_field_name("value").is_some()
                || child_by_kind(node, "in").is_some()
            {
                return None;
            }
            (
                collect_for_exprs(node, "init"),
                clean_cond(node.child_by_field_name("condition")),
                collect_for_exprs(node, "update"),
            )
        }
        LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript => (
            collect_for_exprs(node, "initializer"),
            clean_cond(node.child_by_field_name("condition")),
            collect_for_exprs(node, "increment"),
        ),
        LanguageId::Java => (
            collect_for_exprs(node, "init"),
            clean_cond(node.child_by_field_name("condition")),
            collect_for_exprs(node, "update"),
        ),
        LanguageId::Php => (
            collect_for_exprs(node, "initialize"),
            clean_cond(node.child_by_field_name("condition")),
            collect_for_exprs(node, "update"),
        ),
        LanguageId::C | LanguageId::Cpp | LanguageId::CSharp => (
            collect_for_exprs(node, "initializer"),
            clean_cond(node.child_by_field_name("condition")),
            collect_for_exprs(node, "update"),
        ),
        _ => return None,
    };
    let is_loop = cond.is_none();
    Some(CForParts { inits, cond, upds, is_loop })
}

pub(crate) fn extract_kotlin_for_parts<'a>(
    node: Node<'a>,
    src: &'a str,
    bn: Option<Node<'a>>,
) -> (String, Option<Node<'a>>) {
    let ident_text = |n: Node<'a>| -> Option<String> {
        child_by_kind(n, "simple_identifier")
            .or_else(|| child_by_kind(n, "identifier"))
            .map(|id| node_text(id, src).trim().to_string())
            .filter(|s| !s.is_empty())
    };
    let binding = if let Some(vd) = child_by_kind(node, "variable_declaration") {
        ident_text(vd).unwrap_or_else(|| "item".into())
    } else if let Some(mvd) = child_by_kind(node, "multi_variable_declaration") {
        let parts: Vec<String> = named_children(mvd)
            .into_iter()
            .filter_map(|c| {
                if c.kind() == "variable_declaration" {
                    ident_text(c)
                } else if matches!(c.kind(), "simple_identifier" | "identifier") {
                    Some(node_text(c, src).trim().to_string())
                } else {
                    None
                }
            })
            .collect();
        if parts.is_empty() {
            "item".into()
        } else {
            format!("({})", parts.join(", "))
        }
    } else {
        "item".into()
    };
    let iter_n = named_children(node).into_iter().find(|c| {
        Some(*c) != bn
            && !is_comment_kind(c.kind())
            && !matches!(
                c.kind(),
                "label" | "annotation" | "variable_declaration" | "multi_variable_declaration"
            )
    });
    (binding, iter_n)
}

pub(crate) fn is_single_stmt_node(kind: &str) -> bool {
    matches!(
        kind,
        "expression_statement"
            | "return_statement"
            | "return_expression"
            | "throw_statement"
            | "throw_expression"
            | "raise_statement"
            | "break_statement"
            | "break_expression"
            | "continue_statement"
            | "continue_expression"
            | "if_statement"
            | "if_expression"
            | "while_statement"
            | "while_expression"
            | "for_statement"
            | "for_in_statement"
            | "for_expression"
            | "for_range_loop"
            | "foreach_statement"
            | "enhanced_for_statement"
            | "loop_expression"
            | "try_statement"
            | "try_expression"
            | "switch_statement"
            | "match_expression"
            | "match_statement"
            | "lexical_declaration"
            | "variable_declaration"
            | "local_declaration_statement"
            | "local_variable_declaration"
            | "declaration"
            | "assignment_expression"
            | "augmented_assignment_expression"
    )
}
