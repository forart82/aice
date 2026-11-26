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
            TwigTokKind::Output => {
                validate_twig_pipes(src, tok, errors);
                push_leaf(&mut stack, "twig_output", None, tok);
            }
            TwigTokKind::Tag { keyword, rest } => {
                if !matches!(keyword.as_str(), "verbatim" | "endverbatim") {
                    validate_twig_pipes(src, tok, errors);
                }
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

fn validate_twig_pipes(src: &str, tok: &TwigTok, errors: &mut Vec<ErrorSpan>) {
    let raw = src.get(tok.start_byte..tok.end_byte).unwrap_or("");
    let b = raw.as_bytes();
    if b.len() < 4 || !b.contains(&b'|') {
        return;
    }
    let open = if b.get(2) == Some(&b'-') { 3 } else { 2 };
    let close = if b.len() >= open + 3 && b[b.len() - 3] == b'-' { 3 } else { 2 };
    let end = b.len().saturating_sub(close);
    if open >= end {
        return;
    }
    let (mut line, mut col) = (tok.line, tok.col + open);
    scan_twig_pipe_expr(&b[open..end], &mut 0, &mut line, &mut col, false, errors);
}

fn scan_twig_pipe_expr(
    b: &[u8],
    i: &mut usize,
    line: &mut usize,
    col: &mut usize,
    stop_on_rbrace: bool,
    errors: &mut Vec<ErrorSpan>,
) {
    let mut brace_d = 0usize;
    let mut prev_sig: Option<u8> = None;
    while *i < b.len() {
        let ch = b[*i];
        if ch == b'\'' || ch == b'"' {
            let quote = ch;
            adv_byte(ch, i, line, col);
            while *i < b.len() {
                if b[*i] == b'\\' {
                    adv_byte(b[*i], i, line, col);
                    if *i < b.len() {
                        adv_byte(b[*i], i, line, col);
                    }
                    continue;
                }
                if quote == b'"' && b[*i..].starts_with(b"#{") {
                    adv_byte(b'#', i, line, col);
                    adv_byte(b'{', i, line, col);
                    scan_twig_pipe_expr(b, i, line, col, true, errors);
                    continue;
                }
                let q = b[*i];
                adv_byte(q, i, line, col);
                if q == quote {
                    break;
                }
            }
            prev_sig = Some(quote);
            continue;
        }
        if stop_on_rbrace {
            if ch == b'{' {
                brace_d += 1;
            } else if ch == b'}' {
                adv_byte(ch, i, line, col);
                if brace_d == 0 {
                    return;
                }
                brace_d -= 1;
                prev_sig = Some(b'}');
                continue;
            }
        }
        if ch == b'|' {
            let bad_lhs = prev_sig.is_none_or(|p| matches!(p, b'(' | b'[' | b'{' | b',' | b':' | b'?' | b'|'));
            let mut k = *i + 1;
            while k < b.len() && b[k].is_ascii_whitespace() {
                k += 1;
            }
            let has_filter_ident = b
                .get(k)
                .is_some_and(|&c| c.is_ascii_alphabetic() || c == b'_' || c >= 0x80);
            if bad_lhs || !has_filter_ident {
                errors.push(err_sp(*line, *col, "Dangling '|' filter operator in Twig expression"));
            }
            prev_sig = Some(b'|');
            adv_byte(ch, i, line, col);
            continue;
        }
        if !ch.is_ascii_whitespace() {
            prev_sig = Some(ch);
        }
        adv_byte(ch, i, line, col);
    }
}

fn adv_byte(ch: u8, i: &mut usize, line: &mut usize, col: &mut usize) {
    if ch == b'\n' {
        *line += 1;
        *col = 1;
    } else {
        *col += 1;
    }
    *i += 1;
}
