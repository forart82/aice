use crate::r5::checks::ErrorSpan;
use crate::r6::cypher_ddl_expr::{
    consume_if_not_exists, consume_optional_options_and_eof, is_ident, parse_constraint_predicate,
    parse_ddl_target_pattern, parse_delim_prop_list, parse_legacy_on_label_props,
};
use crate::r6::cypher_rd::{CK, CTok};
use crate::r6::sql_lex::sp;

const INDEX_TYPE_KWS: &[&str] = &["RANGE", "TEXT", "POINT", "FULLTEXT", "LOOKUP", "VECTOR", "BTREE"];

fn is_index_type_kw(t: &CTok, src: &str) -> bool {
    t.kind == CK::Word && INDEX_TYPE_KWS.iter().any(|k| t.kw(src, k))
}

pub(super) fn is_cypher_ddl(stmt: &[CTok], src: &str) -> bool {
    let Some(first) = stmt.first() else { return false };
    if first.kw(src, "DROP") {
        return stmt.get(1).is_some_and(|t| t.kw(src, "CONSTRAINT") || t.kw(src, "INDEX"));
    }
    if !first.kw(src, "CREATE") {
        return false;
    }
    let mut k = 1usize;
    if stmt.get(k).is_some_and(|t| t.kw(src, "OR"))
        && stmt.get(k + 1).is_some_and(|t| t.kw(src, "REPLACE"))
    {
        k += 2;
    }
    if stmt.get(k).is_some_and(|t| t.kw(src, "CONSTRAINT") || t.kw(src, "INDEX")) {
        return true;
    }
    stmt.get(k).is_some_and(|t| is_index_type_kw(t, src))
        && stmt.get(k + 1).is_some_and(|t| t.kw(src, "INDEX"))
}

