use crate::r5::checks::ErrorSpan;
use crate::r5::twig_html::TwigSpan;

#[derive(Debug, Clone)]
pub enum TwigTokKind {
    Comment,
    Output,
    Tag { keyword: String, rest: String },
}

#[derive(Debug, Clone)]
pub struct TwigTok {
    pub kind: TwigTokKind,
    pub start_byte: usize,
    pub end_byte: usize,
    pub line: usize,
    pub col: usize,
}

pub fn scan_twig_tokens(src: &str) -> (Vec<TwigTok>, Vec<TwigSpan>, Vec<ErrorSpan>) {
    let b = src.as_bytes();
    let mut tokens = Vec::new();
    let mut spans = Vec::new();
    let mut errors = Vec::new();
    let mut i = 0usize;
    let mut line = 1usize;
    let mut col = 1usize;
    let mut in_verbatim: Option<(usize, usize, usize)> = None;

    while i < b.len() {
        if let Some((v_line, v_col, body_start)) = in_verbatim {
            if b[i..].starts_with(b"{%")
                && let Some(end) = find_endverbatim(src, i)
            {
                if i > body_start {
                    spans.push(TwigSpan { start: body_start, end: i, is_output: false });
                }
                let start = i;
                advance_bytes(&b[i..end], &mut i, &mut line, &mut col);
                tokens.push(TwigTok {
                    kind: TwigTokKind::Tag {
                        keyword: "endverbatim".to_string(),
                        rest: String::new(),
                    },
                    start_byte: start,
                    end_byte: end,
                    line: v_line,
                    col: v_col,
                });
                spans.push(TwigSpan { start, end, is_output: false });
                in_verbatim = None;
                continue;
            }
            advance_one(b[i], &mut i, &mut line, &mut col);
            continue;
        }
        if b[i] != b'{' || i + 1 >= b.len() {
            advance_one(b[i], &mut i, &mut line, &mut col);
            continue;
        }
        let next = b[i + 1];
        if next == b'#' {
            let (sl, sc, start) = (line, col, i);
            advance_bytes(&b[i..i + 2], &mut i, &mut line, &mut col);
            if let Some(rel) = src[i..].find("#}") {
                let end = i + rel + 2;
                advance_bytes(&b[i..end], &mut i, &mut line, &mut col);
                tokens.push(TwigTok {
                    kind: TwigTokKind::Comment,
                    start_byte: start,
                    end_byte: end,
                    line: sl,
                    col: sc,
                });
                spans.push(TwigSpan { start, end, is_output: false });
            } else {
                errors.push(err_sp(sl, sc, "Unterminated Twig comment '{#'"));
                break;
            }
            continue;
        }
        if next == b'{' || next == b'%' {
            let is_out = next == b'{';
            let close = if is_out { b'}' } else { b'%' };
            let (sl, sc, start) = (line, col, i);
            advance_bytes(&b[i..i + 2], &mut i, &mut line, &mut col);
            if i < b.len() && b[i] == b'-' {
                advance_one(b[i], &mut i, &mut line, &mut col);
            }
            let inner_start = i;
            match scan_tag_inner(src, &mut i, &mut line, &mut col, close, sl, sc) {
                Ok((inner_end, end)) => {
                    let inner = src[inner_start..inner_end].trim();
                    if inner.is_empty() {
                        errors.push(err_sp(sl, sc, "Empty Twig tag"));
                    } else if is_out {
                        tokens.push(TwigTok {
                            kind: TwigTokKind::Output,
                            start_byte: start,
                            end_byte: end,
                            line: sl,
                            col: sc,
                        });
                    } else {
                        let (kw, rest) = split_keyword(inner);
                        if kw == "verbatim" {
                            in_verbatim = Some((sl, sc, end));
                        }
                        tokens.push(TwigTok {
                            kind: TwigTokKind::Tag { keyword: kw, rest },
                            start_byte: start,
                            end_byte: end,
                            line: sl,
                            col: sc,
                        });
                    }
                    spans.push(TwigSpan { start, end, is_output: is_out });
                }
                Err(err) => {
                    errors.push(err);
                    break;
                }
            }
            continue;
        }
        advance_one(b[i], &mut i, &mut line, &mut col);
    }
    if let Some((vl, vc, body_start)) = in_verbatim {
        if b.len() > body_start {
            spans.push(TwigSpan { start: body_start, end: b.len(), is_output: false });
        }
        errors.push(err_sp(vl, vc, "Unclosed {% verbatim %} block"));
    }
    (tokens, spans, errors)
}

