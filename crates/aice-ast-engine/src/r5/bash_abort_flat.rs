use crate::r5::bash_abort::{
    heredoc_cmdsub_tail_allows_abort, heredoc_redirect_aborts, node_abort_kind,
};
use crate::r5::bash_abort_bounds::{compute_list_abort_end_with_cond, is_bang_command_wrapper};
use crate::r5::bash_deps_hd_case::next_non_comment_sibling;
use crate::r5::bash_subst::ExpAbort;
use crate::r5::bash_time_bounds::{find_brace_close_pair, prev_non_comment_sibling};
use crate::r5::bash_time_brace::{open_braces_in_node, time_brace_is_bang_negated};
use crate::r5::cst_helpers::node_text;

pub(super) fn cmdsub_has_hd_bang_abort(sub: tree_sitter::Node<'_>, src: &str) -> bool {
    let mut stack = Vec::new();
    for i in 0..sub.named_child_count() {
        if let Some(c) = sub.named_child(i as u32) { stack.push(c); }
    }
    while let Some(n) = stack.pop() {
        match n.kind() {
            "command_substitution" | "process_substitution" | "heredoc_body" => {}
            "heredoc_redirect" => {
                if heredoc_redirect_aborts(n, src) && heredoc_cmdsub_tail_allows_abort(n, src) == Some(true) {
                    return true;
                }
            }
            _ => {
                for i in 0..n.named_child_count() {
                    if let Some(c) = n.named_child(i as u32) { stack.push(c); }
                }
            }
        }
    }
    false
}

pub(super) fn node_has_cmdsub_closed_abort_neg(node: tree_sitter::Node<'_>, src: &str) -> Option<bool> {
    let mut stack = vec![node];
    let mut saw_hd_bang = false;
    while let Some(n) = stack.pop() {
        match n.kind() {
            "command_substitution" => {
                if !node_text(n, src).starts_with('`') {
                    if node_abort_kind(n, src, false) == ExpAbort::ClosedBadSub {
                        return Some(false);
                    }
                    if cmdsub_has_hd_bang_abort(n, src) {
                        saw_hd_bang = true;
                    }
                }
            }
            "heredoc_redirect" | "heredoc_body" => {}
            _ => {
                for i in 0..n.named_child_count() {
                    if let Some(c) = n.named_child(i as u32) { stack.push(c); }
                }
            }
        }
    }
    saw_hd_bang.then_some(true)
}

fn flat_kw_cmd<'a>(mut s: tree_sitter::Node<'a>, src: &'a str) -> Option<(tree_sitter::Node<'a>, &'a str)> {
    loop {
        if s.kind() == "command" {
            let nm = s.child_by_field_name("name")?;
            let t = src[nm.start_byte()..nm.end_byte()].trim();
            if t == "!" {
                for i in 0..s.named_child_count() {
                    if let Some(c) = s.named_child(i as u32)
                        && !matches!(c.kind(), "command_name" | "comment")
                        && !c.kind().ends_with("redirect")
                    {
                        let wt = src[c.start_byte()..c.end_byte()].trim();
                        if wt == "!" { continue; }
                        return Some((s, wt));
                    }
                }
                return None;
            }
            return Some((s, t));
        }
        if matches!(s.kind(), "list" | "pipeline" | "redirected_statement" | "negated_command") {
            s = (0..s.named_child_count()).filter_map(|i| s.named_child(i as u32)).find(|c| c.kind() != "comment")?;
            continue;
        }
        return None;
    }
}

