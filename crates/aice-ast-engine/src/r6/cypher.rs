use std::borrow::Cow;
use std::collections::HashSet;

use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, DepKind, IntraBlockSelector, LanguageAdapter, LanguageId,
    OutlineView, ParseError, ParsedTree, SliceError, SymbolKind, SymbolNode, SymbolSelector,
};

use crate::r5::checks::{ErrorSpan, collect_ts_error_spans};
use crate::r5::cst_helpers::{
    node_text, outline_from_symbols, push_sym, slice_symbol_from_list, with_ts_root,
};
use crate::r6::cypher_rd::verify_cypher_rd_and_mask;
use crate::r6::sql_lex::sp;
use crate::ts_pool::{GrammarSlot, ParserPool, with_parser_pool};

pub struct CypherAdapter;

impl LanguageAdapter for CypherAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::Cypher
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        with_parser_pool(|pool| pool.parse_lang(LanguageId::Cypher, src))
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut out = Vec::new();
            let mut q_idx = 0usize;
            let mut stack = vec![root];
            while let Some(node) = stack.pop() {
                if node.kind() == "statement" {
                    q_idx += 1;
                    let name = first_cypher_label(node, src).unwrap_or_else(|| format!("query_{q_idx}"));
                    push_sym(&mut out, &name, &name, SymbolKind::Query, node, src);
                    continue;
                }
                for i in (0..node.named_child_count()).rev() {
                    if let Some(c) = node.named_child(i as u32) { stack.push(c); }
                }
            }
            out
        })
    }

    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut out = Vec::new();
            let mut seen = HashSet::new();
            let mut stack = vec![root];
            while let Some(node) = stack.pop() {
                if node.kind() == "procedure_name" {
                    let tgt = node_text(node, src).trim().to_string();
                    if !tgt.is_empty() && seen.insert((tgt.clone(), true)) {
                        out.push(DepEdge { source: "cypher".to_string(), target: tgt, kind: DepKind::Call });
                    }
                } else if node.kind() == "label_expression" {
                    let mut lstack = vec![node];
                    while let Some(ln) = lstack.pop() {
                        if ln.kind() == "identifier" {
                            let tgt = node_text(ln, src).trim().to_string();
                            if !tgt.is_empty() && seen.insert((tgt.clone(), false)) {
                                out.push(DepEdge { source: "cypher".to_string(), target: tgt, kind: DepKind::SchemaRef });
                            }
                        }
                        for i in (0..ln.named_child_count()).rev() {
                            if let Some(c) = ln.named_child(i as u32) { lstack.push(c); }
                        }
                    }
                    continue;
                }
                for i in (0..node.named_child_count()).rev() {
                    if let Some(c) = node.named_child(i as u32) { stack.push(c); }
                }
            }
            out
        })
    }
}

impl AstSlicer for CypherAdapter {
    fn slice_symbol(&self, tree: &ParsedTree, src: &str, sel: &SymbolSelector) -> Result<AstSlice, SliceError> {
        slice_symbol_from_list(&self.extract_symbols(tree, src), src, sel)
    }

    fn slice_intra_block(&self, tree: &ParsedTree, src: &str, sel: &IntraBlockSelector) -> Result<AstSlice, SliceError> {
        crate::intra_ast::slice_intra_block(tree, &self.extract_symbols(tree, src), src, sel)
    }

    fn outline(&self, tree: &ParsedTree, src: &str, depth: usize, include_types: bool) -> OutlineView {
        outline_from_symbols(&self.extract_symbols(tree, src), src, depth, include_types)
    }
}

fn first_cypher_label(stmt: tree_sitter::Node<'_>, src: &str) -> Option<String> {
    let mut stack = vec![stmt];
    while let Some(n) = stack.pop() {
        if n.kind() == "procedure_name" {
            let s = node_text(n, src).trim();
            if !s.is_empty() { return Some(s.to_string()); }
        }
        if n.kind() == "label_expression" {
            let mut lstack = vec![n];
            while let Some(ln) = lstack.pop() {
                if ln.kind() == "identifier" {
                    let s = node_text(ln, src).trim();
                    if !s.is_empty() { return Some(s.to_string()); }
                }
                for i in (0..ln.named_child_count()).rev() {
                    if let Some(c) = ln.named_child(i as u32) { lstack.push(c); }
                }
            }
        }
        for i in (0..n.named_child_count()).rev() {
            if let Some(c) = n.named_child(i as u32) { stack.push(c); }
        }
    }
    None
}

pub fn verify_cypher_spans(src: &str, pool: &mut ParserPool) -> Vec<ErrorSpan> {
    verify_cypher_spans_with_tree(src, pool).0
}

pub(crate) fn verify_cypher_spans_with_tree(
    src: &str,
    pool: &mut ParserPool,
) -> (Vec<ErrorSpan>, Option<tree_sitter::Tree>) {
    let rd = verify_cypher_rd_and_mask(src);
    let mut spans = Vec::new();
    let mut ts_tree = None;
    if rd.has_dml || rd.ddl_masks.is_empty() {
        let masked = mask_cypher_ddl(src, &rd.ddl_masks);
        match pool.parse_slot(GrammarSlot::Cypher, &masked) {
            Ok(tree) => {
                spans.extend(collect_ts_error_spans(&tree, &masked));
                ts_tree = Some(tree);
            }
            Err(e) => spans.push(sp(e.line, e.column, e.message)),
        }
    }
    spans.extend(rd.errs);
    (spans, ts_tree)
}

fn mask_cypher_ddl<'a>(src: &'a str, ranges: &[(usize, usize)]) -> Cow<'a, str> {
    if ranges.is_empty() {
        return Cow::Borrowed(src);
    }
    let mut bytes = src.as_bytes().to_vec();
    let len = bytes.len();
    for &(start, end) in ranges {
        for b in &mut bytes[start.min(len)..end.min(len)] {
            if *b != b'\n' {
                *b = b' ';
            }
        }
    }
    Cow::Owned(String::from_utf8(bytes).unwrap_or_else(|_| src.to_string()))
}
