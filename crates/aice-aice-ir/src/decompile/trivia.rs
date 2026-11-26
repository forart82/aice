use tree_sitter::Node;

use crate::decompile::cst_util::node_text;
use crate::ir::{TranspileOpts, Trivia, TriviaComment, TriviaKind};

pub(crate) fn is_comment_kind(kind: &str) -> bool {
    kind.eq_ignore_ascii_case("comment")
        || matches!(
            kind,
            "line_comment"
                | "block_comment"
                | "doc_comment"
                | "documentation_comment"
                | "documentation_block_comment"
                | "html_comment"
                | "developer_comment"
        )
}

pub(crate) fn clean_comment(raw: &str) -> String {
    let t = raw.trim();
    if let Some(inner) = t.strip_prefix("/**").and_then(|s| s.strip_suffix("*/")) {
        return inner
            .lines()
            .map(|l| l.trim().trim_start_matches('*').trim())
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
    }
    if let Some(inner) = t.strip_prefix("/*").and_then(|s| s.strip_suffix("*/")) {
        return inner.trim().to_string();
    }
    if let Some(inner) = t.strip_prefix("<!--").and_then(|s| s.strip_suffix("-->")) {
        return inner.trim().to_string();
    }
    if let Some(inner) = t.strip_prefix("{#").and_then(|s| s.strip_suffix("#}")) {
        return inner.trim().to_string();
    }
    for pfx in ["///", "//!", "//", "#", "--"] {
        if let Some(rest) = t.strip_prefix(pfx) {
            return rest.trim().to_string();
        }
    }
    t.to_string()
}

pub(crate) fn collect_trivia(node: Node<'_>, src: &str, opts: &TranspileOpts) -> Trivia {
    if !opts.preserve_docs {
        return Trivia::default();
    }
    let mut leading_rev = Vec::new();
    let mut cur = node.prev_sibling();
    while let Some(prev) = cur {
        if is_comment_kind(prev.kind()) {
            if is_header_trailing_comment(prev) || is_prev_sibling_trailing_comment(prev, src) {
                break;
            }
            let txt = clean_comment(node_text(prev, src));
            if !txt.is_empty() {
                leading_rev.push(TriviaComment {
                    kind: TriviaKind::Line,
                    text: txt,
                });
            }
            cur = prev.prev_sibling();
        } else if is_ws_text_node(prev, src) {
            cur = prev.prev_sibling();
        } else {
            break;
        }
    }
    leading_rev.reverse();

    let end_row = node.end_position().row;
    let mut trailing = None;
    let mut nxt = node.next_sibling();
    let mut steps = 0usize;
    while let Some(sib) = nxt {
        if sib.start_position().row > end_row || steps >= 4 {
            break;
        }
        if is_comment_kind(sib.kind()) {
            let txt = clean_comment(node_text(sib, src));
            if !txt.is_empty() {
                trailing = Some(txt);
            }
            break;
        }
        if sib.is_named() && !is_ws_text_node(sib, src) {
            break;
        }
        steps += 1;
        nxt = sib.next_sibling();
    }

    Trivia {
        leading: leading_rev,
        trailing,
        blank_lines_before: 0,
    }
}

pub(crate) fn collect_header_trailing(
    body_node: Node<'_>,
    src: &str,
    opts: &TranspileOpts,
) -> Option<String> {
    if !opts.preserve_docs {
        return None;
    }
    let open_row = header_open_row(body_node);
    let mut cur = body_node.walk();
    for ch in body_node.children(&mut cur) {
        if is_comment_kind(ch.kind()) {
            if ch.start_position().row == open_row {
                let txt = clean_comment(node_text(ch, src));
                if !txt.is_empty() {
                    return Some(txt);
                }
            }
        } else if ch.is_named() {
            break;
        }
    }
    let mut prev = body_node.prev_sibling();
    while let Some(p) = prev {
        if is_comment_kind(p.kind()) {
            if p.start_position().row == open_row {
                let txt = clean_comment(node_text(p, src));
                if !txt.is_empty() {
                    return Some(txt);
                }
            }
            prev = p.prev_sibling();
        } else {
            break;
        }
    }
    None
}

fn header_open_row(body_node: Node<'_>) -> usize {
    if let Some(fc) = body_node.child(0)
        && fc.kind() == "{"
    {
        return fc.end_position().row;
    }
    let mut p_sib = body_node.prev_sibling();
    while let Some(p) = p_sib {
        if !is_comment_kind(p.kind()) {
            return p.end_position().row;
        }
        p_sib = p.prev_sibling();
    }
    body_node.start_position().row
}

fn is_header_trailing_comment(comment: Node<'_>) -> bool {
    let Some(parent) = comment.parent() else { return false };
    if !matches!(
        parent.kind(),
        "block"
            | "match_block"
            | "statement_block"
            | "compound_statement"
            | "block_statement"
            | "statements"
            | "body_statement"
            | "switch_block"
    ) {
        return false;
    }
    let Some(gp) = parent.parent() else { return false };
    if !matches!(
        gp.kind(),
        "while_statement"
            | "while_expression"
            | "while"
            | "for_statement"
            | "for_in_statement"
            | "for_expression"
            | "for_range_loop"
            | "foreach_statement"
            | "enhanced_for_statement"
            | "for"
            | "loop_expression"
            | "match_expression"
            | "match_statement"
            | "switch_statement"
            | "switch_expression"
            | "when_expression"
            | "expression_switch_statement"
            | "case"
            | "if_statement"
            | "if_expression"
            | "if"
            | "elif_clause"
            | "else_if_clause"
            | "else_clause"
            | "else"
            | "try_statement"
            | "try_expression"
            | "catch_clause"
            | "except_clause"
            | "catch_block"
            | "finally_clause"
            | "finally_block"
    ) {
        return false;
    }
    let mut prev = comment.prev_sibling();
    while let Some(p) = prev {
        if !is_comment_kind(p.kind()) && p.is_named() {
            return false;
        }
        prev = p.prev_sibling();
    }
    comment.start_position().row == header_open_row(parent)
}

fn is_ws_text_node(node: Node<'_>, src: &str) -> bool {
    matches!(node.kind(), "CharData" | "text" | "jsx_text") && node_text(node, src).trim().is_empty()
}

fn is_prev_sibling_trailing_comment(comment: Node<'_>, src: &str) -> bool {
    let row = comment.start_position().row;
    let mut prev = comment.prev_sibling();
    let mut steps = 0usize;
    while let Some(sib) = prev {
        if sib.end_position().row < row || steps >= 8 {
            return false;
        }
        if is_comment_kind(sib.kind()) {
            if sib.start_position().row < row {
                return false;
            }
            steps += 1;
            prev = sib.prev_sibling();
            continue;
        }
        if sib.is_named() && !is_ws_text_node(sib, src) {
            return sib.end_position().row == row;
        }
        steps += 1;
        prev = sib.prev_sibling();
    }
    false
}
