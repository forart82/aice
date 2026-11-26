use std::path::Path;

use aice_lang_registry::LanguageId;

use crate::r5::checks::collect_r5_error_spans;
use crate::r5::snippet_container::{PrefixContainer, classify_prefix_container_with_openers};
use crate::r5::snippet_cst::line_delim_detail;
use crate::r5::snippet_ctx_scan::prefix_unclosed_openers;
use crate::r5::snippet_rs_angle::{has_depth0_single_colon, strip_rust_comments_strings};
pub(crate) use crate::r5::snippet_semi_op::is_semi_terminated_broken_opener;
use crate::r5::snippet_type_body::{TB_ENUM, TB_IFACE, TB_PARAM};
use crate::ts_pool::ParserPool;

pub(crate) fn is_rust_attr_opener(lang: LanguageId, joined: &str, byte: usize) -> bool {
    if lang != LanguageId::Rust { return false; }
    let b = joined.as_bytes();
    let mut k = byte.min(b.len());
    while k > 0 && (b[k - 1].is_ascii_whitespace() || b[k - 1] == b'!') { k -= 1; }
    k > 0 && b[k - 1] == b'#'
}
fn line_starts_rust_attr_exit(l: &str) -> bool {
    matches!(
        l.trim_start().split(|c: char| !c.is_ascii_alphanumeric() && c != '_').next(),
        Some("let" | "fn" | "struct" | "enum" | "impl" | "trait" | "mod" | "const" | "static" | "type" | "pub")
    )
}
fn collect_rust_attr_opener_mask(lang: LanguageId, joined: &str, openers: &[(u8, usize, usize)]) -> Vec<bool> {
    let mut mask = vec![false; openers.len()];
    if lang != LanguageId::Rust { return mask; }
    let mut skip_attr_until_item: Option<(usize, usize)> = None;
    for (idx, &(d, ln, byte)) in openers.iter().enumerate() {
        if let Some((attr_ln, attr_byte)) = skip_attr_until_item {
            if d == b'{' { skip_attr_until_item = None; } else {
                let clean = strip_rust_comments_strings(joined.get(attr_byte..byte).unwrap_or(""));
                if ln > attr_ln && (clean.contains(';') || clean.lines().skip(1).any(line_starts_rust_attr_exit)) {
                    skip_attr_until_item = None;
                } else { mask[idx] = true; continue; }
            }
        }
        if d == b'[' && is_rust_attr_opener(lang, joined, byte) { skip_attr_until_item = Some((ln, byte)); mask[idx] = true; }
    }
    mask
}
pub(crate) fn is_rust_attr_group(
    lang: LanguageId, joined: &str, openers: &[(u8, usize, usize)], ln: usize,
) -> bool {
    collect_rust_attr_opener_mask(lang, joined, openers)
        .into_iter().zip(openers.iter()).any(|(in_attr, &(_, op_ln, _))| in_attr && op_ln == ln)
}
pub(crate) fn rust_unclosed_attr_tail<'a>(
    prefix_lines: &'a [&'a str], joined: &str, openers: &[(u8, usize, usize)],
) -> Option<Vec<&'a str>> {
    let (pos, &(_, ln, _)) = openers.iter().enumerate().rev()
        .find(|&(_, &(d, _, byte))| d == b'[' && is_rust_attr_opener(LanguageId::Rust, joined, byte))?;
    (!openers[pos + 1..].iter().any(|&(d, _, _)| d == b'{')).then(|| prefix_lines[ln..].to_vec())
}

