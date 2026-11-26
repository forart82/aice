use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};

const RESERVED_NON_VALUE_KWS: &[&str] = &[
    "AND", "OR", "XOR", "SELECT", "FROM", "WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET",
    "UNION", "INTERSECT", "EXCEPT", "INTO", "JOIN", "ON", "SET", "VALUES", "THEN", "ELSE",
    "ELSIF", "ELSEIF", "END", "WHEN", "DO", "IS", "IN", "LIKE", "ILIKE", "BETWEEN", "FOR",
    "WITH", "CREATE", "ALTER", "DROP", "INSERT", "UPDATE", "DELETE", "BEGIN", "RETURN",
    "PERFORM", "DECLARE", "AS", "USING", "EXISTS", "LOOP", "REPEAT", "WHILE",
];

pub(crate) fn is_atom_tok(t: &SqlTok, src: &str) -> bool {
    if t.kind == SqlTokKind::Word && RESERVED_NON_VALUE_KWS.iter().any(|k| t.is_kw(src, k)) {
        return false;
    }
    matches!(
        t.kind,
        SqlTokKind::Word | SqlTokKind::QuotedIdent | SqlTokKind::BracketIdent
            | SqlTokKind::BacktickIdent | SqlTokKind::Number | SqlTokKind::StringLit
            | SqlTokKind::Var | SqlTokKind::Param
    ) || t.is_op(src, "*")
}

pub(crate) fn is_atom_start(toks: &[SqlTok], idx: usize, src: &str) -> bool {
    let t = &toks[idx];
    is_atom_tok(t, src)
        || ((t.is_kw(src, "VALUES") || t.is_kw(src, "UPDATE") || t.is_kw(src, "EXISTS"))
            && toks.get(idx + 1).is_some_and(|n| n.kind == SqlTokKind::LParen))
}

pub(crate) fn infix_bp(t: &SqlTok, src: &str) -> Option<(u8, u8)> {
    if t.is_kw(src, "OR") { return Some((1, 2)); }
    if t.is_kw(src, "AND") { return Some((3, 4)); }
    if t.is_kw(src, "IS") || t.is_kw(src, "IN") || t.is_kw(src, "LIKE")
        || t.is_kw(src, "ILIKE") || t.is_kw(src, "BETWEEN")
    {
        return Some((4, 5));
    }
    if t.kind == SqlTokKind::Op {
        return match t.slice(src) {
            "=" | "<>" | "!=" | "<" | "<=" | ">" | ">=" | "@>" | "<@" | "@@" => Some((4, 5)),
            "+" | "-" | "||" | "&" | "|" | "^" => Some((5, 6)),
            "*" | "/" | "%" => Some((6, 7)),
            _ => None,
        };
    }
    None
}

pub(crate) fn skip_paren_group(toks: &[SqlTok], lp: usize) -> Option<usize> {
    let mut d = 0usize;
    for (idx, tok) in toks.iter().enumerate().skip(lp) {
        if tok.kind == SqlTokKind::LParen { d += 1; }
        else if tok.kind == SqlTokKind::RParen {
            d -= 1;
            if d == 0 { return Some(idx + 1); }
        }
    }
    None
}

pub(crate) fn skip_paren_rp(
    toks: &[SqlTok], lp: usize, rp: Option<(&[usize], usize)>,
) -> Option<usize> {
    if let Some((map, base)) = rp {
        let r = map.get(base + lp).copied().unwrap_or(usize::MAX);
        return (r != usize::MAX && r > base + lp && r - base < toks.len()).then_some(r - base + 1);
    }
    skip_paren_group(toks, lp)
}

pub(crate) fn is_over_stop_kw(t: &SqlTok, src: &str) -> bool {
    t.kind == SqlTokKind::Word && [
        "SELECT", "FROM", "INTO", "WHERE", "GROUP", "HAVING", "ORDER", "WINDOW",
        "UNION", "INTERSECT", "EXCEPT", "LIMIT", "OFFSET", "FETCH", "FOR", "OPTION",
        "ON", "SET", "VALUES", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS",
        "NATURAL", "OUTER", "APPLY", "PIVOT", "UNPIVOT", "USING", "RETURNING",
        "OUTPUT", "TOP", "DISTINCT", "ALL", "WITH", "AS",
        "AND", "OR", "NOT", "IS", "IN", "LIKE", "ILIKE", "SIMILAR", "BETWEEN",
        "EXISTS", "ANY", "SOME", "ESCAPE", "COLLATE", "CAST", "CASE", "WHEN",
        "THEN", "ELSE", "ELSIF", "ELSEIF", "END", "NULL", "TRUE", "FALSE",
        "DEFAULT", "OVER", "WITHIN", "FILTER", "ASC", "DESC", "NULLS", "BY",
        "CREATE", "ALTER", "DROP", "TRUNCATE", "INSERT", "UPDATE", "DELETE", "MERGE",
        "EXEC", "EXECUTE", "RETURN", "BEGIN", "DECLARE", "COMMIT", "ROLLBACK",
        "GRANT", "REVOKE", "DENY", "USE", "PRINT", "THROW", "RAISERROR", "GO",
        "IF", "WHILE", "LOOP", "REPEAT", "UNTIL", "LEAVE", "ITERATE", "DO",
        "CALL", "PERFORM", "RAISE", "EXIT", "CONTINUE", "GOTO", "WAITFOR",
    ].iter().any(|k| t.is_kw(src, k))
}

