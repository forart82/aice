use crate::ir::{TranspileError, Trivia};
use crate::ir_code::{AssignOp, FnBody, Stmt};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_expr::parse_expr;
use crate::parser_iter::{ParseCont, ParseVal, run_parse_loop};

pub(crate) fn parse_optional_body_with_trivia(p: &mut Parser<'_>, tr: &mut Trivia) -> Result<FnBody, TranspileError> {
    if p.eat(TokenKind::Equal) {
        let e = parse_expr(p)?;
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        return Ok(FnBody::Expr(e));
    }
    if p.eat(TokenKind::Colon) {
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        let b = parse_block(p)?;
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        return Ok(FnBody::Block(b));
    }
    if p.peek_kind() == TokenKind::LBrace {
        let b = parse_curly_block(p)?;
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        return Ok(FnBody::Block(b));
    }
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    Ok(FnBody::SignatureOnly)
}

pub(crate) fn parse_block(p: &mut Parser<'_>) -> Result<Vec<Stmt>, TranspileError> {
    if p.peek_kind() == TokenKind::LBrace {
        return parse_curly_block(p);
    }
    if p.peek_kind() != TokenKind::Newline {
        return Ok(vec![parse_stmt(p)?]);
    }
    p.skip_newlines();
    if !p.eat(TokenKind::Indent) {
        return Ok(Vec::new());
    }
    match run_parse_loop(p, ParseCont::IndentedBlock(Vec::new()))? {
        ParseVal::Block(b) => Ok(b),
        _ => unreachable!(),
    }
}

pub(crate) fn parse_curly_block(p: &mut Parser<'_>) -> Result<Vec<Stmt>, TranspileError> {
    p.expect(TokenKind::LBrace, "Expected '{'")?;
    p.skip_newlines();
    match run_parse_loop(p, ParseCont::CurlyBlock(Vec::new()))? {
        ParseVal::Block(b) => Ok(b),
        _ => unreachable!(),
    }
}

pub(crate) fn parse_stmt(p: &mut Parser<'_>) -> Result<Stmt, TranspileError> {
    match run_parse_loop(p, ParseCont::StmtParse)? {
        ParseVal::Stmt(s) => Ok(*s),
        _ => unreachable!(),
    }
}

fn stmt_trailing(st: &Stmt) -> Option<String> {
    match st {
        Stmt::Let { trivia, .. } | Stmt::Destructure { trivia, .. } | Stmt::Assign { trivia, .. }
        | Stmt::Return { trivia, .. } | Stmt::Expr { trivia, .. } | Stmt::If { trivia, .. }
        | Stmt::Match { trivia, .. } | Stmt::For { trivia, .. } | Stmt::While { trivia, .. }
        | Stmt::Loop { trivia, .. } | Stmt::Try { trivia, .. } | Stmt::Throw { trivia, .. }
        | Stmt::Break { trivia, .. } | Stmt::Continue { trivia, .. } => trivia.trailing.clone(),
        Stmt::Pass | Stmt::Comment(_) => None,
    }
}

pub(crate) fn attach_stmt_trivia(st: &mut Stmt, mut tr: Trivia, trailing: Option<String>) {
    tr.trailing = trailing.or_else(|| stmt_trailing(st));
    match st {
        Stmt::Let { trivia, .. } | Stmt::Destructure { trivia, .. } | Stmt::Assign { trivia, .. }
        | Stmt::Return { trivia, .. } | Stmt::Expr { trivia, .. } | Stmt::If { trivia, .. }
        | Stmt::Match { trivia, .. } | Stmt::For { trivia, .. } | Stmt::While { trivia, .. }
        | Stmt::Loop { trivia, .. } | Stmt::Try { trivia, .. } | Stmt::Throw { trivia, .. }
        | Stmt::Break { trivia, .. } | Stmt::Continue { trivia, .. } => *trivia = tr,
        Stmt::Pass | Stmt::Comment(_) => {}
    }
}

