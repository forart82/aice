use std::path::Path; use aice_lang_registry::LanguageId; use crate::ts_pool::ParserPool;
use crate::r5::{snippet_blk::{ends_in_block_comment, find_blk_comment_close}, snippet_cache::{PrefixCache, last_code_line_idx}, snippet_container::PrefixContainer, snippet_cst::{cst_defect_profile, line_delim_detail, strip_trailing_comment}, snippet_eof_ctx::has_incomplete_continuation_tail, snippet_lex::is_code_lang, snippet_lit::{JsLexState, StepQuote}, snippet_rs_attr::{is_rust_attr_group, is_rust_attr_opener, is_semi_terminated_broken_opener}, snippet_synth::{strip_comments_strings, synthetic_opener_cands}, snippet_type_body::TB_IFACE};
pub(crate) use crate::r5::snippet_ctx_scan::{allows_ts_arrow_fallback, anchor_drained_chain, append_bash_openers, collect_opener_hdr, ctx_group_parent, prefix_unclosed_openers, push_no_placeholder_cands};

fn skip_tsx_ws_cmt(b: &[u8], mut i: usize) -> usize {
    while i < b.len() {
        if b[i].is_ascii_whitespace() { i += 1; }
        else if b[i..].starts_with(b"//") { i += 2; while i < b.len() && b[i] != b'\n' { i += 1; } }
        else if b[i..].starts_with(b"/*") { i = find_blk_comment_close(LanguageId::Tsx, b, i + 2, 1).0.unwrap_or(b.len()); }
        else { break; } } i
}
fn tsx_pre_eq_toks_ok(b: &[u8]) -> bool {
    let (mut j, mut n) = (skip_tsx_ws_cmt(b, 0), 0usize);
    while j < b.len() { n += 1; if n > 2 { return false; }
        while j < b.len() && !b[j].is_ascii_whitespace() && !b[j..].starts_with(b"//") && !b[j..].starts_with(b"/*") { if b[j] == b'=' { return false; } j += 1; }
        j = skip_tsx_ws_cmt(b, j); } n >= 1
}
fn is_tsx_generic_params(tag: &[u8], inner: &[u8], after_gt: &[u8]) -> bool {
    let (mut i, mut pd, mut cd, mut q, mut has_comma, mut has_eq_t, mut has_ext, mut non_ws) = (0usize, 0usize, 0usize, 0u8, false, false, false, false);
    while i < inner.len() {
        if q != 0 { if inner[i] == b'\\' { i += 1; } else if inner[i] == q { q = 0; } }
        else if inner[i..].starts_with(b"//") || inner[i..].starts_with(b"/*") { i = skip_tsx_ws_cmt(inner, i); continue; }
        else if matches!(inner[i], b'"' | b'\'') && cd == 0 { q = inner[i]; non_ws = true; }
        else if inner[i] == b'{' { cd += 1; non_ws = true; } else if inner[i] == b'}' { cd = cd.saturating_sub(1); }
        else if cd == 0 && inner[i] == b'(' { pd += 1; non_ws = true; } else if cd == 0 && inner[i] == b')' { pd = pd.saturating_sub(1); }
        else if cd == 0 && pd == 0 {
            if inner[i] == b',' { has_comma = true; non_ws = true; }
            else if inner[i] == b'=' {
                let allow_mod_eq = matches!(tag, b"const" | b"in" | b"out") && tsx_pre_eq_toks_ok(&inner[..i]);
                if !non_ws || allow_mod_eq || !matches!(inner.get(skip_tsx_ws_cmt(inner, i + 1)).copied(), Some(b'"' | b'\'' | b'{')) { has_eq_t = true; }
                non_ws = true;
            } else if inner[i..].starts_with(b"extends") && (i == 0 || (!inner[i - 1].is_ascii_alphanumeric() && inner[i - 1] != b'_'))
                && inner.get(i + 7).is_none_or(|&c| !c.is_ascii_alphanumeric() && c != b'_') {
                if inner.get(skip_tsx_ws_cmt(inner, i + 7)).is_some_and(|&c| c != b'=') { has_ext = true; } non_ws = true;
            } else if !inner[i].is_ascii_whitespace() { non_ws = true; }
        }
        i += 1;
    }
    has_comma || (after_gt.get(skip_tsx_ws_cmt(after_gt, 0)) == Some(&b'(') && (has_ext || has_eq_t))
}

