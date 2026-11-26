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

pub struct CSharpAdapter;

impl LanguageAdapter for CSharpAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::CSharp
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        parse_tree_sitter(LanguageId::CSharp, src)
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut out = Vec::new();
            let mut scope = Vec::new();
            walk_cs(root, src, &mut scope, &mut out);
            out
        })
    }

    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        let syms = self.extract_symbols(tree, src);
        with_ts_root(tree, Vec::new(), |root| {
            let mut deps = Vec::new();
            walk_cs_deps(root, src, &mut deps);
            augment_r5_deps(LanguageId::CSharp, root, src, &syms, &mut deps);
            deps
        })
    }
}

impl AstSlicer for CSharpAdapter {
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

fn walk_cs(root: tree_sitter::Node<'_>, src: &str, scope: &mut Vec<String>, out: &mut Vec<SymbolNode>) {
    enum Step<'a> { Node(tree_sitter::Node<'a>), Pop }
    let mut stack = vec![Step::Node(root)];
    while let Some(step) = stack.pop() {
        let Step::Node(node) = step else { scope.pop(); continue; };
        let type_kind = match node.kind() {
            "namespace_declaration" | "file_scoped_namespace_declaration" => Some(SymbolKind::Module),
            "class_declaration" | "record_declaration" => Some(SymbolKind::Class),
            "struct_declaration" => Some(SymbolKind::Struct),
            "interface_declaration" => Some(SymbolKind::Interface),
            "enum_declaration" => Some(SymbolKind::Enum),
            _ => None,
        };
        if let Some(kind) = type_kind && let Some(name) = field_text(node, "name", src) {
            push_sym(out, name, qualified(scope, name, "."), kind, node, src);
            scope.push(name.to_string());
            stack.push(Step::Pop);
            for i in (0..node.named_child_count()).rev() {
                if let Some(c) = node.named_child(i as u32) { stack.push(Step::Node(c)); }
            }
            continue;
        }
        match node.kind() {
            "method_declaration" | "constructor_declaration" => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, qualified(scope, name, "."), SymbolKind::Method, node, src);
                }
                continue;
            }
            "property_declaration" => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, qualified(scope, name, "."), SymbolKind::Constant, node, src);
                }
                continue;
            }
            "delegate_declaration" => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, qualified(scope, name, "."), SymbolKind::Struct, node, src);
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

fn walk_cs_deps(root: tree_sitter::Node<'_>, src: &str, deps: &mut Vec<DepEdge>) {
    visit_named_preorder(root, |node| {
        if node.kind() == "using_directive"
            && let Some(target) = cs_using_target(node, src)
        {
            deps.push(DepEdge { source: "assembly".to_string(), target: target.to_string(), kind: DepKind::Import });
        }
    });
}

fn cs_using_target<'a>(node: tree_sitter::Node<'_>, src: &'a str) -> Option<&'a str> {
    let after = (0..node.child_count())
        .filter_map(|i| node.child(i))
        .find(|c| c.kind() == "=")
        .map_or(0, |c| c.end_byte());
    for i in 0..node.named_child_count() {
        if let Some(c) = node.named_child(i as u32)
            && c.start_byte() >= after
            && c.kind() != "comment"
        {
            if c.kind() == "predefined_type" {
                return None;
            }
            let t = node_text(c, src).trim();
            return (!t.is_empty()).then_some(t);
        }
    }
    None
}
