use std::collections::HashSet;

use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, DepKind, IntraBlockSelector, LanguageAdapter, LanguageId,
    OutlineView, ParseError, ParsedTree, SliceError, SymbolNode, SymbolSelector,
};

use crate::r5::cst_helpers::{
    field_text, outline_from_symbols, slice_symbol_from_list, visit_named_preorder, with_ts_root,
};
use crate::r5::dep_helpers::augment_r5_deps;
use crate::r5::typescript::{extract_ts_deps, extract_ts_symbols};
use crate::ts_pool::parse_tree_sitter;

pub struct JavaScriptAdapter;

impl LanguageAdapter for JavaScriptAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::JavaScript
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        parse_tree_sitter(LanguageId::JavaScript, src)
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        extract_ts_symbols(tree, src)
    }

    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        let syms = self.extract_symbols(tree, src);
        let mut deps = extract_ts_deps(tree, src);
        with_ts_root(tree, (), |root| {
            walk_js_requires(root, src, &mut deps);
            augment_r5_deps(LanguageId::JavaScript, root, src, &syms, &mut deps);
        });
        deps
    }
}

impl AstSlicer for JavaScriptAdapter {
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

pub(crate) fn walk_js_requires(root: tree_sitter::Node<'_>, src: &str, deps: &mut Vec<DepEdge>) {
    let mut seen: HashSet<String> = deps
        .iter()
        .filter(|d| d.kind == DepKind::Import)
        .map(|d| d.target.clone())
        .collect();
    visit_named_preorder(root, |node| {
        if node.kind() == "call_expression"
            && field_text(node, "function", src) == Some("require")
            && let Some(args) = node.child_by_field_name("arguments")
            && let Some(arg) = (0..args.named_child_count())
                .filter_map(|i| args.named_child(i as u32))
                .find(|c| c.kind() != "comment")
            && let Some(clean) = static_js_string(arg, src)
            && seen.insert(clean.clone())
        {
            deps.push(DepEdge { source: "module".to_string(), target: clean, kind: DepKind::Import });
        }
    });
}

fn static_js_string(arg: tree_sitter::Node<'_>, src: &str) -> Option<String> {
    let text = crate::r5::cst_helpers::node_text(arg, src).trim();
    let inner = match arg.kind() {
        "string" => text
            .strip_prefix('"')
            .and_then(|s| s.strip_suffix('"'))
            .or_else(|| text.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')))?,
        "template_string" => {
            let has_subst = (0..arg.named_child_count()).any(|i| {
                arg.named_child(i as u32)
                    .is_some_and(|c| c.kind() == "template_substitution" || c.is_error())
            });
            if has_subst {
                return None;
            }
            text.strip_prefix('`').and_then(|s| s.strip_suffix('`'))?
        }
        _ => return None,
    };
    let clean = inner.trim();
    (!clean.is_empty()).then(|| clean.to_string())
}
