use crate::ir::Trivia;
use crate::ir_code::{Expr, LiteralVal};
use crate::ir_domain::{LayoutAttr, LayoutNode};

const VOID_TAGS: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
];

pub(crate) struct ElemBuilder {
    pub tag: String,
    pub attrs: Vec<LayoutAttr>,
    pub children: Vec<LayoutNode>,
    pub text_buf: String,
}

pub(crate) enum GapToken<'a> {
    ElseIf(String),
    Else,
    Comment(String),
    OpenTag { tag: String, attrs: Vec<LayoutAttr>, self_close: bool },
    CloseTag,
    Text(&'a str),
}

pub(crate) fn scan_gap(src: &str, start: usize, end: usize, limit: usize) -> (Vec<GapToken<'_>>, usize) {
    let mut out = Vec::new();
    let end = end.min(src.len());
    let limit = limit.min(src.len()).max(end);
    let Some(full) = src.get(start..limit) else { return (out, end); };
    let gap_len = end.saturating_sub(start);
    let b = full.as_bytes();
    let mut i = 0usize;
    let mut text_start = 0usize;

    while i < gap_len {
        if b[i] == b'<' && full[i..].starts_with("<!--") {
            push_text(full, text_start, i, &mut out);
            let (inner_end, close) = match full[i + 4..gap_len].find("-->") {
                Some(o) => (i + 4 + o, i + 4 + o + 3),
                None => (gap_len, gap_len),
            };
            let inner = full[i + 4..inner_end].trim().to_string();
            out.push(GapToken::Comment(inner));
            i = close;
            text_start = i;
            continue;
        }
        if b[i] == b'{' && full[i..].starts_with("{%") {
            push_text(full, text_start, i, &mut out);
            let (inner_end, close) = match full[i + 2..gap_len].find("%}") {
                Some(o) => (i + 2 + o, i + 2 + o + 2),
                None => (gap_len, gap_len),
            };
            let tag_body = full[i + 2..inner_end].trim_matches(|c: char| c == '-' || c.is_whitespace());
            if let Some(cond) = tag_body.strip_prefix("elseif ") {
                out.push(GapToken::ElseIf(cond.trim().to_string()));
            } else if tag_body == "else" {
                out.push(GapToken::Else);
            }
            i = close;
            text_start = i;
            continue;
        }
        if b[i] == b'<' && i + 1 < gap_len && (b[i + 1] == b'/' || b[i + 1].is_ascii_alphabetic()) {
            push_text(full, text_start, i, &mut out);
            let gt_opt = find_tag_gt(full, i + 1);
            let gt = gt_opt.unwrap_or(gap_len);
            let inner = full[i + 1..gt].trim();
            if inner.starts_with('/') {
                out.push(GapToken::CloseTag);
            } else {
                let self_close = inner.ends_with('/');
                let clean = inner.trim_end_matches('/').trim();
                let (tag, attrs) = parse_tag_and_attrs(clean);
                let is_void = self_close || VOID_TAGS.contains(&tag.as_str());
                out.push(GapToken::OpenTag { tag, attrs, self_close: is_void });
            }
            i = gt_opt.map(|p| p + 1).unwrap_or(gap_len);
            text_start = i;
            continue;
        }
        i += full[i..].chars().next().map(char::len_utf8).unwrap_or(1);
    }
    if text_start < gap_len {
        push_text(full, text_start, gap_len, &mut out);
    }
    (out, start + i.max(gap_len))
}

fn push_text<'a>(slice: &'a str, s: usize, e: usize, out: &mut Vec<GapToken<'a>>) {
    if s < e {
        let t = slice[s..e].trim();
        if !t.is_empty() { out.push(GapToken::Text(t)); }
    }
}

