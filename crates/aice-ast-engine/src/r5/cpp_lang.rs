use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, IntraBlockSelector, LanguageAdapter, LanguageId, OutlineView,
    ParseError, ParsedTree, SliceError, SymbolKind, SymbolNode, SymbolSelector,
};

use crate::r5::c_lang::{unwrap_c_declarator, walk_c_deps};
use crate::r5::cst_helpers::{
    field_text, outline_from_symbols, push_sym, qualified, slice_symbol_from_list, with_ts_root,
};
use crate::r5::dep_helpers::augment_r5_deps;
use crate::ts_pool::parse_tree_sitter;

pub struct CppAdapter;

impl LanguageAdapter for CppAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::Cpp
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        parse_tree_sitter(LanguageId::Cpp, src)
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut out = Vec::new();
            let mut scope = Vec::new();
            walk_cpp(root, src, false, &mut scope, &mut out);
            out
        })
    }

    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        let syms = self.extract_symbols(tree, src);
        with_ts_root(tree, Vec::new(), |root| {
            let mut deps = Vec::new();
            walk_c_deps(root, src, &mut deps);
            augment_r5_deps(LanguageId::Cpp, root, src, &syms, &mut deps);
            deps
        })
    }
}

impl AstSlicer for CppAdapter {
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

fn clean_cpp_ns_name(raw: &str) -> String {
    raw.split("::")
        .map(|seg| {
            let t = seg.trim();
            t.strip_prefix("inline")
                .filter(|r| r.starts_with(char::is_whitespace))
                .map_or(t, str::trim)
        })
        .collect::<Vec<_>>()
        .join("::")
}

fn walk_cpp(
    root: tree_sitter::Node<'_>,
    src: &str,
    init_in_class: bool,
    scope: &mut Vec<String>,
    out: &mut Vec<SymbolNode>,
) {
    enum Step<'a> { Node(tree_sitter::Node<'a>, bool), Pop }
    let mut stack = vec![Step::Node(root, init_in_class)];
    while let Some(step) = stack.pop() {
        let Step::Node(node, in_class) = step else { scope.pop(); continue; };
        let mut child_in_class = in_class;
        match node.kind() {
            "namespace_definition" => {
                if let Some(raw_name) = field_text(node, "name", src) {
                    let name = clean_cpp_ns_name(raw_name);
                    if !name.is_empty() {
                        push_sym(out, &name, qualified(scope, &name, "::"), SymbolKind::Module, node, src);
                        scope.push(name);
                        stack.push(Step::Pop);
                    }
                }
            }
            "class_specifier" | "struct_specifier" if node.child_by_field_name("body").is_some() => {
                if let Some(name) = field_text(node, "name", src) {
                    let kind = if node.kind() == "class_specifier" { SymbolKind::Class } else { SymbolKind::Struct };
                    push_sym(out, name, qualified(scope, name, "::"), kind, node, src);
                    scope.push(name.to_string());
                    stack.push(Step::Pop);
                    child_in_class = true;
                }
            }
            "enum_specifier" if node.child_by_field_name("body").is_some() => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, qualified(scope, name, "::"), SymbolKind::Enum, node, src);
                }
            }
            "alias_declaration" => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, qualified(scope, name, "::"), SymbolKind::Struct, node, src);
                }
            }
            "function_definition" => {
                if let Some(decl) = node.child_by_field_name("declarator")
                    && let Some(raw) = unwrap_c_declarator(decl, src)
                {
                    let short = raw.rsplit("::").next().unwrap_or(&raw).to_string();
                    let q = if raw.contains("::") { qualified(scope, &raw, "::") } else { qualified(scope, &short, "::") };
                    let kind = if in_class || raw.contains("::") { SymbolKind::Method } else { SymbolKind::Function };
                    push_sym(out, short, q, kind, node, src);
                }
                continue;
            }
            _ => {}
        }
        for i in (0..node.named_child_count()).rev() {
            if let Some(c) = node.named_child(i as u32) { stack.push(Step::Node(c, child_in_class)); }
        }
    }
}


