use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, IntraBlockSelector, LanguageAdapter, LanguageId, OutlineView,
    ParseError, ParsedTree, SliceError, SymbolKind, SymbolNode, SymbolSelector,
};

use crate::r5::cst_helpers::{
    child_kind_text, outline_from_symbols, push_sym, qualified, slice_symbol_from_list,
    with_ts_root,
};
use crate::r5::dep_helpers::collect_schema_comment_deps;
use crate::ts_pool::{parse_dtd, parse_tree_sitter};

pub struct XmlAdapter;

impl LanguageAdapter for XmlAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::Xml
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        if starts_with_dtd_decl(src) {
            parse_dtd(src)
        } else {
            parse_tree_sitter(LanguageId::Xml, src)
        }
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut out = Vec::new();
            let mut scope = Vec::new();
            walk_xml(root, src, &mut scope, &mut out);
            out
        })
    }

    fn extract_dependencies(&self, _tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        let mut deps = Vec::new();
        collect_schema_comment_deps(src, "file", &mut deps);
        deps
    }
}

impl AstSlicer for XmlAdapter {
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

fn walk_xml(root: tree_sitter::Node<'_>, src: &str, scope: &mut Vec<String>, out: &mut Vec<SymbolNode>) {
    enum Step<'a> { Node(tree_sitter::Node<'a>), Pop }
    let mut stack = vec![Step::Node(root)];
    while let Some(step) = stack.pop() {
        let Step::Node(node) = step else { scope.pop(); continue; };
        match node.kind() {
            "element" => {
                if let Some(name) = xml_elem_name(node, src) {
                    let q = qualified(scope, &name, ".");
                    push_sym(out, name.clone(), q, SymbolKind::Block, node, src);
                    scope.push(name);
                    stack.push(Step::Pop);
                    for i in (0..node.named_child_count()).rev() {
                        if let Some(c) = node.named_child(i as u32) { stack.push(Step::Node(c)); }
                    }
                    continue;
                }
            }
            "elementdecl" | "AttlistDecl" => {
                if let Some(name) = child_kind_text(node, "Name", src) {
                    push_sym(out, name, name, SymbolKind::Struct, node, src);
                }
            }
            _ => {}
        }
        for i in (0..node.named_child_count()).rev() {
            if let Some(c) = node.named_child(i as u32) { stack.push(Step::Node(c)); }
        }
    }
}

fn xml_elem_name(elem: tree_sitter::Node<'_>, src: &str) -> Option<String> {
    for i in 0..elem.named_child_count() {
        if let Some(c) = elem.named_child(i as u32)
            && matches!(c.kind(), "STag" | "EmptyElemTag")
            && let Some(name) = child_kind_text(c, "Name", src)
        {
            return Some(name.to_string());
        }
    }
    None
}
fn starts_with_dtd_decl(src: &str) -> bool {
    let mut s = src.strip_prefix('\u{FEFF}').unwrap_or(src);
    loop {
        s = s.trim_start();
        if s.starts_with("<!--") {
            if let Some(end) = s[4..].find("-->") {
                s = &s[4 + end + 3..];
                continue;
            }
            return false;
        }
        break;
    }
    s.starts_with("<!ELEMENT")
        || s.starts_with("<!ATTLIST")
        || s.starts_with("<!ENTITY")
        || s.starts_with("<!NOTATION")
}
