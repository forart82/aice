use aice_lang_registry::DepEdge;

use crate::r5::bash::push_simple_command;
use crate::r5::bash_abort::{
    compute_abort_end_scoped, expansion_outer_dq_tail, node_abort_kind,
    node_has_bt_abort_neg, node_has_cmdsub_closed_abort_neg,
};
use crate::r5::bash_abort_bounds::compute_list_abort_end_with_cond;
use crate::r5::bash_bt::split_bash_backtick_segments;
use crate::r5::bash_cmd_helpers::{
    find_hd_slot_pos, is_bash_assign_lhs, is_bash_env_assign_node, unwrap_bang_command,
};
use crate::r5::bash_deps::{find_missing_semi_cmd, later_sibling_has_cmdsub};
use crate::r5::bash_deps_hd::handle_heredoc_redirect_dep;
use crate::r5::bash_time_brace::is_fd0_input_redir_without_cmd;
use crate::r5::bash_hd_meta::HdSlot;
use crate::r5::bash_subst::{ExpAbort, extract_expansion_substitutions_with_tail};
use crate::r5::cst_helpers::node_text;

#[allow(clippy::too_many_arguments)]
pub(super) fn walk_bash_deps_cst<'a>(
    root: tree_sitter::Node<'a>,
    src: &str,
    deps: &mut Vec<DepEdge>,
    depth: usize,
    max_depth: usize,
    is_inner_subst: bool,
    err_bt_spans: &[(usize, usize)],
    err_unclosed_sq: Option<usize>,
    hd_slots: &mut [(String, Vec<HdSlot>)],
    pending: &mut Vec<(String, usize, bool)>,
) {
    let mut stack = vec![(root, false, false)];
    let mut abort_until = 0usize;
    let mut abort_ranges: Vec<(usize, usize)> = Vec::new();
    let mut merged_cmds: Vec<usize> = Vec::new();
    while let Some((node, in_param_dq, in_direct_dq)) = stack.pop() {
        let mut child_ctx = (in_param_dq, in_direct_dq);
        if node.start_byte() < abort_until
            || abort_ranges.iter().any(|&(s, e)| node.start_byte() >= s && node.start_byte() < e)
            || (!err_bt_spans.is_empty()
                && err_bt_spans
                    .iter()
                    .any(|&(bs, be)| node.start_byte() >= bs && node.end_byte() <= be))
            || err_unclosed_sq.is_some_and(|qs| node.start_byte() >= qs)
        {
            continue;
        }
        match node.kind() {
            "word" if node.parent().is_some_and(|p| p.kind() == "file_redirect") => {
                if depth + 1 < max_depth
                    && let Some((si, idx)) = find_hd_slot_pos(node_text(node, src), hd_slots)
                {
                    let subs = std::mem::take(&mut hd_slots[si].1[idx].subs);
                    for inner in subs {
                        pending.push((inner, depth + 1, true));
                    }
                }
                continue;
            }
            "command_substitution" => {
                let txt = node_text(node, src);
                if txt.starts_with('`') && txt.ends_with('`') && txt.len() >= 2 {
                    if depth + 1 < max_depth {
                        let glued_kind = if in_direct_dq {
                            0
                        } else if node.parent().is_some_and(|p| {
                            p.kind() == "variable_assignment"
                                || (p.kind() == "concatenation"
                                    && p.parent().is_some_and(|gp| gp.kind() == "variable_assignment"))
                        }) {
                            1
                        } else if node.parent().is_some_and(|p| p.kind() == "concatenation")
                            && node.prev_named_sibling().is_some()
                        {
                            2
                        } else {
                            0
                        };
                        for inner in split_bash_backtick_segments(txt, in_direct_dq, glued_kind) {
                            pending.push((inner, depth + 1, true));
                        }
                    }
                    continue;
                }
                if node_abort_kind(node, src, false).is_parse_or_unclosed() {
                    abort_until = abort_until.max(compute_abort_end_scoped(
                        node, src, !is_inner_subst, false, &mut abort_ranges,
                    ));
                    continue;
                }
                child_ctx = (false, false);
            }
            "process_substitution" => {
                if node_abort_kind(node, src, false).is_parse_or_unclosed() {
                    abort_until = abort_until.max(compute_abort_end_scoped(
                        node, src, !is_inner_subst, false, &mut abort_ranges,
                    ));
                    continue;
                }
                child_ctx = (false, false);
            }
            "expansion" => {
                let tail = if in_param_dq { expansion_outer_dq_tail(node, src) } else { "" };
                let (subs, abort) =
                    extract_expansion_substitutions_with_tail(node_text(node, src), in_param_dq, false, tail);
                let child_abort = node_abort_kind(node, src, in_param_dq);
                if abort.is_parse_or_unclosed() || child_abort.is_parse_or_unclosed() {
                    abort_until = abort_until.max(compute_abort_end_scoped(
                        node, src, !is_inner_subst, false, &mut abort_ranges,
                    ));
                    continue;
                }
                if depth + 1 < max_depth {
                    for inner in subs {
                        pending.push((inner, depth + 1, true));
                    }
                }
                if abort == ExpAbort::ClosedBadSub {
                    if let Some((rs, neg)) = is_fd0_input_redir_without_cmd(node, src) {
                        let end = compute_list_abort_end_with_cond(rs, src, neg, false, &mut abort_ranges);
                        if end > rs.end_byte() {
                            abort_ranges.push((rs.end_byte(), end));
                        }
                    } else {
                        abort_until = abort_until.max(compute_abort_end_scoped(
                            node, src, !is_inner_subst, true, &mut abort_ranges,
                        ));
                    }
                }
                continue;
            }
            "heredoc_redirect" => {
                handle_heredoc_redirect_dep(
                    node, src, depth, max_depth, is_inner_subst, child_ctx, pending, &mut stack,
                    &mut abort_until, &mut abort_ranges,
                );
                continue;
            }
            "redirected_statement" => {
                let (mut body, mut redirs) = (None, Vec::new());
                for i in 0..node.named_child_count() {
                    if let Some(c) = node.named_child(i as u32) {
                        if c.kind().ends_with("redirect") {
                            redirs.push(c);
                        } else if body.is_none() {
                            body = Some(c);
                        }
                    }
                }
                if let Some(b) = body && let Some(cmd) = unwrap_bang_command(b, src) {
                    let (outer, extra_cmds) = if let Some((next_outer, extra_cmd)) = find_missing_semi_cmd(node, src) {
                        merged_cmds.push(extra_cmd.id());
                        (next_outer, vec![extra_cmd])
                    } else {
                        (node, Vec::new())
                    };
                    push_simple_command(
                        outer, cmd, &extra_cmds, &redirs, src, hd_slots, deps, &mut stack, &mut abort_until,
                        &mut abort_ranges, (child_ctx.0, child_ctx.1, !is_inner_subst),
                    );
                    continue;
                }
                for r in redirs.into_iter().rev() {
                    stack.push((r, child_ctx.0, child_ctx.1));
                }
                if let Some(b) = body {
                    stack.push((b, child_ctx.0, child_ctx.1));
                }
                continue;
            }
            "string" => {
                if !in_param_dq && node_abort_kind(node, src, true).is_parse_or_unclosed() {
                    abort_until = abort_until.max(compute_abort_end_scoped(
                        node, src, !is_inner_subst, false, &mut abort_ranges,
                    ));
                    continue;
                }
                child_ctx = (true, !in_param_dq);
            }
            "variable_assignment" => {
                if !node.parent().is_some_and(|p| p.kind() == "command")
                    && !later_sibling_has_cmdsub(node, src)
                    && let Some(hd_neg) = node_has_bt_abort_neg(node, src)
                        .or_else(|| node_has_cmdsub_closed_abort_neg(node, src))
                {
                    let mut outer = node;
                    while let Some(p) = outer.parent()
                        && matches!(p.kind(), "variable_assignments" | "redirected_statement")
                    {
                        outer = p;
                    }
                    let end = compute_list_abort_end_with_cond(node, src, hd_neg, false, &mut abort_ranges);
                    if end > outer.end_byte() {
                        abort_ranges.push((outer.end_byte(), end));
                    }
                }
                if let Some(name_n) = node.child_by_field_name("name") && name_n.kind() == "subscript" {
                    stack.push((name_n, child_ctx.0, child_ctx.1));
                    for i in (0..node.named_child_count()).rev() {
                        if let Some(c) = node.named_child(i as u32) && c.id() != name_n.id() {
                            stack.push((c, child_ctx.0, child_ctx.1));
                        }
                    }
                    continue;
                }
            }
            "concatenation" if is_bash_env_assign_node(node, src) => {
                let raw = node_text(node, src);
                if let Some((eq_rel, _)) = raw.match_indices('=').find(|&(i, _)| is_bash_assign_lhs(raw[..i].trim())) {
                    let eq_byte = node.start_byte() + eq_rel;
                    for i in (0..node.named_child_count()).rev() {
                        if let Some(c) = node.named_child(i as u32) && c.start_byte() < eq_byte {
                            stack.push((c, child_ctx.0, child_ctx.1));
                        }
                    }
                    for i in (0..node.named_child_count()).rev() {
                        if let Some(c) = node.named_child(i as u32) && c.start_byte() >= eq_byte {
                            stack.push((c, child_ctx.0, child_ctx.1));
                        }
                    }
                    continue;
                }
            }
            "command" => {
                if merged_cmds.contains(&node.id()) {
                    continue;
                }
                push_simple_command(
                    node, node, &[], &[], src, hd_slots, deps, &mut stack, &mut abort_until, &mut abort_ranges,
                    (child_ctx.0, child_ctx.1, !is_inner_subst),
                );
                continue;
            }
            _ => {}
        }
        for i in (0..node.named_child_count()).rev() {
            if let Some(c) = node.named_child(i as u32) {
                stack.push((c, child_ctx.0, child_ctx.1));
            }
        }
    }
}
