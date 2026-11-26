use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, named_children, node_text};
use crate::ir::{Trivia, TriviaComment, TriviaKind, Visibility};

pub(crate) fn normalize_single_line(raw: &str) -> String {
    raw.trim()
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn extract_ts_decorators(node: Node<'_>, src: &str) -> Vec<String> {
    let mut out = Vec::new();
    for ch in named_children(node) {
        if ch.kind() == "decorator" {
            let txt = normalize_single_line(node_text(ch, src));
            let clean = txt.trim_start_matches('@').trim().to_string();
            if !clean.is_empty() {
                out.push(clean);
            }
        }
    }
    out
}

pub(crate) fn format_ts_decorator_attr(node: Node<'_>, src: &str) -> String {
    let txt = normalize_single_line(node_text(node, src));
    if txt.starts_with('@') { txt } else { format!("@{txt}") }
}

pub(crate) fn push_attrs_to_trivia(tr: &mut Trivia, attrs: Vec<String>) {
    for text in attrs {
        if !text.is_empty() {
            tr.leading.push(TriviaComment { kind: TriviaKind::Attribute, text });
        }
    }
}

pub(crate) fn is_ts_readonly_prefix(node: Node<'_>, target_field: &str, src: &str) -> bool {
    let end = node
        .child_by_field_name(target_field)
        .or_else(|| node.child_by_field_name("name"))
        .or_else(|| node.child_by_field_name("pattern"))
        .or_else(|| node.child_by_field_name("property"))
        .or_else(|| node.child_by_field_name("type"))
        .map(|n| n.start_byte())
        .unwrap_or(node.end_byte());
    let hdr = src.get(node.start_byte()..end).unwrap_or("");
    hdr.split_whitespace().any(|w| w == "readonly")
}

pub(crate) fn is_ts_prop_optional(node: Node<'_>, src: &str) -> bool {
    let start = node
        .child_by_field_name("name")
        .map(|n| n.end_byte())
        .unwrap_or(node.start_byte());
    let end = node
        .child_by_field_name("type")
        .map(|n| n.start_byte())
        .unwrap_or(node.end_byte());
    src.get(start..end).is_some_and(|s| s.contains('?'))
}

pub(crate) fn extract_ts_param_vis(node: Node<'_>, src: &str) -> Visibility {
    if let Some(am) = child_by_kind(node, "accessibility_modifier") {
        return match node_text(am, src).trim() {
            "public" => Visibility::Public,
            "private" => Visibility::Private,
            "protected" => Visibility::Protected,
            _ => Visibility::Default,
        };
    }
    let end = node
        .child_by_field_name("pattern")
        .or_else(|| node.child_by_field_name("name"))
        .map(|n| n.start_byte())
        .unwrap_or(node.start_byte());
    let hdr = src.get(node.start_byte()..end).unwrap_or("");
    if hdr.split_whitespace().any(|w| w == "private") { Visibility::Private }
    else if hdr.split_whitespace().any(|w| w == "protected") { Visibility::Protected }
    else if hdr.split_whitespace().any(|w| w == "public") { Visibility::Public }
    else { Visibility::Default }
}

pub(crate) fn extract_ts_class_heritage(node: Node<'_>, src: &str) -> (Option<String>, Vec<String>) {
    let Some(her) = child_by_kind(node, "class_heritage") else {
        return (None, Vec::new());
    };
    let mut extends = None;
    let mut implements = Vec::new();
    for ch in named_children(her) {
        if ch.kind() == "extends_clause" {
            let raw = node_text(ch, src).trim();
            let val = raw.strip_prefix("extends").unwrap_or(raw).trim();
            if !val.is_empty() {
                extends = Some(val.to_string());
            }
        } else if ch.kind() == "implements_clause" {
            let raw = node_text(ch, src).trim();
            let body = raw.strip_prefix("implements").unwrap_or(raw).trim();
            for part in body.split(',') {
                let p = part.trim();
                if !p.is_empty() {
                    implements.push(p.to_string());
                }
            }
        }
    }
    (extends, implements)
}
