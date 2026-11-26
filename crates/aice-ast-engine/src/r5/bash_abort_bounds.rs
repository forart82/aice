use crate::r5::bash_abort_cond::push_cond_abort_range;
use crate::r5::bash_abort_flat::{try_flat_cond_from_cmd, try_flat_cond_from_sib};
use crate::r5::bash_deps_hd_case::{
    case_item_guaranteed_arm, case_later_arms_cannot_match, next_non_comment_sibling,
};
use crate::r5::bash_time_bounds::{
    is_open_brace_command, is_split_bang_brace_open, is_split_bang_brace_prev_pipe,
    is_split_bang_brace_redir, peel_time_command_wrapper, prev_non_comment_sibling,
    split_bang_brace_next, split_brace_starts_pipe,
};

pub(super) use crate::r5::bash_abort_cond::compute_abort_end_scoped;

pub(super) fn has_single_bg_amp(gap: &str) -> bool {
    let b = gap.as_bytes();
    for (i, &c) in b.iter().enumerate() {
        if c == b'&'
            && !b.get(i + 1).is_some_and(|&n| matches!(n, b'&' | b'>'))
            && !(i > 0 && matches!(b[i - 1], b'&' | b'>' | b'<' | b'|' | b';'))
        {
            return true;
        }
    }
    false
}

pub(super) fn find_child_kind<'a>(
    node: tree_sitter::Node<'a>,
    kind: &str,
) -> Option<tree_sitter::Node<'a>> {
    (0..node.child_count())
        .filter_map(|i| node.child(i))
        .find(|c| c.kind() == kind)
}

pub(super) fn sweep_until_bg(
    cur: tree_sitter::Node<'_>,
    parent: tree_sitter::Node<'_>,
    src: &str,
) -> (usize, bool) {
    let (mut end, mut sib) = (cur.end_byte(), cur.next_named_sibling());
    while let Some(s) = sib {
        if has_single_bg_amp(&src[end..s.start_byte()]) {
            return (end, true);
        }
        end = s.end_byte();
        sib = s.next_named_sibling();
    }
    if has_single_bg_amp(&src[end..parent.end_byte()]) {
        return (end, true);
    }
    (end, false)
}

pub(super) fn is_bang_command_wrapper(node: tree_sitter::Node<'_>, src: &str) -> bool {
    node.kind() == "command"
        && node.child_by_field_name("name").is_some_and(|nm| src[nm.start_byte()..nm.end_byte()].trim() == "!")
}

pub(super) use crate::r5::bash_time_brace::body_is_bang_negated;

pub(super) fn is_negated_pipeline(pipeline: tree_sitter::Node<'_>, src: &str) -> bool {
    if is_split_bang_brace_prev_pipe(pipeline, src) {
        return true;
    }
    let Some(first) = (0..pipeline.named_child_count())
        .filter_map(|i| pipeline.named_child(i as u32))
        .find(|c| c.kind() != "comment")
    else {
        return false;
    };
    body_is_bang_negated(first, src)
}

