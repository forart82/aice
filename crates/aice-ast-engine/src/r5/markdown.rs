use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, DepKind, IntraBlockSelector, LanguageAdapter, LanguageId,
    OutlineView, ParseError, ParsedTree, SliceError, SymbolKind, SymbolNode, SymbolSelector,
};

use crate::r5::cst_helpers::{
    child_kind_text, outline_from_symbols, push_sym, slice_symbol_from_list, visit_named_preorder,
    with_ts_root,
};
use crate::r5::dep_helpers::collect_schema_comment_deps;
use crate::ts_pool::parse_tree_sitter;

pub struct MarkdownAdapter;

impl LanguageAdapter for MarkdownAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::Markdown
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        parse_tree_sitter(LanguageId::Markdown, src)
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut out = Vec::new();
            walk_md_symbols(root, src, &mut out);
            out
        })
    }

    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut deps = Vec::new();
            walk_md_deps(root, src, &mut deps);
            collect_schema_comment_deps(src, "document", &mut deps);
            deps
        })
    }
}

impl AstSlicer for MarkdownAdapter {
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

fn walk_md_symbols(root: tree_sitter::Node<'_>, src: &str, out: &mut Vec<SymbolNode>) {
    visit_named_preorder(root, |node| match node.kind() {
        "atx_heading" | "setext_heading" => {
            if let Some(title) = child_kind_text(node, "heading_content", src)
                .or_else(|| child_kind_text(node, "inline", src))
            {
                let span_node = node.parent().filter(|p| p.kind() == "section").unwrap_or(node);
                push_sym(out, title, title, SymbolKind::Section, span_node, src);
            }
        }
        "link_reference_definition" => {
            if let Some(lbl) = child_kind_text(node, "link_label", src) {
                push_sym(out, lbl, lbl, SymbolKind::Constant, node, src);
            }
        }
        _ => {}
    });
}

fn walk_md_deps(root: tree_sitter::Node<'_>, src: &str, deps: &mut Vec<DepEdge>) {
    visit_named_preorder(root, |node| {
        if node.kind() == "link_reference_definition"
            && let Some(dest) = child_kind_text(node, "link_destination", src)
        {
            deps.push(DepEdge { source: "document".to_string(), target: dest.to_string(), kind: DepKind::Import });
        }
    });
}
