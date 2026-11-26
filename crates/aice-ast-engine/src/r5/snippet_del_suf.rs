use aice_lang_registry::LanguageId;
use crate::r5::snippet_blk::find_blk_comment_close;
use crate::r5::snippet_del_lang::join_slices;

#[inline]
pub(crate) fn step_nl_check(ln: &mut usize, stop_base: Option<usize>, stk_empty: bool) -> Option<usize> {
    if let Some(sb) = stop_base && stk_empty && *ln >= sb {
        return Some(*ln - sb);
    }
    *ln += 1;
    None
}

#[inline]
pub(crate) fn step_nl_slice(slice: &[u8], ln: &mut usize, stop_base: Option<usize>, stk_empty: bool) -> Option<usize> {
    if let Some(sb) = stop_base && stk_empty {
        for &c in slice {
            if c == b'\n' && let Some(end) = step_nl_check(ln, Some(sb), true) {
                return Some(end);
            }
        }
        return None;
    }
    *ln += slice.iter().filter(|&&c| c == b'\n').count();
    None
}

fn css_scan_core(src: &str, stop_base: Option<usize>) -> (Vec<usize>, Option<usize>) {
    let (b, mut i, mut ln, mut nl_idx, mut stk) = (src.as_bytes(), 0usize, 0usize, 0usize, Vec::new());
    while i < b.len() {
        if b[i] == b'\n' {
            if let Some(end) = step_nl_check(&mut nl_idx, stop_base, stk.is_empty()) { return (stk, Some(end)); }
            ln += 1; i += 1; continue;
        }
        if matches!(b[i], b'"' | b'\'') {
            let q = b[i]; i += 1;
            while i < b.len() {
                if b[i] == b'\\' {
                    if i + 1 < b.len() && b[i + 1] == b'\n'
                        && let Some(end) = step_nl_check(&mut nl_idx, stop_base, stk.is_empty())
                    {
                        return (stk, Some(end));
                    }
                    i += 2; continue;
                }
                if b[i] == b'\n' {
                    if let Some(end) = step_nl_check(&mut nl_idx, stop_base, stk.is_empty()) { return (stk, Some(end)); }
                    ln += 1;
                }
                if b[i] == q { i += 1; break; }
                i += 1;
            }
            continue;
        }
        if b[i..].starts_with(b"/*") {
            let (Some(a), _) = find_blk_comment_close(LanguageId::Css, b, i + 2, 1) else {
                if let Some(end) = step_nl_slice(&b[i + 2..], &mut nl_idx, stop_base, stk.is_empty()) {
                    return (stk, Some(end));
                }
                break;
            };
            let nls = b[i + 2..a].iter().filter(|&&c| c == b'\n').count();
            if let Some(end) = step_nl_slice(&b[i + 2..a], &mut nl_idx, stop_base, stk.is_empty()) { return (stk, Some(end)); }
            ln += nls; i = a; continue;
        }
        if b[i] == b'{' { stk.push(ln); } else if b[i] == b'}' { stk.pop(); }
        i += 1;
    }
    (stk, None)
}
pub(crate) fn css_unclosed_opener_lines(pfx: &[&str]) -> Vec<usize> { css_scan_core(&pfx.join("\n"), None).0 }
pub(crate) fn css_suf_close_end(pfx_s: &[&str], raw_base: &[&str], suf: &[&str]) -> usize {
    let head_lines = pfx_s.len() + raw_base.len();
    if suf.is_empty() || head_lines == 0 { return 0; }
    css_scan_core(&join_slices(pfx_s, raw_base, suf), Some(head_lines - 1)).1.unwrap_or(suf.len())
}

