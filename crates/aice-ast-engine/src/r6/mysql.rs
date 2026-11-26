use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, IntraBlockSelector, LanguageAdapter, LanguageId, OutlineView,
    ParseError, ParsedTree, RdNode, RdTree, SliceError, SymbolNode, SymbolSelector,
};

use crate::r5::checks::{ErrorSpan, collect_ts_error_spans};
use crate::r5::cst_helpers::{outline_from_symbols, slice_symbol_from_list};
use crate::r6::mysql_dml::{tokens_to_ts_sql, validate_mysql_dml};
use crate::r6::mysql_opt::{find_table_tail_start, is_query_start, validate_mysql_table_options};
use crate::r6::mysql_rd::{MYSQL_LEX, skip_routine_characteristics, split_mysql_batches};
use crate::r6::mysql_stmt::validate_mysql_routine;
use crate::r6::sql_expr::{check_delimiters, strip_comments};
use crate::r6::sql_lex::{LineIndex, SqlTok, SqlTokKind, lex_sql, sp};
use crate::r6::sql_symbols::{extract_rd_symbols, extract_sql_token_schema_deps, make_rd_node};
use crate::ts_pool::{GrammarSlot, ParserPool, with_parser_pool};

pub struct MySqlAdapter;

impl LanguageAdapter for MySqlAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::MySql
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        with_parser_pool(|pool| parse_mysql(src, pool))
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        match tree {
            ParsedTree::Rd(rd) => extract_rd_symbols(&rd.root, src),
            _ => Vec::new(),
        }
    }

    fn extract_dependencies(&self, _tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        extract_sql_token_schema_deps(src, "mysql", MYSQL_LEX)
    }
}

