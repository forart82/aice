use crate::ir::{Span, TranspileError};
use crate::lexer_scan_lit::Scanner;
use crate::lexer_tokens::{MULTI_PUNCT, TokenKind, keyword_kind};

#[derive(Debug, Clone)]
pub(crate) enum RawKind {
    LeadingIndent(usize),
    Newline,
    Tok(TokenKind, String),
}

#[derive(Debug, Clone)]
pub(crate) struct RawTok {
    pub kind: RawKind,
    pub span: Span,
}

pub(crate) fn scan_raw(src: &str) -> Result<Vec<RawTok>, TranspileError> {
    let mut s = Scanner::new(src);
    scan_all(&mut s)?;
    Ok(s.out)
}

fn scan_all(s: &mut Scanner<'_>) -> Result<(), TranspileError> {
    while s.i < s.b.len() {
        if s.at_line_start {
            scan_leading_ws(s);
            if s.i >= s.b.len() {
                break;
            }
        }
        let ch = s.b[s.i];
        if ch == b'\r' {
            s.i += 1;
            continue;
        }
        if ch == b'\n' {
            let sp = Span::new(s.line, s.col(s.i), s.i, s.i + 1);
            s.out.push(RawTok { kind: RawKind::Newline, span: sp });
            s.i += 1;
            s.line += 1;
            s.line_start = s.i;
            s.at_line_start = true;
            s.at_stmt_start = true;
            s.on_import_line = false;
            s.prev_val_tok = false;
            continue;
        }
        if ch == b' ' || ch == b'\t' {
            s.i += 1;
            continue;
        }
        scan_token(s)?;
    }
    Ok(())
}

fn scan_leading_ws(s: &mut Scanner<'_>) {
    let start = s.i;
    let mut width = 0usize;
    while s.i < s.b.len() {
        match s.b[s.i] {
            b' ' => { width += 1; s.i += 1; }
            b'\t' => { width += 2; s.i += 1; }
            _ => break,
        }
    }
    s.at_line_start = false;
    if s.i < s.b.len() && s.b[s.i] != b'\n' && s.b[s.i] != b'\r' {
        let sp = Span::new(s.line, 1, start, s.i);
        s.out.push(RawTok { kind: RawKind::LeadingIndent(width), span: sp });
    }
}

fn scan_raw_line_payload(s: &mut Scanner<'_>, pipe_pos: usize) {
    s.i = pipe_pos + 1;
    if s.b.get(s.i) == Some(&b' ') {
        s.i += 1;
    }
    let t0 = s.i;
    while s.i < s.b.len() && s.b[s.i] != b'\n' {
        s.i += 1;
    }
    let text = s.src[t0..s.i].trim_end_matches('\r').to_string();
    s.push_tok(TokenKind::RawLine, text, pipe_pos, s.i);
}

fn try_scan_raw_line(s: &mut Scanner<'_>, start: usize) -> bool {
    let rest = &s.src[start..];
    if s.at_stmt_start {
        if s.b[start] == b'|' && matches!(s.peek(1), None | Some(b' ' | b'\n' | b'\r')) {
            scan_raw_line_payload(s, start);
            return true;
        }
        const TAGS: &[&str] = &[
            "######", "#####", "####", "###", "##", "#", "todo[x]", "todo[ ]",
            "shebang", "prolog", "pragma", "code", "ddl", "opt", "con",
            "dec", "cmd", "var", "set", "ref", "li", "ol", "fm", "th", "tr", "q",
        ];
        for tag in TAGS {
            if let Some(after) = rest.strip_prefix(tag)
                && let Some(after_pipe) = after.strip_prefix('|')
                && (after_pipe.is_empty() || matches!(after_pipe.as_bytes()[0], b' ' | b'\n' | b'\r'))
            {
                let tag_end = start + tag.len();
                s.push_tok(TokenKind::Ident, (*tag).to_string(), start, tag_end);
                scan_raw_line_payload(s, tag_end);
                return true;
            }
        }
        return false;
    }
    if s.b[start] == b':'
        && s.peek(1) == Some(b'|')
        && matches!(s.peek(2), None | Some(b' ' | b'\n' | b'\r'))
    {
        s.i = start + 1;
        s.push_tok(TokenKind::Colon, ":".to_string(), start, start + 1);
        scan_raw_line_payload(s, start + 1);
        return true;
    }
    if s.b[start] == b'|'
        && matches!(s.peek(1), None | Some(b' ' | b'\n' | b'\r'))
        && s.out.len() >= 2
        && matches!(&s.out[s.out.len() - 1].kind, RawKind::Tok(TokenKind::String | TokenKind::Ident, _))
        && matches!(&s.out[s.out.len() - 2].kind, RawKind::Tok(TokenKind::Ident, kw) if kw == "clause" || kw == "with")
    {
        scan_raw_line_payload(s, start);
        return true;
    }
    false
}

