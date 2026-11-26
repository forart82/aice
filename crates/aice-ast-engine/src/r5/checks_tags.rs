use crate::r5::checks::ErrorSpan;

pub fn check_html(src: &str) -> Vec<ErrorSpan> {
    scan_markup_tags(src, false, true)
}

pub fn check_xml(src: &str) -> Vec<ErrorSpan> {
    scan_markup_tags(src, true, true)
}

pub fn check_unclosed_rawtext_tags(src: &str) -> Vec<ErrorSpan> {
    scan_markup_tags(src, false, false)
}

pub(crate) fn is_html_void(lower: &str) -> bool {
    matches!(
        lower,
        "area"
            | "base"
            | "br"
            | "col"
            | "embed"
            | "hr"
            | "img"
            | "input"
            | "link"
            | "meta"
            | "param"
            | "source"
            | "track"
            | "wbr"
    )
}

struct OpenTag {
    name: String,
    line: usize,
    col: usize,
}

fn scan_markup_tags(src: &str, is_xml: bool, check_balance: bool) -> Vec<ErrorSpan> {
    let b = src.as_bytes();
    let mut errors = Vec::new();
    let mut stack: Vec<OpenTag> = Vec::new();
    let mut i = 0;
    let mut line = 1usize;
    let mut col = 1usize;

    while i < b.len() {
        if b[i] != b'<' {
            advance_pos(b[i], &mut line, &mut col);
            i += 1;
            continue;
        }
        let (open_line, open_col) = (line, col);
        if src[i..].starts_with("<!--") {
            match src[i + 4..].find("-->") {
                Some(rel) => advance_slice(&b[i..i + 4 + rel + 3], &mut i, &mut line, &mut col),
                None => {
                    errors.push(err_at(open_line, open_col, "Unterminated comment '<!--'"));
                    break;
                }
            }
            continue;
        }
        if src[i..].starts_with("<![CDATA[") {
            match src[i + 9..].find("]]>") {
                Some(rel) => advance_slice(&b[i..i + 9 + rel + 3], &mut i, &mut line, &mut col),
                None => {
                    errors.push(err_at(open_line, open_col, "Unterminated CDATA section"));
                    break;
                }
            }
            continue;
        }
        if src[i..].starts_with("<?") {
            let close = if is_xml { "?>" } else { ">" };
            match src[i + 2..].find(close) {
                Some(rel) => {
                    advance_slice(&b[i..i + 2 + rel + close.len()], &mut i, &mut line, &mut col)
                }
                None => {
                    errors.push(err_at(open_line, open_col, "Unterminated processing instruction"));
                    break;
                }
            }
            continue;
        }
        if src[i..].starts_with("<!") {
            match find_tag_end(b, i + 2) {
                Some(end) => advance_slice(&b[i..=end], &mut i, &mut line, &mut col),
                None => {
                    errors.push(err_at(open_line, open_col, "Unterminated declaration tag"));
                    break;
                }
            }
            continue;
        }
        if src[i..].starts_with("</") {
            let name_start = i + 2;
            let name_end = scan_tag_name(b, name_start);
            if name_end == name_start {
                advance_pos(b[i], &mut line, &mut col);
                i += 1;
                continue;
            }
            let raw_name = &src[name_start..name_end];
            let norm = if is_xml {
                raw_name.to_string()
            } else {
                raw_name.to_ascii_lowercase()
            };
            match find_tag_end(b, name_end) {
                Some(end) => advance_slice(&b[i..=end], &mut i, &mut line, &mut col),
                None => {
                    errors.push(err_at(
                        open_line,
                        open_col,
                        format!("Unclosed closing tag '</{raw_name}>'"),
                    ));
                    break;
                }
            }
            if check_balance {
                pop_matching_tag(&mut stack, &norm, raw_name, open_line, open_col, &mut errors);
            }
            continue;
        }
        let name_start = i + 1;
        let name_end = scan_tag_name(b, name_start);
        if name_end == name_start {
            advance_pos(b[i], &mut line, &mut col);
            i += 1;
            continue;
        }
        let raw_name = &src[name_start..name_end];
        let norm = if is_xml {
            raw_name.to_string()
        } else {
            raw_name.to_ascii_lowercase()
        };
        let Some(end) = find_tag_end(b, name_end) else {
            errors.push(err_at(
                open_line,
                open_col,
                format!("Unclosed start tag '<{raw_name}>'"),
            ));
            break;
        };
        let self_closing = src[name_end..end].trim_end().ends_with('/');
        advance_slice(&b[i..=end], &mut i, &mut line, &mut col);

        if !is_xml
            && !self_closing
            && matches!(norm.as_str(), "script" | "style" | "textarea" | "title")
        {
            if let Some(end_rel) = find_rawtext_close(&src[i..], &norm) {
                advance_slice(&b[i..i + end_rel], &mut i, &mut line, &mut col);
            } else {
                errors.push(err_at(
                    open_line,
                    open_col,
                    format!("Unclosed <{norm}> element"),
                ));
            }
            continue;
        }
        if check_balance && !self_closing && (is_xml || !is_html_void(&norm)) {
            stack.push(OpenTag {
                name: norm,
                line: open_line,
                col: open_col,
            });
        }
    }

    if check_balance {
        for unclosed in stack.into_iter().rev() {
            errors.push(err_at(
                unclosed.line,
                unclosed.col,
                format!("Unclosed tag '<{}>'", unclosed.name),
            ));
        }
    }
    errors
}

