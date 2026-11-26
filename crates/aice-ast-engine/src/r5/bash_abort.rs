use aice_lang_registry::{LanguageId, ParsedTree};

pub(super) use crate::r5::bash_abort_bounds::compute_abort_end_scoped;
pub(super) use crate::r5::bash_abort_flat::node_has_cmdsub_closed_abort_neg;
use crate::r5::bash_bt::{extract_error_backticks, split_bash_backtick_segments};
pub(super) use crate::r5::bash_deps_hd_case::{
    cmd_bt_seg_allows_abort, heredoc_bt_seg_allows_abort, heredoc_cmdsub_tail_allows_abort,
};
pub(super) use crate::r5::bash_hd_unq::{heredoc_redirect_aborts, heredoc_redirect_body_span};
use crate::r5::bash_subst::{ExpAbort, extract_expansion_substitutions_with_tail};
use crate::r5::cst_helpers::node_text;
use crate::ts_pool::parse_tree_sitter;

pub(super) fn expansion_outer_dq_tail<'a>(mut n: tree_sitter::Node<'a>, src: &'a str) -> &'a str {
    let end = n.end_byte();
    while let Some(p) = n.parent() {
        if p.kind() == "string" {
            return &src[end..p.end_byte()];
        }
        if p.kind() != "expansion" {
            break;
        }
        n = p;
    }
    ""
}

pub(super) fn node_abort_kind(
    node: tree_sitter::Node<'_>,
    src: &str,
    init_in_dq: bool,
) -> ExpAbort {
    let mut stack = Vec::new();
    let mut found_closed = false;
    if matches!(node.kind(), "command_substitution" | "process_substitution") {
        if node.kind() == "command_substitution" && node_text(node, src).starts_with('`') {
            return ExpAbort::None;
        }
        for i in 0..node.named_child_count() {
            if let Some(c) = node.named_child(i as u32) {
                stack.push((c, false, true));
            }
        }
    } else {
        stack.push((node, init_in_dq || node.kind() == "string", false));
    }
    while let Some((n, in_dq, in_sub)) = stack.pop() {
        match n.kind() {
            "expansion" => {
                let tail = if in_dq { expansion_outer_dq_tail(n, src) } else { "" };
                let a = extract_expansion_substitutions_with_tail(node_text(n, src), in_dq, false, tail).1;
                if a.is_parse_or_unclosed() {
                    return a;
                }
                if a == ExpAbort::ClosedBadSub {
                    found_closed = true;
                }
                for i in 0..n.named_child_count() {
                    if let Some(c) = n.named_child(i as u32) {
                        stack.push((c, in_dq, in_sub));
                    }
                }
            }
            "command_substitution" | "process_substitution" => {
                if n.kind() == "command_substitution" && node_text(n, src).starts_with('`') {
                    continue;
                }
                let sub_a = node_abort_kind(n, src, false);
                if sub_a.is_parse_or_unclosed() {
                    return sub_a;
                }
            }
            "heredoc_redirect" => {
                if in_sub && heredoc_redirect_aborts(n, src) && heredoc_cmdsub_tail_allows_abort(n, src) == Some(false) {
                    found_closed = true;
                }
            }
            "heredoc_body" => {}
            _ => {
                let child_dq = in_dq || n.kind() == "string";
                for i in 0..n.named_child_count() {
                    if let Some(c) = n.named_child(i as u32) {
                        stack.push((c, child_dq, in_sub));
                    }
                }
            }
        }
    }
    if found_closed { ExpAbort::ClosedBadSub } else { ExpAbort::None }
}

pub(super) fn tree_has_unclosed_param_sq(root: tree_sitter::Node<'_>, src: &str) -> bool {
    let mut stack = vec![(root, false)];
    while let Some((n, in_dq)) = stack.pop() {
        match n.kind() {
            "expansion" => {
                let tail = if in_dq { expansion_outer_dq_tail(n, src) } else { "" };
                if extract_expansion_substitutions_with_tail(node_text(n, src), in_dq, false, tail).1
                    == ExpAbort::UnclosedSq
                {
                    return true;
                }
                for i in 0..n.named_child_count() {
                    if let Some(c) = n.named_child(i as u32) {
                        stack.push((c, in_dq));
                    }
                }
            }
            "command_substitution" if node_text(n, src).starts_with('`') => {}
            "heredoc_redirect" | "heredoc_body" => {}
            _ => {
                let child_dq = in_dq || n.kind() == "string";
                for i in 0..n.named_child_count() {
                    if let Some(c) = n.named_child(i as u32) {
                        stack.push((c, child_dq));
                    }
                }
            }
        }
    }
    false
}