fn scan_token(s: &mut Scanner<'_>) -> Result<(), TranspileError> {
    let start = s.i;
    if try_scan_raw_line(s, start) {
        return Ok(());
    }
    let ch = s.b[s.i];
    match ch {
        b'#' => s.scan_hash(start),
        b'/' if s.prev_val_tok
            && s.peek(1) == Some(b'/')
            && s.peek(2) == Some(b'=')
            && s.peek(3) != Some(b'=') =>
        {
            s.i += 3;
            s.push_tok(TokenKind::SlashSlashEq, "//=".to_string(), start, s.i);
            Ok(())
        }
        b'/' if s.peek(1) == Some(b'/') => {
            s.i += 2;
            let t0 = s.i;
            while s.i < s.b.len() && s.b[s.i] != b'\n' {
                s.i += 1;
            }
            let text = s.src[t0..s.i].trim_end_matches('\r').trim().to_string();
            s.push_tok(TokenKind::Comment, text, start, s.i);
            Ok(())
        }
        b'/' if s.peek(1) == Some(b'*') => s.scan_block_comment(start),
        b'/' if !s.on_import_line && !s.prev_val_tok && s.looks_like_regex() => s.scan_regex(start),
        b'"' | b'\'' => s.scan_quote(start, ch),
        b'`' => s.scan_template(start, true),
        b'}' if s.template_stack.last().copied() == Some(0) => {
            s.template_stack.pop();
            s.i += 1;
            s.scan_template(start, false)
        }
        b'0'..=b'9' => scan_number(s, start),
        b'a'..=b'z' | b'A'..=b'Z' | b'_' => scan_ident(s, start),
        b'\\' if s.peek(1).is_some_and(|c| c.is_ascii_alphabetic() || c == b'_') => scan_ident(s, start),
        _ if !ch.is_ascii() => {
            let u = s.src[start..].chars().next().unwrap_or('\0');
            if u.is_alphabetic() || u == '_' {
                scan_ident(s, start)
            } else {
                Err(TranspileError::at(
                    format!("Unexpected character '{u}'"),
                    Span::new(s.line, s.col(start), start, start + u.len_utf8()),
                ))
            }
        }
        _ => scan_punct(s, start),
    }
}

fn scan_number(s: &mut Scanner<'_>, start: usize) -> Result<(), TranspileError> {
    if s.b[s.i] == b'0' && matches!(s.peek(1), Some(b'x' | b'X' | b'b' | b'B' | b'o' | b'O')) {
        s.i += 2;
        while s.i < s.b.len() && (s.b[s.i].is_ascii_hexdigit() || s.b[s.i] == b'_') {
            s.i += 1;
        }
        s.push_tok(TokenKind::Number, s.src[start..s.i].to_string(), start, s.i);
        return Ok(());
    }
    while s.i < s.b.len() && (s.b[s.i].is_ascii_digit() || s.b[s.i] == b'_') {
        s.i += 1;
    }
    if s.b.get(s.i) == Some(&b'.') && s.b.get(s.i + 1).is_some_and(u8::is_ascii_digit) {
        s.i += 1;
        while s.i < s.b.len() && (s.b[s.i].is_ascii_digit() || s.b[s.i] == b'_') {
            s.i += 1;
        }
    }
    if matches!(s.b.get(s.i), Some(b'e' | b'E')) {
        s.i += 1;
        if matches!(s.b.get(s.i), Some(b'+' | b'-')) {
            s.i += 1;
        }
        while s.i < s.b.len() && (s.b[s.i].is_ascii_digit() || s.b[s.i] == b'_') {
            s.i += 1;
        }
    }
    s.push_tok(TokenKind::Number, s.src[start..s.i].to_string(), start, s.i);
    Ok(())
}

