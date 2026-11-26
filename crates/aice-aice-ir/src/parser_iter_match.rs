use crate::ir::{TranspileError, Trivia};
use crate::ir_code::{Expr, FnBody, MatchCase, Pattern, Stmt};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_iter::{ParseCont, ParseVal};
use crate::parser_iter_expr::pop_expr;
use crate::parser_iter_stmt::{pop_block, push_parse_block};

pub(crate) fn start_match(p: &mut Parser<'_>, stack: &mut Vec<ParseCont>) -> Result<(), TranspileError> {
    p.expect(TokenKind::Match, "Expected 'match'")?;
    stack.push(ParseCont::StmtMatchAfterTarget);
    stack.push(ParseCont::Expr(1));
    Ok(())
}

pub(crate) fn step_match_cont(
    p: &mut Parser<'_>,
    cont: ParseCont,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> Result<(), TranspileError> {
    match cont {
        ParseCont::StmtMatchAfterTarget => step_match_after_target(p, stack, vals)?,
        ParseCont::StmtMatchLoop { target, cases, trailing, is_curly } => {
            step_match_loop(p, target, cases, trailing, is_curly, stack, vals)?;
        }
        ParseCont::StmtMatchArmGuard { target, cases, trailing, is_curly, tr } => {
            let pattern = match vals.pop().expect("pat") { ParseVal::Pat(pt) => pt, _ => unreachable!() };
            let has_guard = p.eat(TokenKind::If);
            stack.push(ParseCont::StmtMatchArmBody { target, cases, trailing, is_curly, tr, pattern, has_guard });
            if has_guard { stack.push(ParseCont::Expr(1)); }
        }
        ParseCont::StmtMatchArmBody { target, cases, trailing, is_curly, tr, pattern, has_guard } => {
            let guard = if has_guard { Some(pop_expr(vals)) } else { None };
            step_match_arm_body(p, target, cases, trailing, is_curly, tr, pattern, guard, stack, vals)?;
        }
        ParseCont::StmtMatchArmFinish { target, mut cases, trailing, is_curly, mut tr, pattern, guard, is_block, eat_comma } => {
            let body = if is_block { FnBody::Block(pop_block(vals)) } else { FnBody::Expr(pop_expr(vals)) };
            if eat_comma { let _ = p.eat(TokenKind::Comma); }
            if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
            cases.push(MatchCase { pattern, guard, body, trivia: tr });
            if is_curly { let _ = p.eat(TokenKind::Comma); }
            p.eat_stmt_end();
            stack.push(ParseCont::StmtMatchLoop { target, cases, trailing, is_curly });
        }
        _ => unreachable!(),
    }
    Ok(())
}

fn step_match_after_target(
    p: &mut Parser<'_>,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> Result<(), TranspileError> {
    let target = pop_expr(vals);
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let trailing = p.take_trailing_comment();
    p.skip_newlines();
    if p.eat(TokenKind::LBrace) {
        p.skip_newlines();
        stack.push(ParseCont::StmtMatchLoop { target, cases: Vec::new(), trailing, is_curly: true });
    } else if p.eat(TokenKind::Indent) {
        stack.push(ParseCont::StmtMatchLoop { target, cases: Vec::new(), trailing, is_curly: false });
    } else {
        vals.push(ParseVal::Stmt(Box::new(Stmt::Match {
            target, cases: Vec::new(), trivia: Trivia { trailing, ..Trivia::default() },
        })));
    }
    Ok(())
}

fn step_match_loop(
    p: &mut Parser<'_>,
    target: Expr,
    cases: Vec<MatchCase>,
    trailing: Option<String>,
    is_curly: bool,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> Result<(), TranspileError> {
    if is_curly {
        while p.eat(TokenKind::Indent) || p.eat(TokenKind::Dedent) { p.skip_newlines(); }
        if p.at_eof() || p.peek_kind() == TokenKind::RBrace {
            p.expect(TokenKind::RBrace, "Expected '}'")?;
            vals.push(ParseVal::Stmt(Box::new(Stmt::Match { target, cases, trivia: Trivia { trailing, ..Trivia::default() } })));
            return Ok(());
        }
    } else if p.at_eof() || p.peek_kind() == TokenKind::Dedent {
        p.eat(TokenKind::Dedent);
        vals.push(ParseVal::Stmt(Box::new(Stmt::Match { target, cases, trivia: Trivia { trailing, ..Trivia::default() } })));
        return Ok(());
    }
    let tr = p.collect_leading_trivia();
    if (is_curly && (p.peek_kind() == TokenKind::RBrace || p.at_eof()))
        || (!is_curly && (p.peek_kind() == TokenKind::Dedent || p.at_eof()))
    {
        if is_curly { p.expect(TokenKind::RBrace, "Expected '}'")?; } else { p.eat(TokenKind::Dedent); }
        vals.push(ParseVal::Stmt(Box::new(Stmt::Match { target, cases, trivia: Trivia { trailing, ..Trivia::default() } })));
        return Ok(());
    }
    if p.peek().lexeme == "case" { p.advance(); }
    stack.push(ParseCont::StmtMatchArmGuard { target, cases, trailing, is_curly, tr });
    stack.push(ParseCont::PatParse);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn step_match_arm_body(
    p: &mut Parser<'_>,
    target: Expr,
    mut cases: Vec<MatchCase>,
    trailing: Option<String>,
    is_curly: bool,
    mut tr: Trivia,
    pattern: Pattern,
    guard: Option<Expr>,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> Result<(), TranspileError> {
    p.expect(TokenKind::FatArrow, "Expected '=>'")?;
    if p.peek_kind() == TokenKind::Pass
        && matches!(p.peek_n(1).kind, TokenKind::Newline | TokenKind::Semicolon | TokenKind::RBrace | TokenKind::Dedent | TokenKind::Comma | TokenKind::Eof | TokenKind::Comment)
    {
        p.advance();
        let _ = p.eat(TokenKind::Comma);
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        cases.push(MatchCase { pattern, guard, body: FnBody::SignatureOnly, trivia: tr });
        if is_curly { let _ = p.eat(TokenKind::Comma); }
        p.eat_stmt_end();
        stack.push(ParseCont::StmtMatchLoop { target, cases, trailing, is_curly });
    } else if p.peek_kind() == TokenKind::LBrace {
        stack.push(ParseCont::StmtMatchArmFinish {
            target, cases, trailing, is_curly, tr, pattern, guard, is_block: true, eat_comma: true,
        });
        p.expect(TokenKind::LBrace, "Expected '{'")?;
        p.skip_newlines();
        stack.push(ParseCont::CurlyBlock(Vec::new()));
    } else if matches!(p.peek_kind(), TokenKind::Newline | TokenKind::Comment) {
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        stack.push(ParseCont::StmtMatchArmFinish {
            target, cases, trailing, is_curly, tr, pattern, guard, is_block: true, eat_comma: false,
        });
        push_parse_block(p, stack, vals);
    } else {
        stack.push(ParseCont::StmtMatchArmFinish {
            target, cases, trailing, is_curly, tr, pattern, guard, is_block: false, eat_comma: true,
        });
        stack.push(ParseCont::Expr(1));
    }
    Ok(())
}
