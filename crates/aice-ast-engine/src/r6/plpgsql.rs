use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, IntraBlockSelector, LanguageAdapter, LanguageId, OutlineView,
    ParseError, ParsedTree, RdNode, RdTree, SliceError, SymbolKind, SymbolNode, SymbolSelector,
};

use crate::r5::checks::{ErrorSpan, collect_ts_error_spans};
use crate::r5::cst_helpers::{outline_from_symbols, slice_symbol_from_list};
use crate::r6::plpgsql_rd::verify_plpgsql_body;
use crate::r6::sql_dep_scan::scan_sql_token_deps;
use crate::r6::sql_expr::{
    check_delimiters, check_sql_stmt_completeness, split_statements_semi, strip_comments,
    validate_and_mask_trim_calls,
};
use crate::r6::sql_lex::{LexOpts, SqlTok, SqlTokKind, lex_sql};
use crate::r6::sql_pratt_ext::check_pg_casts;
use crate::r6::sql_symbols::{
    extract_rd_deps, extract_rd_symbols, extract_sequel_deps, extract_sequel_symbols, make_rd_node,
};
use crate::r6::sql_upsert::validate_and_mask_upsert_clauses;
use crate::ts_pool::{GrammarSlot, ParserPool, with_parser_pool};

pub struct PostgreSqlAdapter;

impl LanguageAdapter for PostgreSqlAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::PostgreSql
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        with_parser_pool(|pool| parse_pg(src, pool))
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        match tree {
            ParsedTree::Rd(rd) => extract_rd_symbols(&rd.root, src),
            ParsedTree::TreeSitter { .. } => extract_sequel_symbols(tree, src),
            ParsedTree::PlainText { .. } => Vec::new(),
        }
    }

    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        match tree {
            ParsedTree::Rd(rd) => extract_rd_deps(&rd.root),
            ParsedTree::TreeSitter { .. } => extract_sequel_deps(tree, src),
            ParsedTree::PlainText { .. } => Vec::new(),
        }
    }
}