pub(crate) fn is_walrus_ahead(p: &Parser<'_>) -> bool {
    is_walrus_or_typed_at(p, p.pos + 1)
}

fn is_walrus_or_typed_at(p: &Parser<'_>, idx: usize) -> bool {
    let Some(t) = p.tokens.get(idx) else { return false; };
    if matches!(t.kind, TokenKind::ColonEqual | TokenKind::ColonColonEqual) { return true; }
    if t.kind == TokenKind::Colon {
        let (mut i, mut depth) = (idx + 1, 0usize);
        while i < p.tokens.len() {
            match p.tokens[i].kind {
                TokenKind::LParen | TokenKind::LBracket | TokenKind::LBrace => depth += 1,
                TokenKind::RParen | TokenKind::RBracket | TokenKind::RBrace => {
                    if depth == 0 { return false; }
                    depth -= 1;
                }
                TokenKind::ColonEqual | TokenKind::ColonColonEqual if depth == 0 => return true,
                TokenKind::Newline | TokenKind::Eof | TokenKind::Equal | TokenKind::Semicolon if depth == 0 => {
                    return false;
                }
                _ => {}
            }
            i += 1;
        }
    }
    false
}

pub(crate) fn is_decl_kw_stmt_ahead(p: &Parser<'_>) -> bool {
    let mut idx = p.pos + 1;
    if p.peek_kind() != TokenKind::Mut
        && p.tokens.get(idx).is_some_and(|t| t.kind == TokenKind::Mut)
        && p.tokens.get(idx + 1).is_some_and(Parser::is_binding_tok)
    {
        idx += 1;
    }
    p.tokens.get(idx).is_some_and(Parser::is_binding_tok)
        && p.tokens.get(idx + 1).is_some_and(|t| {
            matches!(t.kind, TokenKind::Colon | TokenKind::Equal | TokenKind::ColonEqual | TokenKind::ColonColonEqual)
        })
}

pub(crate) fn is_ret_stmt_ahead(p: &Parser<'_>) -> bool {
    let next = p.peek_n(1);
    if crate::parser_expr::assign_op_from_tok(next.kind).is_some()
        || matches!(
            next.kind,
            TokenKind::Dot | TokenKind::QuestionDot | TokenKind::ColonColon
                | TokenKind::ColonEqual | TokenKind::ColonColonEqual | TokenKind::MacroBody
        )
    {
        return false;
    }
    if matches!(next.kind, TokenKind::LParen | TokenKind::LBracket | TokenKind::PlusPlus | TokenKind::MinusMinus)
        && p.peek().span.end_byte == next.span.start_byte
    {
        return false;
    }
    true
}

pub(crate) fn is_destructure_ahead(p: &Parser<'_>) -> bool {
    let (mut idx, mut depth) = (p.pos + 1, 1usize);
    while idx < p.tokens.len() && depth > 0 {
        match p.tokens[idx].kind {
            TokenKind::LBracket => depth += 1,
            TokenKind::RBracket => depth -= 1,
            TokenKind::Newline | TokenKind::Eof => return false,
            _ => {}
        }
        idx += 1;
    }
    is_walrus_or_typed_at(p, idx)
}

pub(crate) fn is_obj_destructure_ahead(p: &Parser<'_>) -> bool {
    let (mut idx, mut depth) = (p.pos + 1, 1usize);
    while idx < p.tokens.len() && depth > 0 {
        match p.tokens[idx].kind {
            TokenKind::LBrace => depth += 1,
            TokenKind::RBrace => depth -= 1,
            TokenKind::Newline | TokenKind::Eof => return false,
            _ => {}
        }
        idx += 1;
    }
    is_walrus_or_typed_at(p, idx)
}

