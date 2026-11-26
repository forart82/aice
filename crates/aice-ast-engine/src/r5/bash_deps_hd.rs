use crate::r5::bash::push_hd_tail_node;
use crate::r5::bash_abort::{
    compute_abort_end_scoped, heredoc_redirect_body_span, node_abort_kind,
};
use crate::r5::bash_abort_bounds::{
    body_is_bang_negated, compute_list_abort_end_with_cond, has_single_bg_amp,
    is_bang_command_wrapper, is_negated_pipeline,
};
use crate::r5::bash_abort_cond::push_cond_abort_range;
use crate::r5::bash_cmd_helpers::unwrap_bang_command;
use crate::r5::bash_deps_hd_case::{
    case_item_guaranteed_arm, case_later_arms_cannot_match, next_non_comment_sibling,
};
use crate::r5::bash_desync::is_heredoc_redirect_quoted;
use crate::r5::bash_hd_unq::{
    extract_unquoted_heredoc_substitutions_checked, hd_header_tail_abort_span_bang,
};
use crate::r5::bash_subst::ExpAbort;
use crate::r5::bash_time_bounds::{
    find_time_brace_close, is_split_bang_brace_redir, is_time_brace_open_node,
    prev_non_comment_sibling,
};
use crate::r5::bash_time_brace::{find_enclosing_time_brace_open, time_brace_is_bang_negated};

