use std::collections::HashSet;

use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, DepKind, IntraBlockSelector, LanguageAdapter, LanguageId,
    OutlineView, ParseError, ParsedTree, SliceError, SymbolKind, SymbolNode, SymbolSelector,
};

use crate::r5::checks::{ErrorSpan, collect_ts_error_spans, span_from_node};
use crate::r5::cst_helpers::{
    child_kind_text, node_text, outline_from_symbols, push_sym, slice_symbol_from_list,
    with_ts_root,
};
use crate::r6::sql_lex::{LineIndex, sp};
use crate::ts_pool::{GrammarSlot, ParserPool, with_parser_pool};

const GQL_BUILTINS: [&str; 5] = ["ID", "String", "Int", "Float", "Boolean"];

pub struct GraphQlAdapter;

impl LanguageAdapter for GraphQlAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::GraphQl
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        with_parser_pool(|pool| pool.parse_lang(LanguageId::GraphQl, src))
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut out = Vec::new();
            let mut stack = vec![root];
            while let Some(node) = stack.pop() {
                if let Some((kind, name)) = gql_sym_info(node, src) {
                    push_sym(&mut out, &name, &name, kind, node, src);
                }
                for i in (0..node.named_child_count()).rev() {
                    if let Some(c) = node.named_child(i as u32) { stack.push(c); }
                }
            }
            out
        })
    }

    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut out = Vec::new();
            let mut seen = HashSet::new();
            let mut stack: Vec<(tree_sitter::Node<'_>, String)> = vec![(root, String::new())];
            while let Some((node, scope)) = stack.pop() {
                let cur_scope = gql_sym_info(node, src).map_or(scope, |(_, n)| n);
                if node.kind() == "named_type" && !cur_scope.is_empty() {
                    let ty = node_text(node, src).trim();
                    if !ty.is_empty() && ty != cur_scope && !GQL_BUILTINS.contains(&ty)
                        && seen.insert((cur_scope.clone(), ty.to_string()))
                    {
                        out.push(DepEdge { source: cur_scope.clone(), target: ty.to_string(), kind: DepKind::TypeRef });
                    }
                }
                for i in (0..node.named_child_count()).rev() {
                    if let Some(c) = node.named_child(i as u32) { stack.push((c, cur_scope.clone())); }
                }
            }
            out
        })
    }
}

impl AstSlicer for GraphQlAdapter {
    fn slice_symbol(&self, tree: &ParsedTree, src: &str, sel: &SymbolSelector) -> Result<AstSlice, SliceError> {
        slice_symbol_from_list(&self.extract_symbols(tree, src), src, sel)
    }

    fn slice_intra_block(&self, tree: &ParsedTree, src: &str, sel: &IntraBlockSelector) -> Result<AstSlice, SliceError> {
        crate::intra_ast::slice_intra_block(tree, &self.extract_symbols(tree, src), src, sel)
    }

    fn outline(&self, tree: &ParsedTree, src: &str, depth: usize, include_types: bool) -> OutlineView {
        outline_from_symbols(&self.extract_symbols(tree, src), src, depth, include_types)
    }
}

fn gql_sym_info(node: tree_sitter::Node<'_>, src: &str) -> Option<(SymbolKind, String)> {
    match node.kind() {
        "object_type_definition" | "object_type_extension" => {
            child_kind_text(node, "name", src).map(|n| (SymbolKind::Struct, n.to_string()))
        }
        "interface_type_definition" | "interface_type_extension" => {
            child_kind_text(node, "name", src).map(|n| (SymbolKind::Interface, n.to_string()))
        }
        "input_object_type_definition" | "input_object_type_extension" | "union_type_definition" | "union_type_extension" => {
            child_kind_text(node, "name", src).map(|n| (SymbolKind::Struct, n.to_string()))
        }
        "enum_type_definition" | "enum_type_extension" => {
            child_kind_text(node, "name", src).map(|n| (SymbolKind::Enum, n.to_string()))
        }
        "scalar_type_definition" | "scalar_type_extension" | "directive_definition" => {
            child_kind_text(node, "name", src).map(|n| (SymbolKind::Constant, n.to_string()))
        }
        "operation_definition" => {
            let name = child_kind_text(node, "name", src)
                .or_else(|| child_kind_text(node, "operation_type", src))
                .unwrap_or("query");
            Some((SymbolKind::Query, name.to_string()))
        }
        "fragment_definition" => {
            let fname = (0..node.named_child_count())
                .filter_map(|i| node.named_child(i as u32))
                .find(|c| c.kind() == "fragment_name")
                .map(|c| node_text(c, src).trim().to_string())?;
            Some((SymbolKind::Function, fname))
        }
        "schema_definition" => Some((SymbolKind::Module, "schema".to_string())),
        _ => None,
    }
}