pub(super) fn compute_list_abort_end_with_cond(
    node: tree_sitter::Node<'_>,
    src: &str,
    init_negated: bool,
    mut from_hd: bool,
    abort_ranges: &mut Vec<(usize, usize)>,
) -> usize {
    let mut cur = node;
    let mut neg = init_negated;
    let mut in_split_brace = cur.kind() == "redirected_statement" && is_split_bang_brace_redir(cur, src);
    let mut split_entry_end: Option<usize> = None;
    let mut split_first_in_parent = false;
    let mut applied_outer_pipes: Vec<usize> = Vec::new();
    while let Some(parent) = cur.parent() {
        match parent.kind() {
            "negated_command" => {
                if is_split_bang_brace_open(parent, src) && split_brace_starts_pipe(parent, src) {
                    return parent.end_byte();
                }
                if !src[parent.start_byte()..cur.start_byte()].contains('\n') {
                    neg = !neg;
                }
                cur = parent;
            }
            "command" if is_bang_command_wrapper(parent, src) => {
                if !src[parent.start_byte()..cur.start_byte()].contains('\n') {
                    neg = !neg;
                }
                cur = parent;
            }
            "command" if let Some(b_neg) = peel_time_command_wrapper(parent, src, cur) => {
                neg ^= b_neg;
                cur = parent;
            }
            "command"
                if let Some(end) = try_flat_cond_from_cmd(parent, cur, neg, src, abort_ranges) =>
            {
                return end;
            }
            "command"
                if is_open_brace_command(parent, src, cur) && next_non_comment_sibling(cur).is_none() =>
            {
                in_split_brace = true;
                cur = parent;
            }
            "command_substitution"
                if next_non_comment_sibling(cur).is_none() && !src[parent.start_byte()..].starts_with('`') =>
            {
                let gp_kind = parent.parent().map(|gp| gp.kind());
                if matches!(gp_kind, Some("string" | "variable_assignment" | "command_name")) {
                    cur = parent;
                } else {
                    return cur.end_byte();
                }
            }
            "command_name"
                if parent.parent().is_some_and(|gp| gp.kind() == "command" && gp.named_child_count() == 1) =>
            {
                cur = parent;
            }
            "command" if parent.named_child_count() == 1 && cur.kind() == "command_name" => cur = parent,
            "string"
                if parent.named_child_count() == 1
                    && cur.kind() == "command_substitution"
                    && parent.parent().is_some_and(|gp| gp.kind() == "variable_assignment") =>
            {
                cur = parent;
            }
            "variable_assignment"
                if parent.parent().is_some_and(|gp| !matches!(gp.kind(), "command" | "redirected_statement")) =>
            {
                cur = parent;
            }
            "pipeline" => {
                if is_split_bang_brace_open(cur, src) && split_brace_starts_pipe(cur, src) {
                    return cur.end_byte();
                }
                if next_non_comment_sibling(cur).is_some() {
                    return cur.end_byte();
                }
                if !applied_outer_pipes.contains(&parent.id()) && is_negated_pipeline(parent, src) {
                    neg = !neg;
                    applied_outer_pipes.push(parent.id());
                }
                cur = parent;
            }
            "list" => {
                if prev_non_comment_sibling(cur).is_none() {
                    let mut anc = parent;
                    while let Some(gp) = anc.parent()
                        && gp.kind() == "list"
                        && prev_non_comment_sibling(anc).is_none()
                    {
                        anc = gp;
                    }
                    if let Some(outer_p) = anc.parent().filter(|gp| gp.kind() == "pipeline")
                        && next_non_comment_sibling(anc).is_none()
                        && !applied_outer_pipes.contains(&outer_p.id())
                    {
                        if is_negated_pipeline(outer_p, src) {
                            neg = !neg;
                        }
                        applied_outer_pipes.push(outer_p.id());
                    }
                }
                while let Some(next) = next_non_comment_sibling(cur) {
                    if in_split_brace && let Some(brace_cmd) = split_bang_brace_next(cur, src) {
                        in_split_brace = false;
                        split_entry_end = Some(cur.end_byte());
                        cur = brace_cmd;
                        continue;
                    }
                    let gap = &src[cur.end_byte()..next.start_byte()];
                    let follows = if neg {
                        gap.contains("||") && !gap.contains("&&")
                    } else {
                        gap.contains("&&") && !gap.contains("||")
                    };
                    if follows && !gap.contains(';') && !has_single_bg_amp(gap) {
                        split_entry_end = None;
                        cur = next;
                    } else {
                        return split_entry_end.unwrap_or(cur.end_byte());
                    }
                }
                split_first_in_parent = false;
                cur = parent;
            }
            "redirected_statement" => {
                if is_split_bang_brace_redir(parent, src) {
                    in_split_brace = true;
                }
                cur = parent;
            }
            "variable_assignments" => cur = parent,
            "subshell" if next_non_comment_sibling(cur).is_none() => {
                if from_hd && (split_first_in_parent || prev_non_comment_sibling(cur).is_none()) {
                    neg = false;
                }
                split_first_in_parent = false;
                from_hd = false;
                cur = parent;
            }
            "else_clause" | "do_group" | "compound_statement"
                if next_non_comment_sibling(cur).is_none() =>
            {
                cur = parent;
            }
            "if_statement" | "elif_clause"
                if next_non_comment_sibling(cur).is_none()
                    && find_child_kind(parent, "then").is_some_and(|t| cur.start_byte() >= t.end_byte()) =>
            {
                cur = parent;
            }
            "case_item" if next_non_comment_sibling(cur).is_none() => {
                let tail = &src[cur.end_byte()..parent.end_byte()];
                let t_end = tail.trim_end();
                let is_dsemi_amp = t_end.ends_with(";;&");
                let is_semi_amp = !is_dsemi_amp && t_end.ends_with(";&");
                if !has_single_bg_amp(tail)
                    && !is_semi_amp
                    && case_item_guaranteed_arm(parent, src)
                    && (!is_dsemi_amp || case_later_arms_cannot_match(parent, src))
                {
                    cur = parent;
                } else {
                    return cur.end_byte();
                }
            }
            "case_statement" => cur = parent,
            "if_statement" | "elif_clause" | "while_statement" => {
                if in_split_brace && let Some(brace_cmd) = split_bang_brace_next(cur, src) {
                    in_split_brace = false;
                    split_entry_end = Some(cur.end_byte());
                    split_first_in_parent = prev_non_comment_sibling(cur).is_none();
                    cur = brace_cmd;
                    continue;
                }
                push_cond_abort_range(parent, cur, neg, src, abort_ranges);
                return split_entry_end.unwrap_or(cur.end_byte());
            }
            _ => {
                if in_split_brace && let Some(brace_cmd) = split_bang_brace_next(cur, src) {
                    in_split_brace = false;
                    split_entry_end = Some(cur.end_byte());
                    split_first_in_parent = prev_non_comment_sibling(cur).is_none();
                    cur = brace_cmd;
                    continue;
                }
                if matches!(parent.kind(), "program" | "compound_statement" | "subshell") {
                    try_flat_cond_from_sib(cur, neg, src, abort_ranges);
                }
                return split_entry_end.unwrap_or(cur.end_byte());
            }
        }
    }
    cur.end_byte()
}