fn toml_scan_core(src: &str, stop_base: Option<usize>) -> (Vec<(usize, u8)>, usize, Option<usize>) {
    let (b, mut i, mut ln, mut ls, mut stk, mut unm) = (src.as_bytes(), 0usize, 0usize, 0usize, Vec::new(), 0usize);
    while i < b.len() {
        if b[i] == b'\n' {
            if let Some(end) = step_nl_check(&mut ln, stop_base, stk.is_empty()) { return (stk, unm, Some(end)); }
            i += 1; ls = i; continue;
        }
        if b[i] == b'#' { while i < b.len() && b[i] != b'\n' { i += 1; } continue; }
        if b[i..].starts_with(b"\"\"\"") || b[i..].starts_with(b"'''") {
            let q = &b[i..i + 3]; let ql = ln; i += 3; let mut closed = false;
            while i < b.len() {
                if q[0] == b'"' && b[i] == b'\\' { if i + 1 < b.len() && b[i + 1] == b'\n' { ln += 1; ls = i + 2; } i += 2; continue; }
                if b[i..].starts_with(q) { i += 3; closed = true; break; }
                if b[i] == b'\n' { ln += 1; ls = i + 1; }
                i += 1;
            }
            if !closed { stk.push((ql, q[0])); }
            continue;
        }
        if matches!(b[i], b'"' | b'\'') {
            let q = b[i]; i += 1;
            while i < b.len() && b[i] != b'\n' {
                if q == b'"' && b[i] == b'\\' {
                    if i + 1 < b.len() && b[i + 1] == b'\n' {
                        if let Some(end) = step_nl_check(&mut ln, stop_base, stk.is_empty()) { return (stk, unm, Some(end)); }
                        ls = i + 2;
                    }
                    i += 2; continue;
                }
                if b[i] == q { i += 1; break; }
                i += 1;
            }
            continue;
        }
        if b[i] == b'[' {
            let tag = if stk.is_empty() && !b[ls..i].contains(&b'=') { b'H' } else { b'[' };
            stk.push((ln, tag));
        } else if b[i] == b'{' { stk.push((ln, b'{')); }
        else if b[i] == b']' { if stk.last().is_some_and(|&(_, k)| matches!(k, b'[' | b'H')) { stk.pop(); } else { unm += 1; } }
        else if b[i] == b'}' { if stk.last().is_some_and(|&(_, k)| k == b'{') { stk.pop(); } else { unm += 1; } }
        i += 1;
    }
    (stk, unm, None)
}
pub(crate) fn toml_delim_scan(pfx: &[&str]) -> (Vec<(usize, u8)>, usize) { let (s, u, _) = toml_scan_core(&pfx.join("\n"), None); (s, u) }
pub(crate) fn toml_unclosed_openers(pfx: &[&str]) -> Vec<(usize, u8)> { toml_delim_scan(pfx).0 }
pub(crate) fn toml_unclosed_opener_lines(pfx: &[&str]) -> Vec<usize> { toml_unclosed_openers(pfx).into_iter().map(|(l, _)| l).collect() }
pub(crate) fn toml_suf_close_end(pfx_s: &[&str], raw_base: &[&str], suf: &[&str]) -> usize {
    let head_lines = pfx_s.len() + raw_base.len();
    if suf.is_empty() || head_lines == 0 { return 0; }
    toml_scan_core(&join_slices(pfx_s, raw_base, suf), Some(head_lines - 1)).2.unwrap_or(suf.len())
}

pub(crate) fn find_xml_decl_end(b: &[u8], mut k: usize) -> Option<usize> {
    let (mut q, mut bd) = (0u8, 0usize);
    while k < b.len() {
        if q != 0 {
            if b[k] == q { q = 0; }
        } else if bd > 0 && b[k..].starts_with(b"<!--") {
            let r = b[k + 4..].windows(3).position(|w| w == b"-->")?;
            k += 7 + r; continue;
        } else if bd > 0 && b[k..].starts_with(b"<?") {
            let r = b[k + 2..].windows(2).position(|w| w == b"?>")?;
            k += 4 + r; continue;
        } else if matches!(b[k], b'"' | b'\'') {
            q = b[k];
        } else if b[k] == b'[' {
            bd += 1;
        } else if b[k] == b']' {
            bd = bd.saturating_sub(1);
        } else if b[k] == b'>' && bd == 0 {
            return Some(k);
        }
        k += 1;
    }
    None
}

pub(crate) fn xml_pi_valid(inner: &str, at_doc_start: bool) -> bool {
    if inner.is_empty() || inner.as_bytes()[0].is_ascii_whitespace() { return false; }
    let te = inner.bytes().position(|c| c.is_ascii_whitespace()).unwrap_or(inner.len());
    let target = &inner[..te];
    if target == "xml" { te < inner.len() && at_doc_start } else { !target.eq_ignore_ascii_case("xml") }
}
