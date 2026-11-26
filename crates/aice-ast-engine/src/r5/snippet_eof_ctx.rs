use std::path::Path;

use aice_lang_registry::LanguageId;
use crate::r5::checks::collect_r5_error_spans;
use crate::r5::snippet_cache::last_code_line_idx;
use crate::r5::snippet_container::{PrefixContainer, classify_prefix_container};
use crate::r5::snippet_cst::{cst_defect_profile, line_delim_detail, strip_trailing_comment};
use crate::r5::snippet_ctx_scan::{allows_ts_arrow_fallback, bash_compound_closers};
use crate::r5::snippet_lex::is_code_lang;
use crate::r5::snippet_ops::{has_valid_trailing_binary_op, is_trailing_continuation_token, trailing_binary_op};
use crate::r5::snippet_probe::min_snippet_errors;
use crate::r5::snippet_type_body::TB_IFACE;
use crate::ts_pool::ParserPool;

pub(crate) fn has_incomplete_continuation_tail(
    lang: LanguageId,
    line: &str,
    path: &Path,
    pool: &mut ParserPool,
) -> bool {
    if !is_code_lang(lang) {
        return false;
    }
    let code = strip_trailing_comment(lang, line, pool);
    if code.is_empty() {
        return false;
    }
    if has_valid_trailing_binary_op(lang, code) || is_trailing_continuation_token(lang, code) {
        return true;
    }
    let (stack, unmatched) = line_delim_detail(lang, code, path, pool);
    unmatched.is_empty() && matches!(stack.last(), Some(b'(' | b'['))
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn context_verdict_with_ctx(
    lang: LanguageId,
    ctx: &[String],
    prefix_lines: &[&str],
    cand_norm: &[&str],
    last_incomplete: bool,
    ts_overrides: (Option<bool>, bool),
    path: &Path,
    pool: &mut ParserPool,
) -> bool {
    let (ts_arrow_override, ts_ambig_brace) = ts_overrides;
    let cand_joined = cand_norm.join("\n");
    if cst_defect_profile(lang, &cand_joined, path, pool).unclosed_quotes > 0 {
        return false;
    }
    let ctx_joined = ctx.join("\n");
    let combined = format!("{ctx_joined}\n{cand_joined}");
    let (comb_stack, comb_unm) = line_delim_detail(lang, &combined, path, pool);
    if !comb_unm.is_empty() {
        return false;
    }
    let (cand_stack, cand_unm) = line_delim_detail(lang, &cand_joined, path, pool);
    let closer_stack = if cand_stack.iter().any(|&c| matches!(c, b'(' | b'[')) {
        let (mut ctx_stk, _) = line_delim_detail(lang, &ctx_joined, path, pool);
        for &u in &cand_unm {
            let want = match u { b')' => b'(', b']' => b'[', _ => b'{' };
            if let Some(pos) = ctx_stk.iter().rposition(|&c| c == want) { ctx_stk.remove(pos); }
        }
        ctx_stk
    } else {
        comb_stack
    };
    let closers: String = closer_stack
        .iter()
        .rev()
        .map(|&c| match c { b'(' => ')', b'[' => ']', _ => '}' })
        .collect();
    let last_cand = last_code_line_idx(lang, cand_norm, pool).map_or("", |i| cand_norm[i]);
    let last_cand_code = strip_trailing_comment(lang, last_cand, pool);
    let needs_placeholder = (last_incomplete && has_incomplete_continuation_tail(lang, last_cand, path, pool))
        || (last_cand_code.ends_with(',') && matches!(closer_stack.last(), Some(b'(' | b'[')));
    let ctx_refs: Vec<&str> = ctx.iter().map(String::as_str).collect();
    let ctx_cls = if matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx) {
        Some(classify_prefix_container(lang, &ctx_refs, path, pool))
    } else {
        None
    };
    let is_js_value_paren = closer_stack.last() == Some(&b'(') && ctx_cls == Some(PrefixContainer::ValueParen);
    let is_ts_iface_ctx = matches!(lang, LanguageId::TypeScript | LanguageId::Tsx)
        && closer_stack.last() == Some(&b'{')
        && ctx_cls == Some(PrefixContainer::TypeBody(TB_IFACE));
    let is_ts_iface_generic = is_ts_iface_ctx
        && !ts_ambig_brace
        && crate::r5::snippet_ts_gen_close::ctx_needs_ts_generic_gt(lang, &ctx_joined);
    let arrow_ok = matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx)
        && closers.starts_with(')')
        && (allows_ts_arrow_fallback(lang, &ctx_refs, path, pool)
            || (ctx.first().is_some_and(|l| l.trim_start().starts_with("type "))
                && allows_ts_arrow_fallback(lang, &[ctx_joined.as_str(), cand_joined.as_str()], path, pool))
            || ts_arrow_override.unwrap_or_else(|| allows_ts_arrow_fallback(lang, prefix_lines, path, pool)));
    let has_cmt = cand_norm.last().is_some_and(|l| strip_trailing_comment(lang, l, pool) != l.trim_end());
    let ind_src = if !last_cand_code.is_empty() { last_cand_code } else { last_code_line_idx(lang, &ctx_refs, pool).map_or("", |i| ctx_refs[i]) };
    let ind: String = if has_cmt { ind_src.chars().take_while(|c| *c == ' ' || *c == '\t').collect() } else { String::new() };
    let sep = if has_cmt { format!("\n{ind}") } else { " ".to_string() };
    let nl = if has_cmt { sep.as_str() } else { "" };
    let split_semi = closers.find('}').filter(|&p| p > 0);
    let mut cands = Vec::new();
    if is_ts_iface_generic {
        crate::r5::snippet_ts_gen_close::push_ts_generic_brace_cands(lang, &combined, &closers, &mut cands);
    } else if needs_placeholder {
        cands.push(format!("{combined}{sep}_aice_{closers}"));
        cands.push(format!("{combined}{sep}_aice_{closers};"));
        if let Some(p) = split_semi {
            cands.push(format!("{combined}{sep}_aice_{};\n{}", &closers[..p], &closers[p..]));
            if !is_js_value_paren
                && matches!(lang, LanguageId::TypeScript | LanguageId::Tsx)
                && p == 1
                && closers.starts_with(")}")
            {
                cands.push(format!("{combined}{sep}_aice_{} {{}}\n{}", &closers[..p], &closers[p..]));
            }
            if lang == LanguageId::Cpp && closers.starts_with(')') {
                cands.push(format!("{combined}{sep}int _aice_{} {{}};\n{}", &closers[..p], &closers[p..]));
            }
        }
        if !is_js_value_paren {
            cands.push(format!("{combined}{sep}_aice_{closers} {{}}"));
        }
        if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx)
            && ctx.first().is_some_and(|l| l.trim_start().starts_with("type "))
            && closer_stack.last() == Some(&b'[')
        {
            cands.push(format!("{combined}{sep}_aice_: unknown{closers};"));
            cands.push(format!("{combined}{nl}{closers};"));
        }
        if lang == LanguageId::Kotlin {
            cands.push(format!("{combined}{nl}{closers} {{}}"));
            cands.push(format!("{combined}{sep}_aice_: _T{closers} {{}}"));
        } else if lang == LanguageId::Python {
            cands.push(format!("{combined} _aice_{closers}: pass"));
            cands.push(format!("{combined}\n{ind}_aice_{closers}: pass"));
        } else if lang == LanguageId::Php {
            cands.push(format!("{combined}{sep}$_aice_{closers} {{}}"));
            cands.push(format!("{combined}{sep}$_aice_{closers};"));
        }
        if arrow_ok && let Some(rest) = closers.strip_prefix(')') {
            cands.push(format!("{combined}{sep}_aice_) => {{}}{rest}"));
        }
        if matches!(lang, LanguageId::C | LanguageId::Cpp)
            && closer_stack.last() == Some(&b'[')
            && let Some(pos) = ctx_joined.rfind('[')
            && let Some(rest) = closers.strip_prefix(']')
        {
            let pre = &ctx_joined[..pos + 1];
            let post = &ctx_joined[pos + 1..];
            cands.push(format!("{pre}({post}\n{cand_joined}{sep}_aice_)]{rest}"));
            cands.push(format!("{pre}({post}\n{cand_joined}{sep}_aice_)]{rest};"));
            if let Some(p) = split_semi {
                cands.push(format!("{pre}({post}\n{cand_joined}{sep}_aice_)]{};\n{}", &closers[1..p], &closers[p..]));
            }
        }
    } else {
        if !closers.is_empty() {
            cands.push(format!("{combined}\n{closers}"));
            cands.push(format!("{combined}\n{closers};"));
            if !is_js_value_paren {
                cands.push(format!("{combined}\n{closers} {{}}"));
            }
        }
        cands.push(format!("{combined}{closers}"));
        cands.push(format!("{combined}{closers};"));
        if !closers.is_empty() {
            if !is_js_value_paren {
                cands.push(format!("{combined}{closers} {{}}"));
            }
            if lang == LanguageId::Python {
                cands.push(format!("{combined}{closers}: pass"));
                cands.push(format!("{combined}\n{ind}{closers}: pass"));
            } else if lang == LanguageId::Php {
                cands.push(format!("{combined}{closers};"));
            }
            if arrow_ok && let Some(rest) = closers.strip_prefix(')') {
                cands.push(format!("{combined}{nl}) => {{}}{rest}"));
            }
        }
        if let Some(p) = split_semi {
            cands.push(format!("{combined}{nl}{};\n{}", &closers[..p], &closers[p..]));
            if !is_js_value_paren
                && matches!(lang, LanguageId::TypeScript | LanguageId::Tsx)
                && p == 1
                && closers.starts_with(")}")
            {
                cands.push(format!("{combined}{nl}{} {{}}\n{}", &closers[..p], &closers[p..]));
            }
            if lang == LanguageId::Cpp && closers.starts_with(')') {
                cands.push(format!("{combined}{nl}{} {{}};\n{}", &closers[..p], &closers[p..]));
            }
        }
        if closers.len() >= 2 && closers.starts_with('}') {
            cands.push(format!("{combined}\n}};\n{}", &closers[1..]));
        }
        if lang == LanguageId::Python && last_cand_code.ends_with(':') {
            cands.push(format!("{combined}\n    pass"));
            cands.push(format!("{combined}\n        pass"));
        }
        if is_ts_iface_ctx || ts_ambig_brace {
            crate::r5::snippet_ts_gen_close::push_ts_generic_brace_cands(lang, &combined, &closers, &mut cands);
        }
    }
    if matches!(lang, LanguageId::Tsx | LanguageId::JavaScript) {
        let (ic, ok) = crate::r5::snippet_ctx::tsx_interleaved_closers(&combined, Some(ctx_joined.len() + 1));
        if ok {
            if needs_placeholder { cands.push(format!("{combined}{sep}_aice_{ic}")); }
            cands.push(format!("{combined}\n{ic}"));
            cands.push(format!("{combined}{ic}"));
            cands.push(format!("{combined}{ic};"));
        }
    }
    if lang == LanguageId::Bash {
        let sh = bash_compound_closers(lang, &combined);
        if !sh.is_empty() {
            let tail = sh.join("\n");
            cands.push(format!("{combined}\n{tail}"));
            cands.push(format!("{combined}\n  true\n{tail}"));
        }
    }
    cands.iter().any(|c| {
        if is_js_value_paren {
            let raw_ok = collect_r5_error_spans(lang, c, path, pool).is_ok_and(|s| s.is_empty())
                || collect_r5_error_spans(
                    lang,
                    &format!("function _aice_probe_() {{\n{c}\n}}"),
                    path,
                    pool,
                )
                .is_ok_and(|s| s.is_empty());
            raw_ok && cst_defect_profile(lang, c, path, pool).unclosed_quotes == 0
        } else {
            let p = cst_defect_profile(lang, c, path, pool);
            p.min_errs == 0 && p.unclosed_quotes == 0
        }
    })
}

