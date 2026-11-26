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

pub struct PythonAdapter;

impl LanguageAdapter for PythonAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::Python
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        parse_tree_sitter(LanguageId::Python, src)
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut out = Vec::new();
            let mut scope = Vec::new();
            walk_py(root, src, &mut scope, &mut out);
            out
        })
    }

    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        let syms = self.extract_symbols(tree, src);
        with_ts_root(tree, Vec::new(), |root| {
            let mut deps = Vec::new();
            walk_py_deps(root, src, &mut deps);
            augment_r5_deps(LanguageId::Python, root, src, &syms, &mut deps);
            deps
        })
    }
}

impl AstSlicer for PythonAdapter {
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

fn walk_py(root: tree_sitter::Node<'_>, src: &str, scope: &mut Vec<String>, out: &mut Vec<SymbolNode>) {
    enum Step<'a> { Node(tree_sitter::Node<'a>), Pop }
    let mut stack = vec![Step::Node(root)];
    while let Some(step) = stack.pop() {
        let Step::Node(node) = step else { scope.pop(); continue; };
        let span = decorated_wrapper(node);
        match node.kind() {
            "class_definition" => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, qualified(scope, name, "."), SymbolKind::Class, span, src);
                    scope.push(name.to_string());
                    stack.push(Step::Pop);
                    for i in (0..node.named_child_count()).rev() {
                        if let Some(c) = node.named_child(i as u32) { stack.push(Step::Node(c)); }
                    }
                    continue;
                }
            }
            "function_definition" => {
                if let Some(name) = field_text(node, "name", src) {
                    let kind = if scope.is_empty() { SymbolKind::Function } else { SymbolKind::Method };
                    push_sym(out, name, qualified(scope, name, "."), kind, span, src);
                }
                continue;
            }
            "assignment" if scope.is_empty() && is_top_level_stmt(node) => {
                if let Some(left) = node.child_by_field_name("left") && left.kind() == "identifier" {
                    let name = node_text(left, src).trim();
                    push_sym(out, name, name, SymbolKind::Constant, node, src);
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

fn decorated_wrapper(node: tree_sitter::Node<'_>) -> tree_sitter::Node<'_> {
    match node.parent() {
        Some(p) if p.kind() == "decorated_definition" => p,
        _ => node,
    }
}

fn is_top_level_stmt(node: tree_sitter::Node<'_>) -> bool {
    matches!(
        node.parent().and_then(|p| p.parent()).map(|n| n.kind()),
        Some("module")
    )
}

fn walk_py_deps(root: tree_sitter::Node<'_>, src: &str, deps: &mut Vec<DepEdge>) {
    visit_named_preorder(root, |node| match node.kind() {
        "import_statement" => {
            if let Some(name) = field_text(node, "name", src) {
                deps.push(DepEdge { source: "module".to_string(), target: name.to_string(), kind: DepKind::Import });
            }
        }
        "import_from_statement" => {
            if let Some(mod_node) = node.child_by_field_name("module_name") {
                let m = node_text(mod_node, src).trim();
                if !m.is_empty() && m.chars().all(|c| c == '.') {
                    let mut emitted = false;
                    for i in 0..node.named_child_count() {
                        let Some(ch) = node.named_child(i as u32) else { continue; };
                        if ch.id() == mod_node.id() { continue; }
                        let item = match ch.kind() {
                            "dotted_name" => Some(node_text(ch, src).trim()),
                            "aliased_import" => field_text(ch, "name", src),
                            _ => None,
                        };
                        if let Some(name) = item && !name.is_empty() {
                            deps.push(DepEdge {
                                source: "module".to_string(),
                                target: format!("{m}{name}"),
                                kind: DepKind::Import,
                            });
                            emitted = true;
                        }
                    }
                    if !emitted {
                        deps.push(DepEdge { source: "module".to_string(), target: m.to_string(), kind: DepKind::Import });
                    }
                } else if !m.is_empty() {
                    deps.push(DepEdge { source: "module".to_string(), target: m.to_string(), kind: DepKind::Import });
                }
            }
        }
        _ => {}
    });
}
