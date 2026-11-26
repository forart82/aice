use std::path::Path;
use aice_lang_registry::LanguageId;
use crate::r5::snippet_blk::find_blk_comment_close;
use crate::r5::snippet_container::{PrefixContainer, classify_prefix_container_with_openers};
use crate::r5::snippet_cst::{collect_masked_ranges, cst_defect_profile, line_delim_detail, strip_trailing_comment};
pub(crate) use crate::r5::snippet_ctx_bash::{append_bash_openers, bash_compound_closers};
use crate::r5::snippet_hdr::{ends_with_ts_generic_params, starts_with_js_cont};
use crate::r5::snippet_lex::{has_hash_comments, has_slash_comments, is_code_lang, is_hash_comment_at};
use crate::r5::snippet_lit::{JsLexState, StepQuote};
use crate::r5::snippet_rs_attr::is_semi_terminated_broken_opener;
use crate::r5::snippet_synth::strip_comments_strings;
use crate::r5::snippet_type_body::TB_IFACE;
use crate::ts_pool::ParserPool;
pub(crate) fn prefix_unclosed_openers(lang: LanguageId, prefix_lines: &[&str], path: &Path, pool: &mut ParserPool) -> Vec<(u8, usize, usize)> {
    let joined = prefix_lines.join("\n");
    prefix_unclosed_openers_with_masked(lang, &joined, &collect_masked_ranges(lang, &joined, path, pool))
}

pub(crate) fn prefix_unclosed_openers_with_masked(lang: LanguageId, joined: &str, masked: &[(usize, usize)]) -> Vec<(u8, usize, usize)> {
    let (b, slash, hash) = (joined.as_bytes(), has_slash_comments(lang), has_hash_comments(lang));
    let (mut m_idx, mut i, mut line_idx) = (0usize, 0usize, 0usize);
    let (mut stack, mut js) = (Vec::new(), JsLexState::new());
    while i < b.len() {
        let prev_i = i;
        if js.step_masked(lang, b, &mut m_idx, masked, &mut i) { line_idx += b[prev_i..i].iter().filter(|&&c| c == b'\n').count(); continue; }
        if b[i] == b'\n' { js.on_newline(lang); line_idx += 1; i += 1; continue; }
        match js.step_quote(lang, b, &mut i) {
            StepQuote::Consumed => { line_idx += b[prev_i..i].iter().filter(|&&c| c == b'\n').count(); continue; }
            StepQuote::EnteredInterp => { stack.push((b'{', line_idx, i.saturating_sub(1))); continue; }
            StepQuote::NotInQuote => {}
        }
        if let Some((end, _)) = js.match_special(lang, b, i) { line_idx += b[i..end].iter().filter(|&&c| c == b'\n').count(); i = end; continue; }
        if js.open_quote(lang, b, &mut i) { continue; }
        if (slash && lang != LanguageId::Css && b[i..].starts_with(b"//")) || (hash && is_hash_comment_at(b, i)) { while i < b.len() && b[i] != b'\n' { i += 1; } continue; }
        if slash && b[i..].starts_with(b"/*") {
            let (Some(after), _) = find_blk_comment_close(lang, b, i + 2, 1) else { break; };
            line_idx += b[i..after].iter().filter(|&&c| c == b'\n').count(); i = after; continue;
        }
        if matches!(b[i], b'(' | b'[' | b'{') { stack.push((b[i], line_idx, i)); }
        else if matches!(b[i], b')' | b']' | b'}') {
            let want = match b[i] { b')' => b'(', b']' => b'[', _ => b'{' };
            if let Some(pos) = stack.iter().rposition(|&(c, _, _)| c == want) { stack.remove(pos); }
        }
        js.step_byte(lang, b, &mut i); line_idx += b[prev_i..i].iter().filter(|&&c| c == b'\n').count();
    }
    stack
}

pub(crate) fn collect_opener_hdr<'a>(lang: LanguageId, prefix_lines: &[&'a str], op_line: usize, min_line: usize, path: &Path, pool: &mut ParserPool) -> Vec<&'a str> {
    let low = min_line.max(op_line.saturating_sub(15));
    let mut start = op_line;
    while start > low {
        let cur = prefix_lines[start..=op_line].join("\n");
        let (_, cur_unm) = line_delim_detail(lang, &cur, path, pool);
        let prev = prefix_lines[start - 1].trim_end();
        let is_js_cont = prev.ends_with('}') && matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx)
            && starts_with_js_cont(strip_comments_strings(lang, &cur, false).trim_start());
        let stop_char = prev.is_empty() || (prev.ends_with([';', '}', '{']) && !is_js_cont) || (lang == LanguageId::Python && prev.ends_with(':'));
        if stop_char && cur_unm.is_empty() { break; }
        start -= 1;
    }
    prefix_lines[start..=op_line].to_vec()
}