pub(super) fn node_has_cmdsub_unclosed(node: tree_sitter::Node<'_>, src: &str) -> bool {
    let mut stack = vec![node];
    while let Some(n) = stack.pop() {
        match n.kind() {
            "command_substitution" | "process_substitution" => {
                if !(n.kind() == "command_substitution" && node_text(n, src).starts_with('`'))
                    && node_abort_kind(n, src, false).is_parse_or_unclosed()
                {
                    return true;
                }
            }
            "heredoc_redirect" | "heredoc_body" => {}
            _ => {
                for i in 0..n.named_child_count() {
                    if let Some(c) = n.named_child(i as u32) {
                        stack.push(c);
                    }
                }
            }
        }
    }
    false
}

pub(super) fn node_has_any_cmdsub(node: tree_sitter::Node<'_>) -> bool {
    let mut stack = vec![node];
    while let Some(n) = stack.pop() {
        if n.kind() == "command_substitution" {
            return true;
        }
        if matches!(n.kind(), "heredoc_redirect" | "heredoc_body") {
            continue;
        }
        for i in 0..n.named_child_count() {
            if let Some(c) = n.named_child(i as u32) {
                stack.push(c);
            }
        }
    }
    false
}

fn bt_segment_aborts_neg(seg: &str) -> Option<bool> {
    bt_segment_aborts_depth(seg, 0)
}

fn bt_segment_aborts_depth(seg: &str, depth: usize) -> Option<bool> {
    if depth > 16 { return None; }
    let Ok(ParsedTree::TreeSitter { tree, .. }) = parse_tree_sitter(LanguageId::Bash, seg) else {
        return None;
    };
    let Ok(guard) = tree.lock() else { return None };
    let root = guard.root_node();
    if node_abort_kind(root, seg, false) != ExpAbort::None || tree_has_unclosed_param_sq(root, seg) {
        return Some(false);
    }
    if root.has_error() {
        let (_, _, usq, huq) = extract_error_backticks(seg);
        if usq.is_some() || huq {
            return Some(false);
        }
    }
    let mut stack = vec![root];
    while let Some(n) = stack.pop() {
        match n.kind() {
            "command_substitution" => {
                let txt = node_text(n, seg);
                if txt.starts_with('`') {
                    if cmd_bt_seg_allows_abort(n, seg) {
                        let in_dq = n.parent().is_some_and(|p| p.kind() == "string");
                        if let Some(neg) = split_bash_backtick_segments(txt, in_dq, 0)
                            .iter()
                            .find_map(|s| bt_segment_aborts_depth(s, depth + 1))
                        {
                            return Some(neg);
                        }
                    }
                    continue;
                }
            }
            "heredoc_redirect" => {
                if heredoc_redirect_aborts(n, seg)
                    && let Some(neg) = heredoc_bt_seg_allows_abort(n, seg)
                {
                    return Some(neg);
                }
                continue;
            }
            "heredoc_body" => continue,
            _ => {}
        }
        for i in 0..n.named_child_count() {
            if let Some(c) = n.named_child(i as u32) { stack.push(c); }
        }
    }
    None
}

pub(super) fn node_has_bt_abort_neg(node: tree_sitter::Node<'_>, src: &str) -> Option<bool> {
    let mut stack = vec![node];
    while let Some(n) = stack.pop() {
        match n.kind() {
            "command_substitution" => {
                let txt = node_text(n, src);
                if txt.starts_with('`') {
                    let in_dq = n.parent().is_some_and(|p| p.kind() == "string");
                    if let Some(neg) = split_bash_backtick_segments(txt, in_dq, 0)
                        .iter()
                        .find_map(|s| bt_segment_aborts_neg(s))
                    {
                        return Some(neg);
                    }
                    continue;
                }
            }
            "heredoc_redirect" | "heredoc_body" => continue,
            _ => {}
        }
        for i in 0..n.named_child_count() {
            if let Some(c) = n.named_child(i as u32) { stack.push(c); }
        }
    }
    None
}
