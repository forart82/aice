use crate::ir::{Span, TranspileError};
use crate::lexer_scan::RawKind;
use crate::lexer_scan_lit::Scanner;
use crate::lexer_tokens::TokenKind;

fn is_macro_ident_kind(k: TokenKind) -> bool {
    k == TokenKind::Ident
        || matches!(
            k,
            TokenKind::Module | TokenKind::From | TokenKind::Import | TokenKind::As
                | TokenKind::Type | TokenKind::Enum | TokenKind::Struct | TokenKind::Interface
                | TokenKind::Trait | TokenKind::Class | TokenKind::Extends | TokenKind::Implements
                | TokenKind::Fn | TokenKind::Async | TokenKind::Await | TokenKind::Const
                | TokenKind::Let | TokenKind::Mut | TokenKind::Val | TokenKind::Pub
                | TokenKind::Priv | TokenKind::Prot | TokenKind::Pkg | TokenKind::Component
                | TokenKind::Style | TokenKind::Tokens | TokenKind::If | TokenKind::Elif
                | TokenKind::Else | TokenKind::Match | TokenKind::For | TokenKind::In
                | TokenKind::Instanceof | TokenKind::While | TokenKind::Loop | TokenKind::Ret
                | TokenKind::Try | TokenKind::Catch | TokenKind::Finally | TokenKind::Throw
                | TokenKind::Break | TokenKind::Continue | TokenKind::Pass
                | TokenKind::And | TokenKind::Or | TokenKind::Not
        )
}

pub(crate) fn try_scan_macro_body(s: &mut Scanner<'_>, start: usize) -> Result<bool, TranspileError> {
    let Some(prev) = s.out.last() else { return Ok(false); };
    if prev.span.end_byte != start { return Ok(false); }
    let RawKind::Tok(pk, _) = prev.kind else { return Ok(false); };
    if !is_macro_ident_kind(pk) { return Ok(false); }
    if s.out.len() >= 2
        && matches!(
            s.out[s.out.len() - 2].kind,
            RawKind::Tok(TokenKind::Dot | TokenKind::QuestionDot, _)
        )
    {
        return Ok(false);
    }
    let mut k = start + 1;
    while k < s.b.len() && matches!(s.b[k], b' ' | b'\t') { k += 1; }
    let Some(&open) = s.b.get(k) else { return Ok(false); };
    let close = match open {
        b'(' => b')',
        b'[' => b']',
        b'{' => b'}',
        _ => return Ok(false),
    };
    let (sl, sc) = (s.line, s.col(start));
    let mut stack = vec![close];
    k += 1;
    while k < s.b.len() && !stack.is_empty() {
        if let Some(next) = try_skip_non_code(s, k) {
            k = next;
            continue;
        }
        let c = s.b[k];
        match c {
            b'(' => { stack.push(b')'); k += 1; }
            b'[' => { stack.push(b']'); k += 1; }
            b'{' => { stack.push(b'}'); k += 1; }
            b')' | b']' | b'}' => {
                if stack.last() == Some(&c) {
                    stack.pop();
                    k += 1;
                } else {
                    return Err(TranspileError::at(
                        format!("Mismatched '{}' in macro invocation", c as char),
                        Span::new(s.line, s.col(k), k, k + 1),
                    ));
                }
            }
            _ => { k += 1; }
        }
    }
    if !stack.is_empty() {
        return Err(TranspileError::at("Unclosed macro invocation", Span::new(sl, sc, start, k)));
    }
    s.i = k;
    s.at_line_start = false;
    let body = s.src[start..k].to_string();
    s.push_tok(TokenKind::MacroBody, body, start, k);
    Ok(true)
}

