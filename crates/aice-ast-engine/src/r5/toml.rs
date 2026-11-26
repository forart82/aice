use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, IntraBlockSelector, LanguageAdapter, LanguageId, OutlineView,
    ParseError, ParsedTree, SliceError, SymbolKind, SymbolNode, SymbolSelector,
};

use crate::r5::cst_helpers::{
    node_text, outline_from_symbols, push_sym, slice_symbol_from_list, with_ts_root,
};
use crate::r5::dep_helpers::collect_schema_comment_deps;
use crate::ts_pool::parse_tree_sitter;

pub struct TomlAdapter;

impl LanguageAdapter for TomlAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::Toml
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        parse_tree_sitter(LanguageId::Toml, src)
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut out = Vec::new();
            walk_toml(root, src, None, &mut out);
            out
        })
    }

    fn extract_dependencies(&self, _tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        let mut deps = Vec::new();
        collect_schema_comment_deps(src, "file", &mut deps);
        deps
    }
}

impl AstSlicer for TomlAdapter {
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

fn walk_toml(
    root: tree_sitter::Node<'_>,
    src: &str,
    _init_table: Option<&str>,
    out: &mut Vec<SymbolNode>,
) {
    let mut tables: Vec<String> = Vec::new();
    let mut stack = vec![(root, None::<usize>)];
    while let Some((node, table_idx)) = stack.pop() {
        match node.kind() {
            "table" | "table_array_element" => {
                let next_idx = if let Some(k) = toml_key(node, src) {
                    push_sym(out, k.clone(), k.clone(), SymbolKind::Section, node, src);
                    let id = tables.len();
                    tables.push(k);
                    Some(id)
                } else {
                    table_idx
                };
                for i in (0..node.named_child_count()).rev() {
                    if let Some(c) = node.named_child(i as u32)
                        && c.kind() == "pair"
                    {
                        stack.push((c, next_idx));
                    }
                }
                continue;
            }
            "pair" => {
                if let Some(k) = toml_key(node, src) {
                    let q = table_idx
                        .map(|id| format!("{}.{k}", tables[id]))
                        .unwrap_or_else(|| k.clone());
                    push_sym(out, k, q, SymbolKind::Constant, node, src);
                }
                continue;
            }
            _ => {}
        }
        for i in (0..node.named_child_count()).rev() {
            if let Some(c) = node.named_child(i as u32) {
                stack.push((c, table_idx));
            }
        }
    }
}

fn toml_key(node: tree_sitter::Node<'_>, src: &str) -> Option<String> {
    for i in 0..node.named_child_count() {
        if let Some(c) = node.named_child(i as u32)
            && matches!(c.kind(), "bare_key" | "dotted_key" | "quoted_key")
        {
            let text = node_text(c, src).trim().trim_matches(['"', '\'']);
            if !text.is_empty() {
                return Some(text.to_string());
            }
        }
    }
    None
}
