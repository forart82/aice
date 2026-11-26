use std::collections::HashSet;

use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, DepKind, IntraBlockSelector, LanguageAdapter, LanguageId,
    OutlineView, ParseError, ParsedTree, RdNode, RdTree, SliceError, SymbolNode, SymbolSelector,
};

use crate::r5::checks::ErrorSpan;
use crate::r5::cst_helpers::{outline_from_symbols, slice_symbol_from_list};
use crate::r6::sql_expr::strip_comments;
use crate::r6::sql_lex::{LineIndex, SqlTokKind, lex_sql};
use crate::r6::sql_symbols::extract_rd_symbols;
use crate::r6::tsql_rd::{TSQL_LEX, parse_tsql_batch, split_tsql_batches};

pub struct TSqlAdapter;

impl LanguageAdapter for TSqlAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::TSql
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        parse_tsql(src)
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        match tree {
            ParsedTree::Rd(rd) => extract_rd_symbols(&rd.root, src),
            _ => Vec::new(),
        }
    }

    fn extract_dependencies(&self, _tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        extract_tsql_deps(src)
    }
}

impl AstSlicer for TSqlAdapter {
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

pub fn parse_tsql(src: &str) -> Result<ParsedTree, ParseError> {
    let li = LineIndex::new(src);
    let mut errs = Vec::new();
    let mut nodes = Vec::new();
    for (s, e) in split_tsql_batches(src, &li, &mut errs) {
        parse_tsql_batch(src, s, e, &li, &mut errs, &mut nodes);
    }
    let err_msgs = errs.into_iter().map(|e| format!("L{}:{}: {}", e.line, e.column, e.message)).collect();
    let root = RdNode {
        kind: "tsql_batch".to_string(),
        label: None,
        start_line: 1,
        end_line: li.line_count(src),
        start_byte: 0,
        end_byte: src.len(),
        children: nodes,
    };
    Ok(ParsedTree::Rd(RdTree { lang: LanguageId::TSql, root, errors: err_msgs }))
}

pub fn verify_tsql_spans(src: &str) -> Vec<ErrorSpan> {
    let li = LineIndex::new(src);
    let mut errs = Vec::new();
    let mut nodes = Vec::new();
    for (s, e) in split_tsql_batches(src, &li, &mut errs) {
        parse_tsql_batch(src, s, e, &li, &mut errs, &mut nodes);
    }
    errs
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TsqlCreateHdr {
    None,
    Pending,
    Trigger,
    Index,
}

fn extract_tsql_deps(src: &str) -> Vec<DepEdge> {
    let (toks, _, _) = lex_sql(src, TSQL_LEX);
    let clean = strip_comments(&toks);
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut hdr = TsqlCreateHdr::None;
    let mut in_merge = false;
    let mut i = 0usize;
    while i < clean.len() {
        if clean[i].kind == SqlTokKind::Semi {
            hdr = TsqlCreateHdr::None;
            in_merge = false;
        } else if clean[i].is_kw(src, "CREATE") {
            hdr = TsqlCreateHdr::Pending;
        } else if hdr == TsqlCreateHdr::Pending {
            if clean[i].is_kw(src, "TRIGGER") {
                hdr = TsqlCreateHdr::Trigger;
            } else if clean[i].is_kw(src, "INDEX") {
                hdr = TsqlCreateHdr::Index;
            } else if ["TABLE", "VIEW", "PROCEDURE", "PROC", "FUNCTION", "DATABASE", "SCHEMA", "TYPE"]
                .iter()
                .any(|k| clean[i].is_kw(src, k))
            {
                hdr = TsqlCreateHdr::None;
            }
        } else if hdr == TsqlCreateHdr::Index && clean[i].kind == SqlTokKind::LParen {
            hdr = TsqlCreateHdr::None;
        }
        if clean[i].is_kw(src, "MERGE") {
            in_merge = true;
        } else if clean[i].is_kw(src, "WHEN") {
            in_merge = false;
        }
        let is_trig_or_idx_on =
            matches!(hdr, TsqlCreateHdr::Trigger | TsqlCreateHdr::Index) && clean[i].is_kw(src, "ON");
        if is_trig_or_idx_on {
            hdr = TsqlCreateHdr::None;
        }
        let is_upd = clean[i].is_kw(src, "UPDATE")
            && hdr != TsqlCreateHdr::Trigger
            && !(i > 0
                && (clean[i - 1].kind == SqlTokKind::Comma
                    || ["ON", "FOR", "AFTER", "OF", "BEFORE", "OR"]
                        .iter()
                        .any(|k| clean[i - 1].is_kw(src, k))));
        let is_refs = clean[i].is_kw(src, "REFERENCES");
        let is_alter_tbl = clean[i].is_kw(src, "TABLE") && i > 0 && clean[i - 1].is_kw(src, "ALTER");
        let is_merge_using = in_merge && clean[i].is_kw(src, "USING");
        let is_bare_merge = clean[i].is_kw(src, "MERGE")
            && !clean.get(i + 1).is_some_and(|t| t.is_kw(src, "INTO") || t.is_kw(src, "TOP"));
        let is_ref = clean[i].is_kw(src, "FROM")
            || clean[i].is_kw(src, "JOIN")
            || clean[i].is_kw(src, "INTO")
            || is_refs
            || is_alter_tbl
            || is_upd
            || is_trig_or_idx_on
            || is_merge_using
            || is_bare_merge;
        let is_exec = clean[i].is_kw(src, "EXEC") || clean[i].is_kw(src, "EXECUTE");
        if (is_ref || is_exec) && let Some(first) = clean.get(i + 1)
            && matches!(first.kind, SqlTokKind::Word | SqlTokKind::BracketIdent | SqlTokKind::QuotedIdent)
            && !(is_upd
                && ["SET", "CASCADE", "NO", "RESTRICT", "ACTION", "ON", "AS", "OF"]
                    .iter()
                    .any(|k| first.is_kw(src, k)))
            && !(is_refs && (first.is_kw(src, "ON") || first.is_kw(src, "TO")))
            && !(is_trig_or_idx_on && (first.is_kw(src, "DATABASE") || first.is_kw(src, "ALL")))
        {
            let mut target = first.ident_name(src);
            let mut j = i + 2;
            while clean.get(j).is_some_and(|t| t.kind == SqlTokKind::Dot) && clean.get(j + 1).is_some() {
                target = format!("{target}.{}", clean[j + 1].ident_name(src));
                j += 2;
            }
            let kind = if is_exec { DepKind::Call } else { DepKind::SchemaRef };
            if !target.is_empty() && seen.insert((target.clone(), is_exec)) {
                out.push(DepEdge { source: "tsql".to_string(), target, kind });
            }
            i = j;
            continue;
        }
        i += 1;
    }
    out
}
