use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, IntraBlockSelector, LanguageAdapter, LanguageId, OutlineView,
    ParseError, ParsedTree, RdNode, RdTree, SliceError, SymbolNode, SymbolSelector,
};

use crate::r5::checks::ErrorSpan;
use crate::r5::cst_helpers::{outline_from_symbols, slice_symbol_from_list};
use crate::r5::twig_html::verify_twig_html;
use crate::r5::twig_lexer::{TwigTok, TwigTokKind, err_sp, scan_twig_tokens};
use crate::r5::twig_rd::{collect_rd_deps, collect_rd_symbols};
use crate::r5::twig_tags::{BlockFrame, handle_tag, push_leaf};
use crate::ts_pool::ParserPool;

pub struct TwigAdapter;

impl LanguageAdapter for TwigAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::Twig
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        let (tokens, _spans, mut errors) = scan_twig_tokens(src);
        let root = parse_twig_tree(src, &tokens, &mut errors);
        let err_msgs = errors
            .into_iter()
            .map(|e| format!("L{}:{}: {}", e.line, e.column, e.message))
            .collect();
        Ok(ParsedTree::Rd(RdTree {
            lang: LanguageId::Twig,
            root,
            errors: err_msgs,
        }))
    }

    fn extract_symbols(&self, tree: &ParsedTree, _src: &str) -> Vec<SymbolNode> {
        let ParsedTree::Rd(rd) = tree else {
            return Vec::new();
        };
        let mut syms = Vec::new();
        collect_rd_symbols(&rd.root, &mut syms);
        syms
    }

    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        let ParsedTree::Rd(rd) = tree else {
            return Vec::new();
        };
        let mut deps = Vec::new();
        collect_rd_deps(&rd.root, &mut deps);
        crate::r5::dep_helpers::collect_schema_comment_deps(src, "template", &mut deps);
        deps
    }
}

impl AstSlicer for TwigAdapter {
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

pub fn verify_twig_spans(src: &str, pool: &mut ParserPool) -> Vec<ErrorSpan> {
    let (tokens, spans, mut errors) = scan_twig_tokens(src);
    let _root = parse_twig_tree(src, &tokens, &mut errors);
    let has_branches = tokens.iter().any(|t| {
        matches!(
            &t.kind,
            TwigTokKind::Tag { keyword, .. }
                if matches!(keyword.as_str(), "if" | "for" | "elseif" | "else")
        )
    });
    errors.extend(verify_twig_html(src, &tokens, &spans, has_branches, pool));
    errors
}

fn parse_twig_tree(src: &str, tokens: &[TwigTok], errors: &mut Vec<ErrorSpan>) -> RdNode {
    let mut stack = vec![BlockFrame {
        kind: "twig_template",
        label: None,
        line: 1,
        start_byte: 0,
        saw_else: false,
        children: Vec::new(),
    }];

    for tok in tokens {
        match &tok.kind {
            TwigTokKind::Comment => push_leaf(&mut stack, "twig_comment", None, tok),
            TwigTokKind::Output => push_leaf(&mut stack, "twig_output", None, tok),
            TwigTokKind::Tag { keyword, rest } => {
                handle_tag(keyword, rest, tok, &mut stack, errors);
            }
        }
    }

    while stack.len() > 1 {
        let frame = stack.pop().expect("len > 1");
        let name = frame.kind.trim_start_matches("twig_");
        errors.push(err_sp(
            frame.line,
            1,
            format!("Unclosed Twig {{% {name} %}} block"),
        ));
        let end_line = src.lines().count().max(frame.line);
        let node = RdNode {
            kind: frame.kind.to_string(),
            label: frame.label,
            start_line: frame.line,
            end_line,
            start_byte: frame.start_byte,
            end_byte: src.len(),
            children: frame.children,
        };
        stack.last_mut().expect("root").children.push(node);
    }

    let root = stack.pop().expect("root");
    RdNode {
        kind: "twig_template".to_string(),
        label: None,
        start_line: 1,
        end_line: src.lines().count().max(1),
        start_byte: 0,
        end_byte: src.len(),
        children: root.children,
    }
}
