use std::collections::HashSet;

use aice_lang_registry::{DepEdge, DepKind};

use crate::r6::sql_expr::strip_comments;
use crate::r6::sql_lex::{LexOpts, SqlTokKind, lex_sql};

pub(crate) fn extract_sql_token_schema_deps(src: &str, scope: &str, opts: LexOpts) -> Vec<DepEdge> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    scan_sql_token_deps(src, scope, opts, false, 0, &mut out, &mut seen);
    out
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum CreateHdr {
    None,
    Pending,
    Trigger,
    Index,
}

pub(crate) fn scan_sql_token_deps(
    src: &str,
    scope: &str,
    opts: LexOpts,
    guard_plpgsql_into: bool,
    depth: u8,
    out: &mut Vec<DepEdge>,
    seen: &mut HashSet<String>,
) {
    let (toks, _, _) = lex_sql(src, opts);
    let clean = strip_comments(&toks);
    let mut hdr = CreateHdr::None;
    let mut in_merge = false;
    let mut i = 0usize;
    while i < clean.len() {
        if let SqlTokKind::DollarQuote { body_start, body_end } = clean[i].kind {
            let is_body = depth < 4
                && i > 0
                && (clean[i - 1].is_kw(src, "AS")
                    || clean[i - 1].is_kw(src, "DO")
                    || clean[i - 1].is_kw(src, "PLPGSQL")
                    || clean[i - 1].is_kw(src, "SQL"));
            if is_body && let Some(body) = src.get(body_start..body_end) {
                scan_sql_token_deps(body, scope, opts, true, depth + 1, out, seen);
            }
            i += 1;
            continue;
        }
        if clean[i].kind == SqlTokKind::Semi {
            hdr = CreateHdr::None;
            in_merge = false;
        } else if clean[i].is_kw(src, "CREATE") {
            hdr = CreateHdr::Pending;
        } else if hdr == CreateHdr::Pending {
            if clean[i].is_kw(src, "TRIGGER") {
                hdr = CreateHdr::Trigger;
            } else if clean[i].is_kw(src, "INDEX") {
                hdr = CreateHdr::Index;
            } else if ["TABLE", "VIEW", "PROCEDURE", "FUNCTION", "DATABASE", "SCHEMA", "TYPE", "EVENT"]
                .iter()
                .any(|k| clean[i].is_kw(src, k))
            {
                hdr = CreateHdr::None;
            }
        } else if hdr == CreateHdr::Index && clean[i].kind == SqlTokKind::LParen {
            hdr = CreateHdr::None;
        }
        if clean[i].is_kw(src, "MERGE") {
            in_merge = true;
        } else if clean[i].is_kw(src, "WHEN") {
            in_merge = false;
        }
        let is_trig_or_idx_on =
            matches!(hdr, CreateHdr::Trigger | CreateHdr::Index) && clean[i].is_kw(src, "ON");
        if is_trig_or_idx_on {
            hdr = CreateHdr::None;
        }
        let is_upd = clean[i].is_kw(src, "UPDATE")
            && hdr != CreateHdr::Trigger
            && !(i > 0
                && (clean[i - 1].kind == SqlTokKind::Comma
                    || ["ON", "FOR", "AFTER", "OF", "BEFORE", "OR"]
                        .iter()
                        .any(|k| clean[i - 1].is_kw(src, k))));
        let is_into = clean[i].is_kw(src, "INTO")
            && (!guard_plpgsql_into
                || (i > 0 && (clean[i - 1].is_kw(src, "INSERT") || clean[i - 1].is_kw(src, "MERGE"))));
        let is_refs = clean[i].is_kw(src, "REFERENCES");
        let is_alter_tbl = clean[i].is_kw(src, "TABLE") && i > 0 && clean[i - 1].is_kw(src, "ALTER");
        let is_merge_using = in_merge && clean[i].is_kw(src, "USING");
        let is_bare_merge = clean[i].is_kw(src, "MERGE")
            && !clean.get(i + 1).is_some_and(|t| t.is_kw(src, "INTO") || t.is_kw(src, "TOP"));
        let is_ref = clean[i].is_kw(src, "FROM")
            || clean[i].is_kw(src, "JOIN")
            || is_into
            || is_refs
            || is_alter_tbl
            || is_upd
            || is_trig_or_idx_on
            || is_merge_using
            || is_bare_merge;
        if is_ref {
            let mut tgt_idx = i + 1;
            if is_alter_tbl
                && clean.get(tgt_idx).is_some_and(|t| t.is_kw(src, "IF"))
                && clean.get(tgt_idx + 1).is_some_and(|t| t.is_kw(src, "EXISTS"))
            {
                tgt_idx += 2;
            }
            if let Some(first) = clean.get(tgt_idx)
                && matches!(
                    first.kind,
                    SqlTokKind::Word
                        | SqlTokKind::BacktickIdent
                        | SqlTokKind::BracketIdent
                        | SqlTokKind::QuotedIdent
                )
                && !(is_upd
                    && ["SET", "CASCADE", "NO", "RESTRICT", "ACTION", "ON", "AS", "OF"]
                        .iter()
                        .any(|k| first.is_kw(src, k)))
                && !(is_refs && (first.is_kw(src, "ON") || first.is_kw(src, "TO")))
                && !(is_trig_or_idx_on && (first.is_kw(src, "DATABASE") || first.is_kw(src, "ALL")))
            {
                let mut target = first.ident_name(src);
                let mut j = tgt_idx + 1;
                while clean.get(j).is_some_and(|t| t.kind == SqlTokKind::Dot)
                    && clean.get(j + 1).is_some()
                {
                    target = format!("{target}.{}", clean[j + 1].ident_name(src));
                    j += 2;
                }
                if !target.is_empty() && seen.insert(target.clone()) {
                    out.push(DepEdge {
                        source: scope.to_string(),
                        target,
                        kind: DepKind::SchemaRef,
                    });
                }
                i = j;
                continue;
            }
        }
        i += 1;
    }
}
