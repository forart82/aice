use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, IntraBlockSelector, LanguageAdapter, LanguageId, OutlineView,
    ParseError, ParsedTree, SliceError, SymbolNode, SymbolSelector,
};

use crate::r5::checks::{ErrorSpan, collect_ts_error_spans};
use crate::r5::cst_helpers::{outline_from_symbols, slice_symbol_from_list};
use crate::r6::sql_expr::{
    check_delimiters, check_sql_stmt_completeness, split_statements_semi, strip_comments,
    validate_and_mask_trim_calls,
};
use crate::r6::sql_lex::{LexOpts, SqlTokKind, lex_sql};
use crate::r6::sql_symbols::{extract_sequel_deps, extract_sequel_symbols};
use crate::r6::sql_upsert::validate_and_mask_upsert_clauses;
use crate::ts_pool::{GrammarSlot, ParserPool, with_parser_pool};

pub struct AnsiSqlAdapter;

impl LanguageAdapter for AnsiSqlAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::AnsiSql
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        with_parser_pool(|pool| parse_ansi(src, pool))
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        extract_sequel_symbols(tree, src)
    }

    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        extract_sequel_deps(tree, src)
    }
}

impl AstSlicer for AnsiSqlAdapter {
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

fn prepare_ansi_masked(src: &str, errs: &mut Vec<ErrorSpan>, mask_upsert: bool) -> String {
    let (toks, lex_errs, _) = lex_sql(src, LexOpts::default());
    errs.extend(lex_errs);
    let clean = strip_comments(&toks);
    errs.extend(check_delimiters(&clean));
    let mut masked = src.as_bytes().to_vec();
    for stmt in split_statements_semi(&clean) {
        errs.extend(check_sql_stmt_completeness(stmt, src));
        if stmt.len() >= 4 && stmt[0].is_kw(src, "DROP") && (stmt[1].is_kw(src, "FUNCTION") || stmt[1].is_kw(src, "PROCEDURE"))
            && let (Some(lp), Some(rp)) = (stmt.iter().position(|t| t.kind == SqlTokKind::LParen), stmt.iter().rposition(|t| t.kind == SqlTokKind::RParen))
            && lp < rp
        {
            for b in &mut masked[stmt[lp].start..stmt[rp].end] {
                if *b != b'\n' { *b = b' '; }
            }
        } else {
            validate_and_mask_trim_calls(stmt, src, &mut masked, errs);
            if mask_upsert {
                validate_and_mask_upsert_clauses(stmt, src, &mut masked, errs);
            }
        }
    }
    String::from_utf8(masked).unwrap_or_else(|_| src.to_string())
}

pub(crate) fn parse_ansi(src: &str, pool: &mut ParserPool) -> Result<ParsedTree, ParseError> {
    let mut ignored = Vec::new();
    let norm = prepare_ansi_masked(src, &mut ignored, false);
    pool.parse_lang(LanguageId::AnsiSql, &norm)
}

pub fn verify_ansi_spans(src: &str, pool: &mut ParserPool) -> Vec<ErrorSpan> {
    let mut errs = Vec::new();
    let norm = prepare_ansi_masked(src, &mut errs, true);
    let mut spans = match pool.parse_slot(GrammarSlot::Sql, &norm) {
        Ok(tree) => collect_ts_error_spans(&tree, &norm),
        Err(e) => vec![ErrorSpan {
            line: e.line,
            column: e.column,
            end_line: e.line,
            message: e.message,
        }],
    };
    spans.extend(errs);
    spans
}
