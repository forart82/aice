use std::path::Path;

use aice_lang_registry::LanguageId;

use crate::firewall_delim::scan_unbalanced_delim;
use crate::r5::checks::{ErrorSpan, span_from_node};
use crate::r5::snippet_cst::resolve_slot;
use crate::ts_pool::ParserPool;

#[derive(Debug, Clone)]
pub(crate) struct Pinpoint {
    pub(crate) line: usize,
    pub(crate) column: usize,
    pub(crate) message: String,
}

pub(crate) fn refine_error_spans(
    lang: LanguageId,
    src: &str,
    path: &Path,
    baseline: Option<&str>,
    cand_tree: Option<&tree_sitter::Tree>,
    spans: Vec<ErrorSpan>,
    pool: &mut ParserPool,
) -> Vec<ErrorSpan> {
    if spans.is_empty() || !spans.iter().any(is_refinable_span) {
        return spans;
    }
    let filtered = drop_shadowed_root_wrappers(spans);
    if !filtered.iter().any(is_refinable_span) {
        return filtered;
    }
    let owned_tree = if cand_tree.is_none() {
        resolve_slot(lang, src, path).and_then(|slot| pool.parse_slot(slot, src).ok())
    } else {
        None
    };
    let tree = cand_tree.or(owned_tree.as_ref());
    let delim = scan_unbalanced_delim(lang, src, tree);
    let diff_line = baseline.and_then(|b| first_diff_line(b, src));

    filtered
        .into_iter()
        .map(|sp| {
            if is_refinable_span(&sp) {
                refine_one_span(sp, src, tree, delim.as_ref(), diff_line)
            } else {
                sp
            }
        })
        .collect()
}

fn is_broad_root_error(sp: &ErrorSpan) -> bool {
    sp.line == 1 && (sp.column == 1 || sp.end_line > 1) && is_generic_syntax_msg(&sp.message)
}

fn is_broad_multiline_wrapper(sp: &ErrorSpan) -> bool {
    sp.end_line > sp.line && is_generic_syntax_msg(&sp.message)
}

fn is_refinable_span(sp: &ErrorSpan) -> bool {
    is_generic_syntax_msg(&sp.message)
        && ((sp.line == 1 && (sp.column == 1 || sp.end_line > 1)) || sp.end_line > sp.line)
}

fn is_generic_syntax_msg(msg: &str) -> bool {
    msg.starts_with("Syntax error:") || msg.starts_with("Malformed syntax near")
}

pub(crate) fn drop_shadowed_root_wrappers(spans: Vec<ErrorSpan>) -> Vec<ErrorSpan> {
    let specific: Vec<&ErrorSpan> = spans
        .iter()
        .filter(|s| {
            !is_broad_root_error(s)
                && !is_broad_multiline_wrapper(s)
                && (s.line > 1 || s.column > 1)
        })
        .collect();
    if specific.is_empty() {
        return spans;
    }
    let kept: Vec<ErrorSpan> = spans
        .iter()
        .filter(|sp| {
            let root_shadowed = is_broad_root_error(sp)
                && specific.iter().any(|o| {
                    (o.line > 1 && sp.end_line >= o.line)
                        || (o.line == 1
                            && o.column > 1
                            && sp.line == 1
                            && sp.column == 1
                            && sp.end_line == 1)
                });
            let multi_shadowed = is_broad_multiline_wrapper(sp)
                && specific.iter().any(|o| {
                    o.line >= sp.line
                        && o.end_line <= sp.end_line
                        && (o.line > sp.line || o.column > sp.column)
                });
            !(root_shadowed || multi_shadowed)
        })
        .cloned()
        .collect();
    if kept.is_empty() { spans } else { kept }
}

fn refine_one_span(
    sp: ErrorSpan,
    src: &str,
    tree: Option<&tree_sitter::Tree>,
    delim: Option<&Pinpoint>,
    diff_line: Option<usize>,
) -> ErrorSpan {
    let min_line = sp.line;
    let max_line = sp.end_line.max(src.lines().count().max(1));
    let cst = tree.map(|t| inspect_cst_error(t, src, &sp)).unwrap_or_default();

    let in_range = |p: &Pinpoint| p.line > min_line && p.line <= max_line;
    let delim_deeper = delim.filter(|d| in_range(d));
    let nested_deeper = cst.nested_err.as_ref().filter(|p| in_range(p));
    let missing_deeper = cst.inner_missing.as_ref().filter(|p| in_range(p));
    let child_deeper = cst.child_boundary.as_ref().filter(|p| in_range(p));
    let eof_deeper = cst.eof_missing.as_ref().filter(|p| in_range(p));
    let diff_deeper = diff_line.filter(|&ln| ln > min_line && ln <= max_line);
    let diff_pin = |dl: usize| Pinpoint { line: dl, column: first_non_ws_col(src, dl), message: sp.message.clone() };

    let chosen = if let Some(d) = delim_deeper {
        match (nested_deeper, missing_deeper) {
            (Some(n), _) if n.line < d.line => Some(n.clone()),
            (_, Some(m)) if m.line < d.line => Some(m.clone()),
            _ => Some(d.clone()),
        }
    } else if let Some(n) = nested_deeper {
        Some(n.clone())
    } else if let Some(m) = missing_deeper {
        Some(m.clone())
    } else if let Some(c) = child_deeper {
        match diff_deeper {
            Some(dl) if dl > c.line => Some(diff_pin(dl)),
            _ => Some(c.clone()),
        }
    } else if let Some(dl) = diff_deeper {
        Some(diff_pin(dl))
    } else if let Some(e) = eof_deeper {
        Some(e.clone())
    } else if sp.line == 1 && sp.column == 1 {
        delim
            .filter(|d| d.line == 1 && d.column > 1)
            .or_else(|| cst.nested_err.as_ref().filter(|p| p.line == 1 && p.column > 1))
            .or_else(|| cst.inner_missing.as_ref().filter(|p| p.line == 1 && p.column > 1))
            .cloned()
    } else {
        None
    };

    match chosen {
        Some(p) => ErrorSpan { line: p.line, column: p.column, end_line: p.line, message: p.message },
        None => sp,
    }
}

