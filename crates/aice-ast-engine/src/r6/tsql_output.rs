use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
use crate::r6::sql_pratt::validate_pratt_expr;
use crate::r6::tsql_dml::{consume_dml_target, validate_col_list};
use crate::r6::tsql_stmt::{matching_rparen, split_comma_top};

pub(super) fn consume_output(
    stmt: &[SqlTok], mut i: usize, kw: &str, src: &str, errs: &mut Vec<ErrorSpan>, stops: &[&str],
) -> Option<usize> {
    if !stmt.get(i).is_some_and(|t| t.is_kw(src, "OUTPUT")) { return Some(i); }
    let out_tok = &stmt[i];
    i += 1;
    let (start, mut d, mut cases) = (i, 0usize, 0usize);
    let mut into_pos = None;
    while i < stmt.len() {
        let t = &stmt[i];
        let not_dot = i == 0 || stmt[i - 1].kind != SqlTokKind::Dot;
        if d == 0 && cases == 0 && not_dot && stops.iter().any(|k| t.is_kw(src, k)) { break; }
        if d == 0 && cases == 0 && not_dot && t.is_kw(src, "INTO") {
            if i == start {
                errs.push(sp(t.line, t.col, format!("Empty expression before INTO in OUTPUT of T-SQL {kw}")));
                return None;
            }
            into_pos = Some(i);
            break;
        }
        if t.kind == SqlTokKind::LParen { d += 1; }
        else if t.kind == SqlTokKind::RParen { d = d.saturating_sub(1); }
        else if d == 0 && not_dot && t.is_kw(src, "CASE") { cases += 1; }
        else if d == 0 && not_dot && t.is_kw(src, "END") && cases > 0 { cases -= 1; }
        i += 1;
    }
    if i == start {
        errs.push(sp(out_tok.line, out_tok.col, format!("Incomplete OUTPUT clause in T-SQL {kw}")));
        return None;
    }
    if !validate_output_items(&stmt[start..i], src, errs) {
        return None;
    }
    if let Some(ip) = into_pos {
        i = consume_dml_target(stmt, ip + 1, kw, src, errs)?;
        if stmt.get(i).is_some_and(|n| n.kind == SqlTokKind::LParen)
            && !stmt.get(i + 1).is_some_and(|n| n.is_kw(src, "SELECT") || n.is_kw(src, "WITH") || n.kind == SqlTokKind::LParen)
        {
            let rp = matching_rparen(stmt, i)?;
            if !validate_col_list(&stmt[i + 1..rp], &stmt[i], "OUTPUT INTO", src, errs) { return None; }
            i = rp + 1;
        }
    }
    Some(i)
}

fn is_niladic_output_kw(t: &SqlTok, src: &str) -> bool {
    ["NULL", "CURRENT_TIMESTAMP", "CURRENT_USER", "SESSION_USER", "SYSTEM_USER", "USER"]
        .iter().any(|k| t.is_kw(src, k))
}

fn validate_output_items(proj: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) -> bool {
    for item in split_comma_top(proj) {
        if item.is_empty() {
            errs.push(sp(proj[0].line, proj[0].col, "Empty projection item in T-SQL OUTPUT"));
            return false;
        }
        let mut idx = 0;
        if let Err(e) = validate_pratt_expr(item, src, &mut idx, 0, &["AS"]) {
            errs.push(e);
            return false;
        }
        let tail = &item[idx..];
        let has_star = idx > 0 && item[idx - 1].is_op(src, "*");
        let bare_word_pair = tail.len() == 1 && idx == 1 && item[0].kind == SqlTokKind::Word
            && !is_niladic_output_kw(&item[0], src);
        let is_alias = |t: &SqlTok| {
            matches!(t.kind, SqlTokKind::Word | SqlTokKind::QuotedIdent | SqlTokKind::BracketIdent | SqlTokKind::StringLit)
                && !t.is_kw(src, "AS")
                && (!matches!(t.kind, SqlTokKind::QuotedIdent | SqlTokKind::BracketIdent) || !t.ident_name(src).is_empty())
        };
        let ok = tail.is_empty()
            || (!has_star && !bare_word_pair && tail.len() == 1 && is_alias(&tail[0]))
            || (!has_star && tail.len() == 2 && tail[0].is_kw(src, "AS") && is_alias(&tail[1]));
        if !ok {
            errs.push(sp(tail[0].line, tail[0].col, format!("Unexpected token '{}' in T-SQL OUTPUT", tail[0].slice(src))));
            return false;
        }
    }
    true
}
