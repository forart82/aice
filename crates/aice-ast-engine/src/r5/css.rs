use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, DepKind, IntraBlockSelector, LanguageAdapter, LanguageId,
    OutlineView, ParseError, ParsedTree, SliceError, SymbolKind, SymbolNode, SymbolSelector,
};

use crate::r5::cst_helpers::{
    child_kind_text, node_text, outline_from_symbols, push_sym, slice_symbol_from_list,
    visit_named_preorder, with_ts_root,
};
use crate::r5::dep_helpers::collect_schema_comment_deps;
use crate::ts_pool::parse_tree_sitter;

pub struct CssAdapter;

impl LanguageAdapter for CssAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::Css
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        parse_tree_sitter(LanguageId::Css, src)
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut out = Vec::new();
            walk_css(root, src, &mut out);
            out
        })
    }

    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut deps = Vec::new();
            walk_css_deps(root, src, &mut deps);
            collect_schema_comment_deps(src, "stylesheet", &mut deps);
            deps
        })
    }
}

impl AstSlicer for CssAdapter {
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

fn walk_css(root: tree_sitter::Node<'_>, src: &str, out: &mut Vec<SymbolNode>) {
    visit_named_preorder(root, |node| match node.kind() {
        "rule_set" => {
            if let Some(sel) = child_kind_text(node, "selectors", src) {
                push_sym(out, sel, sel, SymbolKind::Block, node, src);
            }
        }
        "keyframes_statement" => {
            if let Some(name) = child_kind_text(node, "keyframes_name", src) {
                push_sym(out, name, format!("@keyframes {name}"), SymbolKind::Block, node, src);
            }
        }
        "media_statement" => {
            let sig = node_text(node, src).lines().next().unwrap_or("@media").trim();
            push_sym(out, sig, sig, SymbolKind::Block, node, src);
        }
        _ => {}
    });
}

fn walk_css_deps(root: tree_sitter::Node<'_>, src: &str, deps: &mut Vec<DepEdge>) {
    visit_named_preorder(root, |node| {
        if node.kind() == "import_statement" {
            let text = node_text(node, src);
            if let Some(target) = text.split(['"', '\'']).nth(1).filter(|s| !s.is_empty()) {
                deps.push(DepEdge { source: "stylesheet".to_string(), target: target.to_string(), kind: DepKind::Import });
            }
        }
    });
}
