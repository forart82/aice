use aice_lang_registry::{IntraBlockKind, IntraBlockNode, LanguageId};

use crate::intra_ast_kinds::classify_ts_kind;
use crate::intra_ast_struct::TaggedIntraBlock;
use crate::r5::cst_helpers::{child_kind_text, field_text, node_text};
use crate::r6::sql_symbols::find_sql_name;

pub(crate) fn extract_ts_intra_blocks(
    lang: LanguageId,
    root: tree_sitter::Node<'_>,
    src: &str,
    span: Option<(usize, usize)>,
) -> Vec<TaggedIntraBlock> {
    let mut out = Vec::new();
    let mut stack: Vec<(tree_sitter::Node<'_>, Option<tree_sitter::Node<'_>>)> = vec![(root, None)];
    while let Some((node, parent)) = stack.pop() {
        if let Some((s_b, e_b)) = span
            && (node.end_byte() <= s_b || node.start_byte() >= e_b)
        {
            continue;
        }
        if let Some(kind) = classify_ts_kind(lang, node.kind())
            && span.is_none_or(|(s_b, e_b)| node.start_byte() >= s_b && node.end_byte() <= e_b)
        {
            let (start_line, end_line) = node_lines(node.start_position(), node.end_position());
            out.push(TaggedIntraBlock {
                node: IntraBlockNode {
                    kind,
                    label: extract_block_label(kind, node, parent, src),
                    start_line,
                    end_line,
                    start_byte: node.start_byte(),
                    end_byte: node.end_byte(),
                },
                ast_kind: Some(node.kind().to_string()),
            });
        }
        if lang == LanguageId::Dart && node.kind() == "try_statement" {
            push_dart_try_clauses(node, src, span, &mut out);
        }
        for i in (0..node.named_child_count()).rev() {
            if let Some(c) = node.named_child(i as u32) {
                stack.push((c, Some(node)));
            }
        }
    }
    out
}

fn node_lines(start: tree_sitter::Point, end: tree_sitter::Point) -> (usize, usize) {
    let end_row = if end.column == 0 && end.row > start.row { end.row - 1 } else { end.row };
    let start_line = start.row + 1;
    let end_line = (end_row + 1).max(start_line);
    (start_line, end_line)
}

fn push_dart_try_clauses(
    try_node: tree_sitter::Node<'_>,
    src: &str,
    span: Option<(usize, usize)>,
    out: &mut Vec<TaggedIntraBlock>,
) {
    let try_body_id = try_node.child_by_field_name("body").map(|b| b.id());
    let mut pending_start: Option<tree_sitter::Node<'_>> = None;
    for i in 0..try_node.child_count() {
        let Some(c) = try_node.child(i) else { continue };
        if c.is_extra() || matches!(c.kind(), "comment" | "documentation_comment") { continue; }
        if c.kind() == "try" || Some(c.id()) == try_body_id { continue; }
        match c.kind() {
            "on" => pending_start = Some(c),
            "catch_clause" => if pending_start.is_none() { pending_start = Some(c); },
            "block" => {
                if let Some(start_node) = pending_start.take() {
                    let (start_byte, end_byte) = (start_node.start_byte(), c.end_byte());
                    if span.is_none_or(|(s_b, e_b)| start_byte >= s_b && end_byte <= e_b) {
                        let (start_line, end_line) = node_lines(start_node.start_position(), c.end_position());
                        out.push(TaggedIntraBlock {
                            node: IntraBlockNode {
                                kind: IntraBlockKind::ErrorHandler,
                                label: bounded_first_line(src.get(start_byte..end_byte).unwrap_or("")),
                                start_line,
                                end_line,
                                start_byte,
                                end_byte,
                            },
                            ast_kind: Some(start_node.kind().to_string()),
                        });
                    }
                }
            }
            "finally_clause" => pending_start = None,
            _ => {}
        }
    }
}

fn extract_block_label(
    kind: IntraBlockKind,
    node: tree_sitter::Node<'_>,
    parent: Option<tree_sitter::Node<'_>>,
    src: &str,
) -> String {
    let head = bounded_first_line(node_text(node, src));
    match kind {
        IntraBlockKind::Closure => {
            if let Some(lhs) = closure_binding_name(parent, src) {
                return truncate_chars(&format!("{lhs} = {head}"), 120);
            }
            head
        }
        IntraBlockKind::Cte => {
            if let Some((_, qname)) = find_sql_name(node, src) {
                return truncate_chars(&qname, 120);
            }
            head
        }
        IntraBlockKind::RuleBlock => {
            if let Some(key) = rule_block_key(node, src)
                && !head.contains(&key)
            {
                return truncate_chars(&format!("{key}: {head}"), 120);
            }
            head
        }
        _ => head,
    }
}

fn closure_binding_name(parent: Option<tree_sitter::Node<'_>>, src: &str) -> Option<String> {
    let parent = parent?;
    let raw = match parent.kind() {
        "variable_declarator" | "let_declaration" | "const_item" | "static_item" => {
            field_text(parent, "name", src).or_else(|| field_text(parent, "pattern", src))
        }
        "assignment"
        | "assignment_expression"
        | "augmented_assignment_expression"
        | "short_var_declaration" => field_text(parent, "left", src),
        "pair" | "property_assignment" | "key_value_pair" => {
            field_text(parent, "key", src).or_else(|| field_text(parent, "name", src))
        }
        _ => None,
    }?;
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.contains('\n') || trimmed.len() > 60 {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn rule_block_key(node: tree_sitter::Node<'_>, src: &str) -> Option<String> {
    match node.kind() {
        "pair" | "block_mapping_pair" | "flow_pair" => field_text(node, "key", src)
            .map(|k| k.trim_matches(['"', '\'']).to_string())
            .filter(|s| !s.is_empty()),
        "rule_set" => child_kind_text(node, "selectors", src).map(str::to_string),
        _ => None,
    }
}

fn bounded_first_line(text: &str) -> String {
    let mut out = String::new();
    for (count, ch) in text.trim_start().chars().enumerate() {
        if ch == '\n' || ch == '\r' || count >= 120 {
            break;
        }
        out.push(ch);
    }
    out.trim_end().to_string()
}

fn truncate_chars(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        s.chars().take(max_chars).collect()
    }
}
