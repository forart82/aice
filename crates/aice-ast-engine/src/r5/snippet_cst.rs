use std::path::Path;

use aice_lang_registry::LanguageId;

use crate::r5::checks::{collect_r5_error_spans, is_dtd_path};
use crate::r5::snippet_lex::{
    count_unclosed_quotes_unmasked, is_code_lang, lexical_comment_start, scan_unmasked_delims,
    scan_unmasked_delims_detail, snippet_wrappers,
};
use crate::ts_pool::{GrammarSlot, ParserPool, slot_for_language};

#[derive(Debug, Clone, Copy, Default)]
pub struct CstDefectProfile {
    pub min_errs: usize,
    pub cst_errors: usize,
    pub cst_missing: usize,
    pub unclosed_quotes: usize,
    pub unclosed_delims: usize,
}

pub(crate) fn resolve_slot(lang: LanguageId, src: &str, path: &Path) -> Option<GrammarSlot> {
    match lang {
        LanguageId::Xml if is_dtd_path(path) => Some(GrammarSlot::Dtd),
        LanguageId::Php if !src.contains("<?") => Some(GrammarSlot::PhpOnly),
        _ => slot_for_language(lang),
    }
}

pub fn cst_defect_profile(
    lang: LanguageId,
    src: &str,
    path: &Path,
    pool: &mut ParserPool,
) -> CstDefectProfile {
    let raw_errs = collect_r5_error_spans(lang, src, path, pool)
        .map(|s| s.len())
        .unwrap_or(1);
    if raw_errs == 0 {
        return CstDefectProfile::default();
    }
    let mut best_errs = raw_errs;
    let mut best_src: Option<(usize, String)> = None;
    for (prefix_len, wrapped) in snippet_wrappers(lang, src) {
        let errs = collect_r5_error_spans(lang, &wrapped, path, pool)
            .map(|s| s.len())
            .unwrap_or(1);
        if errs < best_errs {
            best_errs = errs;
            best_src = Some((prefix_len, wrapped));
            if best_errs == 0 {
                return CstDefectProfile::default();
            }
        }
    }
    let (prefix_len, probe_src) = match best_src.as_ref() {
        Some((p, w)) => (*p, w.as_str()),
        None => (0, src),
    };
    let Some(slot) = resolve_slot(lang, probe_src, path) else {
        return CstDefectProfile {
            min_errs: best_errs,
            cst_errors: best_errs,
            ..CstDefectProfile::default()
        };
    };
    let Ok(tree) = pool.parse_slot(slot, probe_src) else {
        return CstDefectProfile {
            min_errs: best_errs,
            cst_errors: 1,
            ..CstDefectProfile::default()
        };
    };
    let (mut cst_errors, mut cst_missing, mut masked) = (0, 0, Vec::new());
    walk_cst_defects_cursor(
        &tree,
        prefix_len,
        src.len(),
        &mut cst_errors,
        &mut cst_missing,
        &mut masked,
        None,
    );
    let unclosed_quotes = count_unclosed_quotes_unmasked(lang, src, &masked);
    let (open_d, unmatched_d) = scan_unmasked_delims(lang, src, &masked);
    CstDefectProfile {
        min_errs: best_errs,
        cst_errors,
        cst_missing,
        unclosed_quotes,
        unclosed_delims: open_d.len() + unmatched_d,
    }
}

pub(crate) fn collect_masked_ranges(
    lang: LanguageId,
    src: &str,
    path: &Path,
    pool: &mut ParserPool,
) -> Vec<(usize, usize)> {
    let Some(slot) = resolve_slot(lang, src, path) else {
        return Vec::new();
    };
    let mut masked = Vec::new();
    if let Ok(tree) = pool.parse_slot(slot, src) {
        let (mut e, mut m) = (0, 0);
        walk_cst_defects_cursor(&tree, 0, src.len(), &mut e, &mut m, &mut masked, None);
    }
    masked
}

pub(crate) fn line_delim_detail(
    lang: LanguageId,
    line: &str,
    path: &Path,
    pool: &mut ParserPool,
) -> (Vec<u8>, Vec<u8>) {
    let masked = collect_masked_ranges(lang, line, path, pool);
    scan_unmasked_delims_detail(lang, line, &masked)
}

pub(crate) fn line_delim_state(
    lang: LanguageId,
    line: &str,
    path: &Path,
    pool: &mut ParserPool,
) -> (Vec<u8>, usize) {
    let (stack, unmatched) = line_delim_detail(lang, line, path, pool);
    (stack, unmatched.len())
}

pub(crate) fn is_closed_string_node(kind: &str) -> bool {
    matches!(
        kind,
        "string" | "string_literal" | "interpreted_string_literal" | "raw_string_literal"
            | "template_string" | "char_literal" | "character_literal" | "rune_literal"
            | "encapsed_string" | "heredoc_body" | "nowdoc_body" | "verbatim_string_literal"
            | "line_string_literal" | "multi_line_string_literal" | "ansi_c_string"
            | "concatenated_string" | "raw_string" | "regex" | "regex_literal"
    )
}

fn is_comment_or_clean_str(node: tree_sitter::Node<'_>) -> bool {
    let kind = node.kind();
    (kind.contains("comment") || kind == "jsx_text" || is_closed_string_node(kind))
        && !node.has_error()
}