pub(crate) fn prefix_innermost_unclosed_paren_with_openers(lang: LanguageId, prefix_lines: &[&str], last_code_idx: Option<usize>, openers: &[(u8, usize, usize)], pool: &mut ParserPool) -> Option<(usize, bool)> {
    if !is_code_lang(lang) { return None; }
    let idx = last_code_idx?;
    let last_code = strip_trailing_comment(lang, prefix_lines[idx], pool);
    match openers.last() {
        Some(&(d @ (b'(' | b'['), op_line, op_byte)) => {
            if op_line == idx && is_semi_terminated_broken_opener(lang, &prefix_lines.join("\n"), d, op_byte, prefix_lines[idx]) { return None; }
            Some((op_line + 1, last_code.ends_with(',')))
        }
        _ => None,
    }
}
fn is_async_generic_arrow_hdr(tail: &str) -> bool {
    let b = tail.trim_end().as_bytes();
    if b.last() != Some(&b'>') { return false; }
    let (mut i, mut d, mut lt) = (b.len() - 1, 0isize, None);
    loop {
        if b[i] == b'>' && !(i > 0 && matches!(b[i - 1], b'=' | b'-')) { d += 1; }
        else if b[i] == b'<' {
            d -= 1;
            if d == 0 { lt = Some(i); break; }
            if d < 0 { return false; }
        }
        if i == 0 { break; }
        i -= 1;
    }
    let Some(p) = lt else { return false; };
    tail[..p].trim_end().strip_suffix("async").is_some_and(|r| r.bytes().next_back().is_none_or(|c| !c.is_ascii_alphanumeric() && !matches!(c, b'_' | b'$')))
}
fn norm_simple_default_star(lang: LanguageId, raw: &str) -> String {
    let (b, mut i, mut js, mut out, mut prev_b) = (raw.as_bytes(), 0usize, JsLexState::new(), Vec::with_capacity(raw.len()), None::<u8>);
    while i < b.len() {
        let p = i;
        if b[i] == b'\n' { js.on_newline(lang); out.push(b'\n'); i += 1; continue; }
        if js.step_quote(lang, b, &mut i) != StepQuote::NotInQuote || js.open_quote(lang, b, &mut i) { out.extend_from_slice(&b[p..i]); prev_b = Some(b'"'); continue; }
        if let Some((end, _)) = js.match_special(lang, b, i) { out.extend_from_slice(&b[i..end]); i = end; prev_b = Some(b'"'); continue; }
        if b[i..].starts_with(b"//") { while i < b.len() && b[i] != b'\n' { i += 1; } out.extend_from_slice(&b[p..i]); continue; }
        if b[i..].starts_with(b"/*") { let (Some(a), _) = find_blk_comment_close(lang, b, i + 2, 1) else { break; }; out.extend_from_slice(&b[i..a]); i = a; continue; }
        if b[i] == b'*' && prev_b.is_none_or(|c| matches!(c, b'+' | b'-' | b'*' | b'/' | b'%' | b'=' | b'(' | b'[' | b',' | b'?' | b':' | b'&' | b'|' | b'^' | b'<' | b'>' | b'!' | b'~')) {
            out.extend_from_slice(b"_aice_"); js.step_byte(lang, b, &mut i); prev_b = Some(b'_'); continue;
        }
        js.step_byte(lang, b, &mut i);
        if !b[p..i].iter().all(u8::is_ascii_whitespace) { prev_b = Some(b[i - 1]); }
        out.extend_from_slice(&b[p..i]);
    }
    String::from_utf8(out).unwrap_or_else(|_| raw.to_string())
}
fn ts_dropped_param_item_ok(lang: LanguageId, raw: &str, path: &Path, pool: &mut ParserPool) -> bool {
    let clean = strip_comments_strings(lang, raw, false);
    let x = clean.trim();
    if x.is_empty() { return true; }
    let x_no_rest = x.strip_prefix("...").unwrap_or(x).trim_start();
    let (b, mut i, mut pd, mut bd, mut cd, mut ad, mut eq_p, mut col_p) = (x_no_rest.as_bytes(), 0usize, 0usize, 0usize, 0usize, 0usize, None, None);
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1), b'[' => bd += 1, b']' => bd = bd.saturating_sub(1), b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'<' if col_p.is_some() && eq_p.is_none() && pd == 0 && bd == 0 && cd == 0 => ad += 1,
            b'>' if ad > 0 && pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => ad -= 1,
            b':' if pd == 0 && bd == 0 && cd == 0 && ad == 0 && eq_p.is_none() && col_p.is_none() => col_p = Some(i),
            b'=' if pd == 0 && bd == 0 && cd == 0 && ad == 0 && b.get(i + 1) != Some(&b'>') && eq_p.is_none() => eq_p = Some(i),
            _ => {}
        }
        i += 1;
    }
    if pd != 0 || bd != 0 || cd != 0 || ad != 0 { return false; }
    let pat = x_no_rest[..col_p.or(eq_p).unwrap_or(x_no_rest.len())].trim();
    let pat = pat.strip_suffix('?').unwrap_or(pat).trim();
    let is_id = !pat.is_empty() && pat.bytes().next().is_some_and(|c| c.is_ascii_alphabetic() || matches!(c, b'_' | b'$')) && pat.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$'));
    let ty_paren = col_p.filter(|_| eq_p.is_none()).is_some_and(|cp| { let ty = x_no_rest[cp + 1..].trim_end_matches(',').trim(); ty.starts_with('(') && ty.ends_with(')') && !ty.contains(';') });
    let probe_item = if is_id && eq_p.is_some() { std::borrow::Cow::Owned(norm_simple_default_star(lang, raw)) }
        else if is_id && let Some(cp) = col_p && ty_paren { std::borrow::Cow::Owned(format!("{}_aice_", &x_no_rest[..=cp])) }
        else { std::borrow::Cow::Borrowed(raw) };
    let prof = cst_defect_profile(lang, &format!("function _aice_(\n{probe_item}\n) {{}}"), path, pool);
    prof.min_errs == 0 && prof.unclosed_quotes == 0
}
pub(crate) fn is_ts_arrow_dropped_params_ok(
    lang: LanguageId, chain: &[String], dropped: &[&str], has_kept_tail: bool, allow_member_param: bool, path: &Path, pool: &mut ParserPool,
) -> bool {
    let chain_j = strip_comments_strings(lang, chain.join("\n").trim_end().strip_suffix('(').unwrap_or(""), false);
    let tail = chain_j.rsplit(['{', ';']).next().unwrap_or(&chain_j).trim_end();
    let is_gen_or_fn = (ends_with_ts_generic_params(tail) && !is_async_generic_arrow_hdr(tail))
        || tail.split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).any(|w| w == "function");
    if is_gen_or_fn && has_kept_tail { return true; }
    let refs: Vec<&str> = chain.iter().map(String::as_str).collect();
    if !is_gen_or_fn && !allow_member_param && !allows_ts_arrow_fallback(lang, &refs, path, pool) { return false; }
    let raw = dropped.join("\n");
    let (b, mut i, mut js, mut pd, mut bd, mut cd, mut ad, mut in_tc, mut start) = (raw.as_bytes(), 0usize, JsLexState::new(), 0usize, 0usize, 0usize, 0usize, false, 0usize);
    while i < b.len() {
        if b[i] == b'\n' { js.on_newline(lang); i += 1; continue; }
        if js.step_quote(lang, b, &mut i) != StepQuote::NotInQuote || js.open_quote(lang, b, &mut i) { continue; }
        if let Some((end, _)) = js.match_special(lang, b, i) { i = end; continue; }
        if b[i..].starts_with(b"//") { while i < b.len() && b[i] != b'\n' { i += 1; } continue; }
        if b[i..].starts_with(b"/*") { let (Some(a), _) = find_blk_comment_close(lang, b, i + 2, 1) else { return false; }; i = a; continue; }
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1), b'[' => bd += 1, b']' => bd = bd.saturating_sub(1), b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b':' if pd == 0 && bd == 0 && cd == 0 && b.get(i + 1) != Some(&b':') && (i == 0 || b[i - 1] != b':') => if !in_tc && ad == 0 { in_tc = true; },
            b'=' if pd == 0 && bd == 0 && cd == 0 && ad == 0 && b.get(i + 1) != Some(&b'>') && b.get(i + 1) != Some(&b'=') && (i == 0 || !matches!(b[i - 1], b'=' | b'!' | b'<' | b'>')) => in_tc = false,
            b'<' if in_tc && pd == 0 && bd == 0 && cd == 0 => ad += 1,
            b'>' if ad > 0 && pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => ad -= 1,
            b',' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => { if !ts_dropped_param_item_ok(lang, &raw[start..i], path, pool) { return false; } in_tc = false; start = i + 1; }
            _ => {}
        }
        js.step_byte(lang, b, &mut i);
    }
    pd == 0 && bd == 0 && cd == 0 && ad == 0 && ts_dropped_param_item_ok(lang, &raw[start..], path, pool)
}
pub(crate) fn allows_ts_arrow_fallback(lang: LanguageId, slice: &[&str], path: &Path, pool: &mut ParserPool) -> bool {
    if !matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx) || slice.is_empty() { return false; }
    let openers = prefix_unclosed_openers(lang, slice, path, pool);
    let joined = slice.join("\n");
    allows_ts_arrow_fallback_with_openers(lang, &joined, &openers)
}
fn untyped_arrow_params_ok(inside: &str) -> bool {
    let t = inside.trim();
    if t.is_empty() { return true; }
    let (b, mut i, mut pd, mut bd, mut cd, mut start) = (t.as_bytes(), 0usize, 0usize, 0usize, 0usize, 0usize);
    let item_ok = |raw: &str| {
        let mut x = raw.trim();
        if x.is_empty() { return true; }
        x = x.strip_prefix("...").unwrap_or(x).trim_start();
        if (x.starts_with('{') && x.ends_with('}') || x.starts_with('[') && x.ends_with(']')) && !x.contains('*') { return true; }
        let lhs = x.split('=').next().unwrap_or(x).trim();
        !lhs.is_empty() && lhs.bytes().next().is_some_and(|c| c.is_ascii_alphabetic() || matches!(c, b'_' | b'$'))
            && lhs.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$'))
    };
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1, b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b',' if pd == 0 && bd == 0 && cd == 0 => { if !item_ok(&t[start..i]) { return false; } start = i + 1; }
            _ => {}
        }
        i += 1;
    }
    pd == 0 && bd == 0 && cd == 0 && item_ok(&t[start..])
}
pub(crate) fn allows_ts_arrow_fallback_with_openers(lang: LanguageId, joined: &str, openers: &[(u8, usize, usize)]) -> bool {
    if !matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx) || joined.is_empty() { return false; }
    let Some(&(b'(', _, op_byte)) = openers.last() else { return false; };
    let before = strip_comments_strings(lang, &joined[..op_byte], false);
    let bt = before.trim_end();
    let kw = bt.rsplit(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
    let pk = bt[..bt.len() - kw.len()].trim_end();
    let not_mem = !(pk.ends_with('.') && !pk.ends_with("..")) && !pk.ends_with('#');
    if ends_with_ts_generic_params(bt) { return true; }
    let inside = strip_comments_strings(lang, &joined[op_byte + 1..], false);
    let can_arrow_hdr = (not_mem && kw == "async")
        || bt.is_empty() || bt.ends_with("=>")
        || (bt.ends_with('=') && !bt[..bt.len() - 1].ends_with(['=', '!', '<', '>']))
        || ((bt.ends_with(['(', '[', ',', ':', ';', '{', '}', '?'])) && !bt.ends_with("++") && !bt.ends_with("--"))
        || (not_mem && matches!(kw, "return" | "yield" | "await" | "throw" | "default" | "else" | "case"));
    if can_arrow_hdr && untyped_arrow_params_ok(&inside) { return true; }
    let (mut pd, mut bd, mut cd) = (0usize, 0usize, 0usize);
    let (mut saw_q, mut just_q) = (false, false);
    for &c in inside.as_bytes() {
        match c {
            b'(' => { pd += 1; just_q = false; } b')' => { pd = pd.saturating_sub(1); just_q = false; }
            b'[' => { bd += 1; just_q = false; } b']' => { bd = bd.saturating_sub(1); just_q = false; }
            b'{' => { cd += 1; just_q = false; } b'}' => { cd = cd.saturating_sub(1); just_q = false; }
            b'?' if pd == 0 && bd == 0 && cd == 0 => { saw_q = true; just_q = true; }
            b':' if pd == 0 && bd == 0 && cd == 0 => { if !saw_q || just_q { return true; } saw_q = false; just_q = false; }
            b',' if pd == 0 && bd == 0 && cd == 0 => { saw_q = false; just_q = false; }
            _ if !c.is_ascii_whitespace() => { just_q = false; }
            _ => {}
        }
    }
    false
}

