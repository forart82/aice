use aice_lang_registry::{DepEdge, LanguageId, ParsedTree};

use crate::r5::bash_abort::{node_has_any_cmdsub, tree_has_unclosed_param_sq};
use crate::r5::bash_bt::{extract_error_backticks, replace_error_bt_spans};
use crate::r5::bash_deps_hd_case::next_non_comment_sibling;
use crate::r5::bash_deps_walk::walk_bash_deps_cst;
use crate::r5::bash_desync::{
    bash_cst_bt_desynced, bash_cst_compound_bang_desynced, bash_cst_expansions_desynced,
    recover_bash_error_expansions,
};
use crate::r5::bash_hd_desync::{coalesce_bash_continuations, fix_subshell_in_cmdsub};
use crate::r5::bash_hd_meta::HdSlot;
use crate::r5::bash_hd_norm::{recover_bash_heredoc_desync, recover_bash_heredoc_errors};
use crate::ts_pool::parse_tree_sitter;

const MAX_BASH_SUBST_DEPTH: usize = 64;

pub(super) fn later_sibling_has_cmdsub(node: tree_sitter::Node<'_>, src: &str) -> bool {
    if !node.parent().is_some_and(|p| matches!(p.kind(), "variable_assignments" | "redirected_statement")) {
        return false;
    }
    let mut prev = node;
    let mut sib = node.next_named_sibling();
    while let Some(s) = sib {
        if src[prev.end_byte()..s.start_byte()].contains([';', '\n', '&', '|']) {
            break;
        }
        if s.kind() == "variable_assignment" && node_has_any_cmdsub(s) {
            return true;
        }
        prev = s;
        sib = s.next_named_sibling();
    }
    false
}

pub(super) fn find_missing_semi_cmd<'a>(
    node: tree_sitter::Node<'a>,
    src: &str,
) -> Option<(tree_sitter::Node<'a>, tree_sitter::Node<'a>)> {
    let has_err = node.next_sibling().is_some_and(|s| s.is_missing() && s.kind() == ";")
        || node.has_error()
        || node.parent().is_some_and(|p| p.has_error());
    if !has_err {
        return None;
    }
    let next = next_non_comment_sibling(node)?;
    let cmd = if next.kind() == "command" {
        next
    } else if next.kind() == "list" {
        let c0 = (0..next.named_child_count())
            .filter_map(|i| next.named_child(i as u32))
            .find(|c| c.kind() != "comment")?;
        if c0.kind() != "command" { return None; }
        c0
    } else {
        return None;
    };
    if !src[node.end_byte()..cmd.start_byte()].bytes().all(|b| matches!(b, b' ' | b'\t')) {
        return None;
    }
    Some((next, cmd))
}

pub(super) fn first_redirect_start(node: tree_sitter::Node<'_>, extra: &[tree_sitter::Node<'_>], src: &str) -> usize {
    let mut min_b = extra.iter().map(|r| r.start_byte()).min().unwrap_or(usize::MAX);
    for i in 0..node.named_child_count() {
        if let Some(c) = node.named_child(i as u32) && c.kind().ends_with("redirect") {
            min_b = min_b.min(c.start_byte());
        }
    }
    let mut cur = node;
    while let Some(p) = cur.parent() {
        if p.kind() == "redirected_statement" {
            for i in 0..p.named_child_count() {
                if let Some(c) = p.named_child(i as u32) && c.kind().ends_with("redirect") {
                    min_b = min_b.min(c.start_byte());
                }
            }
            break;
        }
        if p.kind() == "negated_command"
            || (!src.is_empty() && crate::r5::bash_abort_bounds::is_bang_command_wrapper(p, src))
        {
            cur = p;
            continue;
        }
        break;
    }
    min_b
}

pub(super) fn walk_bash_deps(root: tree_sitter::Node<'_>, src: &str, deps: &mut Vec<DepEdge>) {
    let mut hd_slots: Vec<(String, Vec<HdSlot>)> = Vec::new();
    let mut worklist: Vec<(String, usize, bool)> = Vec::new();
    if src.contains("\\\n") {
        let coalesced = coalesce_bash_continuations(src);
        if coalesced != src {
            worklist.push((coalesced, 0, false));
        } else {
            walk_bash_deps_inner(root, src, deps, 0, false, &mut worklist, &mut hd_slots);
        }
    } else {
        walk_bash_deps_inner(root, src, deps, 0, false, &mut worklist, &mut hd_slots);
    }
    while let Some((raw_inner, depth, is_inner_subst)) = worklist.pop() {
        let inner = if raw_inner.contains("\\\n") {
            coalesce_bash_continuations(&raw_inner)
        } else {
            raw_inner
        };
        if let Ok(ParsedTree::TreeSitter { tree, .. }) = parse_tree_sitter(LanguageId::Bash, &inner)
            && let Ok(guard) = tree.lock()
        {
            walk_bash_deps_inner(guard.root_node(), &inner, deps, depth, is_inner_subst, &mut worklist, &mut hd_slots);
        }
    }
}

