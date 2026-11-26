use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
use crate::r6::tsql_dml::{consume_dml_target, validate_col_list};
use crate::r6::tsql_query::is_tsql_ident_tok;
use crate::r6::tsql_stmt::{matching_rparen, split_comma_top};

fn is_valid_ident(t: &SqlTok, src: &str) -> bool {
    is_tsql_ident_tok(t) && !t.ident_name(src).is_empty()
}

pub(crate) fn find_create_index_kw(stmt: &[SqlTok], src: &str) -> Option<(usize, bool, bool)> {
    if !stmt[0].is_kw(src, "CREATE") { return None; }
    let (mut k, mut is_colstore, mut is_fulltext) = (1usize, false, false);
    while let Some(t) = stmt.get(k) {
        if t.is_kw(src, "INDEX") { return Some((k, is_colstore, is_fulltext)); }
        if t.is_kw(src, "COLUMNSTORE") { is_colstore = true; k += 1; }
        else if t.is_kw(src, "FULLTEXT") { is_fulltext = true; k += 1; }
        else if ["UNIQUE", "CLUSTERED", "NONCLUSTERED", "SPATIAL", "XML", "PRIMARY", "SELECTIVE", "JSON", "VECTOR"]
            .iter().any(|kw| t.is_kw(src, kw))
        {
            k += 1;
        } else {
            return None;
        }
    }
    None
}

pub(crate) fn validate_tsql_create_index(
    stmt: &[SqlTok], idx_kw: usize, is_colstore: bool, is_fulltext: bool, src: &str, errs: &mut Vec<ErrorSpan>,
) {
    let mut i = idx_kw + 1;
    if !is_fulltext {
        if !stmt.get(i).is_some_and(|t| is_valid_ident(t, src) && !t.is_kw(src, "ON")) {
            let a = stmt.get(i).unwrap_or(&stmt[idx_kw]);
            errs.push(sp(a.line, a.col, "Expected index name in T-SQL CREATE INDEX"));
            return;
        }
        i += 1;
    }
    if !stmt.get(i).is_some_and(|t| t.is_kw(src, "ON")) {
        let a = stmt.get(i).unwrap_or(&stmt[i - 1]);
        errs.push(sp(a.line, a.col, "Expected ON <table> in T-SQL CREATE INDEX"));
        return;
    }
    i += 1;
    if stmt.get(i).is_some_and(|t| t.kind == SqlTokKind::Var) {
        errs.push(sp(stmt[i].line, stmt[i].col, "Invalid table name in T-SQL CREATE INDEX"));
        return;
    }
    let Some(mut i) = consume_dml_target(stmt, i, "CREATE INDEX", src, errs) else { return; };
    let is_clustered_colstore = is_colstore && stmt[1..idx_kw].iter().any(|t| t.is_kw(src, "CLUSTERED"));
    if !is_clustered_colstore || stmt.get(i).is_some_and(|t| t.kind == SqlTokKind::LParen) {
        if !stmt.get(i).is_some_and(|t| t.kind == SqlTokKind::LParen) {
            let a = stmt.get(i).unwrap_or(&stmt[i - 1]);
            errs.push(sp(a.line, a.col, "Expected '(' column list in T-SQL CREATE INDEX"));
            return;
        }
        let Some(rp) = matching_rparen(stmt, i) else { return; };
        if rp == i + 1 {
            errs.push(sp(stmt[i].line, stmt[i].col, "Empty column list '()' in T-SQL CREATE INDEX"));
            return;
        }
        for col in split_comma_top(&stmt[i + 1..rp]) {
            let ok = !col.is_empty() && is_valid_ident(&col[0], src)
                && (col.len() == 1 || (col.len() == 2 && (col[1].is_kw(src, "ASC") || col[1].is_kw(src, "DESC"))));
            if !ok {
                let a = col.first().unwrap_or(&stmt[i]);
                errs.push(sp(a.line, a.col, "Invalid column entry in T-SQL CREATE INDEX"));
                return;
            }
        }
        i = rp + 1;
    }
    while i < stmt.len() {
        let t = &stmt[i];
        if t.is_kw(src, "INCLUDE") || t.is_kw(src, "ORDER") {
            if !stmt.get(i + 1).is_some_and(|n| n.kind == SqlTokKind::LParen) {
                errs.push(sp(t.line, t.col, format!("Expected '(' after {} in CREATE INDEX", t.slice(src))));
                return;
            }
            let Some(rp) = matching_rparen(stmt, i + 1) else { return; };
            if !validate_col_list(&stmt[i + 2..rp], &stmt[i + 1], "CREATE INDEX", src, errs) { return; }
            i = rp + 1;
        } else if t.is_kw(src, "WHERE") {
            i += 1;
            let start = i;
            let mut d = 0usize;
            while i < stmt.len() {
                if stmt[i].kind == SqlTokKind::LParen { d += 1; }
                else if stmt[i].kind == SqlTokKind::RParen { d = d.saturating_sub(1); }
                else if d == 0 && (stmt[i].is_kw(src, "WITH") || stmt[i].is_kw(src, "ON") || stmt[i].is_kw(src, "FILESTREAM_ON")) {
                    break;
                }
                i += 1;
            }
            if i == start {
                errs.push(sp(t.line, t.col, "Empty WHERE filter predicate in T-SQL CREATE INDEX"));
                return;
            }
        } else if t.is_kw(src, "WITH") && stmt.get(i + 1).is_some_and(|n| n.kind == SqlTokKind::LParen) {
            let Some(rp) = matching_rparen(stmt, i + 1) else { return; };
            if rp == i + 2 || stmt[i + 2..rp].iter().any(|x| x.kind == SqlTokKind::Semi) {
                errs.push(sp(stmt[i + 1].line, stmt[i + 1].col, "Invalid WITH options in CREATE INDEX"));
                return;
            }
            i = rp + 1;
        } else if (t.is_kw(src, "ON") || t.is_kw(src, "FILESTREAM_ON"))
            && stmt.get(i + 1).is_some_and(|n| is_valid_ident(n, src) || n.kind == SqlTokKind::StringLit)
        {
            i += 2;
            if t.is_kw(src, "ON") && stmt.get(i).is_some_and(|n| n.kind == SqlTokKind::LParen) {
                let Some(rp) = matching_rparen(stmt, i) else { return; };
                if rp != i + 2 || !is_valid_ident(&stmt[i + 1], src) {
                    errs.push(sp(stmt[i].line, stmt[i].col, "Invalid partition column in CREATE INDEX ON"));
                    return;
                }
                i = rp + 1;
            }
        } else if is_fulltext && t.is_kw(src, "KEY") && stmt.get(i + 1).is_some_and(|n| n.is_kw(src, "INDEX")) {
            return;
        } else if t.is_kw(src, "USING") && stmt.get(i + 1).is_some_and(|n| is_valid_ident(n, src)) {
            i += 2;
        } else {
            errs.push(sp(t.line, t.col, format!("Unexpected token '{}' in T-SQL CREATE INDEX", t.slice(src))));
            return;
        }
    }
}

