use crate::r5::bash_abort_bounds::{
    compute_list_abort_end_with_cond, find_child_kind, has_single_bg_amp, is_negated_pipeline,
    sweep_until_bg,
};
use crate::r5::bash_abort_flat::subshell_sole_cmd_bang;
use crate::r5::bash_deps_hd_case::{
    case_item_guaranteed_arm, case_later_arms_cannot_match, next_non_comment_sibling,
};
use crate::r5::bash_time_bounds::{
    is_close_brace_node, is_split_bang_brace_open, split_brace_starts_pipe,
};
use crate::r5::bash_time_brace::{
    close_brace_starts_pipeline, initial_program_brace_depth, open_braces_in_node,
};

pub(super) fn push_cond_abort_range(
    p: tree_sitter::Node<'_>,
    cur: tree_sitter::Node<'_>,
    neg: bool,
    src: &str,
    abort_ranges: &mut Vec<(usize, usize)>,
) {
    match p.kind() {
        "if_statement" | "elif_clause" => {
            let Some(then_tok) = find_child_kind(p, "then") else { return };
            if cur.start_byte() >= then_tok.start_byte()
                || next_non_comment_sibling(cur).is_some_and(|n| n.start_byte() < then_tok.end_byte())
            {
                return;
            }
            if !neg {
                let mut branch_end = p.end_byte();
                let mut has_alt = false;
                let mut sib = then_tok.next_named_sibling();
                while let Some(s) = sib {
                    if matches!(s.kind(), "elif_clause" | "else_clause") {
                        branch_end = s.start_byte();
                        has_alt = true;
                        break;
                    }
                    sib = s.next_named_sibling();
                }
                if branch_end > then_tok.end_byte() {
                    abort_ranges.push((then_tok.end_byte(), branch_end));
                }
                if !has_alt && p.kind() == "if_statement" {
                    let post_end = compute_list_abort_end_with_cond(p, src, true, false, abort_ranges);
                    if post_end > p.end_byte() { abort_ranges.push((p.end_byte(), post_end)); }
                } else if !has_alt
                    && p.kind() == "elif_clause"
                    && next_non_comment_sibling(p).is_none()
                    && let Some(if_stmt) = p.parent().filter(|gp| gp.kind() == "if_statement")
                {
                    let post_end = compute_list_abort_end_with_cond(if_stmt, src, true, false, abort_ranges);
                    if post_end > if_stmt.end_byte() { abort_ranges.push((if_stmt.end_byte(), post_end)); }
                }
            } else if p.kind() == "if_statement" {
                if let Some(first_alt) = (0..p.named_child_count())
                    .filter_map(|i| p.named_child(i as u32))
                    .find(|c| matches!(c.kind(), "elif_clause" | "else_clause"))
                {
                    let fi_s = find_child_kind(p, "fi").map_or(p.end_byte(), |f| f.start_byte());
                    if fi_s > first_alt.start_byte() {
                        abort_ranges.push((first_alt.start_byte(), fi_s));
                    }
                }
            } else if let Some(next_alt) = next_non_comment_sibling(p)
                .filter(|s| matches!(s.kind(), "elif_clause" | "else_clause"))
                && let Some(if_stmt) = p.parent().filter(|gp| gp.kind() == "if_statement")
            {
                let fi_s = find_child_kind(if_stmt, "fi").map_or(if_stmt.end_byte(), |f| f.start_byte());
                if fi_s > next_alt.start_byte() {
                    abort_ranges.push((next_alt.start_byte(), fi_s));
                }
            }
        }
        "while_statement" => {
            let is_while = p.child(0).is_some_and(|c| c.kind() == "while");
            let is_until = p.child(0).is_some_and(|c| c.kind() == "until");
            if ((is_while && !neg) || (is_until && neg))
                && let Some(dg) = next_non_comment_sibling(cur)
                && dg.kind() == "do_group"
            {
                abort_ranges.push((dg.start_byte(), dg.end_byte()));
                let post_end = compute_list_abort_end_with_cond(p, src, true, false, abort_ranges);
                if post_end > p.end_byte() {
                    abort_ranges.push((p.end_byte(), post_end));
                }
            }
        }
        _ => {}
    }
}