#[allow(clippy::too_many_arguments)]
pub(super) fn handle_heredoc_redirect_dep<'a>(
    node: tree_sitter::Node<'a>,
    src: &str,
    depth: usize,
    max_depth: usize,
    is_inner_subst: bool,
    child_ctx: (bool, bool),
    pending: &mut Vec<(String, usize, bool)>,
    stack: &mut Vec<(tree_sitter::Node<'a>, bool, bool)>,
    abort_until: &mut usize,
    abort_ranges: &mut Vec<(usize, usize)>,
) {
    let quoted = is_heredoc_redirect_quoted(node, src);
    let (mut hd_aborted, mut hdr_end, mut body_start) = (false, node.start_byte(), usize::MAX);
    let right_start = node.child_by_field_name("right").map_or(usize::MAX, |n| n.start_byte());
    let mut in_bang = false;
    let in_cmd = node.parent().is_some_and(|p| {
        if p.kind() == "command" {
            true
        } else if p.kind() == "redirected_statement" {
            let body = (0..p.named_child_count())
                .filter_map(|i| p.named_child(i as u32))
                .find(|c| !c.kind().ends_with("redirect") && c.kind() != "comment");
            if let Some(b) = body {
                in_bang = body_is_bang_negated(b, src);
                unwrap_bang_command(b, src).is_some()
            } else {
                false
            }
        } else {
            false
        }
    });
    if let Some((he, bs, _)) = heredoc_redirect_body_span(node, src) {
        (hdr_end, body_start) = (he, bs);
    } else {
        for i in 0..node.named_child_count() {
            if let Some(c) = node.named_child(i as u32) && c.kind() == "heredoc_start" {
                hdr_end = c.end_byte();
            }
        }
    }
    let header_word_aborts = !in_cmd
        && (0..node.named_child_count()).filter_map(|i| node.named_child(i as u32)).any(|c| {
            c.start_byte() < body_start.min(right_start)
                && !matches!(c.kind(), "heredoc_start" | "heredoc_end" | "heredoc_body" | "comment")
                && !c.kind().ends_with("redirect")
                && node_abort_kind(c, src, false) != ExpAbort::None
        });
    if !header_word_aborts
        && !quoted
        && let Some((_, bs, be)) = heredoc_redirect_body_span(node, src)
        && bs <= be
        && be <= src.len()
    {
        let (subs, aborted) = extract_unquoted_heredoc_substitutions_checked(&src[bs..be]);
        hd_aborted = aborted;
        if depth + 1 < max_depth {
            for inner in subs {
                pending.push((inner, depth + 1, true));
            }
        }
    }
    let line_end = src[hdr_end..].find('\n').map_or(src.len(), |p| hdr_end + p);
    let sup_end = if !quoted && hd_aborted {
        let (se, trailing_op) = hd_header_tail_abort_span_bang(src, hdr_end, line_end, false, in_bang);
        let mut end = if trailing_op {
            let mut e = if in_bang {
                compute_list_abort_end_with_cond(node, src, true, true, abort_ranges)
            } else {
                compute_abort_end_scoped(node, src, !is_inner_subst, false, abort_ranges)
            };
            if let Some(nl) = src[node.end_byte()..].find('\n') {
                let post_s = node.end_byte() + nl + 1;
                let post_e = src[post_s..].find('\n').map_or(src.len(), |p| post_s + p);
                e = e.max(hd_header_tail_abort_span_bang(src, post_s, post_e, true, in_bang).0);
            }
            e
        } else {
            se
        };
        let mut cur = node;
        let mut cur_neg = in_bang;
        while let Some(p) = cur.parent() {
            match p.kind() {
                "negated_command" => {
                    if !src[p.start_byte()..cur.start_byte()].contains('\n') {
                        cur_neg = !cur_neg;
                    }
                    cur = p;
                }
                "command" if is_bang_command_wrapper(p, src) => {
                    if !src[p.start_byte()..cur.start_byte()].contains('\n') {
                        cur_neg = !cur_neg;
                    }
                    cur = p;
                }
                "subshell" => {
                    if next_non_comment_sibling(cur).is_none_or(|n| n.end_byte() <= end) {
                        let sub_neg = if cur_neg && prev_non_comment_sibling(cur).is_none() {
                            false
                        } else {
                            cur_neg
                        };
                        end = end.max(compute_list_abort_end_with_cond(p, src, sub_neg, true, abort_ranges));
                    }
                    break;
                }
                "compound_statement" => {
                    if next_non_comment_sibling(cur).is_none_or(|n| n.end_byte() <= end) {
                        end = end.max(compute_list_abort_end_with_cond(p, src, cur_neg, true, abort_ranges));
                    }
                    break;
                }
                "pipeline" => {
                    if next_non_comment_sibling(cur).is_none_or(|n| n.end_byte() <= end) {
                        let neg = cur_neg ^ is_negated_pipeline(p, src);
                        end = end.max(compute_list_abort_end_with_cond(p, src, neg, true, abort_ranges));
                    }
                    break;
                }
                "if_statement" | "elif_clause" | "while_statement" => {
                    push_cond_abort_range(p, cur, cur_neg, src, abort_ranges);
                    break;
                }
                "case_item" => {
                    let tail = &src[cur.end_byte()..p.end_byte()];
                    let t_end = tail.trim_end();
                    let is_dsemi_amp = t_end.ends_with(";;&");
                    let is_semi_amp = !is_dsemi_amp && t_end.ends_with(";&");
                    if next_non_comment_sibling(cur).is_none()
                        && !has_single_bg_amp(tail)
                        && !is_semi_amp
                        && case_item_guaranteed_arm(p, src)
                        && let Some(cs) = p.parent()
                    {
                        if !is_dsemi_amp {
                            end = end.max(compute_list_abort_end_with_cond(cs, src, cur_neg, true, abort_ranges));
                        } else if case_later_arms_cannot_match(p, src) {
                            let post_end = compute_list_abort_end_with_cond(cs, src, cur_neg, true, abort_ranges);
                            if post_end > cs.end_byte() {
                                abort_ranges.push((cs.end_byte(), post_end));
                            }
                        }
                    }
                    break;
                }
                "redirected_statement"
                    if next_non_comment_sibling(cur).is_none_or(|n| n.end_byte() <= end) =>
                {
                    if is_time_brace_open_node(p, src)
                        && let Some(close_cmd) = find_time_brace_close(p, src)
                    {
                        let sole_sub = prev_non_comment_sibling(p).is_none()
                            && p.parent().is_some_and(|gp| gp.kind() == "subshell")
                            && close_cmd.parent().is_some_and(|gp| gp.kind() == "subshell")
                            && next_non_comment_sibling(close_cmd).is_none();
                        let neg = if sole_sub { false } else { cur_neg };
                        let post_end = compute_list_abort_end_with_cond(close_cmd, src, neg, true, abort_ranges);
                        if post_end > close_cmd.end_byte() {
                            abort_ranges.push((close_cmd.end_byte(), post_end));
                        }
                        break;
                    }
                    if is_split_bang_brace_redir(p, src) {
                        end = end.max(compute_list_abort_end_with_cond(p, src, cur_neg, true, abort_ranges));
                        break;
                    }
                    cur = p;
                }
                "command" | "list"
                    if next_non_comment_sibling(cur).is_none_or(|n| n.end_byte() <= end) =>
                {
                    cur = p;
                }
                "program" => {
                    if let Some(open_node) = find_enclosing_time_brace_open(cur, src)
                        && let Some(close_cmd) = find_time_brace_close(open_node, src)
                        && !has_single_bg_amp(&src[cur.end_byte()..close_cmd.start_byte()])
                    {
                        let mut no_more_cmds = true;
                        let mut sib = next_non_comment_sibling(cur);
                        while let Some(s) = sib {
                            if s.start_byte() <= close_cmd.start_byte() && s.end_byte() >= close_cmd.end_byte() {
                                break;
                            }
                            if s.end_byte() > end {
                                no_more_cmds = false;
                                break;
                            }
                            sib = next_non_comment_sibling(s);
                        }
                        if no_more_cmds {
                            let neg = cur_neg ^ time_brace_is_bang_negated(open_node, src);
                            let post_end = compute_list_abort_end_with_cond(close_cmd, src, neg, true, abort_ranges);
                            if post_end > close_cmd.end_byte() {
                                abort_ranges.push((close_cmd.end_byte(), post_end));
                            }
                        }
                    }
                    break;
                }
                _ => break,
            }
        }
        *abort_until = (*abort_until).max(end);
        Some(se)
    } else {
        None
    };
    for i in (0..node.named_child_count()).rev() {
        if let Some(c) = node.named_child(i as u32)
            && !matches!(c.kind(), "heredoc_start" | "heredoc_end" | "heredoc_body")
            && c.start_byte() < body_start
            && (!in_cmd || c.kind().ends_with("redirect") || c.start_byte() >= right_start)
        {
            if let Some(se) = sup_end {
                push_hd_tail_node(c, se, stack, child_ctx);
            } else {
                stack.push((c, child_ctx.0, child_ctx.1));
            }
        }
    }
}
