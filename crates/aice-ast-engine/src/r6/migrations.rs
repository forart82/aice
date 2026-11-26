use std::collections::HashSet;

use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, IntraBlockSelector, LanguageAdapter, LanguageId, OutlineView,
    ParseError, ParsedTree, RdNode, RdTree, SliceError, SymbolNode, SymbolSelector,
};

use crate::r5::checks::ErrorSpan;
use crate::r5::cst_helpers::{outline_from_symbols, slice_symbol_from_list};
use crate::r6::mig_detect::{MigDialect, detect_mig_dialect, mig_lex_opts};
use crate::r6::mysql::verify_mysql_spans;
use crate::r6::plpgsql::verify_pg_spans;
use crate::r6::sql_ansi::verify_ansi_spans;
use crate::r6::sql_dep_scan::scan_sql_token_deps;
use crate::r6::sql_expr::{check_delimiters, split_statements_semi, strip_comments};
use crate::r6::sql_lex::{LineIndex, SqlTok, SqlTokKind, lex_sql, sp};
use crate::r6::sql_symbols::{extract_rd_symbols, make_rd_node};
use crate::r6::sqlite::verify_sqlite_spans;
use crate::r6::tsql::verify_tsql_spans;
use crate::ts_pool::{ParserPool, with_parser_pool};

pub struct DbMigrationAdapter;

impl LanguageAdapter for DbMigrationAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::DbMigration
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        with_parser_pool(|pool| parse_migration(src, pool))
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        match tree {
            ParsedTree::Rd(rd) => extract_rd_symbols(&rd.root, src),
            _ => Vec::new(),
        }
    }

    fn extract_dependencies(&self, _tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        let li = LineIndex::new(src);
        let mut errs = Vec::new();
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        for sec in split_sections(src, &li, &mut errs) {
            let sub = &src[sec.start..sec.end];
            if !sub.trim().is_empty() {
                scan_sql_token_deps(sub, "migration", mig_lex_opts(detect_mig_dialect(sub)), false, 0, &mut out, &mut seen);
            }
        }
        out
    }
}

