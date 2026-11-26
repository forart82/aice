use std::cmp::Reverse;
use std::collections::HashSet;

use aice_lang_registry::{DepEdge, DepKind, LanguageId, SymbolNode};

use crate::r5::cst_helpers::node_text;
use crate::r5::dep_extract::{extract_call_target, extract_type_ref, is_builtin_type};

pub fn collect_schema_comment_deps(src: &str, default_scope: &str, deps: &mut Vec<DepEdge>) {
    let mut seen: HashSet<String> = deps
        .iter()
        .filter(|d| d.kind == DepKind::SchemaRef)
        .map(|d| d.target.clone())
        .collect();
    for line in src.lines() {
        let t = line.trim();
        let comment = if let Some(rest) = t.strip_prefix("//") {
            rest
        } else if let Some(rest) = t.strip_prefix('#') {
            rest
        } else if let Some(rest) = t.strip_prefix("--") {
            rest
        } else if let Some(rest) = t.strip_prefix("/*") {
            rest.trim_end_matches("*/")
        } else {
            continue;
        };
        let low = comment.to_ascii_lowercase();
        let after_schema = if let Some(pos) = low.find("schema:") {
            Some(comment[pos + 7..].trim_start())
        } else if low.strip_prefix(":schema").is_some_and(|r| r.starts_with(char::is_whitespace)) {
            Some(comment[7..].trim_start())
        } else {
            None
        };
        if let Some(after) = after_schema {
            let tok = after
                .split(|c: char| c.is_whitespace() || matches!(c, '*' | ',' | ';'))
                .next()
                .unwrap_or("")
                .trim_matches(['"', '\'', '`']);
            if !tok.is_empty() && seen.insert(tok.to_string()) {
                deps.push(DepEdge {
                    source: default_scope.to_string(),
                    target: tok.to_string(),
                    kind: DepKind::SchemaRef,
                });
            }
        }
    }
}

pub fn augment_r5_deps(
    lang: LanguageId,
    root: tree_sitter::Node<'_>,
    src: &str,
    syms: &[SymbolNode],
    deps: &mut Vec<DepEdge>,
) {
    let default_scope = default_scope_for(lang);
    collect_schema_comment_deps(src, default_scope, deps);
    if !is_code_language(lang) {
        return;
    }

    let mut seen: HashSet<(String, String, u8)> = deps
        .iter()
        .map(|d| (d.source.clone(), d.target.clone(), dep_kind_tag(d.kind)))
        .collect();

    let mut sorted: Vec<usize> = (0..syms.len())
        .filter(|&i| syms[i].end_byte > syms[i].start_byte)
        .collect();
    sorted.sort_by_key(|&i| (syms[i].start_byte, Reverse(syms[i].end_byte)));

    let mut scope_stack: Vec<usize> = Vec::new();
    let mut cursor = 0usize;
    let mut stack: Vec<(tree_sitter::Node<'_>, Option<tree_sitter::Node<'_>>)> = vec![(root, None)];

    while let Some((node, parent)) = stack.pop() {
        let nb = node.start_byte();
        let ne = node.end_byte();
        while scope_stack.last().is_some_and(|&top| nb >= syms[top].end_byte) {
            scope_stack.pop();
        }
        while cursor < sorted.len() {
            let sym = &syms[sorted[cursor]];
            if sym.end_byte <= nb || (sym.start_byte < nb && ne > sym.end_byte) {
                cursor += 1;
            } else if sym.start_byte <= nb && ne <= sym.end_byte {
                scope_stack.push(sorted[cursor]);
                cursor += 1;
            } else {
                break;
            }
        }

        let scope = scope_stack
            .last()
            .map(|&i| syms[i].qualified_name.as_str())
            .unwrap_or(default_scope);

        if lang == LanguageId::Rust && node.kind() == "mod_item" && !has_decl_list(node) {
            if let Some(name_n) = node.child_by_field_name("name") {
                let name = node_text(name_n, src).trim();
                if !name.is_empty() {
                    push_unique(deps, &mut seen, default_scope, &format!("mod:{name}"), DepKind::Import);
                }
            }
        } else if let Some(ty) = extract_type_ref(lang, node, parent, src) {
            if ty != scope && !is_builtin_type(&ty) {
                push_unique(deps, &mut seen, scope, &ty, DepKind::TypeRef);
            }
        } else if let Some(callee) = extract_call_target(lang, node, src)
            && callee != scope
        {
            push_unique(deps, &mut seen, scope, &callee, DepKind::Call);
        }

        for i in (0..node.named_child_count()).rev() {
            if let Some(c) = node.named_child(i as u32) {
                stack.push((c, Some(node)));
            }
        }
    }
}

fn push_unique(
    deps: &mut Vec<DepEdge>,
    seen: &mut HashSet<(String, String, u8)>,
    source: &str,
    target: &str,
    kind: DepKind,
) {
    let tag = dep_kind_tag(kind);
    if seen.insert((source.to_string(), target.to_string(), tag)) {
        deps.push(DepEdge { source: source.to_string(), target: target.to_string(), kind });
    }
}

fn dep_kind_tag(kind: DepKind) -> u8 {
    match kind {
        DepKind::Import => 0,
        DepKind::TypeRef => 1,
        DepKind::Call => 2,
        DepKind::SchemaRef => 3,
    }
}

fn has_decl_list(node: tree_sitter::Node<'_>) -> bool {
    (0..node.named_child_count())
        .any(|i| node.named_child(i as u32).is_some_and(|c| c.kind() == "declaration_list"))
}

fn is_code_language(lang: LanguageId) -> bool {
    matches!(
        lang,
        LanguageId::Rust
            | LanguageId::TypeScript
            | LanguageId::Tsx
            | LanguageId::JavaScript
            | LanguageId::Python
            | LanguageId::Go
            | LanguageId::C
            | LanguageId::Cpp
            | LanguageId::CSharp
            | LanguageId::Java
            | LanguageId::Kotlin
            | LanguageId::Dart
            | LanguageId::Php
            | LanguageId::Ruby
    )
}

pub(crate) fn default_scope_for(lang: LanguageId) -> &'static str {
    match lang {
        LanguageId::Rust => "crate",
        LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript | LanguageId::Python => {
            "module"
        }
        LanguageId::Go => "package",
        LanguageId::C | LanguageId::Cpp => "translation_unit",
        LanguageId::CSharp => "assembly",
        LanguageId::Java => "class",
        LanguageId::Kotlin => "kotlin",
        LanguageId::Dart => "dart",
        LanguageId::Php => "php",
        LanguageId::Ruby => "ruby",
        LanguageId::Html => "html",
        LanguageId::Css => "stylesheet",
        LanguageId::Bash => "script",
        LanguageId::Markdown => "document",
        LanguageId::Twig => "template",
        _ => "file",
    }
}
