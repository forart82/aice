use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
use crate::r6::sql_pratt::validate_pratt_expr;
use crate::r6::tsql_dml::{consume_dml_target, is_dml_ident};
use crate::r6::tsql_stmt::matching_rparen;

pub(crate) fn consume_exec_source(
    stmt: &[SqlTok], pos: usize, exec_tok: &SqlTok, src: &str, errs: &mut Vec<ErrorSpan>,
) {
    if pos >= stmt.len() {
        errs.push(sp(exec_tok.line, exec_tok.col, "Incomplete EXEC data source in T-SQL INSERT"));
        return;
    }
    if stmt[pos].kind == SqlTokKind::LParen {
        let Some(rp) = matching_rparen(stmt, pos) else { return; };
        if rp == pos + 1 {
            errs.push(sp(stmt[pos].line, stmt[pos].col, "Empty '()' in INSERT EXEC"));
            return;
        }
        let mut idx = 0;
        if let Err(e) = validate_pratt_expr(&stmt[pos..=rp], src, &mut idx, 0, &[]) {
            errs.push(e);
            return;
        }
        if idx < rp - pos + 1 {
            errs.push(sp(stmt[pos + idx].line, stmt[pos + idx].col, format!("Unexpected token '{}' in INSERT EXEC", stmt[pos + idx].slice(src))));
            return;
        }
        let mut next = rp + 1;
        if stmt.get(next).is_some_and(|t| t.is_kw(src, "AT")) {
            let Some(srv) = stmt.get(next + 1).filter(|t| is_dml_ident(t, src)) else {
                let a = stmt.get(next + 1).unwrap_or(&stmt[next]);
                errs.push(sp(a.line, a.col, "Expected linked server name after AT in INSERT EXEC"));
                return;
            };
            let _ = srv;
            next += 2;
        }
        if next < stmt.len() {
            errs.push(sp(stmt[next].line, stmt[next].col, format!("Unexpected token '{}' in INSERT EXEC", stmt[next].slice(src))));
        }
        return;
    }
    let proc_pos = if stmt[pos].kind == SqlTokKind::Var && stmt.get(pos + 1).is_some_and(|t| t.is_op(src, "=")) {
        if stmt[pos].slice(src).starts_with("@@") || stmt[pos].slice(src).len() <= 1 {
            errs.push(sp(stmt[pos].line, stmt[pos].col, "Invalid return variable in INSERT EXEC"));
            return;
        }
        pos + 2
    } else {
        pos
    };
    let Some(next) = consume_dml_target(stmt, proc_pos, "INSERT EXEC", src, errs) else { return; };
    validate_exec_proc_tail(&stmt[next..], src, errs);
}

pub(crate) fn validate_exec_proc_tail(
    tail: &[SqlTok],
    src: &str,
    errs: &mut Vec<ErrorSpan>,
) {
    let mut i = 0usize;
    if i < tail.len() && !tail[i].is_kw(src, "WITH") {
        loop {
            if i >= tail.len() {
                let a = &tail[i - 1];
                errs.push(sp(a.line, a.col, "Expected argument after ',' in INSERT EXEC"));
                return;
            }
            if tail[i].kind == SqlTokKind::Var
                && tail.get(i + 1).is_some_and(|t| t.is_op(src, "="))
            {
                let p = tail[i].slice(src);
                if p.starts_with("@@") || p.len() <= 1 {
                    errs.push(sp(tail[i].line, tail[i].col, "Invalid parameter name in INSERT EXEC"));
                    return;
                }
                i += 2;
            }
            let Some(v) = tail.get(i) else {
                let a = &tail[i - 1];
                errs.push(sp(a.line, a.col, "Expected argument value in INSERT EXEC"));
                return;
            };
            let mut can_out = false;
            if (v.is_op(src, "+") || v.is_op(src, "-"))
                && tail.get(i + 1).is_some_and(|n| n.kind == SqlTokKind::Number)
            {
                i += 2;
            } else if v.kind == SqlTokKind::Var {
                let s = v.slice(src);
                if s.len() <= 1 {
                    errs.push(sp(v.line, v.col, "Invalid variable argument in INSERT EXEC"));
                    return;
                }
                can_out = !s.starts_with("@@");
                i += 1;
            } else if matches!(v.kind, SqlTokKind::Number | SqlTokKind::StringLit)
                || v.is_kw(src, "DEFAULT")
                || v.is_kw(src, "NULL")
                || v.is_kw(src, "TRUE")
                || v.is_kw(src, "FALSE")
            {
                i += 1;
            } else {
                errs.push(sp(v.line, v.col, format!("Invalid argument '{}' in INSERT EXEC", v.slice(src))));
                return;
            }
            if can_out
                && tail
                    .get(i)
                    .is_some_and(|t| t.is_kw(src, "OUTPUT") || t.is_kw(src, "OUT"))
            {
                i += 1;
            }
            if tail.get(i).is_some_and(|t| t.kind == SqlTokKind::Comma) {
                i += 1;
            } else {
                break;
            }
        }
    }
    if tail.get(i).is_some_and(|t| t.is_kw(src, "WITH")) {
        if !tail.get(i + 1).is_some_and(|t| t.is_kw(src, "RECOMPILE")) {
            let a = tail.get(i + 1).unwrap_or(&tail[i]);
            errs.push(sp(a.line, a.col, "Expected RECOMPILE after WITH in INSERT EXEC"));
            return;
        }
        i += 2;
    }
    if i < tail.len() {
        errs.push(sp(tail[i].line, tail[i].col, format!("Unexpected token '{}' in INSERT EXEC", tail[i].slice(src))));
    }
}
