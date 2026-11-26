use crate::r5::bash_abort_bounds::{
    body_is_bang_negated, has_single_bg_amp, is_bang_command_wrapper, is_negated_pipeline,
};
use crate::r5::bash_hd_unq::hd_header_tail_abort_span_bang;
use crate::r5::cst_helpers::node_text;

pub(super) fn heredoc_cmdsub_tail_allows_abort(hd_node: tree_sitter::Node<'_>, src: &str) -> Option<bool> {
    heredoc_tail_allows_abort(hd_node, src, false)
}

pub(super) fn heredoc_bt_seg_allows_abort(hd_node: tree_sitter::Node<'_>, src: &str) -> Option<bool> {
    heredoc_tail_allows_abort(hd_node, src, true)
}

fn heredoc_tail_allows_abort(hd_node: tree_sitter::Node<'_>, src: &str, is_program_root: bool) -> Option<bool> {
    let mut hdr_end = hd_node.start_byte();
    for i in 0..hd_node.named_child_count() {
        if let Some(c) = hd_node.named_child(i as u32) && c.kind() == "heredoc_start" {
            hdr_end = c.end_byte();
            break;
        }
    }
    let mut in_bang = false;
    if let Some(p) = hd_node.parent()
        && p.kind() == "redirected_statement"
        && let Some(b) = (0..p.named_child_count())
            .filter_map(|i| p.named_child(i as u32))
            .find(|c| !c.kind().ends_with("redirect") && c.kind() != "comment")
    {
        in_bang = body_is_bang_negated(b, src);
    }
    let line_end = src[hdr_end..].find('\n').map_or(src.len(), |p| hdr_end + p);
    let (sup_end, trailing_op) = hd_header_tail_abort_span_bang(src, hdr_end, line_end, false, in_bang);
    if !(trailing_op || sup_end == line_end) {
        return None;
    }
    let mut cur = hd_node;
    let mut cur_neg = in_bang;
    while let Some(p) = cur.parent() {
        if has_single_bg_amp(&src[cur.end_byte()..p.end_byte()]) {
            return None;
        }
        match p.kind() {
            "negated_command" => {
                if !src[p.start_byte()..cur.start_byte()].contains('\n') { cur_neg = !cur_neg; }
                cur = p;
            }
            "command" if is_bang_command_wrapper(p, src) => {
                if !src[p.start_byte()..cur.start_byte()].contains('\n') { cur_neg = !cur_neg; }
                cur = p;
            }
            "redirected_statement" | "command" | "subshell" | "compound_statement" => {
                if next_non_comment_sibling(cur).is_some_and(|n| n.end_byte() > sup_end) { return None; }
                cur = p;
            }
            "pipeline" => {
                if next_non_comment_sibling(cur).is_some_and(|n| n.end_byte() > sup_end) { return None; }
                cur_neg ^= is_negated_pipeline(p, src);
                cur = p;
            }
            "list" => {
                let mut check = cur;
                while let Some(n) = next_non_comment_sibling(check) {
                    if n.end_byte() <= sup_end { check = n; continue; }
                    let gap = &src[check.end_byte()..n.start_byte()];
                    let follows = if cur_neg { gap.contains("||") && !gap.contains("&&") } else { gap.contains("&&") && !gap.contains("||") };
                    if follows && !gap.contains(';') && !has_single_bg_amp(gap) { check = n; } else { return None; }
                }
                cur = p;
            }
            "command_substitution" => {
                return next_non_comment_sibling(cur).is_none_or(|n| n.end_byte() <= sup_end).then_some(cur_neg);
            }
            "program" if is_program_root => {
                return next_non_comment_sibling(cur).is_none_or(|n| n.end_byte() <= sup_end).then_some(cur_neg);
            }
            _ => return None,
        }
    }
    None
}

pub(super) fn next_non_comment_sibling<'a>(node: tree_sitter::Node<'a>) -> Option<tree_sitter::Node<'a>> {
    let mut sib = node.next_named_sibling();
    while let Some(s) = sib {
        if s.kind() != "comment" {
            return Some(s);
        }
        sib = s.next_named_sibling();
    }
    None
}

pub(super) fn simple_lit_word(s: &str) -> Option<&str> {
    if s.is_empty() || s.contains(['$', '`', '\\', '*', '?', '[', '(', '\'', '"']) {
        None
    } else {
        Some(s)
    }
}

