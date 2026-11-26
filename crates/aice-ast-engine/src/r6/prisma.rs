use std::collections::HashSet;

use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, DepKind, IntraBlockSelector, LanguageAdapter, LanguageId,
    OutlineView, ParseError, ParsedTree, SliceError, SymbolKind, SymbolNode, SymbolSelector,
};

use crate::r5::checks::{ErrorSpan, collect_ts_error_spans, span_from_node};
use crate::r5::cst_helpers::{
    child_kind_text, outline_from_symbols, push_sym, slice_symbol_from_list, with_ts_root,
};
use crate::r6::sql_lex::{LineIndex, sp};
use crate::ts_pool::{GrammarSlot, ParserPool, with_parser_pool};

const PRISMA_SCALARS: [&str; 10] = [
    "Int", "String", "Boolean", "Float", "Decimal", "DateTime", "Json", "Bytes", "BigInt", "Unsupported",
];

pub struct PrismaAdapter;

impl LanguageAdapter for PrismaAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::Prisma
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        with_parser_pool(|pool| pool.parse_lang(LanguageId::Prisma, src))
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut out = Vec::new();
            let mut stack = vec![root];
            while let Some(node) = stack.pop() {
                let kind = match node.kind() {
                    "datasource_declaration" => Some(SymbolKind::Module),
                    "generator_declaration" => Some(SymbolKind::Constant),
                    "model_declaration" | "type_declaration" => Some(SymbolKind::Struct),
                    "view_declaration" => Some(SymbolKind::View),
                    "enum_declaration" => Some(SymbolKind::Enum),
                    _ => None,
                };
                if let Some(k) = kind
                    && let Some(name) = child_kind_text(node, "identifier", src)
                {
                    push_sym(&mut out, name, name, k, node, src);
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
            let mut stack: Vec<(tree_sitter::Node<'_>, String)> = vec![(root, String::new())];
            while let Some((node, scope)) = stack.pop() {
                let cur_scope = if matches!(node.kind(), "model_declaration" | "type_declaration" | "view_declaration") {
                    child_kind_text(node, "identifier", src).unwrap_or(&scope).to_string()
                } else {
                    scope
                };
                if node.kind() == "column_declaration" && !cur_scope.is_empty()
                    && let Some(ct) = find_descendant(node, "column_type")
                    && let Some(ty) = child_kind_text(ct, "identifier", src)
                    && !PRISMA_SCALARS.contains(&ty)
                    && seen.insert((cur_scope.clone(), ty.to_string()))
                {
                    out.push(DepEdge { source: cur_scope.clone(), target: ty.to_string(), kind: DepKind::TypeRef });
                }
                for i in (0..node.named_child_count()).rev() {
                    if let Some(c) = node.named_child(i as u32) { stack.push((c, cur_scope.clone())); }
                }
            }
            out
        })
    }
}

impl AstSlicer for PrismaAdapter {
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

fn find_descendant<'a>(node: tree_sitter::Node<'a>, kind: &str) -> Option<tree_sitter::Node<'a>> {
    let mut stack = vec![node];
    while let Some(n) = stack.pop() {
        if n.kind() == kind { return Some(n); }
        for i in (0..n.named_child_count()).rev() {
            if let Some(c) = n.named_child(i as u32) { stack.push(c); }
        }
    }
    None
}

pub fn verify_prisma_spans(src: &str, pool: &mut ParserPool) -> Vec<ErrorSpan> {
    let mut spans = match pool.parse_slot(GrammarSlot::Prisma, src) {
        Ok(tree) => {
            let mut s = collect_ts_error_spans(&tree, src);
            let mut stack = vec![tree.root_node()];
            while let Some(n) = stack.pop() {
                if n.kind() == "column_declaration" && find_descendant(n, "column_type").is_none() {
                    s.push(span_from_node(n, "Prisma field missing type".to_string()));
                }
                for i in (0..n.named_child_count()).rev() {
                    if let Some(c) = n.named_child(i as u32) { stack.push(c); }
                }
            }
            s
        }
        Err(e) => vec![sp(e.line, e.column, e.message)],
    };
    spans.extend(check_prisma_lines(src));
    spans
}

