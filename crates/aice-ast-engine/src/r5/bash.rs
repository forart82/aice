use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, DepKind, IntraBlockSelector, LanguageAdapter, LanguageId,
    OutlineView, ParseError, ParsedTree, SliceError, SymbolKind, SymbolNode, SymbolSelector,
};

use crate::r5::bash_abort::{
    compute_abort_end_scoped, heredoc_redirect_aborts, node_abort_kind, node_has_any_cmdsub,
    node_has_bt_abort_neg, node_has_cmdsub_closed_abort_neg, node_has_cmdsub_unclosed,
};
use crate::r5::bash_abort_bounds::compute_list_abort_end_with_cond;
use crate::r5::bash_time_brace::time_brace_is_bang_negated;
use crate::r5::bash_cmd_helpers::{
    bare_cmdsub_node, extract_bash_command_dep_words, has_subscript_lhs, is_bare_unquoted_cmdsub,
    is_bash_env_assign_node, is_hd_slot_aborted, peel_time_wrapper_words, push_redir_children,
};
use crate::r5::bash_deps::{first_redirect_start, walk_bash_deps};
use crate::r5::bash_hd_meta::HdSlot;
use crate::r5::bash_heredoc::unescape_bash_word;
use crate::r5::bash_subst::ExpAbort;
use crate::r5::cst_helpers::{
    field_text, node_text, outline_from_symbols, push_sym, slice_symbol_from_list, with_ts_root,
};
use crate::r5::dep_helpers::collect_schema_comment_deps;
use crate::ts_pool::parse_tree_sitter;

pub struct BashAdapter;

impl LanguageAdapter for BashAdapter {
    fn id(&self) -> LanguageId { LanguageId::Bash }
    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> { parse_tree_sitter(LanguageId::Bash, src) }
    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        with_ts_root(tree, Vec::new(), |root| { let mut out = Vec::new(); walk_bash(root, src, false, &mut out); out })
    }
    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut deps = Vec::new();
            walk_bash_deps(root, src, &mut deps);
            collect_schema_comment_deps(src, "script", &mut deps);
            deps
        })
    }
}

impl AstSlicer for BashAdapter {
    fn slice_symbol(&self, tree: &ParsedTree, src: &str, sel: &SymbolSelector) -> Result<AstSlice, SliceError> {
        slice_symbol_from_list(&self.extract_symbols(tree, src), src, sel)
    }
    fn slice_intra_block(&self, tree: &ParsedTree, src: &str, sel: &IntraBlockSelector) -> Result<AstSlice, SliceError> {
        crate::intra_ast::slice_intra_block(tree, &self.extract_symbols(tree, src), src, sel)
    }
    fn outline(&self, tree: &ParsedTree, src: &str, depth: usize, include_types: bool) -> OutlineView {
        outline_from_symbols(&self.extract_symbols(tree, src), src, depth, include_types)
    }
}

fn walk_bash(root: tree_sitter::Node<'_>, src: &str, init_in_fn: bool, out: &mut Vec<SymbolNode>) {
    let mut stack = vec![(root, init_in_fn)];
    while let Some((node, in_fn)) = stack.pop() {
        let mut child_in_fn = in_fn;
        match node.kind() {
            "function_definition" => {
                if let Some(name) = field_text(node, "name", src) { push_sym(out, name, name, SymbolKind::Function, node, src); }
                child_in_fn = true;
            }
            "variable_assignment" if !in_fn => {
                if let Some(name) = field_text(node, "name", src) { push_sym(out, name, name, SymbolKind::Constant, node, src); }
            }
            _ => {}
        }
        for i in (0..node.named_child_count()).rev() {
            if let Some(c) = node.named_child(i as u32) { stack.push((c, child_in_fn)); }
        }
    }
}

