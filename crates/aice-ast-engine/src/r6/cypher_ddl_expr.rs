use crate::r5::checks::ErrorSpan;
use crate::r6::cypher_rd::{CK, CTok};
use crate::r6::sql_lex::sp;

const CYPHER_TYPE_KWS: &[&str] = &[
    "BOOLEAN", "BOOL", "STRING", "VARCHAR", "INTEGER", "INT", "INT64", "SIGNED", "FLOAT",
    "FLOAT64", "DATE", "LOCAL", "ZONED", "TIME", "DATETIME", "TIMESTAMP", "DURATION", "POINT",
    "LIST", "ARRAY", "ANY", "NOTHING", "NULL", "PROPERTY", "VALUE", "NOT",
];

pub(super) fn is_ident(t: &CTok) -> bool {
    matches!(t.kind, CK::Word | CK::Backtick)
}

fn is_cypher_type_kw(t: &CTok, src: &str) -> bool {
    t.kind == CK::Word && CYPHER_TYPE_KWS.iter().any(|k| t.kw(src, k))
}

pub(super) fn consume_if_not_exists(
    stmt: &[CTok], i: &mut usize, src: &str, errs: &mut Vec<ErrorSpan>, ctx: &str,
) -> bool {
    if stmt.get(*i + 1).is_some_and(|t| t.kw(src, "NOT"))
        && stmt.get(*i + 2).is_some_and(|t| t.kw(src, "EXISTS"))
    {
        *i += 3;
        true
    } else {
        errs.push(sp(stmt[*i].line, stmt[*i].col, format!("Expected 'IF NOT EXISTS' in Cypher {ctx}")));
        false
    }
}

pub(super) fn parse_ddl_target_pattern(
    stmt: &[CTok], i: &mut usize, require_label: bool, src: &str, errs: &mut Vec<ErrorSpan>,
) -> bool {
    let Some(open) = stmt.get(*i).filter(|t| t.kind == CK::LP) else {
        let a = stmt.get(*i).unwrap_or(&stmt[stmt.len() - 1]);
        errs.push(sp(a.line, a.col, "Expected node or relationship pattern '(...)' in Cypher DDL"));
        return false;
    };
    let Some(close) = find_matching(stmt, *i, CK::LP, CK::RP) else { return false };
    let inner = &stmt[*i + 1..close];
    *i = close + 1;
    if inner.is_empty() && stmt.get(*i).is_some_and(|t| matches!(t.sl(src), "-" | "<-")) {
        *i += 1;
        if !stmt.get(*i).is_some_and(|t| t.kind == CK::LB) {
            let a = stmt.get(*i).unwrap_or(open);
            errs.push(sp(a.line, a.col, "Expected '[r:TYPE]' in relationship pattern"));
            return false;
        }
        let Some(rb) = find_matching(stmt, *i, CK::LB, CK::RB) else { return false };
        if !valid_entity_spec(&stmt[*i + 1..rb], require_label, src) {
            errs.push(sp(stmt[*i].line, stmt[*i].col, "Invalid relationship pattern in Cypher DDL"));
            return false;
        }
        *i = rb + 1;
        if !stmt.get(*i).is_some_and(|t| matches!(t.sl(src), "-" | "->")) {
            let a = stmt.get(*i).unwrap_or(open);
            errs.push(sp(a.line, a.col, "Expected '-' or '->' after relationship pattern"));
            return false;
        }
        *i += 1;
        if stmt.get(*i).is_some_and(|t| t.kind == CK::LP)
            && stmt.get(*i + 1).is_some_and(|t| t.kind == CK::RP)
        {
            *i += 2;
            return true;
        }
        let a = stmt.get(*i).unwrap_or(open);
        errs.push(sp(a.line, a.col, "Expected '()' to finish relationship pattern in Cypher DDL"));
        return false;
    }
    if !valid_entity_spec(inner, require_label, src) {
        errs.push(sp(open.line, open.col, "Expected '(var:Label)' pattern in Cypher DDL"));
        return false;
    }
    true
}

fn valid_entity_spec(inner: &[CTok], require_label: bool, src: &str) -> bool {
    if inner.is_empty() || !is_ident(&inner[0]) {
        return false;
    }
    if inner.len() == 1 {
        return !require_label;
    }
    if inner.len() < 3 || inner[1].sl(src) != ":" {
        return false;
    }
    let mut expect_ident = true;
    for t in &inner[2..] {
        if expect_ident {
            if !is_ident(t) { return false; }
        } else if !matches!(t.sl(src), "|" | "&" | ":") {
            return false;
        }
        expect_ident = !expect_ident;
    }
    !expect_ident
}

