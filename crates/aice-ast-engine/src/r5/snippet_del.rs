use std::path::Path;

use aice_lang_registry::LanguageId;

use crate::r5::checks::{ErrorSpan, collect_r5_error_spans};
use crate::r5::firewall_delta::EofDeltaCtx;
use crate::r5::snippet_blk::{normalize_edit_slices_with_depth, rust_type_container_insert_verdict};
use crate::r5::snippet_cache::PrefixCache;
use crate::r5::snippet_cst::line_delim_detail;
use crate::r5::snippet_ctx_scan::prefix_unclosed_openers;
use crate::r5::snippet_del_lang::{bash_compound_hdr_edit_err, bash_del_increases_imbalance, css_del_increases_imbalance,
    html_del_increases_imbalance, html_edit_increases_imbalance, html_xml_eof_close_ok, scan_twig_blocks,
    suf_first_unmatched_rbrace_followed_by_cont, toml_arr_boundary_ok, twig_del_increases_imbalance, twig_edit_increases_imbalance};
use crate::r5::snippet_del_win::{non_del_window_err, pure_del_window_err, toml_delim_scan, toml_unclosed_opener_lines, toml_unclosed_openers};
use crate::r5::snippet_eof::{edit_slice_has_error_cached, has_incomplete_continuation_tail, is_pure_code_comment};
use crate::r5::snippet_lex::is_code_lang;
use crate::r5::snippet_probe::min_snippet_errors;
use crate::r5::snippet_semi_op::{py_rb_ctrl_paren_ln, strip_code_trailing_comment};
use crate::ts_pool::ParserPool;

pub(crate) fn is_pure_del_suffix_span(ctx: &EofDeltaCtx<'_>, sp: &ErrorSpan) -> bool {
    if ctx.cand_edit_end >= ctx.cand_edit_start || sp.line != ctx.cand_edit_start { return false; }
    let shifted_end = (sp.end_line as isize - ctx.line_delta).max(1) as usize;
    (sp.message.starts_with("Missing syntax element:") && ctx.base_spans.iter().any(|b| {
        (b.line >= ctx.base_edit_start && b.end_line <= ctx.base_edit_end && b.message == sp.message)
            || (b.line <= ctx.base_edit_start && b.end_line >= ctx.base_edit_end
                && (b.message == sp.message || b.message.starts_with("Syntax error:")))
    })) || (ctx.prefix == 0 && ctx.base_spans.iter().any(|b| {
        b.line == 1 && b.column == sp.column && b.end_line == shifted_end && b.message == sp.message
    }))
}

