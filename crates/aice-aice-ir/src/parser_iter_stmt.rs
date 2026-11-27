use crate::ir::{TranspileError, Trivia};
use crate::ir_code::{AssignOp, Expr, Stmt};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_iter::{
    ParseCont, ParseVal, is_match_init_ahead, parse_for_binding, try_parse_init_cond,
};
use crate::parser_iter_cf::step_cf_cont;
use crate::parser_iter_expr::pop_expr;
use crate::parser_iter_match::{is_match_ahead, start_match, step_match_cont};
use crate::parser_nil::{
    consume_raw_stmt_line, find_multi_assign_eq, is_multi_walrus_ahead, is_var_decl_stmt_ahead,
};
use crate::parser_stmt::{
    attach_stmt_trivia, eat_assign_op, is_decl_kw_stmt_ahead, is_destructure_ahead,
    is_obj_destructure_ahead, is_paren_destructure_ahead, is_ret_stmt_ahead, is_walrus_ahead,
    parse_array_destructure_elems,
};
use crate::parser_types::parse_type_expr;

fn is_stmt_end(k: TokenKind) -> bool {
    matches!(k, TokenKind::Newline | TokenKind::Semicolon | TokenKind::RBrace | TokenKind::Dedent | TokenKind::Eof | TokenKind::Comment)
}

fn slice_rhs(p: &Parser<'_>, start: usize) -> Expr {
    let end = p.tokens.get(p.pos.saturating_sub(1)).map_or(start, |t| t.span.end_byte);
    Expr::Ident(p.src.get(start..end.max(start)).unwrap_or("").trim().to_string())
}

fn pop_stmt(vals: &mut Vec<ParseVal>) -> Stmt {
    match vals.pop().expect("expected Stmt") { ParseVal::Stmt(s) => *s, _ => unreachable!("expected Stmt") }
}

pub(crate) fn pop_block(vals: &mut Vec<ParseVal>) -> Vec<Stmt> {
    match vals.pop().expect("expected Block") { ParseVal::Block(b) => b, _ => unreachable!("expected Block") }
}

