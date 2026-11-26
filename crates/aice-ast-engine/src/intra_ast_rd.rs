use std::cmp::Reverse;

use aice_lang_registry::{IntraBlockKind, IntraBlockNode, LanguageId, RdNode, RdTree};

use crate::intra_ast_rd_sql::{RdSqlDialect, extract_sql_blocks, push_rd_node};
use crate::intra_ast_rd_twig::extract_twig_blocks;
use crate::r6::mig_detect::{MigDialect, detect_mig_dialect, mig_lex_opts};
use crate::r6::sql_lex::{LexOpts, LineIndex, SqlTok, SqlTokKind, lex_sql};
use crate::r6::tsql_rd::split_tsql_batches;

pub(crate) fn extract_rd_intra_blocks(rd: &RdTree, src: &str) -> Vec<IntraBlockNode> {
    let mut out = Vec::new();
    let li = LineIndex::new(src);
    match rd.lang {
        LanguageId::Twig => extract_twig_blocks(&rd.root, src, &li, &mut out),
        LanguageId::PostgreSql => extract_pg_blocks(src, 0, src, &li, &mut out),
        LanguageId::TSql => extract_tsql_blocks(src, 0, src, &li, &mut out),
        LanguageId::MySql => {
            let masked = mask_delimiter_lines(src);
            extract_sql_chunk(&masked, 0, RdSqlDialect::MySql, src, &li, &mut out);
        }
        LanguageId::Sqlite => extract_sql_chunk(src, 0, RdSqlDialect::Sqlite, src, &li, &mut out),
        LanguageId::DbMigration => extract_migration_blocks(&rd.root, src, &li, &mut out),
        _ => {}
    }
    out.sort_by_key(|b| (b.start_byte, Reverse(b.end_byte), b.kind as u8));
    out.dedup_by(|a, b| a.kind == b.kind && a.start_byte == b.start_byte && a.end_byte == b.end_byte);
    out
}

fn extract_pg_blocks(
    sub: &str,
    base: usize,
    full: &str,
    li: &LineIndex,
    out: &mut Vec<IntraBlockNode>,
) {
    let opts = LexOpts { allow_dollar: true, nested_block_comments: true, ..LexOpts::default() };
    let (toks, _, _) = lex_sql(sub, opts);
    let clean: Vec<SqlTok> = toks.into_iter().filter(|t| t.kind != SqlTokKind::Comment).collect();
    extract_ctes_and_subqueries(sub, base, &clean, full, li, out);
    extract_sql_blocks(sub, base, &clean, RdSqlDialect::PgPlsql, full, li, out);

    for (i, tok) in clean.iter().enumerate() {
        if let SqlTokKind::DollarQuote { body_start, body_end } = tok.kind
            && let Some(body) = sub.get(body_start..body_end)
        {
            if i > 0 && clean[i - 1].is_kw(sub, "DO") {
                push_rd_node(IntraBlockKind::RuleBlock, "DO", base + clean[i - 1].start, base + tok.end, full, li, out);
            }
            let (btoks, _, _) = lex_sql(body, opts);
            let bclean: Vec<SqlTok> = btoks.into_iter().filter(|t| t.kind != SqlTokKind::Comment).collect();
            extract_ctes_and_subqueries(body, base + body_start, &bclean, full, li, out);
            extract_sql_blocks(body, base + body_start, &bclean, RdSqlDialect::PgPlsql, full, li, out);
        }
    }
}

fn extract_migration_blocks(root: &RdNode, src: &str, li: &LineIndex, out: &mut Vec<IntraBlockNode>) {
    let mut offset = 0usize;
    let mut stmt_start: Option<usize> = None;
    for line in src.split_inclusive('\n') {
        let low = line.trim().to_ascii_lowercase();
        if low.contains("+goose statementbegin") || low.contains("+migrate statementbegin") {
            stmt_start = Some(offset);
        } else if (low.contains("+goose statementend") || low.contains("+migrate statementend"))
            && let Some(sb) = stmt_start.take()
        {
            push_rd_node(IntraBlockKind::RuleBlock, "StatementBegin", sb, offset + line.len(), src, li, out);
        }
        offset += line.len();
    }
    for sec in &root.children {
        if sec.kind == "section"
            && let Some(sub) = src.get(sec.start_byte..sec.end_byte)
        {
            let d = match detect_mig_dialect(sub) {
                MigDialect::Postgres => { extract_pg_blocks(sub, sec.start_byte, src, li, out); continue; }
                MigDialect::MySql => RdSqlDialect::MySql,
                MigDialect::Sqlite => RdSqlDialect::Sqlite,
                MigDialect::TSql => { extract_tsql_blocks(sub, sec.start_byte, src, li, out); continue; }
                MigDialect::Ansi => RdSqlDialect::Ansi,
            };
            let masked = if d == RdSqlDialect::MySql { mask_delimiter_lines(sub) } else { sub.to_string() };
            extract_sql_chunk(&masked, sec.start_byte, d, src, li, out);
        }
    }
}