fn scan_tag_inner(
    src: &str,
    i: &mut usize,
    line: &mut usize,
    col: &mut usize,
    close_ch: u8,
    sl: usize,
    sc: usize,
) -> Result<(usize, usize), ErrorSpan> {
    let b = src.as_bytes();
    let (mut brace_d, mut paren_d, mut brack_d) = (0usize, 0usize, 0usize);

    while *i < b.len() {
        let ch = b[*i];
        if ch == b'\'' || ch == b'"' {
            skip_twig_string(src, i, line, col, ch)?;
            continue;
        }
        if brace_d == 0
            && (b[*i..].starts_with(&[b'-', close_ch, b'}'])
                || b[*i..].starts_with(&[close_ch, b'}']))
        {
            if paren_d != 0 || brack_d != 0 {
                return Err(err_sp(*line, *col, "Unbalanced parentheses or brackets in Twig tag"));
            }
            let inner_end = *i;
            let len = if b[*i] == b'-' { 3 } else { 2 };
            advance_bytes(&b[*i..*i + len], i, line, col);
            return Ok((inner_end, *i));
        }
        match ch {
            b'{' => brace_d += 1,
            b'}' if brace_d > 0 => brace_d -= 1,
            b'}' => return Err(err_sp(*line, *col, "Unexpected '}' in Twig tag")),
            b'(' => paren_d += 1,
            b')' if paren_d > 0 => paren_d -= 1,
            b')' => return Err(err_sp(*line, *col, "Unexpected ')' in Twig tag")),
            b'[' => brack_d += 1,
            b']' if brack_d > 0 => brack_d -= 1,
            b']' => return Err(err_sp(*line, *col, "Unexpected ']' in Twig tag")),
            _ => {}
        }
        advance_one(ch, i, line, col);
    }
    Err(err_sp(sl, sc, "Unterminated Twig tag"))
}

fn skip_twig_string(
    src: &str,
    i: &mut usize,
    line: &mut usize,
    col: &mut usize,
    quote: u8,
) -> Result<(), ErrorSpan> {
    let b = src.as_bytes();
    let (sl, sc) = (*line, *col);
    advance_one(quote, i, line, col);
    while *i < b.len() {
        if b[*i] == b'\\' {
            advance_one(b[*i], i, line, col);
            if *i < b.len() {
                advance_one(b[*i], i, line, col);
            }
            continue;
        }
        if quote == b'"' && b[*i..].starts_with(b"#{") {
            let (interp_l, interp_c) = (*line, *col);
            advance_bytes(&b[*i..*i + 2], i, line, col);
            let (mut depth, mut paren_d, mut brack_d) = (1usize, 0usize, 0usize);
            while *i < b.len() && depth > 0 {
                if b[*i] == b'\'' || b[*i] == b'"' {
                    skip_twig_string(src, i, line, col, b[*i])?;
                    continue;
                }
                match b[*i] {
                    b'{' => depth += 1,
                    b'}' => depth -= 1,
                    b'(' => paren_d += 1,
                    b')' if paren_d > 0 => paren_d -= 1,
                    b')' => return Err(err_sp(*line, *col, "Unexpected ')' in Twig interpolation")),
                    b'[' => brack_d += 1,
                    b']' if brack_d > 0 => brack_d -= 1,
                    b']' => return Err(err_sp(*line, *col, "Unexpected ']' in Twig interpolation")),
                    _ => {}
                }
                advance_one(b[*i], i, line, col);
            }
            if depth != 0 || paren_d != 0 || brack_d != 0 {
                return Err(err_sp(interp_l, interp_c, "Unbalanced delimiter in Twig interpolation '#{'"));
            }
            if *i < b.len() && b[*i] == b'}' {
                return Err(err_sp(*line, *col, "Unexpected '}' after Twig interpolation '#{...}'"));
            }
            continue;
        }
        if b[*i] == quote {
            advance_one(quote, i, line, col);
            return Ok(());
        }
        advance_one(b[*i], i, line, col);
    }
    Err(err_sp(sl, sc, "Unterminated string literal in Twig tag"))
}

fn find_endverbatim(src: &str, start: usize) -> Option<usize> {
    let b = src.as_bytes();
    let mut pos = start + 2 + usize::from(b.get(start + 2) == Some(&b'-'));
    while pos < b.len() && b[pos].is_ascii_whitespace() {
        pos += 1;
    }
    if !b[pos..].starts_with(b"endverbatim") {
        return None;
    }
    pos += "endverbatim".len();
    if pos < b.len()
        && !b[pos].is_ascii_whitespace()
        && !b[pos..].starts_with(b"-%}")
        && !b[pos..].starts_with(b"%}")
    {
        return None;
    }
    while pos < b.len() && b[pos].is_ascii_whitespace() {
        pos += 1;
    }
    if b[pos..].starts_with(b"-%}") {
        Some(pos + 3)
    } else if b[pos..].starts_with(b"%}") {
        Some(pos + 2)
    } else {
        None
    }
}
fn split_keyword(inner: &str) -> (String, String) {
    let mut parts = inner.splitn(2, char::is_whitespace);
    let kw = parts.next().unwrap_or("").to_ascii_lowercase();
    let rest = parts.next().unwrap_or("").trim().to_string();
    (kw, rest)
}

fn advance_one(byte: u8, i: &mut usize, line: &mut usize, col: &mut usize) {
    if byte == b'\n' {
        *line += 1;
        *col = 1;
    } else {
        *col += 1;
    }
    *i += 1;
}

fn advance_bytes(bytes: &[u8], i: &mut usize, line: &mut usize, col: &mut usize) {
    for &byte in bytes {
        advance_one(byte, i, line, col);
    }
}

pub fn err_sp(line: usize, column: usize, message: impl Into<String>) -> ErrorSpan {
    ErrorSpan { line, column, end_line: line, message: message.into() }
}
