use std::collections::HashSet;

use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, DepKind, IntraBlockSelector, LanguageAdapter, LanguageId,
    OutlineView, ParseError, ParsedTree, SliceError, SymbolKind, SymbolNode, SymbolSelector,
};

use crate::r5::cst_helpers::{
    field_text, outline_from_symbols, push_sym, qualified, slice_symbol_from_list,
    visit_named_preorder, with_ts_root,
};
use crate::r5::dep_helpers::augment_r5_deps;
use crate::r5::javascript::walk_js_requires;
use crate::ts_pool::parse_tree_sitter;

pub struct TypeScriptAdapter;
pub struct TsxAdapter;

impl LanguageAdapter for TypeScriptAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::TypeScript
    }
    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        parse_tree_sitter(LanguageId::TypeScript, src)
    }
    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        extract_ts_symbols(tree, src)
    }
    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        let syms = self.extract_symbols(tree, src);
        let mut deps = extract_ts_deps(tree, src);
        with_ts_root(tree, (), |root| {
            walk_js_requires(root, src, &mut deps);
            augment_r5_deps(LanguageId::TypeScript, root, src, &syms, &mut deps);
        });
        deps
    }
}

impl AstSlicer for TypeScriptAdapter {
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

impl LanguageAdapter for TsxAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::Tsx
    }
    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        parse_tree_sitter(LanguageId::Tsx, src)
    }
    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        extract_ts_symbols(tree, src)
    }
    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        let syms = self.extract_symbols(tree, src);
        let mut deps = extract_ts_deps(tree, src);
        with_ts_root(tree, (), |root| {
            walk_js_requires(root, src, &mut deps);
            augment_r5_deps(LanguageId::Tsx, root, src, &syms, &mut deps);
        });
        deps
    }
}

impl AstSlicer for TsxAdapter {
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

pub fn extract_ts_symbols(tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
    with_ts_root(tree, Vec::new(), |root| {
        let mut out = Vec::new();
        let mut scope = Vec::new();
        walk_ts(root, src, &mut scope, &mut out);
        out
    })
}

pub fn extract_ts_deps(tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
    with_ts_root(tree, Vec::new(), |root| {
        let mut deps = Vec::new();
        walk_ts_deps(root, src, &mut deps);
        deps
    })
}

fn walk_ts(root: tree_sitter::Node<'_>, src: &str, scope: &mut Vec<String>, out: &mut Vec<SymbolNode>) {
    enum Step<'a> { Node(tree_sitter::Node<'a>), Pop }
    let mut stack = vec![Step::Node(root)];
    while let Some(step) = stack.pop() {
        let Step::Node(node) = step else { scope.pop(); continue; };
        let container_kind = match node.kind() {
            "internal_module" | "module" => Some(SymbolKind::Module),
            "class_declaration" | "abstract_class_declaration" => Some(SymbolKind::Class),
            "interface_declaration" => Some(SymbolKind::Interface),
            _ => None,
        };
        if let Some(kind) = container_kind && let Some(name) = field_text(node, "name", src) {
            push_sym(out, name, qualified(scope, name, "."), kind, export_wrapper(node), src);
            scope.push(name.to_string());
            stack.push(Step::Pop);
            for i in (0..node.named_child_count()).rev() {
                if let Some(c) = node.named_child(i as u32) { stack.push(Step::Node(c)); }
            }
            continue;
        }
        match node.kind() {
            "type_alias_declaration" => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, qualified(scope, name, "."), SymbolKind::Struct, export_wrapper(node), src);
                }
                continue;
            }
            "enum_declaration" => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, qualified(scope, name, "."), SymbolKind::Enum, export_wrapper(node), src);
                }
                continue;
            }
            "function_declaration" | "function_signature" | "generator_function_declaration" => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, qualified(scope, name, "."), SymbolKind::Function, export_wrapper(node), src);
                }
                continue;
            }
            "method_definition" | "method_signature" => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, qualified(scope, name, "."), SymbolKind::Method, node, src);
                }
                continue;
            }
            "variable_declarator" if scope.is_empty() => {
                if let Some(name) = field_text(node, "name", src) && is_top_level_decl(node) {
                    let is_fn = node
                        .child_by_field_name("value")
                        .map(|v| matches!(v.kind(), "arrow_function" | "function_expression" | "function"))
                        .unwrap_or(false);
                    let kind = if is_fn { SymbolKind::Function } else { SymbolKind::Constant };
                    let span = node.parent().map(export_wrapper).unwrap_or(node);
                    push_sym(out, name, name, kind, span, src);
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

fn export_wrapper(node: tree_sitter::Node<'_>) -> tree_sitter::Node<'_> {
    match node.parent() {
        Some(p) if p.kind() == "export_statement" => p,
        _ => node,
    }
}

fn is_top_level_decl(var_decl: tree_sitter::Node<'_>) -> bool {
    let Some(decl) = var_decl.parent() else {
        return false;
    };
    if !matches!(decl.kind(), "lexical_declaration" | "variable_declaration") {
        return false;
    }
    let container = export_wrapper(decl).parent();
    matches!(container.map(|n| n.kind()), Some("program"))
}

fn walk_ts_deps(root: tree_sitter::Node<'_>, src: &str, deps: &mut Vec<DepEdge>) {
    let mut seen = HashSet::new();
    visit_named_preorder(root, |node| {
        if matches!(node.kind(), "import_statement" | "export_statement" | "import_require_clause")
            && let Some(target) = field_text(node, "source", src)
        {
            let clean = target
                .strip_prefix('"')
                .and_then(|s| s.strip_suffix('"'))
                .or_else(|| target.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')))
                .unwrap_or(target)
                .trim();
            if !clean.is_empty() && seen.insert(clean.to_string()) {
                deps.push(DepEdge { source: "module".to_string(), target: clean.to_string(), kind: DepKind::Import });
            }
        }
    });
}
