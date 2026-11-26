use aice_lang_registry::LanguageId;

use crate::hybrid_lex::{LexSpan, LexSpanKind, is_ident_byte, lex_hybrid_slice};

pub(crate) fn try_scan_special_lit(
    src: &str,
    i: usize,
    target: LanguageId,
    regex_allowed: bool,
    out: &mut Vec<LexSpan>,
) -> Option<usize> {
    let b = src.as_bytes();
    let c = b[i];
    if target == LanguageId::Php && src[i..].starts_with("<<<")
        && let Some(end) = scan_php_heredoc(src, i)
    {
        out.push(LexSpan { kind: LexSpanKind::StringLit, start: i, end });
        return Some(end);
    }
    if target == LanguageId::Ruby && src[i..].starts_with("<<")
        && let Some(end) = scan_ruby_heredoc(src, i)
    {
        out.push(LexSpan { kind: LexSpanKind::StringLit, start: i, end });
        return Some(end);
    }
    if target == LanguageId::Rust && (i == 0 || !is_ident_byte(b[i - 1]))
        && let Some(end) = scan_rust_raw(src, i)
    {
        out.push(LexSpan { kind: LexSpanKind::StringLit, start: i, end });
        return Some(end);
    }
    if target == LanguageId::Cpp && (i == 0 || !is_ident_byte(b[i - 1]))
        && let Some(end) = scan_cpp_raw(src, i)
    {
        out.push(LexSpan { kind: LexSpanKind::StringLit, start: i, end });
        return Some(end);
    }
    if target == LanguageId::CSharp
        && let Some(next_i) = scan_csharp_lit(src, i, out)
    {
        return Some(next_i);
    }
    if matches!(target, LanguageId::Python | LanguageId::Dart) && (i == 0 || !is_ident_byte(b[i - 1]))
        && let Some(end) = scan_prefixed_py_dart(src, i, target)
    {
        out.push(LexSpan { kind: LexSpanKind::StringLit, start: i, end });
        return Some(end);
    }
    if (c == b'"' || c == b'\'') && matches!(target, LanguageId::Python | LanguageId::Kotlin | LanguageId::CSharp | LanguageId::Java | LanguageId::Dart)
        && b.get(i + 1) == Some(&c) && b.get(i + 2) == Some(&c)
    {
        let end = scan_triple_end(b, i + 3, c, false);
        out.push(LexSpan { kind: LexSpanKind::StringLit, start: i, end });
        return Some(end);
    }
    if c == b'/' && regex_allowed && matches!(target, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript)
        && let Some(end) = scan_js_regex(b, i)
    {
        out.push(LexSpan { kind: LexSpanKind::StringLit, start: i, end });
        return Some(end);
    }
    if c == b'`' && matches!(target, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript | LanguageId::Go) {
        if target == LanguageId::Go {
            let mut k = i + 1;
            while k < b.len() && b[k] != b'`' { k += 1; }
            let end = if k < b.len() { k + 1 } else { k };
            out.push(LexSpan { kind: LexSpanKind::StringLit, start: i, end });
            return Some(end);
        }
        return Some(scan_js_template(src, i, out));
    }
    None
}

fn scan_php_heredoc(src: &str, i: usize) -> Option<usize> {
    let rest = &src[i + 3..];
    let nl = rest.find('\n')?;
    let hdr = rest[..nl].trim().trim_matches('\'').trim_matches('"').trim();
    if hdr.is_empty() || !hdr.bytes().all(|x| x.is_ascii_alphanumeric() || x == b'_') {
        return None;
    }
    let mut pos = i + 3 + nl + 1;
    while pos < src.len() {
        let line_end = src[pos..].find('\n').map(|o| pos + o).unwrap_or(src.len());
        let line = src[pos..line_end].trim_start();
        if let Some(after) = line.strip_prefix(hdr)
            && (after.is_empty() || after.starts_with([';', ',', ')', ' ', '\t', '\r']))
        {
            return Some(line_end.min(pos + (src[pos..line_end].len() - line.len()) + hdr.len()));
        }
        pos = if line_end < src.len() { line_end + 1 } else { break };
    }
    Some(src.len())
}