impl AstSlicer for MySqlAdapter {
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

pub fn parse_mysql(src: &str, pool: &mut ParserPool) -> Result<ParsedTree, ParseError> {
    let li = LineIndex::new(src);
    let mut nodes = Vec::new();
    let errs = verify_mysql_inner(src, &li, pool, &mut nodes);
    let err_msgs = errs.into_iter().map(|e| format!("L{}:{}: {}", e.line, e.column, e.message)).collect();
    let root = RdNode {
        kind: "mysql_program".to_string(),
        label: None,
        start_line: 1,
        end_line: li.line_count(src),
        start_byte: 0,
        end_byte: src.len(),
        children: nodes,
    };
    Ok(ParsedTree::Rd(RdTree { lang: LanguageId::MySql, root, errors: err_msgs }))
}

pub fn verify_mysql_spans(src: &str, pool: &mut ParserPool) -> Vec<ErrorSpan> {
    let li = LineIndex::new(src);
    let mut nodes = Vec::new();
    verify_mysql_inner(src, &li, pool, &mut nodes)
}

fn verify_mysql_inner(
    src: &str, li: &LineIndex, pool: &mut ParserPool, nodes: &mut Vec<RdNode>,
) -> Vec<ErrorSpan> {
    let mut errs = Vec::new();
    let chunks = split_mysql_batches(src, li, &mut errs);
    for ch in chunks {
        let sub = &src[ch.start..ch.end];
        let (base_l, base_c) = li.line_col(ch.start);
        let (toks, mut sub_errs, _) = lex_sql(sub, MYSQL_LEX);
        for e in &mut sub_errs {
            if e.line == 1 { e.column += base_c - 1; }
            e.line += base_l - 1;
            e.end_line += base_l - 1;
        }
        errs.extend(sub_errs);

        let mut clean = strip_comments(&toks);
        for t in &mut clean {
            if t.line == 1 { t.col += base_c - 1; }
            t.start += ch.start;
            t.end += ch.start;
            t.line += base_l - 1;
        }
        errs.extend(check_delimiters(&clean));
        if clean.is_empty() { continue; }

        if is_mysql_routine(&clean, src) {
            validate_mysql_routine(&clean, src, li, pool, &mut errs, nodes);
        } else {
            collect_non_routine_node(&clean, src, li, nodes);
            validate_mysql_stmt(&clean, src, pool, &mut errs);
        }
    }
    errs
}

pub(crate) fn mysql_ddl_object_idx(clean: &[SqlTok], src: &str) -> Option<usize> {
    if !clean.first().is_some_and(|t| t.is_kw(src, "CREATE")) { return None; }
    let mut i = 1usize;
    while i < clean.len() {
        let t = &clean[i];
        if t.is_kw(src, "OR") || t.is_kw(src, "REPLACE") || t.is_kw(src, "TEMPORARY")
            || t.is_kw(src, "UNIQUE") || t.is_kw(src, "FULLTEXT") || t.is_kw(src, "SPATIAL")
            || t.is_kw(src, "AGGREGATE")
        {
            i += 1;
        } else if t.is_kw(src, "DEFINER") && clean.get(i + 1).is_some_and(|n| n.is_op(src, "=")) {
            i += 2;
            if i < clean.len() { i += 1; }
            if clean.get(i).is_some_and(|n| n.kind == SqlTokKind::LParen)
                && clean.get(i + 1).is_some_and(|n| n.kind == SqlTokKind::RParen)
            {
                i += 2;
            }
            if clean.get(i).is_some_and(|n| n.kind == SqlTokKind::Var) { i += 1; }
            else if clean.get(i).is_some_and(|n| n.is_op(src, "@")) { i += 2.min(clean.len() - i); }
        } else if (t.is_kw(src, "ALGORITHM") && clean.get(i + 1).is_some_and(|n| n.is_op(src, "=")))
            || (t.is_kw(src, "SQL") && clean.get(i + 1).is_some_and(|n| n.is_kw(src, "SECURITY")))
        {
            i += 3.min(clean.len() - i);
        } else {
            break;
        }
    }
    (i < clean.len()).then_some(i)
}

fn is_mysql_routine(clean: &[SqlTok], src: &str) -> bool {
    mysql_ddl_object_idx(clean, src).is_some_and(|i| {
        let t = &clean[i];
        t.is_kw(src, "PROCEDURE") || t.is_kw(src, "FUNCTION")
            || t.is_kw(src, "TRIGGER") || t.is_kw(src, "EVENT")
    })
}

fn collect_non_routine_node(clean: &[SqlTok], src: &str, li: &LineIndex, nodes: &mut Vec<RdNode>) {
    let (Some(f), Some(l)) = (clean.first(), clean.last()) else { return; };
    if let Some(i) = mysql_ddl_object_idx(clean, src) {
        let kind = if clean[i].is_kw(src, "TABLE") { Some("table") }
            else if clean[i].is_kw(src, "VIEW") { Some("view") }
            else if clean[i].is_kw(src, "INDEX") { Some("index") }
            else { None };
        if let Some(k) = kind {
            let mut ni = i + 1;
            if clean.get(ni).is_some_and(|t| t.is_kw(src, "IF")) { ni += 3; }
            if let Some(tok) = clean.get(ni) {
                nodes.push(make_rd_node(k, Some(tok.ident_name(src)), f.start, l.end, li, src));
            }
        }
    } else if f.is_kw(src, "WITH") && let Some(name_tok) = clean.get(1) {
        nodes.push(make_rd_node("cte", Some(name_tok.ident_name(src)), f.start, l.end, li, src));
    }
}

fn validate_mysql_stmt(clean: &[SqlTok], src: &str, pool: &mut ParserPool, errs: &mut Vec<ErrorSpan>) {
    if clean.first().is_some_and(|t| t.is_kw(src, "ALTER"))
        && clean.get(1).is_some_and(|t| t.is_kw(src, "PROCEDURE") || t.is_kw(src, "FUNCTION"))
    {
        errs.extend(crate::r6::sql_expr::check_sql_stmt_completeness(clean, src));
        let mut i = 2usize;
        let is_ident = |t: &SqlTok| matches!(t.kind, SqlTokKind::Word | SqlTokKind::BacktickIdent | SqlTokKind::QuotedIdent);
        if clean.get(i).is_some_and(is_ident) {
            i += 1;
            if clean.get(i).is_some_and(|t| t.kind == SqlTokKind::Dot) {
                if !clean.get(i + 1).is_some_and(is_ident) {
                    errs.push(sp(clean[i].line, clean[i].col, "Expected routine name after '.'"));
                    return;
                }
                i += 2;
            }
            let end_i = skip_routine_characteristics(clean, i, src).unwrap_or(i);
            if end_i < clean.len() {
                errs.push(sp(clean[end_i].line, clean[end_i].col, format!("Unexpected token '{}' in ALTER routine", clean[end_i].slice(src))));
            }
        } else if let Some(bad) = clean.get(i) {
            errs.push(sp(bad.line, bad.col, format!("Expected routine name, found '{}'", bad.slice(src))));
        }
        return;
    }
    let obj_idx = mysql_ddl_object_idx(clean, src);
    let stripped;
    let stmt = if let Some(idx) = obj_idx
        && idx > 1
        && (clean[idx].is_kw(src, "VIEW") || clean[idx].is_kw(src, "TABLE"))
    {
        stripped = strip_pre_object_modifiers(clean, idx);
        stripped.as_slice()
    } else {
        clean
    };
    if obj_idx.is_some_and(|i| clean[i].is_kw(src, "TABLE"))
        && let Some(k) = find_table_tail_start(stmt, src)
    {
        if stmt[k].kind == SqlTokKind::LParen
            && !is_query_start(stmt, k, src)
            && let Some(rp) = matching_rparen(stmt, k)
        {
            let tail = &stmt[rp + 1..];
            if !tail.is_empty() && !tail[0].is_kw(src, "AS") && !tail[0].is_kw(src, "SELECT") && !tail[0].is_kw(src, "WITH") {
                if let Some(q_off) = validate_mysql_table_options(tail, src, errs) {
                    validate_mysql_dml(&tail[q_off..], src, pool, errs);
                }
                let s = tokens_to_ts_sql(&stmt[..=rp], src, errs);
                if let Ok(tree) = pool.parse_slot(GrammarSlot::Sql, &s) {
                    for mut spn in collect_ts_error_spans(&tree, &s) {
                        if spn.line == 1 { spn.column += stmt[0].col - 1; }
                        spn.line += stmt[0].line - 1;
                        spn.end_line += stmt[0].line - 1;
                        errs.push(spn);
                    }
                }
                errs.extend(crate::r6::sql_expr::check_sql_stmt_completeness(&stmt[..=rp], src));
                return;
            }
        } else if !stmt[k].is_kw(src, "LIKE")
            && ((stmt[k].is_kw(src, "AS") && stmt.get(k + 1).is_some_and(|n| n.kind == SqlTokKind::LParen))
                || (!stmt[k].is_kw(src, "AS") && !stmt[k].is_kw(src, "SELECT") && !stmt[k].is_kw(src, "WITH")))
        {
            for t in &stmt[2..k] {
                if t.kind == SqlTokKind::BacktickIdent && t.ident_name(src).is_empty() {
                    errs.push(sp(t.line, t.col, "Empty backtick identifier"));
                }
            }
            let tail = &stmt[k..];
            let prev_errs = errs.len();
            if let Some(q_off) = validate_mysql_table_options(tail, src, errs) {
                validate_mysql_dml(&tail[q_off..], src, pool, errs);
            } else if errs.len() == prev_errs {
                errs.push(sp(stmt[0].line, stmt[0].col, "Expected column definitions or query in CREATE TABLE"));
            }
            return;
        }
    }
    validate_mysql_dml(stmt, src, pool, errs);
}

fn strip_pre_object_modifiers(clean: &[SqlTok], obj_idx: usize) -> Vec<SqlTok> {
    let mut out = Vec::with_capacity(clean.len() - (obj_idx - 1));
    out.push(clean[0]);
    out.extend_from_slice(&clean[obj_idx..]);
    out
}

fn matching_rparen(toks: &[SqlTok], lp: usize) -> Option<usize> {
    let mut d = 0usize;
    for (idx, t) in toks.iter().enumerate().skip(lp) {
        if t.kind == SqlTokKind::LParen { d += 1; }
        else if t.kind == SqlTokKind::RParen { d -= 1; if d == 0 { return Some(idx); } }
    }
    None
}