#[derive(Default)]
struct CstPinpoints {
    nested_err: Option<Pinpoint>,
    inner_missing: Option<Pinpoint>,
    eof_missing: Option<Pinpoint>,
    child_boundary: Option<Pinpoint>,
}

fn inspect_cst_error(tree: &tree_sitter::Tree, src: &str, sp: &ErrorSpan) -> CstPinpoints {
    let Some(err_node) = find_error_node(tree.root_node(), sp) else {
        return CstPinpoints::default();
    };
    let last_nonempty = src
        .lines()
        .enumerate()
        .filter(|(_, l)| !l.trim().is_empty())
        .last()
        .map_or(1, |(i, _)| i + 1);
    let mut out = CstPinpoints::default();
    let origin = err_node.start_position();
    let mut stack: Vec<_> = (0..err_node.child_count()).rev().filter_map(|i| err_node.child(i)).collect();
    while let Some(node) = stack.pop() {
        let pos = node.start_position();
        if node.is_missing() && pos > origin {
            let s = span_from_node(node, format!("Missing syntax element: '{}'", node.kind()));
            let p = Pinpoint { line: s.line, column: s.column, message: s.message };
            if matches!(node.kind(), "}" | ")" | "]") && p.line >= last_nonempty {
                out.eof_missing.get_or_insert(p);
            } else {
                out.inner_missing.get_or_insert(p);
            }
            continue;
        }
        if node.is_error() && pos > origin {
            let s = span_from_node(node, "Syntax error: unexpected or malformed token".to_string());
            out.nested_err = Some(Pinpoint { line: s.line, column: s.column, message: s.message });
        }
        if node.has_error() || node.is_error() {
            for i in (0..node.child_count()).rev() {
                if let Some(c) = node.child(i) {
                    stack.push(c);
                }
            }
        }
    }
    out.child_boundary = find_child_boundary(err_node, sp);
    out
}

fn find_error_node<'a>(root: tree_sitter::Node<'a>, sp: &ErrorSpan) -> Option<tree_sitter::Node<'a>> {
    let target = (sp.line.saturating_sub(1), sp.column.saturating_sub(1));
    let mut stack = vec![root];
    let mut fallback = None;
    while let Some(node) = stack.pop() {
        let st = node.start_position();
        if node.end_position().row + 1 < sp.line || st.row + 1 > sp.end_line.max(sp.line) {
            continue;
        }
        if (st.row, st.column) == target {
            if node.is_error() {
                return Some(node);
            }
            if node.has_error() && fallback.is_none() {
                fallback = Some(node);
            }
        }
        if node.has_error() {
            for i in (0..node.child_count()).rev() {
                if let Some(c) = node.child(i) {
                    stack.push(c);
                }
            }
        }
    }
    fallback
}

fn is_trivia_child(node: tree_sitter::Node<'_>) -> bool {
    let k = node.kind();
    k.contains("comment") || matches!(k, "php_tag" | "<?php" | "<?" | "shebang" | "hash_bang_line")
}

fn is_clean_compound(node: tree_sitter::Node<'_>) -> bool {
    node.is_named() && !node.is_error() && !node.is_missing() && !node.has_error() && node.child_count() > 0
}

fn find_child_boundary(err_node: tree_sitter::Node<'_>, sp: &ErrorSpan) -> Option<Pinpoint> {
    let children: Vec<_> = (0..err_node.child_count())
        .filter_map(|i| err_node.child(i))
        .filter(|c| !is_trivia_child(*c))
        .collect();
    let (mut saw_clean, mut i) = (false, 0);
    while i < children.len() {
        if is_clean_compound(children[i]) {
            saw_clean = true;
            i += 1;
            continue;
        }
        let run_start = i;
        while i < children.len() && !is_clean_compound(children[i]) {
            i += 1;
        }
        let has_clean_after = i < children.len();
        if has_clean_after && matches!(children[i - 1].kind(), "{" | "(" | "[" | ":" | "do" | "then" | "begin") {
            continue;
        }
        let pos = children[run_start].start_position();
        if pos.row + 1 > sp.line && (saw_clean || has_clean_after) {
            return Some(Pinpoint { line: pos.row + 1, column: pos.column + 1, message: sp.message.clone() });
        }
    }
    if saw_clean && let Some(last) = children.last() {
        let end = last.end_position();
        let line = if end.column == 0 && end.row > 0 { end.row } else { end.row + 1 };
        if line > sp.line {
            return Some(Pinpoint { line, column: end.column.max(1), message: sp.message.clone() });
        }
    }
    None
}

fn first_diff_line(base: &str, cand: &str) -> Option<usize> {
    let bl: Vec<&str> = base.lines().collect();
    let cl: Vec<&str> = cand.lines().collect();
    let prefix = bl.iter().zip(cl.iter()).take_while(|(a, b)| a == b).count();
    if prefix == bl.len() && prefix == cl.len() {
        return None;
    }
    let line = (prefix + 1).min(cl.len().max(1));
    (line > 1).then_some(line)
}

fn first_non_ws_col(src: &str, line: usize) -> usize {
    src.lines()
        .nth(line.saturating_sub(1))
        .and_then(|l| l.bytes().position(|c| !c.is_ascii_whitespace()))
        .map_or(1, |idx| idx + 1)
}