pub(crate) fn walk_cst_defects_cursor(
    tree: &tree_sitter::Tree,
    prefix_len: usize,
    src_len: usize,
    cst_errors: &mut usize,
    cst_missing: &mut usize,
    masked: &mut Vec<(usize, usize)>,
    mut extra: Option<&mut Vec<(usize, usize, bool)>>,
) {
    let mut cursor = tree.walk();
    let mut masked_until = 0usize;
    loop {
        let node = cursor.node();
        if node.is_error() { *cst_errors += 1; }
        if node.is_missing() { *cst_missing += 1; }
        let mask_node = is_comment_or_clean_str(node);
        let inside_masked = node.start_byte() < masked_until;
        if mask_node {
            let s = node.start_byte().saturating_sub(prefix_len).min(src_len);
            let e = node.end_byte().saturating_sub(prefix_len).min(src_len);
            if e > s {
                if !inside_masked {
                    masked.push((s, e));
                    masked_until = node.end_byte();
                }
                if let Some(ex) = extra.as_deref_mut()
                    && matches!(node.kind(), "regex" | "regex_literal" | "jsx_text")
                {
                    ex.push((s, e, node.kind() != "jsx_text"));
                }
            }
        }
        let descend = !mask_node || (extra.is_some() && node.kind() == "template_string");
        if descend && cursor.goto_first_child() {
            continue;
        }
        while !cursor.goto_next_sibling() {
            if !cursor.goto_parent() {
                masked.sort_unstable();
                if let Some(ex) = extra {
                    ex.sort_unstable();
                }
                return;
            }
        }
    }
}

pub fn comment_or_string_boundary(
    lang: LanguageId,
    line: &str,
    mut p: usize,
    mut s_from_end: usize,
    pool: &mut ParserPool,
) -> (usize, usize) {
    let floor_char = |mut x: usize| {
        x = x.min(line.len());
        while x > 0 && !line.is_char_boundary(x) { x -= 1; }
        x
    };
    p = floor_char(p);
    s_from_end = line.len().saturating_sub(floor_char(line.len().saturating_sub(s_from_end)).max(p));
    if let Some(slot) = resolve_slot(lang, line, Path::new(""))
        && let Ok(tree) = pool.parse_slot(slot, line)
    {
        let root = tree.root_node();
        for pos in [p, p.saturating_sub(1)] {
            if pos < line.len()
                && let Some(r) = enclosing_masked_range(root, pos)
                && pos > r.0 && pos < r.1
            {
                p = p.min(r.0);
            }
        }
        let mut cut = line.len().saturating_sub(s_from_end);
        for pos in [cut, cut.saturating_sub(1)] {
            if pos < line.len()
                && let Some(r) = enclosing_masked_range(root, pos)
                && cut > r.0 && cut < r.1
            {
                cut = cut.max(r.1.min(line.len()));
            }
        }
        s_from_end = line.len().saturating_sub(cut.max(p));
    }
    p = floor_char(p);
    if let Some(cpos) = lexical_comment_start(lang, &line[..p]) {
        p = floor_char(p.min(cpos));
    }
    s_from_end = line.len().saturating_sub(floor_char(line.len().saturating_sub(s_from_end)).max(p));
    (p, s_from_end)
}

fn enclosing_masked_range(root: tree_sitter::Node<'_>, pos: usize) -> Option<(usize, usize)> {
    let mut cur = root.descendant_for_byte_range(pos, pos)?;
    let mut found = None;
    loop {
        if cur.kind() == "jsx_text"
            && let Some(parent) = cur.parent()
            && parent.kind() == "jsx_element"
            && !parent.has_error()
        {
            found = Some((parent.start_byte(), parent.end_byte()));
        } else if is_comment_or_clean_str(cur) {
            found = Some((cur.start_byte(), cur.end_byte()));
        }
        cur = match cur.parent() {
            Some(p) => p,
            None => break,
        };
    }
    found
}

pub fn strip_trailing_comment<'a>(lang: LanguageId, line: &'a str, pool: &mut ParserPool) -> &'a str {
    let mut cut = line.len();
    if !is_code_lang(lang)
        && let Some(slot) = resolve_slot(lang, line, Path::new(""))
        && let Ok(tree) = pool.parse_slot(slot, line)
        && let Some(pos) = last_comment_start(tree.root_node(), line.len())
    {
        cut = cut.min(pos);
    }
    while cut > 0 && !line.is_char_boundary(cut) { cut -= 1; }
    while let Some(pos) = lexical_comment_start(lang, &line[..cut]) {
        if pos >= cut { break; }
        cut = pos;
        while cut > 0 && !line.is_char_boundary(cut) { cut -= 1; }
    }
    line[..cut].trim_end()
}
fn last_comment_start(root: tree_sitter::Node<'_>, line_len: usize) -> Option<usize> {
    let mut cursor = root.walk();
    loop {
        let node = cursor.node();
        if node.kind().contains("comment") && node.end_byte() >= line_len.saturating_sub(1) {
            return Some(node.start_byte());
        }
        if cursor.goto_first_child() { continue; }
        while !cursor.goto_next_sibling() {
            if !cursor.goto_parent() { return None; }
        }
    }
}
