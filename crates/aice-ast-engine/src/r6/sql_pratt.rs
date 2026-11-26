use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
use crate::r6::sql_pratt_ext::{infix_bp, is_atom_start, is_over_stop_kw, parse_pg_cast_type, skip_paren_rp};

const FN_STOP_KWS: &[&str] = &["AS", "FROM", "FOR", "ORDER", "SEPARATOR", "USING"];

#[derive(Clone, Copy)]
enum PrattFrame<'a> {
    Expr { min_bp: u8, stop_kws: &'a [&'a str] },
    Paren { line: usize, col: usize },
    FnArgs { line: usize, col: usize, need_from: bool, no_comma: bool, is_trim: bool, allow_from: bool },
}

enum Phase { Prefix, Infix }

pub fn validate_pratt_expr(
    toks: &[SqlTok], src: &str, idx: &mut usize, min_bp: u8, stop_kws: &[&str],
) -> Result<(), ErrorSpan> {
    validate_pratt_expr_rp(toks, src, idx, min_bp, stop_kws, None)
}

pub(crate) fn validate_pratt_expr_rp(
    toks: &[SqlTok], src: &str, idx: &mut usize, min_bp: u8, stop_kws: &[&str],
    rp: Option<(&[usize], usize)>,
) -> Result<(), ErrorSpan> {
    let mut stack = vec![PrattFrame::Expr { min_bp, stop_kws }];
    let mut phase = Phase::Prefix;

    while let Some(&top) = stack.last() {
        match phase {
            Phase::Prefix => {
                let PrattFrame::Expr { min_bp: cur_bp, stop_kws: cur_stops } = top else {
                    phase = Phase::Infix;
                    continue;
                };
                let Some(t) = toks.get(*idx) else {
                    let last = toks.last();
                    return Err(sp(last.map_or(1, |x| x.line), last.map_or(1, |x| x.col), "Expected expression"));
                };
                if t.kind == SqlTokKind::Word && cur_stops.iter().any(|k| t.is_kw(src, k)) {
                    return Err(sp(t.line, t.col, format!("Expected expression before '{}'", t.slice(src))));
                }
                if t.is_op(src, "+") || t.is_op(src, "-") || t.is_op(src, "~") || t.is_kw(src, "NOT") {
                    *idx += 1;
                    if cur_bp < 7 {
                        stack.push(PrattFrame::Expr { min_bp: 7, stop_kws: cur_stops });
                    }
                    continue;
                }
                if t.kind == SqlTokKind::LParen {
                    *idx += 1;
                    if toks.get(*idx).is_some_and(|n| n.is_kw(src, "SELECT") || n.is_kw(src, "WITH")) {
                        *idx = skip_paren_rp(toks, *idx - 1, rp)
                            .ok_or_else(|| sp(t.line, t.col, "Unclosed '(' in subquery"))?;
                        phase = Phase::Infix;
                    } else {
                        stack.push(PrattFrame::Paren { line: t.line, col: t.col });
                        stack.push(PrattFrame::Expr { min_bp: 0, stop_kws: &[] });
                    }
                    continue;
                }
                if t.is_kw(src, "CASE") {
                    *idx += 1;
                    let mut cdepth = 1usize;
                    let mut pdepth = 0usize;
                    while *idx < toks.len() && cdepth > 0 {
                        match toks[*idx].kind {
                            SqlTokKind::LParen => {
                                if pdepth == 0 && let Some(ni) = rp.and_then(|_| skip_paren_rp(toks, *idx, rp)) {
                                    *idx = ni; continue;
                                }
                                pdepth += 1;
                            }
                            SqlTokKind::RParen => pdepth = pdepth.saturating_sub(1),
                            _ if pdepth == 0 && toks[*idx - 1].kind != SqlTokKind::Dot && toks[*idx].is_kw(src, "CASE") => cdepth += 1,
                            _ if pdepth == 0 && toks[*idx - 1].kind != SqlTokKind::Dot && toks[*idx].is_kw(src, "END") => cdepth -= 1,
                            _ => {}
                        }
                        *idx += 1;
                    }
                    if cdepth != 0 { return Err(sp(t.line, t.col, "Unclosed CASE expression")); }
                    phase = Phase::Infix;
                    continue;
                }
                if is_atom_start(toks, *idx, src) {
                    *idx += 1;
                    while toks.get(*idx).is_some_and(|n| n.kind == SqlTokKind::Dot) {
                        let dot = &toks[*idx];
                        *idx += 1;
                        let Some(next) = toks.get(*idx) else {
                            return Err(sp(dot.line, dot.col, "Expected identifier or '*' after '.'"));
                        };
                        if matches!(
                            next.kind,
                            SqlTokKind::Word | SqlTokKind::QuotedIdent | SqlTokKind::BracketIdent | SqlTokKind::BacktickIdent
                        ) || next.is_op(src, "*")
                        {
                            *idx += 1;
                        } else {
                            return Err(sp(next.line, next.col, "Expected identifier or '*' after '.'"));
                        }
                    }
                    if toks.get(*idx).is_some_and(|n| n.kind == SqlTokKind::LParen) {
                        *idx += 1;
                        if toks.get(*idx).is_some_and(|n| n.kind == SqlTokKind::RParen) {
                            if t.is_kw(src, "TRIM") || t.is_kw(src, "EXISTS") {
                                return Err(sp(t.line, t.col, format!("Empty arguments in {}()", t.slice(src))));
                            }
                            *idx += 1;
                            phase = Phase::Infix;
                        } else if toks.get(*idx).is_some_and(|n| n.is_kw(src, "SELECT") || n.is_kw(src, "WITH")) {
                            *idx = skip_paren_rp(toks, *idx - 1, rp)
                                .ok_or_else(|| sp(t.line, t.col, "Unclosed '(' in subquery"))?;
                            phase = Phase::Infix;
                        } else {
                            let is_trim = t.is_kw(src, "TRIM");
                            let (mut need_from, mut no_comma, mut allow_from) = (false, false, true);
                            if is_trim {
                                if toks.get(*idx).is_some_and(|n| {
                                    n.is_kw(src, "BOTH") || n.is_kw(src, "LEADING") || n.is_kw(src, "TRAILING")
                                }) {
                                    *idx += 1;
                                    need_from = true;
                                    no_comma = true;
                                }
                                if toks.get(*idx).is_some_and(|n| n.is_kw(src, "FROM")) {
                                    *idx += 1;
                                    need_from = false;
                                    no_comma = true;
                                    allow_from = false;
                                }
                            } else if toks.get(*idx).is_some_and(|n| n.is_kw(src, "DISTINCT") || n.is_kw(src, "ALL")) {
                                *idx += 1;
                            }
                            stack.push(PrattFrame::FnArgs { line: t.line, col: t.col, need_from, no_comma, is_trim, allow_from });
                            stack.push(PrattFrame::Expr { min_bp: 0, stop_kws: FN_STOP_KWS });
                        }
                    } else {
                        phase = Phase::Infix;
                    }
                    continue;
                }
                return Err(sp(t.line, t.col, format!("Unexpected token '{}' in expression", t.slice(src))));
            }
            Phase::Infix => match top {
                PrattFrame::Paren { line, col } => {
                    if toks.get(*idx).is_some_and(|n| n.kind == SqlTokKind::Comma) {
                        *idx += 1;
                        stack.push(PrattFrame::Expr { min_bp: 0, stop_kws: &[] });
                        phase = Phase::Prefix;
                    } else if toks.get(*idx).is_some_and(|n| n.kind == SqlTokKind::RParen) {
                        *idx += 1;
                        stack.pop();
                    } else {
                        return Err(sp(line, col, "Unclosed '(' in expression"));
                    }
                }
                PrattFrame::FnArgs { line, col, need_from, no_comma, is_trim, allow_from } => {
                    if !need_from && !no_comma && toks.get(*idx).is_some_and(|n| n.kind == SqlTokKind::Comma) {
                        *idx += 1;
                        if is_trim && let Some(PrattFrame::FnArgs { no_comma: nc, allow_from: af, .. }) = stack.last_mut() {
                            *nc = true;
                            *af = false;
                        }
                        stack.push(PrattFrame::Expr { min_bp: 0, stop_kws: FN_STOP_KWS });
                        phase = Phase::Prefix;
                    } else if !need_from && toks.get(*idx).is_some_and(|n| n.kind == SqlTokKind::RParen) {
                        *idx += 1;
                        stack.pop();
                    } else if allow_from && toks.get(*idx).is_some_and(|n| n.is_kw(src, "FROM")) {
                        *idx += 1;
                        if let Some(PrattFrame::FnArgs { need_from: nf, no_comma: nc, allow_from: af, .. }) = stack.last_mut() {
                            *nf = false;
                            if is_trim { *nc = true; *af = false; }
                        }
                        stack.push(PrattFrame::Expr { min_bp: 0, stop_kws: FN_STOP_KWS });
                        phase = Phase::Prefix;
                    } else if need_from {
                        return Err(sp(line, col, "Expected FROM in TRIM expression"));
                    } else if no_comma && toks.get(*idx).is_some_and(|n| n.kind == SqlTokKind::Comma) {
                        return Err(sp(toks[*idx].line, toks[*idx].col, "Unexpected ',' in TRIM expression"));
                    } else if !no_comma && !is_trim && toks.get(*idx).is_some_and(|n| FN_STOP_KWS.iter().any(|k| n.is_kw(src, k))) {
                        let mut d = 0usize;
                        while *idx < toks.len() {
                            match toks[*idx].kind {
                                SqlTokKind::LParen => {
                                    if d == 0 && let Some(ni) = rp.and_then(|_| skip_paren_rp(toks, *idx, rp)) {
                                        *idx = ni; continue;
                                    }
                                    d += 1; *idx += 1;
                                }
                                SqlTokKind::RParen if d == 0 => break,
                                SqlTokKind::RParen => { d -= 1; *idx += 1; }
                                _ => { *idx += 1; }
                            }
                        }
                        if toks.get(*idx).is_some_and(|n| n.kind == SqlTokKind::RParen) {
                            *idx += 1;
                            stack.pop();
                        } else {
                            return Err(sp(line, col, "Unclosed '(' in function call"));
                        }
                    } else {
                        return Err(sp(line, col, "Unclosed '(' in function call"));
                    }
                }
                PrattFrame::Expr { min_bp: cur_bp, stop_kws: cur_stops } => {
                    let Some(t) = toks.get(*idx) else { stack.pop(); continue; };
                    if matches!(t.kind, SqlTokKind::RParen | SqlTokKind::RBracket | SqlTokKind::Comma | SqlTokKind::Semi) {
                        stack.pop();
                        continue;
                    }
                    if t.kind == SqlTokKind::Word && cur_stops.iter().any(|k| t.is_kw(src, k)) {
                        stack.pop();
                        continue;
                    }
                    if t.kind == SqlTokKind::ColonColon {
                        *idx += 1;
                        parse_pg_cast_type(toks, src, idx, t)?;
                        continue;
                    }
                    if t.is_kw(src, "OVER") {
                        if toks.get(*idx + 1).is_some_and(|n| n.kind == SqlTokKind::LParen) {
                            *idx = skip_paren_rp(toks, *idx + 1, rp)
                                .ok_or_else(|| sp(t.line, t.col, "Unclosed '(' in OVER"))?;
                            continue;
                        }
                        if toks.get(*idx + 1).is_some_and(|n| {
                            matches!(
                                n.kind,
                                SqlTokKind::Word | SqlTokKind::QuotedIdent | SqlTokKind::BracketIdent | SqlTokKind::BacktickIdent
                            ) && !is_over_stop_kw(n, src) && !n.ident_name(src).is_empty()
                        }) {
                            *idx += 2;
                            continue;
                        }
                        return Err(sp(t.line, t.col, "Expected '(' or window name after OVER"));
                    }
                    if t.is_kw(src, "WITHIN")
                        && toks.get(*idx + 1).is_some_and(|n| n.is_kw(src, "GROUP"))
                        && toks.get(*idx + 2).is_some_and(|n| n.kind == SqlTokKind::LParen)
                    {
                        *idx = skip_paren_rp(toks, *idx + 2, rp)
                            .ok_or_else(|| sp(t.line, t.col, "Unclosed '(' in WITHIN GROUP"))?;
                        continue;
                    }
                    if t.is_kw(src, "COLLATE") && toks.get(*idx + 1).is_some_and(|n| matches!(
                        n.kind, SqlTokKind::Word | SqlTokKind::QuotedIdent | SqlTokKind::BracketIdent | SqlTokKind::BacktickIdent
                    )) { *idx += 2; continue; }
                    if t.is_kw(src, "ESCAPE") && toks.get(*idx + 1).is_some_and(|n| n.kind == SqlTokKind::StringLit) {
                        *idx += 2;
                        continue;
                    }
                    if t.is_kw(src, "NOT") && toks.get(*idx + 1).is_some_and(|n| {
                        n.is_kw(src, "IN") || n.is_kw(src, "LIKE") || n.is_kw(src, "ILIKE") || n.is_kw(src, "BETWEEN")
                    }) {
                        if 4 < cur_bp { stack.pop(); continue; }
                        *idx += 2;
                        stack.push(PrattFrame::Expr { min_bp: 5, stop_kws: cur_stops });
                        phase = Phase::Prefix;
                        continue;
                    }
                    let Some((l_bp, r_bp)) = infix_bp(t, src) else { stack.pop(); continue; };
                    if l_bp < cur_bp { stack.pop(); continue; }
                    *idx += 1;
                    if t.is_kw(src, "IS") {
                        if toks.get(*idx).is_some_and(|n| n.is_kw(src, "NOT")) { *idx += 1; }
                        if toks.get(*idx).is_some_and(|n| n.is_kw(src, "NULL") || n.is_kw(src, "TRUE") || n.is_kw(src, "FALSE")) {
                            *idx += 1;
                            continue;
                        }
                        if toks.get(*idx).is_some_and(|n| n.is_kw(src, "DISTINCT"))
                            && toks.get(*idx + 1).is_some_and(|n| n.is_kw(src, "FROM"))
                        {
                            *idx += 2;
                        }
                    }
                    stack.push(PrattFrame::Expr { min_bp: r_bp, stop_kws: cur_stops });
                    phase = Phase::Prefix;
                }
            }
        }
    }
    Ok(())
}