pub(crate) fn ctx_group_parent(lang: LanguageId, joined: &str, openers: &[(u8, usize, usize)], op_line: usize) -> PrefixContainer {
    let cut = openers.iter().position(|o| o.1 == op_line).unwrap_or(0);
    classify_prefix_container_with_openers(lang, joined, &openers[..cut])
}
pub(crate) fn anchor_drained_chain(lang: LanguageId, drain_parent: PrefixContainer, prefix_ctx: Option<PrefixContainer>, chain: &mut Vec<String>, completable: &mut dyn FnMut(&[String]) -> bool) {
    if chain.is_empty() || !matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx) { return; }
    let anchor = if drain_parent == PrefixContainer::ValueBrace { Some("const _v = {") }
        else if drain_parent == PrefixContainer::ValueBracket { Some("const _v = [") }
        else if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx) && (drain_parent == PrefixContainer::TypeBody(TB_IFACE) || prefix_ctx == Some(PrefixContainer::TypeBody(TB_IFACE))) { Some("interface _I {") }
        else if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx) && drain_parent == PrefixContainer::TypeBracket { Some("type _T = [") }
        else { None };
    if let Some(hdr) = anchor {
        let mut anchored = vec![hdr.to_string()]; anchored.extend(chain.iter().cloned());
        if completable(&anchored) { *chain = anchored; }
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn push_no_placeholder_cands(lang: LanguageId, slice: &[&str], joined: &str, closers: &str, last_code: &str, cands: &mut Vec<String>, path: &Path, pool: &mut ParserPool) {
    let has_cmt = slice.last().is_some_and(|l| strip_trailing_comment(lang, l, pool) != l.trim_end());
    let ind: String = if has_cmt { last_code.chars().take_while(|c| *c == ' ' || *c == '\t').collect() } else { String::new() };
    let nl = if has_cmt { format!("\n{ind}") } else { String::new() };
    let sp = if has_cmt { nl.as_str() } else { " " };
    let split_semi = closers.find('}').filter(|&p| p > 0);
    if !closers.is_empty() {
        cands.push(format!("{joined}\n{closers}"));
        cands.push(format!("{joined}{nl}{closers} {{}}"));
    }
    cands.push(format!("{joined}{nl}{closers}"));
    cands.push(format!("{joined}{nl}{closers};"));
    if let Some(p) = split_semi {
        cands.push(format!("{joined}{nl}{};\n{}", &closers[..p], &closers[p..]));
        if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx) && p == 1 && closers.starts_with(")}") { cands.push(format!("{joined}{nl}{} {{}}\n{}", &closers[..p], &closers[p..])); }
        if lang == LanguageId::Cpp && closers.starts_with(')') { cands.push(format!("{joined}{nl}{} {{}};\n{}", &closers[..p], &closers[p..])); }
    }
    if closers.len() >= 2 && closers.starts_with('}') { cands.push(format!("{joined}\n}};\n{}", &closers[1..])); }
    cands.push(format!("{joined}{sp}{{}}{closers}"));
    if lang == LanguageId::Python && !closers.is_empty() {
        cands.push(format!("{joined}{closers}: pass"));
        cands.push(format!("{joined}\n{ind}{closers}: pass"));
    } else if lang == LanguageId::Php && !closers.is_empty() {
        cands.push(format!("{joined}{nl}{closers};"));
    }
    if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript) && let Some(rest) = closers.strip_prefix(')') && allows_ts_arrow_fallback(lang, slice, path, pool) {
        cands.push(format!("{joined}{nl}) => {{}}{rest}"));
    }
    if lang == LanguageId::Python && last_code.ends_with(':') {
        let py_ind: String = last_code.chars().take_while(|c| *c == ' ' || *c == '\t').collect();
        cands.push(format!("{joined}\n{py_ind}    pass"));
        if !py_ind.is_empty() { cands.push(format!("{joined}\n    pass")); }
    } else if lang == LanguageId::Ruby {
        cands.push(format!("{joined}\nend"));
    }
}
