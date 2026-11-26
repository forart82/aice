use std::path::Path;

use aice_lang_registry::LanguageId;

use crate::r5::checks::collect_r5_error_spans;
use crate::r5::firewall_delta::EofDeltaCtx;
use crate::r5::snippet_cache::{PrefixCache, last_code_line_idx};
use crate::r5::snippet_cst::{collect_masked_ranges, line_delim_detail};
use crate::r5::snippet_ctx_bash::bash_compound_closers;
use crate::r5::snippet_ctx_scan::collect_opener_hdr;
use crate::r5::snippet_del_lang::{bash_opener_lines, bash_suf_close_end, join_slices, scan_html_open_tags, scan_twig_blocks, twig_suf_close_end};
pub(crate) use crate::r5::snippet_del_suf::{css_suf_close_end, css_unclosed_opener_lines, toml_delim_scan, toml_suf_close_end, toml_unclosed_opener_lines, toml_unclosed_openers};
use crate::r5::snippet_del_xml::xml_suf_close_end;
use crate::r5::snippet_eof::has_incomplete_continuation_tail;
use crate::r5::snippet_lex::is_code_lang;
use crate::r5::snippet_probe::min_snippet_errors;
use crate::r5::snippet_semi_op::strip_code_trailing_comment;
use crate::ts_pool::ParserPool;

fn next_suf_continues(lang: LanguageId, suf: &[&str], rest_line: &str, next_ln: usize) -> bool {
    let mut t = rest_line.trim_start();
    if t.is_empty() {
        for &l in &suf[next_ln..] {
            let c = strip_code_trailing_comment(lang, l).trim();
            if !c.is_empty() { t = c; break; }
        }
    }
    let kw = t.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').next().unwrap_or("");
    matches!(kw, "else" | "elif" | "elsif" | "catch" | "finally" | "while")
}

fn suf_close_end(lang: LanguageId, pfx_s: &[&str], raw_base: &[&str], suf: &[&str], path: &Path, pool: &mut ParserPool) -> usize {
    if suf.is_empty() { return 0; }
    let head = join_slices(pfx_s, raw_base, &[]);
    if is_code_lang(lang) {
        let mut stk = line_delim_detail(lang, &head, path, pool).0;
        if stk.is_empty() {
            if lang == LanguageId::Bash && !bash_compound_closers(lang, &head).is_empty() {
                return bash_suf_close_end(pfx_s, raw_base, suf, 0).unwrap_or(suf.len());
            }
            return 0;
        }
        let suf_j = suf.join("\n");
        let (b, masked) = (suf_j.as_bytes(), collect_masked_ranges(lang, &suf_j, path, pool));
        let (mut i, mut ln, mut m) = (0usize, 0usize, 0usize);
        while i < b.len() {
            while m < masked.len() && masked[m].1 <= i { m += 1; }
            if m < masked.len() && i >= masked[m].0 {
                ln += b[i..masked[m].1].iter().filter(|&&c| c == b'\n').count();
                i = masked[m].1; continue;
            }
            match b[i] {
                b'\n' => { ln += 1; }
                b'(' | b'[' | b'{' => stk.push(b[i]),
                b')' | b']' | b'}' => {
                    let want = match b[i] { b')' => b'(', b']' => b'[', _ => b'{' };
                    if let Some(p) = stk.iter().rposition(|&c| c == want) { stk.remove(p); }
                    if stk.is_empty() {
                        let eol = b[i + 1..].iter().position(|&c| c == b'\n').map_or(b.len(), |r| i + 1 + r);
                        if !next_suf_continues(lang, suf, &suf_j[i + 1..eol], ln + 1) { return ln + 1; }
                    }
                }
                _ => {}
            }
            i += 1;
        }
        return suf.len();
    }
    match lang {
        LanguageId::Css => css_suf_close_end(pfx_s, raw_base, suf),
        LanguageId::Toml => toml_suf_close_end(pfx_s, raw_base, suf),
        LanguageId::Twig => twig_suf_close_end(pfx_s, raw_base, suf),
        LanguageId::Html | LanguageId::Xml => xml_suf_close_end(lang, pfx_s, raw_base, suf),
        _ => 0,
    }
}

