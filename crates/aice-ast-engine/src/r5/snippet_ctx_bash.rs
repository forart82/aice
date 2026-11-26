use std::path::Path;

use aice_lang_registry::LanguageId;

use crate::r5::firewall_delta::EofDeltaCtx;
use crate::r5::snippet_cache::{PrefixCache, last_code_line_idx};
use crate::r5::snippet_cst::{collect_masked_ranges, cst_defect_profile, line_delim_detail};
use crate::r5::snippet_ctx::clean_context_suffix_with_cache;
use crate::r5::snippet_del_lang::{bash_edit_increases_imbalance, bash_pfx_unquoted, join_slices};
use crate::r5::snippet_eof::{has_incomplete_continuation_tail, is_pure_code_comment};
use crate::r5::snippet_lex::{is_code_lang, is_hash_comment_at};
use crate::r5::snippet_lit::{JsLexState, StepQuote};
use crate::ts_pool::ParserPool;

pub(crate) fn bash_unclosed_opener_lines(lang: LanguageId, src: &str) -> Vec<(usize, &'static str)> {
    if lang != LanguageId::Bash {
        return Vec::new();
    }
    let b = src.as_bytes();
    let (mut i, mut line_idx, mut js, mut stk) = (0usize, 0usize, JsLexState::new(), Vec::new());
    while i < b.len() {
        let prev = i;
        if b[i] == b'\n' { js.on_newline(lang); line_idx += 1; i += 1; continue; }
        if js.step_quote(lang, b, &mut i) != StepQuote::NotInQuote || js.open_quote(lang, b, &mut i) {
            line_idx += b[prev..i].iter().filter(|&&c| c == b'\n').count();
            continue;
        }
        if is_hash_comment_at(b, i) {
            while i < b.len() && b[i] != b'\n' { i += 1; }
            continue;
        }
        if b[i].is_ascii_alphabetic() || b[i] == b'_' {
            let start = i;
            let op_line = line_idx;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') { i += 1; }
            let prev_ok = start == 0 || matches!(b[start - 1], b' ' | b'\t' | b'\n' | b'\r' | b';' | b'(' | b'{');
            let cl_ok = i == b.len() || matches!(b[i], b' ' | b'\t' | b'\n' | b'\r' | b';' | b')' | b'}');
            let op_ok = i == b.len() || matches!(b[i], b' ' | b'\t' | b'\n' | b'\r' | b';' | b'(');
            if prev_ok && (cl_ok || op_ok) {
                match &b[start..i] {
                    b"if" if op_ok => stk.push((op_line, "fi")),
                    b"for" | b"while" | b"until" | b"select" if op_ok => stk.push((op_line, "done")),
                    b"case" if op_ok => stk.push((op_line, "esac")),
                    b"fi" | b"done" | b"esac" if cl_ok => {
                        let want = std::str::from_utf8(&b[start..i]).unwrap_or("");
                        if let Some(p) = stk.iter().rposition(|&(_, k)| k == want) { stk.truncate(p); }
                    }
                    _ => {}
                }
            }
            continue;
        }
        i += 1;
    }
    stk
}

pub(crate) fn bash_compound_closers(lang: LanguageId, src: &str) -> Vec<&'static str> {
    bash_unclosed_opener_lines(lang, src).into_iter().rev().map(|(_, k)| k).collect()
}

pub(crate) fn bash_case_arm_hdr<'a>(
    prefix_lines: &[&'a str],
    start: usize,
    end: usize,
) -> Option<&'a str> {
    for &line in prefix_lines[start..end].iter().rev() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') { continue; }
        if t.ends_with(";;") || t.ends_with(";&") || t.ends_with(";;&") { return None; }
        if t.ends_with(')') && !t.contains('(') { return Some(line); }
    }
    None
}

pub(crate) fn append_bash_openers(
    lang: LanguageId,
    prefix_lines: &[&str],
    last_idx: Option<usize>,
    last_op_end: &mut usize,
    chain: &mut Vec<String>,
    innermost_kept: &mut bool,
    completable: &mut dyn FnMut(&[String]) -> bool,
) -> Option<String> {
    if lang != LanguageId::Bash || prefix_lines.len() <= 48 {
        return None;
    }
    let src = bash_pfx_unquoted(prefix_lines).unwrap_or_else(|| prefix_lines.join("\n"));
    let bash_ops = bash_unclosed_opener_lines(lang, &src);
    let mut last_sh_closer = None;
    for &(op_line, closer) in &bash_ops {
        if op_line < *last_op_end { continue; }
        let line_slice = vec![prefix_lines[op_line].to_string()];
        if completable(&line_slice) {
            chain.push(prefix_lines[op_line].to_string());
        } else {
            let indent: String = prefix_lines[op_line].chars().take_while(|c| c.is_whitespace()).collect();
            chain.push(match closer {
                "esac" => format!("{indent}case _aice_ in"),
                "fi" => format!("{indent}if true; then"),
                _ => format!("{indent}for _x in a; do"),
            });
        }
        *last_op_end = op_line + 1;
        last_sh_closer = Some(closer);
        *innermost_kept = true;
    }
    let tail_min_sh = (*last_op_end).max(last_idx.unwrap_or(prefix_lines.len()).saturating_sub(24)).min(prefix_lines.len());
    if last_sh_closer == Some("esac") && tail_min_sh > *last_op_end {
        return bash_case_arm_hdr(prefix_lines, *last_op_end, tail_min_sh).map(str::to_string);
    }
    None
}

