use std::path::Path;

use aice_lang_registry::LanguageId;
use crate::r5::snippet_cst::{resolve_slot, walk_cst_defects_cursor};
use crate::r5::snippet_lex::has_slash_comments;
use crate::r5::snippet_lit::{JsLexState, StepQuote};
pub(crate) use crate::r5::snippet_rs_blk::rust_type_container_insert_verdict;
use crate::ts_pool::ParserPool;

pub(crate) fn find_blk_comment_close(
    lang: LanguageId,
    b: &[u8],
    start: usize,
    mut depth: usize,
) -> (Option<usize>, usize) {
    let mut j = start;
    while j + 1 < b.len() {
        if lang == LanguageId::Rust && b[j] == b'/' && b[j + 1] == b'*' {
            depth += 1;
            j += 2;
        } else if b[j] == b'*' && b[j + 1] == b'/' {
            depth -= 1;
            j += 2;
            if depth == 0 {
                return (Some(j), 0);
            }
        } else {
            j += 1;
        }
    }
    (None, depth)
}

fn collect_blk_masked_ranges(
    lang: LanguageId,
    src: &str,
    path: &Path,
    pool: &mut ParserPool,
) -> Vec<(usize, usize, bool)> {
    let Some(slot) = resolve_slot(lang, src, path) else { return Vec::new(); };
    let Ok(tree) = pool.parse_slot(slot, src) else { return Vec::new(); };
    let (mut e, mut m, mut dummy, mut extra) = (0, 0, Vec::new(), Vec::new());
    walk_cst_defects_cursor(&tree, 0, src.len(), &mut e, &mut m, &mut dummy, Some(&mut extra));
    extra
}