pub(crate) fn pure_del_allow_span_split(ctx: &EofDeltaCtx<'_>, cand_spans: &[ErrorSpan], path: &Path, pool: &mut ParserPool) -> bool {
    if ctx.base_edit_end < ctx.base_edit_start
        || (!is_code_lang(ctx.lang) && !matches!(ctx.lang, LanguageId::Toml | LanguageId::Twig | LanguageId::Html | LanguageId::Xml | LanguageId::Css))
    { return false; }
    let mut dummy = false;
    let all_covered = cand_spans.iter().all(|sp| {
        if sp.end_line <= ctx.prefix {
            ctx.is_covered_prefix_span(sp, &mut dummy)
        } else if sp.line > ctx.cand_edit_end.max(ctx.prefix) {
            let (sl, se) = ((sp.line as isize - ctx.line_delta).max(1) as usize, (sp.end_line as isize - ctx.line_delta).max(1) as usize);
            is_pure_del_suffix_span(ctx, sp) || ctx.base_spans.iter().any(|b| {
                b.line <= sl && se <= b.end_line && (b.message == sp.message || (se - sl) < (b.end_line - b.line) || sp.message.starts_with("Missing syntax element:"))
            })
        } else {
            let se = (sp.end_line as isize - ctx.line_delta).max(1) as usize;
            ctx.base_spans.iter().any(|b| (b.line == sp.line && b.column == sp.column && b.message == sp.message && b.line <= ctx.prefix)
                || (b.line <= sp.line && se <= b.end_line && (b.message == sp.message || (se - sp.line) < (b.end_line - b.line))))
            || (matches!(ctx.lang, LanguageId::Ruby | LanguageId::Python) && se > sp.line
                && ctx.base_spans.iter().any(|b| b.line >= ctx.base_edit_start && b.end_line >= se && b.message.starts_with("Missing "))
                && py_rb_ctrl_paren_ln(ctx.lang, &ctx.base_lines[..ctx.prefix], &ctx.base_lines[..ctx.prefix].join("\n"),
                    &prefix_unclosed_openers(ctx.lang, &ctx.base_lines[..ctx.prefix], path, pool)).is_some_and(|ln| sp.line <= ln + 1))
        }
    });
    if !all_covered { return false; }
    if cand_spans.len() <= ctx.base_spans.len() { return true; }
    let base_in_edit = ctx.base_spans.iter().filter(|b| b.line <= ctx.base_edit_end && b.end_line >= ctx.base_edit_start).count();
    if ctx.cand_in_edit_count(cand_spans) > base_in_edit { return false; }
    if !is_code_lang(ctx.lang) { return false; }
    let raw_base = &ctx.base_lines[(ctx.base_edit_start - 1)..ctx.base_edit_end];
    let (b_stk, b_unm) = line_delim_detail(ctx.lang, &raw_base.join("\n"), path, pool);
    if !b_stk.is_empty() || b_unm.is_empty() { return false; }
    let pfx_openers = prefix_unclosed_openers(ctx.lang, &ctx.base_lines[..ctx.prefix], path, pool);
    !EofDeltaCtx::del_drops_matched_closer(ctx.lang, &pfx_openers, &b_stk, &b_unm, &ctx.base_lines[ctx.base_edit_end..], path, pool)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn pure_del_pre_verdict(ctx: &EofDeltaCtx<'_>, path: &Path, pool: &mut ParserPool,
    pfx: &[&str], raw_base: &[&str], suf: &[&str], cache: &PrefixCache) -> Option<bool> {
    if is_code_lang(ctx.lang) {
        let Some((bn, _)) = normalize_edit_slices_with_depth(ctx.lang, raw_base, &[], suf, cache.blk_depth) else { return Some(true); };
        let bj = bn.join("\n");
        if is_pure_code_comment(ctx.lang, &bj, pool) { return Some(false); }
        let (b_stk, b_unm) = line_delim_detail(ctx.lang, &bj, path, pool);
        if !b_unm.is_empty() && EofDeltaCtx::del_drops_matched_closer(ctx.lang, &cache.openers, &b_stk, &b_unm, suf, path, pool) { return Some(true); }
        if !b_stk.is_empty() && !suf.is_empty() && b_stk.contains(&b'{') {
            let suf_j = suf.join("\n");
            if line_delim_detail(ctx.lang, &suf_j, path, pool).1.first() == Some(&b'}')
                && suf_first_unmatched_rbrace_followed_by_cont(ctx.lang, &suf_j) { return Some(true); }
        }
        if ctx.lang == LanguageId::Bash && bash_del_increases_imbalance(pfx, raw_base, suf) { return Some(true); }
        return None;
    }
    if ctx.lang == LanguageId::Twig {
        if twig_del_increases_imbalance(pfx, raw_base, suf) { return Some(true); }
        return pure_del_window_err(ctx, pfx, raw_base, suf, cache, path, pool);
    }
    if matches!(ctx.lang, LanguageId::Toml | LanguageId::Html | LanguageId::Xml | LanguageId::Css) {
        if ctx.lang == LanguageId::Css && css_del_increases_imbalance(pfx, raw_base, suf) { return Some(true); }
        if matches!(ctx.lang, LanguageId::Html | LanguageId::Xml) && html_del_increases_imbalance(ctx.lang, pfx, raw_base, suf, path) { return Some(true); }
        if let Some(w) = pure_del_window_err(ctx, pfx, raw_base, suf, cache, path, pool) { return Some(w); }
        let rb_j = raw_base.join("\n");
        if ctx.lang == LanguageId::Toml && !is_pure_code_comment(LanguageId::Toml, &rb_j, pool)
            && pfx.iter().rev().find_map(|l| { let t = strip_code_trailing_comment(LanguageId::Toml, l).trim_end(); (!t.is_empty()).then_some(t) }).is_some_and(|t| t.ends_with('='))
            && min_snippet_errors(LanguageId::Toml, &rb_j, path, pool) > 0 { return Some(true); }
    }
    None
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn pure_del_post_verdict(ctx: &EofDeltaCtx<'_>, mut er: Option<bool>, path: &Path, pool: &mut ParserPool,
    pfx: &[&str], raw_base: &[&str], raw_cand: &[&str], suf: &[&str], last_code_idx: Option<usize>, cache: &PrefixCache) -> Option<bool> {
    let rb_j = raw_base.join("\n");
    if er == Some(true) && ctx.lang == LanguageId::Xml && collect_r5_error_spans(LanguageId::Xml, &format!("<_aice_>\n{rb_j}\n</_aice_>"), path, pool).is_ok_and(|e| e.is_empty()) {
        er = Some(false);
    }
    if er == Some(true) && ctx.lang == LanguageId::Bash {
        let (b_stk, b_unm) = line_delim_detail(LanguageId::Bash, &rb_j, path, pool);
        if b_stk.is_empty() && b_unm.is_empty() && !last_code_idx.is_some_and(|i| has_incomplete_continuation_tail(LanguageId::Bash, pfx[i], path, pool))
            && pure_del_window_err(ctx, pfx, raw_base, suf, cache, path, pool) == Some(false) { return Some(false); }
    }
    if er == Some(true) && ctx.lang == LanguageId::Rust && rust_type_container_insert_verdict(ctx.lang, pfx, raw_base, suf, path, pool) == Some(true)
        && (rust_type_container_insert_verdict(ctx.lang, pfx, &[""], suf, path, pool) == Some(true)
            || (!suf.is_empty() && rust_type_container_insert_verdict(ctx.lang, pfx, &suf[..1], &suf[1..], path, pool) == Some(true))) { er = Some(false); }
    if is_code_lang(ctx.lang) {
        let w_err = pure_del_window_err(ctx, pfx, raw_base, suf, cache, path, pool);
        if w_err == Some(true) { return Some(true); }
        if er == Some(true) {
            let (b_stk, b_unm) = line_delim_detail(ctx.lang, &rb_j, path, pool);
            if b_stk.is_empty() && !b_unm.is_empty()
                && !EofDeltaCtx::del_drops_matched_closer(ctx.lang, &cache.openers, &b_stk, &b_unm, suf, path, pool)
                && (ctx.lang != LanguageId::Bash || !bash_del_increases_imbalance(pfx, raw_base, suf))
            { return Some(false); }
        }
        if !matches!(ctx.lang, LanguageId::Python | LanguageId::Ruby) && let Some(c_e) = ctx.pure_del_local_errs(pfx, raw_cand, suf, last_code_idx, cache, path, pool) {
            if c_e == 0 { return Some(false); }
            if er == Some(false) && ctx.pure_del_local_errs(pfx, raw_base, suf, last_code_idx, cache, path, pool) == Some(0) { return Some(true); }
        }
    }
    er
}

pub(crate) fn non_code_needs_scoped_check(
    lang: LanguageId, pfx: &[&str], base_joined: &str, raw_base: &[&str], raw_cand: &[&str],
) -> bool {
    if raw_cand.is_empty() { return false; }
    if lang == LanguageId::Twig {
        return base_joined.contains("{%")
            || raw_cand.iter().any(|l| l.contains("{%") || l.contains("{{") || l.contains("{#") || l.contains(['<', '>']));
    }
    if lang == LanguageId::Toml && raw_base.is_empty() {
        return toml_unclosed_openers(pfx).last().is_some_and(|&(_, k)| matches!(k, b'[' | b'"' | b'\''));
    }
    (lang == LanguageId::Toml && !raw_base.is_empty() && (!toml_unclosed_opener_lines(pfx).is_empty() || base_joined.contains(['{', '}'])))
        || (matches!(lang, LanguageId::Html | LanguageId::Xml)
            && (base_joined.contains(['<', '>']) || raw_cand.iter().any(|l| l.contains(['<', '>']) || (lang == LanguageId::Xml && !l.trim().is_empty()))))
}

fn twig_open_stub(kw: &str, name: Option<&str>, saw_else: bool) -> String {
    let mut s = match kw {
        "block" => format!("{{% block {} %}}", name.unwrap_or("_aice_")),
        "macro" => format!("{{% macro {}() %}}", name.unwrap_or("_aice_")),
        "if" => "{% if _aice_ %}".to_string(), "for" => "{% for _x in _xs %}".to_string(),
        "set" => "{% set _aice_ %}".to_string(), "embed" => "{% embed \"_aice_.twig\" %}".to_string(),
        "apply" | "filter" => format!("{{% {kw} upper %}}"), "cache" => "{% cache \"_aice_\" %}".to_string(),
        _ => format!("{{% {kw} %}}"),
    };
    if saw_else { s.push_str("{% else %}"); } s
}

fn twig_closer_context_ok(pfx: &[&str], raw_cand: &[&str], suf: &[&str], path: &Path, pool: &mut ParserPool) -> bool {
    if !raw_cand.iter().any(|l| l.contains("{%")) { return false; }
    let (pfx_stk, _) = scan_twig_blocks(&pfx.join("\n"));
    if pfx_stk.is_empty() { return false; }
    let mut lines: Vec<String> = pfx_stk.iter().map(|(_, k, n, se)| twig_open_stub(k, n.as_deref(), *se)).collect();
    let open_cnt = lines.len();
    lines.extend(raw_cand.iter().map(|s| (*s).to_string()));
    let mut probe = lines.join("\n");
    let (rem, unexp) = scan_twig_blocks(&probe);
    if unexp > 0 || rem.iter().any(|(ln, _, _, _)| *ln >= open_cnt) { return false; }
    if !suf.is_empty() && !rem.is_empty() && collect_r5_error_spans(LanguageId::Twig, &format!("{probe}\n{}", suf.join("\n")), path, pool).is_ok_and(|e| e.is_empty()) { return true; }
    for (_, k, _, _) in rem.iter().rev() { probe.push_str(&format!("\n{{% end{k} %}}")); }
    collect_r5_error_spans(LanguageId::Twig, &probe, path, pool).is_ok_and(|e| e.is_empty())
}

fn toml_last_ml_off(line: &str, q: u8) -> Option<usize> {
    let (b, q3, mut i) = (line.as_bytes(), if q == b'"' { b"\"\"\"" } else { b"'''" }, 0usize);
    while i < b.len() {
        if b[i] == b'#' { break; }
        if b[i..].starts_with(b"\"\"\"") || b[i..].starts_with(b"'''") {
            let (cur, st) = (&b[i..i + 3], i); i += 3; let mut closed = false;
            while i < b.len() {
                if cur[0] == b'"' && b[i] == b'\\' { i += 2; continue; }
                if b[i..].starts_with(cur) { i += 3; closed = true; break; } i += 1;
            }
            if !closed && cur == q3 { return Some(st); } continue;
        }
        if matches!(b[i], b'"' | b'\'') {
            let qc = b[i]; i += 1;
            while i < b.len() {
                if qc == b'"' && b[i] == b'\\' { i += 2; continue; }
                if b[i] == qc { i += 1; break; }
                i += 1;
            }
            continue;
        } i += 1;
    } None
}
#[allow(clippy::too_many_arguments)]
pub(crate) fn toml_unclosed_fallback_err(
    pfx: &[&str], raw_base: &[&str], raw_cand: &[&str], suf: &[&str], first_suf_err: usize, path: &Path, pool: &mut ParserPool,
) -> Option<bool> {
    let (openers, mut ml_cand_s, mut ml_opens_delim) = (toml_unclosed_openers(pfx), None, false);
    let close_str = |ops: &[(usize, u8)]| ops.iter().rev().map(|&(_, t)| match t { b'"' => "\n\"\"\"", b'\'' => "\n'''", b'[' => "]", _ => "}" }).collect::<String>();
    if let Some(&(ql, q @ (b'"' | b'\''))) = openers.last() && !raw_cand.is_empty() {
        let (q3, off) = (if q == b'"' { "\"\"\"" } else { "'''" }, toml_last_ml_off(pfx[ql], q).unwrap_or(0));
        let tail = [&[&pfx[ql][off..]], &pfx[ql + 1..]].concat().join("\n");
        let cand_s = [&[tail.as_str()], raw_cand, &suf[..first_suf_err]].concat().join("\n");
        if toml_unclosed_openers(&cand_s.lines().collect::<Vec<_>>()).last().is_some_and(|&(_, k)| k == q) {
            let b_ok = collect_r5_error_spans(LanguageId::Toml, &format!("_aice_ = {tail}\n{q3}"), path, pool).is_ok_and(|e| e.is_empty());
            let c_ok = collect_r5_error_spans(LanguageId::Toml, &format!("_aice_ = {cand_s}\n{q3}"), path, pool).is_ok_and(|e| e.is_empty());
            if b_ok { return Some(!c_ok); }
        } else if openers.len() == 1 { return Some(!collect_r5_error_spans(LanguageId::Toml, &format!("_aice_ = {cand_s}"), path, pool).is_ok_and(|e| e.is_empty())); }
        else {
            let ns = [&[tail.as_str()], raw_cand].concat().join("\n");
            ml_opens_delim = toml_unclosed_openers(&ns.lines().collect::<Vec<_>>()).iter().any(|&(_, t)| matches!(t, b'[' | b'{' | b'H'));
            ml_cand_s = Some(cand_s);
        }
    }
    if (ml_cand_s.is_some() || (openers.last().is_some_and(|&(_, k)| k == b'[') && raw_base.is_empty())) && !raw_cand.is_empty() {
        for &(op_ln, k) in openers.iter().rev() {
            if k != b'[' { continue; }
            let base_sub = [&pfx[op_ln..], raw_base, &suf[..first_suf_err]].concat().join("\n");
            let sub_open = toml_unclosed_openers(&base_sub.lines().collect::<Vec<_>>());
            if (sub_open.is_empty() && ml_cand_s.is_none()) || sub_open.iter().any(|&(_, t)| !matches!(t, b'[' | b'{' | b'"' | b'\'')) { continue; }
            if collect_r5_error_spans(LanguageId::Toml, &format!("{base_sub}\n{}", close_str(&sub_open)), path, pool).is_ok_and(|e| e.is_empty()) {
                let cand_sub = [&pfx[op_ln..], raw_cand, &suf[..first_suf_err]].concat().join("\n");
                let c_open = toml_unclosed_openers(&cand_sub.lines().collect::<Vec<_>>());
                let c_ok = (!ml_opens_delim || c_open.is_empty())
                    && c_open.len() <= sub_open.iter().filter(|&&(_, t)| matches!(t, b'[' | b'{')).count()
                    && c_open.iter().all(|&(_, t)| matches!(t, b'[' | b'{'))
                    && collect_r5_error_spans(LanguageId::Toml, &format!("{cand_sub}\n{}", close_str(&c_open)), path, pool).is_ok_and(|e| e.is_empty());
                return Some(!c_ok);
            }
        }
    }
    if let Some(cs) = ml_cand_s {
        let mut p = String::from("_aice_ = ");
        for &(_, k) in &openers[..openers.len() - 1] {
            match k { b'[' => p.push_str("[\n"), b'{' => p.push_str("{ _k = "), _ => {} }
        }
        p.push_str(&cs);
        let (p_open, p_unm) = toml_delim_scan(&p.lines().collect::<Vec<_>>());
        return Some(!((!ml_opens_delim || p_open.is_empty()) && p_unm == 0 && p_open.iter().all(|&(_, t)| matches!(t, b'[' | b'{')) && collect_r5_error_spans(LanguageId::Toml, &format!("{p}\n{}", close_str(&p_open)), path, pool).is_ok_and(|e| e.is_empty())));
    }
    if !openers.is_empty() && { let (cs, cu) = toml_delim_scan(raw_cand); cs.is_empty() && cu == 0 } {
        let b_ok = collect_r5_error_spans(LanguageId::Toml, &format!("_aice = [\n{}\n]", raw_base.join("\n")), path, pool).is_ok_and(|e| e.is_empty());
        let c_ok = collect_r5_error_spans(LanguageId::Toml, &format!("_aice = [\n{}\n]", raw_cand.join("\n")), path, pool).is_ok_and(|e| e.is_empty());
        if b_ok && !c_ok { return Some(true); }
        if c_ok && let Some(&(op_ln, b'[')) = openers.last() && toml_arr_boundary_ok(pfx, op_ln, raw_cand, suf) { return Some(false); }
    } None
}
#[allow(clippy::too_many_arguments)]
pub(crate) fn midfile_non_del_post_hook(
    ctx: &EofDeltaCtx<'_>, er: Option<bool>, path: &Path, pool: &mut ParserPool,
    pfx: &[&str], raw_base: &[&str], raw_cand: &[&str], suf: &[&str], last_code_idx: Option<usize>, _cache: &PrefixCache,
) -> Option<bool> {
    if er == Some(false) && let Some(true) = bash_compound_hdr_edit_err(ctx.lang, raw_base, raw_cand, suf, ctx.base_spans, ctx.base_edit_end, path, pool) { return Some(true); }
    if er == Some(true) && suf.is_empty() && !raw_cand.is_empty() && html_xml_eof_close_ok(ctx.lang, pfx, raw_cand, path, pool) { return Some(false); }
    if er == Some(true) && ctx.lang == LanguageId::Twig && !raw_cand.is_empty() && !twig_edit_increases_imbalance(pfx, raw_base, raw_cand, suf) && twig_closer_context_ok(pfx, raw_cand, suf, path, pool) { return Some(false); }
    if er == Some(false) && ctx.lang == LanguageId::Twig && twig_edit_increases_imbalance(pfx, raw_base, raw_cand, suf) { return Some(true); }
    if er == Some(false) && matches!(ctx.lang, LanguageId::Html | LanguageId::Xml) && html_edit_increases_imbalance(ctx.lang, pfx, raw_base, raw_cand, suf, path) { return Some(true); }
    if let Some(w) = non_del_window_err(ctx, pfx, raw_base, raw_cand, suf, last_code_idx, path, pool)
        && ((er == Some(false) && w) || (er == Some(true) && ((ctx.lang == LanguageId::Twig && !twig_edit_increases_imbalance(pfx, raw_base, raw_cand, suf))
            || (ctx.lang == LanguageId::Toml && !raw_cand.is_empty()) || (matches!(ctx.lang, LanguageId::Html | LanguageId::Xml) && !html_edit_increases_imbalance(ctx.lang, pfx, raw_base, raw_cand, suf, path)))))
    { return Some(w); }
    if ctx.lang == LanguageId::Xml { crate::r5::snippet_del_xml::xml_midfile_fallback(er, path, pool, pfx, raw_base, raw_cand, suf) } else { er }
}
#[allow(clippy::too_many_arguments)]
pub(crate) fn check_edit_slice_has_error_midfile(
    ctx: &EofDeltaCtx<'_>, path: &Path, pool: &mut ParserPool,
    pfx: &[&str], raw_base: &[&str], raw_cand: &[&str], suf: &[&str], last_code_idx: Option<usize>, cache: &mut PrefixCache,
) -> (Option<bool>, bool) {
    let pure_del = raw_cand.is_empty() && !raw_base.is_empty();
    let comment_del = !pure_del && !raw_base.is_empty() && !raw_cand.is_empty()
        && !is_pure_code_comment(ctx.lang, &raw_base.join("\n"), pool)
        && is_pure_code_comment(ctx.lang, &raw_cand.join("\n"), pool);
    if (pure_del || comment_del) && let Some(v) = pure_del_pre_verdict(ctx, path, pool, pfx, raw_base, suf, cache) {
        return (Some(v), true);
    }
    let er = edit_slice_has_error_cached(ctx.lang, path, pool, pfx, raw_base, raw_cand, suf, ctx.is_eof_append, last_code_idx, cache);
    if pure_del || comment_del {
        let res = pure_del_post_verdict(ctx, er, path, pool, pfx, raw_base, raw_cand, suf, last_code_idx, cache);
        return (res, !(matches!(ctx.lang, LanguageId::Python | LanguageId::Ruby)
            && (res == Some(false) || (pure_del && py_rb_ctrl_paren_ln(ctx.lang, pfx, &cache.joined, &cache.openers).is_some()))));
    }
    (midfile_non_del_post_hook(ctx, er, path, pool, pfx, raw_base, raw_cand, suf, last_code_idx, cache), false)
}