pub(crate) fn try_scan_turbofish(s: &mut Scanner<'_>, start: usize) -> Result<bool, TranspileError> {
    if s.b.get(start + 2) != Some(&b'<') {
        return Ok(false);
    }
    let (sl, sc) = (s.line, s.col(start));
    let mut k = start + 3;
    let mut angle_depth = 1usize;
    let mut brace_depth = 0usize;
    let mut bracket_after_semi: Vec<bool> = Vec::new();
    while k < s.b.len() && angle_depth > 0 {
        if let Some(next) = try_skip_non_code(s, k) {
            k = next;
            continue;
        }
        let c = s.b[k];
        if (c == b'-' || c == b'=') && s.b.get(k + 1) == Some(&b'>') {
            k += 2;
            continue;
        }
        match c {
            b'{' => { brace_depth += 1; k += 1; }
            b'}' => { brace_depth = brace_depth.saturating_sub(1); k += 1; }
            b'[' if brace_depth == 0 => { bracket_after_semi.push(false); k += 1; }
            b';' if brace_depth == 0 => {
                if let Some(last) = bracket_after_semi.last_mut() { *last = true; }
                k += 1;
            }
            b']' if brace_depth == 0 => { bracket_after_semi.pop(); k += 1; }
            b'<' if brace_depth == 0 && bracket_after_semi.last() != Some(&true) => {
                angle_depth += 1;
                k += 1;
            }
            b'>' if brace_depth == 0 && bracket_after_semi.last() != Some(&true) => {
                angle_depth -= 1;
                k += 1;
            }
            _ => { k += 1; }
        }
    }
    if angle_depth != 0 || !bracket_after_semi.is_empty() {
        return Err(TranspileError::at("Unclosed turbofish type arguments", Span::new(sl, sc, start, k)));
    }
    s.i = k;
    s.at_line_start = false;
    s.push_tok(TokenKind::Turbofish, s.src[start..k].to_string(), start, k);
    Ok(true)
}

fn try_skip_non_code(s: &mut Scanner<'_>, mut k: usize) -> Option<usize> {
    let c = s.b[k];
    if c == b'\n' {
        k += 1;
        s.line += 1;
        s.line_start = k;
        return Some(k);
    }
    if c == b'/' && s.b.get(k + 1) == Some(&b'/') {
        k += 2;
        while k < s.b.len() && s.b[k] != b'\n' { k += 1; }
        return Some(k);
    }
    if c == b'/' && s.b.get(k + 1) == Some(&b'*') {
        k += 2;
        let mut bd = 1usize;
        while k + 1 < s.b.len() && bd > 0 {
            if s.b[k] == b'/' && s.b[k + 1] == b'*' { bd += 1; k += 2; }
            else if s.b[k] == b'*' && s.b[k + 1] == b'/' { bd -= 1; k += 2; }
            else {
                if s.b[k] == b'\n' { s.line += 1; s.line_start = k + 1; }
                k += 1;
            }
        }
        return Some(k);
    }
    if let Some(after_raw) = try_skip_rust_raw_str(s, k) {
        return Some(after_raw);
    }
    if c == b'"' {
        k += 1;
        while k < s.b.len() {
            let sc_b = s.b[k];
            if sc_b == b'\\' && k + 1 < s.b.len() {
                if s.b[k + 1] == b'\n' { s.line += 1; s.line_start = k + 2; }
                k += 2;
            } else if sc_b == b'"' {
                k += 1;
                break;
            } else {
                if sc_b == b'\n' { s.line += 1; s.line_start = k + 1; }
                k += 1;
            }
        }
        return Some(k);
    }
    if c == b'\'' {
        return Some(skip_rust_char_or_lifetime(s.src, s.b, k));
    }
    None
}

fn try_skip_rust_raw_str(s: &mut Scanner<'_>, pos: usize) -> Option<usize> {
    let b = s.b;
    if pos > 0 && (b[pos - 1].is_ascii_alphanumeric() || b[pos - 1] == b'_') {
        return None;
    }
    let mut k = pos;
    if matches!(b[k], b'b' | b'c') && b.get(k + 1) == Some(&b'r') { k += 2; }
    else if b[k] == b'r' { k += 1; }
    else { return None; }
    let mut hashes = 0usize;
    while b.get(k) == Some(&b'#') { hashes += 1; k += 1; }
    if b.get(k) != Some(&b'"') { return None; }
    k += 1;
    while k < b.len() {
        if b[k] == b'\n' { s.line += 1; s.line_start = k + 1; k += 1; continue; }
        if b[k] == b'"' {
            let mut m = 0usize;
            while m < hashes && b.get(k + 1 + m) == Some(&b'#') { m += 1; }
            if m == hashes { return Some(k + 1 + hashes); }
        }
        k += 1;
    }
    Some(k)
}

fn skip_rust_char_or_lifetime(src: &str, b: &[u8], pos: usize) -> usize {
    let k = pos + 1;
    if k >= b.len() { return k; }
    if b[k] == b'\\' {
        let mut j = k + 1;
        while j < b.len() && b[j] != b'\n' && b[j] != b'\'' { j += 1; }
        return if j < b.len() && b[j] == b'\'' { j + 1 } else { k };
    }
    if let Some(ch) = src[k..].chars().next() {
        let after = k + ch.len_utf8();
        if b.get(after) == Some(&b'\'') {
            return after + 1;
        }
    }
    k
}