pub(crate) fn ends_in_block_comment_with_regex(
    lang: LanguageId,
    joined: &str,
    masked: &[(usize, usize, bool)],
) -> usize {
    let b = joined.as_bytes();
    let (mut js, mut i, mut m_idx) = (JsLexState::new(), 0usize, 0usize);
    let mut last_code_byte: Option<u8> = None;
    let mut rbrace_slash_bracket = false;
    while i < b.len() {
        while m_idx < masked.len() && masked[m_idx].1 <= i {
            m_idx += 1;
        }
        if m_idx < masked.len() && i == masked[m_idx].0 {
            let (s, end, is_rx) = masked[m_idx];
            if !is_rx
                || (js.saw_paren_nl_decl && last_code_byte != Some(b'}') && !rbrace_slash_bracket)
            {
                let mut tmp = 0;
                js.step_masked(lang, b, &mut tmp, &[(s, end)], &mut i);
                m_idx += 1;
                rbrace_slash_bracket = false;
                if end > 0 && end <= b.len() {
                    last_code_byte = Some(b[end - 1]);
                }
                continue;
            }
        }
        if b[i] == b'\n' {
            rbrace_slash_bracket = false;
            js.on_newline(lang);
            i += 1;
            continue;
        }
        if js.step_quote(lang, b, &mut i) != StepQuote::NotInQuote {
            rbrace_slash_bracket = false;
            if i > 0 { last_code_byte = Some(b[i - 1]); }
            continue;
        }
        if let Some((end, _)) = js.match_special(lang, b, i) {
            rbrace_slash_bracket = false;
            i = end;
            if i > 0 { last_code_byte = Some(b[i - 1]); }
            continue;
        }
        if js.open_quote(lang, b, &mut i) {
            rbrace_slash_bracket = false;
            if i > 0 { last_code_byte = Some(b[i - 1]); }
            continue;
        }
        if lang != LanguageId::Css && b[i..].starts_with(b"//") {
            rbrace_slash_bracket = false;
            js.just_closed_paren_nl_decl = false;
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if b[i..].starts_with(b"/*") {
            rbrace_slash_bracket = false;
            js.just_closed_paren_nl_decl = false;
            match find_blk_comment_close(lang, b, i + 2, 1) {
                (Some(end), _) => {
                    i = end;
                    continue;
                }
                (None, rem) => return rem,
            }
        }
        let prev_i = i;
        let was_rbrace = last_code_byte == Some(b'}');
        js.step_byte(lang, b, &mut i);
        if let Some(&last) = b[prev_i..i].iter().rfind(|c| !c.is_ascii_whitespace()) {
            if was_rbrace && last == b'/' && b.get(i) == Some(&b'[') {
                rbrace_slash_bracket = true;
            } else if !(rbrace_slash_bracket && last == b'[') {
                rbrace_slash_bracket = false;
            }
            last_code_byte = Some(last);
        }
    }
    0
}

pub(crate) fn ends_in_block_comment(
    lang: LanguageId,
    prefix_lines: &[&str],
    path: &Path,
    pool: &mut ParserPool,
) -> usize {
    if !has_slash_comments(lang) || !prefix_lines.iter().any(|l| l.contains("/*")) {
        return 0;
    }
    let joined = prefix_lines.join("\n");
    let masked = collect_blk_masked_ranges(lang, &joined, path, pool);
    ends_in_block_comment_with_regex(lang, &joined, &masked)
}
fn strip_leading_blk_comment<'a>(
    lang: LanguageId,
    lines: &[&'a str],
    mut depth: usize,
) -> (Vec<&'a str>, usize, bool) {
    let mut out = Vec::with_capacity(lines.len());
    let (mut js, mut closed_any) = (JsLexState::new(), false);
    for (idx, &line) in lines.iter().enumerate() {
        if idx > 0 && depth == 0 {
            let _ = js.on_newline(lang);
        }
        let b = line.as_bytes();
        let (mut i, seg_start) = if depth > 0 {
            let (close, next_depth) = find_blk_comment_close(lang, b, 0, depth);
            depth = next_depth;
            let Some(end) = close else {
                out.push("");
                continue;
            };
            closed_any = true;
            js = JsLexState::new();
            (end, end)
        } else {
            (0, 0)
        };
        let mut push_end = b.len();
        while i < b.len() {
            if js.step_quote(lang, b, &mut i) != StepQuote::NotInQuote { continue; }
            if let Some((end, _)) = js.match_special(lang, b, i) { i = end; continue; }
            if js.open_quote(lang, b, &mut i) { continue; }
            if lang != LanguageId::Css && b[i..].starts_with(b"//") { break; }
            if b[i..].starts_with(b"/*") {
                match find_blk_comment_close(lang, b, i + 2, 1) {
                    (Some(after), _) => { i = after; continue; }
                    (None, rem) => {
                        depth = rem;
                        push_end = i;
                        break;
                    }
                }
            }
            js.step_byte(lang, b, &mut i);
        }
        out.push(&line[seg_start..push_end]);
    }
    (out, depth, closed_any)
}
fn suffix_closes_blk(lang: LanguageId, suffix_lines: &[&str], mut depth: usize) -> bool {
    for &line in suffix_lines {
        let (close, next) = find_blk_comment_close(lang, line.as_bytes(), 0, depth);
        if close.is_some() {
            return true;
        }
        depth = next;
    }
    false
}
pub(crate) fn normalize_edit_slices_with_depth<'a>(
    lang: LanguageId,
    base_lines: &[&'a str],
    cand_lines: &[&'a str],
    suffix_lines: &[&str],
    depth: usize,
) -> Option<(Vec<&'a str>, Vec<&'a str>)> {
    if depth == 0 {
        return Some((base_lines.to_vec(), cand_lines.to_vec()));
    }
    let (b_norm, b_depth, _) = strip_leading_blk_comment(lang, base_lines, depth);
    let (c_norm, c_depth, c_closed) = strip_leading_blk_comment(lang, cand_lines, depth);
    if c_depth > b_depth || (c_closed && c_depth > 0 && !suffix_closes_blk(lang, suffix_lines, c_depth)) {
        return None;
    }
    Some((b_norm, c_norm))
}

pub fn normalize_edit_slices_for_blk<'a>(
    lang: LanguageId,
    prefix_lines: &[&str],
    base_lines: &[&'a str],
    cand_lines: &[&'a str],
    path: &Path,
    pool: &mut ParserPool,
) -> Option<(Vec<&'a str>, Vec<&'a str>)> {
    let depth = ends_in_block_comment(lang, prefix_lines, path, pool);
    normalize_edit_slices_with_depth(lang, base_lines, cand_lines, &[], depth)
}