use std::collections::HashSet;

use aice_lang_registry::{DepEdge, DepKind, ParsedTree, RdNode, SymbolKind, SymbolNode};

use crate::r5::cst_helpers::{node_text, push_sym, with_ts_root};
use crate::r6::sql_lex::LineIndex;
pub(crate) use crate::r6::sql_dep_scan::extract_sql_token_schema_deps;

pub fn extract_sequel_symbols(tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
    with_ts_root(tree, Vec::new(), |root| {
        let mut out = Vec::new();
        let mut stack = vec![root];
        while let Some(node) = stack.pop() {
            match node.kind() {
                "create_table" => push_sql_obj(&mut out, node, SymbolKind::Table, src),
                "create_view" | "create_materialized_view" => {
                    push_sql_obj(&mut out, node, SymbolKind::View, src);
                }
                "create_function" => push_sql_obj(&mut out, node, SymbolKind::Function, src),
                "create_procedure" => push_sql_obj(&mut out, node, SymbolKind::Procedure, src),
                "create_trigger" => push_sql_obj(&mut out, node, SymbolKind::Trigger, src),
                "create_index" => push_sql_obj(&mut out, node, SymbolKind::Block, src),
                "create_type" => {
                    let kind = if has_child_kind(node, "enum_elements") {
                        SymbolKind::Enum
                    } else {
                        SymbolKind::Struct
                    };
                    push_sql_obj(&mut out, node, kind, src);
                }
                "cte" => {
                    if let Some((short, qname)) = find_sql_name(node, src) {
                        push_sym(&mut out, short, qname, SymbolKind::Query, node, src);
                    }
                }
                _ => {}
            }
            for i in (0..node.named_child_count()).rev() {
                if let Some(c) = node.named_child(i as u32) {
                    stack.push(c);
                }
            }
        }
        out
    })
}

pub fn extract_sequel_deps(tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
    with_ts_root(tree, Vec::new(), |root| {
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        let mut stack: Vec<(tree_sitter::Node<'_>, String)> = vec![(root, "file".to_string())];
        while let Some((node, scope)) = stack.pop() {
            let cur_scope = match node.kind() {
                "create_table" | "create_view" | "create_materialized_view"
                | "create_function" | "create_procedure" | "create_trigger" | "cte" => {
                    find_sql_name(node, src).map_or_else(|| scope.clone(), |(_, q)| q)
                }
                _ => scope.clone(),
            };
            if matches!(
                node.kind(),
                "from" | "join" | "relation" | "constraint" | "create_trigger"
                    | "insert" | "alter_table" | "create_index"
            ) || (node.kind() == "statement" && has_child_kind(node, "keyword_merge"))
            {
                collect_ref_targets(node, &cur_scope, src, &mut out, &mut seen);
            } else if matches!(node.kind(), "column_definition" | "ERROR") {
                collect_references_targets(node, &cur_scope, src, &mut out, &mut seen);
            }
            for i in (0..node.named_child_count()).rev() {
                if let Some(c) = node.named_child(i as u32) {
                    stack.push((c, cur_scope.clone()));
                }
            }
        }
        out
    })
}

fn collect_references_targets(
    node: tree_sitter::Node<'_>,
    scope: &str,
    src: &str,
    out: &mut Vec<DepEdge>,
    seen: &mut HashSet<(String, String)>,
) {
    for i in 0..node.named_child_count() {
        let Some(c) = node.named_child(i as u32) else { continue; };
        if c.kind() == "keyword_references"
            && let Some(next) = node.named_child((i + 1) as u32)
            && next.kind() == "object_reference"
        {
            let target = clean_ident(node_text(next, src));
            if !target.is_empty() && target != scope && seen.insert((scope.to_string(), target.clone())) {
                out.push(DepEdge { source: scope.to_string(), target, kind: DepKind::SchemaRef });
            }
        }
    }
}

fn collect_ref_targets(
    node: tree_sitter::Node<'_>,
    scope: &str,
    src: &str,
    out: &mut Vec<DepEdge>,
    seen: &mut HashSet<(String, String)>,
) {
    for i in 0..node.named_child_count() {
        let Some(c) = node.named_child(i as u32) else { continue; };
        if c.kind() == "object_reference" {
            let target = clean_ident(node_text(c, src));
            if !target.is_empty() && target != scope && seen.insert((scope.to_string(), target.clone())) {
                out.push(DepEdge {
                    source: scope.to_string(),
                    target,
                    kind: DepKind::SchemaRef,
                });
            }
        }
    }
}

fn push_sql_obj(
    out: &mut Vec<SymbolNode>,
    node: tree_sitter::Node<'_>,
    kind: SymbolKind,
    src: &str,
) {
    if let Some((short, qname)) = find_sql_name(node, src) {
        push_sym(out, short, qname, kind, node, src);
    }
}

fn has_child_kind(node: tree_sitter::Node<'_>, kind: &str) -> bool {
    (0..node.named_child_count()).any(|i| node.named_child(i as u32).is_some_and(|c| c.kind() == kind))
}

pub fn find_sql_name(node: tree_sitter::Node<'_>, src: &str) -> Option<(String, String)> {
    for i in 0..node.named_child_count() {
        let c = node.named_child(i as u32)?;
        if c.kind() == "object_reference" {
            let q = clean_ident(node_text(c, src));
            let short = q.rsplit('.').next().unwrap_or(&q).to_string();
            if !short.is_empty() { return Some((short, q)); }
        } else if c.kind() == "identifier" {
            let s = clean_ident(node_text(c, src));
            if !s.is_empty() { return Some((s.clone(), s)); }
        }
    }
    None
}

fn clean_ident(raw: &str) -> String {
    raw.trim()
        .split('.')
        .map(|p| {
            let p = p.trim();
            if p.len() >= 2 && ((p.starts_with('"') && p.ends_with('"'))
                || (p.starts_with('`') && p.ends_with('`'))
                || (p.starts_with('[') && p.ends_with(']')))
            {
                p[1..p.len() - 1].trim().to_string()
            } else {
                p.to_string()
            }
        })
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join(".")
}

pub fn extract_rd_symbols(root: &RdNode, src: &str) -> Vec<SymbolNode> {
    let mut out = Vec::new();
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        if let Some(kind) = map_rd_kind(&node.kind)
            && let Some(label) = &node.label
            && !label.trim().is_empty()
        {
            let qname = label.trim().to_string();
            let short = qname.rsplit(['.', ':']).next().unwrap_or(&qname).to_string();
            let sig = slice_safe_sig(src, node.start_byte, node.end_byte);
            out.push(SymbolNode {
                name: short,
                qualified_name: qname,
                kind,
                start_line: node.start_line,
                end_line: node.end_line,
                start_byte: node.start_byte,
                end_byte: node.end_byte,
                signature: sig,
            });
        }
        stack.extend(node.children.iter().rev());
    }
    out
}