fn scan_ruby_heredoc(src: &str, i: usize) -> Option<usize> {
    let b = src.as_bytes();
    let mut k = i + 2;
    if matches!(b.get(k), Some(b'-' | b'~')) { k += 1; }
    let q = if matches!(b.get(k), Some(b'\'' | b'"' | b'`')) { let ch = b[k]; k += 1; Some(ch) } else { None };
    let lstart = k;
    while k < b.len() && (b[k].is_ascii_alphanumeric() || b[k] == b'_') { k += 1; }
    if k == lstart { return None; }
    let label = &src[lstart..k];
    if let Some(qc) = q && b.get(k) != Some(&qc) { return None; }
    let nl = src[i..].find('\n')?;
    let mut pos = i + nl + 1;
    while pos < src.len() {
        let line_end = src[pos..].find('\n').map(|o| pos + o).unwrap_or(src.len());
        if src[pos..line_end].trim() == label {
            return Some(line_end);
        }
        pos = if line_end < src.len() { line_end + 1 } else { break };
    }
    Some(src.len())
}

fn scan_rust_raw(src: &str, i: usize) -> Option<usize> {
    let b = src.as_bytes();
    let mut k = match b.get(i) {
        Some(b'r') => i + 1,
        Some(b'b' | b'c') if b.get(i + 1) == Some(&b'r') => i + 2,
        _ => return None,
    };
    let mut hashes = 0usize;
    while b.get(k) == Some(&b'#') { hashes += 1; k += 1; }
    if b.get(k) != Some(&b'"') { return None; }
    k += 1;
    while k < b.len() {
        if b[k] == b'"' {
            let mut h = 0usize;
            while h < hashes && b.get(k + 1 + h) == Some(&b'#') { h += 1; }
            if h == hashes { return Some(k + 1 + hashes); }
        }
        k += 1;
    }
    Some(b.len())
}

fn scan_cpp_raw(src: &str, i: usize) -> Option<usize> {
    let rest = &src[i..];
    let off = ["u8R\"", "LR\"", "uR\"", "UR\"", "R\""].iter().find_map(|p| rest.starts_with(p).then_some(p.len()))?;
    let delim_start = i + off;
    let paren = src[delim_start..].find('(')?;
    if paren > 16 { return None; }
    let delim = &src[delim_start..delim_start + paren];
    if delim.bytes().any(|c| c.is_ascii_whitespace() || c == b'\\' || c == b')') { return None; }
    let close = format!("){delim}\"");
    let body_start = delim_start + paren + 1;
    let end = src[body_start..].find(&close).map(|o| body_start + o + close.len()).unwrap_or(src.len());
    Some(end)
}

fn scan_csharp_lit(src: &str, i: usize, out: &mut Vec<LexSpan>) -> Option<usize> {
    let rest = &src[i..];
    if rest.starts_with("$\"\"\"") || rest.starts_with("\"\"\"") {
        let mut dollars = 0usize;
        let b = src.as_bytes();
        while b.get(i + dollars) == Some(&b'$') { dollars += 1; }
        if b[i + dollars..].starts_with(b"\"\"\"") {
            let mut q = 0usize;
            while b.get(i + dollars + q) == Some(&b'"') { q += 1; }
            let mut k = i + dollars + q;
            while k < b.len() {
                if b[k] == b'"' {
                    let mut run = 0usize;
                    while b.get(k + run) == Some(&b'"') { run += 1; }
                    if run >= q {
                        out.push(LexSpan { kind: LexSpanKind::StringLit, start: i, end: k + run });
                        return Some(k + run);
                    }
                    k += run;
                    continue;
                }
                k += 1;
            }
            out.push(LexSpan { kind: LexSpanKind::StringLit, start: i, end: b.len() });
            return Some(b.len());
        }
    }
    let off = ["@$\"", "$@\"", "@\""].iter().find_map(|p| rest.starts_with(p).then_some(p.len()))?;
    let b = src.as_bytes();
    let mut k = i + off;
    while k < b.len() {
        if b[k] == b'"' {
            if b.get(k + 1) == Some(&b'"') { k += 2; continue; }
            out.push(LexSpan { kind: LexSpanKind::StringLit, start: i, end: k + 1 });
            return Some(k + 1);
        }
        k += 1;
    }
    out.push(LexSpan { kind: LexSpanKind::StringLit, start: i, end: b.len() });
    Some(b.len())
}