pub(super) fn case_item_patterns_info(item: tree_sitter::Node<'_>, src: &str, lit_val: Option<&str>) -> (bool, bool) {
    let rparen_pos = (0..item.child_count())
        .filter_map(|i| item.child(i))
        .find(|c| c.kind() == ")")
        .map_or(item.end_byte(), |c| c.start_byte());
    let mut matches = false;
    let mut all_nonmatch = lit_val.is_some();
    for i in 0..item.named_child_count() {
        if let Some(c) = item.named_child(i as u32)
            && c.end_byte() <= rparen_pos
            && c.kind() != "comment"
        {
            let pat = node_text(c, src).trim();
            if pat == "*" {
                matches = true;
                all_nonmatch = false;
            } else if let Some(w) = lit_val && simple_lit_word(pat) == Some(w) {
                matches = true;
                all_nonmatch = false;
            } else if lit_val.is_none() || simple_lit_word(pat).is_none() {
                all_nonmatch = false;
            }
        }
    }
    (matches, all_nonmatch)
}

pub(super) fn case_item_guaranteed_arm(item: tree_sitter::Node<'_>, src: &str) -> bool {
    let Some(case_stmt) = item.parent().filter(|p| p.kind() == "case_statement") else {
        return false;
    };
    let mut val_node = None;
    for i in 0..case_stmt.named_child_count() {
        if let Some(c) = case_stmt.named_child(i as u32) && c.kind() != "comment" {
            if c.kind() == "case_item" { break; }
            val_node = Some(c);
            break;
        }
    }
    let lit_val = val_node.and_then(|v| simple_lit_word(node_text(v, src).trim()));
    for i in 0..case_stmt.named_child_count() {
        if let Some(c) = case_stmt.named_child(i as u32) && c.kind() == "case_item" {
            let (matches, all_nonmatch) = case_item_patterns_info(c, src, lit_val);
            if c.id() == item.id() { return matches; }
            if !all_nonmatch { return false; }
        }
    }
    false
}

pub(super) fn case_later_arms_cannot_match(item: tree_sitter::Node<'_>, src: &str) -> bool {
    let Some(case_stmt) = item.parent().filter(|p| p.kind() == "case_statement") else {
        return false;
    };
    let mut val_node = None;
    for i in 0..case_stmt.named_child_count() {
        if let Some(c) = case_stmt.named_child(i as u32) && c.kind() != "comment" {
            if c.kind() == "case_item" { break; }
            val_node = Some(c);
            break;
        }
    }
    let Some(w) = val_node.and_then(|v| simple_lit_word(node_text(v, src).trim())) else {
        return false;
    };
    let mut sib = item.next_named_sibling();
    while let Some(c) = sib {
        if c.kind() == "case_item" && !case_item_patterns_info(c, src, Some(w)).1 {
            return false;
        }
        sib = c.next_named_sibling();
    }
    true
}

pub(super) fn cmd_bt_seg_allows_abort(sub_node: tree_sitter::Node<'_>, src: &str) -> bool {
    let anchor;
    let Some(p) = sub_node.parent() else { return false };
    if p.kind() == "command_name" {
        let Some(cmd) = p.parent().filter(|c| c.kind() == "command") else { return false };
        for i in 0..cmd.named_child_count() {
            if let Some(c) = cmd.named_child(i as u32)
                && !matches!(c.kind(), "command_name" | "variable_assignment" | "comment")
                && !c.kind().ends_with("redirect")
            {
                return false;
            }
        }
        anchor = cmd;
    } else if p.kind() == "variable_assignment" {
        if let Some(gp) = p.parent() && gp.kind() == "command" {
            return false;
        }
        let mut sib = p.next_named_sibling();
        while let Some(s) = sib {
            if src[p.end_byte()..s.start_byte()].contains([';', '\n', '&', '|']) {
                break;
            }
            if s.kind() == "variable_assignment" && crate::r5::bash_abort::node_has_any_cmdsub(s) {
                return false;
            }
            sib = s.next_named_sibling();
        }
        anchor = p;
    } else {
        return false;
    }
    let mut cur = anchor;
    while let Some(par) = cur.parent() {
        if has_single_bg_amp(&src[cur.end_byte()..par.end_byte()]) {
            return false;
        }
        match par.kind() {
            "negated_command" => {
                if !src[par.start_byte()..cur.start_byte()].contains('\n') { return false; }
                cur = par;
            }
            "command" if is_bang_command_wrapper(par, src) => {
                if !src[par.start_byte()..cur.start_byte()].contains('\n') { return false; }
                cur = par;
            }
            "redirected_statement" | "variable_assignments" | "subshell" | "compound_statement" => {
                if next_non_comment_sibling(cur).is_some() { return false; }
                cur = par;
            }
            "pipeline" => {
                if next_non_comment_sibling(cur).is_some() || is_negated_pipeline(par, src) { return false; }
                cur = par;
            }
            "list" => {
                let mut check = cur;
                while let Some(n) = next_non_comment_sibling(check) {
                    let gap = &src[check.end_byte()..n.start_byte()];
                    if gap.contains("&&") && !gap.contains("||") && !gap.contains(';') && !has_single_bg_amp(gap) {
                        check = n;
                    } else {
                        return false;
                    }
                }
                cur = par;
            }
            "program" => return next_non_comment_sibling(cur).is_none(),
            _ => return false,
        }
    }
    false
}