fn skip_twig_delim(s: &str, i: usize) -> Option<usize> {
    let rest = s.get(i..)?;
    let close = if rest.starts_with("{{") { "}}" }
        else if rest.starts_with("{%") { "%}" }
        else if rest.starts_with("{#") { "#}" }
        else { return None; };
    if close == "#}" {
        return rest[2..].find("#}").map(|o| i + 2 + o + 2);
    }
    let b = rest.as_bytes();
    let mut j = 2usize;
    let mut q: Option<u8> = None;
    while j < b.len() {
        if let Some(qc) = q {
            if b[j] == b'\\' && j + 1 < b.len() { j += 2; continue; }
            if b[j] == qc { q = None; }
            j += 1;
            continue;
        }
        if b[j] == b'"' || b[j] == b'\'' { q = Some(b[j]); j += 1; continue; }
        if rest[j..].starts_with(close) { return Some(i + j + 2); }
        j += 1;
    }
    None
}

fn find_tag_gt(s: &str, mut i: usize) -> Option<usize> {
    let b = s.as_bytes();
    let mut quote: Option<u8> = None;
    while i < b.len() {
        if let Some(next) = skip_twig_delim(s, i) {
            i = next;
            continue;
        }
        if let Some(q) = quote {
            if b[i] == q { quote = None; }
        } else if b[i] == b'"' || b[i] == b'\'' {
            quote = Some(b[i]);
        } else if b[i] == b'<' {
            return None;
        } else if b[i] == b'>' {
            return Some(i);
        }
        i += 1;
    }
    None
}

fn parse_tag_and_attrs(s: &str) -> (String, Vec<LayoutAttr>) {
    let mut parts = s.splitn(2, char::is_whitespace);
    let tag = parts.next().unwrap_or("div").to_string();
    let mut attrs = Vec::new();
    let rest = parts.next().unwrap_or("").trim();
    let b = rest.as_bytes();
    let mut i = 0usize;
    while i < b.len() {
        while i < b.len() && b[i].is_ascii_whitespace() { i += 1; }
        if i >= b.len() { break; }
        let ns = i;
        while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'=' {
            if let Some(next) = skip_twig_delim(rest, i) { i = next; continue; }
            i += 1;
        }
        let name = rest[ns..i].to_string();
        while i < b.len() && b[i].is_ascii_whitespace() { i += 1; }
        let mut value = None;
        if i < b.len() && b[i] == b'=' {
            i += 1;
            while i < b.len() && b[i].is_ascii_whitespace() { i += 1; }
            if i < b.len() && (b[i] == b'"' || b[i] == b'\'') {
                let q = b[i]; i += 1;
                let vs = i;
                while i < b.len() && b[i] != q {
                    if let Some(next) = skip_twig_delim(rest, i) { i = next; continue; }
                    i += 1;
                }
                value = Some(Expr::Literal(LiteralVal::Str { value: rest[vs..i].to_string(), multiline: false }));
                if i < b.len() { i += 1; }
            } else if i < b.len() {
                let vs = i;
                while i < b.len() && !b[i].is_ascii_whitespace() {
                    if let Some(next) = skip_twig_delim(rest, i) { i = next; continue; }
                    i += 1;
                }
                value = Some(Expr::Literal(LiteralVal::Str { value: rest[vs..i].to_string(), multiline: false }));
            }
        }
        if !name.is_empty() { attrs.push(LayoutAttr { name, value }); }
    }
    (tag, attrs)
}

pub(crate) fn flush_elem_to_parent(elem: ElemBuilder, stack: &mut [ElemBuilder], target: &mut Vec<LayoutNode>) {
    let txt = elem.text_buf.trim().to_string();
    let node = LayoutNode::Element {
        tag: elem.tag,
        attrs: elem.attrs,
        text: if !txt.is_empty() && elem.children.is_empty() { Some(txt) } else { None },
        child_expr: None,
        children: elem.children,
        trivia: Trivia::default(),
    };
    if let Some(parent) = stack.last_mut() { parent.children.push(node); }
    else { target.push(node); }
}