pub(crate) fn tsx_interleaved_closers(s: &str, min_tag_byte: Option<usize>) -> (String, bool) {
    let (out, ok, _) = tsx_scan_closers(s, min_tag_byte, false); (out, ok)
}
pub(crate) fn tsx_scan_closers(s: &str, min_tag_byte: Option<usize>, allow_nl_tag: bool) -> (String, bool, Option<usize>) {
    enum Item<'a> { Delim(u8, usize), JsxBrace(usize), Tag(&'a str, usize) }
    let (b, mut i, mut js, mut stk, mut last_tok, mut saw_closed_jsx) = (s.as_bytes(), 0usize, JsLexState::new(), Vec::<Item<'_>>::new(), 0usize, false);
    let is_id = |c: u8| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$');
    while i < b.len() {
        let in_jsx = matches!(stk.last(), Some(Item::Tag(..)));
        if b[i] == b'\n' { if !in_jsx { js.on_newline(LanguageId::Tsx); } i += 1; continue; }
        if !in_jsx {
            if js.step_quote(LanguageId::Tsx, b, &mut i) != StepQuote::NotInQuote || js.open_quote(LanguageId::Tsx, b, &mut i) { last_tok = i; continue; }
            if let Some((end, _)) = js.match_special(LanguageId::Tsx, b, i) { i = end; last_tok = i; continue; }
            if b[i..].starts_with(b"//") { while i < b.len() && b[i] != b'\n' { i += 1; } continue; }
            if b[i..].starts_with(b"/*") { let (Some(a), _) = find_blk_comment_close(LanguageId::Tsx, b, i + 2, 1) else { break; }; i = a; continue; }
            match b[i] {
                b'(' | b'[' | b'{' => { stk.push(Item::Delim(b[i], i)); i += 1; last_tok = i; continue; }
                b')' | b']' => {
                    let want = if b[i] == b')' { b'(' } else { b'[' };
                    if let Some(p) = stk.iter().rposition(|x| matches!(x, Item::Delim(d, _) if *d == want))
                        && stk[p + 1..].iter().all(|x| matches!(x, Item::Delim(..))) { stk.remove(p); }
                    i += 1; last_tok = i; continue; }
                b'}' => {
                    if let Some(p) = stk.iter().rposition(|x| matches!(x, Item::Delim(b'{', _) | Item::JsxBrace(_)))
                        && stk[p + 1..].iter().all(|x| matches!(x, Item::Delim(..))) { stk.remove(p); }
                    i += 1; last_tok = i; continue; }
                _ => {}
            }
        } else if b[i] == b'{' { stk.push(Item::JsxBrace(i)); i += 1; last_tok = i; continue; }
        if b[i] == b'<' {
            let close = b.get(i + 1) == Some(&b'/');
            let (ns, mut ne) = (i + 1 + usize::from(close), i + 1 + usize::from(close));
            while ne < b.len() && (is_id(b[ne]) || matches!(b[ne], b'.' | b'-' | b':')) { ne += 1; }
            let sep_ok = ne == ns || matches!(b.get(ne), Some(b'>' | b'/')) || b.get(ne).is_some_and(u8::is_ascii_whitespace);
            let prev_ok = in_jsx || close || last_tok == 0 || (allow_nl_tag && b[last_tok..i].contains(&b'\n'))
                || (!matches!(b[last_tok - 1], b')' | b']') && (!is_id(b[last_tok - 1])
                    || matches!(s[..last_tok].rsplit(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next(), Some("return" | "yield" | "await" | "throw" | "case" | "else" | "default" | "export"))));
            if sep_ok && prev_ok && ((ns == ne && b.get(ns) == Some(&b'>')) || (ne > ns && (b[ns].is_ascii_alphabetic() || matches!(b[ns], b'_' | b'$')))) {
                let (mut k, mut cd, mut pd, mut q) = (ne, 0usize, 0usize, 0u8);
                while k < b.len() {
                    if q != 0 { if b[k] == b'\\' { k += 1; } else if b[k] == q { q = 0; } }
                    else if !in_jsx && (b[k..].starts_with(b"//") || b[k..].starts_with(b"/*")) { k = skip_tsx_ws_cmt(b, k); continue; }
                    else if matches!(b[k], b'"' | b'\'') && cd == 0 { q = b[k]; }
                    else if b[k] == b'{' { cd += 1; } else if b[k] == b'}' { cd = cd.saturating_sub(1); }
                    else if cd == 0 && b[k] == b'(' { pd += 1; } else if cd == 0 && b[k] == b')' { pd = pd.saturating_sub(1); }
                    else if cd == 0 && pd == 0 && b[k] == b'>' && (k == 0 || b[k - 1] != b'=') {
                        let name = &s[ns..ne];
                        if close { if let Some(p) = stk.iter().rposition(|x| matches!(x, Item::Tag(t, _) if *t == name)) { stk.truncate(p); } saw_closed_jsx |= min_tag_byte.is_none_or(|m| i >= m); }
                        else if k > ns && b[k - 1] == b'/' { saw_closed_jsx |= min_tag_byte.is_none_or(|m| i >= m); }
                        else if !(!in_jsx && is_tsx_generic_params(name.as_bytes(), &b[ne..k], &b[k + 1..])) { stk.push(Item::Tag(name, i)); }
                        i = k + 1; last_tok = i; break;
                    } else if cd == 0 && pd == 0 && matches!(b[k], b'<' | b';') { break; }
                    k += 1;
                }
                if k < b.len() && b[k] == b'>' && cd == 0 && pd == 0 && q == 0 { continue; }
            }
        }
        if !in_jsx { let p = i; js.step_byte(LanguageId::Tsx, b, &mut i); if !b[p].is_ascii_whitespace() { last_tok = i; } } else { i += 1; }
    }
    let (mut has_tag, mut cand_unclosed, mut out, mut first_tag) = (false, false, String::new(), None);
    for item in stk.iter().rev() {
        let pos = match *item { Item::Delim(b'(', p) => { out.push(')'); p } Item::Delim(b'[', p) => { out.push(']'); p } Item::Delim(_, p) | Item::JsxBrace(p) => { out.push('}'); p } Item::Tag(t, p) => { has_tag = true; first_tag = Some(p); out.push_str(&format!("</{t}>")); p } };
        if min_tag_byte.is_some_and(|m| pos >= m) { cand_unclosed = true; }
    }
    (out, !cand_unclosed && (has_tag || saw_closed_jsx), first_tag)
}

pub(crate) fn slice_cleanly_completable(lang: LanguageId, slice: &[&str], stack: &[u8], path: &Path, pool: &mut ParserPool) -> bool {
    if ends_in_block_comment(lang, slice, path, pool) > 0 { return false; }
    let joined = slice.join("\n");
    let closers: String = stack.iter().rev().map(|&c| match c { b'(' => ')', b'[' => ']', _ => '}' }).collect();
    let last_line = last_code_line_idx(lang, slice, pool).map_or("", |i| slice[i]);
    let last_code = strip_trailing_comment(lang, last_line, pool);
    let needs_placeholder = has_incomplete_continuation_tail(lang, last_line, path, pool)
        || (last_code.ends_with(',') && matches!(stack.last(), Some(b'(' | b'[')));
    let has_cmt = slice.last().is_some_and(|l| strip_trailing_comment(lang, l, pool) != l.trim_end());
    let ind: String = if has_cmt { last_code.chars().take_while(|c| *c == ' ' || *c == '\t').collect() } else { String::new() };
    let sep = if has_cmt { format!("\n{ind}") } else { " ".to_string() };
    let nl = if has_cmt { sep.as_str() } else { "" };
    let tsx_jsx_info = (lang == LanguageId::Tsx).then(|| crate::r5::snippet_container::tsx_unclosed_jsx_tail_info(slice, 0, None, last_code_line_idx(lang, slice, pool), true, pool)).flatten();
    if tsx_jsx_info.is_some_and(|(_, _, ns)| ns) { return false; }
    let (mut cands, split_semi, tsx_jsx_open) = (Vec::new(), closers.find('}').filter(|&p| p > 0), tsx_jsx_info.is_some());
    if tsx_jsx_open {} else if matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx) && stack.ends_with(b"({")
        && last_code.contains('(') && last_code.contains('{') && !last_code.contains("function") && !last_code.contains("=>") { cands.push(format!("{joined}\n  \"_k_\": 1\n{closers}")); }
    else if needs_placeholder {
        cands.push(format!("{joined}{sep}_aice_{closers}")); cands.push(format!("{joined}{sep}_aice_{closers};"));
        if let Some(p) = split_semi {
            cands.push(format!("{joined}{sep}_aice_{};\n{}", &closers[..p], &closers[p..]));
            if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx) && p == 1 && closers.starts_with(")}") { cands.push(format!("{joined}{sep}_aice_{} {{}}\n{}", &closers[..p], &closers[p..])); }
            if lang == LanguageId::Cpp && closers.starts_with(')') { cands.push(format!("{joined}{sep}int _aice_{} {{}};\n{}", &closers[..p], &closers[p..])); }
        }
        cands.push(format!("{joined}{sep}_aice_{closers} {{}}")); cands.push(format!("{joined}{sep}{{}}{closers}"));
        if lang == LanguageId::Kotlin { cands.push(format!("{joined}{nl}{closers} {{}}")); cands.push(format!("{joined}{sep}_aice_: _T{closers} {{}}")); }
        else if lang == LanguageId::Python { cands.push(format!("{joined} _aice_{closers}: pass")); cands.push(format!("{joined}\n{ind}_aice_{closers}: pass")); }
        else if lang == LanguageId::Php { cands.push(format!("{joined}{sep}$_aice_{closers} {{}}")); cands.push(format!("{joined}{sep}$_aice_{closers};")); }
        if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript) && let Some(rest) = closers.strip_prefix(')') && allows_ts_arrow_fallback(lang, slice, path, pool) { cands.push(format!("{joined}{sep}_aice_) => {{}}{rest}")); }
    } else { push_no_placeholder_cands(lang, slice, &joined, &closers, last_code, &mut cands, path, pool); }
    if matches!(lang, LanguageId::Tsx | LanguageId::JavaScript) && let (ic, true) = tsx_interleaved_closers(&joined, None) {
        if needs_placeholder { cands.push(format!("{joined}{sep}_aice_{ic}")); cands.push(format!("{joined}{sep}_aice_{ic};")); }
        cands.push(format!("{joined}\n{ic}")); cands.push(format!("{joined}{ic}")); cands.push(format!("{joined}{ic};"));
    }
    crate::r5::snippet_ctx_bash::push_bash_completable_cands(lang, &joined, &mut cands);
    crate::r5::snippet_ts_gen_close::push_ts_generic_brace_cands(lang, &joined, &closers, &mut cands);
    cands.iter().any(|c| { let p = cst_defect_profile(lang, c, path, pool); p.min_errs == 0 && p.unclosed_quotes == 0 })
}
pub(crate) fn clean_context_suffix_with_cache(lang: LanguageId, prefix_lines: &[&str], cache: &mut PrefixCache, path: &Path, pool: &mut ParserPool) -> (Option<Vec<String>>, bool) {
    if let Some(res) = &cache.ctx_status { return res.clone(); }
    let res = clean_context_suffix_with_openers(lang, prefix_lines, Some(&cache.openers), Some(&cache.joined), Some(cache.prefix_ctx), false, path, pool);
    cache.ctx_status = Some(res.clone()); res
}
#[allow(clippy::too_many_arguments)]
pub(crate) fn clean_context_suffix_with_openers(lang: LanguageId, prefix_lines: &[&str], cached_openers: Option<&[(u8, usize, usize)]>, cached_joined: Option<&str>, prefix_ctx: Option<PrefixContainer>, ext_kept_tail: bool, path: &Path, pool: &mut ParserPool) -> (Option<Vec<String>>, bool) {
    if !is_code_lang(lang) || prefix_lines.is_empty() { return (None, false); }
    let last_idx = last_code_line_idx(lang, prefix_lines, pool);
    let last_incomplete = last_idx.is_some_and(|idx| has_incomplete_continuation_tail(lang, prefix_lines[idx], path, pool));
    let owned_openers; let openers = match cached_openers { Some(o) => o, None => { owned_openers = prefix_unclosed_openers(lang, prefix_lines, path, pool); &owned_openers } };
    let owned_joined; let joined_str = if let Some(j) = cached_joined { j } else { owned_joined = prefix_lines.join("\n"); &owned_joined };
    let skip_raw = (matches!(lang, LanguageId::TypeScript | LanguageId::Tsx) && matches!(prefix_ctx, Some(PrefixContainer::TypeBody(TB_IFACE) | PrefixContainer::TypeBracket | PrefixContainer::TypeParen))) || openers.iter().any(|&(d, _, byte)| d == b'[' && is_rust_attr_opener(lang, joined_str, byte));
    if !skip_raw && prefix_lines.len() <= 48 { let (stk, unm) = line_delim_detail(lang, joined_str, path, pool); if unm.is_empty() && slice_cleanly_completable(lang, prefix_lines, &stk, path, pool) { return (Some(prefix_lines.iter().map(|s| (*s).to_string()).collect()), true); } }
    let mut groups: Vec<(usize, usize, Vec<u8>)> = Vec::new();
    for &(d, op_line, byte) in openers {
        if let Some(last) = groups.last_mut().filter(|g| g.0 == op_line) { last.2.push(d); } else { groups.push((op_line, byte, vec![d])); }
    }
    let drained = groups.len() > 24;
    let drain_parent = if drained { let cut = groups[groups.len() - 24].0; groups.drain(..groups.len() - 24); ctx_group_parent(lang, joined_str, openers, cut) } else { PrefixContainer::TopLevel };
    let completable = |lines: &[String], pool: &mut ParserPool| -> bool {
        let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        let (stk, unm) = line_delim_detail(lang, &lines.join("\n"), path, pool); unm.is_empty() && slice_cleanly_completable(lang, &refs, &stk, path, pool)
    };
    let to_owned = |sl: &[&str]| sl.iter().map(|s| (*s).to_string()).collect::<Vec<String>>();
    let is_semi_grp = |ln: usize| last_idx == Some(ln) && openers.iter().rfind(|&&(_, l, _)| l == ln)
        .is_some_and(|&(d, _, byte)| is_semi_terminated_broken_opener(lang, joined_str, d, byte, prefix_lines[ln]));
    let mut hdrs: Vec<Vec<&str>> = Vec::with_capacity(groups.len());
    for (g, &(op_line, _, _)) in groups.iter().enumerate() {
        let min_line = if g == 0 { 0 } else { groups[g - 1].0 + 1 };
        hdrs.push(collect_opener_hdr(lang, prefix_lines, op_line, min_line, path, pool));
    }
    let (mut chain, mut chain_is_synth, mut chain_has_lparen, mut innermost_kept, mut has_unrec) = (Vec::new(), false, false, !groups.is_empty(), false);
    let (mut effective_last, mut g_idx) = (groups.len().saturating_sub(1), groups.len() as isize - 1);
    while g_idx >= 0 {
        let (g, op_line) = (g_idx as usize, groups[g_idx as usize].0);
        if is_rust_attr_group(lang, joined_str, openers, op_line) || is_semi_grp(op_line) {
            if g == effective_last { effective_last = effective_last.saturating_sub(1); innermost_kept = false; }
            g_idx -= 1; continue;
        }
        let h = to_owned(&hdrs[g]);
        if crate::r5::snippet_hdr_ts::is_ts_unrecoverable_missing_arrow_group(lang, &hdrs[g])
            || (matches!(lang, LanguageId::TypeScript | LanguageId::Tsx) && groups[g].2.contains(&b'{') && openers.iter().enumerate()
                .any(|(op_idx, &(d, l, _))| l == op_line && d == b'{' && crate::r5::snippet_ts_gen_ambig::is_ts_invalid_kw_lt_opener(lang, joined_str, openers, op_idx, &hdrs[g])))
            || (groups[g].2.contains(&b'{') && crate::r5::snippet_ts_gen_chk::is_js_invalid_iface_hdr_in(lang, &hdrs[g], ctx_group_parent(lang, joined_str, openers, op_line) == PrefixContainer::ClassOrTraitBody))
            || crate::r5::snippet_ts_brace::is_unrec_ts_op_or_js_ret_opener(lang, joined_str, openers, op_line) {
            chain = if chain.is_empty() { h } else { let mut c = h; c.extend(chain); c };
            innermost_kept = true; has_unrec = true; break;
        }
        let bare_js_brace = matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx)
            && groups[g].2.last() == Some(&b'{') && prefix_lines[op_line].trim() == "{";
        let drop_hdr_ok = if hdrs[g].len() > 1 && matches!(lang, LanguageId::TypeScript | LanguageId::Tsx) {
            let (h_join, line_off): (String, usize) = (h.join("\n"), prefix_lines[..op_line].iter().map(|l| l.len() + 1).sum());
            let tail_len = prefix_lines[op_line].len().saturating_sub(groups[g].1.saturating_sub(line_off));
            !prefix_lines[op_line].trim_start().starts_with('<')
                && !crate::r5::snippet_ts_gen_ambig::is_ts_var_decl_lt_without_assign(lang, &h_join[..h_join.len().saturating_sub(tail_len)])
        } else { true };
        if chain.is_empty() && g == effective_last {
            let (has_lp, is_ts, last_d) = (groups[g].2.contains(&b'('), matches!(lang, LanguageId::TypeScript | LanguageId::Tsx), groups[g].2.last().copied());
            let type_ok = |ls: &[String], p: &mut ParserPool| -> bool {
                let mut pr = ls.to_vec();
                match (is_ts, last_d, prefix_ctx) {
                    (true, Some(b'{'), Some(PrefixContainer::TypeBody(TB_IFACE))) => pr.push("  readonly _aice_: number;".to_string()),
                    (true, Some(b'['), Some(PrefixContainer::TypeBracket)) => pr.push("  _aice_: number,".to_string()),
                    (true, Some(b'('), Some(PrefixContainer::TypeParen)) => return ls.iter().any(|l| l.trim_start().starts_with("type ")),
                    _ => return true,
                } completable(&pr, p)
            };
            let ts_type_hdr_ok = type_ok(&h, pool);
            if ts_type_hdr_ok && !(bare_js_brace && h.len() == 1) && completable(&h, pool) { chain = h; chain_has_lparen = has_lp; g_idx -= 1; continue; }
            if g > 0 && !is_rust_attr_group(lang, joined_str, openers, groups[g - 1].0) {
                let (mut comb, mut hit) = (h.clone(), None);
                for k in (0..g).rev().take(4) {
                    if is_rust_attr_group(lang, joined_str, openers, groups[k].0) { break; }
                    let mut nc = to_owned(&hdrs[k]); nc.extend(comb); comb = nc;
                    if (ts_type_hdr_ok || type_ok(&comb, pool)) && completable(&comb, pool) { hit = Some(k); break; }
                    if ts_type_hdr_ok { break; }
                } if let Some(k) = hit { chain = comb; g_idx = k as isize - 1; continue; }
            }
            let single = vec![prefix_lines[op_line].to_string()];
            if ts_type_hdr_ok && !bare_js_brace && hdrs[g].len() > 1 && drop_hdr_ok && completable(&single, pool) { chain = single; chain_has_lparen = has_lp; g_idx -= 1; continue; }
            let pctx = ctx_group_parent(lang, joined_str, openers, op_line);
            if let Some(s) = synthetic_opener_cands(lang, &hdrs[g], &groups[g].2, pctx).into_iter().find(|s| completable(s, pool)) {
                chain_has_lparen = has_lp && s.iter().any(|l| l.trim_end().ends_with('(')); chain = s; chain_is_synth = true;
            } else { innermost_kept = false; }
            g_idx -= 1; continue;
        }
        let mut comb = h.clone(); comb.extend(chain.iter().cloned());
        if completable(&comb, pool) { chain = comb; chain_is_synth = false; chain_has_lparen = false; g_idx -= 1; continue; }
        if !bare_js_brace && hdrs[g].len() > 1 && drop_hdr_ok { let mut c1 = vec![prefix_lines[op_line].to_string()]; c1.extend(chain.iter().cloned());
            if completable(&c1, pool) { chain = c1; chain_is_synth = false; chain_has_lparen = false; g_idx -= 1; continue; } }
        if !completable(&h, pool) { let pctx = ctx_group_parent(lang, joined_str, openers, op_line);
            if let Some(sc) = synthetic_opener_cands(lang, &hdrs[g], &groups[g].2, pctx).into_iter().map(|mut s| { s.extend(chain.iter().cloned()); s }).find(|s| completable(s, pool)) { chain = sc; chain_is_synth = true; }
            g_idx -= 1; continue; }
        else if groups[g].2.last() == Some(&b'{') && (chain_is_synth || chain_has_lparen) { if chain_is_synth && !chain_has_lparen { break; }
            chain = h; chain_is_synth = false; chain_has_lparen = false; innermost_kept = false; g_idx -= 1; continue; }
        else if chain.is_empty() { chain = h; g_idx -= 1; continue; } else { break; }
    }
    if drained { anchor_drained_chain(lang, drain_parent, prefix_ctx, &mut chain, &mut |sl| completable(sl, pool)); }
    let mut last_op_end = groups.last().map_or(0, |g| g.0 + 1);
    let bash_arm_hdr = append_bash_openers(lang, prefix_lines, last_idx, &mut last_op_end, &mut chain, &mut innermost_kept, &mut |sl| completable(sl, pool));
    let accum_has_last = last_op_end > 0 && last_idx == Some(last_op_end - 1) && innermost_kept;
    let tail_min = last_op_end.max(last_idx.unwrap_or(prefix_lines.len()).saturating_sub(24)).min(prefix_lines.len());
    let tsx_no_semi_info = (lang == LanguageId::Tsx)
        .then(|| crate::r5::snippet_container::tsx_unclosed_jsx_tail_info(prefix_lines, last_op_end, (last_op_end > 0).then(|| openers.last().map(|o| o.2)).flatten(), last_idx, true, pool)).flatten();
    if tsx_no_semi_info.is_some_and(|(_, _, ns)| ns) {
        let mut uc = chain.clone(); uc.extend(prefix_lines[last_op_end..].iter().map(|s| (*s).to_string())); uc.push("{ * }".into()); return (Some(uc), true);
    }
    if let Some((_, jsx_ln, _)) = tsx_no_semi_info && jsx_ln < tail_min {
        let mut cand = chain.clone(); cand.extend(prefix_lines[jsx_ln..].iter().map(|s| (*s).to_string()));
        if completable(&cand, pool) { return (Some(cand), innermost_kept); }
    }
    for tail_start in tail_min..=prefix_lines.len() {
        if tail_start == prefix_lines.len() && tsx_no_semi_info.is_some() { break; }
        if last_incomplete && !accum_has_last && last_idx.is_some_and(|idx| {
            tail_start > idx && !is_rust_attr_group(lang, joined_str, openers, idx) && !is_semi_grp(idx)
                && (chain.is_empty() || !strip_trailing_comment(lang, prefix_lines[idx], pool).ends_with(';'))
        }) { break; }
        if tail_start < prefix_lines.len() && (prefix_lines[tail_start].trim().is_empty()
            || crate::r5::snippet_semi_op::is_line_in_rust_unclosed_attr(lang, joined_str, openers, tail_start)) { continue; }
        let (mut cand, mut unrec_param) = (chain.clone(), false);
        if matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx)
            && matches!(prefix_ctx, Some(PrefixContainer::ValueParen | PrefixContainer::TypeBody(crate::r5::snippet_type_body::TB_PARAM)))
            && tail_start > last_op_end && prefix_lines[last_op_end..tail_start].iter().any(|l| !strip_trailing_comment(lang, l, pool).is_empty()) {
            let has_kept_tail = ext_kept_tail || !strip_comments_strings(lang, &prefix_lines[tail_start..].join("\n"), false).trim().is_empty();
            if prefix_ctx == Some(PrefixContainer::ValueParen) || !has_kept_tail {
                let has_comma = strip_comments_strings(lang, &prefix_lines[last_op_end..tail_start].join("\n"), false).trim_end().ends_with(',');
                let ok = crate::r5::snippet_ctx_scan::is_ts_arrow_dropped_params_ok(lang, &chain, &prefix_lines[last_op_end..tail_start], has_kept_tail, prefix_ctx != Some(PrefixContainer::ValueParen), path, pool);
                unrec_param = prefix_ctx != Some(PrefixContainer::ValueParen) && !ok;
                if prefix_ctx == Some(PrefixContainer::ValueParen) || !ok { cand.push(format!("  {}{}", if ok { "_aice_" } else { "0" }, if has_comma { "," } else { "" })); }
            }
        }
        if let Some(arm) = &bash_arm_hdr && !prefix_lines[tail_min..tail_start].iter().any(|l| l.contains(";;")) { cand.push(arm.clone()); }
        cand.extend(prefix_lines[tail_start..].iter().map(|s| (*s).to_string()));
        if !cand.is_empty() && (has_unrec || unrec_param || completable(&cand, pool)) { return (Some(cand), innermost_kept); }
    }
    (None, false)
}
