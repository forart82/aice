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

pub struct JavaAdapter;

impl LanguageAdapter for JavaAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::Java
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        parse_tree_sitter(LanguageId::Java, src)
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut out = Vec::new();
            let mut scope = Vec::new();
            walk_java(root, src, &mut scope, &mut out);
            out
        })
    }

    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        let syms = self.extract_symbols(tree, src);
        with_ts_root(tree, Vec::new(), |root| {
            let mut deps = Vec::new();
            walk_java_deps(root, src, &mut deps);
            augment_r5_deps(LanguageId::Java, root, src, &syms, &mut deps);
            deps
        })
    }
}

impl AstSlicer for JavaAdapter {
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

fn walk_java(root: tree_sitter::Node<'_>, src: &str, scope: &mut Vec<String>, out: &mut Vec<SymbolNode>) {
    enum Step<'a> { Node(tree_sitter::Node<'a>), Pop }
    let mut stack = vec![Step::Node(root)];
    while let Some(step) = stack.pop() {
        let Step::Node(node) = step else { scope.pop(); continue; };
        if node.kind() == "package_declaration" {
            if let Some(pkg) = child_kind_text(node, "scoped_identifier", src)
                .or_else(|| child_kind_text(node, "identifier", src))
            {
                let clean: String = strip_jvm_comments(pkg).split_whitespace().collect();
                if !clean.is_empty() {
                    push_sym(out, &clean, &clean, SymbolKind::Module, node, src);
                }
            }
            continue;
        }
        let type_kind = match node.kind() {
            "class_declaration" | "record_declaration" => Some(SymbolKind::Class),
            "interface_declaration" | "annotation_type_declaration" => Some(SymbolKind::Interface),
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
        if matches!(node.kind(), "method_declaration" | "constructor_declaration") {
            if let Some(name) = field_text(node, "name", src) {
                push_sym(out, name, qualified(scope, name, "."), SymbolKind::Method, node, src);
            }
            continue;
        }
        for i in (0..node.named_child_count()).rev() {
            if let Some(c) = node.named_child(i as u32) { stack.push(Step::Node(c)); }
        }
    }
}

pub(crate) fn strip_jvm_comments(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let b = s.as_bytes();
    let mut i = 0usize;
    while i < b.len() {
        if i + 1 < b.len() && b[i] == b'/' && b[i + 1] == b'*' {
            i += 2;
            while i < b.len() {
                if i + 1 < b.len() && b[i] == b'*' && b[i + 1] == b'/' {
                    i += 2;
                    break;
                }
                i += s[i..].chars().next().map_or(1, char::len_utf8);
            }
            out.push(' ');
        } else if i + 1 < b.len() && b[i] == b'/' && b[i + 1] == b'/' {
            while i < b.len() && b[i] != b'\n' {
                i += s[i..].chars().next().map_or(1, char::len_utf8);
            }
            out.push(' ');
        } else {
            let ch = s[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

fn walk_java_deps(root: tree_sitter::Node<'_>, src: &str, deps: &mut Vec<DepEdge>) {
    visit_named_preorder(root, |node| {
        if node.kind() == "import_declaration" {
            let raw_clean = child_kind_text(node, "scoped_identifier", src)
                .or_else(|| child_kind_text(node, "identifier", src))
                .map(|t| strip_jvm_comments(t).split_whitespace().collect::<String>())
                .unwrap_or_else(|| {
                    let c = strip_jvm_comments(node_text(node, src));
                    let mut s = c.trim();
                    if let Some(r) = s.strip_prefix("import")
                        && r.starts_with(char::is_whitespace)
                    {
                        s = r.trim_start();
                    }
                    if let Some(r) = s.strip_prefix("static")
                        && r.starts_with(char::is_whitespace)
                    {
                        s = r.trim_start();
                    }
                    s.trim_end_matches(';').split_whitespace().collect()
                });
            let has_star = (0..node.child_count())
                .filter_map(|i| node.child(i))
                .any(|c| matches!(c.kind(), "asterisk" | "*"));
            let target = if has_star && !raw_clean.is_empty() && !raw_clean.ends_with(".*") {
                format!("{raw_clean}.*")
            } else {
                raw_clean
            };
            if !target.is_empty() {
                deps.push(DepEdge { source: "class".to_string(), target, kind: DepKind::Import });
            }
        }
    });
}