pub(crate) fn broken_tail_insert_errs(
    lang: LanguageId,
    last_line: &str,
    cand_norm: &[&str],
    path: &Path,
    pool: &mut ParserPool,
) -> usize {
    let cand_joined = cand_norm.join("\n");
    let combined = format!("{last_line}\n{cand_joined}");
    let last_code = strip_trailing_comment(lang, last_line, pool);
    let probe_last = if last_code != last_line.trim_end() { last_code } else { last_line };
    let base_min = min_snippet_errors(lang, &format!("{probe_last} _aice_"), path, pool)
        .min(min_snippet_errors(lang, &format!("{probe_last} _aice_;"), path, pool));
    if min_snippet_errors(lang, &combined, path, pool) > base_min {
        return 1;
    }
    if let Some((op, _)) = trailing_binary_op(lang, last_code) {
        let mut probes = vec![format!("_aice_ {op}\n{cand_joined}")];
        match lang {
            LanguageId::Rust => probes.push(format!("let _v = _aice_ {op}\n{cand_joined}")),
            LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx => {
                probes.push(format!("const _v = _aice_ {op}\n{cand_joined}"));
            }
            LanguageId::Php => probes.push(format!("<?php _aice_ {op}\n{cand_joined}")),
            _ => {}
        }
        if probes.iter().all(|p| min_snippet_errors(lang, p, path, pool) > 0) {
            return 1;
        }
    }
    let (stk, _) = line_delim_detail(lang, last_code, path, pool);
    if let Some(&d @ (b'(' | b'[')) = stk.last() {
        let close = if d == b'(' { ')' } else { ']' };
        let open = d as char;
        let p1 = format!("_aice_{open}\n{cand_joined}\n{close}");
        let p2 = format!("_aice_{open}\n{cand_joined}\n{close};");
        if min_snippet_errors(lang, &p1, path, pool) > 0
            && min_snippet_errors(lang, &p2, path, pool) > 0
        {
            return 1;
        }
    }
    0
}
