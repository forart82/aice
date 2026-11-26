use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, DepKind, IntraBlockSelector, LanguageAdapter, LanguageId,
    OutlineView, ParseError, ParsedTree, SliceError, SymbolKind, SymbolNode, SymbolSelector,
};

use crate::r5::cst_helpers::{
    child_kind_text, node_text, outline_from_symbols, push_sym, qualified,
    slice_symbol_from_list, visit_named_preorder, with_ts_root,
};
use crate::r5::dep_helpers::collect_schema_comment_deps;
use crate::ts_pool::parse_tree_sitter;

pub struct HtmlAdapter;

impl LanguageAdapter for HtmlAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::Html
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        parse_tree_sitter(LanguageId::Html, src)
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut out = Vec::new();
            let mut scope = Vec::new();
            walk_html(root, src, &mut scope, &mut out);
            out
        })
    }

    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut deps = Vec::new();
            walk_html_deps(root, src, &mut deps);
            collect_schema_comment_deps(src, "html", &mut deps);
            deps
        })
    }
}

impl AstSlicer for HtmlAdapter {
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

fn walk_html(root: tree_sitter::Node<'_>, src: &str, scope: &mut Vec<String>, out: &mut Vec<SymbolNode>) {
    enum Step<'a> { Node(tree_sitter::Node<'a>), Pop }
    let mut stack = vec![Step::Node(root)];
    while let Some(step) = stack.pop() {
        let Step::Node(node) = step else { scope.pop(); continue; };
        if matches!(node.kind(), "element" | "script_element" | "style_element")
            && let Some((tag, id_opt)) = extract_start_tag_info(node, src)
        {
            let label = id_opt.map(|id| format!("{tag}#{id}")).unwrap_or(tag);
            let qname = qualified(scope, &label, ".");
            push_sym(out, label.clone(), qname, SymbolKind::Block, node, src);
            scope.push(label);
            stack.push(Step::Pop);
            for i in (0..node.named_child_count()).rev() {
                if let Some(c) = node.named_child(i as u32) { stack.push(Step::Node(c)); }
            }
            continue;
        }
        for i in (0..node.named_child_count()).rev() {
            if let Some(c) = node.named_child(i as u32) { stack.push(Step::Node(c)); }
        }
    }
}

fn extract_start_tag_info(elem: tree_sitter::Node<'_>, src: &str) -> Option<(String, Option<String>)> {
    for i in 0..elem.named_child_count() {
        let c = elem.named_child(i as u32)?;
        if matches!(c.kind(), "start_tag" | "self_closing_tag") {
            let tag = child_kind_text(c, "tag_name", src)?.to_string();
            let id_opt = find_attr_value(c, "id", src);
            return Some((tag, id_opt));
        }
    }
    None
}

fn find_attr_value(tag_node: tree_sitter::Node<'_>, attr: &str, src: &str) -> Option<String> {
    for i in 0..tag_node.named_child_count() {
        if let Some(c) = tag_node.named_child(i as u32)
            && c.kind() == "attribute"
            && let Some(aname) = child_kind_text(c, "attribute_name", src)
            && aname.eq_ignore_ascii_case(attr)
        {
            let raw = child_kind_text(c, "quoted_attribute_value", src)
                .or_else(|| child_kind_text(c, "attribute_value", src))
                .or_else(|| Some(node_text(c, src)))?;
            return Some(raw.trim_matches(['"', '\'']).to_string());
        }
    }
    None
}

fn walk_html_deps(root: tree_sitter::Node<'_>, src: &str, deps: &mut Vec<DepEdge>) {
    visit_named_preorder(root, |node| {
        if matches!(node.kind(), "element" | "script_element") {
            for i in 0..node.named_child_count() {
                if let Some(c) = node.named_child(i as u32)
                    && matches!(c.kind(), "start_tag" | "self_closing_tag")
                    && let Some(tag) = child_kind_text(c, "tag_name", src)
                {
                    let attr = if tag.eq_ignore_ascii_case("script") {
                        Some("src")
                    } else if tag.eq_ignore_ascii_case("link") {
                        Some("href")
                    } else {
                        None
                    };
                    if let Some(attr_name) = attr
                        && let Some(target) = find_attr_value(c, attr_name, src)
                    {
                        deps.push(DepEdge { source: "html".to_string(), target, kind: DepKind::Import });
                    }
                }
            }
        }
    });
}
