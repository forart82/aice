use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, IntraBlockSelector, LanguageAdapter, LanguageId, OutlineView,
    ParseError, ParsedTree, RdNode, RdTree, SliceError, SymbolNode, SymbolSelector,
};

use crate::r5::checks::ErrorSpan;
use crate::r5::cst_helpers::{outline_from_symbols, slice_symbol_from_list};
use crate::r6::sql_expr::{check_delimiters, check_sql_stmt_completeness, strip_comments};
use crate::r6::sql_lex::{LexOpts, LineIndex, SqlTok, SqlTokKind, lex_sql};
use crate::r6::sql_symbols::{extract_rd_symbols, extract_sql_token_schema_deps};
use crate::r6::sqlite_rd::{
    collect_sqlite_node, run_ts_on_tokens, validate_pragma, validate_sqlite_table,
    validate_sqlite_trigger,
};
use crate::ts_pool::{ParserPool, with_parser_pool};

const SQLITE_LEX: LexOpts = LexOpts {
    allow_brackets: true,
    allow_backtick: true,
    allow_dollar: false,
    allow_hash_comment: false,
    nested_block_comments: false,
    backslash_escape: false,
    allow_at_var: false,
};

pub struct SqliteAdapter;

impl LanguageAdapter for SqliteAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::Sqlite
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        with_parser_pool(|pool| parse_sqlite(src, pool))
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        match tree {
            ParsedTree::Rd(rd) => extract_rd_symbols(&rd.root, src),
            _ => Vec::new(),
        }
    }

    fn extract_dependencies(&self, _tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        extract_sql_token_schema_deps(src, "sqlite", SQLITE_LEX)
    }
}

impl AstSlicer for SqliteAdapter {
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

pub fn parse_sqlite(src: &str, pool: &mut ParserPool) -> Result<ParsedTree, ParseError> {
    let li = LineIndex::new(src);
    let mut nodes = Vec::new();
    let errs = verify_sqlite_inner(src, &li, pool, &mut nodes);
    let err_msgs = errs.into_iter().map(|e| format!("L{}:{}: {}", e.line, e.column, e.message)).collect();
    let root = RdNode {
        kind: "sqlite_program".to_string(),
        label: None,
        start_line: 1,
        end_line: li.line_count(src),
        start_byte: 0,
        end_byte: src.len(),
        children: nodes,
    };
    Ok(ParsedTree::Rd(RdTree { lang: LanguageId::Sqlite, root, errors: err_msgs }))
}

pub fn verify_sqlite_spans(src: &str, pool: &mut ParserPool) -> Vec<ErrorSpan> {
    let li = LineIndex::new(src);
    let mut nodes = Vec::new();
    verify_sqlite_inner(src, &li, pool, &mut nodes)
}

fn verify_sqlite_inner(
    src: &str, li: &LineIndex, pool: &mut ParserPool, nodes: &mut Vec<RdNode>,
) -> Vec<ErrorSpan> {
    let (toks, mut errs, _) = lex_sql(src, SQLITE_LEX);
    let clean = strip_comments(&toks);
    errs.extend(check_delimiters(&clean));

    for stmt in split_sqlite_statements(&clean, src) {
        if stmt.is_empty() { continue; }
        if stmt[0].is_kw(src, "PRAGMA") {
            validate_pragma(stmt, src, &mut errs);
        } else if is_trigger_stmt(stmt, src) {
            validate_sqlite_trigger(stmt, src, li, pool, &mut errs, nodes);
        } else if is_create_table_stmt(stmt, src) {
            validate_sqlite_table(stmt, src, li, pool, &mut errs, nodes);
        } else {
            collect_sqlite_node(stmt, src, li, nodes);
            errs.extend(check_sql_stmt_completeness(stmt, src));
            run_ts_on_tokens(stmt, src, pool, &mut errs);
        }
    }
    errs
}

fn split_sqlite_statements<'a>(toks: &'a [SqlTok], src: &str) -> Vec<&'a [SqlTok]> {
    let mut out = Vec::new();
    let mut start = 0usize;
    let mut depth = 0usize;
    let mut in_trigger = false;
    let mut in_begin = false;
    for (i, t) in toks.iter().enumerate() {
        if i == start && t.is_kw(src, "CREATE") {
            in_trigger = ddl_object_kw(&toks[i..], src).is_some_and(|k| k.eq_ignore_ascii_case("TRIGGER"));
            in_begin = false;
        }
        match t.kind {
            SqlTokKind::LParen | SqlTokKind::LBracket | SqlTokKind::LBrace => depth += 1,
            SqlTokKind::RParen | SqlTokKind::RBracket | SqlTokKind::RBrace => depth = depth.saturating_sub(1),
            _ if depth == 0 && in_trigger && t.is_kw(src, "BEGIN") => in_begin = true,
            _ if depth == 0 && in_begin && t.is_kw(src, "END") => in_begin = false,
            SqlTokKind::Semi if depth == 0 && !in_begin => {
                if start < i { out.push(&toks[start..i]); }
                start = i + 1;
                in_trigger = false;
            }
            _ => {}
        }
    }
    if start < toks.len() { out.push(&toks[start..]); }
    out
}

fn ddl_object_kw<'a>(stmt: &[SqlTok], src: &'a str) -> Option<&'a str> {
    if !stmt.first().is_some_and(|t| t.is_kw(src, "CREATE")) { return None; }
    let mut i = 1usize;
    while stmt.get(i).is_some_and(|t| {
        t.is_kw(src, "TEMP") || t.is_kw(src, "TEMPORARY") || t.is_kw(src, "UNIQUE")
    }) {
        i += 1;
    }
    stmt.get(i).filter(|t| t.kind == SqlTokKind::Word).map(|t| t.slice(src))
}

fn is_trigger_stmt(stmt: &[SqlTok], src: &str) -> bool {
    ddl_object_kw(stmt, src).is_some_and(|k| k.eq_ignore_ascii_case("TRIGGER"))
}

fn is_create_table_stmt(stmt: &[SqlTok], src: &str) -> bool {
    ddl_object_kw(stmt, src).is_some_and(|k| k.eq_ignore_ascii_case("TABLE"))
}

pub(crate) fn is_sqlite_ident(t: &SqlTok) -> bool {
    matches!(t.kind, SqlTokKind::Word | SqlTokKind::QuotedIdent | SqlTokKind::BacktickIdent | SqlTokKind::BracketIdent)
}

pub(crate) fn is_pragma_kw_val(t: &SqlTok, src: &str) -> bool {
    const VALS: &[&str] = &[
        "ON", "OFF", "DELETE", "TRUNCATE", "PERSIST", "MEMORY", "WAL",
        "NORMAL", "EXCLUSIVE", "NONE", "FULL", "INCREMENTAL", "YES", "NO",
    ];
    t.kind == SqlTokKind::Word && VALS.iter().any(|k| t.is_kw(src, k))
}
