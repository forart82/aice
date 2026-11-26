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

pub struct RustAdapter;

impl LanguageAdapter for RustAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::Rust
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        parse_tree_sitter(LanguageId::Rust, src)
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut out = Vec::new();
            let mut scope = Vec::new();
            walk_rust(root, src, false, &mut scope, &mut out);
            out
        })
    }

    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        let syms = self.extract_symbols(tree, src);
        with_ts_root(tree, Vec::new(), |root| {
            let mut deps = Vec::new();
            walk_rust_deps(root, src, &mut deps);
            augment_r5_deps(LanguageId::Rust, root, src, &syms, &mut deps);
            deps
        })
    }
}

impl AstSlicer for RustAdapter {
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

fn walk_rust(
    root: tree_sitter::Node<'_>,
    src: &str,
    init_in_type: bool,
    scope: &mut Vec<String>,
    out: &mut Vec<SymbolNode>,
) {
    enum Step<'a> { Node(tree_sitter::Node<'a>, bool), Pop }
    let mut stack = vec![Step::Node(root, init_in_type)];
    while let Some(step) = stack.pop() {
        let Step::Node(node, in_type_body) = step else { scope.pop(); continue; };
        let mut child_in_type = in_type_body;
        match node.kind() {
            "mod_item" => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, qualified(scope, name, "::"), SymbolKind::Module, node, src);
                    scope.push(name.to_string());
                    stack.push(Step::Pop);
                    child_in_type = false;
                }
            }
            "impl_item" => {
                if let Some(ty) = field_text(node, "type", src) {
                    let clean = ty.split('<').next().unwrap_or(ty).trim();
                    scope.push(clean.to_string());
                    stack.push(Step::Pop);
                    child_in_type = true;
                }
            }
            "trait_item" => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, qualified(scope, name, "::"), SymbolKind::Trait, node, src);
                    scope.push(name.to_string());
                    stack.push(Step::Pop);
                    child_in_type = true;
                }
            }
            "struct_item" | "union_item" => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, qualified(scope, name, "::"), SymbolKind::Struct, node, src);
                }
            }
            "enum_item" => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, qualified(scope, name, "::"), SymbolKind::Enum, node, src);
                }
            }
            "type_item" => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, qualified(scope, name, "::"), SymbolKind::Struct, node, src);
                }
            }
            "const_item" | "static_item" => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, qualified(scope, name, "::"), SymbolKind::Constant, node, src);
                }
            }
            "function_item" | "function_signature_item" => {
                if let Some(name) = field_text(node, "name", src) {
                    let kind = if in_type_body { SymbolKind::Method } else { SymbolKind::Function };
                    push_sym(out, name, qualified(scope, name, "::"), kind, node, src);
                }
                continue;
            }
            "macro_definition" => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, qualified(scope, name, "::"), SymbolKind::Function, node, src);
                }
                continue;
            }
            _ => {}
        }
        for i in (0..node.named_child_count()).rev() {
            if let Some(c) = node.named_child(i as u32) { stack.push(Step::Node(c, child_in_type)); }
        }
    }
}



fn walk_rust_deps(root: tree_sitter::Node<'_>, src: &str, deps: &mut Vec<DepEdge>) {
    visit_named_preorder(root, |node| {
        if node.kind() == "use_declaration"
            && let Some(arg) = node.child_by_field_name("argument")
        {
            let target = node_text(arg, src).trim().to_string();
            if !target.is_empty() {
                deps.push(DepEdge { source: "crate".to_string(), target, kind: DepKind::Import });
            }
        }
    });
}