pub(crate) fn push_parse_block(p: &mut Parser<'_>, stack: &mut Vec<ParseCont>, vals: &mut Vec<ParseVal>) {
    if p.peek_kind() == TokenKind::LBrace {
        p.advance(); p.skip_newlines();
        stack.push(ParseCont::CurlyBlock(Vec::new()));
    } else if p.peek_kind() != TokenKind::Newline {
        stack.push(ParseCont::InlineSingleBlock);
        stack.push(ParseCont::StmtParse);
    } else {
        p.skip_newlines();
        if !p.eat(TokenKind::Indent) { vals.push(ParseVal::Block(Vec::new())); }
        else { stack.push(ParseCont::IndentedBlock(Vec::new())); }
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
        ParseCont::StmtIfLoop { cond, then_body, elifs, elif_trivias, trailing } => {
            let tb = match then_body { Some(b) => b, None => pop_block(vals) };
            let saved = p.pos;
            let btr = p.collect_leading_trivia();
            if p.eat(TokenKind::Elif) && let Some(ec) = try_parse_init_cond(p) {
                stack.push(ParseCont::StmtElifAfterCond { cond, then_body: tb, elifs, elif_trivias, trailing, etr: btr });
                vals.push(ParseVal::Expr(ec));
            } else {
                p.pos = saved;
                step_cf_cont(p, ParseCont::StmtIfLoop { cond, then_body: Some(tb), elifs, elif_trivias, trailing }, stack, vals)?;
            }
        }
        ParseCont::StmtWhileAfterCond | ParseCont::StmtWhileFinish { .. }
        | ParseCont::StmtLoopFinish { .. } | ParseCont::StmtForAfterIter { .. }
        | ParseCont::StmtForFinish { .. } | ParseCont::StmtIfAfterCond
        | ParseCont::StmtElifAfterCond { .. } | ParseCont::StmtElifFinish { .. }
        | ParseCont::StmtElseFinish { .. } | ParseCont::StmtTryLoop { .. }
        | ParseCont::StmtCatchFinish { .. } | ParseCont::StmtTryElseFinish { .. }
        | ParseCont::StmtFinallyFinish { .. } => step_cf_cont(p, cont, stack, vals)?,
        ParseCont::IndentedBlock(mut stmts) => {
            if p.at_eof() || p.peek_kind() == TokenKind::Dedent {
                p.eat(TokenKind::Dedent); vals.push(ParseVal::Block(stmts)); return Ok(());
            }
            let tr = p.collect_leading_trivia();
            if p.peek_kind() == TokenKind::Dedent || p.at_eof() {
                if !tr.is_empty() { stmts.push(Stmt::Comment(tr)); }
                p.eat(TokenKind::Dedent); vals.push(ParseVal::Block(stmts));
            } else {
                stack.push(ParseCont::BlockPushStmt { is_curly: false, stmts, tr });
                stack.push(ParseCont::StmtParse);
            }
        }
        ParseCont::CurlyBlock(stmts) => {
            while p.eat(TokenKind::Indent) || p.eat(TokenKind::Dedent) { p.skip_newlines(); }
            if p.at_eof() || p.peek_kind() == TokenKind::RBrace {
                p.expect(TokenKind::RBrace, "Expected '}'")?; vals.push(ParseVal::Block(stmts)); return Ok(());
            }
            let tr = p.collect_leading_trivia();
            if p.peek_kind() == TokenKind::RBrace || p.at_eof() {
                p.expect(TokenKind::RBrace, "Expected '}'")?; vals.push(ParseVal::Block(stmts));
            } else {
                stack.push(ParseCont::BlockPushStmt { is_curly: true, stmts, tr });
                stack.push(ParseCont::StmtParse);
            }
        }
        ParseCont::InlineSingleBlock => { let s = pop_stmt(vals); vals.push(ParseVal::Block(vec![s])); }
        ParseCont::BlockPushStmt { is_curly, mut stmts, tr } => {
            let mut st = pop_stmt(vals);
            attach_stmt_trivia(&mut st, tr, p.take_trailing_comment());
            stmts.push(st);
            p.eat_stmt_end();
            stack.push(if is_curly { ParseCont::CurlyBlock(stmts) } else { ParseCont::IndentedBlock(stmts) });
        }
        ParseCont::StmtParse => step_stmt_start(p, stack, vals)?,
        ParseCont::StmtRet => { let e = pop_expr(vals); vals.push(ParseVal::Stmt(Box::new(Stmt::Return { value: Some(e), trivia: Trivia::default() }))); }
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
            let c = pop_expr(vals); vals.push(ParseVal::Stmt(Box::new(Stmt::Throw { expr, cause: Some(c), trivia: Trivia::default() })));
        }
        ParseCont::StmtLet { name, is_mut, ty, rhs_start, is_comma } => {
            let expr = pop_expr(vals);
            if p.eat(TokenKind::Comma) && !is_stmt_end(p.peek_kind()) {
                stack.push(ParseCont::StmtLet { name, is_mut, ty, rhs_start, is_comma: true });
                stack.push(ParseCont::Expr(1));
            } else {
                let init = if is_comma || p.tokens.get(p.pos.saturating_sub(1)).is_some_and(|t| t.kind == TokenKind::Comma) {
                    slice_rhs(p, rhs_start)
                } else { expr };
                vals.push(ParseVal::Stmt(Box::new(Stmt::Let { name, is_mut, ty, init: Some(init), trivia: Trivia::default() })));
            }
        }
        ParseCont::StmtDestructure { names, is_mut } => {
            let init = pop_expr(vals); vals.push(ParseVal::Stmt(Box::new(Stmt::Destructure { names, is_mut, ty: None, init, trivia: Trivia::default() })));
        }
        ParseCont::StmtExprOrAssign => {
            let target = pop_expr(vals);
            if let Some(op) = eat_assign_op(p) {
                let rhs_start = p.peek().span.start_byte;
                stack.push(ParseCont::StmtAssignRhs { target, op, rhs_start, is_comma: false });
                stack.push(ParseCont::Expr(1));
            } else {
                vals.push(ParseVal::Stmt(Box::new(Stmt::Expr { expr: target, trivia: Trivia::default() })));
            }
        }
        ParseCont::StmtAssignRhs { target, op, rhs_start, is_comma } => {
            let expr = pop_expr(vals);
            if op == AssignOp::Assign && p.eat(TokenKind::Comma) {
                if !is_stmt_end(p.peek_kind()) {
                    stack.push(ParseCont::StmtAssignRhs { target, op, rhs_start, is_comma: true });
                    stack.push(ParseCont::Expr(1));
                } else {
                    vals.push(ParseVal::Stmt(Box::new(Stmt::Assign { target, op, value: slice_rhs(p, rhs_start), trivia: Trivia::default() })));
                }
            } else {
                let value = if is_comma { slice_rhs(p, rhs_start) } else { expr };
                vals.push(ParseVal::Stmt(Box::new(Stmt::Assign { target, op, value, trivia: Trivia::default() })));
            }
        }
        _ => unreachable!(),
    }
    Ok(())
}

