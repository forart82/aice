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
    let k1 = p.peek_n(1).kind;
    if matches!(k1, TokenKind::ColonEqual | TokenKind::ColonColonEqual) { return true; }
    if k1 == TokenKind::Colon {
        let mut idx = p.pos + 2;
        while idx < p.tokens.len() {
            let k = p.tokens[idx].kind;
            if matches!(k, TokenKind::ColonEqual | TokenKind::ColonColonEqual) { return true; }
            if matches!(k, TokenKind::Newline | TokenKind::Eof | TokenKind::Equal | TokenKind::Semicolon) { return false; }
            idx += 1;
        }
    }
    false
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
    matches!(p.tokens.get(idx).map(|t| t.kind), Some(TokenKind::ColonEqual | TokenKind::ColonColonEqual))
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
    matches!(p.tokens.get(idx).map(|t| t.kind), Some(TokenKind::ColonEqual | TokenKind::ColonColonEqual))
}

pub(crate) fn eat_assign_op(p: &mut Parser<'_>) -> Option<AssignOp> {
    let op = crate::parser_expr::assign_op_from_tok(p.peek_kind())?;
    p.advance();
    Some(op)
}