fn is_cast_stop_kw(t: &SqlTok, src: &str) -> bool {
    t.kind == SqlTokKind::Word && [
        "FROM", "WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET", "UNION",
        "INTERSECT", "EXCEPT", "INTO", "AS", "AND", "OR", "NOT", "ON", "SET", "VALUES",
        "THEN", "ELSE", "ELSIF", "END", "WHEN", "CASE", "NULL", "TRUE", "FALSE",
        "WITH", "SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "RETURNING",
    ].iter().any(|k| t.is_kw(src, k))
}

pub(crate) fn parse_pg_cast_type(
    toks: &[SqlTok], src: &str, idx: &mut usize, op_tok: &SqlTok,
) -> Result<(), ErrorSpan> {
    let Some(first) = toks.get(*idx) else {
        return Err(sp(op_tok.line, op_tok.col, "Expected type after '::'"));
    };
    if !matches!(first.kind, SqlTokKind::Word | SqlTokKind::QuotedIdent) || is_cast_stop_kw(first, src) {
        return Err(sp(op_tok.line, op_tok.col, "Expected type after '::'"));
    }
    *idx += 1;

    let mut mod_done = false;
    let qualified = toks.get(*idx).is_some_and(|n| n.kind == SqlTokKind::Dot);
    if qualified {
        let dot = &toks[*idx];
        *idx += 1;
        let Some(sub) = toks.get(*idx) else {
            return Err(sp(dot.line, dot.col, "Expected type name after '.'"));
        };
        if !matches!(sub.kind, SqlTokKind::Word | SqlTokKind::QuotedIdent) || is_cast_stop_kw(sub, src) {
            return Err(sp(sub.line, sub.col, "Expected type name after '.'"));
        }
        *idx += 1;
    } else if first.kind == SqlTokKind::Word {
        mod_done = consume_multiword_type(toks, src, idx, first)?;
    }

    if toks.get(*idx).is_some_and(|n| n.kind == SqlTokKind::LParen) {
        if mod_done {
            let lp = &toks[*idx];
            return Err(sp(lp.line, lp.col, "Unexpected type modifier in cast"));
        }
        consume_type_mod(toks, src, idx)?;
        if toks.get(*idx).is_some_and(|n| n.kind == SqlTokKind::LParen) {
            let lp = &toks[*idx];
            return Err(sp(lp.line, lp.col, "Duplicate type modifier in cast"));
        }
    }
    while toks.get(*idx).is_some_and(|n| n.kind == SqlTokKind::LBracket) {
        let lb = &toks[*idx];
        *idx += 1;
        if toks.get(*idx).is_some_and(|n| n.kind == SqlTokKind::Number) {
            *idx += 1;
        }
        if toks.get(*idx).is_some_and(|n| n.kind == SqlTokKind::RBracket) {
            *idx += 1;
        } else {
            return Err(sp(lb.line, lb.col, "Unclosed '[' in array type cast"));
        }
    }
    if toks.get(*idx).is_some_and(|n| n.kind == SqlTokKind::LParen) {
        let lp = &toks[*idx];
        return Err(sp(lp.line, lp.col, "Unexpected type modifier in cast"));
    }
    Ok(())
}