pub fn extract_rd_deps(root: &RdNode) -> Vec<DepEdge> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        if node.kind == "dep_ref"
            && let Some(lbl) = &node.label
            && let Some((src_s, tgt)) = lbl.split_once("->")
            && seen.insert((src_s.to_string(), tgt.to_string()))
        {
            out.push(DepEdge {
                source: src_s.to_string(),
                target: tgt.to_string(),
                kind: DepKind::SchemaRef,
            });
        }
        stack.extend(node.children.iter().rev());
    }
    out
}

fn map_rd_kind(kind: &str) -> Option<SymbolKind> {
    match kind {
        "table" => Some(SymbolKind::Table),
        "view" => Some(SymbolKind::View),
        "function" => Some(SymbolKind::Function),
        "procedure" => Some(SymbolKind::Procedure),
        "trigger" => Some(SymbolKind::Trigger),
        "cte" | "query" => Some(SymbolKind::Query),
        "section" => Some(SymbolKind::Section),
        "block" | "index" | "event" => Some(SymbolKind::Block),
        "enum" => Some(SymbolKind::Enum),
        "struct" | "model" | "type" => Some(SymbolKind::Struct),
        "interface" => Some(SymbolKind::Interface),
        "constant" => Some(SymbolKind::Constant),
        _ => None,
    }
}

fn slice_safe_sig(src: &str, start: usize, end: usize) -> Option<String> {
    let s = src.get(start..end)?;
    let line = s.lines().next()?.trim();
    if line.is_empty() {
        None
    } else if line.chars().count() > 120 {
        Some(line.chars().take(120).collect())
    } else {
        Some(line.to_string())
    }
}

pub fn make_rd_node(
    kind: &str,
    label: Option<String>,
    start_byte: usize,
    end_byte: usize,
    li: &LineIndex,
    src: &str,
) -> RdNode {
    let start_line = li.line_col(start_byte).0;
    let end_line = li.end_line(src, start_byte, end_byte);
    RdNode {
        kind: kind.to_string(),
        label,
        start_line,
        end_line,
        start_byte,
        end_byte,
        children: Vec::new(),
    }
}
