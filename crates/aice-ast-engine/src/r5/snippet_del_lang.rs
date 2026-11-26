use std::path::Path;
use aice_lang_registry::LanguageId;
use crate::r5::checks::{ErrorSpan, collect_r5_error_spans};
use crate::r5::snippet_blk::find_blk_comment_close;
use crate::r5::snippet_ctx_bash::{bash_compound_closers, bash_unclosed_opener_lines};
use crate::r5::snippet_del_suf::{step_nl_check, step_nl_slice};
use crate::r5::snippet_lit::{JsLexState, StepQuote};
use crate::ts_pool::ParserPool;

pub(crate) fn join_slices(a: &[&str], b: &[&str], c: &[&str]) -> String { [a, b, c].concat().join("\n") }

pub(crate) fn bash_imbalance(src: &str) -> usize {
    let b = src.as_bytes();
    let (mut i, mut js, mut stk, mut unm) = (0usize, JsLexState::new(), Vec::new(), 0usize);
    while i < b.len() {
        if b[i] == b'\n' { js.on_newline(LanguageId::Bash); i += 1; continue; }
        if js.step_quote(LanguageId::Bash, b, &mut i) != StepQuote::NotInQuote || js.open_quote(LanguageId::Bash, b, &mut i) { continue; }
        if crate::r5::snippet_lex::is_hash_comment_at(b, i) { while i < b.len() && b[i] != b'\n' { i += 1; } continue; }
        if b[i].is_ascii_alphabetic() || b[i] == b'_' {
            let start = i;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') { i += 1; }
            let prev_ok = start == 0 || matches!(b[start - 1], b' ' | b'\t' | b'\n' | b'\r' | b';' | b'(' | b'{');
            let cl_ok = i == b.len() || matches!(b[i], b' ' | b'\t' | b'\n' | b'\r' | b';' | b')' | b'}');
            let op_ok = i == b.len() || matches!(b[i], b' ' | b'\t' | b'\n' | b'\r' | b';' | b'(');
            if prev_ok && (cl_ok || op_ok) {
                match &b[start..i] {
                    b"if" if op_ok => stk.push("fi"),
                    b"for" | b"while" | b"until" | b"select" if op_ok => stk.push("done"),
                    b"case" if op_ok => stk.push("esac"),
                    b"fi" | b"done" | b"esac" if cl_ok => {
                        let w = std::str::from_utf8(&b[start..i]).unwrap_or("");
                        if let Some(p) = stk.iter().rposition(|&k| k == w) { unm += stk.len() - 1 - p; stk.truncate(p); } else { unm += 1; }
                    }
                    _ => {}
                }
            }
            continue;
        }
        i += 1;
    }
    stk.len() + unm
}

pub(crate) fn bash_pfx_unquoted(pfx: &[&str]) -> Option<String> {
    let mut s = pfx.join("\n");
    let (mut off, mut changed) = (0usize, false);
    while let Some(rel) = crate::r5::snippet_lit::open_quote_start(LanguageId::Bash, &s[off..]) {
        let q = off + rel;
        if !s.as_bytes()[q].is_ascii() { break; }
        s.replace_range(q..=q, " ");
        off = q + 1;
        changed = true;
    }
    changed.then_some(s)
}

pub(crate) fn bash_edit_increases_imbalance(pfx: &[&str], raw_base: &[&str], raw_cand: &[&str], suf: &[&str]) -> bool {
    let unq = bash_pfx_unquoted(pfx);
    let one = unq.as_deref().map(|s| [s]);
    let p = one.as_ref().map_or(pfx, |a| &a[..]);
    bash_imbalance(&join_slices(p, raw_cand, suf)) > bash_imbalance(&join_slices(p, raw_base, suf))
}

pub(crate) fn bash_del_increases_imbalance(pfx: &[&str], raw_base: &[&str], suf: &[&str]) -> bool {
    bash_edit_increases_imbalance(pfx, raw_base, &[], suf)
}