pub(super) fn parse_constraint_predicate(
    stmt: &[CTok], i: &mut usize, is_for: bool, src: &str, errs: &mut Vec<ErrorSpan>,
) -> bool {
    let anchor = |idx: usize| stmt.get(idx).unwrap_or(&stmt[stmt.len() - 1]);
    if !is_for
        && stmt.get(*i).is_some_and(|t| t.kw(src, "exists"))
        && stmt.get(*i + 1).is_some_and(|t| t.kind == CK::LP)
    {
        *i += 1;
        return parse_delim_prop_list(stmt, i, CK::LP, CK::RP, src, errs);
    }
    if stmt.get(*i).is_some_and(|t| t.kind == CK::LP) {
        if !parse_delim_prop_list(stmt, i, CK::LP, CK::RP, src, errs) { return false; }
    } else if !parse_prop_ref(stmt, i, src) {
        let a = anchor(*i);
        errs.push(sp(a.line, a.col, "Expected property reference in Cypher CREATE CONSTRAINT"));
        return false;
    }
    if !stmt.get(*i).is_some_and(|t| t.kw(src, "IS")) {
        let a = anchor(*i);
        errs.push(sp(a.line, a.col, "Expected 'IS' predicate in Cypher CREATE CONSTRAINT"));
        return false;
    }
    *i += 1;
    let Some(t) = stmt.get(*i) else {
        let a = anchor(*i);
        errs.push(sp(a.line, a.col, "Expected constraint predicate after 'IS'"));
        return false;
    };
    if t.kw(src, "UNIQUE") || t.kw(src, "KEY") { *i += 1; return true; }
    if t.kw(src, "NOT") && stmt.get(*i + 1).is_some_and(|n| n.kw(src, "NULL")) { *i += 2; return true; }
    if (t.kw(src, "NODE") || t.kw(src, "RELATIONSHIP") || t.kw(src, "REL"))
        && stmt.get(*i + 1).is_some_and(|n| n.kw(src, "UNIQUE") || n.kw(src, "KEY"))
    {
        *i += 2;
        return true;
    }
    if (t.sl(src) == ":" && stmt.get(*i + 1).is_some_and(|n| n.sl(src) == ":")) || t.kw(src, "TYPED") {
        *i += if t.kw(src, "TYPED") { 1 } else { 2 };
        return parse_type_expr(stmt, i, src, errs);
    }
    errs.push(sp(t.line, t.col, format!("Invalid Cypher constraint predicate '{}'", t.sl(src))));
    false
}

fn parse_type_expr(stmt: &[CTok], i: &mut usize, src: &str, errs: &mut Vec<ErrorSpan>) -> bool {
    let start = *i;
    let (mut angle, mut saw_type) = (0usize, false);
    while let Some(t) = stmt.get(*i) {
        if angle == 0 && t.kw(src, "OPTIONS") { break; }
        if t.sl(src) == "<" { angle += 1; *i += 1; continue; }
        if t.sl(src) == ">" {
            if angle == 0 {
                errs.push(sp(t.line, t.col, "Unexpected '>' in Cypher type constraint"));
                return false;
            }
            angle -= 1; *i += 1; continue;
        }
        if t.sl(src) == "|" || is_cypher_type_kw(t, src) {
            if is_cypher_type_kw(t, src) { saw_type = true; }
            *i += 1;
            continue;
        }
        errs.push(sp(t.line, t.col, format!("Invalid token '{}' in Cypher type constraint", t.sl(src))));
        return false;
    }
    if !saw_type || angle != 0 || stmt[*i - 1].sl(src) == "|" {
        let a = stmt.get(start).unwrap_or(&stmt[stmt.len() - 1]);
        errs.push(sp(a.line, a.col, "Incomplete Cypher property type constraint"));
        return false;
    }
    true
}

fn parse_prop_ref(stmt: &[CTok], i: &mut usize, src: &str) -> bool {
    if stmt.get(*i).is_some_and(is_ident)
        && stmt.get(*i + 1).is_some_and(|t| t.sl(src) == ".")
        && stmt.get(*i + 2).is_some_and(is_ident)
    {
        *i += 3;
        true
    } else {
        false
    }
}

