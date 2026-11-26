use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
use crate::r6::tsql_ddl::{TBL_CONSTRAINT_KWS, validate_tbl_constraint};
use crate::r6::tsql_ddl_extra::{is_valid_ident, validate_tsql_col_def, validate_with_opts};
use crate::r6::tsql_dml::consume_dml_target;
use crate::r6::tsql_stmt::split_comma_top;

pub(crate) fn validate_tsql_alter_table(stmt: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    if stmt.get(2).is_some_and(|t| t.kind == SqlTokKind::Var) {
        errs.push(sp(stmt[2].line, stmt[2].col, "Invalid table name in ALTER TABLE"));
        return;
    }
    let Some(mut i) = consume_dml_target(stmt, 2, "ALTER TABLE", src, errs) else { return; };
    if i >= stmt.len() {
        let a = &stmt[i.saturating_sub(1)];
        errs.push(sp(a.line, a.col, "Incomplete ALTER TABLE statement missing action"));
        return;
    }
    if stmt[i].is_kw(src, "WITH") {
        if !stmt.get(i + 1).is_some_and(|t| t.is_kw(src, "CHECK") || t.is_kw(src, "NOCHECK")) {
            let a = stmt.get(i + 1).unwrap_or(&stmt[i]);
            errs.push(sp(a.line, a.col, "Expected CHECK or NOCHECK after WITH in ALTER TABLE"));
            return;
        }
        i += 2;
        if i >= stmt.len() {
            errs.push(sp(stmt[i - 1].line, stmt[i - 1].col, "Incomplete ALTER TABLE after WITH CHECK/NOCHECK"));
            return;
        }
    }
    let act = &stmt[i];
    if act.is_kw(src, "ADD") {
        validate_alter_add(act, &stmt[i + 1..], src, errs);
    } else if act.is_kw(src, "DROP") {
        validate_alter_drop(act, &stmt[i + 1..], src, errs);
    } else if act.is_kw(src, "ALTER") {
        if !stmt.get(i + 1).is_some_and(|t| t.is_kw(src, "COLUMN"))
            || !stmt.get(i + 2).is_some_and(|t| is_valid_ident(t, src))
            || i + 3 >= stmt.len()
        {
            errs.push(sp(act.line, act.col, "Incomplete ALTER COLUMN clause in ALTER TABLE"));
        }
    } else if act.is_kw(src, "CHECK") || act.is_kw(src, "NOCHECK") {
        if !stmt.get(i + 1).is_some_and(|t| t.is_kw(src, "CONSTRAINT")) || i + 2 >= stmt.len() {
            errs.push(sp(act.line, act.col, "Expected CONSTRAINT <name|ALL> in ALTER TABLE"));
        }
    } else if act.is_kw(src, "ENABLE") || act.is_kw(src, "DISABLE") {
        if !stmt.get(i + 1).is_some_and(|t| t.is_kw(src, "TRIGGER") || t.is_kw(src, "CHANGE_TRACKING")) {
            errs.push(sp(act.line, act.col, "Expected TRIGGER or CHANGE_TRACKING in ALTER TABLE"));
        }
    } else if act.is_kw(src, "SET") {
        if stmt.get(i + 1).is_some_and(|t| t.kind == SqlTokKind::LParen) {
            let _ = validate_with_opts(stmt, i + 1, "ALTER TABLE SET", src, errs);
        } else {
            errs.push(sp(act.line, act.col, "Expected '(...)' after SET in ALTER TABLE"));
        }
    } else if !(act.is_kw(src, "SWITCH") || act.is_kw(src, "REBUILD") || act.is_kw(src, "SPLIT") || act.is_kw(src, "MERGE"))
        || i + 1 >= stmt.len()
    {
        errs.push(sp(act.line, act.col, format!("Invalid or incomplete ALTER TABLE action '{}'", act.slice(src))));
    }
}

fn validate_alter_add(act: &SqlTok, rest: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    if rest.is_empty() {
        errs.push(sp(act.line, act.col, "Incomplete ADD clause in ALTER TABLE"));
        return;
    }
    for item in split_comma_top(rest) {
        if item.is_empty() {
            errs.push(sp(act.line, act.col, "Empty item in ALTER TABLE ADD"));
            continue;
        }
        if item[0].is_kw(src, "COLUMN") {
            if item.len() < 2 {
                errs.push(sp(item[0].line, item[0].col, "Incomplete ADD COLUMN in ALTER TABLE"));
            } else {
                validate_tsql_col_def(&item[1..], src, errs, true);
            }
        } else if TBL_CONSTRAINT_KWS.iter().any(|k| item[0].is_kw(src, k)) || item[0].is_kw(src, "DEFAULT") {
            let trim = if item.len() >= 2
                && item[item.len() - 2].is_kw(src, "WITH")
                && item[item.len() - 1].is_kw(src, "VALUES")
            {
                &item[..item.len() - 2]
            } else {
                item
            };
            validate_tbl_constraint(trim, src, errs);
        } else {
            validate_tsql_col_def(item, src, errs, true);
        }
    }
}

fn validate_alter_drop(act: &SqlTok, rest: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    if rest.is_empty() {
        errs.push(sp(act.line, act.col, "Incomplete DROP clause in ALTER TABLE"));
        return;
    }
    for item in split_comma_top(rest) {
        if item.is_empty() {
            errs.push(sp(act.line, act.col, "Empty item in ALTER TABLE DROP"));
            continue;
        }
        let mut k = 0usize;
        if item[0].is_kw(src, "COLUMN") || item[0].is_kw(src, "CONSTRAINT") {
            k = 1;
            if item.get(k).is_some_and(|t| t.is_kw(src, "IF")) {
                if !item.get(k + 1).is_some_and(|t| t.is_kw(src, "EXISTS")) {
                    errs.push(sp(item[k].line, item[k].col, "Expected EXISTS after IF in ALTER TABLE DROP"));
                    continue;
                }
                k += 2;
            }
        } else if item[0].is_kw(src, "PERIOD") {
            if item.len() != 3 || !item[1].is_kw(src, "FOR") || !item[2].is_kw(src, "SYSTEM_TIME") {
                errs.push(sp(item[0].line, item[0].col, "Expected PERIOD FOR SYSTEM_TIME in ALTER TABLE DROP"));
            }
            continue;
        }
        if k >= item.len() || !is_valid_ident(&item[k], src) || k + 1 < item.len() {
            let a = item.get(k).unwrap_or(&item[0]);
            errs.push(sp(a.line, a.col, "Expected valid column or constraint name in ALTER TABLE DROP"));
        }
    }
}
