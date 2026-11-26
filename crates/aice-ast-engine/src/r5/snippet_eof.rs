use std::path::Path;

use aice_lang_registry::LanguageId;
use crate::r5::snippet_blk::{find_blk_comment_close, normalize_edit_slices_with_depth, rust_type_container_insert_verdict};
use crate::r5::snippet_cache::{PrefixCache, last_code_line_idx};
use crate::r5::snippet_container::{PrefixContainer, classify_prefix_container};
use crate::r5::snippet_container_compat::container_compatible_for;
use crate::r5::snippet_cst::{line_delim_detail, strip_trailing_comment};
use crate::r5::snippet_ctx::clean_context_suffix_with_cache;
use crate::r5::snippet_ctx_scan::{allows_ts_arrow_fallback_with_openers, collect_opener_hdr, prefix_innermost_unclosed_paren_with_openers};
pub(crate) use crate::r5::snippet_eof_ctx::{broken_tail_insert_errs, context_verdict_with_ctx, has_incomplete_continuation_tail};
use crate::r5::snippet_hdr_ts::{is_ts_unrecoverable_missing_arrow_group_at, ts_kw_method_probe_ctx};
use crate::r5::snippet_lex::{has_hash_comments, has_slash_comments, is_code_lang};
use crate::r5::snippet_ops::is_colon_stmt_or_label_header;
use crate::r5::snippet_probe::{has_merged_edit_error_ctx, min_snippet_errors};
use crate::r5::snippet_rs_attr::{ctx_matches_prefix, is_rust_attr_group, is_semi_terminated_broken_opener, rust_attr_tail_is_open, rust_unclosed_attr_no_rbrack_ok, rust_unclosed_attr_tail};
use crate::r5::snippet_ts_gen_ambig::{is_ts_ambig_generic_or_obj_brace, is_ts_invalid_kw_lt_opener};
use crate::r5::snippet_ts_gen_close::has_ts_unclosed_lt_closed_without_gt;
use crate::r5::snippet_type_body::{TB_IFACE, bh_looks_like_type_body};
use crate::ts_pool::ParserPool;

fn twig_html_cmt_has_tag(s: &str) -> bool {
    let (b, mut i) = (s.as_bytes(), 0usize);
    while i < b.len() {
        if b[i..].starts_with(b"{#") {
            let Some(r) = s[i + 2..].find("#}") else { return true; };
            i += 4 + r;
        } else if b[i..].starts_with(b"{%") || b[i..].starts_with(b"{{") { return true; }
        else { i += 1; }
    }
    false
}

pub(crate) fn is_pure_code_comment(lang: LanguageId, s: &str, _pool: &mut ParserPool) -> bool {
    let (slash, hash) = (has_slash_comments(lang) || lang == LanguageId::Json, has_hash_comments(lang));
    let html = matches!(lang, LanguageId::Html | LanguageId::Xml | LanguageId::Markdown | LanguageId::Twig);
    let (b, mut i) = (s.as_bytes(), 0usize);
    while i < b.len() {
        if (slash && lang != LanguageId::Css && b[i..].starts_with(b"//")) || (hash && b[i] == b'#') {
            while i < b.len() && b[i] != b'\n' { i += 1; }
        } else if slash && b[i..].starts_with(b"/*") {
            let (Some(after), _) = find_blk_comment_close(lang, b, i + 2, 1) else { return false; };
            i = after;
        } else if lang == LanguageId::Twig && b[i..].starts_with(b"{#") {
            let Some(r) = s[i + 2..].find("#}") else { return false; };
            i += 4 + r;
        } else if html && b[i..].starts_with(b"<!--") {
            let Some(r) = s[i + 4..].find("-->") else { return false; };
            if lang == LanguageId::Twig && twig_html_cmt_has_tag(&s[i + 4..i + 4 + r]) { return false; }
            i += 7 + r;
        } else if let Some(ch) = s[i..].chars().next() && ch.is_whitespace() {
            i += ch.len_utf8();
        } else { return false; }
    }
    true
}