pub(super) fn extract_bash_command_dep(node: tree_sitter::Node<'_>, src: &str, deps: &mut Vec<DepEdge>) {
    let Some(raw_cur) = field_text(node, "name", src) else { return };
    let mut cur = unescape_bash_word(raw_cur);
    let first_redir = first_redirect_start(node, &[], src);
    let mut args = (0..node.named_child_count())
        .filter_map(|i| node.named_child(i as u32))
        .filter(|c| !matches!(c.kind(), "variable_assignment" | "command_name" | "comment" | "file_redirect" | "herestring_redirect" | "heredoc_redirect"));
    while matches!(cur.as_str(), "!" | "time" | "builtin" | "command") {
        let wrapper = cur.clone();
        let (mut next_cmd, mut saw_p, mut saw_dd) = (None, false, false);
        for a in args.by_ref() {
            let raw_t = node_text(a, src).trim();
            let t = unescape_bash_word(raw_t);
            if wrapper == "!" {
                if t != "!" && is_bash_env_assign_node(a, src) { continue; }
                next_cmd = Some(t);
                break;
            }
            if wrapper == "time" {
                if !saw_dd && a.start_byte() < first_redir {
                    if !saw_p && raw_t == "-p" { saw_p = true; continue; }
                    if raw_t == "--" { saw_dd = true; continue; }
                }
                if is_bash_env_assign_node(a, src) { continue; }
                next_cmd = Some(t);
                break;
            }
            if wrapper == "command" && t == "-p" { continue; }
            if t == "--" {
                next_cmd = args.next().map(|n| unescape_bash_word(node_text(n, src).trim()));
                break;
            }
            if t.starts_with('-') { return; }
            next_cmd = Some(t);
            break;
        }
        let Some(nc) = next_cmd else { return };
        cur = nc;
    }
    let glued_sib = |n: tree_sitter::Node<'_>| {
        !matches!(
            n.kind(),
            "file_redirect" | "herestring_redirect" | "heredoc_redirect" | "comment"
                | "command_name" | "variable_assignment"
        )
    };
    let has_glued_bt = |n: tree_sitter::Node<'_>| {
        n.kind() == "concatenation"
            && (0..n.named_child_count()).any(|i| {
                n.named_child(i as u32).is_some_and(|c| {
                    c.kind() == "command_substitution" && node_text(c, src).starts_with('`')
                })
            })
    };
    if matches!(cur.as_str(), "source" | ".")
        && let Some(arg) = args.next()
        && !has_glued_bt(arg)
        && !arg.next_named_sibling().is_some_and(|n| n.start_byte() == arg.end_byte() && glued_sib(n))
        && !arg.prev_named_sibling().is_some_and(|n| n.end_byte() == arg.start_byte() && glued_sib(n))
    {
        let target = unescape_bash_word(node_text(arg, src).trim());
        if !target.is_empty()
            && !deps.iter().any(|d| d.kind == DepKind::Import && d.target == target && d.source == "script")
        {
            deps.push(DepEdge { source: "script".to_string(), target, kind: DepKind::Import });
        }
    }
}