impl AstSlicer for PostgreSqlAdapter {
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

pub fn parse_pg(src: &str, pool: &mut ParserPool) -> Result<ParsedTree, ParseError> {
    let opts = LexOpts { allow_dollar: true, nested_block_comments: true, ..LexOpts::default() };
    let (toks, _, li) = lex_sql(src, opts);
    let clean = strip_comments(&toks);
    let masked = mask_do_blocks(src, &clean, None);
    let mut children = Vec::new();
    if let Ok(ts_tree) = pool.parse_slot(GrammarSlot::Sql, &masked) {
        let wrapped = ParsedTree::from_tree_sitter(LanguageId::PostgreSql, ts_tree);
        for s in extract_sequel_symbols(&wrapped, src) {
            children.push(RdNode {
                kind: rd_kind_str(s.kind).to_string(),
                label: Some(s.qualified_name),
                start_line: s.start_line,
                end_line: s.end_line,
                start_byte: s.start_byte,
                end_byte: s.end_byte,
                children: Vec::new(),
            });
        }
        for d in extract_sequel_deps(&wrapped, src) {
            children.push(make_rd_node("dep_ref", Some(format!("{}->{}", d.source, d.target)), 0, 0, &li, src));
        }
    }
    let mut dq_deps = Vec::new();
    let mut dq_seen = std::collections::HashSet::new();
    for (idx, tok) in clean.iter().enumerate() {
        if let SqlTokKind::DollarQuote { body_start, body_end } = tok.kind
            && idx > 0
            && (clean[idx - 1].is_kw(src, "AS")
                || clean[idx - 1].is_kw(src, "DO")
                || clean[idx - 1].is_kw(src, "PLPGSQL")
                || clean[idx - 1].is_kw(src, "SQL"))
            && let Some(body) = src.get(body_start..body_end)
        {
            scan_sql_token_deps(body, "pg", opts, true, 1, &mut dq_deps, &mut dq_seen);
        }
    }
    for d in dq_deps {
        children.push(make_rd_node("dep_ref", Some(format!("{}->{}", d.source, d.target)), 0, 0, &li, src));
    }
    let errs: Vec<String> = verify_pg_spans(src, pool)
        .into_iter()
        .map(|e| format!("L{}:{}: {}", e.line, e.column, e.message))
        .collect();
    let root = RdNode {
        kind: "pg_program".to_string(),
        label: None,
        start_line: 1,
        end_line: li.line_count(src),
        start_byte: 0,
        end_byte: src.len(),
        children,
    };
    Ok(ParsedTree::Rd(RdTree { lang: LanguageId::PostgreSql, root, errors: errs }))
}

pub fn verify_pg_spans(src: &str, pool: &mut ParserPool) -> Vec<ErrorSpan> {
    let opts = LexOpts { allow_dollar: true, nested_block_comments: true, ..LexOpts::default() };
    let (toks, mut errs, li) = lex_sql(src, opts);
    let clean = strip_comments(&toks);
    errs.extend(check_delimiters(&clean));

    let masked = mask_do_blocks(src, &clean, Some(&mut errs));
    if let Ok(tree) = pool.parse_slot(GrammarSlot::Sql, &masked) {
        errs.extend(collect_ts_error_spans(&tree, &masked));
    }
    for stmt in split_statements_semi(&clean) {
        if !stmt.first().is_some_and(|t| t.is_kw(src, "DO")) {
            errs.extend(check_sql_stmt_completeness(stmt, src));
        }
    }
    for (idx, tok) in clean.iter().enumerate() {
        if let SqlTokKind::DollarQuote { body_start, body_end } = tok.kind {
            let is_body = idx > 0
                && (clean[idx - 1].is_kw(src, "AS")
                    || clean[idx - 1].is_kw(src, "DO")
                    || clean[idx - 1].is_kw(src, "PLPGSQL")
                    || clean[idx - 1].is_kw(src, "SQL"));
            if is_body {
                let (bl, bc) = li.line_col(body_start);
                let body = &src[body_start..body_end];
                errs.extend(verify_plpgsql_body(body, bl, bc, pool));
            }
        }
    }
    errs
}

fn mask_do_blocks(src: &str, clean: &[SqlTok], mut errs: Option<&mut Vec<ErrorSpan>>) -> String {
    let mut bytes = src.as_bytes().to_vec();
    for tok in clean {
        if let SqlTokKind::DollarQuote { .. } = tok.kind
            && tok.end >= tok.start + 4
        {
            bytes[tok.start] = b'\'';
            for b in &mut bytes[tok.start + 1..tok.end - 1] {
                if *b != b'\n' { *b = b' '; }
            }
            bytes[tok.end - 1] = b'\'';
        }
    }
    for stmt in split_statements_semi(clean) {
        if stmt.first().is_some_and(|t| t.is_kw(src, "DO"))
            && let (Some(f), Some(l)) = (stmt.first(), stmt.last())
        {
            let end = if bytes.get(l.end) == Some(&b';') { l.end + 1 } else { l.end };
            for b in &mut bytes[f.start..end] {
                if *b != b'\n' { *b = b' '; }
            }
        } else if stmt.len() >= 4 && stmt[0].is_kw(src, "DROP") && (stmt[1].is_kw(src, "FUNCTION") || stmt[1].is_kw(src, "PROCEDURE"))
            && let (Some(lp), Some(rp)) = (stmt.iter().position(|t| t.kind == SqlTokKind::LParen), stmt.iter().rposition(|t| t.kind == SqlTokKind::RParen))
            && lp < rp
        {
            for b in &mut bytes[stmt[lp].start..stmt[rp].end] {
                if *b != b'\n' { *b = b' '; }
            }
        } else {
            let mut local_errs = Vec::new();
            for (s, e) in check_pg_casts(stmt, src, &mut local_errs) {
                for b in &mut bytes[s..e] {
                    if *b != b'\n' { *b = b' '; }
                }
            }
            validate_and_mask_trim_calls(stmt, src, &mut bytes, &mut local_errs);
            validate_and_mask_upsert_clauses(stmt, src, &mut bytes, &mut local_errs);
            if let Some(ref mut e) = errs {
                e.extend(local_errs);
            }
        }
    }
    String::from_utf8(bytes).unwrap_or_else(|_| src.to_string())
}

fn rd_kind_str(k: SymbolKind) -> &'static str {
    match k {
        SymbolKind::Table => "table",
        SymbolKind::View => "view",
        SymbolKind::Function => "function",
        SymbolKind::Procedure => "procedure",
        SymbolKind::Trigger => "trigger",
        SymbolKind::Query => "cte",
        SymbolKind::Enum => "enum",
        SymbolKind::Struct => "struct",
        _ => "block",
    }
}