impl AstSlicer for DbMigrationAdapter {
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

pub fn parse_migration(src: &str, pool: &mut ParserPool) -> Result<ParsedTree, ParseError> {
    let li = LineIndex::new(src);
    let mut children = Vec::new();
    let errs = verify_migration_inner(src, &li, pool, &mut children);
    let err_msgs = errs.into_iter().map(|e| format!("L{}:{}: {}", e.line, e.column, e.message)).collect();
    let root = RdNode {
        kind: "db_migration".to_string(),
        label: None,
        start_line: 1,
        end_line: li.line_count(src),
        start_byte: 0,
        end_byte: src.len(),
        children,
    };
    Ok(ParsedTree::Rd(RdTree { lang: LanguageId::DbMigration, root, errors: err_msgs }))
}

pub fn verify_migration_spans(src: &str, pool: &mut ParserPool) -> Vec<ErrorSpan> {
    let li = LineIndex::new(src);
    let mut children = Vec::new();
    verify_migration_inner(src, &li, pool, &mut children)
}

struct Section {
    label: String,
    start: usize,
    end: usize,
    stmt_blocks: Vec<(usize, usize)>,
}

fn verify_migration_inner(
    src: &str, li: &LineIndex, pool: &mut ParserPool, children: &mut Vec<RdNode>,
) -> Vec<ErrorSpan> {
    let mut errs = Vec::new();
    let sections = split_sections(src, li, &mut errs);
    for sec in sections {
        let mut sec_node = make_rd_node("section", Some(sec.label.clone()), sec.start, sec.end, li, src);
        let sub = &src[sec.start..sec.end];
        if sub.trim().is_empty() {
            children.push(sec_node);
            continue;
        }
        let (base_l, _) = li.line_col(sec.start);
        validate_section_body(sub, sec.start, base_l, &sec.stmt_blocks, li, src, pool, &mut errs, &mut sec_node.children);
        children.push(sec_node);
    }
    errs
}

fn split_sections(src: &str, li: &LineIndex, errs: &mut Vec<ErrorSpan>) -> Vec<Section> {
    let mut sections: Vec<Section> = Vec::new();
    let mut cur_label = String::new();
    let mut cur_start = 0usize;
    let mut cur_blocks: Vec<(usize, usize)> = Vec::new();
    let mut stmt_begin: Option<(usize, usize, usize)> = None;
    let mut i = 0usize;

    while i < src.len() {
        let line_end = src[i..].find('\n').map_or(src.len(), |r| i + r);
        let trimmed = src[i..line_end].trim();
        let next_i = if line_end < src.len() { line_end + 1 } else { src.len() };
        let (line_no, _) = li.line_col(i);

        if let Some(lbl) = match_section_marker(trimmed) {
            if let Some((bl, bc, _)) = stmt_begin.take() {
                errs.push(sp(bl, bc, "Unclosed StatementBegin before next migration section"));
            }
            if !cur_label.is_empty() || !src[cur_start..i].trim().is_empty() {
                sections.push(Section {
                    label: if cur_label.is_empty() { "migration".to_string() } else { cur_label },
                    start: cur_start,
                    end: i,
                    stmt_blocks: std::mem::take(&mut cur_blocks),
                });
            }
            cur_label = lbl;
            cur_start = next_i;
        } else if is_stmt_begin(trimmed) {
            if stmt_begin.is_some() {
                errs.push(sp(line_no, 1, "Nested StatementBegin is not allowed"));
            } else {
                stmt_begin = Some((line_no, 1, next_i));
            }
        } else if is_stmt_end(trimmed) {
            if let Some((_, _, b_start)) = stmt_begin.take() {
                cur_blocks.push((b_start, i));
            } else {
                errs.push(sp(line_no, 1, "Unmatched StatementEnd without StatementBegin"));
            }
        }
        i = next_i;
    }
    if let Some((bl, bc, _)) = stmt_begin {
        errs.push(sp(bl, bc, "Unclosed StatementBegin without StatementEnd"));
    }
    if !cur_label.is_empty() || cur_start < src.len() {
        sections.push(Section {
            label: if cur_label.is_empty() { "migration".to_string() } else { cur_label },
            start: cur_start,
            end: src.len(),
            stmt_blocks: cur_blocks,
        });
    }
    sections
}

fn match_section_marker(trimmed: &str) -> Option<String> {
    let low = trimmed.to_ascii_lowercase();
    if low.starts_with("-- +goose up") || low.starts_with("-- +migrate up") || low.starts_with("-- migrate:up") {
        Some("Up".to_string())
    } else if low.starts_with("-- +goose down") || low.starts_with("-- +migrate down") || low.starts_with("-- migrate:down") {
        Some("Down".to_string())
    } else {
        low.strip_prefix("--changeset ")
            .map(|rest| format!("changeset {}", rest.split_whitespace().next().unwrap_or("")))
    }
}

fn is_stmt_begin(trimmed: &str) -> bool {
    let low = trimmed.to_ascii_lowercase();
    low.starts_with("-- +goose statementbegin") || low.starts_with("-- +migrate statementbegin")
}

fn is_stmt_end(trimmed: &str) -> bool {
    let low = trimmed.to_ascii_lowercase();
    low.starts_with("-- +goose statementend") || low.starts_with("-- +migrate statementend")
}

#[allow(clippy::too_many_arguments)]
fn validate_section_body(
    sub: &str, base_byte: usize, base_l: usize, stmt_blocks: &[(usize, usize)],
    li: &LineIndex, full_src: &str, pool: &mut ParserPool,
    errs: &mut Vec<ErrorSpan>, sec_children: &mut Vec<RdNode>,
) {
    let dialect = detect_mig_dialect(sub);
    let opts = mig_lex_opts(dialect);
    let (toks, lex_errs, _) = lex_sql(sub, opts);
    let clean = strip_comments(&toks);
    for mut e in lex_errs { e.line += base_l - 1; e.end_line += base_l - 1; errs.push(e); }
    for mut e in check_delimiters(&clean) { e.line += base_l - 1; e.end_line += base_l - 1; errs.push(e); }

    for stmt in split_statements_semi(&clean) {
        collect_mig_symbol(stmt, sub, base_byte, li, full_src, sec_children);
    }

    if !stmt_blocks.is_empty() {
        for &(bs, be) in stmt_blocks {
            let block_src = &full_src[bs..be];
            let (bl, _) = li.line_col(bs);
            run_dialect_verify(block_src, bl, pool, errs);
        }
        // Also validate tokens outside StatementBegin..StatementEnd
        let mut masked = full_src.as_bytes()[base_byte..base_byte + sub.len()].to_vec();
        for &(bs, be) in stmt_blocks {
            for b in &mut masked[bs - base_byte..be - base_byte] {
                if *b != b'\n' { *b = b' '; }
            }
        }
        let rest = String::from_utf8(masked).unwrap_or_default();
        if !rest.trim().is_empty() {
            run_dialect_verify(&rest, base_l, pool, errs);
        }
    } else {
        run_dialect_verify(sub, base_l, pool, errs);
    }
}

fn run_dialect_verify(sub: &str, base_l: usize, pool: &mut ParserPool, errs: &mut Vec<ErrorSpan>) {
    let mut sub_errs = match detect_mig_dialect(sub) {
        MigDialect::Postgres => verify_pg_spans(sub, pool),
        MigDialect::MySql => verify_mysql_spans(sub, pool),
        MigDialect::Sqlite => verify_sqlite_spans(sub, pool),
        MigDialect::TSql => verify_tsql_spans(sub),
        MigDialect::Ansi => verify_ansi_spans(sub, pool),
    };
    for e in &mut sub_errs {
        e.line += base_l - 1;
        e.end_line += base_l - 1;
    }
    errs.extend(sub_errs);
}

fn collect_mig_symbol(
    stmt: &[SqlTok], sub: &str, base_byte: usize, li: &LineIndex, full_src: &str, out: &mut Vec<RdNode>,
) {
    let (Some(f), Some(l)) = (stmt.first(), stmt.last()) else { return; };
    if f.is_kw(sub, "CREATE") {
        let mut i = 1usize;
        while i < stmt.len() && ["OR", "REPLACE", "ALTER", "TEMP", "TEMPORARY", "UNIQUE", "CONCURRENTLY", "UNLOGGED", "CLUSTERED", "NONCLUSTERED", "FULLTEXT", "SPATIAL"].iter().any(|k| stmt[i].is_kw(sub, k)) {
            i += 1;
        }
        let kind = if stmt.get(i).is_some_and(|t| t.is_kw(sub, "MATERIALIZED"))
            && stmt.get(i + 1).is_some_and(|t| t.is_kw(sub, "VIEW"))
        {
            i += 1;
            Some("view")
        } else if stmt.get(i).is_some_and(|t| t.is_kw(sub, "TABLE")) { Some("table") }
            else if stmt.get(i).is_some_and(|t| t.is_kw(sub, "VIEW")) { Some("view") }
            else if stmt.get(i).is_some_and(|t| t.is_kw(sub, "FUNCTION")) { Some("function") }
            else if stmt.get(i).is_some_and(|t| t.is_kw(sub, "PROCEDURE")) { Some("procedure") }
            else if stmt.get(i).is_some_and(|t| t.is_kw(sub, "TRIGGER")) { Some("trigger") }
            else if stmt.get(i).is_some_and(|t| t.is_kw(sub, "INDEX")) { Some("index") }
            else if stmt.get(i).is_some_and(|t| t.is_kw(sub, "TYPE")) { Some("type") }
            else { None };
        if let Some(k) = kind {
            let mut ni = i + 1;
            if stmt.get(ni).is_some_and(|t| t.is_kw(sub, "CONCURRENTLY")) { ni += 1; }
            if stmt.get(ni).is_some_and(|t| t.is_kw(sub, "IF")) { ni += 3; }
            if let Some(tok) = stmt.get(ni) && !tok.is_kw(sub, "ON") {
                let mut name = tok.ident_name(sub);
                let mut j = ni + 1;
                while stmt.get(j).is_some_and(|t| t.kind == SqlTokKind::Dot)
                    && let Some(n2) = stmt.get(j + 1)
                {
                    name = format!("{name}.{}", n2.ident_name(sub));
                    j += 2;
                }
                out.push(make_rd_node(k, Some(name), base_byte + f.start, base_byte + l.end, li, full_src));
            }
        }
    }
}
