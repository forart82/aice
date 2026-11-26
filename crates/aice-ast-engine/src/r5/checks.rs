use std::collections::HashSet;
use std::path::Path;

use aice_lang_registry::{FirewallDiagnostic, LanguageId};

use crate::r5::checks_lang::{
    check_jsx_elements, check_keyword_operands, check_kotlin_spread, check_rust_fn_trait_params,
};
use crate::r5::checks_markup::{check_css, check_html, check_json, check_markdown, check_xml};
use crate::r5::twig_parser;
use crate::ts_pool::{GrammarSlot, ParserPool};
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ErrorSpan {
    pub line: usize,
    pub column: usize,
    pub end_line: usize,
    pub message: String,
}

pub fn collect_ts_error_spans(tree: &tree_sitter::Tree, _src: &str) -> Vec<ErrorSpan> {
    let mut out = Vec::new();
    collect_node_errors(tree.root_node(), &mut out);
    out
}

pub(crate) fn span_from_node(node: tree_sitter::Node<'_>, message: String) -> ErrorSpan {
    let start = node.start_position();
    let end = node.end_position();
    let end_row = if end.column == 0 && end.row > start.row {
        end.row - 1
    } else {
        end.row
    };
    ErrorSpan {
        line: start.row + 1,
        column: start.column + 1,
        end_line: (end_row + 1).max(start.row + 1),
        message,
    }
}

fn collect_node_errors(root: tree_sitter::Node<'_>, out: &mut Vec<ErrorSpan>) {
    let mut cursor = root.walk();
    loop {
        let node = cursor.node();
        let descend = if node.is_error() {
            out.push(span_from_node(node, "Syntax error: unexpected or malformed token".to_string()));
            false
        } else if node.is_missing() {
            out.push(span_from_node(node, format!("Missing syntax element: '{}'", node.kind())));
            false
        } else if !node.has_error() {
            false
        } else {
            let mut c2 = node.walk();
            let child_has_err = node.children(&mut c2).any(|c| c.has_error());
            if !child_has_err {
                out.push(span_from_node(node, format!("Malformed syntax near '{}'", node.kind())));
                false
            } else {
                true
            }
        };
        if descend && cursor.goto_first_child() {
            continue;
        }
        while !cursor.goto_next_sibling() {
            if !cursor.goto_parent() {
                return;
            }
        }
    }
}

pub fn format_context(src: &str, center_line: usize) -> String {
    let lines: Vec<&str> = src.lines().collect();
    if lines.is_empty() {
        return String::new();
    }
    let target = center_line.clamp(1, lines.len());
    let start = target.saturating_sub(5).max(1);
    let end = (target + 5).min(lines.len());
    (start..=end)
        .map(|ln| format!("{ln}│ {}", lines[ln - 1]))
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn spans_to_diagnostics(src: &str, spans: Vec<ErrorSpan>) -> Vec<FirewallDiagnostic> {
    let mut seen = HashSet::new();
    let mut diags = Vec::new();
    for sp in spans {
        if seen.insert((sp.line, sp.column, sp.message.clone())) {
            diags.push(FirewallDiagnostic {
                line: sp.line,
                column: sp.column,
                message: sp.message,
                context: format_context(src, sp.line),
            });
        }
    }
    diags
}

pub fn is_dtd_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| s.eq_ignore_ascii_case("dtd"))
        .unwrap_or(false)
}

pub fn collect_r5_error_spans(
    lang: LanguageId,
    src: &str,
    path: &Path,
    pool: &mut ParserPool,
) -> Result<Vec<ErrorSpan>, ErrorSpan> {
    collect_r5_error_spans_with_tree(lang, src, path, pool).map(|(spans, _)| spans)
}

pub(crate) fn collect_r5_error_spans_with_tree(
    lang: LanguageId,
    src: &str,
    path: &Path,
    pool: &mut ParserPool,
) -> Result<(Vec<ErrorSpan>, Option<tree_sitter::Tree>), ErrorSpan> {
    collect_r5_error_spans_with_old(lang, src, None, path, pool)
}

