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

pub(crate) fn scan_gap(src: &str, start: usize, end: usize) -> Vec<GapToken<'_>> {
    let mut out = Vec::new();
    let end = end.min(src.len());
    let Some(slice) = src.get(start..end) else { return out; };
    let b = slice.as_bytes();
    let mut i = 0usize;
    let mut text_start = 0usize;

    while i < b.len() {
        if b[i] == b'<' && slice[i..].starts_with("<!--") {
            push_text(slice, text_start, i, &mut out);
            let (inner_end, close) = match slice[i + 4..].find("-->") {
                Some(o) => (i + 4 + o, i + 4 + o + 3),
                None => (b.len(), b.len()),
            };
            let inner = slice[i + 4..inner_end].trim().to_string();
            out.push(GapToken::Comment(inner));
            i = close;
            text_start = i;
            continue;
        }
        if b[i] == b'{' && slice[i..].starts_with("{%") {
            push_text(slice, text_start, i, &mut out);
            let (inner_end, close) = match slice[i + 2..].find("%}") {
                Some(o) => (i + 2 + o, i + 2 + o + 2),
                None => (b.len(), b.len()),
            };
            let tag_body = slice[i + 2..inner_end].trim_matches(|c: char| c == '-' || c.is_whitespace());
            if let Some(cond) = tag_body.strip_prefix("elseif ") {
                out.push(GapToken::ElseIf(cond.trim().to_string()));
            } else if tag_body == "else" {
                out.push(GapToken::Else);
            }
            i = close;
            text_start = i;
            continue;
        }
        if b[i] == b'<' && i + 1 < b.len() && (b[i + 1] == b'/' || b[i + 1].is_ascii_alphabetic()) {
            push_text(slice, text_start, i, &mut out);
            let gt = find_tag_gt(slice, i + 1);
            let inner = slice[i + 1..gt].trim();
            if inner.starts_with('/') {
                out.push(GapToken::CloseTag);
            } else {
                let self_close = inner.ends_with('/');
                let clean = inner.trim_end_matches('/').trim();
                let (tag, attrs) = parse_tag_and_attrs(clean);
                let is_void = self_close || VOID_TAGS.contains(&tag.as_str());
                out.push(GapToken::OpenTag { tag, attrs, self_close: is_void });
            }
            i = (gt + 1).min(b.len());
            text_start = i;
            continue;
        }
        i += slice[i..].chars().next().map(char::len_utf8).unwrap_or(1);
    }
    push_text(slice, text_start, b.len(), &mut out);
    out
}

fn push_text<'a>(slice: &'a str, s: usize, e: usize, out: &mut Vec<GapToken<'a>>) {
    if s < e {
        let t = slice[s..e].trim();
        if !t.is_empty() { out.push(GapToken::Text(t)); }
    }
}

fn find_tag_gt(s: &str, mut i: usize) -> usize {
    let b = s.as_bytes();
    let mut quote: Option<u8> = None;
    while i < b.len() {
        if let Some(q) = quote {
            if b[i] == q { quote = None; }
        } else if b[i] == b'"' || b[i] == b'\'' {
            quote = Some(b[i]);
        } else if b[i] == b'>' {
            return i;
        }
        i += 1;
    }
    b.len()
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
        while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'=' { i += 1; }
        let name = rest[ns..i].to_string();
        while i < b.len() && b[i].is_ascii_whitespace() { i += 1; }
        let mut value = None;
        if i < b.len() && b[i] == b'=' {
            i += 1;
            while i < b.len() && b[i].is_ascii_whitespace() { i += 1; }
            if i < b.len() && (b[i] == b'"' || b[i] == b'\'') {
                let q = b[i]; i += 1;
                let vs = i;
                while i < b.len() && b[i] != q { i += 1; }
                value = Some(Expr::Literal(LiteralVal::Str { value: rest[vs..i].to_string(), multiline: false }));
                if i < b.len() { i += 1; }
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
