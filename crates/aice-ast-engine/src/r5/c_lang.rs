use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, DepKind, IntraBlockSelector, LanguageAdapter, LanguageId,
    OutlineView, ParseError, ParsedTree, SliceError, SymbolKind, SymbolNode, SymbolSelector,
};

use crate::r5::cst_helpers::{
    field_text, node_text, outline_from_symbols, push_sym, slice_symbol_from_list,
    visit_named_preorder, with_ts_root,
};
use crate::r5::dep_helpers::augment_r5_deps;
use crate::ts_pool::parse_tree_sitter;

pub struct CAdapter;

impl LanguageAdapter for CAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::C
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        parse_tree_sitter(LanguageId::C, src)
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut out = Vec::new();
            walk_c(root, src, &mut out);
            out
        })
    }

    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        let syms = self.extract_symbols(tree, src);
        with_ts_root(tree, Vec::new(), |root| {
            let mut deps = Vec::new();
            walk_c_deps(root, src, &mut deps);
            augment_r5_deps(LanguageId::C, root, src, &syms, &mut deps);
            deps
        })
    }
}

impl AstSlicer for CAdapter {
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

fn walk_c(root: tree_sitter::Node<'_>, src: &str, out: &mut Vec<SymbolNode>) {
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        match node.kind() {
            "struct_specifier" | "union_specifier" if node.child_by_field_name("body").is_some() => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, name, SymbolKind::Struct, node, src);
                }
            }
            "enum_specifier" if node.child_by_field_name("body").is_some() => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, name, SymbolKind::Enum, node, src);
                }
            }
            "type_definition" => {
                if let Some(decl) = node.child_by_field_name("declarator")
                    && let Some(name) = unwrap_c_declarator(decl, src)
                {
                    push_sym(out, name.clone(), name, SymbolKind::Struct, node, src);
                }
            }
            "function_definition" => {
                if let Some(decl) = node.child_by_field_name("declarator")
                    && let Some(name) = unwrap_c_declarator(decl, src)
                {
                    push_sym(out, name.clone(), name, SymbolKind::Function, node, src);
                }
                continue;
            }
            "preproc_def" => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, name, SymbolKind::Constant, node, src);
                }
            }
            "preproc_function_def" => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, name, SymbolKind::Function, node, src);
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
}

pub fn unwrap_c_declarator(mut node: tree_sitter::Node<'_>, src: &str) -> Option<String> {
    loop {
        match node.kind() {
            "identifier" | "type_identifier" | "field_identifier" | "qualified_identifier" => {
                let s = node_text(node, src).trim();
                return (!s.is_empty()).then(|| s.to_string());
            }
            _ => node = node.child_by_field_name("declarator")?,
        }
    }
}

pub fn walk_c_deps(root: tree_sitter::Node<'_>, src: &str, deps: &mut Vec<DepEdge>) {
    visit_named_preorder(root, |node| {
        if node.kind() == "preproc_include"
            && let Some(path) = field_text(node, "path", src)
        {
            let target = path.trim_matches(['"', '<', '>']);
            if !target.is_empty() {
                deps.push(DepEdge {
                    source: "translation_unit".to_string(),
                    target: target.to_string(),
                    kind: DepKind::Import,
                });
            }
        }
    });
}
