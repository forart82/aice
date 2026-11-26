use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};

pub fn scan_block_comment(
    b: &[u8], start: usize, line: usize, col: usize, nested: bool,
    toks: &mut Vec<SqlTok>, errs: &mut Vec<ErrorSpan>,
) -> usize {
    let mut i = start + 2;
    let mut depth = 1usize;
    while i < b.len() {
        if nested && b[i] == b'/' && i + 1 < b.len() && b[i + 1] == b'*' {
            depth += 1;
            i += 2;
        } else if b[i] == b'*' && i + 1 < b.len() && b[i + 1] == b'/' {
            depth -= 1;
            i += 2;
            if depth == 0 {
                toks.push(SqlTok { kind: SqlTokKind::Comment, start, end: i, line, col });
                return i;
            }
        } else {
            i += 1;
        }
    }
    errs.push(sp(line, col, "Unterminated '/*' block comment"));
    b.len()
}

#[allow(clippy::too_many_arguments)]
pub fn scan_quoted(
    src: &str, start: usize, quote: u8, kind: SqlTokKind, err_msg: &str, esc: bool,
    line: usize, col: usize, toks: &mut Vec<SqlTok>, errs: &mut Vec<ErrorSpan>,
) -> usize {
    let b = src.as_bytes();
    let mut i = start + 1;
    while i < b.len() {
        if b[i] == quote {
            if i + 1 < b.len() && b[i + 1] == quote {
                i += 2;
            } else {
                i += 1;
                toks.push(SqlTok { kind, start, end: i, line, col });
                return i;
            }
        } else if esc && quote == b'\'' && b[i] == b'\\' && i + 1 < b.len() {
            let step = if b[i + 1] >= 0x80 {
                1 + src[i + 1..].chars().next().map_or(1, char::len_utf8)
            } else {
                2
            };
            i += step;
        } else if b[i] >= 0x80 {
            i += src[i..].chars().next().map_or(1, char::len_utf8);
        } else {
            i += 1;
        }
    }
    errs.push(sp(line, col, err_msg));
    b.len()
}

pub fn scan_bracket(
    src: &str, start: usize, line: usize, col: usize,
    toks: &mut Vec<SqlTok>, errs: &mut Vec<ErrorSpan>,
) -> usize {
    let b = src.as_bytes();
    let mut i = start + 1;
    while i < b.len() {
        if b[i] == b']' {
            if i + 1 < b.len() && b[i + 1] == b']' {
                i += 2;
            } else {
                i += 1;
                toks.push(SqlTok { kind: SqlTokKind::BracketIdent, start, end: i, line, col });
                return i;
            }
        } else if b[i] >= 0x80 {
            i += src[i..].chars().next().map_or(1, char::len_utf8);
        } else {
            i += 1;
        }
    }
    errs.push(sp(line, col, "Unterminated '[...]' bracket identifier"));
    b.len()
}

pub fn scan_dollar(
    src: &str, start: usize, line: usize, col: usize,
    toks: &mut Vec<SqlTok>, errs: &mut Vec<ErrorSpan>,
) -> Option<usize> {
    let b = src.as_bytes();
    let mut j = start + 1;
    if j < b.len() && b[j] != b'$' {
        if !(b[j].is_ascii_alphabetic() || b[j] == b'_') {
            return None;
        }
        j += 1;
        while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'_') { j += 1; }
    }
    if j >= b.len() || b[j] != b'$' {
        return None;
    }
    let tag_end = j + 1;
    let tag = &src[start..tag_end];
    let body_start = tag_end;
    if let Some(rel) = src[body_start..].find(tag) {
        let body_end = body_start + rel;
        let end = body_end + tag.len();
        toks.push(SqlTok { kind: SqlTokKind::DollarQuote { body_start, body_end }, start, end, line, col });
        Some(end)
    } else {
        errs.push(sp(line, col, format!("Unterminated dollar-quoted block '{tag}'")));
        Some(b.len())
    }
}

pub fn scan_param(b: &[u8], start: usize, line: usize, col: usize, toks: &mut Vec<SqlTok>) -> usize {
    let mut i = start + 1;
    while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') { i += 1; }
    toks.push(SqlTok { kind: SqlTokKind::Param, start, end: i, line, col });
    i
}

pub fn scan_punct(src: &str, start: usize, line: usize, col: usize, toks: &mut Vec<SqlTok>) -> usize {
    let b = src.as_bytes();
    let ch = b[start];
    let two = src.get(start..start + 2).unwrap_or("");
    if matches!(two, "<>" | "!=" | "<=" | ">=" | ":=" | "||" | "+=" | "-=" | "*=" | "/=") {
        toks.push(SqlTok { kind: SqlTokKind::Op, start, end: start + 2, line, col });
        return start + 2;
    }
    let kind = match ch {
        b'(' => SqlTokKind::LParen,
        b')' => SqlTokKind::RParen,
        b'[' => SqlTokKind::LBracket,
        b']' => SqlTokKind::RBracket,
        b'{' => SqlTokKind::LBrace,
        b'}' => SqlTokKind::RBrace,
        b',' => SqlTokKind::Comma,
        b';' => SqlTokKind::Semi,
        b'.' => SqlTokKind::Dot,
        _ => SqlTokKind::Op,
    };
    let step = if ch >= 0x80 { src[start..].chars().next().map_or(1, char::len_utf8) } else { 1 };
    toks.push(SqlTok { kind, start, end: start + step, line, col });
    start + step
}
