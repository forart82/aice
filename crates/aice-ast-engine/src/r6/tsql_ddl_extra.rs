use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
use crate::r6::tsql_ddl::{
    COL_CONSTRAINT_KWS, validate_check, validate_default, validate_paren_expr,
};
use crate::r6::tsql_dml::validate_col_list;
use crate::r6::tsql_query::is_tsql_ident_tok;
use crate::r6::tsql_stmt::{matching_rparen, split_comma_top};

const BARE_COL_KWS: &[&str] = &[
    "NULL", "NOT", "PRIMARY", "KEY", "UNIQUE", "ROWGUIDCOL", "SPARSE", "FILESTREAM",
    "MASKED", "HIDDEN", "ENCRYPTED", "CLUSTERED", "NONCLUSTERED", "PERSISTED",
    "FOR", "REPLICATION",
];

pub(super) fn is_valid_ident(t: &SqlTok, src: &str) -> bool {
    is_tsql_ident_tok(t) && !t.ident_name(src).is_empty()
}

fn is_signed_num(toks: &[SqlTok], src: &str) -> bool {
    match toks {
        [n] => n.kind == SqlTokKind::Number,
        [op, n] => op.kind == SqlTokKind::Op && matches!(op.slice(src), "+" | "-") && n.kind == SqlTokKind::Number,
        _ => false,
    }
}

fn validate_type_params(item: &[SqlTok], lp: usize, is_xml: bool, src: &str, errs: &mut Vec<ErrorSpan>) -> Option<usize> {
    let rp = matching_rparen(item, lp)?;
    if rp == lp + 1 {
        errs.push(sp(item[lp].line, item[lp].col, "Empty '()' in column data type"));
        return None;
    }
    let inner = &item[lp + 1..rp];
    if let Some(semi) = inner.iter().find(|t| t.kind == SqlTokKind::Semi) {
        errs.push(sp(semi.line, semi.col, "Unexpected ';' in column data type"));
        return None;
    }
    if is_xml {
        let mut k = usize::from(inner[0].is_kw(src, "CONTENT") || inner[0].is_kw(src, "DOCUMENT"));
        if !inner.get(k).is_some_and(|t| is_valid_ident(t, src)) {
            let a = inner.get(k).unwrap_or(&item[lp]);
            errs.push(sp(a.line, a.col, "Expected XML schema collection name"));
            return None;
        }
        k += 1;
        while inner.get(k).is_some_and(|t| t.kind == SqlTokKind::Dot) {
            let dot = &inner[k];
            k += 1;
            if !inner.get(k).is_some_and(|t| is_valid_ident(t, src)) {
                errs.push(sp(inner.get(k).unwrap_or(dot).line, inner.get(k).unwrap_or(dot).col, "Expected identifier after '.' in XML schema"));
                return None;
            }
            k += 1;
        }
        if k < inner.len() {
            errs.push(sp(inner[k].line, inner[k].col, format!("Unexpected token '{}' in XML type", inner[k].slice(src))));
            return None;
        }
        return Some(rp + 1);
    }
    let args = split_comma_top(inner);
    if args.len() > 2 {
        errs.push(sp(item[lp].line, item[lp].col, "Too many parameters in column data type"));
        return None;
    }
    for arg in args {
        if arg.len() != 1 || !(arg[0].kind == SqlTokKind::Number || arg[0].is_kw(src, "MAX")) {
            let a = arg.first().unwrap_or(&item[lp]);
            errs.push(sp(a.line, a.col, format!("Invalid data type parameter '{}'", a.slice(src))));
            return None;
        }
    }
    Some(rp + 1)
}

pub(super) fn validate_with_opts(item: &[SqlTok], lp: usize, ctx: &str, src: &str, errs: &mut Vec<ErrorSpan>) -> Option<usize> {
    let rp = matching_rparen(item, lp)?;
    if rp == lp + 1 {
        errs.push(sp(item[lp].line, item[lp].col, format!("Empty '()' in {ctx}")));
        return None;
    }
    let inner = &item[lp + 1..rp];
    if let Some(semi) = inner.iter().find(|t| t.kind == SqlTokKind::Semi) {
        errs.push(sp(semi.line, semi.col, format!("Unexpected ';' in {ctx}")));
        return None;
    }
    for opt in split_comma_top(inner) {
        if opt.is_empty() || !is_valid_ident(&opt[0], src) {
            let a = opt.first().unwrap_or(&item[lp]);
            errs.push(sp(a.line, a.col, format!("Invalid option in {ctx}")));
            return None;
        }
    }
    Some(rp + 1)
}