fn pop_matching_tag(
    stack: &mut Vec<OpenTag>,
    norm: &str,
    raw_name: &str,
    open_line: usize,
    open_col: usize,
    errors: &mut Vec<ErrorSpan>,
) {
    if let Some(pos) = stack.iter().rposition(|t| t.name == norm) {
        while stack.len() > pos + 1 {
            let unclosed = stack.pop().expect("non-empty");
            errors.push(err_at(
                unclosed.line,
                unclosed.col,
                format!("Unclosed tag '<{}>' before '</{raw_name}>'", unclosed.name),
            ));
        }
        stack.pop();
    } else {
        errors.push(err_at(
            open_line,
            open_col,
            format!("Unexpected closing tag '</{raw_name}>'"),
        ));
    }
}

pub(crate) fn scan_tag_name(b: &[u8], start: usize) -> usize {
    let mut j = start;
    while j < b.len() && (b[j].is_ascii_alphanumeric() || matches!(b[j], b'-' | b'_' | b':')) {
        j += 1;
    }
    j
}

pub(crate) fn find_tag_end(b: &[u8], mut i: usize) -> Option<usize> {
    let mut quote: Option<u8> = None;
    while i < b.len() {
        if let Some(q) = quote {
            if b[i] == q {
                quote = None;
            }
        } else if b[i] == b'"' || b[i] == b'\'' {
            quote = Some(b[i]);
        } else if b[i] == b'>' {
            return Some(i);
        }
        i += 1;
    }
    None
}
pub(crate) fn find_rawtext_close(haystack: &str, name: &str) -> Option<usize> {
    let hb = haystack.as_bytes();
    let prefix = format!("</{name}");
    let pb = prefix.as_bytes();
    if hb.len() <= pb.len() {
        return None;
    }
    let mut pos = 0;
    while let Some(rel) = hb[pos..].windows(pb.len()).position(|w| w.eq_ignore_ascii_case(pb)) {
        let mut end = pos + rel + pb.len();
        while end < hb.len() && hb[end].is_ascii_whitespace() {
            end += 1;
        }
        if end < hb.len() && hb[end] == b'>' {
            return Some(end + 1);
        }
        pos = pos + rel + 1;
    }
    None
}
fn advance_pos(byte: u8, line: &mut usize, col: &mut usize) {
    if byte == b'\n' {
        *line += 1;
        *col = 1;
    } else {
        *col += 1;
    }
}

fn advance_slice(slice: &[u8], i: &mut usize, line: &mut usize, col: &mut usize) {
    for &byte in slice {
        advance_pos(byte, line, col);
    }
    *i += slice.len();
}

fn err_at(line: usize, column: usize, message: impl Into<String>) -> ErrorSpan {
    ErrorSpan {
        line,
        column,
        end_line: line,
        message: message.into(),
    }
}