fn check_prisma_lines(src: &str) -> Vec<ErrorSpan> {
    let mut errs = Vec::new();
    let li = LineIndex::new(src);
    let b = src.as_bytes();
    let mut stack: Vec<(u8, usize, usize)> = Vec::new();
    let (mut i, mut in_str, mut in_blk) = (0usize, false, false);
    while i < b.len() {
        let (l, c) = li.line_col(i);
        if in_blk {
            if b[i] == b'*' && i + 1 < b.len() && b[i + 1] == b'/' { in_blk = false; i += 2; } else { i += 1; }
            continue;
        }
        if in_str {
            if b[i] == b'\\' && i + 1 < b.len() { i += 2; }
            else if b[i] == b'"' { in_str = false; i += 1; }
            else { i += 1; }
            continue;
        }
        if b[i] == b'/' && i + 1 < b.len() && b[i + 1] == b'/' { while i < b.len() && b[i] != b'\n' { i += 1; } continue; }
        if b[i] == b'/' && i + 1 < b.len() && b[i + 1] == b'*' { in_blk = true; i += 2; continue; }
        if b[i] == b'"' { in_str = true; i += 1; continue; }
        match b[i] {
            b'{' => stack.push((b'}', l, c)),
            b'(' => stack.push((b')', l, c)),
            b'[' => stack.push((b']', l, c)),
            b'}' | b')' | b']' if stack.pop().is_none_or(|(exp, _, _)| exp != b[i]) => {
                errs.push(sp(l, c, "Mismatched closing delimiter in Prisma schema"));
            }
            _ => {}
        }
        i += if b[i] >= 0x80 { src[i..].chars().next().map_or(1, char::len_utf8) } else { 1 };
    }
    if in_str { errs.push(sp(li.line_count(src), 1, "Unterminated string literal in Prisma")); }
    if in_blk { errs.push(sp(li.line_count(src), 1, "Unterminated block comment in Prisma")); }
    while let Some((exp, l, c)) = stack.pop() {
        let open = match exp { b'}' => '{', b')' => '(', _ => '[' };
        errs.push(sp(l, c, format!("Unclosed '{open}' in Prisma schema")));
    }
    let (mut in_model, mut nest, mut in_line_blk) = (false, 0usize, false);
    for (idx, raw) in src.lines().enumerate() {
        let stripped = strip_prisma_comments(raw, &mut in_line_blk);
        let line = stripped.trim();
        if line.is_empty() { continue; }
        if line.starts_with("model ") || line.starts_with("type ") || line.starts_with("view ") {
            if line.contains('{') && !line.contains('}') { in_model = true; }
            continue;
        }
        if line == "}" && nest == 0 { in_model = false; continue; }
        if line.ends_with('=') {
            errs.push(sp(idx + 1, 1, "Incomplete '=' assignment in Prisma schema"));
        } else if in_model && nest == 0 && !line.starts_with("@@") && line.split_whitespace().count() < 2 {
            errs.push(sp(idx + 1, 1, "Prisma model field missing type"));
        }
        for ch in line.bytes() {
            match ch { b'(' | b'[' => nest += 1, b')' | b']' => nest = nest.saturating_sub(1), _ => {} }
        }
    }
    errs
}

fn strip_prisma_comments(raw: &str, in_blk: &mut bool) -> String {
    let b = raw.as_bytes();
    let mut out = String::with_capacity(raw.len());
    let (mut i, mut in_str) = (0usize, false);
    while i < b.len() {
        if *in_blk {
            if b[i] == b'*' && i + 1 < b.len() && b[i + 1] == b'/' { *in_blk = false; i += 2; }
            else { i += 1; }
            continue;
        }
        if in_str {
            if b[i] == b'\\' && i + 1 < b.len() {
                let end = if b[i + 1] >= 0x80 { i + 1 + raw[i + 1..].chars().next().map_or(1, char::len_utf8) } else { i + 2 };
                out.push_str(&raw[i..end]);
                i = end;
                continue;
            }
            if b[i] == b'"' { in_str = false; }
            let step = if b[i] >= 0x80 { raw[i..].chars().next().map_or(1, char::len_utf8) } else { 1 };
            out.push_str(&raw[i..i + step]);
            i += step;
            continue;
        }
        if b[i] == b'/' && i + 1 < b.len() && b[i + 1] == b'/' { break; }
        if b[i] == b'/' && i + 1 < b.len() && b[i + 1] == b'*' { *in_blk = true; out.push(' '); i += 2; continue; }
        if b[i] == b'"' { in_str = true; }
        let step = if b[i] >= 0x80 { raw[i..].chars().next().map_or(1, char::len_utf8) } else { 1 };
        out.push_str(&raw[i..i + step]);
        i += step;
    }
    out
}
