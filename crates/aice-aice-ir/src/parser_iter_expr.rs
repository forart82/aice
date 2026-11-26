use crate::ir::TranspileError;
use crate::ir_code::{Expr, LiteralVal, MemberKind, Stmt, UnaryOp};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_expr::{assign_op_from_tok, binary_op_from_tok, infix_prec, looks_like_ternary};
use crate::parser_iter::{ParseCont, ParseVal};
use crate::parser_iter_lit::{looks_like_closure_after_fn, start_record_entry, step_closure_params, step_lit_cont};
use crate::parser_iter_match::start_match;

pub(crate) fn pop_expr(vals: &mut Vec<ParseVal>) -> Expr {
    match vals.pop().expect("expected Expr") {
        ParseVal::Expr(e) => e,
        _ => unreachable!("expected ParseVal::Expr"),
    }
}

pub(crate) fn step_expr_cont(
    p: &mut Parser<'_>,
    cont: ParseCont,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> Result<(), TranspileError> {
    match cont {
        ParseCont::ExprTemplate { .. } | ParseCont::ExprArray(_)
        | ParseCont::ExprRecord { .. } | ParseCont::ExprClosureParamDefault { .. }
        | ParseCont::ExprClosureFinish { .. } => step_lit_cont(p, cont, stack, vals)?,
        ParseCont::Expr(min_prec) => {
            stack.push(ParseCont::ExprInfix(min_prec));
            step_prefix(p, stack, vals)?;
        }
        ParseCont::ExprInfix(min_prec) => {
            if p.peek_kind() == TokenKind::Question && min_prec <= 17 && !looks_like_ternary(p) {
                p.advance();
                let lhs = pop_expr(vals);
                vals.push(ParseVal::Expr(Expr::PostfixTry(Box::new(lhs))));
                stack.push(ParseCont::ExprInfix(min_prec));
                return Ok(());
            }
            let Some((prec, right_assoc)) = infix_prec(p.peek_kind()) else { return Ok(()); };
            if prec < min_prec { return Ok(()); }
            let lhs = pop_expr(vals);
            stack.push(ParseCont::ExprInfix(min_prec));
            step_infix(p, lhs, prec, right_assoc, stack, vals)?;
        }
        ParseCont::ExprUnary { op } => {
            let operand = pop_expr(vals);
            vals.push(ParseVal::Expr(Expr::Unary { op, is_postfix: false, operand: Box::new(operand) }));
        }
        ParseCont::ExprDblRef { inner_op } => {
            let operand = pop_expr(vals);
            let inner = Expr::Unary { op: inner_op, is_postfix: false, operand: Box::new(operand) };
            vals.push(ParseVal::Expr(Expr::Unary { op: UnaryOp::Ref, is_postfix: false, operand: Box::new(inner) }));
        }
        ParseCont::ExprAwait => {
            let e = pop_expr(vals);
            vals.push(ParseVal::Expr(Expr::Await(Box::new(e))));
        }
        ParseCont::ExprParenClose => {
            p.expect(TokenKind::RParen, "Expected ')'")?;
        }
        ParseCont::ExprCallArg { callee, mut args, is_optional } => {
            args.push(pop_expr(vals));
            if p.eat(TokenKind::Comma) && p.peek_kind() != TokenKind::RParen && !p.at_eof() {
                stack.push(ParseCont::ExprCallArg { callee, args, is_optional });
                stack.push(ParseCont::Expr(1));
            } else {
                p.expect(TokenKind::RParen, "Expected ')'")?;
                vals.push(ParseVal::Expr(Expr::Call {
                    callee: Box::new(callee), args, is_optional, is_tagged: false,
                }));
            }
        }
        ParseCont::ExprIndex { object, is_optional } => {
            let idx = pop_expr(vals);
            p.expect(TokenKind::RBracket, "Expected ']'")?;
            vals.push(ParseVal::Expr(Expr::Index { object: Box::new(object), index: Box::new(idx), is_optional }));
        }
        ParseCont::ExprTernaryThen { cond, next_prec } => {
            let then_expr = pop_expr(vals);
            p.expect(TokenKind::Colon, "Expected ':' in ternary")?;
            stack.push(ParseCont::ExprTernaryElse { cond, then_expr });
            stack.push(ParseCont::Expr(next_prec));
        }
        ParseCont::ExprTernaryElse { cond, then_expr } => {
            let else_expr = pop_expr(vals);
            vals.push(ParseVal::Expr(Expr::Conditional {
                cond: Box::new(cond), then_expr: Box::new(then_expr), else_expr: Box::new(else_expr),
            }));
        }
        ParseCont::ExprAssign { target, op } => {
            let value = pop_expr(vals);
            vals.push(ParseVal::Expr(Expr::Assign { target: Box::new(target), op, value: Box::new(value) }));
        }
        ParseCont::ExprBinary { left, op } => {
            let right = pop_expr(vals);
            vals.push(ParseVal::Expr(Expr::Binary { op, left: Box::new(left), right: Box::new(right) }));
        }
        ParseCont::ExprMatchWrap => {
            let sp = p.peek().span;
            let mut m = match vals.pop().expect("match stmt") {
                ParseVal::Stmt(s) => s,
                _ => unreachable!("expected Stmt"),
            };
            if let Stmt::Match { target, cases, .. } = &mut *m {
                let tgt = std::mem::replace(target, Expr::Ident(String::new()));
                vals.push(ParseVal::Expr(Expr::Match { target: Box::new(tgt), cases: std::mem::take(cases) }));
            } else {
                return Err(TranspileError::at("Invalid match expression", sp));
            }
        }
        _ => unreachable!(),
    }
    Ok(())
}

fn step_prefix(p: &mut Parser<'_>, stack: &mut Vec<ParseCont>, vals: &mut Vec<ParseVal>) -> Result<(), TranspileError> {
    let tok = p.peek().clone();
    match tok.kind {
        TokenKind::Not | TokenKind::Bang => { p.advance(); stack.push(ParseCont::ExprUnary { op: UnaryOp::Not }); stack.push(ParseCont::Expr(16)); }
        TokenKind::Minus => { p.advance(); stack.push(ParseCont::ExprUnary { op: UnaryOp::Neg }); stack.push(ParseCont::Expr(16)); }
        TokenKind::Plus => { p.advance(); stack.push(ParseCont::ExprUnary { op: UnaryOp::Pos }); stack.push(ParseCont::Expr(16)); }
        TokenKind::PlusPlus => { p.advance(); stack.push(ParseCont::ExprUnary { op: UnaryOp::Inc }); stack.push(ParseCont::Expr(16)); }
        TokenKind::MinusMinus => { p.advance(); stack.push(ParseCont::ExprUnary { op: UnaryOp::Dec }); stack.push(ParseCont::Expr(16)); }
        TokenKind::Tilde => { p.advance(); stack.push(ParseCont::ExprUnary { op: UnaryOp::BitNot }); stack.push(ParseCont::Expr(16)); }
        TokenKind::Ellipsis => { p.advance(); stack.push(ParseCont::ExprUnary { op: UnaryOp::Spread }); stack.push(ParseCont::Expr(16)); }
        TokenKind::Star => { p.advance(); stack.push(ParseCont::ExprUnary { op: UnaryOp::Deref }); stack.push(ParseCont::Expr(16)); }
        TokenKind::Amp => {
            p.advance();
            let op = if p.eat(TokenKind::Mut) { UnaryOp::RefMut } else { UnaryOp::Ref };
            stack.push(ParseCont::ExprUnary { op });
            stack.push(ParseCont::Expr(16));
        }
        TokenKind::AmpAmp => {
            p.advance();
            let inner_op = if p.eat(TokenKind::Mut) { UnaryOp::RefMut } else { UnaryOp::Ref };
            stack.push(ParseCont::ExprDblRef { inner_op });
            stack.push(ParseCont::Expr(16));
        }
        TokenKind::Await => { p.advance(); stack.push(ParseCont::ExprAwait); stack.push(ParseCont::Expr(16)); }
        TokenKind::Number => {
            p.advance();
            let lit = if tok.lexeme.contains('.') || tok.lexeme.contains('e') || tok.lexeme.contains('E') {
                LiteralVal::Float(tok.lexeme)
            } else { LiteralVal::Int(tok.lexeme) };
            vals.push(ParseVal::Expr(Expr::Literal(lit)));
        }
        TokenKind::String => { p.advance(); vals.push(ParseVal::Expr(Expr::Literal(LiteralVal::Str { value: tok.lexeme, multiline: false }))); }
        TokenKind::TripleString => { p.advance(); vals.push(ParseVal::Expr(Expr::Literal(LiteralVal::Str { value: tok.lexeme, multiline: true }))); }
        TokenKind::Boolean => { p.advance(); vals.push(ParseVal::Expr(Expr::Literal(LiteralVal::Bool(tok.lexeme == "true")))); }
        TokenKind::Nil => { p.advance(); vals.push(ParseVal::Expr(Expr::Literal(LiteralVal::Nil))); }
        TokenKind::HexColor => { p.advance(); vals.push(ParseVal::Expr(Expr::Literal(LiteralVal::HexColor(tok.lexeme)))); }
        TokenKind::Regex => { p.advance(); vals.push(ParseVal::Expr(Expr::Literal(LiteralVal::Regex(tok.lexeme)))); }
        TokenKind::TemplateNoSubst => { p.advance(); vals.push(ParseVal::Expr(Expr::Template { quasis: vec![tok.lexeme], exprs: Vec::new() })); }
        TokenKind::TemplateHead => {
            let head = p.advance();
            stack.push(ParseCont::ExprTemplate { quasis: vec![head.lexeme], exprs: Vec::new() });
            stack.push(ParseCont::Expr(1));
        }
        TokenKind::LParen => { p.advance(); stack.push(ParseCont::ExprParenClose); stack.push(ParseCont::Expr(1)); }
        TokenKind::LBracket => {
            p.advance();
            if p.peek_kind() == TokenKind::RBracket || p.at_eof() {
                p.expect(TokenKind::RBracket, "Expected ']'")?;
                vals.push(ParseVal::Expr(Expr::Array(Vec::new())));
            } else {
                stack.push(ParseCont::ExprArray(Vec::new()));
                stack.push(ParseCont::Expr(1));
            }
        }
        TokenKind::LBrace => {
            p.advance();
            if p.peek_kind() == TokenKind::RBrace || p.at_eof() {
                p.expect(TokenKind::RBrace, "Expected '}'")?;
                vals.push(ParseVal::Expr(Expr::Record(Vec::new())));
            } else {
                start_record_entry(p, Vec::new(), stack)?;
            }
        }
        TokenKind::Fn if looks_like_closure_after_fn(p) => {
            p.expect(TokenKind::Fn, "Expected 'fn'")?;
            p.expect(TokenKind::LParen, "Expected '('")?;
            step_closure_params(p, false, Vec::new(), stack, vals)?;
        }
        TokenKind::Async if p.peek_n(1).kind == TokenKind::Fn => {
            p.advance();
            p.expect(TokenKind::Fn, "Expected 'fn'")?;
            p.expect(TokenKind::LParen, "Expected '('")?;
            step_closure_params(p, true, Vec::new(), stack, vals)?;
        }
        TokenKind::Match => { stack.push(ParseCont::ExprMatchWrap); start_match(p, stack)?; }
        TokenKind::Dollar => {
            p.advance();
            let name = p.expect_ident_or_kw("Expected identifier after '$'")?.lexeme;
            vals.push(ParseVal::Expr(Expr::Ident(format!("${name}"))));
        }
        TokenKind::Ident => { p.advance(); vals.push(ParseVal::Expr(Expr::Ident(tok.lexeme))); }
        _ if tok.is_keyword() => { p.advance(); vals.push(ParseVal::Expr(Expr::Ident(tok.lexeme))); }
        _ => return Err(TranspileError::at(format!("Unexpected token {:?} '{}' in expression", tok.kind, tok.lexeme), tok.span)),
    }
    Ok(())
}

fn step_infix(
    p: &mut Parser<'_>,
    lhs: Expr,
    prec: u8,
    right_assoc: bool,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> Result<(), TranspileError> {
    let kind = p.peek_kind();
    let next_prec = if right_assoc { prec } else { prec + 1 };
    match kind {
        TokenKind::LParen => {
            p.advance();
            if p.peek_kind() == TokenKind::RParen || p.at_eof() {
                p.expect(TokenKind::RParen, "Expected ')'")?;
                vals.push(ParseVal::Expr(Expr::Call {
                    callee: Box::new(lhs), args: Vec::new(), is_optional: false, is_tagged: false,
                }));
            } else {
                stack.push(ParseCont::ExprCallArg { callee: lhs, args: Vec::new(), is_optional: false });
                stack.push(ParseCont::Expr(1));
            }
        }
        TokenKind::LBracket => {
            p.advance();
            stack.push(ParseCont::ExprIndex { object: lhs, is_optional: false });
            stack.push(ParseCont::Expr(1));
        }
        TokenKind::Dot | TokenKind::QuestionDot | TokenKind::ColonColon => {
            p.advance();
            if kind == TokenKind::QuestionDot && p.eat(TokenKind::LParen) {
                if p.peek_kind() == TokenKind::RParen || p.at_eof() {
                    p.expect(TokenKind::RParen, "Expected ')'")?;
                    vals.push(ParseVal::Expr(Expr::Call {
                        callee: Box::new(lhs), args: Vec::new(), is_optional: true, is_tagged: false,
                    }));
                } else {
                    stack.push(ParseCont::ExprCallArg { callee: lhs, args: Vec::new(), is_optional: true });
                    stack.push(ParseCont::Expr(1));
                }
                return Ok(());
            }
            if kind == TokenKind::QuestionDot && p.eat(TokenKind::LBracket) {
                stack.push(ParseCont::ExprIndex { object: lhs, is_optional: true });
                stack.push(ParseCont::Expr(1));
                return Ok(());
            }
            let mk = match kind {
                TokenKind::QuestionDot => MemberKind::SafeNav,
                TokenKind::ColonColon => MemberKind::Scope,
                _ => MemberKind::Dot,
            };
            let prop = if kind == TokenKind::Dot && p.eat(TokenKind::Hash) {
                format!("#{}", p.expect_ident_or_kw("Expected private member name")?.lexeme)
            } else if kind == TokenKind::Dot && p.peek_kind() == TokenKind::HexColor {
                p.advance().lexeme
            } else {
                p.expect_ident_or_kw("Expected member name")?.lexeme
            };
            vals.push(ParseVal::Expr(Expr::Member { object: Box::new(lhs), property: prop, kind: mk }));
        }
        TokenKind::PlusPlus | TokenKind::MinusMinus => {
            p.advance();
            let op = if kind == TokenKind::PlusPlus { UnaryOp::Inc } else { UnaryOp::Dec };
            vals.push(ParseVal::Expr(Expr::Unary { op, is_postfix: true, operand: Box::new(lhs) }));
        }
        TokenKind::Question => {
            p.advance();
            stack.push(ParseCont::ExprTernaryThen { cond: lhs, next_prec });
            stack.push(ParseCont::Expr(1));
        }
        _ if assign_op_from_tok(kind).is_some() => {
            p.advance();
            let op = assign_op_from_tok(kind).unwrap();
            stack.push(ParseCont::ExprAssign { target: lhs, op });
            stack.push(ParseCont::Expr(next_prec));
        }
        _ => {
            p.advance();
            let op = binary_op_from_tok(kind);
            stack.push(ParseCont::ExprBinary { left: lhs, op });
            stack.push(ParseCont::Expr(next_prec));
        }
    }
    Ok(())
}