fn consume_multiword_type(
    toks: &[SqlTok], src: &str, idx: &mut usize, first: &SqlTok,
) -> Result<bool, ErrorSpan> {
    if first.is_kw(src, "DOUBLE") && toks.get(*idx).is_some_and(|n| n.is_kw(src, "PRECISION")) {
        *idx += 1;
        return Ok(true);
    } else if first.is_kw(src, "NATIONAL")
        && toks.get(*idx).is_some_and(|n| n.is_kw(src, "CHARACTER") || n.is_kw(src, "CHAR"))
    {
        *idx += 1;
        if toks.get(*idx).is_some_and(|n| n.is_kw(src, "VARYING")) { *idx += 1; }
    } else if (first.is_kw(src, "CHARACTER") || first.is_kw(src, "CHAR")
        || first.is_kw(src, "BIT") || first.is_kw(src, "NCHAR"))
        && toks.get(*idx).is_some_and(|n| n.is_kw(src, "VARYING"))
    {
        *idx += 1;
    } else if first.is_kw(src, "TIMESTAMP") || first.is_kw(src, "TIME") {
        let mut mod_done = false;
        if toks.get(*idx).is_some_and(|n| n.kind == SqlTokKind::LParen) {
            consume_type_mod(toks, src, idx)?;
            mod_done = true;
        }
        if toks.get(*idx).is_some_and(|n| n.is_kw(src, "WITH") || n.is_kw(src, "WITHOUT"))
            && toks.get(*idx + 1).is_some_and(|n| n.is_kw(src, "TIME"))
            && toks.get(*idx + 2).is_some_and(|n| n.is_kw(src, "ZONE"))
        {
            *idx += 3;
            mod_done = true;
        }
        return Ok(mod_done);
    } else if first.is_kw(src, "INTERVAL") {
        let Some(unit) = toks.get(*idx) else { return Ok(false); };
        if unit.is_kw(src, "TO") {
            return Err(sp(unit.line, unit.col, "Expected interval unit before 'TO'"));
        }
        if !is_interval_unit(unit, src) {
            return Ok(false);
        }
        let start_is_sec = unit.is_kw(src, "SECOND");
        *idx += 1;
        if toks.get(*idx).is_some_and(|n| n.kind == SqlTokKind::LParen) {
            let before_to = skip_paren_group(toks, *idx)
                .is_some_and(|after| toks.get(after).is_some_and(|n| n.is_kw(src, "TO")));
            if start_is_sec || before_to {
                consume_type_mod(toks, src, idx)?;
            }
        }
        if let Some(to_tok) = toks.get(*idx).filter(|n| n.is_kw(src, "TO")) {
            *idx += 1;
            let Some(end_u) = toks.get(*idx).filter(|n| is_interval_unit(n, src)) else {
                let a = toks.get(*idx).unwrap_or(to_tok);
                return Err(sp(a.line, a.col, "Expected interval unit after 'TO'"));
            };
            let end_is_sec = end_u.is_kw(src, "SECOND");
            *idx += 1;
            if end_is_sec && toks.get(*idx).is_some_and(|n| n.kind == SqlTokKind::LParen) {
                consume_type_mod(toks, src, idx)?;
            }
        }
        if let Some(bad) = toks.get(*idx).filter(|n| is_interval_unit(n, src) || n.is_kw(src, "TO")) {
            return Err(sp(bad.line, bad.col, "Unexpected interval unit in cast"));
        }
        return Ok(true);
    }
    Ok(false)
}

fn is_interval_unit(t: &SqlTok, src: &str) -> bool {
    ["YEAR", "MONTH", "DAY", "HOUR", "MINUTE", "SECOND"].iter().any(|k| t.is_kw(src, k))
}

fn consume_type_mod(toks: &[SqlTok], src: &str, idx: &mut usize) -> Result<(), ErrorSpan> {
    let lp = *idx;
    let lp_tok = &toks[lp];
    let rp_next = skip_paren_group(toks, lp)
        .ok_or_else(|| sp(lp_tok.line, lp_tok.col, "Unclosed '(' in type cast"))?;
    let args = &toks[lp + 1..rp_next - 1];
    if args.is_empty() {
        return Err(sp(lp_tok.line, lp_tok.col, "Empty '()' in type cast"));
    }
    let mut k = 0usize;
    loop {
        if args.get(k).is_some_and(|t| t.is_op(src, "+") || t.is_op(src, "-")) {
            k += 1;
        }
        let Some(val) = args.get(k) else {
            return Err(sp(lp_tok.line, lp_tok.col, "Expected type modifier argument"));
        };
        if !matches!(val.kind, SqlTokKind::Number | SqlTokKind::Word | SqlTokKind::StringLit) {
            return Err(sp(val.line, val.col, "Invalid type modifier argument"));
        }
        k += 1;
        if k == args.len() { break; }
        if args[k].kind != SqlTokKind::Comma {
            return Err(sp(args[k].line, args[k].col, "Expected ',' in type modifier"));
        }
        k += 1;
        if k == args.len() {
            return Err(sp(args[k - 1].line, args[k - 1].col, "Trailing ',' in type modifier"));
        }
    }
    *idx = rp_next;
    Ok(())
}

pub(crate) fn check_pg_casts(stmt: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) -> Vec<(usize, usize)> {
    let mut masks = Vec::new();
    let mut i = 0usize;
    while i < stmt.len() {
        if stmt[i].kind == SqlTokKind::ColonColon {
            let mut idx = i + 1;
            if let Err(e) = parse_pg_cast_type(stmt, src, &mut idx, &stmt[i]) {
                errs.push(e);
                i += 1;
            } else {
                if idx > i + 2 {
                    masks.push((stmt[i + 1].end, stmt[idx - 1].end));
                }
                i = idx;
            }
        } else {
            i += 1;
        }
    }
    masks
}