pub(crate) fn slice_adds_unmatched_closer_cached(
    lang: LanguageId, prefix_lines: &[&str], raw_base: &[&str], raw_cand: &[&str],
    cache: &mut PrefixCache, path: &Path, pool: &mut ParserPool,
) -> bool {
    if !is_code_lang(lang) || raw_cand.is_empty() { return false; }
    let ctx = clean_context_suffix_with_cache(lang, prefix_lines, cache, path, pool).0.unwrap_or_default();
    let join_ctx = |sl: &[&str]| match (ctx.is_empty(), sl.is_empty()) {
        (true, _) => sl.join("\n"),
        (false, true) => ctx.join("\n"),
        (false, false) => format!("{}\n{}", ctx.join("\n"), sl.join("\n")),
    };
    let (_, b_unm) = line_delim_detail(lang, &join_ctx(raw_base), path, pool);
    let (_, c_unm) = line_delim_detail(lang, &join_ctx(raw_cand), path, pool);
    c_unm.len() > b_unm.len()
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn edit_slice_has_error_cached(
    lang: LanguageId, path: &Path, pool: &mut ParserPool,
    prefix_lines: &[&str], raw_base: &[&str], raw_cand: &[&str], suffix_lines: &[&str],
    is_eof_append: bool, last_code_idx: Option<usize>, cache: &mut PrefixCache,
) -> Option<bool> {
    let (base_norm, cand_norm) =
        normalize_edit_slices_with_depth(lang, raw_base, raw_cand, suffix_lines, cache.blk_depth)?;
    let last_idx = last_code_idx.or_else(|| last_code_line_idx(lang, prefix_lines, pool));
    let last_non_empty = last_idx.map(|i| prefix_lines[i]);
    let has_unclosed_seq = prefix_innermost_unclosed_paren_with_openers(
        lang, prefix_lines, last_idx, &cache.openers, pool,
    ).is_some_and(|(_, has_comma)| has_comma);
    let last_attr_or_semi_op = last_idx.is_some_and(|idx| {
        is_rust_attr_group(lang, &cache.joined, &cache.openers, idx)
            || cache.openers.iter().rfind(|&&(_, l, _)| l == idx).is_some_and(|&(d, _, byte)| {
                is_semi_terminated_broken_opener(lang, &cache.joined, d, byte, prefix_lines[idx])
            })
    });
    let last_incomplete = !last_attr_or_semi_op
        && (last_non_empty.is_some_and(|l| {
            has_incomplete_continuation_tail(lang, l, path, pool)
                && !is_colon_stmt_or_label_header(lang, strip_trailing_comment(lang, l, pool), cache.prefix_ctx)
        }) || has_unclosed_seq);
    let has_suffix = !is_eof_append;
    let prefix_ctx = cache.prefix_ctx;
    let is_container = prefix_ctx.is_scoped_non_stmt();
    let cand_joined = cand_norm.join("\n");
    let (unrec_kw_lt, unrec_arrow) = unrec_ts_opener_flags(lang, prefix_lines, cache, path, pool);
    let (cand_stk, cand_unm) = line_delim_detail(lang, &cand_joined, path, pool);
    let (base_stk, base_unm) = if base_norm.is_empty() { (Vec::new(), Vec::new()) } else { line_delim_detail(lang, &base_norm.join("\n"), path, pool) };
    let net_d = |s: &[u8], u: &[u8], o: u8, c: u8| s.iter().filter(|&&x| x == o).count() as isize - u.iter().filter(|&&x| x == c).count() as isize;
    let (cand_open, base_open) = (cand_stk.iter().filter(|&&c| c == b'{').count(), base_stk.iter().filter(|&&c| c == b'{').count());
    let is_mid_cont = !is_eof_append && is_code_lang(lang) && cand_unm == b"}"
        && is_valid_mid_continuation_brace(lang, &cand_joined, suffix_lines, path, pool);
    if !is_eof_append && is_code_lang(lang)
        && (net_d(&cand_stk, &cand_unm, b'{', b'}') > net_d(&base_stk, &base_unm, b'{', b'}')
            || (cand_open > base_open && !cand_unm.is_empty() && !is_mid_cont)) { return Some(true); }
    let pb_inc = net_d(&cand_stk, &cand_unm, b'(', b')') > net_d(&base_stk, &base_unm, b'(', b')') || net_d(&cand_stk, &cand_unm, b'[', b']') > net_d(&base_stk, &base_unm, b'[', b']');
    if !is_eof_append && is_code_lang(lang) && (pb_inc || (!base_unm.is_empty() && (cand_norm.is_empty() || (!is_mid_cont && cand_unm.len() < base_unm.len())))) {
        let pop = |stk: &mut Vec<u8>, s: &[u8], u: &[u8]| {
            for &c in u {
                let w = match c { b')' => b'(', b']' => b'[', _ => b'{' };
                if let Some(p) = stk.iter().rposition(|&o| o == w) { stk.remove(p); }
            }
            stk.extend_from_slice(s);
        };
        let (suf_stk, suf_unm) = if suffix_lines.is_empty() { (Vec::new(), Vec::new()) } else { line_delim_detail(lang, &suffix_lines.join("\n"), path, pool) };
        let init: Vec<u8> = if !pb_inc || !base_unm.is_empty() { cache.openers.iter().map(|&(d, _, _)| d).collect() } else { Vec::new() }; let (mut b_stk, mut c_stk) = (init.clone(), init);
        pop(&mut b_stk, &base_stk, &base_unm); pop(&mut b_stk, &suf_stk, &suf_unm);
        pop(&mut c_stk, &cand_stk, &cand_unm); pop(&mut c_stk, &suf_stk, &suf_unm);
        if c_stk.len() > b_stk.len() { return Some(true); }
    }
    let ts_arrow_ovr = Some(*cache.ts_arrow_ok.get_or_insert_with(|| allows_ts_arrow_fallback_with_openers(lang, &cache.joined, &cache.openers)));
    let ts_ambig = is_ts_ambig_generic_or_obj_brace(lang, &cache.joined, &cache.openers, cache.prefix_ctx);
    let mut m_ctx_opt = ts_kw_method_probe_ctx(lang, &cache.joined, &cache.openers);
    if let Some(m_ctx) = m_ctx_opt.as_mut() && last_incomplete && let Some(l) = last_non_empty && line_delim_detail(lang, l, path, pool).0.is_empty() {
        m_ctx.push(l.to_string());
    }
    let m_ctx_fits = |m_ctx: &[String], pool: &mut ParserPool| -> bool {
        if cand_unm.len() <= 1 { return true; }
        let (m_stk, _) = line_delim_detail(lang, &m_ctx.join("\n"), path, pool);
        cand_unm.len() <= m_stk.len() && m_stk.iter().rev().zip(cand_unm.iter()).all(|(&o, &c)| matches!((o, c), (b'(', b')') | (b'[', b']') | (b'{', b'}')))
    };
    if base_norm.is_empty() {
        if let Some(ok) = rust_type_container_insert_verdict(lang, prefix_lines, &cand_norm, suffix_lines, path, pool) { return Some(!ok); }
        let (ctx_opt, innermost_kept) = clean_context_suffix_with_cache(lang, prefix_lines, cache, path, pool);
        if let Some(err) = rust_unclosed_attr_edit_err(lang, prefix_lines, cache, &ctx_opt, &cand_norm, &cand_unm, ts_arrow_ovr, None, path, pool) { return Some(err); }
        if let Some(m_ctx) = m_ctx_opt.as_ref() && m_ctx_fits(m_ctx, pool) {
            return Some(!context_verdict_with_ctx(lang, m_ctx, prefix_lines, &cand_norm, last_incomplete, (ts_arrow_ovr, false), path, pool));
        }
        if unrec_kw_lt { return Some(!is_pure_code_comment(lang, &cand_joined, pool)); }
        if unrec_arrow && is_pure_code_comment(lang, &cand_joined, pool) { return Some(false); }
        let ctx_use = ctx_opt.as_ref().filter(|ctx| {
            let refs: Vec<&str> = ctx.iter().map(String::as_str).collect();
            ctx_matches_prefix(lang, ctx, prefix_ctx, path, pool)
                && (innermost_kept || !is_container
                    || (is_mid_cont && !classify_prefix_container(lang, &refs, path, pool).is_scoped_non_stmt()))
        });
        let cand_errs = if let Some(ctx) = ctx_use {
            if is_pure_code_comment(lang, &cand_joined, pool) && ctx.iter().any(|l| matches!(l.trim(), "0" | "0,")) { return Some(false); }
            usize::from(!context_verdict_with_ctx(lang, ctx, prefix_lines, &cand_norm, last_incomplete, (ts_arrow_ovr, ts_ambig), path, pool))
        } else if is_container && !(unrec_kw_lt || unrec_arrow) {
            if prefix_ctx == PrefixContainer::TypeBody(TB_IFACE) && cand_unm == b"}"
                && has_ts_unclosed_lt_closed_without_gt(lang, &cache.joined, &cache.openers, &cand_joined) { return Some(true); }
            usize::from(!container_compatible_for(lang, &cand_joined, prefix_ctx, has_suffix, path, pool))
        } else if last_incomplete {
            broken_tail_insert_errs(lang, last_non_empty.unwrap_or(""), &cand_norm, path, pool)
        } else {
            min_snippet_errors(lang, &cand_joined, path, pool)
        };
        return Some(cand_errs > 0);
    }
    let base_joined = base_norm.join("\n");
    let has_op_tail = |lines: &[&str], p: &mut ParserPool| {
        last_code_line_idx(lang, lines, p).is_some_and(|i| has_incomplete_continuation_tail(lang, lines[i], path, p))
    };
    let no_new_op_tail = is_eof_append || has_op_tail(&base_norm, pool) || !has_op_tail(&cand_norm, pool);
    let has_rbrace = base_norm.iter().any(|l| l.contains('}')) || cand_norm.iter().any(|l| l.contains('}'));
    let base_is_cmt = is_pure_code_comment(lang, &base_joined, pool);
    if !has_rbrace && rust_type_container_insert_verdict(lang, prefix_lines, &base_norm, suffix_lines, path, pool) == Some(true) {
        let c_ok = rust_type_container_insert_verdict(lang, prefix_lines, &cand_norm, suffix_lines, path, pool).unwrap_or(false);
        if !c_ok { return Some(true); }
        if no_new_op_tail { return Some(false); }
    }
    if (has_rbrace || base_is_cmt)
        && let Some(c_ok) = rust_type_container_insert_verdict(lang, prefix_lines, &cand_norm, suffix_lines, path, pool)
    {
        if !c_ok && (has_rbrace || (base_is_cmt && no_new_op_tail)) { return Some(true); }
        if c_ok && no_new_op_tail { return Some(false); }
    }
    let mut ctx_res = clean_context_suffix_with_cache(lang, prefix_lines, cache, path, pool);
    if !base_is_cmt && matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx) && (ctx_res.0.is_none() || ctx_res.0.as_ref().is_some_and(|v| v.iter().any(|l| matches!(l.trim(), "0" | "0,")))) {
        ctx_res = crate::r5::snippet_ctx::clean_context_suffix_with_openers(lang, prefix_lines, Some(&cache.openers), Some(&cache.joined), Some(cache.prefix_ctx), true, path, pool);
    }
    let (ctx_opt, innermost_kept) = ctx_res;
    if let Some(err) = rust_unclosed_attr_edit_err(lang, prefix_lines, cache, &ctx_opt, &cand_norm, &cand_unm, ts_arrow_ovr, Some((&base_norm, base_is_cmt)), path, pool) { return Some(err); }
    if let Some(m_ctx) = m_ctx_opt.as_ref() && m_ctx_fits(m_ctx, pool) {
        let b_ok = context_verdict_with_ctx(lang, m_ctx, prefix_lines, &base_norm, last_incomplete, (ts_arrow_ovr, false), path, pool);
        let c_ok = context_verdict_with_ctx(lang, m_ctx, prefix_lines, &cand_norm, last_incomplete, (ts_arrow_ovr, false), path, pool);
        if b_ok && !c_ok { return Some(true); }
        if c_ok && no_new_op_tail { return Some(false); }
        if !b_ok && !c_ok { return Some(true); }
    }
    if unrec_kw_lt && !is_pure_code_comment(lang, &cand_joined, pool) { return Some(true); }
    if let Some(ctx) = ctx_opt.as_ref().filter(|ctx| (innermost_kept || !is_container) && ctx_matches_prefix(lang, ctx, prefix_ctx, path, pool)) {
        let base_ok = context_verdict_with_ctx(lang, ctx, prefix_lines, &base_norm, last_incomplete, (ts_arrow_ovr, ts_ambig), path, pool);
        let cand_ok = context_verdict_with_ctx(lang, ctx, prefix_lines, &cand_norm, last_incomplete, (ts_arrow_ovr, ts_ambig), path, pool);
        if base_ok && !cand_ok { return Some(true); }
        if base_ok && cand_ok && no_new_op_tail { return Some(false); }
        if base_is_cmt && !base_ok {
            let py_probe = (lang == LanguageId::Python).then(|| {
                let refs: Vec<&str> = ctx.iter().map(String::as_str).collect();
                let line = last_code_line_idx(lang, &refs, pool).map(|i| refs[i]).or_else(|| refs.last().copied()).unwrap_or("");
                let mut ind: String = line.chars().take_while(|c| *c == ' ' || *c == '\t').collect();
                if strip_trailing_comment(lang, line, pool).ends_with(':') { ind.push_str(if ind.contains('\t') { "\t" } else { "  " }); }
                format!("{ind}_aice_")
            });
            let aice_sl = [py_probe.as_deref().unwrap_or("_aice_")];
            if cand_ok && no_new_op_tail && context_verdict_with_ctx(lang, ctx, prefix_lines, &aice_sl, last_incomplete, (ts_arrow_ovr, ts_ambig), path, pool) { return Some(false); }
            if !cand_ok && !is_pure_code_comment(lang, &cand_joined, pool)
                && (context_verdict_with_ctx(lang, ctx, prefix_lines, &aice_sl, last_incomplete, (ts_arrow_ovr, ts_ambig), path, pool) || unrec_kw_lt || unrec_arrow || ctx.iter().any(|l| matches!(l.trim(), "0" | "0,"))) { return Some(true); }
        }
    }
    if !has_rbrace && is_container && !(unrec_kw_lt || unrec_arrow) && container_compatible_for(lang, &base_joined, prefix_ctx, has_suffix, path, pool) {
        let c_ok = container_compatible_for(lang, &cand_joined, prefix_ctx, has_suffix, path, pool);
        if !c_ok { return Some(true); }
        if no_new_op_tail { return Some(false); }
    }
    let cand_errs = min_snippet_errors(lang, &cand_joined, path, pool);
    let base_errs = min_snippet_errors(lang, &base_joined, path, pool);
    let merged_err = (base_errs > 0 || is_container
        || (prefix_ctx == PrefixContainer::TopLevel && bh_looks_like_type_body(lang, &base_norm, path, pool)))
        && has_merged_edit_error_ctx(lang, path, pool, &base_norm, &cand_norm, base_errs, (Some(prefix_ctx), has_suffix));
    Some(cand_errs > base_errs || merged_err)
}