fn scan_prefixed_py_dart(src: &str, i: usize, target: LanguageId) -> Option<usize> {
    let b = src.as_bytes();
    let mut k = i;
    while k < i + 2 && k < b.len() && matches!(b[k], b'r' | b'R' | b'f' | b'F' | b'b' | b'B' | b'u' | b'U') {
        if target == LanguageId::Dart && !matches!(b[k], b'r' | b'R') { return None; }
        k += 1;
    }
    if k == i || !matches!(b.get(k), Some(b'"' | b'\'')) { return None; }
    let q = b[k];
    let is_raw = src[i..k].bytes().any(|c| c == b'r' || c == b'R');
    if b.get(k + 1) == Some(&q) && b.get(k + 2) == Some(&q) {
        return Some(scan_triple_end(b, k + 3, q, is_raw));
    }
    let mut p = k + 1;
    while p < b.len() {
        if b[p] == b'\n' { break; }
        if !is_raw && b[p] == b'\\' && p + 1 < b.len() { p += 2; continue; }
        if b[p] == q { return Some(p + 1); }
        p += 1;
    }
    Some(p)
}

fn scan_triple_end(b: &[u8], mut k: usize, q: u8, is_raw: bool) -> usize {
    while k < b.len() {
        if !is_raw && b[k] == b'\\' && k + 1 < b.len() { k += 2; continue; }
        if b[k] == q && b.get(k + 1) == Some(&q) && b.get(k + 2) == Some(&q) {
            return k + 3;
        }
        k += 1;
    }
    b.len()
}

fn scan_js_regex(b: &[u8], i: usize) -> Option<usize> {
    if matches!(b.get(i + 1), None | Some(b'/' | b'*' | b'\n' | b'\r')) { return None; }
    let mut k = i + 1;
    let mut in_cls = false;
    while k < b.len() {
        let c = b[k];
        if c == b'\n' || c == b'\r' { return None; }
        if c == b'\\' && k + 1 < b.len() { k += 2; continue; }
        if c == b'[' { in_cls = true; }
        else if c == b']' { in_cls = false; }
        else if c == b'/' && !in_cls {
            k += 1;
            while k < b.len() && b[k].is_ascii_alphabetic() { k += 1; }
            return Some(k);
        }
        k += 1;
    }
    None
}

fn scan_js_template(src: &str, i: usize, out: &mut Vec<LexSpan>) -> usize {
    let b = src.as_bytes();
    let mut seg_start = i;
    let mut k = i + 1;
    while k < b.len() {
        if b[k] == b'\\' && k + 1 < b.len() { k += 2; continue; }
        if b[k] == b'`' {
            out.push(LexSpan { kind: LexSpanKind::TemplateText, start: seg_start, end: k + 1 });
            return k + 1;
        }
        if b[k] == b'$' && b.get(k + 1) == Some(&b'{') {
            out.push(LexSpan { kind: LexSpanKind::TemplateText, start: seg_start, end: k + 2 });
            k = lex_hybrid_slice(src, k + 2, LanguageId::TypeScript, true, out);
            seg_start = k;
            if k < b.len() && b[k] == b'}' {
                k += 1;
                out.push(LexSpan { kind: LexSpanKind::TemplateText, start: seg_start, end: k });
                seg_start = k;
            }
            continue;
        }
        k += 1;
    }
    out.push(LexSpan { kind: LexSpanKind::TemplateText, start: seg_start, end: b.len() });
    b.len()
}
