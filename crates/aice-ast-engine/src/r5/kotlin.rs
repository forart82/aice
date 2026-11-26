use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, DepKind, IntraBlockSelector, LanguageAdapter, LanguageId,
    OutlineView, ParseError, ParsedTree, SliceError, SymbolKind, SymbolNode, SymbolSelector,
};

use crate::r5::cst_helpers::{
    child_kind_text, field_text, node_text, outline_from_symbols, push_sym, qualified,
    slice_symbol_from_list, visit_named_preorder, with_ts_root,
};
use crate::r5::dep_helpers::augment_r5_deps;
use crate::ts_pool::parse_tree_sitter;

pub struct KotlinAdapter;

impl LanguageAdapter for KotlinAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::Kotlin
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        parse_tree_sitter(LanguageId::Kotlin, src)
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut out = Vec::new();
            let mut scope = Vec::new();
            walk_kt(root, src, &mut scope, &mut out);
            out
        })
    }

    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        let syms = self.extract_symbols(tree, src);
        with_ts_root(tree, Vec::new(), |root| {
            let mut deps = Vec::new();
            walk_kt_deps(root, src, &mut deps);
            augment_r5_deps(LanguageId::Kotlin, root, src, &syms, &mut deps);
            deps
        })
    }
}

impl AstSlicer for KotlinAdapter {
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

fn walk_kt(root: tree_sitter::Node<'_>, src: &str, scope: &mut Vec<String>, out: &mut Vec<SymbolNode>) {
    enum Step<'a> { Node(tree_sitter::Node<'a>), Pop }
    let mut stack = vec![Step::Node(root)];
    while let Some(step) = stack.pop() {
        let Step::Node(node) = step else { scope.pop(); continue; };
        match node.kind() {
            "package_header" => {
                if let Some(pkg) = child_kind_text(node, "qualified_identifier", src)
                    .or_else(|| child_kind_text(node, "identifier", src))
                {
                    let clean: String = crate::r5::java_lang::strip_jvm_comments(pkg)
                        .split_whitespace()
                        .collect();
                    if !clean.is_empty() {
                        push_sym(out, &clean, &clean, SymbolKind::Module, node, src);
                    }
                }
                continue;
            }
            "class_declaration" | "object_declaration" => {
                if let Some(name) = field_text(node, "name", src)
                    .or_else(|| child_kind_text(node, "type_identifier", src))
                    .or_else(|| child_kind_text(node, "simple_identifier", src))
                {
                    push_sym(out, name, qualified(scope, name, "."), SymbolKind::Class, node, src);
                    scope.push(name.to_string());
                    stack.push(Step::Pop);
                    for i in (0..node.named_child_count()).rev() {
                        if let Some(c) = node.named_child(i as u32) { stack.push(Step::Node(c)); }
                    }
                    continue;
                }
            }
            "companion_object" => {
                scope.push("Companion".to_string());
                stack.push(Step::Pop);
                for i in (0..node.named_child_count()).rev() {
                    if let Some(c) = node.named_child(i as u32) { stack.push(Step::Node(c)); }
                }
                continue;
            }
            "function_declaration" => {
                if let Some(name) = field_text(node, "name", src)
                    .or_else(|| child_kind_text(node, "simple_identifier", src))
                {
                    let kind = if scope.is_empty() { SymbolKind::Function } else { SymbolKind::Method };
                    push_sym(out, name, qualified(scope, name, "."), kind, node, src);
                }
                continue;
            }
            "property_declaration" => {
                if let Some(vname) = extract_kt_prop_name(node, src) {
                    push_sym(out, vname, qualified(scope, vname, "."), SymbolKind::Constant, node, src);
                }
                continue;
            }
            "type_alias" => {
                if let Some(name) = child_kind_text(node, "type_identifier", src) {
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

fn extract_kt_prop_name<'a>(node: tree_sitter::Node<'_>, src: &'a str) -> Option<&'a str> {
    for i in 0..node.named_child_count() {
        if let Some(c) = node.named_child(i as u32)
            && c.kind() == "variable_declaration"
        {
            return child_kind_text(c, "simple_identifier", src);
        }
    }
    None
}

fn walk_kt_deps(root: tree_sitter::Node<'_>, src: &str, deps: &mut Vec<DepEdge>) {
    visit_named_preorder(root, |node| {
        if matches!(node.kind(), "import" | "import_header") {
            let base = child_kind_text(node, "qualified_identifier", src)
                .or_else(|| child_kind_text(node, "identifier", src))
                .map(|t| {
                    crate::r5::java_lang::strip_jvm_comments(t)
                        .split_whitespace()
                        .collect::<String>()
                })
                .unwrap_or_else(|| {
                    let c = crate::r5::java_lang::strip_jvm_comments(node_text(node, src));
                    let s = c.trim().strip_prefix("import").map_or(c.trim(), str::trim_start);
                    s.trim_end_matches(';').split_whitespace().collect()
                });
            let has_star = (0..node.child_count())
                .filter_map(|i| node.child(i))
                .any(|c| matches!(c.kind(), "asterisk" | "*" | "wildcard_import"));
            let target = if has_star && !base.is_empty() && !base.ends_with(".*") {
                format!("{base}.*")
            } else {
                base
            };
            if !target.is_empty() {
                deps.push(DepEdge { source: "kotlin".to_string(), target, kind: DepKind::Import });
            }
        }
    });
}