pub(crate) fn is_rust_type_hdr_clean(clean: &str) -> bool {
    let b = clean.as_bytes();
    let (mut i, mut paren_d, mut brack_d) = (0usize, 0usize, 0usize);
    while i < b.len() {
        let c = b[i];
        if c.is_ascii_whitespace() { i += 1; continue; }
        if c == b'[' { brack_d += 1; i += 1; continue; }
        if c == b']' { brack_d = brack_d.saturating_sub(1); i += 1; continue; }
        if brack_d > 0 { i += 1; continue; }
        if c == b'(' {
            if paren_d == 0 { return false; }
            paren_d += 1; i += 1; continue;
        }
        if c == b')' { paren_d = paren_d.saturating_sub(1); i += 1; continue; }
        if paren_d > 0 { i += 1; continue; }
        if (c == b':' && b.get(i + 1) != Some(&b':')) || b[i..].starts_with(b"->") {
            return false;
        }
        if c.is_ascii_alphabetic() || c == b'_' {
            let start = i;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') { i += 1; }
            let kw = &clean[start..i];
            if matches!(kw, "struct" | "enum" | "union" | "trait" | "impl") { return true; }
            if matches!(kw, "fn" | "let" | "const" | "static" | "type" | "mod") { return false; }
            if kw == "pub" {
                let mut j = i;
                while j < b.len() && b[j].is_ascii_whitespace() { j += 1; }
                if b.get(j) == Some(&b'(') { paren_d += 1; i = j + 1; }
            }
            continue;
        }
        i += 1;
    }
    false
}

pub(crate) fn rust_attr_tail_start(
    prefix: &str, open_pos: usize, last_op_pos: usize, sep_after: usize,
    is_enum: bool, last_in_attr: bool, c_unm: &[u8],
) -> usize {
    let mut tail_start = crate::r5::snippet_rs_tail::rust_item_line_start_in(prefix, open_pos + 1, last_op_pos)
        .map_or(open_pos + 1 + sep_after, |ls| ls.max(open_pos + 1 + sep_after));
    if last_in_attr && c_unm.contains(&b']')
        && let Some(hr) = prefix[open_pos + 1..last_op_pos].rfind('#')
    {
        let attr_ls = prefix[..open_pos + 1 + hr].rfind('\n').map_or(0, |p| p + 1);
        if attr_ls > open_pos + 1 {
            let (_, _, has_semi, has_eq) = crate::r5::snippet_rs_tail::rust_scan_container_tail_flags(
                &prefix[open_pos + 1..attr_ls],
                is_enum,
            );
            if has_semi || has_eq { tail_start = attr_ls; }
        }
    }
    tail_start
}

pub(crate) fn filter_ctx_openers(lang: LanguageId, joined: &str, openers: &[(u8, usize, usize)]) -> Vec<(u8, usize, usize)> {
    let lines: Vec<&str> = joined.lines().collect();
    collect_rust_attr_opener_mask(lang, joined, openers)
        .into_iter()
        .zip(openers.iter().copied())
        .filter(|&(in_attr, (d, ln, byte))| {
            !in_attr && !lines.get(ln).is_some_and(|&lt| is_semi_terminated_broken_opener(lang, joined, d, byte, lt))
        })
        .map(|(_, op)| op)
        .collect()
}
pub(crate) fn ctx_matches_prefix(lang: LanguageId, ctx: &[String], prefix_ctx: PrefixContainer, path: &Path, pool: &mut ParserPool) -> bool {
    let refs: Vec<&str> = ctx.iter().map(String::as_str).collect();
    let joined = ctx.join("\n");
    let openers = prefix_unclosed_openers(lang, &refs, path, pool);
    let last_c = classify_prefix_container_with_openers(lang, &joined, &openers);
    if (matches!(prefix_ctx, PrefixContainer::TypeBody(t) if t != TB_PARAM)
        || matches!(prefix_ctx, PrefixContainer::ValueBrace | PrefixContainer::StructLit))
        && last_c == PrefixContainer::StmtBlock
    {
        return false;
    }
    if (prefix_ctx == PrefixContainer::TypeBody(TB_IFACE) && last_c == PrefixContainer::ValueBrace)
        || (prefix_ctx == PrefixContainer::ValueBrace && last_c == PrefixContainer::TypeBody(TB_IFACE))
    {
        return false;
    }
    if matches!(prefix_ctx, PrefixContainer::TypeBody(t) if t != TB_PARAM)
        && !(matches!(lang, LanguageId::TypeScript | LanguageId::Tsx)
            && prefix_ctx == PrefixContainer::TypeBody(TB_IFACE)
            && last_c == PrefixContainer::TypeBody(TB_IFACE))
        && !openers.is_empty()
        && classify_prefix_container_with_openers(lang, &joined, &openers[..1])
            == PrefixContainer::StmtBlock
    {
        return false;
    }
    true
}

