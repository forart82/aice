use aice_lang_registry::FirewallDiagnostic;

use crate::py_walrus_cst::{WalrusHit, WalrusKind, scan_cst_raw};
use crate::py_walrus_diff::{leading_ws_len, line_starts, lines_ref};
use crate::py_walrus_isolate::{build_wrapped_slice, classify_delta_hits, remap_hits};

fn scan_snippet_cst(src: &str) -> Vec<WalrusHit> {
    if !src.contains(":=") {
        return Vec::new();
    }
    let s_lines = lines_ref(src);
    if s_lines.is_empty() {
        return Vec::new();
    }
    let min_i = s_lines
        .iter()
        .filter(|l| !l.trim().is_empty())
        .map(|l| leading_ws_len(l))
        .min()
        .unwrap_or(0);
    let first_tr = s_lines
        .iter()
        .find(|l| !l.trim().is_empty())
        .map(|l| l.trim_start())
        .unwrap_or("");
    let needs_clause = first_tr.starts_with("elif ")
        || first_tr.starts_with("else:")
        || first_tr.starts_with("except")
        || first_tr.starts_with("finally:")
        || first_tr.starts_with("case ");
    if min_i == 0 && !needs_clause {
        return scan_cst_raw(src, None, false);
    }
    let (mut wrapped, mut used_min, mut syn_lines, mut add_bytes) = build_wrapped_slice(&s_lines, false);
    if add_bytes == 0
        && !needs_clause
        && aice_ast_engine::parse_slot(aice_ast_engine::GrammarSlot::Python, &wrapped)
            .is_ok_and(|t| t.root_node().has_error())
    {
        (wrapped, used_min, syn_lines, add_bytes) = build_wrapped_slice(&s_lines, true);
    }
    let s_starts = line_starts(src);
    let w_starts = line_starts(&wrapped);
    remap_hits(
        scan_cst_raw(&wrapped, None, false),
        &s_lines,
        &s_starts,
        &w_starts,
        (0, syn_lines, used_min, add_bytes),
    )
}

pub(crate) fn lower_offsets(src: &str, offsets: &[usize]) -> String {
    if offsets.is_empty() {
        return src.to_string();
    }
    let mut sorted = offsets.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    let mut out = String::with_capacity(src.len());
    let mut cursor = 0usize;
    for off in sorted {
        if off >= cursor && src.get(off..off + 2) == Some(":=") {
            out.push_str(&src[cursor..off]);
            out.push('=');
            cursor = off + 2;
        }
    }
    out.push_str(&src[cursor..]);
    out
}

pub(crate) fn has_standalone_hybrid_walrus(src: &str) -> bool {
    let hits = scan_snippet_cst(src);
    hits.iter().any(|h| h.kind == WalrusKind::StandaloneHybrid)
        && !hits.iter().any(|h| h.kind == WalrusKind::Illegal)
}

pub(crate) fn has_illegal_walrus(src: &str) -> bool {
    scan_snippet_cst(src)
        .iter()
        .any(|h| h.kind == WalrusKind::Illegal)
}

pub(crate) fn lower_standalone_walrus(src: &str) -> String {
    let hits = scan_snippet_cst(src);
    let offsets: Vec<usize> = hits
        .into_iter()
        .filter(|h| h.kind == WalrusKind::StandaloneHybrid)
        .map(|h| h.byte_offset)
        .collect();
    lower_offsets(src, &offsets)
}

pub(crate) fn has_illegal_walrus_in_delta(base: Option<&str>, cand: &str) -> bool {
    classify_delta_hits(base, cand, None, true)
        .iter()
        .any(|h| h.kind == WalrusKind::Illegal)
}

pub(crate) fn has_standalone_hybrid_in_delta(base: Option<&str>, cand: &str) -> bool {
    let hits = classify_delta_hits(base, cand, None, true);
    hits.iter().any(|h| h.kind == WalrusKind::StandaloneHybrid)
        && !hits.iter().any(|h| h.kind == WalrusKind::Illegal)
}

pub(crate) fn lower_py_splice_candidate(
    lang: aice_lang_registry::LanguageId,
    orig_disk: Option<&str>,
    cand: String,
    edit_start: usize,
    edit_end: usize,
    repl_lines: &[String],
    eol: &str,
) -> (String, String) {
    let orig_snippet = repl_lines.join(eol);
    if lang != aice_lang_registry::LanguageId::Python || repl_lines.is_empty() || !cand.contains(":=") {
        return (cand, orig_snippet);
    }
    let clen = lines_ref(&cand).len();
    if clen == 0 || edit_start == 0 || edit_start > clen {
        return (cand, orig_snippet);
    }
    let edit_end = edit_end.min(clen).max(edit_start);
    let hits = classify_delta_hits(orig_disk, &cand, Some((edit_start, edit_end)), true);
    if hits.iter().any(|h| h.kind == WalrusKind::Illegal) {
        return (cand, orig_snippet);
    }
    let offsets: Vec<usize> = hits
        .into_iter()
        .filter(|h| h.kind == WalrusKind::StandaloneHybrid && h.line >= edit_start && h.line <= edit_end)
        .map(|h| h.byte_offset)
        .collect();
    if offsets.is_empty() {
        return (cand, orig_snippet);
    }
    let updated = lower_offsets(&cand, &offsets);
    let updated_lines = lines_ref(&updated);
    let new_snippet = updated_lines
        .get(edit_start.saturating_sub(1)..edit_end.min(updated_lines.len()))
        .map(|s| s.join(eol))
        .unwrap_or(orig_snippet);
    (updated, new_snippet)
}

pub(crate) fn is_py_walrus_hard_error(
    orig_disk: Option<&str>,
    cand: &str,
    edit_start: usize,
    edit_end: usize,
) -> bool {
    if !cand.contains(":=") {
        return false;
    }
    classify_delta_hits(orig_disk, cand, Some((edit_start, edit_end)), true)
        .iter()
        .any(|h| h.kind == WalrusKind::Illegal)
}

pub(crate) fn verify_py_walrus_delta(base: Option<&str>, cand: &str) -> Vec<FirewallDiagnostic> {
    if !cand.contains(":=") {
        return Vec::new();
    }
    let hits = classify_delta_hits(base, cand, None, true);
    if hits.is_empty() {
        return Vec::new();
    }
    let cand_lines = lines_ref(cand);
    hits
        .into_iter()
        .map(|h| FirewallDiagnostic {
            line: h.line,
            column: h.col,
            message: "Syntax error: unparenthesized assignment expression ':=' is invalid at statement level"
                .to_string(),
            context: cand_lines
                .get(h.line.saturating_sub(1))
                .copied()
                .unwrap_or("")
                .trim()
                .to_string(),
        })
        .collect()
}