pub(super) fn parse_delim_prop_list(
    stmt: &[CTok], i: &mut usize, open_k: CK, close_k: CK, src: &str, errs: &mut Vec<ErrorSpan>,
) -> bool {
    let Some(open) = stmt.get(*i).filter(|t| t.kind == open_k) else {
        let a = stmt.get(*i).unwrap_or(&stmt[stmt.len() - 1]);
        errs.push(sp(a.line, a.col, "Expected property list in Cypher DDL"));
        return false;
    };
    let Some(close) = find_matching(stmt, *i, open_k, close_k) else { return false };
    let mut k = *i + 1;
    if k == close {
        errs.push(sp(open.line, open.col, "Empty property list in Cypher DDL"));
        return false;
    }
    loop {
        if !parse_prop_ref(stmt, &mut k, src) {
            let a = stmt.get(k).unwrap_or(open);
            errs.push(sp(a.line, a.col, "Expected 'var.prop' in Cypher DDL property list"));
            return false;
        }
        if k == close { *i = close + 1; return true; }
        if stmt.get(k).is_some_and(|t| t.kind == CK::Comma) && k + 1 < close { k += 1; } else {
            let a = stmt.get(k).unwrap_or(open);
            errs.push(sp(a.line, a.col, "Expected ',' or closing delimiter in Cypher DDL property list"));
            return false;
        }
    }
}

pub(super) fn parse_legacy_on_label_props(
    stmt: &[CTok], i: &mut usize, src: &str, errs: &mut Vec<ErrorSpan>,
) -> bool {
    let anchor = stmt.get(*i).unwrap_or(&stmt[stmt.len() - 1]);
    if !(stmt.get(*i).is_some_and(|t| t.sl(src) == ":") && stmt.get(*i + 1).is_some_and(is_ident)) {
        errs.push(sp(anchor.line, anchor.col, "Expected ':Label(prop)' in Cypher INDEX"));
        return false;
    }
    *i += 2;
    let Some(close) = stmt.get(*i).filter(|t| t.kind == CK::LP).and_then(|_| find_matching(stmt, *i, CK::LP, CK::RP)) else {
        errs.push(sp(anchor.line, anchor.col, "Expected '(prop)' list in Cypher INDEX"));
        return false;
    };
    let mut k = *i + 1;
    if k == close {
        errs.push(sp(stmt[*i].line, stmt[*i].col, "Empty property list in Cypher INDEX"));
        return false;
    }
    loop {
        if !stmt.get(k).is_some_and(is_ident) {
            let a = stmt.get(k).unwrap_or(anchor);
            errs.push(sp(a.line, a.col, "Expected property identifier in Cypher INDEX"));
            return false;
        }
        k += 1;
        if k == close { *i = close + 1; return true; }
        if stmt.get(k).is_some_and(|t| t.kind == CK::Comma) && k + 1 < close { k += 1; } else {
            errs.push(sp(stmt[k].line, stmt[k].col, "Expected ',' or ')' in Cypher INDEX"));
            return false;
        }
    }
}

pub(super) fn consume_optional_options_and_eof(
    stmt: &[CTok], i: &mut usize, src: &str, errs: &mut Vec<ErrorSpan>, ctx: &str,
) {
    if stmt.get(*i).is_some_and(|t| t.kw(src, "OPTIONS")) {
        *i += 1;
        if let Some(close) = stmt.get(*i).filter(|t| t.kind == CK::LC).and_then(|_| find_matching(stmt, *i, CK::LC, CK::RC)) {
            *i = close + 1;
        } else {
            let a = stmt.get(*i).unwrap_or(&stmt[stmt.len() - 1]);
            errs.push(sp(a.line, a.col, format!("Expected '{{...}}' map after OPTIONS in Cypher {ctx}")));
            return;
        }
    }
    if let Some(extra) = stmt.get(*i) {
        errs.push(sp(extra.line, extra.col, format!("Unexpected token '{}' in Cypher {ctx}", extra.sl(src))));
    }
}

fn find_matching(stmt: &[CTok], open_idx: usize, open_k: CK, close_k: CK) -> Option<usize> {
    let mut d = 0usize;
    for (j, t) in stmt.iter().enumerate().skip(open_idx) {
        if t.kind == open_k { d += 1; }
        else if t.kind == close_k {
            d -= 1;
            if d == 0 { return Some(j); }
        }
    }
    None
}
