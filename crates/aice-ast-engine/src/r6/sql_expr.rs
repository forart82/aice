use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
pub(crate) use crate::r6::sql_trim::{validate_and_collect_trim_masks, validate_and_mask_trim_calls};

pub fn strip_comments(toks: &[SqlTok]) -> Vec<SqlTok> {
    toks.iter().copied().filter(|t| t.kind != SqlTokKind::Comment).collect()
}

pub fn check_delimiters(toks: &[SqlTok]) -> Vec<ErrorSpan> {
    let mut errs = Vec::new();
    let mut stack: Vec<(SqlTokKind, usize, usize)> = Vec::new();
    for t in toks {
        match t.kind {
            SqlTokKind::LParen => stack.push((SqlTokKind::RParen, t.line, t.col)),
            SqlTokKind::LBracket => stack.push((SqlTokKind::RBracket, t.line, t.col)),
            SqlTokKind::LBrace => stack.push((SqlTokKind::RBrace, t.line, t.col)),
            SqlTokKind::RParen | SqlTokKind::RBracket | SqlTokKind::RBrace => {
                if let Some((exp, _, _)) = stack.pop() {
                    if exp != t.kind {
                        errs.push(sp(t.line, t.col, "Mismatched closing delimiter"));
                    }
                } else {
                    errs.push(sp(t.line, t.col, "Unexpected closing delimiter"));
                }
            }
            _ => {}
        }
    }
    while let Some((exp, line, col)) = stack.pop() {
        let ch = match exp {
            SqlTokKind::RParen => "(",
            SqlTokKind::RBracket => "[",
            _ => "{",
        };
        errs.push(sp(line, col, format!("Unclosed '{ch}' delimiter")));
    }
    errs
}

pub fn split_statements_semi(toks: &[SqlTok]) -> Vec<&[SqlTok]> {
    let mut out = Vec::new();
    let mut start = 0usize;
    let mut depth = 0usize;
    for (i, t) in toks.iter().enumerate() {
        match t.kind {
            SqlTokKind::LParen | SqlTokKind::LBracket | SqlTokKind::LBrace => depth += 1,
            SqlTokKind::RParen | SqlTokKind::RBracket | SqlTokKind::RBrace => {
                depth = depth.saturating_sub(1);
            }
            SqlTokKind::Semi if depth == 0 => {
                if start < i { out.push(&toks[start..i]); }
                start = i + 1;
            }
            _ => {}
        }
    }
    if start < toks.len() { out.push(&toks[start..]); }
    out
}

pub fn check_sql_stmt_completeness(stmt: &[SqlTok], src: &str) -> Vec<ErrorSpan> {
    let mut errs = Vec::new();
    if stmt.is_empty() { return errs; }

    for i in 0..stmt.len() {
        let t = &stmt[i];
        let next = stmt.get(i + 1);
        let prev = if i > 0 { Some(&stmt[i - 1]) } else { None };

        if t.kind == SqlTokKind::Comma {
            if next.is_none()
                || matches!(next.map(|n| n.kind), Some(SqlTokKind::RParen | SqlTokKind::Comma))
                || next.is_some_and(|n| is_comma_forbidden_kw(n, src))
            {
                errs.push(sp(t.line, t.col, "Unexpected trailing or consecutive ','"));
            }
            if matches!(prev.map(|p| p.kind), Some(SqlTokKind::LParen)) {
                errs.push(sp(t.line, t.col, "Unexpected leading ',' after '('"));
            }
        }
        if t.kind == SqlTokKind::LParen && next.is_some_and(|n| n.kind == SqlTokKind::RParen)
            && prev.is_some_and(|p| p.is_kw(src, "IN") || p.is_kw(src, "VALUES"))
        {
            errs.push(sp(t.line, t.col, "Empty '()' list is not allowed here"));
        }
        let not_member = prev.is_none_or(|p| p.kind != SqlTokKind::Dot);
        if not_member && t.is_kw(src, "SELECT") && check_empty_select(stmt, src, i) {
            errs.push(sp(t.line, t.col, "Missing projection list in SELECT"));
        }
        if not_member && is_clause_kw(t, src) && check_empty_clause(stmt, src, i) {
            errs.push(sp(t.line, t.col, format!("Incomplete '{}' clause", t.slice(src))));
        }
        if is_dangling_op(stmt, i, src) {
            errs.push(sp(t.line, t.col, format!("Dangling operator '{}'", t.slice(src))));
        }
    }
    check_ddl_headers(stmt, src, &mut errs);
    errs
}

fn check_empty_select(stmt: &[SqlTok], src: &str, idx: usize) -> bool {
    let mut j = idx + 1;
    while let Some(tok) = stmt.get(j) {
        if tok.is_kw(src, "DISTINCT") || tok.is_kw(src, "ALL") { j += 1; continue; }
        return tok.is_kw(src, "FROM") || tok.kind == SqlTokKind::RParen;
    }
    true
}

fn is_clause_kw(t: &SqlTok, src: &str) -> bool {
    t.kind == SqlTokKind::Word && ["WHERE", "HAVING", "SET", "VALUES", "FROM", "INTO", "RETURNING", "LIMIT", "OFFSET"]
        .iter().any(|k| t.is_kw(src, k))
}

fn is_comma_forbidden_kw(t: &SqlTok, src: &str) -> bool {
    t.kind == SqlTokKind::Word && [
        "FROM", "WHERE", "GROUP", "ORDER", "HAVING", "INTO", "SET", "VALUES", "RETURNING",
        "UNION", "INTERSECT", "EXCEPT", "LIMIT", "OFFSET", "JOIN", "ON", "FETCH", "FOR",
    ].iter().any(|k| t.is_kw(src, k))
}