pub(crate) fn build_ts_edit(base: &str, cand: &str) -> tree_sitter::InputEdit {
    let (bb, cb) = (base.as_bytes(), cand.as_bytes());
    let mut prefix = bb.iter().zip(cb.iter()).take_while(|(a, b)| a == b).count();
    while prefix > 0 && !base.is_char_boundary(prefix) { prefix -= 1; }
    let mut suffix = bb.iter().rev().zip(cb.iter().rev()).take(bb.len().min(cb.len()) - prefix).take_while(|(a, b)| a == b).count();
    while suffix > 0 && (!base.is_char_boundary(bb.len() - suffix) || !cand.is_char_boundary(cb.len() - suffix)) { suffix -= 1; }
    let (old_end, new_end) = (bb.len() - suffix, cb.len() - suffix);
    let point_at = |s: &str, byte: usize| {
        let head = &s[..byte];
        tree_sitter::Point::new(head.bytes().filter(|&c| c == b'\n').count(), head.rfind('\n').map_or(byte, |nl| byte - nl - 1))
    };
    tree_sitter::InputEdit {
        start_byte: prefix,
        old_end_byte: old_end,
        new_end_byte: new_end,
        start_position: point_at(base, prefix),
        old_end_position: point_at(base, old_end),
        new_end_position: point_at(cand, new_end),
    }
}
pub(crate) fn collect_r5_with_base_edit(
    lang: LanguageId,
    base: &str,
    cand: &str,
    base_tree: &tree_sitter::Tree,
    path: &Path,
    pool: &mut ParserPool,
) -> (Vec<ErrorSpan>, Option<tree_sitter::Tree>) {
    let mut edited = base_tree.clone();
    edited.edit(&build_ts_edit(base, cand));
    collect_r5_error_spans_with_old(lang, cand, Some(&edited), path, pool)
        .unwrap_or_else(|e| (vec![e], None))
}

pub(crate) fn collect_r5_error_spans_with_old(
    lang: LanguageId,
    src: &str,
    old_tree: Option<&tree_sitter::Tree>,
    path: &Path,
    pool: &mut ParserPool,
) -> Result<(Vec<ErrorSpan>, Option<tree_sitter::Tree>), ErrorSpan> {
    if lang == LanguageId::Twig {
        return Ok((twig_parser::verify_twig_spans(src, pool), None));
    }
    let slot = match lang {
        LanguageId::Xml if is_dtd_path(path) => GrammarSlot::Dtd,
        LanguageId::Php if !src.contains("<?") => GrammarSlot::PhpOnly,
        _ => crate::ts_pool::slot_for_language(lang).ok_or_else(|| ErrorSpan {
            line: 1,
            column: 1,
            end_line: 1,
            message: format!("Unsupported R5 language: {}", lang.canonical_name()),
        })?,
    };
    let tree = pool.parse_slot_with_old(slot, src, old_tree).map_err(|e| ErrorSpan {
        line: e.line,
        column: e.column,
        end_line: e.line,
        message: e.message,
    })?;
    let mut spans = collect_ts_error_spans(&tree, src);
    match lang {
        LanguageId::Json => spans.extend(check_json(&tree, path)),
        LanguageId::Markdown => spans.extend(check_markdown(src, pool)),
        LanguageId::Html => spans.extend(check_html(src)),
        LanguageId::Css => spans.extend(check_css(&tree, src)),
        LanguageId::Xml if !is_dtd_path(path) => spans.extend(check_xml(src)),
        LanguageId::Tsx | LanguageId::JavaScript if src.contains("</") => {
            spans.extend(check_jsx_elements(&tree, src));
        }
        LanguageId::Ruby | LanguageId::Php => spans.extend(check_keyword_operands(&tree, src, lang)),
        LanguageId::Kotlin => spans.extend(check_kotlin_spread(&tree, src)),
        LanguageId::Rust => spans.extend(check_rust_fn_trait_params(&tree)),
        _ => {}
    }
    Ok((spans, Some(tree)))
}
pub fn verify_r5_firewall(
    lang: LanguageId,
    src: &str,
    path: &Path,
    pool: &mut ParserPool,
) -> Result<(), Vec<FirewallDiagnostic>> {
    match collect_r5_error_spans_with_tree(lang, src, path, pool) {
        Ok((spans, _)) if spans.is_empty() => Ok(()),
        Ok((spans, tree)) => Err(spans_to_diagnostics(
            src,
            crate::firewall_span::refine_error_spans(lang, src, path, None, tree.as_ref(), spans, pool),
        )),
        Err(span) => Err(spans_to_diagnostics(src, vec![span])),
    }
}

pub use crate::r5::snippet_probe::{has_merged_edit_error, min_snippet_errors};