pub(super) fn validate_tsql_col_def(item: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>, allow_with_values: bool) {
    if !is_valid_ident(&item[0], src) {
        errs.push(sp(item[0].line, item[0].col, format!("Invalid column name '{}'", item[0].slice(src))));
        return;
    }
    if item.len() < 2 {
        errs.push(sp(item[0].line, item[0].col, "Column missing data type in CREATE TABLE"));
        return;
    }
    let mut j = 1usize;
    if item[j].is_kw(src, "AS") {
        j += 1;
        if item.get(j).is_some_and(|t| t.kind == SqlTokKind::LParen) {
            let Some(next_j) = validate_paren_expr(item, j, "computed column", src, errs) else { return; };
            j = next_j;
        } else {
            let a = item.get(j).unwrap_or(&item[j - 1]);
            errs.push(sp(a.line, a.col, "Expected '(' after AS in computed column"));
            return;
        }
    } else {
        if !is_valid_ident(&item[j], src) {
            errs.push(sp(item[j].line, item[j].col, format!("Invalid data type '{}' in CREATE TABLE", item[j].slice(src))));
            return;
        }
        let is_xml = item[j].is_kw(src, "XML");
        j += 1;
        while item.get(j).is_some_and(|t| t.kind == SqlTokKind::Dot) {
            let dot = &item[j];
            j += 1;
            if !item.get(j).is_some_and(|t| is_valid_ident(t, src)) {
                let a = item.get(j).unwrap_or(dot);
                errs.push(sp(a.line, a.col, "Expected type name after '.' in CREATE TABLE column"));
                return;
            }
            j += 1;
        }
        if item.get(j).is_some_and(|t| t.is_kw(src, "VARYING") || t.is_kw(src, "PRECISION")) { j += 1; }
        if item.get(j).is_some_and(|t| t.kind == SqlTokKind::LParen) {
            let Some(next_j) = validate_type_params(item, j, is_xml, src, errs) else { return; };
            j = next_j;
        }
    }
    while j < item.len() {
        let t = &item[j];
        if t.kind == SqlTokKind::Semi {
            errs.push(sp(t.line, t.col, "Unexpected ';' in column definition"));
            return;
        }
        if t.is_kw(src, "COLLATE") {
            let next = item.get(j + 1);
            if !next.is_some_and(|n| is_valid_ident(n, src) && !COL_CONSTRAINT_KWS.iter().any(|k| n.is_kw(src, k))) {
                let a = next.unwrap_or(t);
                errs.push(sp(a.line, a.col, "Expected collation name after COLLATE"));
                return;
            }
            j += 2;
        } else if t.is_kw(src, "CONSTRAINT") {
            let next = item.get(j + 1);
            if !next.is_some_and(|n| is_valid_ident(n, src) && !COL_CONSTRAINT_KWS.iter().any(|k| n.is_kw(src, k)))
                || j + 2 >= item.len()
            {
                let a = next.unwrap_or(t);
                errs.push(sp(a.line, a.col, "Expected constraint name and definition after CONSTRAINT"));
                return;
            }
            j += 2;
        } else if t.is_kw(src, "IDENTITY") {
            j += 1;
            if item.get(j).is_some_and(|n| n.kind == SqlTokKind::LParen) {
                let Some(rp) = matching_rparen(item, j) else { return; };
                let args = split_comma_top(&item[j + 1..rp]);
                if rp == j + 1 || args.len() != 2 || !args.iter().all(|a| is_signed_num(a, src)) {
                    errs.push(sp(item[j].line, item[j].col, "Invalid IDENTITY(seed, increment) specification"));
                    return;
                }
                j = rp + 1;
            }
        } else if t.is_kw(src, "DEFAULT") {
            let Some(next_j) = validate_default(item, j, COL_CONSTRAINT_KWS, src, errs) else { return; };
            j = next_j;
        } else if t.is_kw(src, "CHECK") {
            let Some(next_j) = validate_check(item, j, src, errs) else { return; };
            j = next_j;
        } else if t.is_kw(src, "REFERENCES") {
            j += 1;
            if !item.get(j).is_some_and(|n| is_valid_ident(n, src)) {
                let a = item.get(j).unwrap_or(t);
                errs.push(sp(a.line, a.col, "Expected referenced table name after REFERENCES"));
                return;
            }
            j += 1;
            while item.get(j).is_some_and(|n| n.kind == SqlTokKind::Dot) {
                let dot = &item[j];
                j += 1;
                if !item.get(j).is_some_and(|n| is_valid_ident(n, src)) {
                    let a = item.get(j).unwrap_or(dot);
                    errs.push(sp(a.line, a.col, "Expected table name after '.' in REFERENCES"));
                    return;
                }
                j += 1;
            }
            if item.get(j).is_some_and(|n| n.kind == SqlTokKind::LParen) {
                let Some(rp) = matching_rparen(item, j) else { return; };
                if !validate_col_list(&item[j + 1..rp], &item[j], "REFERENCES", src, errs) { return; }
                j = rp + 1;
            }
        } else if t.is_kw(src, "ON") {
            if item.get(j + 1).is_some_and(|n| n.is_kw(src, "DELETE") || n.is_kw(src, "UPDATE")) {
                j += 2;
                if item.get(j).is_some_and(|n| n.is_kw(src, "CASCADE")) {
                    j += 1;
                } else if (item.get(j).is_some_and(|n| n.is_kw(src, "NO"))
                    && item.get(j + 1).is_some_and(|n| n.is_kw(src, "ACTION")))
                    || (item.get(j).is_some_and(|n| n.is_kw(src, "SET"))
                        && item.get(j + 1).is_some_and(|n| n.is_kw(src, "NULL") || n.is_kw(src, "DEFAULT")))
                {
                    j += 2;
                } else {
                    let a = item.get(j).unwrap_or(&item[j - 1]);
                    errs.push(sp(a.line, a.col, "Expected NO ACTION, CASCADE, SET NULL, or SET DEFAULT after ON DELETE/UPDATE"));
                    return;
                }
            } else if item.get(j + 1).is_some_and(|n| is_valid_ident(n, src) || n.kind == SqlTokKind::StringLit) {
                j += 2;
                if item.get(j).is_some_and(|n| n.kind == SqlTokKind::LParen) {
                    let Some(rp) = matching_rparen(item, j) else { return; };
                    if rp != j + 2 || !is_valid_ident(&item[j + 1], src) {
                        errs.push(sp(item[j].line, item[j].col, "Invalid partition column in ON clause"));
                        return;
                    }
                    j = rp + 1;
                }
            } else {
                errs.push(sp(t.line, t.col, "Expected filegroup or DELETE/UPDATE after ON in CREATE TABLE"));
                return;
            }
        } else if t.is_kw(src, "GENERATED") {
            j += 1;
            if item.get(j).is_some_and(|n| n.is_kw(src, "ALWAYS")) { j += 1; }
            else if item.get(j).is_some_and(|n| n.is_kw(src, "BY"))
                && item.get(j + 1).is_some_and(|n| n.is_kw(src, "DEFAULT"))
            {
                j += 2;
            } else {
                let a = item.get(j).unwrap_or(t);
                errs.push(sp(a.line, a.col, "Expected ALWAYS after GENERATED"));
                return;
            }
            if !item.get(j).is_some_and(|n| n.is_kw(src, "AS")) {
                let a = item.get(j).unwrap_or(&item[j - 1]);
                errs.push(sp(a.line, a.col, "Expected AS after GENERATED ALWAYS"));
                return;
            }
            j += 1;
            if item.get(j).is_some_and(|n| n.is_kw(src, "ROW") || n.is_kw(src, "TRANSACTION_ID") || n.is_kw(src, "SEQUENCE_NUMBER")) {
                j += 1;
                if !item.get(j).is_some_and(|n| n.is_kw(src, "START") || n.is_kw(src, "END")) {
                    let a = item.get(j).unwrap_or(&item[j - 1]);
                    errs.push(sp(a.line, a.col, "Expected START or END in GENERATED ALWAYS AS clause"));
                    return;
                }
                j += 1;
            } else if item.get(j).is_some_and(|n| n.kind == SqlTokKind::LParen) {
                let Some(next_j) = validate_paren_expr(item, j, "GENERATED ALWAYS AS", src, errs) else { return; };
                j = next_j;
                if item.get(j).is_some_and(|n| n.is_kw(src, "STORED") || n.is_kw(src, "VIRTUAL")) { j += 1; }
            } else if !item.get(j).is_some_and(|n| n.is_kw(src, "IDENTITY")) {
                let a = item.get(j).unwrap_or(&item[j - 1]);
                errs.push(sp(a.line, a.col, "Invalid GENERATED ALWAYS AS clause"));
                return;
            }
        } else if t.is_kw(src, "WITH") {
            if allow_with_values && item.get(j + 1).is_some_and(|n| n.is_kw(src, "VALUES")) {
                j += 2;
            } else if item.get(j + 1).is_some_and(|n| n.kind == SqlTokKind::LParen) {
                let Some(next_j) = validate_with_opts(item, j + 1, "WITH options", src, errs) else { return; };
                j = next_j;
            } else {
                let a = item.get(j + 1).unwrap_or(t);
                errs.push(sp(a.line, a.col, "Expected '(' after WITH in column constraint"));
                return;
            }
        } else if BARE_COL_KWS.iter().any(|k| t.is_kw(src, k)) {
            j += 1;
        } else {
            errs.push(sp(t.line, t.col, format!("Expected ',' before '{}' in CREATE TABLE", t.slice(src))));
            return;
        }
    }
}
