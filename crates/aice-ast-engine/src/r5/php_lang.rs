use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, DepKind, IntraBlockSelector, LanguageAdapter, LanguageId,
    OutlineView, ParseError, ParsedTree, SliceError, SymbolKind, SymbolNode, SymbolSelector,
};

use crate::r5::cst_helpers::{
    child_kind_text, field_text, node_text, outline_from_symbols, push_sym, qualified,
    slice_symbol_from_list, visit_named_preorder, with_ts_root,
};
use crate::r5::dep_helpers::augment_r5_deps;
use crate::ts_pool::{parse_php_only, parse_tree_sitter};

pub struct PhpAdapter;

impl LanguageAdapter for PhpAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::Php
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        if src.contains("<?") {
            parse_tree_sitter(LanguageId::Php, src)
        } else {
            parse_php_only(src)
        }
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut out = Vec::new();
            let mut scope = Vec::new();
            walk_php(root, src, &mut scope, &mut out);
            out
        })
    }

    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        let syms = self.extract_symbols(tree, src);
        with_ts_root(tree, Vec::new(), |root| {
            let mut deps = Vec::new();
            walk_php_deps(root, src, &mut deps);
            augment_r5_deps(LanguageId::Php, root, src, &syms, &mut deps);
            deps
        })
    }
}

impl AstSlicer for PhpAdapter {
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

fn walk_php(root: tree_sitter::Node<'_>, src: &str, scope: &mut Vec<String>, out: &mut Vec<SymbolNode>) {
    enum Step<'a> { Node(tree_sitter::Node<'a>), Pop }
    let mut stack = vec![Step::Node(root)];
    while let Some(step) = stack.pop() {
        let Step::Node(node) = step else { scope.pop(); continue; };
        let type_kind = match node.kind() {
            "namespace_definition" => Some(SymbolKind::Module),
            "class_declaration" => Some(SymbolKind::Class),
            "interface_declaration" => Some(SymbolKind::Interface),
            "trait_declaration" => Some(SymbolKind::Trait),
            "enum_declaration" => Some(SymbolKind::Enum),
            _ => None,
        };
        if let Some(kind) = type_kind && let Some(name) = field_text(node, "name", src) {
            push_sym(out, name, qualified(scope, name, "::"), kind, node, src);
            scope.push(name.to_string());
            stack.push(Step::Pop);
            for i in (0..node.named_child_count()).rev() {
                if let Some(c) = node.named_child(i as u32) { stack.push(Step::Node(c)); }
            }
            continue;
        }
        match node.kind() {
            "function_definition" => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, qualified(scope, name, "::"), SymbolKind::Function, node, src);
                }
                continue;
            }
            "method_declaration" => {
                if let Some(name) = field_text(node, "name", src) {
                    push_sym(out, name, qualified(scope, name, "::"), SymbolKind::Method, node, src);
                }
                continue;
            }
            "const_element" => {
                if let Some(name) = node.named_child(0).map(|n| node_text(n, src).trim()) {
                    push_sym(out, name, qualified(scope, name, "::"), SymbolKind::Constant, node, src);
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

pub(crate) fn strip_php_comments(s: &str) -> String {
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
        } else if (i + 1 < b.len() && b[i] == b'/' && b[i + 1] == b'/') || b[i] == b'#' {
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

fn walk_php_deps(root: tree_sitter::Node<'_>, src: &str, deps: &mut Vec<DepEdge>) {
    visit_named_preorder(root, |node| match node.kind() {
        "namespace_use_declaration" => {
            let clean = strip_php_comments(node_text(node, src));
            let text = clean.trim().trim_end_matches(';').trim();
            if !text.is_empty() {
                deps.push(DepEdge { source: "php".to_string(), target: format!("use:{text}"), kind: DepKind::Import });
            }
        }
        "require_expression"
        | "require_once_expression"
        | "include_expression"
        | "include_once_expression" => {
            if let Some(path) = extract_php_include_path(node, src) {
                deps.push(DepEdge { source: "php".to_string(), target: path, kind: DepKind::Import });
            }
        }
        _ => {}
    });
}

fn extract_php_include_path(node: tree_sitter::Node<'_>, src: &str) -> Option<String> {
    let mut cur = node.named_child(0)?;
    while cur.kind() == "parenthesized_expression" {
        cur = cur.named_child(0)?;
    }
    if cur.kind() == "binary_expression"
        && let Some(left) = cur.child_by_field_name("left")
        && node_text(left, src).trim() == "__DIR__"
        && let Some(right) = cur.child_by_field_name("right")
    {
        return extract_php_str(right, src)
            .map(|s| s.trim_start_matches('/').to_string())
            .filter(|s| !s.is_empty());
    }
    extract_php_str(cur, src)
}

fn extract_php_str(node: tree_sitter::Node<'_>, src: &str) -> Option<String> {
    if matches!(node.kind(), "string" | "encapsed_string") {
        let s = child_kind_text(node, "string_content", src)
            .unwrap_or_else(|| node_text(node, src).trim_matches(['"', '\'']))
            .trim();
        if !s.is_empty() {
            return Some(s.to_string());
        }
    }
    None
}
