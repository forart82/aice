use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, DepKind, IntraBlockSelector, LanguageAdapter, LanguageId,
    OutlineView, ParseError, ParsedTree, SliceError, SymbolKind, SymbolNode, SymbolSelector,
};

use crate::r5::cst_helpers::{
    field_text, node_text, outline_from_symbols, push_sym, qualified, slice_symbol_from_list,
    visit_named_preorder, with_ts_root,
};
use crate::r5::dep_helpers::augment_r5_deps;
use crate::ts_pool::parse_tree_sitter;

pub struct RubyAdapter;

impl LanguageAdapter for RubyAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::Ruby
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        parse_tree_sitter(LanguageId::Ruby, src)
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut out = Vec::new();
            let mut scope = Vec::new();
            walk_ruby(root, src, &mut scope, &mut out);
            out
        })
    }

    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        let syms = self.extract_symbols(tree, src);
        with_ts_root(tree, Vec::new(), |root| {
            let mut deps = Vec::new();
            walk_ruby_deps(root, src, &mut deps);
            augment_r5_deps(LanguageId::Ruby, root, src, &syms, &mut deps);
            deps
        })
    }
}

impl AstSlicer for RubyAdapter {
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

fn walk_ruby(root: tree_sitter::Node<'_>, src: &str, scope: &mut Vec<String>, out: &mut Vec<SymbolNode>) {
    enum Step<'a> { Node(tree_sitter::Node<'a>), Pop }
    let mut stack = vec![Step::Node(root)];
    while let Some(step) = stack.pop() {
        let Step::Node(node) = step else { scope.pop(); continue; };
        match node.kind() {
            "module" | "class" => {
                if let Some(name) = field_text(node, "name", src) {
                    let kind = if node.kind() == "module" { SymbolKind::Module } else { SymbolKind::Class };
                    push_sym(out, name, qualified(scope, name, "::"), kind, node, src);
                    scope.push(name.to_string());
                    stack.push(Step::Pop);
                    for i in (0..node.named_child_count()).rev() {
                        if let Some(c) = node.named_child(i as u32) { stack.push(Step::Node(c)); }
                    }
                    continue;
                }
            }
            "method" | "singleton_method" => {
                if let Some(name) = field_text(node, "name", src) {
                    let kind = if scope.is_empty() && node.kind() == "method" { SymbolKind::Function } else { SymbolKind::Method };
                    push_sym(out, name, qualified(scope, name, "::"), kind, node, src);
                }
                continue;
            }
            _ => {}
        }
        for i in (0..node.named_child_count()).rev() {
            if let Some(c) = node.named_child(i as u32) { stack.push(Step::Node(c)); }
        }
    }
}

fn walk_ruby_deps(root: tree_sitter::Node<'_>, src: &str, deps: &mut Vec<DepEdge>) {
    visit_named_preorder(root, |node| {
        if node.kind() == "call"
            && let Some(m) = field_text(node, "method", src)
            && matches!(m, "require" | "require_relative")
            && let Some(args) = node.child_by_field_name("arguments")
            && let Some(arg) = (0..args.named_child_count())
                .filter_map(|i| args.named_child(i as u32))
                .find(|c| c.kind() != "comment")
        {
            let target = node_text(arg, src).trim().trim_matches(['"', '\'']);
            if !target.is_empty() {
                deps.push(DepEdge { source: "ruby".to_string(), target: target.to_string(), kind: DepKind::Import });
            }
        }
    });
}