fn push_delim_destructure(p: &mut Parser<'_>, open: TokenKind, close: TokenKind, fb: &str, stack: &mut Vec<ParseCont>) -> Result<(), TranspileError> {
    let start = p.advance().span.start_byte;
    let (mut depth, mut end) = (1usize, start + 1);
    while !p.at_eof() && depth > 0 {
        let tok = p.advance();
        if tok.kind == open { depth += 1; } else if tok.kind == close { depth -= 1; end = tok.span.end_byte; }
    }
    let name = p.src.get(start..end).unwrap_or(fb).trim().to_string();
    let ty = if p.eat(TokenKind::Colon) { Some(parse_type_expr(p)?) } else { None };
    let is_mut = p.eat(TokenKind::ColonColonEqual) || { p.expect(TokenKind::ColonEqual, "Expected ':='")?; false };
    let rhs_start = p.peek().span.start_byte;
    stack.push(ParseCont::StmtLet { name, is_mut, ty, rhs_start, is_comma: false });
    stack.push(ParseCont::Expr(1));
    Ok(())
}

fn step_stmt_start(p: &mut Parser<'_>, stack: &mut Vec<ParseCont>, vals: &mut Vec<ParseVal>) -> Result<(), TranspileError> {
    if Parser::is_binding_tok(p.peek()) && is_walrus_ahead(p) {
        let name = p.advance().lexeme;
        let ty = if p.eat(TokenKind::Colon) { Some(parse_type_expr(p)?) } else { None };
        let is_mut = if p.eat(TokenKind::ColonColonEqual) { true } else { p.expect(TokenKind::ColonEqual, "Expected ':='")?; false };
        let rhs_start = p.peek().span.start_byte;
        stack.push(ParseCont::StmtLet { name, is_mut, ty, rhs_start, is_comma: false });
        stack.push(ParseCont::Expr(1));
        return Ok(());
    }
    if is_multi_walrus_ahead(p) {
        let mut names = vec![p.advance().lexeme];
        while p.eat(TokenKind::Comma) { names.push(p.expect_ident_or_kw("Expected binding")?.lexeme); }
        let is_mut = p.eat(TokenKind::ColonColonEqual) || { p.expect(TokenKind::ColonEqual, "Expected ':='")?; false };
        let rhs_start = p.peek().span.start_byte;
        stack.push(ParseCont::StmtLet { name: names.join(", "), is_mut, ty: None, rhs_start, is_comma: false });
        stack.push(ParseCont::Expr(1));
        return Ok(());
    }
    match p.peek_kind() {
        TokenKind::Pass if is_stmt_end(p.peek_n(1).kind) => { p.advance(); vals.push(ParseVal::Stmt(Box::new(Stmt::Pass))); }
        TokenKind::Ret if is_ret_stmt_ahead(p) => {
            p.advance();
            if is_stmt_end(p.peek_kind()) {
                vals.push(ParseVal::Stmt(Box::new(Stmt::Return { value: None, trivia: Trivia::default() })));
            } else { stack.push(ParseCont::StmtRet); stack.push(ParseCont::Expr(1)); }
        }
        TokenKind::If if p.peek_n(1).kind != TokenKind::MacroBody => {
            p.advance();
            stack.push(ParseCont::StmtIfAfterCond);
            if let Some(cond) = try_parse_init_cond(p) { vals.push(ParseVal::Expr(cond)); } else { stack.push(ParseCont::Expr(1)); }
        }
        TokenKind::Match if is_match_init_ahead(p) => {
            p.advance();
            let target = try_parse_init_cond(p).expect("match init");
            stack.push(ParseCont::StmtMatchAfterTarget);
            vals.push(ParseVal::Expr(target));
        }
        TokenKind::Match if is_match_ahead(p, true) => start_match(p, stack)?,
        TokenKind::For if p.peek_n(1).kind != TokenKind::MacroBody => {
            p.advance();
            let binding = parse_for_binding(p)?;
            p.expect(TokenKind::In, "Expected 'in'")?;
            stack.push(ParseCont::StmtForAfterIter { binding });
            stack.push(ParseCont::Expr(1));
        }
        TokenKind::While if p.peek_n(1).kind != TokenKind::MacroBody => { p.advance(); stack.push(ParseCont::StmtWhileAfterCond); stack.push(ParseCont::Expr(1)); }
        TokenKind::Loop if p.peek_n(1).kind == TokenKind::Colon => {
            p.advance(); p.expect(TokenKind::Colon, "Expected ':' after loop")?;
            stack.push(ParseCont::StmtLoopFinish { trailing: p.take_trailing_comment() });
            push_parse_block(p, stack, vals);
        }
        TokenKind::Try if p.peek_n(1).kind == TokenKind::Colon => {
            p.advance(); p.expect(TokenKind::Colon, "Expected ':'")?;
            stack.push(ParseCont::StmtTryLoop {
                try_body: None, catches: Vec::new(), else_body: None, else_trivia: Trivia::default(), trailing: p.take_trailing_comment(),
            });
            push_parse_block(p, stack, vals);
        }
        TokenKind::Throw if p.peek_n(1).kind != TokenKind::MacroBody => { p.advance(); stack.push(ParseCont::StmtThrow); stack.push(ParseCont::Expr(1)); }
        TokenKind::Break if p.peek_n(1).kind != TokenKind::MacroBody => {
            p.advance();
            let label = (p.peek_kind() == TokenKind::Ident).then(|| p.advance().lexeme);
            vals.push(ParseVal::Stmt(Box::new(Stmt::Break { label, trivia: Trivia::default() })));
        }
        TokenKind::Continue if p.peek_n(1).kind != TokenKind::MacroBody => {
            p.advance();
            let label = (p.peek_kind() == TokenKind::Ident).then(|| p.advance().lexeme);
            vals.push(ParseVal::Stmt(Box::new(Stmt::Continue { label, trivia: Trivia::default() })));
        }
        TokenKind::Let | TokenKind::Const | TokenKind::Val | TokenKind::Mut if is_decl_kw_stmt_ahead(p) => {
            let mut is_mut = p.eat(TokenKind::Mut);
            if !is_mut {
                p.advance();
                if p.peek_kind() == TokenKind::Mut && Parser::is_binding_tok(p.peek_n(1)) { p.advance(); is_mut = true; }
            }
            let name = p.expect_ident_or_kw("Expected variable name")?.lexeme;
            let ty = if p.eat(TokenKind::Colon) { Some(parse_type_expr(p)?) } else { None };
            if is_stmt_end(p.peek_kind()) {
                vals.push(ParseVal::Stmt(Box::new(Stmt::Let { name, is_mut, ty, init: None, trivia: Trivia::default() })));
            } else {
                if p.eat(TokenKind::ColonColonEqual) { is_mut = true; } else if !p.eat(TokenKind::ColonEqual) { p.expect(TokenKind::Equal, "Expected '=', ':=', or '::='")?; }
                stack.push(ParseCont::StmtLet { name, is_mut, ty, rhs_start: p.peek().span.start_byte, is_comma: false });
                stack.push(ParseCont::Expr(1));
            }
        }
        TokenKind::LBracket if is_destructure_ahead(p) => {
            let names = parse_array_destructure_elems(p)?;
            let ty = if p.eat(TokenKind::Colon) { Some(parse_type_expr(p)?) } else { None };
            let is_mut = p.eat(TokenKind::ColonColonEqual) || { p.expect(TokenKind::ColonEqual, "Expected ':='")?; false };
            if ty.is_some() {
                let rhs_start = p.peek().span.start_byte;
                stack.push(ParseCont::StmtLet { name: format!("[{}]", names.join(", ")), is_mut, ty, rhs_start, is_comma: false });
            } else { stack.push(ParseCont::StmtDestructure { names, is_mut }); }
            stack.push(ParseCont::Expr(1));
        }
        TokenKind::LParen if is_paren_destructure_ahead(p) => push_delim_destructure(p, TokenKind::LParen, TokenKind::RParen, "()", stack)?,
        TokenKind::LBrace if is_obj_destructure_ahead(p) => push_delim_destructure(p, TokenKind::LBrace, TokenKind::RBrace, "{}", stack)?,
        _ if is_var_decl_stmt_ahead(p) => {
            vals.push(ParseVal::Stmt(Box::new(Stmt::Expr { expr: Expr::Ident(consume_raw_stmt_line(p)), trivia: Trivia::default() })));
        }
        _ if let Some(eq_idx) = find_multi_assign_eq(p) => {
            let lhs = p.src.get(p.tokens[p.pos].span.start_byte..p.tokens[eq_idx - 1].span.end_byte).unwrap_or("").trim().to_string();
            p.pos = eq_idx + 1;
            let rhs_start = p.peek().span.start_byte;
            stack.push(ParseCont::StmtAssignRhs { target: Expr::Ident(lhs), op: AssignOp::Assign, rhs_start, is_comma: false });
            stack.push(ParseCont::Expr(1));
        }
        _ => { stack.push(ParseCont::StmtExprOrAssign); stack.push(ParseCont::Expr(1)); }
    }
    Ok(())
}