pub(crate) fn push_bash_completable_cands(lang: LanguageId, joined: &str, cands: &mut Vec<String>) {
    if lang != LanguageId::Bash { return; }
    let sh = bash_compound_closers(lang, joined);
    if sh.is_empty() { return; }
    let tail = sh.join("\n");
    cands.push(format!("{joined}\n{tail}"));
    cands.push(format!("{joined}\n  true\n{tail}"));
    if sh.first() == Some(&"esac") {
        cands.push(format!("{joined}\n  a) true ;;\n{tail}"));
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn midfile_er_false_adds_err(
    ctx: &EofDeltaCtx<'_>, pfx: &[&str], raw_base: &[&str], raw_cand: &[&str], suf: &[&str],
    cand_is_cmt: bool, cache: &mut PrefixCache, path: &Path, pool: &mut ParserPool,
) -> bool {
    if ctx.is_eof_append || cand_is_cmt || raw_cand.is_empty() || suf.is_empty() || !is_code_lang(ctx.lang) {
        return false;
    }
    if ctx.lang == LanguageId::Bash && bash_edit_increases_imbalance(pfx, raw_base, raw_cand, suf) {
        return true;
    }
    let cand_has_inc = last_code_line_idx(ctx.lang, raw_cand, pool)
        .is_some_and(|i| has_incomplete_continuation_tail(ctx.lang, raw_cand[i], path, pool));
    if !cand_has_inc { return false; }
    let base_has_inc = !raw_base.is_empty()
        && !is_pure_code_comment(ctx.lang, &raw_base.join("\n"), pool)
        && last_code_line_idx(ctx.lang, raw_base, pool)
            .is_some_and(|i| has_incomplete_continuation_tail(ctx.lang, raw_base[i], path, pool));
    if base_has_inc { return false; }
    let first_suf_err = ctx.base_spans.iter()
        .filter(|b| b.line > ctx.base_edit_end && !b.message.starts_with("Missing ") && !b.message.starts_with("Unclosed "))
        .map(|b| b.line - ctx.base_edit_end - 1)
        .min().unwrap_or(suf.len()).min(suf.len());
    if first_suf_err == 0 { return false; }
    let clean_ctx = clean_context_suffix_with_cache(ctx.lang, pfx, cache, path, pool).0;
    let ctx_lines: Vec<&str> = clean_ctx.as_deref().unwrap_or(&[]).iter().map(String::as_str).collect();
    let head = join_slices(&ctx_lines, raw_cand, &[]);
    let (mut stk, unm) = line_delim_detail(ctx.lang, &head, path, pool);
    if !unm.is_empty() { return false; }
    let head_depth = stk.len();
    let suf_cap = &suf[..first_suf_err.min(256)];
    let suf_j = suf_cap.join("\n");
    let (b, masked) = (suf_j.as_bytes(), collect_masked_ranges(ctx.lang, &suf_j, path, pool));
    let (mut i, mut ln, mut m, mut suf_end, mut saw_non_empty, mut last_non_ws) = (0usize, 0usize, 0usize, suf_cap.len(), false, 0u8);
    while i < b.len() {
        while m < masked.len() && masked[m].1 <= i { m += 1; }
        if m < masked.len() && i >= masked[m].0 {
            ln += b[i..masked[m].1].iter().filter(|&&c| c == b'\n').count();
            i = masked[m].1; continue;
        }
        match b[i] {
            b'\n' => {
                let stop_empty = head_depth == 0 && stk.is_empty() && saw_non_empty && last_non_ws != b',';
                let stop_inner = head_depth > 0 && stk.len() < head_depth && last_non_ws != b',';
                let stop_semi = head_depth > 0 && stk.len() == head_depth && stk.last() == Some(&b'{') && last_non_ws == b';';
                if stop_empty || stop_inner || stop_semi { suf_end = ln + 1; break; }
                ln += 1; last_non_ws = 0;
            }
            b'(' | b'[' | b'{' => { stk.push(b[i]); saw_non_empty = true; last_non_ws = b[i]; }
            b')' | b']' | b'}' => {
                let w = match b[i] { b')' => b'(', b']' => b'[', _ => b'{' };
                if let Some(p) = stk.iter().rposition(|&c| c == w) { stk.remove(p); }
                saw_non_empty = true; last_non_ws = b[i];
            }
            c if !c.is_ascii_whitespace() => { saw_non_empty = true; last_non_ws = c; }
            _ => {}
        }
        i += 1;
    }
    let close_of = |s: &str, p: &mut ParserPool| -> String {
        let (st, un) = line_delim_detail(ctx.lang, s, path, p);
        if !un.is_empty() { return s.to_string(); }
        let cl: String = st.iter().rev().map(|&c| match c { b'(' => ')', b'[' => ']', _ => '}' }).collect();
        if cl.is_empty() { s.to_string() } else { format!("{s}\n{cl}") }
    };
    let base_probe = close_of(&join_slices(&ctx_lines, raw_base, &suf[..suf_end]), pool);
    let b_prof = cst_defect_profile(ctx.lang, &base_probe, path, pool);
    if b_prof.min_errs > 0 || b_prof.unclosed_quotes > 0 { return false; }
    let cand_probe = close_of(&join_slices(&ctx_lines, raw_cand, &suf[..suf_end]), pool);
    let c_prof = cst_defect_profile(ctx.lang, &cand_probe, path, pool);
    c_prof.min_errs > 0 || c_prof.unclosed_quotes > 0
}