fn scan_ident(s: &mut Scanner<'_>, start: usize) -> Result<(), TranspileError> {
    while s.i < s.b.len() {
        let c = s.b[s.i];
        if c.is_ascii_alphanumeric()
            || c == b'_'
            || (c == b'\\' && s.peek(1).is_some_and(|n| n.is_ascii_alphabetic() || n == b'_'))
        {
            s.i += 1;
        } else if !c.is_ascii() {
            let ch = s.next_char();
            if !ch.is_alphanumeric() && ch != '_' {
                s.i -= ch.len_utf8();
                break;
            }
        } else {
            break;
        }
    }
    let word = &s.src[start..s.i];
    let kind = keyword_kind(word).unwrap_or(TokenKind::Ident);
    s.push_tok(kind, word.to_string(), start, s.i);
    Ok(())
}

fn scan_punct(s: &mut Scanner<'_>, start: usize) -> Result<(), TranspileError> {
    let rest = &s.src[start..];
    for &(pat, kind) in MULTI_PUNCT {
        if rest.starts_with(pat) {
            if kind == TokenKind::DotEq
                && matches!(s.out.last().map(|t| &t.kind), Some(RawKind::Tok(TokenKind::Dot, _)))
            {
                continue;
            }
            if kind == TokenKind::Sigil
                && rest.as_bytes().get(pat.len()).is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_')
            {
                continue;
            }
            s.i += pat.len();
            s.push_tok(kind, pat.to_string(), start, s.i);
            return Ok(());
        }
    }
    let c = s.b[s.i];
    if c == b'!' && crate::lexer_macro::try_scan_macro_body(s, start)? {
        return Ok(());
    }
    if c == b'{' && let Some(depth) = s.template_stack.last_mut() {
        *depth += 1;
    } else if c == b'}' && let Some(depth) = s.template_stack.last_mut() && *depth > 0 {
        *depth -= 1;
    }
    let kind = match c {
        b'+' => TokenKind::Plus, b'-' => TokenKind::Minus, b'~' => TokenKind::Tilde,
        b'*' => TokenKind::Star, b'/' => TokenKind::Slash, b'%' => TokenKind::Percent,
        b'&' => TokenKind::Amp, b'^' => TokenKind::Caret, b'|' => TokenKind::Pipe,
        b'<' => TokenKind::Lt, b'>' => TokenKind::Gt, b'=' => TokenKind::Equal,
        b'(' => TokenKind::LParen, b')' => TokenKind::RParen,
        b'[' => TokenKind::LBracket, b']' => TokenKind::RBracket,
        b'{' => TokenKind::LBrace, b'}' => TokenKind::RBrace,
        b':' => TokenKind::Colon, b',' => TokenKind::Comma, b'.' => TokenKind::Dot,
        b'?' => TokenKind::Question, b'!' => TokenKind::Bang,
        b'$' => TokenKind::Dollar, b';' => TokenKind::Semicolon, b'@' => TokenKind::At,
        _ => {
            return Err(TranspileError::at(
                format!("Unexpected character '{}'", c as char),
                Span::new(s.line, s.col(start), start, start + 1),
            ));
        }
    };
    s.i += 1;
    s.push_tok(kind, (c as char).to_string(), start, s.i);
    Ok(())
}
