use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::ir::{AiceModule, Span, TranspileError};
use crate::ir_types::{AiceType, PrimitiveType};

pub(crate) fn with_ts_root(
    tree: &ParsedTree,
    f: impl FnOnce(Node<'_>) -> Result<AiceModule, TranspileError>,
) -> Result<AiceModule, TranspileError> {
    match tree {
        ParsedTree::TreeSitter { tree: mtx, .. } => {
            let guard = mtx
                .lock()
                .map_err(|_| TranspileError::new("Failed to lock tree-sitter Tree mutex"))?;
            f(guard.root_node())
        }
        _ => Err(TranspileError::new("Expected TreeSitter ParsedTree")),
    }
}

pub(crate) fn node_text<'a>(n: Node<'a>, src: &'a str) -> &'a str {
    n.utf8_text(src.as_bytes()).unwrap_or("")
}

pub(crate) fn field_text<'a>(n: Node<'a>, field: &str, src: &'a str) -> Option<&'a str> {
    n.child_by_field_name(field).map(|c| node_text(c, src))
}

pub(crate) fn child_by_kind<'a>(n: Node<'a>, kind: &str) -> Option<Node<'a>> {
    let mut cur = n.walk();
    n.children(&mut cur).find(|c| c.kind() == kind)
}

pub(crate) fn named_children(n: Node<'_>) -> Vec<Node<'_>> {
    let mut cur = n.walk();
    n.named_children(&mut cur).collect()
}

pub(crate) fn node_span(n: Node<'_>) -> Span {
    let sp = n.start_position();
    Span::new(sp.row + 1, sp.column + 1, n.start_byte(), n.end_byte())
}

pub(crate) fn strip_quotes(s: &str) -> String {
    crate::decompile::expr_lit::strip_quotes_lit(s)
}

pub(crate) fn map_type_str(raw: &str, lang: LanguageId) -> AiceType {
    enum TTask<'a> {
        Parse(&'a str),
        Arr,
        Opt,
        Named(Vec<String>, usize),
    }
    let mut tasks = vec![TTask::Parse(raw)];
    let mut out: Vec<AiceType> = Vec::new();
    while let Some(t) = tasks.pop() {
        match t {
            TTask::Arr => {
                let inner = out.pop().expect("arr ty");
                out.push(AiceType::Array(Box::new(inner)));
            }
            TTask::Opt => {
                let inner = out.pop().expect("opt ty");
                out.push(AiceType::Option(Box::new(inner)));
            }
            TTask::Named(path, len) => {
                let args = out.split_off(out.len() - len);
                out.push(AiceType::Named { path, args });
            }
            TTask::Parse(r) => {
                let s = r.trim().trim_start_matches(':').trim();
                if s.is_empty() {
                    out.push(AiceType::Primitive(PrimitiveType::Any));
                } else if let Some(inner) = s.strip_suffix("[]") {
                    tasks.push(TTask::Arr);
                    tasks.push(TTask::Parse(inner));
                } else if let Some(inner) = s.strip_suffix('?') {
                    tasks.push(TTask::Opt);
                    tasks.push(TTask::Parse(inner));
                } else {
                    match (s, lang) {
                        ("number", LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript) => {
                            out.push(AiceType::Primitive(PrimitiveType::Num));
                        }
                        ("string", LanguageId::TypeScript | LanguageId::Tsx | LanguageId::CSharp | LanguageId::Php | LanguageId::Go)
                        | ("str", LanguageId::Python)
                        | ("String", LanguageId::Rust | LanguageId::Java | LanguageId::Kotlin | LanguageId::Dart)
                        | ("std::string", LanguageId::Cpp) => out.push(AiceType::Primitive(PrimitiveType::Str)),
                        ("int", LanguageId::Python | LanguageId::Go | LanguageId::C | LanguageId::Cpp | LanguageId::CSharp | LanguageId::Java | LanguageId::Dart | LanguageId::Php)
                        | ("Int", LanguageId::Kotlin) => out.push(AiceType::Primitive(PrimitiveType::Int)),
                        ("float", LanguageId::Python | LanguageId::Php)
                        | ("f64", LanguageId::Rust)
                        | ("float64", LanguageId::Go)
                        | ("double", LanguageId::C | LanguageId::Cpp | LanguageId::CSharp | LanguageId::Java | LanguageId::Dart)
                        | ("Double", LanguageId::Kotlin) => out.push(AiceType::Primitive(PrimitiveType::Float)),
                        ("bool", LanguageId::Python | LanguageId::Rust | LanguageId::Go | LanguageId::C | LanguageId::Cpp | LanguageId::CSharp | LanguageId::Dart | LanguageId::Php)
                        | ("boolean", LanguageId::TypeScript | LanguageId::Tsx | LanguageId::Java)
                        | ("Boolean", LanguageId::Kotlin) => out.push(AiceType::Primitive(PrimitiveType::Bool)),
                        ("void", _) | ("None", LanguageId::Python) | ("Unit", LanguageId::Kotlin) | ("()", LanguageId::Rust) => {
                            out.push(AiceType::Primitive(PrimitiveType::Void));
                        }
                        ("any", _) | ("Any", _) | ("mixed", LanguageId::Php) | ("dynamic", LanguageId::Dart) | ("object", LanguageId::CSharp) => {
                            out.push(AiceType::Primitive(PrimitiveType::Any));
                        }
                        _ => {
                            if let Some(lt) = s.find('<') && s.ends_with('>') {
                                let base = s[..lt].trim();
                                let inner = &s[lt + 1..s.len() - 1];
                                if !base.is_empty() && base.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == ':' || c == '.') {
                                    let path = base.split([':', '.']).filter(|p| !p.is_empty()).map(str::to_string).collect();
                                    let parts = split_top_level_commas(inner);
                                    tasks.push(TTask::Named(path, parts.len()));
                                    for a in parts.into_iter().rev() { tasks.push(TTask::Parse(a)); }
                                    continue;
                                }
                            }
                            if s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == ':') && !s.contains(":::") {
                                let path = s.split("::").filter(|p| !p.is_empty()).map(str::to_string).collect();
                                out.push(AiceType::Named { path, args: Vec::new() });
                            } else {
                                out.push(AiceType::Raw(s.to_string()));
                            }
                        }
                    }
                }
            }
        }
    }
    out.pop().unwrap_or(AiceType::Primitive(PrimitiveType::Any))
}

fn split_top_level_commas(s: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let (mut depth, mut start) = (0usize, 0usize);
    for (i, ch) in s.char_indices() {
        match ch {
            '<' | '(' | '[' | '{' => depth += 1,
            '>' | ')' | ']' | '}' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => {
                let part = s[start..i].trim();
                if !part.is_empty() { out.push(part); }
                start = i + 1;
            }
            _ => {}
        }
    }
    let tail = s[start..].trim();
    if !tail.is_empty() { out.push(tail); }
    out
}