fn is_valid_mid_continuation_brace(
    lang: LanguageId, cand_joined: &str, suffix_lines: &[&str], path: &Path, pool: &mut ParserPool,
) -> bool {
    let clean = crate::r5::snippet_synth::strip_comments_strings(lang, cand_joined, false);
    let (mut depth, mut unm_pos) = (0isize, None);
    for (i, &c) in clean.as_bytes().iter().enumerate() {
        if c == b'{' { depth += 1; } else if c == b'}' {
            depth -= 1;
            if depth < 0 { unm_pos = Some(i); break; }
        }
    }
    let Some(pos) = unm_pos else { return false };
    let after = &clean[pos + 1..];
    let kw = after.trim_start().split(|c: char| !c.is_ascii_alphanumeric() && c != '_').next();
    if !matches!(kw, Some("else" | "elif" | "elsif" | "catch" | "finally")) { return false; }
    let (mut pd, mut cont_depth, mut opened_cont) = (0usize, 0isize, false);
    for &c in after.as_bytes() {
        match c {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1),
            b'{' if pd == 0 => { cont_depth += 1; opened_cont = true; }
            b'}' if pd == 0 => { cont_depth -= 1; if cont_depth <= 0 { return false; } }
            _ => {}
        }
    }
    opened_cont && line_delim_detail(lang, &suffix_lines.join("\n"), path, pool).1.contains(&b'}')
}