pub(crate) fn pure_del_window_err(
    ctx: &EofDeltaCtx<'_>, pfx: &[&str], raw_base: &[&str], suf: &[&str],
    cache: &PrefixCache, path: &Path, pool: &mut ParserPool,
) -> Option<bool> {
    let first_suf_err = ctx.base_spans.iter()
        .filter(|b| b.line > ctx.base_edit_end && !b.message.starts_with("Missing ") && !b.message.starts_with("Unclosed "))
        .map(|b| b.line - ctx.base_edit_end - 1).min().unwrap_or(suf.len()).min(suf.len());
    let mut s_cands = Vec::new();
    let mut push_s = |s: usize| { if s <= pfx.len() && !s_cands.contains(&s) { s_cands.push(s); } };
    if is_code_lang(ctx.lang) {
        for &(_, ln, _) in cache.openers.iter().rev().take(4) {
            push_s(ln);
            push_s((ln + 1).saturating_sub(collect_opener_hdr(ctx.lang, pfx, ln, 0, path, pool).len()));
        }
        for ln in bash_opener_lines(pfx).into_iter().rev().take(4) { push_s(ln); }
    } else if ctx.lang == LanguageId::Toml {
        for ln in toml_unclosed_opener_lines(pfx).into_iter().rev() { push_s(ln); }
    } else if ctx.lang == LanguageId::Twig {
        for (ln, _, _, _) in scan_twig_blocks(&pfx.join("\n")).0.into_iter().rev().take(4) { push_s(ln); }
        for (ln, _) in scan_html_open_tags(LanguageId::Html, pfx).into_iter().rev().take(2) { push_s(ln); }
    } else if matches!(ctx.lang, LanguageId::Html | LanguageId::Xml) {
        for (ln, _) in scan_html_open_tags(ctx.lang, pfx).into_iter().rev().take(4) { push_s(ln); }
    } else if ctx.lang == LanguageId::Css {
        for ln in css_unclosed_opener_lines(pfx).into_iter().rev().take(4) { push_s(ln); }
    }
    let last_idx = last_code_line_idx(ctx.lang, pfx, pool);
    if let Some(i) = last_idx { push_s(i); push_s(i.saturating_sub(1)); }
    push_s(pfx.len().saturating_sub(1));
    push_s(pfx.len());
    let err_cnt = |src: &str, p: &mut ParserPool| -> usize {
        if is_code_lang(ctx.lang) { min_snippet_errors(ctx.lang, src, path, p) }
        else { collect_r5_error_spans(ctx.lang, src, path, p).map_or(1, |e| e.len()) }
    };
    for s in s_cands {
        let mut suf_end = suf_close_end(ctx.lang, &pfx[s..], raw_base, &suf[..first_suf_err], path, pool);
        let mut base_w = join_slices(&pfx[s..], raw_base, &suf[..suf_end]);
        let mut cand_w = join_slices(&pfx[s..], &[], &suf[..suf_end]);
        let (mut base_errs, mut cand_errs) = (err_cnt(&base_w, pool), if cand_w.trim().is_empty() { 0 } else { err_cnt(&cand_w, pool) });
        if first_suf_err < suf.len() && base_errs > 0 {
            let suf_end2 = suf_close_end(ctx.lang, &pfx[s..], raw_base, suf, path, pool);
            if suf_end2 > suf_end {
                suf_end = suf_end2;
                base_w = join_slices(&pfx[s..], raw_base, &suf[..suf_end]);
                cand_w = join_slices(&pfx[s..], &[], &suf[..suf_end]);
                base_errs = err_cnt(&base_w, pool);
                cand_errs = if cand_w.trim().is_empty() { 0 } else { err_cnt(&cand_w, pool) };
            }
        }
        if base_errs == 0 && cand_errs > 0 { return Some(true); }
        if base_errs == 0 && cand_errs == 0 {
            let skip_tail = s == pfx.len() && suf_end == 0 && last_idx.is_some_and(|i| has_incomplete_continuation_tail(ctx.lang, pfx[i], path, pool));
            if !skip_tail { return Some(false); }
        }
    }
    None
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn non_del_window_err(
    ctx: &EofDeltaCtx<'_>, pfx: &[&str], raw_base: &[&str], raw_cand: &[&str], suf: &[&str],
    last_code_idx: Option<usize>, path: &Path, pool: &mut ParserPool,
) -> Option<bool> {
    if !matches!(ctx.lang, LanguageId::Twig | LanguageId::Toml | LanguageId::Html | LanguageId::Xml) { return None; }
    let first_suf_err = ctx.base_spans.iter()
        .filter(|b| b.line > ctx.base_edit_end && !b.message.starts_with("Missing ") && !b.message.starts_with("Unclosed "))
        .map(|b| b.line - ctx.base_edit_end - 1).min().unwrap_or(suf.len()).min(suf.len());
    let mut s_cands = Vec::new();
    let mut push_s = |s: usize| { if s <= pfx.len() && !s_cands.contains(&s) { s_cands.push(s); } };
    if ctx.lang == LanguageId::Toml {
        for ln in toml_unclosed_opener_lines(pfx).into_iter().rev() { push_s(ln); }
    } else if matches!(ctx.lang, LanguageId::Html | LanguageId::Xml) {
        for (ln, _) in scan_html_open_tags(ctx.lang, pfx).into_iter().rev().take(4) { push_s(ln); }
    } else {
        for (ln, _, _, _) in scan_twig_blocks(&pfx.join("\n")).0.into_iter().rev().take(4) { push_s(ln); }
        for (ln, _) in scan_html_open_tags(LanguageId::Html, pfx).into_iter().rev().take(2) { push_s(ln); }
    }
    if let Some(i) = last_code_idx { push_s(i); push_s(i.saturating_sub(1)); }
    push_s(pfx.len().saturating_sub(1)); push_s(pfx.len());
    for s in s_cands {
        let mut suf_end = suf_close_end(ctx.lang, &pfx[s..], raw_base, &suf[..first_suf_err], path, pool);
        let base_w = join_slices(&pfx[s..], raw_base, &suf[..suf_end]);
        if base_w.trim().is_empty() { continue; }
        let mut base_errs = collect_r5_error_spans(ctx.lang, &base_w, path, pool).map_or(1, |e| e.len());
        if first_suf_err < suf.len() && base_errs > 0 {
            let suf_end2 = suf_close_end(ctx.lang, &pfx[s..], raw_base, suf, path, pool);
            if suf_end2 > suf_end {
                suf_end = suf_end2;
                base_errs = collect_r5_error_spans(ctx.lang, &join_slices(&pfx[s..], raw_base, &suf[..suf_end]), path, pool).map_or(1, |e| e.len());
            }
        }
        if base_errs > 0 { continue; }
        let cand_w = join_slices(&pfx[s..], raw_cand, &suf[..suf_end]);
        let mut cand_errs = collect_r5_error_spans(ctx.lang, &cand_w, path, pool).map_or(1, |e| e.len());
        if ctx.lang == LanguageId::Xml && suf_end == 0 && cand_errs > 0 && !suf.is_empty()
            && scan_html_open_tags(LanguageId::Xml, &[pfx, suf].concat()).len() < scan_html_open_tags(LanguageId::Xml, pfx).len()
            && collect_r5_error_spans(ctx.lang, &format!("<_aice_>\n{base_w}\n</_aice_>"), path, pool).is_ok_and(|e| e.is_empty()) {
            cand_errs = collect_r5_error_spans(ctx.lang, &format!("<_aice_>\n{cand_w}\n</_aice_>"), path, pool).map_or(1, |e| e.len());
        }
        return Some(cand_errs > 0);
    }
    (ctx.lang == LanguageId::Toml).then(|| crate::r5::snippet_del::toml_unclosed_fallback_err(pfx, raw_base, raw_cand, suf, first_suf_err, path, pool)).flatten()
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn py_rb_cond_clean_ok(lang: LanguageId, pre: &str, pfx: &[&str], s0: usize, slice: &[&str], suf_j: &str, path: &Path, pool: &mut ParserPool) -> bool {
    let head = if slice.is_empty() { pfx[s0..].join("\n") } else { format!("{}\n{}", pfx[s0..].join("\n"), slice.join("\n")) };
    let (mut stk, unm) = line_delim_detail(lang, &head, path, pool);
    if stk.is_empty() || !unm.is_empty() { return false; }
    let (b, masked) = (suf_j.as_bytes(), collect_masked_ranges(lang, suf_j, path, pool));
    let (mut i, mut m, mut rp_end) = (0usize, 0usize, None);
    while i < b.len() {
        while m < masked.len() && masked[m].1 <= i { m += 1; }
        if m < masked.len() && i >= masked[m].0 { i = masked[m].1; continue; }
        match b[i] {
            b'(' | b'[' | b'{' => stk.push(b[i]),
            b')' | b']' | b'}' => {
                let w = match b[i] { b')' => b'(', b']' => b'[', _ => b'{' };
                if let Some(p) = stk.iter().rposition(|&c| c == w) { stk.remove(p); }
                if stk.is_empty() { rp_end = Some(i + 1); break; }
            }
            _ => {}
        }
        i += 1;
    }
    let Some(end) = rp_end else { return false; };
    let (cond, kw) = (format!("{head}\n{}", &suf_j[..end]), pfx[s0].trim_start().split(|c: char| !c.is_ascii_alphanumeric() && c != '_').next().unwrap_or(""));
    if lang == LanguageId::Python {
        let ind0: String = pfx[s0].chars().take_while(|c| c.is_whitespace()).collect();
        let probe = if matches!(kw, "if" | "elif" | "while") { format!("{pre}{cond}:\n{ind0}  pass") } else { format!("{pre}{cond}") };
        return collect_r5_error_spans(lang, &probe, path, pool).is_ok_and(|e| e.is_empty());
    }
    if kw == "elsif" { return collect_r5_error_spans(lang, &format!("if _aice_\n  _aice_\n{cond}\n  _aice_\nend"), path, pool).is_ok_and(|e| e.is_empty()); }
    collect_r5_error_spans(lang, &cond, path, pool).is_ok_and(|e| e.is_empty())
        || collect_r5_error_spans(lang, &format!("{cond}\n  _aice_\nend"), path, pool).is_ok_and(|e| e.is_empty())
}