pub(crate) fn is_pure_rust_comment(s: &str) -> bool {
    let (b, mut i) = (s.as_bytes(), 0usize);
    while i < b.len() {
        if b[i..].starts_with(b"//") { while i < b.len() && b[i] != b'\n' { i += 1; } }
        else if b[i..].starts_with(b"/*") {
            let (Some(after), _) = crate::r5::snippet_blk::find_blk_comment_close(LanguageId::Rust, b, i + 2, 1) else { return false; };
            i = after;
        } else if let Some(ch) = s[i..].chars().next() && ch.is_whitespace() { i += ch.len_utf8(); }
        else { return false; }
    }
    true
}
fn rust_attr_tail_open_lines(attr_tail: &[&str], is_enum: bool) -> Option<(String, String)> {
    let tail_clean = strip_rust_comments_strings(&attr_tail.join("\n"));
    if tail_clean.contains([';', '{'])
        || tail_clean.lines().skip(1).any(|l| line_starts_rust_attr_exit(l) || has_depth0_single_colon(l))
    {
        return None;
    }
    let open_bracks = tail_clean.bytes().fold(0isize, |d, c| match c { b'[' => d + 1, b']' => (d - 1).max(0), _ => d });
    let lines: Vec<&str> = tail_clean.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    if open_bracks == 0 || !lines.first().is_some_and(|l| l.starts_with('#')) {
        return None;
    }
    if is_enum && lines.len() >= 2 && !lines[0].ends_with(['[', '(', ',', '=']) && lines.last().is_some_and(|l| l.ends_with(',')) {
        return None;
    }
    Some((lines[0].to_string(), lines.last()?.to_string()))
}
pub(crate) fn rust_attr_tail_is_open(attr_tail: &[&str], is_enum: bool) -> bool {
    rust_attr_tail_open_lines(attr_tail, is_enum).is_some()
}
pub(crate) fn rust_attr_tail_expects_arg(attr_tail: &[&str]) -> bool {
    rust_attr_tail_open_lines(attr_tail, false)
        .is_some_and(|(first, last)| first.ends_with(['[', '(', ',']) && last.ends_with(['(', ',']))
}