pub(super) fn push_hd_tail_node<'a>(
    c: tree_sitter::Node<'a>,
    sup_end: usize,
    stack: &mut Vec<(tree_sitter::Node<'a>, bool, bool)>,
    ctx: (bool, bool),
) {
    if c.end_byte() <= sup_end {
        return;
    }
    if c.start_byte() >= sup_end {
        stack.push((c, ctx.0, ctx.1));
        return;
    }
    for i in (0..c.named_child_count()).rev() {
        if let Some(ch) = c.named_child(i as u32) {
            push_hd_tail_node(ch, sup_end, stack, ctx);
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn push_simple_command<'a>(
    outer: tree_sitter::Node<'a>,
    cmd: tree_sitter::Node<'a>,
    extra_cmds: &[tree_sitter::Node<'a>],
    extra_redirs: &[tree_sitter::Node<'a>],
    src: &str,
    hd_slots: &[(String, Vec<HdSlot>)],
    deps: &mut Vec<DepEdge>,
    stack: &mut Vec<(tree_sitter::Node<'a>, bool, bool)>,
    abort_until: &mut usize,
    abort_ranges: &mut Vec<(usize, usize)>,
    ctx: (bool, bool, bool),
) {
    let (in_param_dq, in_direct_dq, allow_nl_clear) = ctx;
    let push_ctx = (in_param_dq, in_direct_dq);
    let (mut words, mut assigns, mut redirs) = (Vec::new(), Vec::new(), Vec::new());
    for &c_node in std::iter::once(&cmd).chain(extra_cmds.iter()) {
        for i in 0..c_node.named_child_count() {
            if let Some(c) = c_node.named_child(i as u32) {
                match c.kind() {
                    "variable_assignment" => assigns.push(c),
                    "command_name" => {
                        if !node_text(c, src).is_empty() { words.push(c); }
                    }
                    "file_redirect" | "herestring_redirect" | "heredoc_redirect" => {
                        push_redir_children(c, src, &mut words, &mut redirs);
                    }
                    "comment" => {}
                    _ => words.push(c),
                }
            }
        }
    }
    for &r in extra_redirs { push_redir_children(r, src, &mut words, &mut redirs); }
    words.sort_by_key(|n| n.start_byte());
    assigns.sort_by_key(|n| n.start_byte());
    redirs.sort_by_key(|n| n.start_byte());
    peel_time_wrapper_words(&mut words, &mut assigns, first_redirect_start(cmd, extra_redirs, src), src);
    if !words.is_empty() && words.iter().any(|&w| !is_bare_unquoted_cmdsub(w, src)) {
        assigns.retain(|&a| !has_subscript_lhs(a, src));
    }
    if !words.is_empty() && words.iter().any(|&w| node_has_cmdsub_unclosed(w, src)) {
        *abort_until = (*abort_until).max(compute_abort_end_scoped(
            outer, src, allow_nl_clear, false, abort_ranges,
        ));
        return;
    }
    let aborts = words.iter().chain(assigns.iter()).chain(redirs.iter()).any(|&n| {
        let ak = node_abort_kind(n, src, false);
        let is_sub = matches!(n.kind(), "command_substitution" | "process_substitution");
        (ak != ExpAbort::None && (ak.is_parse_or_unclosed() || !is_sub))
            || (n.kind() == "heredoc_redirect" && heredoc_redirect_aborts(n, src))
            || (n.kind() == "word" && n.parent().is_some_and(|p| p.kind() == "file_redirect")
                && is_hd_slot_aborted(node_text(n, src), hd_slots))
    });
    if !aborts {
        extract_bash_command_dep(cmd, src, deps);
        extract_bash_command_dep_words(cmd, &words, first_redirect_start(cmd, &[], src), src, deps);
    }
    let outer_neg = matches!(outer.kind(), "command" | "redirected_statement")
        && time_brace_is_bang_negated(outer, src);
    let closed_neg = if words.len() == 1
        && let Some(sub) = bare_cmdsub_node(words[0])
    {
        if node_abort_kind(sub, src, false) == ExpAbort::ClosedBadSub {
            Some(false)
        } else if node_text(sub, src).starts_with('`') {
            node_has_bt_abort_neg(sub, src)
        } else {
            node_has_cmdsub_closed_abort_neg(sub, src)
        }
    } else if words.is_empty()
        && let Some(last_sub) = assigns.iter().rev().find(|&&a| node_has_any_cmdsub(a))
    {
        node_has_bt_abort_neg(*last_sub, src)
            .or_else(|| node_has_cmdsub_closed_abort_neg(*last_sub, src))
    } else {
        None
    };
    if let Some(hd_neg) = closed_neg {
        let end = compute_list_abort_end_with_cond(outer, src, outer_neg ^ hd_neg, false, abort_ranges);
        if end > outer.end_byte() {
            abort_ranges.push((outer.end_byte(), end));
        }
    }
    let err_start = cmd.has_error().then(|| {
        (0..cmd.named_child_count())
            .filter_map(|i| cmd.named_child(i as u32))
            .find(|c| c.kind() == "ERROR")
            .map(|c| c.start_byte())
    }).flatten();
    let skip_post_err = err_start.is_some_and(|es| {
        redirs.iter().chain(assigns.iter()).any(|&n| {
            n.start_byte() < es
                && (node_abort_kind(n, src, false) != ExpAbort::None
                    || (n.kind() == "heredoc_redirect" && heredoc_redirect_aborts(n, src))
                    || (n.kind() == "word" && n.parent().is_some_and(|p| p.kind() == "file_redirect")
                        && is_hd_slot_aborted(node_text(n, src), hd_slots)))
        })
    });
    for r in redirs.into_iter().rev() { stack.push((r, push_ctx.0, push_ctx.1)); }
    for a in assigns.into_iter().rev() { stack.push((a, push_ctx.0, push_ctx.1)); }
    for w in words.into_iter().rev() {
        if !(skip_post_err && err_start.is_some_and(|es| w.start_byte() >= es)) {
            stack.push((w, push_ctx.0, push_ctx.1));
        }
    }
}
