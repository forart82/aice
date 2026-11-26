use std::collections::HashSet;

use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, DepKind, IntraBlockSelector, LanguageAdapter, LanguageId,
    OutlineView, ParseError, ParsedTree, SliceError, SymbolKind, SymbolNode, SymbolSelector,
};

use crate::r5::cst_helpers::{
    field_text, node_text, outline_from_symbols, push_sym, qualified, slice_symbol_from_list,
    with_ts_root,
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
        include_types: bool,
    ) -> OutlineView {
        outline_from_symbols(&self.extract_symbols(tree, src), src, depth, include_types)
    }
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