pub(crate) fn parse_array_destructure_elems(p: &mut Parser<'_>) -> Result<Vec<String>, TranspileError> {
    p.expect(TokenKind::LBracket, "Expected '['")?;
    let mut names = Vec::new();
    while p.peek_kind() != TokenKind::RBracket && !p.at_eof() {
        if p.eat(TokenKind::Comma) {
            names.push(String::new());
            continue;
        }
        let start = p.peek().span.start_byte;
        let mut end = p.peek().span.end_byte;
        let mut depth = 0usize;
        while !p.at_eof() {
            match p.peek_kind() {
                TokenKind::Comma | TokenKind::RBracket if depth == 0 => break,
                TokenKind::LBracket | TokenKind::LBrace | TokenKind::LParen => {
                    depth += 1;
                    end = p.advance().span.end_byte;
                }
                TokenKind::RBracket | TokenKind::RBrace | TokenKind::RParen => {
                    depth = depth.saturating_sub(1);
                    end = p.advance().span.end_byte;
                }
                _ => {
                    end = p.advance().span.end_byte;
                }
            }
        }
        let elem = p.src.get(start..end).unwrap_or("").trim().to_string();
        if !elem.is_empty() {
            names.push(elem);
        }
        if !p.eat(TokenKind::Comma) {
            break;
        }
    }
    p.expect(TokenKind::RBracket, "Expected ']'")?;
    Ok(names)
}

pub(crate) fn is_paren_destructure_ahead(p: &Parser<'_>) -> bool {
    let (mut idx, mut depth) = (p.pos + 1, 1usize);
    while idx < p.tokens.len() && depth > 0 {
        match p.tokens[idx].kind {
            TokenKind::LParen => depth += 1,
            TokenKind::RParen => depth -= 1,
            TokenKind::Newline | TokenKind::Eof => return false,
            _ => {}
        }
        idx += 1;
    }
    matches!(p.tokens.get(idx).map(|t| t.kind), Some(TokenKind::ColonEqual | TokenKind::ColonColonEqual))
}

pub(crate) fn eat_assign_op(p: &mut Parser<'_>) -> Option<AssignOp> {
    let op = crate::parser_expr::assign_op_from_tok(p.peek_kind())?;
    p.advance();
    Some(op)
}

pub(crate) fn try_parse_let_cond(p: &mut Parser<'_>, stack: &mut Vec<ParseCont>) -> bool {
    let (mut idx, mut depth, mut eq_idx) = (p.pos + 1, 0usize, None);
    while idx < p.tokens.len() {
        match p.tokens[idx].kind {
            TokenKind::LParen | TokenKind::LBracket | TokenKind::LBrace => depth += 1,
            TokenKind::RParen | TokenKind::RBracket | TokenKind::RBrace => {
                if depth == 0 { break; }
                depth -= 1;
            }
            TokenKind::Equal if depth == 0 && idx > p.pos + 1 => { eq_idx = Some(idx); break; }
            TokenKind::Colon | TokenKind::Newline | TokenKind::Semicolon | TokenKind::Comma | TokenKind::Eof if depth == 0 => break,
            _ => {}
        }
        idx += 1;
    }
    let Some(ei) = eq_idx else { return false; };
    let pat_start = p.tokens[p.pos + 1].span.start_byte;
    let pat_end = p.tokens[ei - 1].span.end_byte;
    let pat = p.src.get(pat_start..pat_end).unwrap_or("").trim();
    p.pos = ei + 1;
    stack.push(ParseCont::ExprAssign {
        target: crate::ir_code::Expr::Ident(format!("let {pat}")),
        op: AssignOp::Assign,
    });
    stack.push(ParseCont::Expr(2));
    true
}

pub(crate) fn is_match_brace_body(p: &Parser<'_>, brace_idx: usize) -> bool {
    let (mut i, mut depth) = (brace_idx + 1, 0usize);
    while i < p.tokens.len() {
        match p.tokens[i].kind {
            TokenKind::LParen | TokenKind::LBracket | TokenKind::LBrace => depth += 1,
            TokenKind::RParen | TokenKind::RBracket | TokenKind::RBrace => { if depth == 0 { return false; } depth -= 1; }
            TokenKind::FatArrow if depth == 0 => return true,
            TokenKind::Eof => return false,
            _ => {}
        }
        i += 1;
    }
    false
}
