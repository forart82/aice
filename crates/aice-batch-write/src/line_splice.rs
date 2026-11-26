use std::path::Path;

use aice_ast_engine::DefaultSyntaxFirewall;
use aice_lang_registry::{FirewallVerdict, LanguageId, SyntaxFirewall};

use crate::aice_lower::{is_explicit_aice_module, lower_snippet_with_scope};
use crate::diagnostics::format_range_rejected;
use crate::hunk::{extract_hunk_blocks, has_hunk_markers};
use crate::hunk_match::{EnclosingContext, apply_hunk_blocks, slice_enclosing};
use crate::types::{join_lines_keep, split_lines_keep};

fn parse_line_num(s: &str, require_l: bool) -> Option<usize> {
    let digits = if let Some(r) = s.strip_prefix('L').or_else(|| s.strip_prefix('l')) {
        r
    } else if require_l {
        return None;
    } else {
        s
    };
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse::<usize>().ok()
}

pub fn parse_line_range_selector(sel: &str) -> Option<Result<(usize, usize), String>> {
    let t = sel.trim();
    if let Some((lhs, rhs)) = t.split_once('-') {
        let start = parse_line_num(lhs.trim(), false)?;
        let end = parse_line_num(rhs.trim(), false)?;
        if start == 0 || end == 0 || start > end {
            return Some(Err(format!("Invalid line range '{t}': start must be >= 1 and <= end")));
        }
        return Some(Ok((start, end)));
    }
    if let Some(line) = parse_line_num(t, true) {
        if line == 0 {
            return Some(Err(format!("Invalid line selector '{t}': line number must be >= 1")));
        }
        return Some(Ok((line, line)));
    }
    None
}

fn net_delim_balance(lines: &[String]) -> (i32, i32, i32) {
    let (mut b, mut p, mut k) = (0i32, 0i32, 0i32);
    for l in lines {
        for ch in l.chars() {
            match ch {
                '{' => b += 1,
                '}' => b -= 1,
                '(' => p += 1,
                ')' => p -= 1,
                '[' => k += 1,
                ']' => k -= 1,
                _ => {}
            }
        }
    }
    (b, p, k)
}

fn restore_bom_if_needed(src: &str, mut out: String) -> String {
    if src.starts_with('\u{FEFF}') && !out.is_empty() && !out.starts_with('\u{FEFF}') {
        out.insert(0, '\u{FEFF}');
    }
    out
}