pub(super) fn compute_abort_end_scoped(
    node: tree_sitter::Node<'_>,
    src: &str,
    allow_nl_clear: bool,
    isolate_sub: bool,
    abort_ranges: &mut Vec<(usize, usize)>,
) -> usize {
    let mut cur = node;
    while let Some(parent) = cur.parent() {
        match parent.kind() {
            "command_substitution" | "process_substitution" => {
                let (end, hit_bg) = sweep_until_bg(cur, parent, src);
                if isolate_sub || hit_bg {
                    return end;
                }
                cur = parent;
            }
            "subshell" => {
                let (end, hit_bg) = sweep_until_bg(cur, parent, src);
                if hit_bg {
                    return end;
                }
                let sole_cmd_bang = subshell_sole_cmd_bang(parent, cur, src);
                return compute_list_abort_end_with_cond(parent, src, sole_cmd_bang, false, abort_ranges);
            }
            "else_clause" => return sweep_until_bg(cur, parent, src).0,
            "negated_command" => {
                cur = parent;
            }
            "case_item" => {
                let (end, hit_bg) = sweep_until_bg(cur, parent, src);
                if hit_bg {
                    return end;
                }
                let tail = &src[end..parent.end_byte()];
                let t_end = tail.trim_end();
                let is_dsemi_amp = t_end.ends_with(";;&");
                let is_semi_amp = !is_dsemi_amp && t_end.ends_with(";&");
                if !is_semi_amp
                    && case_item_guaranteed_arm(parent, src)
                    && let Some(cs) = parent.parent().filter(|p| p.kind() == "case_statement")
                {
                    if !is_dsemi_amp {
                        cur = cs;
                        continue;
                    }
                    if case_later_arms_cannot_match(parent, src) {
                        let post_end = compute_abort_end_scoped(cs, src, allow_nl_clear, isolate_sub, abort_ranges);
                        if post_end > cs.end_byte() {
                            abort_ranges.push((cs.end_byte(), post_end));
                        }
                    }
                }
                return end;
            }
            "elif_clause" => {
                let then_tok = find_child_kind(parent, "then");
                let (end, hit_bg) = sweep_until_bg(cur, parent, src);
                if hit_bg || then_tok.is_some_and(|t| cur.start_byte() >= t.end_byte()) {
                    return end;
                }
                if let Some(if_stmt) = parent.parent() && if_stmt.kind() == "if_statement" {
                    return end.max(sweep_until_bg(parent, if_stmt, src).0);
                }
                return end;
            }
            "if_statement" => {
                if let Some(t) = find_child_kind(parent, "then") && cur.start_byte() >= t.end_byte() {
                    let (mut end, mut sib) = (cur.end_byte(), cur.next_named_sibling());
                    while let Some(s) = sib {
                        if matches!(s.kind(), "elif_clause" | "else_clause") {
                            break;
                        }
                        if crate::r5::bash_abort_bounds::has_single_bg_amp(&src[end..s.start_byte()]) {
                            return end;
                        }
                        end = s.end_byte();
                        sib = s.next_named_sibling();
                    }
                    return end;
                }
                let (end, hit_bg) = sweep_until_bg(cur, parent, src);
                if hit_bg {
                    return end;
                }
                cur = parent;
            }
            "do_group" | "compound_statement" => {
                let (end, hit_bg) = sweep_until_bg(cur, parent, src);
                if hit_bg {
                    return end;
                }
                cur = parent;
            }
            "pipeline" => {
                if is_split_bang_brace_open(cur, src) && split_brace_starts_pipe(cur, src) {
                    return cur.end_byte();
                }
                if next_non_comment_sibling(cur).is_some() {
                    return cur.end_byte();
                }
                let neg = is_negated_pipeline(parent, src);
                return compute_list_abort_end_with_cond(parent, src, neg, false, abort_ranges);
            }
            "program" => {
                let mut brace_depth = initial_program_brace_depth(cur, src);
                let (mut end, mut sib) = (cur.end_byte(), cur.next_named_sibling());
                while let Some(s) = sib {
                    let prev_brace_depth = brace_depth;
                    let gap = &src[end..s.start_byte()];
                    if (prev_brace_depth == 0 && allow_nl_clear && gap.contains('\n'))
                        || has_single_bg_amp(gap)
                    {
                        break;
                    }
                    let opens = open_braces_in_node(s, src);
                    if opens > 0 {
                        if prev_brace_depth > 0 {
                            brace_depth += opens;
                        }
                    } else if brace_depth > 0
                        && let Some(close_cmd) = is_close_brace_node(s, src)
                    {
                        brace_depth -= 1;
                        if brace_depth == 0 && close_brace_starts_pipeline(close_cmd, s) {
                            return s.start_byte();
                        }
                    }
                    end = s.end_byte();
                    sib = s.next_named_sibling();
                }
                return end;
            }
            _ => cur = parent,
        }
    }
    node.end_byte()
}