pub(super) fn push_flat_cond_abort_range(
    stmt_head: tree_sitter::Node<'_>,
    kw: &str,
    cond_neg: bool,
    outer_bang: bool,
    src: &str,
    abort_ranges: &mut Vec<(usize, usize)>,
) {
    let mut sib = next_non_comment_sibling(stmt_head);
    if kw == "if" {
        let (mut depth, mut then_pos, mut alt_pos, mut fi_node) = (0usize, None, None, None);
        while let Some(s) = sib {
            if let Some((cmd_n, k)) = flat_kw_cmd(s, src) {
                match k {
                    "if" => depth += 1,
                    "then" if depth == 0 && then_pos.is_none() => then_pos = Some(s.start_byte()),
                    "elif" | "else" if depth == 0 && alt_pos.is_none() => alt_pos = Some(s.start_byte()),
                    "fi" => {
                        if depth == 0 { fi_node = Some(cmd_n); break; }
                        depth -= 1;
                    }
                    _ => {}
                }
            }
            sib = next_non_comment_sibling(s);
        }
        if let Some(fi_cmd) = fi_node {
            if !cond_neg {
                let start = then_pos.unwrap_or(stmt_head.end_byte());
                let end = alt_pos.unwrap_or(fi_cmd.start_byte());
                if end > start { abort_ranges.push((start, end)); }
                if alt_pos.is_none() {
                    let post_end = compute_list_abort_end_with_cond(fi_cmd, src, !outer_bang, false, abort_ranges);
                    if post_end > fi_cmd.end_byte() { abort_ranges.push((fi_cmd.end_byte(), post_end)); }
                }
            } else if let Some(ap) = alt_pos && fi_cmd.start_byte() > ap {
                abort_ranges.push((ap, fi_cmd.start_byte()));
            }
        }
    } else if matches!(kw, "while" | "until") {
        let (mut depth, mut do_pos, mut done_node) = (0usize, None, None);
        while let Some(s) = sib {
            if let Some((cmd_n, k)) = flat_kw_cmd(s, src) {
                match k {
                    "while" | "until" | "for" | "select" => depth += 1,
                    "do" if depth == 0 && do_pos.is_none() => do_pos = Some(s.start_byte()),
                    "done" => {
                        if depth == 0 { done_node = Some(cmd_n); break; }
                        depth -= 1;
                    }
                    _ => {}
                }
            }
            sib = next_non_comment_sibling(s);
        }
        if let Some(done_cmd) = done_node && ((kw == "while" && !cond_neg) || (kw == "until" && cond_neg)) {
            let start = do_pos.unwrap_or(stmt_head.end_byte());
            if done_cmd.start_byte() > start { abort_ranges.push((start, done_cmd.start_byte())); }
            let post_end = compute_list_abort_end_with_cond(done_cmd, src, !outer_bang, false, abort_ranges);
            if post_end > done_cmd.end_byte() { abort_ranges.push((done_cmd.end_byte(), post_end)); }
        }
    }
}

pub(super) fn try_flat_cond_from_cmd(
    parent: tree_sitter::Node<'_>,
    cur: tree_sitter::Node<'_>,
    neg: bool,
    src: &str,
    abort_ranges: &mut Vec<(usize, usize)>,
) -> Option<usize> {
    let nm = parent.child_by_field_name("name")?;
    let kw = src[nm.start_byte()..nm.end_byte()].trim();
    if !matches!(kw, "if" | "while" | "until") || next_non_comment_sibling(cur).is_some() {
        return None;
    }
    let mut cond_neg = neg;
    for i in 0..parent.named_child_count() {
        if let Some(c) = parent.named_child(i as u32) {
            if c.id() == cur.id() { break; }
            if c.kind() == "word" && src[c.start_byte()..c.end_byte()].trim() == "!"
                && !src[c.end_byte()..cur.start_byte()].contains('\n')
            {
                cond_neg = !cond_neg;
            }
        }
    }
    let mut stmt_head = parent;
    let mut outer_bang = false;
    while let Some(gp) = stmt_head.parent() {
        if gp.kind() == "negated_command"
            || (gp.kind() == "command" && is_bang_command_wrapper(gp, src))
        {
            if !src[gp.start_byte()..stmt_head.start_byte()].contains('\n') {
                outer_bang = !outer_bang;
            }
            stmt_head = gp;
        } else {
            break;
        }
    }
    push_flat_cond_abort_range(stmt_head, kw, cond_neg, outer_bang, src, abort_ranges);
    Some(stmt_head.end_byte())
}

pub(super) fn try_flat_cond_from_sib(
    cur: tree_sitter::Node<'_>,
    neg: bool,
    src: &str,
    abort_ranges: &mut Vec<(usize, usize)>,
) -> bool {
    let Some(nxt) = next_non_comment_sibling(cur) else { return false };
    if !flat_kw_cmd(nxt, src).is_some_and(|(_, k)| matches!(k, "then" | "do")) {
        return false;
    }
    let mut p_sib = prev_non_comment_sibling(cur);
    while let Some(s) = p_sib {
        if let Some((_, k)) = flat_kw_cmd(s, src) {
            if matches!(k, "if" | "while" | "until") {
                let outer_bang = time_brace_is_bang_negated(s, src);
                push_flat_cond_abort_range(s, k, neg, outer_bang, src, abort_ranges);
                return true;
            }
            if matches!(k, "then" | "elif" | "else" | "fi" | "do" | "done") {
                return false;
            }
        }
        p_sib = prev_non_comment_sibling(s);
    }
    false
}

pub(super) fn subshell_sole_cmd_bang(
    sub: tree_sitter::Node<'_>,
    cur: tree_sitter::Node<'_>,
    src: &str,
) -> bool {
    let Some(first) = (0..sub.named_child_count())
        .filter_map(|i| sub.named_child(i as u32))
        .find(|c| c.kind() != "comment")
    else {
        return false;
    };
    if first.id() == cur.id() && next_non_comment_sibling(first).is_none() {
        return time_brace_is_bang_negated(first, src);
    }
    if open_braces_in_node(first, src) > 0
        && let Some((c0, sib)) = find_brace_close_pair(first, src)
        && sib.id() == c0.id()
        && next_non_comment_sibling(sib).is_none()
        && cur.end_byte() <= sib.end_byte()
    {
        return time_brace_is_bang_negated(first, src);
    }
    false
}