fn extract_tsql_blocks(
    sub: &str,
    base: usize,
    full: &str,
    li: &LineIndex,
    out: &mut Vec<IntraBlockNode>,
) {
    let mut errs = Vec::new();
    let sub_li = (base != 0).then(|| LineIndex::new(sub));
    let batches = split_tsql_batches(sub, sub_li.as_ref().unwrap_or(li), &mut errs);
    for (s, e) in batches {
        if let Some(batch) = sub.get(s..e) {
            extract_sql_chunk(batch, base + s, RdSqlDialect::TSql, full, li, out);
        }
    }
}

fn extract_sql_chunk(sub: &str, base: usize, d: RdSqlDialect, full: &str, li: &LineIndex, out: &mut Vec<IntraBlockNode>) {
    let opts = match d {
        RdSqlDialect::PgPlsql => mig_lex_opts(MigDialect::Postgres),
        RdSqlDialect::TSql => mig_lex_opts(MigDialect::TSql),
        RdSqlDialect::MySql => mig_lex_opts(MigDialect::MySql),
        RdSqlDialect::Sqlite => mig_lex_opts(MigDialect::Sqlite),
        RdSqlDialect::Ansi => mig_lex_opts(MigDialect::Ansi),
    };
    let (toks, _, _) = lex_sql(sub, opts);
    let clean: Vec<SqlTok> = toks.into_iter().filter(|t| t.kind != SqlTokKind::Comment).collect();
    extract_ctes_and_subqueries(sub, base, &clean, full, li, out);
    extract_sql_blocks(sub, base, &clean, d, full, li, out);
}

fn extract_ctes_and_subqueries(
    sub: &str,
    base: usize,
    toks: &[SqlTok],
    full: &str,
    li: &LineIndex,
    out: &mut Vec<IntraBlockNode>,
) {
    let match_rp = build_paren_map(toks);
    let mut cte_parens = vec![false; toks.len()];
    let mut i = 0usize;
    while i < toks.len() {
        let not_dot = i == 0 || toks[i - 1].kind != SqlTokKind::Dot;
        if not_dot && toks[i].is_kw(sub, "WITH") {
            let mut j = i + 1;
            if toks.get(j).is_some_and(|t| t.is_kw(sub, "RECURSIVE")) { j += 1; }
            while j < toks.len() {
                if !matches!(toks[j].kind, SqlTokKind::Word | SqlTokKind::QuotedIdent | SqlTokKind::BracketIdent | SqlTokKind::BacktickIdent) {
                    break;
                }
                let name = toks[j].ident_name(sub);
                let mut k = j + 1;
                if toks.get(k).is_some_and(|t| t.kind == SqlTokKind::LParen) && match_rp[k] != usize::MAX {
                    k = match_rp[k] + 1;
                }
                if !toks.get(k).is_some_and(|t| t.is_kw(sub, "AS")) { break; }
                k += 1;
                if toks.get(k).is_some_and(|t| t.is_kw(sub, "NOT")) { k += 1; }
                if toks.get(k).is_some_and(|t| t.is_kw(sub, "MATERIALIZED")) { k += 1; }
                if toks.get(k).is_some_and(|t| t.kind == SqlTokKind::LParen) && match_rp[k] != usize::MAX {
                    let rp = match_rp[k];
                    cte_parens[k] = true;
                    push_rd_node(IntraBlockKind::Cte, name, base + toks[j].start, base + toks[rp].end, full, li, out);
                    j = rp + 1;
                    if toks.get(j).is_some_and(|t| t.kind == SqlTokKind::Comma) { j += 1; continue; }
                }
                break;
            }
        } else if toks[i].kind == SqlTokKind::LParen
            && !cte_parens[i]
            && match_rp[i] != usize::MAX
            && toks.get(i + 1).is_some_and(|t| t.is_kw(sub, "SELECT") || t.is_kw(sub, "WITH"))
        {
            let rp = match_rp[i];
            let kw = toks[i + 1].slice(sub);
            push_rd_node(IntraBlockKind::Subquery, format!("({kw} ...)"), base + toks[i].start, base + toks[rp].end, full, li, out);
        }
        i += 1;
    }
}

fn build_paren_map(toks: &[SqlTok]) -> Vec<usize> {
    let mut map = vec![usize::MAX; toks.len()];
    let mut stack = Vec::new();
    for (i, t) in toks.iter().enumerate() {
        if t.kind == SqlTokKind::LParen {
            stack.push(i);
        } else if t.kind == SqlTokKind::RParen && let Some(lp) = stack.pop() {
            map[lp] = i;
        }
    }
    map
}

fn mask_delimiter_lines(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    for line in src.split_inclusive('\n') {
        let trimmed = line.trim_start();
        let is_delim = trimmed.get(..9).is_some_and(|p| p.eq_ignore_ascii_case("DELIMITER"))
            && trimmed.as_bytes().get(9).is_none_or(u8::is_ascii_whitespace);
        if is_delim {
            for b in line.bytes() {
                out.push(if b == b'\n' { '\n' } else { ' ' });
            }
        } else {
            out.push_str(line);
        }
    }
    out
}