fn extract_assign_lhs(line: &str) -> Option<&str> {
    let t = line.trim_start_matches('\u{FEFF}').trim();
    let eq = t.find('=')?;
    if t[eq..].starts_with("==") || t[..eq].ends_with(['!', '<', '>', ':']) {
        return None;
    }
    let lhs = t[..eq].trim();
    let ident = lhs.split_whitespace().last()?.trim_end_matches(':');
    (!ident.is_empty() && ident.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')).then_some(ident)
}

fn check_half_open_assignment_guard(lines: &[String], start: usize, end: usize, repl: &[String]) -> Option<String> {
    let span = end.saturating_sub(start) + 1;
    if span < 4 || repl.len() + 1 != span {
        return None;
    }
    let lhs_match = (0..repl.len()).all(|i| {
        match (extract_assign_lhs(&lines[start - 1 + i]), extract_assign_lhs(&repl[i])) {
            (Some(a), Some(b)) => a == b,
            _ => false,
        }
    });
    if !lhs_match {
        return None;
    }
    let last_orig = lines[end - 1].trim();
    if last_orig.is_empty() || last_orig.starts_with("//") || last_orig.starts_with('#') {
        return None;
    }
    if let Some(last_lhs) = extract_assign_lhs(last_orig) {
        let lookahead_end = (end + 15).min(lines.len());
        let used_later = lines[end..lookahead_end].iter().any(|l| l.contains(last_lhs));
        if used_later {
            return Some(format!(
                "half-open off-by-one suspected on L{start}-L{end}: '{last_lhs}' on L{end} would be dropped"
            ));
        }
    }
    None
}

pub struct LineSpliceOutcome {
    pub new_src: String,
    pub original_snippet: String,
    pub new_snippet: String,
    pub start_line: usize,
    pub end_line: usize,
}

#[allow(clippy::too_many_arguments)]
fn try_apply_line_repl(
    src: &str,
    orig_disk: Option<&str>,
    display_path: &Path,
    canonical_path: &Path,
    lang: LanguageId,
    eol: &str,
    lines: &[String],
    trailing_nl: bool,
    start: usize,
    end: usize,
    orig_snippet: &str,
    repl_lines: &[String],
    fw: &DefaultSyntaxFirewall,
) -> Result<Result<LineSpliceOutcome, String>, String> {
    let total = lines.len();
    if let Some(reason) = check_half_open_assignment_guard(lines, start, end, repl_lines) {
        return Err(format_range_rejected(display_path, start, end, &reason, src));
    }
    if end > start && repl_lines.len() >= 2 {
        let orig_span_net = net_delim_balance(&lines[start - 1..end]);
        let repl_net = net_delim_balance(repl_lines);
        let drops_closing_brace_on_balanced_span =
            orig_span_net == (0, 0, 0) && repl_net != (0, 0, 0) && lines[end - 1].trim() == "}";
        let first_orig = lines[start - 1].trim_start_matches('\u{FEFF}').trim();
        let prev_orig = lines[end - 2].trim();
        let last_orig = lines[end - 1].trim();
        let py_w = lang == LanguageId::Python;
        let first_matches = first_orig.len() >= 3 && (repl_lines[0].trim() == first_orig || (py_w && repl_lines[0].contains(":=")));
        let prev_matches = prev_orig.len() >= 3 && (repl_lines.last().unwrap().trim() == prev_orig || (py_w && repl_lines.last().unwrap().contains(":=")));
        let last_differs = repl_lines.last().unwrap().trim() != last_orig;
        if !drops_closing_brace_on_balanced_span && first_matches && prev_matches && last_differs {
            let mut aligned = Vec::with_capacity(total);
            aligned.extend_from_slice(&lines[..start - 1]);
            aligned.extend(repl_lines.iter().cloned());
            aligned.extend_from_slice(&lines[end - 1..]);
            let edit_end = start + repl_lines.len().saturating_sub(1);
            let mut raw_al = join_lines_keep(&aligned, trailing_nl, eol);
            if start == 1 {
                raw_al = restore_bom_if_needed(src, raw_al);
            }
            let (cand_aligned, aligned_snippet) = crate::py_walrus::lower_py_splice_candidate(lang, orig_disk, raw_al, start, edit_end, repl_lines, eol);
            let sn_lines: Vec<&str> = aligned_snippet.lines().collect();
            let post_match = sn_lines.first().is_some_and(|l| l.trim_start_matches('\u{FEFF}').trim() == first_orig) && sn_lines.last().is_some_and(|l| l.trim() == prev_orig);
            if post_match
                && net_delim_balance(repl_lines) == net_delim_balance(&lines[start - 1..end - 1])
                && matches!(fw.verify_incremental(orig_disk, &cand_aligned, canonical_path, lang), FirewallVerdict::Valid)
                && (lang != LanguageId::Python
                    || crate::py_walrus::verify_py_walrus_delta(orig_disk, &cand_aligned).is_empty())
            {
                return Ok(Ok(LineSpliceOutcome {
                    new_src: cand_aligned,
                    original_snippet: lines[start - 1..end - 1].join(eol),
                    new_snippet: aligned_snippet,
                    start_line: start,
                    end_line: end - 1,
                }));
            }
        }
    }
    let mut next = Vec::with_capacity(total);
    next.extend_from_slice(&lines[..start - 1]);
    next.extend(repl_lines.iter().cloned());
    next.extend_from_slice(&lines[end..]);
    let edit_end = start + repl_lines.len().saturating_sub(1);
    let mut raw_cand = join_lines_keep(&next, trailing_nl, eol);
    if start == 1 {
        raw_cand = restore_bom_if_needed(src, raw_cand);
    }
    let (cand, new_snippet) = crate::py_walrus::lower_py_splice_candidate(lang, orig_disk, raw_cand, start, edit_end, repl_lines, eol);
    if let FirewallVerdict::Invalid { diagnostics } = fw.verify_incremental(orig_disk, &cand, canonical_path, lang) {
        let msg = if net_delim_balance(repl_lines) != net_delim_balance(&lines[start - 1..end]) {
            let d0 = diagnostics.first().map(|d| format!("Line {}:{} - {}", d.line, d.column, d.message)).unwrap_or_default();
            format!("replacement leaves unbalanced braces/parentheses or syntax errors ({d0}). Use AST-scoped hunk splicing: === {}:<symbol> === with <<< / === / >>>.", display_path.display())
        } else {
            diagnostics.iter().take(3).map(|d| format!("Line {}:{} - {}", d.line, d.column, d.message)).collect::<Vec<_>>().join("; ")
        };
        let formatted = format_range_rejected(display_path, start, end, &msg, src);
        if lang == LanguageId::Python
            && !repl_lines.is_empty()
            && crate::py_walrus::is_py_walrus_hard_error(orig_disk, &cand, start, edit_end)
        {
            return Err(formatted);
        }
        return Ok(Err(formatted));
    }
    if lang == LanguageId::Python {
        let w_diags = crate::py_walrus::verify_py_walrus_delta(orig_disk, &cand);
        if !w_diags.is_empty() {
            let msg = w_diags.iter().take(3).map(|d| format!("Line {}:{} - {}", d.line, d.column, d.message)).collect::<Vec<_>>().join("; ");
            return Err(format_range_rejected(display_path, start, end, &msg, src));
        }
    }
    Ok(Ok(LineSpliceOutcome {
        new_src: cand,
        original_snippet: orig_snippet.to_string(),
        new_snippet,
        start_line: start,
        end_line: end,
    }))
}

#[allow(clippy::too_many_arguments)]
pub fn apply_line_range(
    src: &str,
    orig_disk: Option<&str>,
    display_path: &Path,
    canonical_path: &Path,
    lang: LanguageId,
    eol: &str,
    start: usize,
    req_end: usize,
    payload: &str,
    delete: bool,
    force_aice_ir: bool,
) -> Result<LineSpliceOutcome, String> {
    let (lines, trailing_nl) = split_lines_keep(src);
    let total = lines.len();
    if total == 0 || start < 1 || start > total || req_end < start {
        return Err(format!("Line range L{start}-L{req_end} out of bounds (file has {total} lines)"));
    }
    let end = req_end.min(total);
    let orig_snippet = lines[start - 1..end].join(eol);

    if delete {
        let mut next = Vec::with_capacity(total - (end - start + 1));
        next.extend_from_slice(&lines[..start - 1]);
        next.extend_from_slice(&lines[end..]);
        let mut new_src = join_lines_keep(&next, trailing_nl && !next.is_empty(), eol);
        if start == 1 { new_src = restore_bom_if_needed(src, new_src); }
        return Ok(LineSpliceOutcome { new_src, original_snippet: orig_snippet, new_snippet: String::new(), start_line: start, end_line: end });
    }

    if has_hunk_markers(payload) {
        let hunks = extract_hunk_blocks(payload)?;
        let (scope, fb, fa) = slice_enclosing(&lines, start, end, trailing_nl, eol);
        let ctx = EnclosingContext { full_before: &fb, full_after: &fa, orig_disk };
        if let Ok(updated_scope) = apply_hunk_blocks(&scope, &hunks, canonical_path, lang, eol, start, &ctx) {
            let (rep, _) = split_lines_keep(&updated_scope);
            let mut next = Vec::with_capacity(total);
            next.extend_from_slice(&lines[..start - 1]);
            next.extend(rep);
            next.extend_from_slice(&lines[end..]);
            let new_src = restore_bom_if_needed(src, join_lines_keep(&next, trailing_nl, eol));
            return Ok(LineSpliceOutcome { new_src, original_snippet: orig_snippet, new_snippet: updated_scope, start_line: start, end_line: end });
        }
        let (win_s, win_e) = (start.saturating_sub(40).max(1), (end + 40).min(total));
        let (win_scope, w_fb, w_fa) = slice_enclosing(&lines, win_s, win_e, trailing_nl, eol);
        let w_ctx = EnclosingContext { full_before: &w_fb, full_after: &w_fa, orig_disk };
        let updated_win = apply_hunk_blocks(&win_scope, &hunks, canonical_path, lang, eol, win_s, &w_ctx)?;
        let (rep, _) = split_lines_keep(&updated_win);
        let mut next = Vec::with_capacity(total);
        next.extend_from_slice(&lines[..win_s - 1]);
        next.extend(rep);
        next.extend_from_slice(&lines[win_e..]);
        let new_src = restore_bom_if_needed(src, join_lines_keep(&next, trailing_nl, eol));
        return Ok(LineSpliceOutcome { new_src, original_snippet: lines[win_s - 1..win_e].join(eol), new_snippet: updated_win, start_line: win_s, end_line: win_e });
    }

    let fw = DefaultSyntaxFirewall;
    if !force_aice_ir && (matches!(lang, LanguageId::Aice | LanguageId::PlainText) || !is_explicit_aice_module(payload, lang)) {
        let (raw_lines, _) = split_lines_keep(payload);
        if let Ok(outcome) = try_apply_line_repl(
            src, orig_disk, display_path, canonical_path, lang, eol,
            &lines, trailing_nl, start, end, &orig_snippet, &raw_lines, &fw,
        )? {
            return Ok(outcome);
        }
    }
    let lowered = lower_snippet_with_scope(payload, lang, force_aice_ir, false, None, &fw, canonical_path, false, false)?;
    let (repl_lines, _) = split_lines_keep(&lowered);
    try_apply_line_repl(
        src, orig_disk, display_path, canonical_path, lang, eol,
        &lines, trailing_nl, start, end, &orig_snippet, &repl_lines, &fw,
    )?
}
