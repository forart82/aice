use crate::ir::{TranspileError, Trivia};
use crate::ir_code::Stmt;
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_iter::{ParseCont, ParseVal};
use crate::parser_iter_cf::step_cf_cont;
use crate::parser_iter_expr::pop_expr;
use crate::parser_iter_match::{is_match_ahead, start_match, step_match_cont};
use crate::parser_stmt::{
    attach_stmt_trivia, eat_assign_op, is_decl_kw_stmt_ahead, is_destructure_ahead,
    is_obj_destructure_ahead, is_paren_destructure_ahead, is_ret_stmt_ahead, is_walrus_ahead,
    parse_array_destructure_elems,
};
use crate::parser_types::parse_type_expr;

fn pop_stmt(vals: &mut Vec<ParseVal>) -> Stmt {
    match vals.pop().expect("expected Stmt") {
        ParseVal::Stmt(s) => *s,
        _ => unreachable!("expected Stmt"),
    }
}

pub(crate) fn pop_block(vals: &mut Vec<ParseVal>) -> Vec<Stmt> {
    match vals.pop().expect("expected Block") {
        ParseVal::Block(b) => b,
        _ => unreachable!("expected Block"),
    }
}

pub(crate) fn push_parse_block(p: &mut Parser<'_>, stack: &mut Vec<ParseCont>, vals: &mut Vec<ParseVal>) {
    if p.peek_kind() == TokenKind::LBrace {
        p.advance();
        p.skip_newlines();
        stack.push(ParseCont::CurlyBlock(Vec::new()));
    } else if p.peek_kind() != TokenKind::Newline {
        stack.push(ParseCont::InlineSingleBlock);
        stack.push(ParseCont::StmtParse);
    } else {
        p.skip_newlines();
        if !p.eat(TokenKind::Indent) {
            vals.push(ParseVal::Block(Vec::new()));
        } else {
            stack.push(ParseCont::IndentedBlock(Vec::new()));
        }
    }
}