pub(crate) fn bash_suf_close_end(pfx_s: &[&str], raw_base: &[&str], suf: &[&str], min_end: usize) -> Option<usize> {
    let head_lines = pfx_s.len() + raw_base.len();
    if suf.is_empty() || head_lines == 0 { return None; }
    let sb = head_lines - 1 + min_end;
    let src = join_slices(pfx_s, raw_base, suf);
    let b = src.as_bytes();
    let (mut i, mut line_idx, mut js, mut stk) = (0usize, 0usize, JsLexState::new(), Vec::new());
    while i < b.len() {
        let prev = i;
        if b[i] == b'\n' {
            if let Some(end) = step_nl_check(&mut line_idx, Some(sb), stk.is_empty()) { return Some(end + min_end); }
            js.on_newline(LanguageId::Bash); i += 1; continue;
        }
        if js.step_quote(LanguageId::Bash, b, &mut i) != StepQuote::NotInQuote || js.open_quote(LanguageId::Bash, b, &mut i) {
            if let Some(end) = step_nl_slice(&b[prev..i], &mut line_idx, Some(sb), stk.is_empty()) { return Some(end + min_end); }
            continue;
        }
        if crate::r5::snippet_lex::is_hash_comment_at(b, i) { while i < b.len() && b[i] != b'\n' { i += 1; } continue; }
        if b[i].is_ascii_alphabetic() || b[i] == b'_' {
            let start = i;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') { i += 1; }
            let prev_ok = start == 0 || matches!(b[start - 1], b' ' | b'\t' | b'\n' | b'\r' | b';' | b'(' | b'{');
            let cl_ok = i == b.len() || matches!(b[i], b' ' | b'\t' | b'\n' | b'\r' | b';' | b')' | b'}');
            let op_ok = i == b.len() || matches!(b[i], b' ' | b'\t' | b'\n' | b'\r' | b';' | b'(');
            if prev_ok && (cl_ok || op_ok) {
                match &b[start..i] {
                    b"if" if op_ok => stk.push("fi"),
                    b"for" | b"while" | b"until" | b"select" if op_ok => stk.push("done"),
                    b"case" if op_ok => stk.push("esac"),
                    b"fi" | b"done" | b"esac" if cl_ok => {
                        let want = std::str::from_utf8(&b[start..i]).unwrap_or("");
                        if let Some(p) = stk.iter().rposition(|&k| k == want) { stk.truncate(p); }
                    }
                    _ => {}
                }
            }
            continue;
        }
        i += 1;
    }
    (stk.is_empty() && suf.len() >= min_end).then_some(suf.len())
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn bash_compound_hdr_edit_err(
    lang: LanguageId, raw_base: &[&str], raw_cand: &[&str], suf: &[&str],
    base_spans: &[ErrorSpan], base_edit_end: usize, path: &Path, pool: &mut ParserPool,
) -> Option<bool> {
    if lang != LanguageId::Bash || raw_base.is_empty() || raw_cand.is_empty() { return None; }
    let rb = raw_base.join("\n");
    if bash_compound_closers(lang, &rb).is_empty() { return None; }
    let first_suf_err = base_spans.iter()
        .filter(|b| b.line > base_edit_end && !b.message.starts_with("Missing syntax element:"))
        .map(|b| b.line - base_edit_end - 1).min().unwrap_or(suf.len()).min(suf.len());
    let end = if first_suf_err == 0 { None } else { bash_suf_close_end(raw_base, &[], &suf[..first_suf_err], 1) }?;
    let base_ok = collect_r5_error_spans(lang, &join_slices(raw_base, &suf[..end], &[]), path, pool).is_ok_and(|e| e.is_empty());
    let cand_ok = collect_r5_error_spans(lang, &join_slices(raw_cand, &suf[..end], &[]), path, pool).is_ok_and(|e| e.is_empty());
    (base_ok && !cand_ok).then_some(true)
}

pub(crate) fn suf_first_unmatched_rbrace_followed_by_cont(lang: LanguageId, suf: &str) -> bool {
    let clean = crate::r5::snippet_synth::strip_comments_strings(lang, suf, false);
    let (mut depth, mut pos) = (0usize, None);
    for (i, &c) in clean.as_bytes().iter().enumerate() {
        match c { b'{' => depth += 1, b'}' => if depth > 0 { depth -= 1; } else { pos = Some(i); break; }, _ => {} }
    }
    let Some(p) = pos else { return false; };
    matches!(clean[p + 1..].trim_start().split(|c: char| !c.is_ascii_alphanumeric() && c != '_').next().unwrap_or(""),
        "else" | "elif" | "elsif" | "catch" | "finally" | "while")
}

pub(crate) fn css_del_increases_imbalance(pfx: &[&str], raw_base: &[&str], suf: &[&str]) -> bool {
    let imb = |s: &str| -> usize {
        let (b, mut i, mut d, mut u) = (s.as_bytes(), 0usize, 0usize, 0usize);
        while i < b.len() {
            if matches!(b[i], b'"' | b'\'') {
                let q = b[i]; i += 1;
                while i < b.len() {
                    if b[i] == b'\\' { i += 2; continue; }
                    if b[i] == q { i += 1; break; }
                    i += 1;
                }
                continue;
            }
            if b[i..].starts_with(b"/*") { let (Some(a), _) = find_blk_comment_close(LanguageId::Css, b, i + 2, 1) else { break; }; i = a; continue; }
            if b[i] == b'{' { d += 1; } else if b[i] == b'}' { if d > 0 { d -= 1; } else { u += 1; } }
            i += 1;
        }
        d + u
    };
    imb(&join_slices(pfx, &[], suf)) > imb(&join_slices(pfx, raw_base, suf))
}

fn twig_endverbatim_end(src: &str, start: usize) -> Option<usize> {
    let b = src.as_bytes();
    let mut p = start + 2 + usize::from(b.get(start + 2) == Some(&b'-'));
    while p < b.len() && b[p].is_ascii_whitespace() { p += 1; }
    if !b[p..].starts_with(b"endverbatim") { return None; } else { p += 11; }
    if p < b.len() && !b[p].is_ascii_whitespace() && !b[p..].starts_with(b"-%}") && !b[p..].starts_with(b"%}") { return None; }
    while p < b.len() && b[p].is_ascii_whitespace() { p += 1; }
    if b[p..].starts_with(b"-%}") { Some(p + 3) } else if b[p..].starts_with(b"%}") { Some(p + 2) } else { None }
}
type TwigTag = (usize, String, Option<String>, bool);

fn scan_twig_blocks_core(src: &str, stop_base: Option<usize>) -> (Vec<TwigTag>, usize, Option<usize>) {
    let (b, mut i, mut ln, mut stk, mut unexp, mut in_verb) = (src.as_bytes(), 0usize, 0usize, Vec::<TwigTag>::new(), 0usize, false);
    while i < b.len() {
        if in_verb {
            if b[i..].starts_with(b"{%") && let Some(end) = twig_endverbatim_end(src, i) {
                ln += b[i..end].iter().filter(|&&c| c == b'\n').count();
                if let Some(p) = stk.iter().rposition(|(_, t, _, _)| t == "verbatim") { stk.truncate(p); }
                in_verb = false; i = end; continue;
            }
            if b[i] == b'\n' { ln += 1; } i += 1; continue;
        }
        if b[i] == b'\n' {
            if let Some(end) = step_nl_check(&mut ln, stop_base, stk.is_empty()) { return (stk, unexp, Some(end)); }
            i += 1; continue;
        }
        if b[i] != b'{' || i + 1 >= b.len() { i += 1; continue; }
        if b[i + 1] == b'#' {
            if let Some(r) = src[i + 2..].find("#}") {
                if let Some(end) = step_nl_slice(&b[i + 2..i + 2 + r], &mut ln, stop_base, stk.is_empty()) { return (stk, unexp, Some(end)); }
                i += 2 + r + 2; continue;
            }
            if let Some(end) = step_nl_slice(&b[i + 2..], &mut ln, stop_base, stk.is_empty()) { return (stk, unexp, Some(end)); }
            break;
        }
        if !matches!(b[i + 1], b'{' | b'%') { i += 1; continue; }
        let (close, tag_ln, mut j, mut q, mut esc) = (if b[i + 1] == b'{' { b'}' } else { b'%' }, ln, i + 2, 0u8, false);
        let mut inner_end = None;
        while j < b.len() {
            if q != 0 {
                if esc { esc = false; } else if b[j] == b'\\' { esc = true; } else if b[j] == q { q = 0; } else if b[j] == b'\n' { break; }
            } else if b[j] == b'\n' {
                if let Some(end) = step_nl_check(&mut ln, stop_base, stk.is_empty()) { return (stk, unexp, Some(end)); }
            } else if matches!(b[j], b'"' | b'\'') { q = b[j]; }
            else if b[j] == close && b.get(j + 1) == Some(&b'}') { inner_end = Some(j); break; }
            else if b[j] == b'{' && b.get(j + 1).is_some_and(|&c| matches!(c, b'{' | b'%' | b'#')) { break; }
            j += 1;
        }
        let Some(ie) = inner_end else { i = j; continue; };
        if close == b'%' {
            let raw = &src[i + 2..ie];
            let inner = raw.strip_prefix('-').unwrap_or(raw).strip_suffix('-').unwrap_or(raw.strip_prefix('-').unwrap_or(raw)).trim();
            let mut parts = inner.split_whitespace();
            let kw_raw = parts.next().unwrap_or("");
            let (kw, rest) = (kw_raw.to_ascii_lowercase(), inner[kw_raw.len()..].trim());
            match kw.as_str() {
                "verbatim" => { stk.push((tag_ln, kw, None, false)); in_verb = true; }
                "if" | "for" | "apply" | "filter" | "embed" | "spaceless" | "sandbox"
                | "autoescape" | "autostrict" | "with" | "cache" => stk.push((tag_ln, kw, None, false)),
                "macro" => {
                    let m = rest.split('(').next().unwrap_or("").trim();
                    stk.push((tag_ln, kw, (!m.is_empty()).then(|| m.to_string()), false));
                }
                "block" => if let Some(name) = parts.next() && parts.next().is_none() { stk.push((tag_ln, kw, Some(name.to_string()), false)); },
                "set" if !rest.is_empty() && !rest.contains('=') => stk.push((tag_ln, kw, None, false)),
                "else" => if let Some((_, k, _, se)) = stk.last_mut() && matches!(k.as_str(), "if" | "for") && !*se {
                    *se = true; if !rest.is_empty() { unexp += 1; }
                } else { unexp += 1; }
                "elseif" => if !stk.last().is_some_and(|(_, k, _, se)| k == "if" && !*se) || rest.is_empty() { unexp += 1; }
                k if k.starts_with("end") && k.len() > 3 => {
                    if let Some(p) = stk.iter().rposition(|(_, t, _, _)| t == &k[3..]) {
                        unexp += stk.len() - 1 - p;
                        let open_name = stk[p].2.take();
                        stk.truncate(p);
                        if !rest.is_empty() && matches!(k, "endblock" | "endmacro").then(|| open_name.as_deref() != Some(rest)).unwrap_or(true) { unexp += 1; }
                    } else { unexp += 1; }
                }
                _ => {}
            }
        }
        i = ie + 2;
    }
    (stk, unexp, None)
}
pub(crate) fn scan_twig_blocks(src: &str) -> (Vec<TwigTag>, usize) {
    let (stk, unexp, _) = scan_twig_blocks_core(src, None); (stk, unexp)
}
pub(crate) fn twig_suf_close_end(pfx_s: &[&str], raw_base: &[&str], suf: &[&str]) -> usize {
    let head_lines = pfx_s.len() + raw_base.len();
    if suf.is_empty() || head_lines == 0 { return 0; }
    scan_twig_blocks_core(&join_slices(pfx_s, raw_base, suf), Some(head_lines - 1)).2.unwrap_or(suf.len())
}

pub(crate) fn twig_del_increases_imbalance(pfx: &[&str], raw_base: &[&str], suf: &[&str]) -> bool {
    let (bs, bu) = scan_twig_blocks(&join_slices(pfx, raw_base, suf));
    let (cs, cu) = scan_twig_blocks(&join_slices(pfx, &[], suf));
    cs.len() + cu > bs.len() + bu || cu > bu
}
pub(crate) fn twig_edit_increases_imbalance(pfx: &[&str], raw_base: &[&str], raw_cand: &[&str], suf: &[&str]) -> bool {
    let (bs, bu) = scan_twig_blocks(&join_slices(pfx, raw_base, suf));
    let (cs, cu) = scan_twig_blocks(&join_slices(pfx, raw_cand, suf));
    cs.len() + cu > bs.len() + bu || cu > bu
}

pub(crate) use crate::r5::snippet_del_xml::{
    html_del_increases_imbalance, html_edit_increases_imbalance, html_xml_eof_close_ok, scan_html_open_tags,
};

pub(crate) fn bash_opener_lines(pfx: &[&str]) -> Vec<usize> {
    let src = bash_pfx_unquoted(pfx).unwrap_or_else(|| pfx.join("\n"));
    bash_unclosed_opener_lines(LanguageId::Bash, &src).into_iter().map(|(l, _)| l).collect()
}

pub(crate) fn toml_arr_boundary_ok(pfx: &[&str], op_ln: usize, raw_cand: &[&str], suf: &[&str]) -> bool {
    fn code_t(l: &str) -> Option<&str> { let t = crate::r5::snippet_semi_op::strip_code_trailing_comment(LanguageId::Toml, l).trim(); (!t.is_empty()).then_some(t) }
    let Some(prev_t) = pfx[op_ln..].iter().rev().find_map(|&l| code_t(l)) else { return false; };
    (prev_t.ends_with(',') || prev_t.ends_with('['))
        && !(suf.iter().find_map(|&l| code_t(l)).is_some_and(|nt| !nt.starts_with(']'))
            && raw_cand.iter().rev().find_map(|&l| code_t(l)).is_some_and(|ct| !ct.ends_with(',')))
}