pub fn verify_graphql_spans(src: &str, pool: &mut ParserPool) -> Vec<ErrorSpan> {
    let mut spans = match pool.parse_slot(GrammarSlot::GraphQl, src) {
        Ok(tree) => {
            let mut s = collect_ts_error_spans(&tree, src);
            check_gql_cst(tree.root_node(), &mut s);
            s
        }
        Err(e) => vec![sp(e.line, e.column, e.message)],
    };
    spans.extend(check_gql_delims(src));
    spans
}

fn check_gql_cst(root: tree_sitter::Node<'_>, errs: &mut Vec<ErrorSpan>) {
    let mut stack = vec![root];
    while let Some(n) = stack.pop() {
        match n.kind() {
            "selection_set" | "fields_definition" | "input_fields_definition" | "enum_values_definition" => {
                if n.named_child_count() == 0 {
                    errs.push(span_from_node(n, "Empty GraphQL '{}' block".to_string()));
                }
            }
            "field_definition" => {
                if !has_child(n, "name") || !has_child(n, "type") {
                    errs.push(span_from_node(n, "GraphQL field definition missing name or type".to_string()));
                }
            }
            "input_value_definition" if !has_child(n, "name") || !has_child(n, "type") => {
                errs.push(span_from_node(n, "GraphQL argument/input field missing name or type".to_string()));
            }
            _ => {}
        }
        for i in (0..n.named_child_count()).rev() {
            if let Some(c) = n.named_child(i as u32) { stack.push(c); }
        }
    }
}

fn has_child(n: tree_sitter::Node<'_>, kind: &str) -> bool {
    (0..n.named_child_count()).any(|i| n.named_child(i as u32).is_some_and(|c| c.kind() == kind))
}

fn check_gql_delims(src: &str) -> Vec<ErrorSpan> {
    let mut errs = Vec::new();
    let li = LineIndex::new(src);
    let b = src.as_bytes();
    let mut stack: Vec<(u8, usize, usize)> = Vec::new();
    let mut i = 0usize;
    while i < b.len() {
        let (l, c) = li.line_col(i);
        if b[i] == b'#' { while i < b.len() && b[i] != b'\n' { i += 1; } continue; }
        if b[i..].starts_with(b"\"\"\"") {
            i += 3;
            if let Some(rel) = src[i..].find("\"\"\"") { i += rel + 3; continue; }
            errs.push(sp(l, c, "Unterminated GraphQL block string '\"\"\"'"));
            break;
        }
        if b[i] == b'"' {
            i += 1;
            let mut closed = false;
            while i < b.len() && b[i] != b'\n' {
                if b[i] == b'\\' && i + 1 < b.len() { i += 2; continue; }
                if b[i] == b'"' { i += 1; closed = true; break; }
                i += 1;
            }
            if !closed { errs.push(sp(l, c, "Unterminated GraphQL string literal")); }
            continue;
        }
        match b[i] {
            b'{' => stack.push((b'}', l, c)),
            b'(' => stack.push((b')', l, c)),
            b'[' => stack.push((b']', l, c)),
            b'}' | b')' | b']' if stack.pop().is_none_or(|(exp, _, _)| exp != b[i]) => {
                errs.push(sp(l, c, "Mismatched closing delimiter in GraphQL"));
            }
            _ => {}
        }
        i += if b[i] >= 0x80 { src[i..].chars().next().map_or(1, char::len_utf8) } else { 1 };
    }
    while let Some((exp, l, c)) = stack.pop() {
        let open = match exp { b'}' => '{', b')' => '(', _ => '[' };
        errs.push(sp(l, c, format!("Unclosed '{open}' in GraphQL")));
    }
    errs
}