pub(super) fn validate_cypher_ddl(stmt: &[CTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    if stmt[0].kw(src, "DROP") {
        validate_drop_ddl(stmt, src, errs);
        return;
    }
    let mut i = 1usize;
    let mut or_replace = false;
    if stmt.get(i).is_some_and(|t| t.kw(src, "OR"))
        && stmt.get(i + 1).is_some_and(|t| t.kw(src, "REPLACE"))
    {
        or_replace = true;
        i += 2;
    }
    if stmt.get(i).is_some_and(|t| t.kw(src, "CONSTRAINT")) {
        validate_create_constraint(stmt, i + 1, or_replace, src, errs);
    } else {
        if stmt.get(i).is_some_and(|t| is_index_type_kw(t, src)) {
            i += 1;
        }
        validate_create_index(stmt, i + 1, or_replace, src, errs);
    }
}

fn validate_create_constraint(
    stmt: &[CTok],
    mut i: usize,
    or_replace: bool,
    src: &str,
    errs: &mut Vec<ErrorSpan>,
) {
    let anchor = |idx: usize| stmt.get(idx).unwrap_or(&stmt[stmt.len() - 1]);
    if stmt.get(i).is_some_and(|t| {
        is_ident(t)
            && !t.kw(src, "IF")
            && !t.kw(src, "FOR")
            && !t.kw(src, "ON")
            && !t.kw(src, "REQUIRE")
            && !t.kw(src, "ASSERT")
    }) {
        i += 1;
    }
    if stmt.get(i).is_some_and(|t| t.kw(src, "IF")) {
        if or_replace {
            errs.push(sp(stmt[i].line, stmt[i].col, "Cannot combine OR REPLACE with IF NOT EXISTS in Cypher"));
        }
        if !consume_if_not_exists(stmt, &mut i, src, errs, "CREATE CONSTRAINT") {
            return;
        }
    }
    let Some(is_for) = stmt.get(i).and_then(|t| {
        if t.kw(src, "FOR") { Some(true) } else if t.kw(src, "ON") { Some(false) } else { None }
    }) else {
        let a = anchor(i);
        errs.push(sp(a.line, a.col, "Expected 'FOR' or 'ON' clause in Cypher CREATE CONSTRAINT"));
        return;
    };
    i += 1;
    if !parse_ddl_target_pattern(stmt, &mut i, true, src, errs) {
        return;
    }
    let req_kw = if is_for { "REQUIRE" } else { "ASSERT" };
    if !stmt.get(i).is_some_and(|t| t.kw(src, req_kw)) {
        let a = anchor(i);
        errs.push(sp(a.line, a.col, format!("Expected '{req_kw}' clause in Cypher CREATE CONSTRAINT")));
        return;
    }
    i += 1;
    if !parse_constraint_predicate(stmt, &mut i, is_for, src, errs) {
        return;
    }
    consume_optional_options_and_eof(stmt, &mut i, src, errs, "CREATE CONSTRAINT");
}

fn validate_create_index(
    stmt: &[CTok],
    mut i: usize,
    or_replace: bool,
    src: &str,
    errs: &mut Vec<ErrorSpan>,
) {
    let anchor = |idx: usize| stmt.get(idx).unwrap_or(&stmt[stmt.len() - 1]);
    if stmt.get(i).is_some_and(|t| is_ident(t) && !t.kw(src, "IF") && !t.kw(src, "FOR") && !t.kw(src, "ON")) {
        i += 1;
    }
    if stmt.get(i).is_some_and(|t| t.kw(src, "IF")) {
        if or_replace {
            errs.push(sp(stmt[i].line, stmt[i].col, "Cannot combine OR REPLACE with IF NOT EXISTS in Cypher"));
        }
        if !consume_if_not_exists(stmt, &mut i, src, errs, "CREATE INDEX") {
            return;
        }
    }
    if stmt.get(i).is_some_and(|t| t.kw(src, "ON")) {
        i += 1;
        if !parse_legacy_on_label_props(stmt, &mut i, src, errs) {
            return;
        }
    } else if stmt.get(i).is_some_and(|t| t.kw(src, "FOR")) {
        i += 1;
        if !parse_ddl_target_pattern(stmt, &mut i, false, src, errs) {
            return;
        }
        if !stmt.get(i).is_some_and(|t| t.kw(src, "ON")) {
            let a = anchor(i);
            errs.push(sp(a.line, a.col, "Expected 'ON' clause in Cypher CREATE INDEX"));
            return;
        }
        i += 1;
        if stmt.get(i).is_some_and(|t| t.kw(src, "EACH")) {
            i += 1;
            if stmt.get(i).is_some_and(|t| t.kind == CK::LB) {
                if !parse_delim_prop_list(stmt, &mut i, CK::LB, CK::RB, src, errs) {
                    return;
                }
            } else if stmt.get(i).is_some_and(|t| t.kw(src, "labels") || t.kw(src, "type"))
                && stmt.get(i + 1).is_some_and(|t| t.kind == CK::LP)
                && stmt.get(i + 2).is_some_and(is_ident)
                && stmt.get(i + 3).is_some_and(|t| t.kind == CK::RP)
            {
                i += 4;
            } else {
                let a = anchor(i);
                errs.push(sp(a.line, a.col, "Expected property list or labels()/type() after ON EACH in Cypher CREATE INDEX"));
                return;
            }
        } else if !parse_delim_prop_list(stmt, &mut i, CK::LP, CK::RP, src, errs) {
            return;
        }
    } else {
        let a = anchor(i);
        errs.push(sp(a.line, a.col, "Expected 'FOR' or 'ON' clause in Cypher CREATE INDEX"));
        return;
    }
    consume_optional_options_and_eof(stmt, &mut i, src, errs, "CREATE INDEX");
}

fn validate_drop_ddl(stmt: &[CTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    let kind_lbl = if stmt[1].kw(src, "CONSTRAINT") { "CONSTRAINT" } else { "INDEX" };
    let mut i = 2usize;
    let Some(tok) = stmt.get(i) else {
        errs.push(sp(stmt[1].line, stmt[1].col, format!("Expected name after DROP {kind_lbl}")));
        return;
    };
    if tok.kw(src, "ON") {
        i += 1;
        if kind_lbl == "INDEX" {
            if !parse_legacy_on_label_props(stmt, &mut i, src, errs) {
                return;
            }
        } else {
            if !parse_ddl_target_pattern(stmt, &mut i, true, src, errs) {
                return;
            }
            if !stmt.get(i).is_some_and(|t| t.kw(src, "ASSERT")) {
                let a = stmt.get(i).unwrap_or(&stmt[stmt.len() - 1]);
                errs.push(sp(a.line, a.col, "Expected 'ASSERT' in legacy DROP CONSTRAINT"));
                return;
            }
            i += 1;
            if !parse_constraint_predicate(stmt, &mut i, false, src, errs) {
                return;
            }
        }
    } else if is_ident(tok) && !tok.kw(src, "IF") {
        i += 1;
        if stmt.get(i).is_some_and(|t| t.kw(src, "IF")) {
            if stmt.get(i + 1).is_some_and(|t| t.kw(src, "EXISTS")) {
                i += 2;
            } else {
                errs.push(sp(stmt[i].line, stmt[i].col, format!("Expected 'IF EXISTS' in DROP {kind_lbl}")));
                return;
            }
        }
    } else {
        errs.push(sp(tok.line, tok.col, format!("Expected name after DROP {kind_lbl}")));
        return;
    }
    if let Some(extra) = stmt.get(i) {
        errs.push(sp(extra.line, extra.col, format!("Unexpected token '{}' in DROP {kind_lbl}", extra.sl(src))));
    }
}
