use std::collections::HashSet;

use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, DepKind, IntraBlockSelector, LanguageAdapter, LanguageId,
    OutlineEntry, OutlineView, ParseError, ParsedTree, SliceError, SymbolKind, SymbolNode,
    SymbolSelector,
};

use crate::r5::cst_helpers::{
    field_text, node_text, push_sym, qualified, slice_symbol_from_list, with_ts_root,
};
use crate::r5::dep_helpers::collect_schema_comment_deps;
use crate::ts_pool::parse_tree_sitter;

pub struct JsonAdapter;

impl LanguageAdapter for JsonAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::Json
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        parse_tree_sitter(LanguageId::Json, src)
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut out = Vec::new();
            let mut scope = Vec::new();
            walk_json(root, src, &mut scope, &mut out);
            out
        })
    }

    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        let mut deps = Vec::new();
        collect_schema_comment_deps(src, "file", &mut deps);
        with_ts_root(tree, (), |root| {
            let mut seen: HashSet<String> = deps
                .iter()
                .filter(|d| d.kind == DepKind::SchemaRef)
                .map(|d| d.target.clone())
                .collect();
            let mut stack = vec![root];
            while let Some(node) = stack.pop() {
                if node.kind() == "pair"
                    && let Some(raw_key) = field_text(node, "key", src)
                    && raw_key.trim_matches('"') == "$schema"
                    && let Some(val) = node.child_by_field_name("value")
                    && val.kind() == "string"
                {
                    let target = node_text(val, src).trim().trim_matches('"').trim();
                    if !target.is_empty() && seen.insert(target.to_string()) {
                        deps.push(DepEdge {
                            source: "file".to_string(),
                            target: target.to_string(),
                            kind: DepKind::SchemaRef,
                        });
                    }
                }
                for i in (0..node.named_child_count()).rev() {
                    if let Some(c) = node.named_child(i as u32) { stack.push(c); }
                }
            }
        });
        deps
    }
}

impl AstSlicer for JsonAdapter {
    fn slice_symbol(
        &self,
        tree: &ParsedTree,
        src: &str,
        sel: &SymbolSelector,
    ) -> Result<AstSlice, SliceError> {
        slice_symbol_from_list(&self.extract_symbols(tree, src), src, sel)
    }

    fn slice_intra_block(
        &self,
        tree: &ParsedTree,
        src: &str,
        sel: &IntraBlockSelector,
    ) -> Result<AstSlice, SliceError> {
        crate::intra_ast::slice_intra_block(tree, &self.extract_symbols(tree, src), src, sel)
    }

    fn outline(
        &self,
        tree: &ParsedTree,
        src: &str,
        depth: usize,
        _include_types: bool,
    ) -> OutlineView {
        let entries = with_ts_root(tree, Vec::new(), |root| outline_json(root, src, depth));
        OutlineView {
            entries,
            total_lines: src.lines().count(),
        }
    }
}

fn json_node_lines(node: tree_sitter::Node<'_>) -> (usize, usize) {
    let start = node.start_position();
    let end = node.end_position();
    let end_row = if end.column == 0 && end.row > start.row {
        end.row - 1
    } else {
        end.row
    };
    (start.row + 1, (end_row + 1).max(start.row + 1))
}

fn json_val_summary(val: tree_sitter::Node<'_>) -> Option<String> {
    match val.kind() {
        "object" => {
            let mut keys = 0usize;
            for i in 0..val.named_child_count() {
                if val.named_child(i as u32).is_some_and(|c| c.kind() == "pair") {
                    keys += 1;
                }
            }
            Some(if keys == 0 { "{}".to_string() } else { format!("{{{keys} keys}}") })
        }
        "array" => {
            let items = val.named_child_count();
            Some(if items == 0 { "[]".to_string() } else { format!("[{items} items]") })
        }
        _ => None,
    }
}

fn outline_json(root: tree_sitter::Node<'_>, src: &str, depth: usize) -> Vec<OutlineEntry> {
    enum Step<'a> { Node(tree_sitter::Node<'a>), PopScope, PopArr }
    let mut out = Vec::new();
    let mut scope: Vec<String> = Vec::new();
    let mut arr_depth = 0usize;
    let mut stack = vec![Step::Node(root)];
    while let Some(step) = stack.pop() {
        match step {
            Step::PopScope => { scope.pop(); continue; }
            Step::PopArr => { arr_depth = arr_depth.saturating_sub(1); continue; }
            Step::Node(node) => {
                if node.kind() == "pair" && let Some(raw_key) = field_text(node, "key", src) {
                    let key = raw_key.trim_matches('"').to_string();
                    let key_depth = scope.len() + 1;
                    let (start_line, end_line) = json_node_lines(node);
                    let val = node.child_by_field_name("value");
                    let val_is_container = val.is_some_and(|v| matches!(v.kind(), "object" | "array"));
                    let emit = if depth == 0 {
                        arr_depth == 0 && (key_depth == 1 || (key_depth == 2 && val_is_container && end_line > start_line))
                    } else {
                        key_depth <= depth
                    };
                    if emit {
                        out.push(OutlineEntry {
                            name: qualified(&scope, &key, "."),
                            kind: SymbolKind::Constant,
                            start_line,
                            end_line,
                            signature: val.and_then(json_val_summary),
                        });
                    }
                    let descend = if depth == 0 {
                        arr_depth == 0 && key_depth == 1 && val.is_some_and(|v| v.kind() == "object")
                    } else {
                        key_depth < depth
                    };
                    if descend && let Some(v) = val {
                        scope.push(key);
                        stack.push(Step::PopScope);
                        stack.push(Step::Node(v));
                    }
                    continue;
                }
                if node.kind() == "array" {
                    if depth == 0 && scope.is_empty() && arr_depth == 0 && out.is_empty() {
                        let (start_line, end_line) = json_node_lines(node);
                        out.push(OutlineEntry {
                            name: "[]".to_string(),
                            kind: SymbolKind::Constant,
                            start_line,
                            end_line,
                            signature: json_val_summary(node),
                        });
                        continue;
                    }
                    arr_depth += 1;
                    stack.push(Step::PopArr);
                }
                for i in (0..node.named_child_count()).rev() {
                    if let Some(c) = node.named_child(i as u32) {
                        stack.push(Step::Node(c));
                    }
                }
            }
        }
    }
    out
}

fn walk_json(root: tree_sitter::Node<'_>, src: &str, scope: &mut Vec<String>, out: &mut Vec<SymbolNode>) {
    enum Step<'a> { Node(tree_sitter::Node<'a>), Pop }
    let mut stack = vec![Step::Node(root)];
    while let Some(step) = stack.pop() {
        let Step::Node(node) = step else { scope.pop(); continue; };
        if node.kind() == "pair" && let Some(raw_key) = field_text(node, "key", src) {
            let key = raw_key.trim_matches('"').to_string();
            let qname = qualified(scope, &key, ".");
            push_sym(out, key.clone(), qname, SymbolKind::Constant, node, src);
            if let Some(val) = node.child_by_field_name("value") {
                scope.push(key);
                stack.push(Step::Pop);
                stack.push(Step::Node(val));
            }
            continue;
        }
        for i in (0..node.named_child_count()).rev() {
            if let Some(child) = node.named_child(i as u32) { stack.push(Step::Node(child)); }
        }
    }
}