fn is_major_boundary(t: &SqlTok, src: &str) -> bool {
    t.kind == SqlTokKind::RParen || (t.kind == SqlTokKind::Word && [
        "FROM", "WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET",
        "RETURNING", "UNION", "EXCEPT", "INTERSECT", "ON", "SET", "VALUES", "INTO",
    ].iter().any(|k| t.is_kw(src, k)))
}

fn check_empty_clause(stmt: &[SqlTok], src: &str, idx: usize) -> bool {
    let t = &stmt[idx];
    if t.is_kw(src, "VALUES") && is_insert_default_values(stmt, src, idx) {
        return false;
    }
    let Some(next) = stmt.get(idx + 1) else { return true; };
    if t.is_kw(src, "SET") && (next.is_kw(src, "NULL") || next.is_kw(src, "DEFAULT")) {
        return false;
    }
    if t.is_kw(src, "INTO") && next.kind == SqlTokKind::LParen {
        return false;
    }
    if t.is_kw(src, "FROM") && next.kind == SqlTokKind::LParen {
        return false;
    }
    if t.is_kw(src, "VALUES") && next.kind == SqlTokKind::LParen {
        return false;
    }
    is_major_boundary(next, src)
}

fn is_dangling_op(stmt: &[SqlTok], i: usize, src: &str) -> bool {
    let t = &stmt[i];
    let prev = i.checked_sub(1).map(|p| &stmt[p]);
    let next = stmt.get(i + 1);
    let prev_is_dot = prev.is_some_and(|p| p.kind == SqlTokKind::Dot);
    let prev2_is_dot = i >= 2 && stmt[i - 2].kind == SqlTokKind::Dot;
    let is_cmp_or_assign = t.kind == SqlTokKind::Op && matches!(
        t.slice(src), "=" | "<>" | "!=" | "<" | ">" | "<=" | ">=" | "/" | "%" | "||" | ":=" | "+=" | "-=" | "*=" | "/="
    );
    let is_plus_minus = t.kind == SqlTokKind::Op && matches!(t.slice(src), "+" | "-");
    let is_logic = !prev_is_dot && (t.is_kw(src, "AND") || t.is_kw(src, "OR"));

    let bad_after = next.is_none() || next.is_some_and(|n| {
        matches!(n.kind, SqlTokKind::RParen | SqlTokKind::Comma)
            || (n.kind == SqlTokKind::Word && [
                "FROM", "WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET",
                "RETURNING", "UNION", "EXCEPT", "INTERSECT", "SET", "AND", "OR",
            ].iter().any(|k| n.is_kw(src, k)))
    });
    if (is_cmp_or_assign || is_plus_minus || is_logic) && bad_after {
        return true;
    }
    if (is_cmp_or_assign || is_logic) && !prev2_is_dot && prev.is_some_and(|p| {
        matches!(p.kind, SqlTokKind::LParen | SqlTokKind::Comma)
            || p.is_kw(src, "WHERE") || p.is_kw(src, "HAVING") || p.is_kw(src, "ON")
            || p.is_kw(src, "SET") || p.is_kw(src, "AND") || p.is_kw(src, "OR")
    }) {
        return true;
    }
    false
}

fn check_ddl_headers(stmt: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    if stmt.len() == 1 && (stmt[0].is_kw(src, "CREATE") || stmt[0].is_kw(src, "DROP") || stmt[0].is_kw(src, "ALTER")) {
        errs.push(sp(stmt[0].line, stmt[0].col, "Incomplete DDL statement"));
        return;
    }
    let last = &stmt[stmt.len() - 1];
    if stmt.len() >= 2 && (stmt[0].is_kw(src, "DROP") || stmt[0].is_kw(src, "CREATE") || stmt[0].is_kw(src, "ALTER"))
        && ["TABLE", "VIEW", "INDEX", "TRIGGER", "FUNCTION", "PROCEDURE", "PROC", "SCHEMA", "EXISTS"]
            .iter().any(|k| last.is_kw(src, k))
    {
        errs.push(sp(last.line, last.col, "Incomplete DDL statement missing object name"));
    }
    for i in 0..stmt.len().saturating_sub(1) {
        if (stmt[i].is_kw(src, "ORDER") || stmt[i].is_kw(src, "GROUP")) && stmt[i + 1].is_kw(src, "BY")
            && stmt.get(i + 2).is_none_or(|n| is_major_boundary(n, src))
        {
            errs.push(sp(stmt[i].line, stmt[i].col, format!("Incomplete '{} BY' clause", stmt[i].slice(src))));
        }
    }
}

fn is_insert_default_values(stmt: &[SqlTok], src: &str, idx: usize) -> bool {
    if idx == 0 || !stmt[idx - 1].is_kw(src, "DEFAULT")
        || (idx >= 2 && stmt[idx - 2].kind == SqlTokKind::Dot)
    {
        return false;
    }
    let mut d = 0isize;
    for k in (0..idx - 1).rev() {
        let tok = &stmt[k];
        if tok.kind == SqlTokKind::RParen { d += 1; }
        else if tok.kind == SqlTokKind::LParen {
            d -= 1;
            if d < 0 { return false; }
        } else if d == 0 && (k == 0 || stmt[k - 1].kind != SqlTokKind::Dot) {
            if tok.is_kw(src, "INSERT") { return true; }
            if ["SELECT", "UPDATE", "DELETE", "VALUES", "FROM", "WHERE", "SET", "USING", "EXEC", "EXECUTE"]
                .iter().any(|kw| tok.is_kw(src, kw))
            {
                return false;
            }
        }
    }
    false
}
