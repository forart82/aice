use aice_aice_ir::ir_domain_db::{DbQueryDecl, DbSchemaDecl};
use aice_lang_registry::{SymbolKind, SymbolNode};

use crate::aice_project_util::{find_sym_span, find_text_span};

pub(crate) fn strip_sql_ident_quotes(name: &str) -> String {
    name.split('.')
        .map(strip_single_ident_quote)
        .collect::<Vec<_>>()
        .join(".")
}

fn strip_single_ident_quote(seg: &str) -> &str {
    let t = seg.trim();
    if t.len() >= 2
        && ((t.starts_with('`') && t.ends_with('`'))
            || (t.starts_with('"') && t.ends_with('"'))
            || (t.starts_with('[') && t.ends_with(']')))
    {
        return &t[1..t.len() - 1];
    }
    t
}

pub(crate) fn sql_unqualified_ident(name: &str) -> String {
    let norm = strip_sql_ident_quotes(name);
    norm.rsplit('.').next().unwrap_or(&norm).to_string()
}

pub(crate) fn find_sql_sym_span(
    name: &str,
    syms: &[SymbolNode],
    preferred_kind: Option<SymbolKind>,
) -> Option<(usize, usize)> {
    let norm = strip_sql_ident_quotes(name);
    let short = sql_unqualified_ident(name);
    let suffix = format!("::{}", short.to_ascii_lowercase());
    let matches_sym = |s: &SymbolNode| -> bool {
        let sn = strip_sql_ident_quotes(&s.name);
        let sq = strip_sql_ident_quotes(&s.qualified_name);
        sn.eq_ignore_ascii_case(&norm)
            || sn.eq_ignore_ascii_case(&short)
            || sq.eq_ignore_ascii_case(&norm)
            || sq.to_ascii_lowercase().ends_with(&suffix)
    };
    if let Some(kind) = preferred_kind
        && let Some(hit) = syms.iter().find(|s| s.kind == kind && matches_sym(s))
    {
        return Some((hit.start_line, hit.end_line));
    }
    syms.iter().find(|s| matches_sym(s)).map(|s| (s.start_line, s.end_line))
}

pub(crate) fn db_query_range(
    dq: &DbQueryDecl,
    syms: &[SymbolNode],
    src: &str,
) -> Option<(usize, usize)> {
    let mut rng = dq
        .name
        .as_deref()
        .and_then(|n| find_sql_sym_span(n, syms, Some(SymbolKind::Query)));
    let mut merge = |s: usize, e: usize| {
        rng = Some(match rng {
            Some((a, b)) => (a.min(s), b.max(e)),
            None => (s, e),
        });
    };
    for (cname, body) in &dq.ctes {
        if let Some((s, e)) = find_sql_sym_span(cname, syms, None).or_else(|| find_text_span(src, body)) {
            merge(s, e);
        }
    }
    for (_, v) in &dq.clauses {
        if let Some((s, e)) = find_text_span(src, v) {
            merge(s, e);
        }
    }
    rng
}