pub(crate) fn step_stmt_cont(
    p: &mut Parser<'_>,
    cont: ParseCont,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> Result<(), TranspileError> {
    match cont {
        ParseCont::StmtMatchAfterTarget | ParseCont::StmtMatchLoop { .. }
        | ParseCont::StmtMatchArmGuard { .. } | ParseCont::StmtMatchArmBody { .. }
        | ParseCont::StmtMatchArmFinish { .. } => step_match_cont(p, cont, stack, vals)?,
        ParseCont::StmtWhileAfterCond | ParseCont::StmtWhileFinish { .. }
        | ParseCont::StmtLoopFinish { .. } | ParseCont::StmtForAfterIter { .. }
        | ParseCont::StmtForFinish { .. } | ParseCont::StmtIfAfterCond
        | ParseCont::StmtIfLoop { .. } | ParseCont::StmtElifAfterCond { .. }
        | ParseCont::StmtElifFinish { .. } | ParseCont::StmtElseFinish { .. }
        | ParseCont::StmtTryLoop { .. } | ParseCont::StmtCatchFinish { .. }
        | ParseCont::StmtTryElseFinish { .. } | ParseCont::StmtFinallyFinish { .. } => step_cf_cont(p, cont, stack, vals)?,
        ParseCont::IndentedBlock(mut stmts) => {
            if p.at_eof() || p.peek_kind() == TokenKind::Dedent {
                p.eat(TokenKind::Dedent);
                vals.push(ParseVal::Block(stmts));
                return Ok(());
            }
            let tr = p.collect_leading_trivia();
            if p.peek_kind() == TokenKind::Dedent || p.at_eof() {
                if !tr.is_empty() { stmts.push(Stmt::Comment(tr)); }
                p.eat(TokenKind::Dedent);
                vals.push(ParseVal::Block(stmts));
            } else {
                stack.push(ParseCont::BlockPushStmt { is_curly: false, stmts, tr });
                stack.push(ParseCont::StmtParse);
            }
        }
        ParseCont::CurlyBlock(stmts) => {
            while p.eat(TokenKind::Indent) || p.eat(TokenKind::Dedent) { p.skip_newlines(); }
            if p.at_eof() || p.peek_kind() == TokenKind::RBrace {
                p.expect(TokenKind::RBrace, "Expected '}'")?;
                vals.push(ParseVal::Block(stmts));
                return Ok(());
            }
            let tr = p.collect_leading_trivia();
            if p.peek_kind() == TokenKind::RBrace || p.at_eof() {
                p.expect(TokenKind::RBrace, "Expected '}'")?;
                vals.push(ParseVal::Block(stmts));
            } else {
                stack.push(ParseCont::BlockPushStmt { is_curly: true, stmts, tr });
                stack.push(ParseCont::StmtParse);
            }
        }
        ParseCont::InlineSingleBlock => {
            let st = pop_stmt(vals);
            vals.push(ParseVal::Block(vec![st]));
        }
        ParseCont::BlockPushStmt { is_curly, mut stmts, tr } => {
            let mut st = pop_stmt(vals);
            attach_stmt_trivia(&mut st, tr, p.take_trailing_comment());
            stmts.push(st);
            p.eat_stmt_end();
            stack.push(if is_curly { ParseCont::CurlyBlock(stmts) } else { ParseCont::IndentedBlock(stmts) });
        }
        ParseCont::StmtParse => step_stmt_start(p, stack, vals)?,
        ParseCont::StmtRet => {
            let e = pop_expr(vals);
            vals.push(ParseVal::Stmt(Box::new(Stmt::Return { value: Some(e), trivia: Trivia::default() })));
        }
        ParseCont::StmtThrow => {
            let expr = pop_expr(vals);
            if p.eat(TokenKind::From) {
                stack.push(ParseCont::StmtThrowCause { expr });
                stack.push(ParseCont::Expr(1));
            } else {
                vals.push(ParseVal::Stmt(Box::new(Stmt::Throw { expr, cause: None, trivia: Trivia::default() })));
            }
        }
        ParseCont::StmtThrowCause { expr } => {
            let cause = pop_expr(vals);
            vals.push(ParseVal::Stmt(Box::new(Stmt::Throw { expr, cause: Some(cause), trivia: Trivia::default() })));
        }
        ParseCont::StmtLet { name, is_mut, ty } => {
            let init = pop_expr(vals);
            vals.push(ParseVal::Stmt(Box::new(Stmt::Let { name, is_mut, ty, init, trivia: Trivia::default() })));
        }
        ParseCont::StmtDestructure { names, is_mut } => {
            let init = pop_expr(vals);
            vals.push(ParseVal::Stmt(Box::new(Stmt::Destructure { names, is_mut, ty: None, init, trivia: Trivia::default() })));
        }
        ParseCont::StmtExprOrAssign => {
            let target = pop_expr(vals);
            if let Some(op) = eat_assign_op(p) {
                stack.push(ParseCont::StmtAssignRhs { target, op });
                stack.push(ParseCont::Expr(1));
            } else {
                vals.push(ParseVal::Stmt(Box::new(Stmt::Expr { expr: target, trivia: Trivia::default() })));
            }
        }
        ParseCont::StmtAssignRhs { target, op } => {
            let value = pop_expr(vals);
            vals.push(ParseVal::Stmt(Box::new(Stmt::Assign { target, op, value, trivia: Trivia::default() })));
        }
        _ => unreachable!(),
    }
    Ok(())
}

fn step_stmt_start(p: &mut Parser<'_>, stack: &mut Vec<ParseCont>, vals: &mut Vec<ParseVal>) -> Result<(), TranspileError> {
    if Parser::is_binding_tok(p.peek()) && is_walrus_ahead(p) {
        let name = p.advance().lexeme;
        let ty = if p.eat(TokenKind::Colon) { Some(parse_type_expr(p)?) } else { None };
        let is_mut = if p.eat(TokenKind::ColonColonEqual) { true } else { p.expect(TokenKind::ColonEqual, "Expected ':='")?; false };
        stack.push(ParseCont::StmtLet { name, is_mut, ty });
        stack.push(ParseCont::Expr(1));
        return Ok(());
    }
    match p.peek_kind() {
        TokenKind::Pass
            if matches!(
                p.peek_n(1).kind,
                TokenKind::Newline | TokenKind::Semicolon | TokenKind::RBrace | TokenKind::Dedent | TokenKind::Eof | TokenKind::Comment
            ) =>
        {
            p.advance();
            vals.push(ParseVal::Stmt(Box::new(Stmt::Pass)));
        }
        TokenKind::Ret if is_ret_stmt_ahead(p) => {
            p.advance();
            if matches!(p.peek_kind(), TokenKind::Newline | TokenKind::Semicolon | TokenKind::RBrace | TokenKind::Dedent | TokenKind::Eof | TokenKind::Comment) {
                vals.push(ParseVal::Stmt(Box::new(Stmt::Return { value: None, trivia: Trivia::default() })));
            } else {
                stack.push(ParseCont::StmtRet);
                stack.push(ParseCont::Expr(1));
            }
        }
        TokenKind::If => { p.advance(); stack.push(ParseCont::StmtIfAfterCond); stack.push(ParseCont::Expr(1)); }
        TokenKind::Match if is_match_ahead(p, true) => start_match(p, stack)?,
        TokenKind::For => {
            p.advance();
            let binding = if p.eat(TokenKind::LParen) {
                let mut parts = Vec::new();
                while p.peek_kind() != TokenKind::RParen && !p.at_eof() {
                    parts.push(p.expect_ident_or_kw("Expected loop var")?.lexeme);
                    if !p.eat(TokenKind::Comma) { break; }
                }
                p.expect(TokenKind::RParen, "Expected ')'")?;
                format!("({})", parts.join(", "))
            } else { p.expect_ident_or_kw("Expected loop binding")?.lexeme };
            p.expect(TokenKind::In, "Expected 'in'")?;
            stack.push(ParseCont::StmtForAfterIter { binding });
            stack.push(ParseCont::Expr(1));
        }
        TokenKind::While => { p.advance(); stack.push(ParseCont::StmtWhileAfterCond); stack.push(ParseCont::Expr(1)); }
        TokenKind::Loop if p.peek_n(1).kind == TokenKind::Colon => {
            p.advance();
            p.expect(TokenKind::Colon, "Expected ':' after loop")?;
            let trailing = p.take_trailing_comment();
            stack.push(ParseCont::StmtLoopFinish { trailing });
            push_parse_block(p, stack, vals);
        }
        TokenKind::Try if p.peek_n(1).kind == TokenKind::Colon => {
            p.advance();
            p.expect(TokenKind::Colon, "Expected ':'")?;
            let trailing = p.take_trailing_comment();
            stack.push(ParseCont::StmtTryLoop {
                try_body: None, catches: Vec::new(), else_body: None, else_trivia: Trivia::default(), trailing,
            });
            push_parse_block(p, stack, vals);
        }
        TokenKind::Throw => { p.advance(); stack.push(ParseCont::StmtThrow); stack.push(ParseCont::Expr(1)); }
        TokenKind::Break => {
            p.advance();
            let label = if p.peek_kind() == TokenKind::Ident { Some(p.advance().lexeme) } else { None };
            vals.push(ParseVal::Stmt(Box::new(Stmt::Break { label, trivia: Trivia::default() })));
        }
        TokenKind::Continue => {
            p.advance();
            let label = if p.peek_kind() == TokenKind::Ident { Some(p.advance().lexeme) } else { None };
            vals.push(ParseVal::Stmt(Box::new(Stmt::Continue { label, trivia: Trivia::default() })));
        }
        TokenKind::Let | TokenKind::Const | TokenKind::Val | TokenKind::Mut if is_decl_kw_stmt_ahead(p) => {
            let mut is_mut = p.eat(TokenKind::Mut);
            if !is_mut {
                p.advance();
                if p.peek_kind() == TokenKind::Mut && Parser::is_binding_tok(p.peek_n(1)) {
                    p.advance();
                    is_mut = true;
                }
            }
            let name = p.expect_ident_or_kw("Expected variable name")?.lexeme;
            let ty = if p.eat(TokenKind::Colon) { Some(parse_type_expr(p)?) } else { None };
            if p.eat(TokenKind::ColonColonEqual) { is_mut = true; }
            else if !p.eat(TokenKind::ColonEqual) { p.expect(TokenKind::Equal, "Expected '=', ':=', or '::='")?; }
            stack.push(ParseCont::StmtLet { name, is_mut, ty });
            stack.push(ParseCont::Expr(1));
        }
        TokenKind::LBracket if is_destructure_ahead(p) => {
            let names = parse_array_destructure_elems(p)?;
            let ty = if p.eat(TokenKind::Colon) { Some(parse_type_expr(p)?) } else { None };
            let is_mut = p.eat(TokenKind::ColonColonEqual) || { p.expect(TokenKind::ColonEqual, "Expected ':='")?; false };
            if ty.is_some() {
                stack.push(ParseCont::StmtLet { name: format!("[{}]", names.join(", ")), is_mut, ty });
            } else {
                stack.push(ParseCont::StmtDestructure { names, is_mut });
            }
            stack.push(ParseCont::Expr(1));
        }
        TokenKind::LParen if is_paren_destructure_ahead(p) => {
            p.expect(TokenKind::LParen, "Expected '('")?;
            let mut names = Vec::new();
            while p.peek_kind() != TokenKind::RParen && !p.at_eof() {
                names.push(p.expect_ident_or_kw("Expected binding name")?.lexeme);
                if !p.eat(TokenKind::Comma) { break; }
            }
            p.expect(TokenKind::RParen, "Expected ')'")?;
            let is_mut = p.eat(TokenKind::ColonColonEqual) || { p.expect(TokenKind::ColonEqual, "Expected ':='")?; false };
            stack.push(ParseCont::StmtDestructure { names, is_mut });
            stack.push(ParseCont::Expr(1));
        }
        TokenKind::LBrace if is_obj_destructure_ahead(p) => {
            let start = p.advance().span.start_byte;
            let mut depth = 1usize;
            let mut end = start + 1;
            while !p.at_eof() && depth > 0 {
                let tok = p.advance();
                if tok.kind == TokenKind::LBrace { depth += 1; }
                else if tok.kind == TokenKind::RBrace { depth -= 1; end = tok.span.end_byte; }
            }
            let name = p.src.get(start..end).unwrap_or("{}").trim().to_string();
            let ty = if p.eat(TokenKind::Colon) { Some(parse_type_expr(p)?) } else { None };
            let is_mut = p.eat(TokenKind::ColonColonEqual) || { p.expect(TokenKind::ColonEqual, "Expected ':='")?; false };
            stack.push(ParseCont::StmtLet { name, is_mut, ty });
            stack.push(ParseCont::Expr(1));
        }
        _ => {
            stack.push(ParseCont::StmtExprOrAssign);
            stack.push(ParseCont::Expr(1));
        }
    }
    Ok(())
}