pub(crate) fn validate_tsql_routine_hdr(
    clean: &[SqlTok], start: usize, hdr_start: usize, kind: &str, src: &str, errs: &mut Vec<ErrorSpan>,
) -> usize {
    let mut i = hdr_start;
    let mut d = 0usize;
    let mut saw_returns = false;
    let mut saw_on_target = false;
    let mut found_as: Option<usize> = None;
    let mut hit_semi = false;

    while i < clean.len() {
        let t = &clean[i];
        if t.kind == SqlTokKind::LParen {
            d += 1;
        } else if t.kind == SqlTokKind::RParen {
            d = d.saturating_sub(1);
        } else if d == 0 {
            if t.kind == SqlTokKind::Semi {
                if kind == "procedure" && i == hdr_start && clean.get(i + 1).is_some_and(|n| n.kind == SqlTokKind::Number) {
                    i += 2;
                    continue;
                }
                hit_semi = true;
                break;
            }
            if t.is_kw(src, "EXECUTE") && clean.get(i + 1).is_some_and(|n| n.is_kw(src, "AS")) {
                i += 3.min(clean.len() - i);
                continue;
            }
            if t.is_kw(src, "AS") {
                found_as = Some(i);
                break;
            }
            if kind == "function"
                && t.is_kw(src, "RETURNS")
                && let Some(n) = clean.get(i + 1)
                && !(n.is_kw(src, "AS") || n.is_kw(src, "WITH") || n.kind == SqlTokKind::Semi)
                && (is_valid_ident(n, src) || n.kind == SqlTokKind::Var)
            {
                saw_returns = true;
            }
            if kind == "trigger"
                && t.is_kw(src, "ON")
                && let Some(next) = clean.get(i + 1)
            {
                if next.is_kw(src, "DATABASE")
                    || (next.is_kw(src, "ALL") && clean.get(i + 2).is_some_and(|m| m.is_kw(src, "SERVER")))
                {
                    saw_on_target = true;
                } else if is_valid_ident(next, src)
                    && !["AS", "WITH", "FOR", "AFTER", "INSTEAD"].iter().any(|k| next.is_kw(src, k))
                {
                    let mut k = i + 2;
                    let mut ok = true;
                    while clean.get(k).is_some_and(|m| m.kind == SqlTokKind::Dot) {
                        if !clean.get(k + 1).is_some_and(|m| is_valid_ident(m, src)) {
                            ok = false;
                            break;
                        }
                        k += 2;
                    }
                    saw_on_target = ok;
                }
            }
        }
        i += 1;
    }

    let Some(as_i) = found_as else {
        let anchor = if hit_semi { &clean[i] } else { &clean[i.saturating_sub(1).max(start)] };
        errs.push(sp(anchor.line, anchor.col, format!("Expected AS in T-SQL {} definition", kind.to_ascii_uppercase())));
        return if hit_semi { i + 1 } else { i };
    };
    if kind == "function" && !saw_returns {
        errs.push(sp(clean[as_i].line, clean[as_i].col, "Expected RETURNS clause before AS in T-SQL FUNCTION definition"));
    }
    if kind == "trigger" && !saw_on_target {
        errs.push(sp(clean[as_i].line, clean[as_i].col, "Expected ON <target> clause before AS in T-SQL TRIGGER definition"));
    }
    as_i + 1
}
