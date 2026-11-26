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

pub struct GoAdapter;

impl LanguageAdapter for GoAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::Go
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        parse_tree_sitter(LanguageId::Go, src)
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut out = Vec::new();
            walk_go(root, src, &mut out);
            out
        })
    }

    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        let syms = self.extract_symbols(tree, src);
        with_ts_root(tree, Vec::new(), |root| {
            let mut deps = Vec::new();
            walk_go_deps(root, src, &mut deps);
            augment_r5_deps(LanguageId::Go, root, src, &syms, &mut deps);
            deps
        })
    }
}

impl AstSlicer for GoAdapter {
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

fn walk_go(root: tree_sitter::Node<'_>, src: &str, out: &mut Vec<SymbolNode>) {
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        match node.kind() {
            "type_spec" | "type_alias" => {
                if let Some(name) = field_text(node, "name", src) {
                    let kind = match node.child_by_field_name("type").map(|t| t.kind()) {
                        Some("interface_type") => SymbolKind::Interface,
                        _ => SymbolKind::Struct,
                    };
                    push_sym(out, name, name, kind, node, src);
                }
                continue;
            }
            "function_declaration" => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, name, SymbolKind::Function, node, src);
                }
                continue;
            }
            "method_declaration" => {
                if let Some(name) = field_text(node, "name", src) {
                    let recv = extract_go_receiver(node, src);
                    let q = recv
                        .map(|r| format!("{r}.{name}"))
                        .unwrap_or_else(|| name.to_string());
                    push_sym(out, name, q, SymbolKind::Method, node, src);
                }
                continue;
            }
            "const_spec" | "var_spec" => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, name, SymbolKind::Constant, node, src);
                }
                continue;
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

fn extract_go_receiver(method: tree_sitter::Node<'_>, src: &str) -> Option<String> {
    let params = method.child_by_field_name("receiver")?;
    for i in 0..params.named_child_count() {
        if let Some(p) = params.named_child(i as u32)
            && let Some(ty) = p.child_by_field_name("type")
        {
            let raw = node_text(ty, src).trim().trim_start_matches('*').trim();
            let base = raw.split('[').next().unwrap_or(raw).trim();
            if !base.is_empty() {
                return Some(base.to_string());
            }
        }
    }
    None
}

fn walk_go_deps(root: tree_sitter::Node<'_>, src: &str, deps: &mut Vec<DepEdge>) {
    visit_named_preorder(root, |node| {
        if node.kind() == "import_spec"
            && let Some(path) = field_text(node, "path", src)
        {
            let target = path.trim_matches(['"', '`']);
            if !target.is_empty() {
                deps.push(DepEdge {
                    source: "package".to_string(),
                    target: target.to_string(),
                    kind: DepKind::Import,
                });
            }
        }
    });
}
