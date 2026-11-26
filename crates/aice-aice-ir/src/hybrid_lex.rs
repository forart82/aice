use aice_lang_registry::LanguageId;

use crate::hybrid_lex_lit::try_scan_special_lit;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LexSpanKind {
    Code,
    StringLit,
    Comment,
    TemplateText,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LexSpan {
    pub kind: LexSpanKind,
    pub start: usize,
    pub end: usize,
}

pub fn is_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

pub fn lex_hybrid(src: &str, target: LanguageId) -> Vec<LexSpan> {
    let mut out = Vec::new();
    let _ = lex_hybrid_slice(src, 0, target, false, &mut out);
    out
}

pub(crate) fn lex_hybrid_slice(
    src: &str,
    mut i: usize,
    target: LanguageId,
    stop_on_rbrace: bool,
    out: &mut Vec<LexSpan>,
) -> usize {
    let b = src.as_bytes();
    let mut code_start = i;
    let mut brace_depth = 0usize;
    let mut regex_allowed = true;

    while i < b.len() {
        let c = b[i];
        if stop_on_rbrace && c == b'}' && brace_depth == 0 {
            if code_start < i {
                out.push(LexSpan { kind: LexSpanKind::Code, start: code_start, end: i });
            }
            return i;
        }

        // Block comments /* ... */
        if c == b'/' && b.get(i + 1) == Some(&b'*') && supports_c_block_comment(target) {
            flush_code(out, code_start, i);
            let nested = matches!(target, LanguageId::Rust | LanguageId::Kotlin);
            let end = scan_block_comment(b, i, nested);
            out.push(LexSpan { kind: LexSpanKind::Comment, start: i, end });
            i = end;
            code_start = i;
            continue;
        }
        // Line comment //
        if c == b'/' && b.get(i + 1) == Some(&b'/') && supports_slash_line_comment(target) {
            flush_code(out, code_start, i);
            let end = scan_eol(b, i + 2);
            out.push(LexSpan { kind: LexSpanKind::Comment, start: i, end });
            i = end;
            code_start = i;
            regex_allowed = true;
            continue;
        }
        // Line comment # (avoid PHP #[attr] and compact type sigil :# / -> #)
        if c == b'#' && supports_hash_comment(target) && !is_hash_exception(b, i, target) {
            flush_code(out, code_start, i);
            let end = scan_eol(b, i + 1);
            out.push(LexSpan { kind: LexSpanKind::Comment, start: i, end });
            i = end;
            code_start = i;
            regex_allowed = true;
            continue;
        }
        // Ruby =begin ... =end
        if target == LanguageId::Ruby && (i == 0 || b[i - 1] == b'\n') && src[i..].starts_with("=begin") {
            flush_code(out, code_start, i);
            let end = scan_ruby_doc(src, i);
            out.push(LexSpan { kind: LexSpanKind::Comment, start: i, end });
            i = end;
            code_start = i;
            continue;
        }

        let before = out.len();
        if let Some(next_i) = try_scan_special_lit(src, i, target, regex_allowed, out) {
            if out.len() > before {
                // Splice Code span before the newly pushed literal span(s)
                if code_start < i {
                    out.insert(before, LexSpan { kind: LexSpanKind::Code, start: code_start, end: i });
                }
            }
            i = next_i;
            code_start = i;
            regex_allowed = false;
            continue;
        }

        // Single-quote disambiguation
        if c == b'\'' {
            if target == LanguageId::Cpp && i > 0 && b[i - 1].is_ascii_digit() && b.get(i + 1).is_some_and(u8::is_ascii_digit) {
                i += 1;
                continue;
            }
            if target == LanguageId::Rust && is_rust_lifetime(b, i) {
                i += 1;
                continue;
            }
            if target == LanguageId::Tsx && !has_closing_quote_same_line(b, i, b'\'') {
                i += 1;
                continue;
            }
            flush_code(out, code_start, i);
            let end = scan_simple_quote(b, i, b'\'', target != LanguageId::Bash, false);
            out.push(LexSpan { kind: LexSpanKind::StringLit, start: i, end });
            i = end;
            code_start = i;
            regex_allowed = false;
            continue;
        }

        // Standard double-quoted string
        if c == b'"' {
            flush_code(out, code_start, i);
            let multiline = matches!(target, LanguageId::Rust | LanguageId::Php | LanguageId::Ruby | LanguageId::Dart);
            let end = scan_simple_quote(b, i, b'"', true, multiline);
            out.push(LexSpan { kind: LexSpanKind::StringLit, start: i, end });
            i = end;
            code_start = i;
            regex_allowed = false;
            continue;
        }

        if c == b'{' { brace_depth += 1; regex_allowed = true; }
        else if c == b'}' { brace_depth = brace_depth.saturating_sub(1); regex_allowed = false; }
        else if matches!(c, b'(' | b'[' | b',' | b';' | b':' | b'=' | b'?' | b'!' | b'&' | b'|' | b'\n') {
            regex_allowed = true;
        } else if matches!(c, b')' | b']') || is_ident_byte(c) {
            regex_allowed = false;
        }

        let ch_len = src[i..].chars().next().map(char::len_utf8).unwrap_or(1);
        i += ch_len;
    }
    flush_code(out, code_start, i);
    i
}

fn flush_code(out: &mut Vec<LexSpan>, start: usize, end: usize) {
    if start < end {
        out.push(LexSpan { kind: LexSpanKind::Code, start, end });
    }
}

fn supports_c_block_comment(t: LanguageId) -> bool {
    matches!(
        t,
        LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript | LanguageId::Rust
            | LanguageId::Go | LanguageId::C | LanguageId::Cpp | LanguageId::CSharp
            | LanguageId::Java | LanguageId::Kotlin | LanguageId::Dart | LanguageId::Php | LanguageId::Css
    )
}

fn supports_slash_line_comment(t: LanguageId) -> bool {
    supports_c_block_comment(t) && t != LanguageId::Css
}

fn supports_hash_comment(t: LanguageId) -> bool {
    matches!(t, LanguageId::Python | LanguageId::Ruby | LanguageId::Bash | LanguageId::Yaml | LanguageId::Toml | LanguageId::Php)
}

fn is_hash_exception(b: &[u8], i: usize, t: LanguageId) -> bool {
    if t == LanguageId::Php && b.get(i + 1) == Some(&b'[') { return true; }
    let mut k = i;
    while k > 0 && (b[k - 1] == b' ' || b[k - 1] == b'\t') { k -= 1; }
    k > 0 && matches!(b[k - 1], b':' | b'>' | b'[')
}

fn scan_block_comment(b: &[u8], i: usize, nested: bool) -> usize {
    let (mut k, mut depth) = (i + 2, 1usize);
    while k + 1 < b.len() {
        if nested && b[k] == b'/' && b[k + 1] == b'*' { depth += 1; k += 2; continue; }
        if b[k] == b'*' && b[k + 1] == b'/' {
            depth -= 1;
            k += 2;
            if depth == 0 { return k; }
            continue;
        }
        k += 1;
    }
    b.len()
}

fn scan_eol(b: &[u8], mut k: usize) -> usize {
    while k < b.len() && b[k] != b'\n' { k += 1; }
    k
}

fn scan_ruby_doc(src: &str, i: usize) -> usize {
    let mut pos = i + 6;
    while pos < src.len() {
        let nl = src[pos..].find('\n').map(|o| pos + o).unwrap_or(src.len());
        if src[pos..nl].trim_end() == "=end" { return nl; }
        pos = if nl < src.len() { nl + 1 } else { break };
    }
    src.len()
}

fn is_rust_lifetime(b: &[u8], i: usize) -> bool {
    let Some(&n1) = b.get(i + 1) else { return false; };
    if n1 == b'\\' { return false; }
    if b.get(i + 2) == Some(&b'\'') { return false; }
    n1.is_ascii_alphabetic() || n1 == b'_'
}

fn has_closing_quote_same_line(b: &[u8], i: usize, q: u8) -> bool {
    let mut k = i + 1;
    while k < b.len() && b[k] != b'\n' {
        if b[k] == b'\\' && k + 1 < b.len() { k += 2; continue; }
        if b[k] == q { return true; }
        k += 1;
    }
    false
}

fn scan_simple_quote(b: &[u8], i: usize, q: u8, esc: bool, multiline: bool) -> usize {
    let mut k = i + 1;
    while k < b.len() {
        if !multiline && b[k] == b'\n' { return k; }
        if esc && b[k] == b'\\' && k + 1 < b.len() { k += 2; continue; }
        if b[k] == q { return k + 1; }
        k += 1;
    }
    b.len()
}