#[allow(clippy::too_many_arguments)]
fn rust_unclosed_attr_edit_err(
    lang: LanguageId, prefix_lines: &[&str], cache: &PrefixCache, ctx_opt: &Option<Vec<String>>,
    cand_norm: &[&str], cand_unm: &[u8], ts_arrow_ovr: Option<bool>,
    base_chk: Option<(&[&str], bool)>, path: &Path, pool: &mut ParserPool,
) -> Option<bool> {
    if lang != LanguageId::Rust { return None; }
    let attr_tail = rust_unclosed_attr_tail(prefix_lines, &cache.joined, &cache.openers)?;
    if let Some((base_norm, base_is_cmt)) = base_chk {
        let is_enum = cache.prefix_ctx == PrefixContainer::TypeBody(crate::r5::snippet_type_body::TB_ENUM);
        let mut tail = attr_tail.clone();
        tail.extend_from_slice(base_norm);
        if !base_is_cmt && !rust_attr_tail_is_open(&tail, is_enum) { return None; }
    }
    if cand_unm.contains(&b']') {
        let mut probe_ctx = ctx_opt.clone().unwrap_or_default();
        probe_ctx.extend(attr_tail.into_iter().map(str::to_string));
        return Some(!context_verdict_with_ctx(lang, &probe_ctx, prefix_lines, cand_norm, false, (ts_arrow_ovr, false), path, pool));
    }
    rust_unclosed_attr_no_rbrack_ok(lang, prefix_lines, &cache.joined, &cache.openers, cand_norm, cand_unm, path, pool).map(|ok| !ok)
}

fn unrec_ts_opener_flags(lang: LanguageId, prefix_lines: &[&str], cache: &PrefixCache, path: &Path, pool: &mut ParserPool) -> (bool, bool) {
    if !matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx) { return (false, false); }
    cache.openers.iter().enumerate().filter(|&(_, &(d, _, _))| d == b'{').fold((false, false), |(kw, ar), (idx, &(_, ln, _))| {
        let min_ln = cache.openers[..idx].iter().rev().find(|&&(_, l, _)| l < ln).map_or(0, |&(_, l, _)| l + 1);
        let hdr = collect_opener_hdr(lang, prefix_lines, ln, min_ln, path, pool);
        (kw || is_ts_invalid_kw_lt_opener(lang, &cache.joined, &cache.openers, idx, &hdr) || crate::r5::snippet_ts_brace::is_unrec_ts_op_or_js_ret_at(lang, &cache.joined, &cache.openers, idx),
         ar || is_ts_unrecoverable_missing_arrow_group_at(lang, &cache.joined, &cache.openers, idx, &hdr))
    })
}