pub(crate) fn is_valid_rust_attr_arg_insert(attr_tail: &[&str], cand_norm: &[&str], path: &Path, pool: &mut ParserPool) -> bool {
    if !rust_attr_tail_expects_arg(attr_tail) { return false; }
    let tail_joined = attr_tail.join("\n");
    let cand_joined = cand_norm.join("\n");
    let cand_clean = strip_rust_comments_strings(&cand_joined);
    let cand_tr = cand_clean.trim();
    let cb = cand_clean.as_bytes();
    let has_single_colon = cb.iter().enumerate().any(|(i, &c)| c == b':' && cb.get(i + 1) != Some(&b':') && (i == 0 || cb[i - 1] != b':'));
    if cand_tr.is_empty() || crate::r5::snippet_lit::open_quote_start(LanguageId::Rust, &cand_joined).is_some()
        || cand_tr.bytes().any(|c| matches!(c, b';' | b'{' | b'}' | b'[' | b']' | b'+' | b'-' | b'*' | b'/' | b'%' | b'&' | b'|' | b'^' | b'<' | b'>' | b'?' | b'#' | b'!'))
        || has_single_colon || cand_tr.contains("==") || cand_tr.contains("=>")
        || cand_tr.starts_with('=') || cand_tr.ends_with('=')
        || cand_clean.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').any(|w| {
            matches!(w, "let" | "fn" | "struct" | "enum" | "impl" | "trait" | "mod" | "const" | "static" | "type" | "pub" | "use" | "return" | "if" | "else" | "for" | "while" | "loop" | "match" | "where")
        })
    {
        return false;
    }
    let (stk, unm) = line_delim_detail(LanguageId::Rust, &format!("{tail_joined}\n{cand_joined}"), path, pool);
    if !unm.is_empty() || stk.first() != Some(&b'[') || stk.contains(&b'{') { return false; }
    let closers: String = stk.iter().rev().map(|&c| match c { b'(' => ')', b'[' => ']', _ => '}' }).collect();
    let suf = if attr_tail[0].trim_start().starts_with("#!") { "" } else { "\nfn _aice_() {}" };
    collect_r5_error_spans(LanguageId::Rust, &format!("{tail_joined}\n{cand_joined}\n{closers}{suf}"), path, pool)
        .is_ok_and(|e| e.is_empty())
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn rust_unclosed_attr_no_rbrack_ok(
    lang: LanguageId, prefix_lines: &[&str], joined: &str, openers: &[(u8, usize, usize)],
    cand_norm: &[&str], cand_unm: &[u8], path: &Path, pool: &mut ParserPool,
) -> Option<bool> {
    if lang != LanguageId::Rust || cand_unm.contains(&b']') { return None; }
    if cand_unm.contains(&b'}')
        && crate::r5::snippet_semi_op::is_line_in_rust_unclosed_attr(lang, joined, openers, prefix_lines.len().saturating_sub(1))
    {
        return Some(false);
    }
    if !cand_unm.contains(&b'}') && let Some(attr_tail) = rust_unclosed_attr_tail(prefix_lines, joined, openers) {
        if crate::r5::snippet_lit::open_quote_start(LanguageId::Rust, joined).is_some() { return Some(false); }
        if is_pure_rust_comment(&cand_norm.join("\n"))
            || is_valid_rust_attr_arg_insert(&attr_tail, cand_norm, path, pool)
        {
            return Some(true);
        }
        let is_enum = classify_prefix_container_with_openers(lang, joined, openers) == PrefixContainer::TypeBody(TB_ENUM);
        if rust_attr_tail_is_open(&attr_tail, is_enum) { return Some(false); }
    }
    None
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn rust_attr_no_close_verdict(
    full_hdr: &str, base_layers: usize, has_unclosed_quote: bool, tail_in_container: &str,
    cand_norm: &[&str], cand_joined: &str, suffix_lines: &[&str], path: &Path, pool: &mut ParserPool,
) -> Option<bool> {
    if has_unclosed_quote { return Some(false); }
    if is_pure_rust_comment(cand_joined) { return Some(true); }
    let is_enum = base_layers == 1
        && strip_rust_comments_strings(full_hdr).split(|c: char| !c.is_ascii_alphanumeric() && c != '_').any(|w| w == "enum");
    let tail_lines: Vec<&str> = tail_in_container.lines().collect();
    let mut any_open = false;
    for (pos, l) in tail_lines.iter().enumerate().rev() {
        if strip_rust_comments_strings(l).trim_start().starts_with('#') {
            let attr_tail = &tail_lines[pos..];
            if !any_open && is_valid_rust_attr_arg_insert(attr_tail, cand_norm, path, pool) { return Some(true); }
            if rust_attr_tail_is_open(attr_tail, is_enum) { return Some(false); }
            any_open = true;
        }
    }
    let suf_has_code = suffix_lines.iter().any(|l| {
        let t = strip_rust_comments_strings(l);
        !t.trim().is_empty() && t.trim() != "}"
    });
    if suf_has_code {
        let sr = suffix_lines.iter()
            .flat_map(|l| strip_rust_comments_strings(l).bytes().filter(|&c| c == b'}').collect::<Vec<_>>())
            .count();
        let extra_r = "\n}".repeat(base_layers.saturating_sub(sr));
        let probe = format!("{full_hdr}\n{cand_joined}\n{}{extra_r}", suffix_lines.join("\n"));
        return Some(collect_r5_error_spans(LanguageId::Rust, &probe, path, pool).is_ok_and(|e| e.is_empty()));
    }
    None
}