fn next_slot_pfx(src: &str, hd_slots: &[(String, Vec<HdSlot>)]) -> String {
    let mut pfx = format!("_aice_hd_{}_", hd_slots.len());
    while src.contains(&pfx) || hd_slots.iter().any(|(p, _)| p == &pfx) {
        pfx.push('_');
    }
    pfx
}

fn walk_bash_deps_inner(
    root: tree_sitter::Node<'_>,
    src: &str,
    deps: &mut Vec<DepEdge>,
    depth: usize,
    is_inner_subst: bool,
    worklist: &mut Vec<(String, usize, bool)>,
    hd_slots: &mut Vec<(String, Vec<HdSlot>)>,
) {
    let pfx = next_slot_pfx(src, hd_slots);
    if let Some((fixed, slots)) = recover_bash_heredoc_desync(src, &pfx) {
        hd_slots.push((pfx, slots));
        worklist.push((fixed, depth, is_inner_subst));
        return;
    }
    let mut pending: Vec<(String, usize, bool)> = Vec::new();
    let mut err_bt_spans: Vec<(usize, usize)> = Vec::new();
    let mut err_unclosed_sq: Option<usize> = None;
    let mut err_unclosed_q = false;
    let has_bang_desync = bash_cst_compound_bang_desynced(root, src);
    if (root.has_error() || has_bang_desync || bash_cst_expansions_desynced(root, src))
        && depth + 1 < MAX_BASH_SUBST_DEPTH
    {
        if root.has_error()
            && let Some(fixed) = fix_subshell_in_cmdsub(src)
        {
            worklist.push((fixed, depth + 1, is_inner_subst));
            return;
        }
        if !has_bang_desync
            && let Some((cleaned, subs)) = recover_bash_error_expansions(src)
            && (!subs.is_empty() || cleaned != src)
        {
            for inner in subs { pending.push((inner, depth + 1, true)); }
            if cleaned != src {
                pending.push((cleaned, depth + 1, is_inner_subst));
            }
            worklist.extend(pending.into_iter().rev());
            return;
        }
        if (root.has_error() || has_bang_desync) && src.contains("<<") {
            let err_pfx = next_slot_pfx(src, hd_slots);
            if let Some((cleaned, slots)) = recover_bash_heredoc_errors(src, &err_pfx) {
                hd_slots.push((err_pfx, slots));
                worklist.push((cleaned, depth + 1, is_inner_subst));
                return;
            }
        }
    }
    if (root.has_error() && (is_inner_subst || src.contains('`') || src.contains('\'')))
        || src.contains("$'")
        || (src.contains('`') && depth + 1 < MAX_BASH_SUBST_DEPTH)
    {
        let (bts, spans, unclosed_sq, has_unclosed_q) = extract_error_backticks(src);
        if depth + 1 < MAX_BASH_SUBST_DEPTH
            && src.contains('`')
            && !spans.is_empty()
            && (root.has_error() || bash_cst_bt_desynced(root, src, &spans))
        {
            for inner in bts { pending.push((inner, depth + 1, true)); }
            let cleaned = replace_error_bt_spans(src, &spans);
            if cleaned != src {
                pending.push((cleaned, depth + 1, is_inner_subst));
                worklist.extend(pending.into_iter().rev());
                return;
            }
            err_bt_spans = spans;
        }
        if root.has_error() {
            err_unclosed_sq = unclosed_sq;
            err_unclosed_q = has_unclosed_q;
        } else if src.contains("$'") {
            err_unclosed_sq = unclosed_sq;
        }
    }
    if is_inner_subst && (err_unclosed_sq.is_some() || err_unclosed_q || tree_has_unclosed_param_sq(root, src)) {
        return;
    }
    walk_bash_deps_cst(
        root, src, deps, depth, MAX_BASH_SUBST_DEPTH, is_inner_subst,
        &err_bt_spans, err_unclosed_sq, hd_slots, &mut pending,
    );
    worklist.extend(pending.into_iter().rev());
}
