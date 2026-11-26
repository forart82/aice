use crate::ir::{TranspileError, Trivia};
use crate::ir_code::{CatchClause, Stmt};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_iter::{ParseCont, ParseVal};
use crate::parser_iter_expr::pop_expr;
use crate::parser_iter_stmt::{pop_block, push_parse_block};
use crate::parser_types::parse_type_expr;

pub(crate) fn step_cf_cont(
    p: &mut Parser<'_>,
    cont: ParseCont,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> Result<(), TranspileError> {
    match cont {
        ParseCont::StmtWhileAfterCond => {
            let cond = pop_expr(vals);
            p.expect(TokenKind::Colon, "Expected ':' after while condition")?;
            let trailing = p.take_trailing_comment();
            stack.push(ParseCont::StmtWhileFinish { cond, trailing });
            push_parse_block(p, stack, vals);
        }
        ParseCont::StmtWhileFinish { cond, trailing } => {
            let body = pop_block(vals);
            vals.push(ParseVal::Stmt(Box::new(Stmt::While { cond, body, trivia: Trivia { trailing, ..Trivia::default() } })));
        }
        ParseCont::StmtLoopFinish { trailing } => {
            let body = pop_block(vals);
            vals.push(ParseVal::Stmt(Box::new(Stmt::Loop { body, trivia: Trivia { trailing, ..Trivia::default() } })));
        }
        ParseCont::StmtForAfterIter { binding } => {
            let iter = pop_expr(vals);
            p.expect(TokenKind::Colon, "Expected ':'")?;
            let trailing = p.take_trailing_comment();
            stack.push(ParseCont::StmtForFinish { binding, iter, trailing });
            push_parse_block(p, stack, vals);
        }
        ParseCont::StmtForFinish { binding, iter, trailing } => {
            let body = pop_block(vals);
            vals.push(ParseVal::Stmt(Box::new(Stmt::For { binding, iter, body, trivia: Trivia { trailing, ..Trivia::default() } })));
        }
        ParseCont::StmtIfAfterCond => {
            let cond = pop_expr(vals);
            p.expect(TokenKind::Colon, "Expected ':'")?;
            let trailing = p.take_trailing_comment();
            stack.push(ParseCont::StmtIfLoop {
                cond, then_body: None, elifs: Vec::new(), elif_trivias: Vec::new(), trailing,
            });
            push_parse_block(p, stack, vals);
        }
        ParseCont::StmtIfLoop { cond, then_body, elifs, elif_trivias, trailing } => {
            let tb = match then_body { Some(b) => b, None => pop_block(vals) };
            let saved = p.pos;
            let btr = p.collect_leading_trivia();
            if p.eat(TokenKind::Elif) {
                stack.push(ParseCont::StmtElifAfterCond { cond, then_body: tb, elifs, elif_trivias, trailing, etr: btr });
                stack.push(ParseCont::Expr(1));
            } else if p.eat(TokenKind::Else) {
                p.expect(TokenKind::Colon, "Expected ':'")?;
                let mut else_trivia = btr;
                if else_trivia.trailing.is_none() { else_trivia.trailing = p.take_trailing_comment(); }
                stack.push(ParseCont::StmtElseFinish { cond, then_body: tb, elifs, elif_trivias, trailing, else_trivia });
                push_parse_block(p, stack, vals);
            } else {
                p.pos = saved;
                vals.push(ParseVal::Stmt(Box::new(Stmt::If {
                    cond, then_body: tb, elifs, elif_trivias, else_body: None,
                    else_trivia: Trivia::default(), trivia: Trivia { trailing, ..Trivia::default() },
                })));
            }
        }
        ParseCont::StmtElifAfterCond { cond, then_body, elifs, elif_trivias, trailing, mut etr } => {
            let econd = pop_expr(vals);
            p.expect(TokenKind::Colon, "Expected ':'")?;
            if etr.trailing.is_none() { etr.trailing = p.take_trailing_comment(); }
            stack.push(ParseCont::StmtElifFinish { cond, then_body, elifs, elif_trivias, trailing, econd, etr });
            push_parse_block(p, stack, vals);
        }
        ParseCont::StmtElifFinish { cond, then_body, mut elifs, mut elif_trivias, trailing, econd, etr } => {
            elifs.push((econd, pop_block(vals)));
            elif_trivias.push(etr);
            stack.push(ParseCont::StmtIfLoop { cond, then_body: Some(then_body), elifs, elif_trivias, trailing });
        }
        ParseCont::StmtElseFinish { cond, then_body, elifs, elif_trivias, trailing, else_trivia } => {
            let eb = pop_block(vals);
            vals.push(ParseVal::Stmt(Box::new(Stmt::If {
                cond, then_body, elifs, elif_trivias, else_body: Some(eb),
                else_trivia, trivia: Trivia { trailing, ..Trivia::default() },
            })));
        }
        ParseCont::StmtTryLoop { try_body, catches, trailing } => {
            let tb = match try_body { Some(b) => b, None => pop_block(vals) };
            let saved = p.pos;
            let btr = p.collect_leading_trivia();
            if p.eat(TokenKind::Catch) {
                let (mut param, mut ty) = (None, None);
                if p.peek_kind() != TokenKind::Colon {
                    let has_paren = p.eat(TokenKind::LParen);
                    if has_paren && p.peek_kind() == TokenKind::RParen {
                        // catch (): Type: -> param stays None
                    } else if p.eat(TokenKind::Ellipsis) {
                        param = Some("...".to_string());
                    } else {
                        let first = p.expect_ident_or_kw("Expected catch param")?.lexeme;
                        if has_paren && p.eat(TokenKind::Comma) {
                            let second = p.expect_ident_or_kw("Expected catch stack trace param")?.lexeme;
                            param = Some(format!("{first}, {second}"));
                        } else {
                            param = Some(first);
                        }
                        if has_paren && p.eat(TokenKind::Colon) {
                            ty = Some(parse_type_expr(p)?);
                        }
                    }
                    if has_paren { p.expect(TokenKind::RParen, "Expected ')'")?; }
                    if ty.is_none()
                        && p.peek_kind() == TokenKind::Colon
                        && !matches!(p.peek_n(1).kind, TokenKind::Newline | TokenKind::LBrace | TokenKind::Comment)
                    {
                        p.advance();
                        ty = Some(parse_type_expr(p)?);
                    }
                }
                p.expect(TokenKind::Colon, "Expected ':'")?;
                let mut ctr = btr;
                if ctr.trailing.is_none() { ctr.trailing = p.take_trailing_comment(); }
                stack.push(ParseCont::StmtCatchFinish { try_body: tb, catches, trailing, param, ty, ctr });
                push_parse_block(p, stack, vals);
            } else if p.eat(TokenKind::Finally) {
                p.expect(TokenKind::Colon, "Expected ':'")?;
                let mut ftr = btr;
                if ftr.trailing.is_none() { ftr.trailing = p.take_trailing_comment(); }
                stack.push(ParseCont::StmtFinallyFinish { try_body: tb, catches, trailing, finally_trivia: ftr });
                push_parse_block(p, stack, vals);
            } else {
                p.pos = saved;
                vals.push(ParseVal::Stmt(Box::new(Stmt::Try {
                    try_body: tb, catches, finally_body: None, finally_trivia: Trivia::default(),
                    trivia: Trivia { trailing, ..Trivia::default() },
                })));
            }
        }
        ParseCont::StmtCatchFinish { try_body, mut catches, trailing, param, ty, ctr } => {
            catches.push(CatchClause { param, ty, body: pop_block(vals), trivia: ctr });
            stack.push(ParseCont::StmtTryLoop { try_body: Some(try_body), catches, trailing });
        }
        ParseCont::StmtFinallyFinish { try_body, catches, trailing, finally_trivia } => {
            let fb = pop_block(vals);
            vals.push(ParseVal::Stmt(Box::new(Stmt::Try {
                try_body, catches, finally_body: Some(fb), finally_trivia,
                trivia: Trivia { trailing, ..Trivia::default() },
            })));
        }
        _ => unreachable!(),
    }
    Ok(())
}