pub(crate) fn db_schema_range(
    ds: &DbSchemaDecl,
    syms: &[SymbolNode],
    src: &str,
) -> Option<(usize, usize)> {
    match ds {
        DbSchemaDecl::Table { name, .. } => find_sql_sym_span(name, syms, Some(SymbolKind::Table))
            .or_else(|| find_create_ddl_span(src, "TABLE", name)),
        DbSchemaDecl::View { name, .. } => find_sql_sym_span(name, syms, Some(SymbolKind::View))
            .or_else(|| find_create_ddl_span(src, "VIEW", name))
            .or_else(|| find_text_span(src, name)),
        DbSchemaDecl::Index { name, .. } => find_sql_sym_span(name, syms, None)
            .or_else(|| find_create_ddl_span(src, "INDEX", name))
            .or_else(|| find_text_span(src, name)),
        DbSchemaDecl::Procedure { name, .. } => {
            find_sql_sym_span(name, syms, Some(SymbolKind::Procedure))
                .or_else(|| find_create_ddl_span(src, "PROCEDURE", name))
                .or_else(|| find_create_ddl_span(src, "PROC", name))
                .or_else(|| find_text_span(src, name))
        }
        DbSchemaDecl::Trigger { name, .. } => {
            find_sql_sym_span(name, syms, Some(SymbolKind::Trigger))
                .or_else(|| find_create_ddl_span(src, "TRIGGER", name))
                .or_else(|| find_text_span(src, name))
        }
        DbSchemaDecl::TypeDef { name, .. } => find_sql_sym_span(name, syms, None)
            .or_else(|| find_create_ddl_span(src, "TYPE", name))
            .or_else(|| find_text_span(src, name)),
        DbSchemaDecl::PrismaBlock { name, .. } | DbSchemaDecl::GraphQlType { name, .. } => {
            find_sym_span(name, syms).or_else(|| find_text_span(src, name))
        }
        DbSchemaDecl::RawDdl { text, .. } => find_text_span(src, text),
    }
}

pub(crate) fn find_create_ddl_span(src: &str, kw: &str, name: &str) -> Option<(usize, usize)> {
    let target_norm = strip_sql_ident_quotes(name);
    let target_short = sql_unqualified_ident(name);
    if target_short.is_empty() {
        return None;
    }
    let lines: Vec<&str> = src.lines().collect();
    let start_idx = lines.iter().position(|line| {
        matches_create_ddl_header(line, kw, &target_norm, &target_short)
    })?;
    let end_idx = scan_sql_stmt_end(&lines, start_idx);
    Some((start_idx + 1, end_idx + 1))
}

fn matches_create_ddl_header(
    line: &str,
    kw: &str,
    target_norm: &str,
    target_short: &str,
) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with("--") || trimmed.starts_with("/*") {
        return false;
    }
    let mut toks = trimmed.split_whitespace();
    if !toks.next().is_some_and(|t| t.eq_ignore_ascii_case("CREATE")) {
        return false;
    }
    let rest: Vec<&str> = toks.collect();
    let Some(kw_pos) = rest.iter().position(|t| t.eq_ignore_ascii_case(kw)) else {
        return false;
    };
    let mut idx = kw_pos + 1;
    if rest.get(idx).is_some_and(|t| t.eq_ignore_ascii_case("IF"))
        && rest.get(idx + 1).is_some_and(|t| t.eq_ignore_ascii_case("NOT"))
        && rest.get(idx + 2).is_some_and(|t| t.eq_ignore_ascii_case("EXISTS"))
    {
        idx += 3;
    }
    let Some(raw_ident) = rest.get(idx) else {
        return false;
    };
    let ident_head = raw_ident
        .split(['(', ';', ','])
        .next()
        .unwrap_or(raw_ident);
    let cand_norm = strip_sql_ident_quotes(ident_head);
    let cand_short = sql_unqualified_ident(ident_head);
    cand_norm.eq_ignore_ascii_case(target_norm) || cand_short.eq_ignore_ascii_case(target_short)
}

fn scan_sql_stmt_end(lines: &[&str], start_idx: usize) -> usize {
    let (mut depth, mut in_sq) = (0usize, false);
    for (idx, line) in lines.iter().enumerate().skip(start_idx) {
        let bytes = line.as_bytes();
        let mut i = 0usize;
        while i < bytes.len() {
            if in_sq {
                if bytes[i] == b'\'' {
                    if bytes.get(i + 1) == Some(&b'\'') {
                        i += 2;
                        continue;
                    }
                    in_sq = false;
                }
                i += 1;
                continue;
            }
            if bytes[i] == b'-' && bytes.get(i + 1) == Some(&b'-') {
                break;
            }
            match bytes[i] {
                b'\'' => in_sq = true,
                b'(' => depth += 1,
                b')' => depth = depth.saturating_sub(1),
                b';' if depth == 0 => return idx,
                _ => {}
            }
            i += 1;
        }
    }
    lines.len().saturating_sub(1)
}
