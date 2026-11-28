use crate::ir::TranspileError;
use crate::ir_code::{BinaryOp, Expr, MemberKind, Stmt, UnaryOp};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_expr::{
    assign_op_from_tok, binary_op_from_tok, infix_prec, is_elvis_ahead, is_new_prefix_start,
    lit_expr_from_tok, looks_like_gen_closure, looks_like_ternary, step_member_infix,
    step_paren_close, step_paren_open, try_contextual_infix, try_contextual_unary,
};
use crate::parser_iter::{ParseCont, ParseVal};
use crate::parser_iter_lit::{looks_like_closure_after_fn, start_record_entry, step_closure_params, step_lit_cont};
use crate::parser_iter_match::{is_match_ahead, start_match};
use crate::parser_new::{parse_new_prefix, try_attach_new_init};

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
            if p.peek_kind() == TokenKind::Bang && min_prec <= 17
                && p.peek_n(1).kind != TokenKind::In
                && !(p.peek_n(1).kind == TokenKind::Ident && p.peek_n(1).lexeme == "is")
            {
                let end = p.advance().span.end_byte;
                if p.peek_kind() == TokenKind::Bang && p.peek().span.start_byte == end { p.advance(); }
                let lhs = pop_expr(vals);
                vals.push(ParseVal::Expr(Expr::Unary { op: UnaryOp::NonNull, is_postfix: true, operand: Box::new(lhs) }));
                stack.push(ParseCont::ExprInfix(min_prec));
                return Ok(());
            }
            if let Some((op, next_prec)) = try_contextual_infix(p, min_prec) {
                let lhs = pop_expr(vals);
                stack.push(ParseCont::ExprInfix(min_prec));
                stack.push(ParseCont::ExprBinary { left: lhs, op });
                stack.push(ParseCont::Expr(next_prec));
                return Ok(());
            }
            if min_prec <= 17 && try_attach_new_init(p, min_prec, stack, vals) { return Ok(()); }
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
            let inner = Expr::Unary { op: inner_op, is_postfix: false, operand: Box::new(pop_expr(vals)) };
            vals.push(ParseVal::Expr(Expr::Unary { op: UnaryOp::Ref, is_postfix: false, operand: Box::new(inner) }));
        }
        ParseCont::ExprAwait => { let e = pop_expr(vals); vals.push(ParseVal::Expr(Expr::Await(Box::new(e)))); }
        ParseCont::ExprParenClose => step_paren_close(p, stack, vals)?,
        ParseCont::ExprCallArg { callee, mut args, is_optional, is_new } => {
            let a = pop_expr(vals);
            if args.is_empty() && crate::parser_iter_comp::is_comp_for_ahead(p) {
                return crate::parser_iter_comp::start_comp_clauses(p, crate::ir_code::CompKind::Generator, a, None, Vec::new(), Some((callee, is_optional, is_new)), stack);
            }
            args.push(a);
            if p.eat(TokenKind::Comma) && p.peek_kind() != TokenKind::RParen && !p.at_eof() {
                stack.push(ParseCont::ExprCallArg { callee, args, is_optional, is_new }); stack.push(ParseCont::Expr(1));
            } else {
                p.expect(TokenKind::RParen, "Expected ')'")?;
                vals.push(ParseVal::Expr(Expr::Call { callee: Box::new(callee), args, is_optional, is_tagged: false, is_new }));
            }
        }
        ParseCont::ExprTaggedTemplate { callee } => {
            let tpl = pop_expr(vals);
            vals.push(ParseVal::Expr(Expr::Call { callee: Box::new(callee), args: vec![tpl], is_optional: false, is_tagged: true, is_new: false }));
        }
        ParseCont::ExprIndex { object, mut args, is_optional } => {
            args.push(pop_expr(vals));
            if p.eat(TokenKind::Comma) && p.peek_kind() != TokenKind::RBracket && !p.at_eof() {
                stack.push(ParseCont::ExprIndex { object, args, is_optional }); stack.push(ParseCont::Expr(1));
            } else {
                p.expect(TokenKind::RBracket, "Expected ']'")?;
                let idx = if args.len() == 1 { args.pop().unwrap() } else {
                    Expr::Call { callee: Box::new(Expr::Ident("\0idx".into())), args, is_optional: false, is_tagged: false, is_new: false }
                };
                vals.push(ParseVal::Expr(Expr::Index { object: Box::new(object), index: Box::new(idx), is_optional }));
            }
        }
        ParseCont::ExprTernaryThen { cond, next_prec } => {
            let then_expr = pop_expr(vals);
            p.expect(TokenKind::Colon, "Expected ':' in ternary")?;
            stack.push(ParseCont::ExprTernaryElse { cond, then_expr }); stack.push(ParseCont::Expr(next_prec));
        }
        ParseCont::ExprTernaryElse { cond, then_expr } => {
            let else_expr = pop_expr(vals);
            vals.push(ParseVal::Expr(Expr::Conditional { cond: Box::new(cond), then_expr: Box::new(then_expr), else_expr: Box::new(else_expr) }));
        }
        ParseCont::ExprAssign { target, op } => {
            let v = pop_expr(vals); vals.push(ParseVal::Expr(Expr::Assign { target: Box::new(target), op, value: Box::new(v) }));
        }
        ParseCont::ExprBinary { left, op } => {
            let r = pop_expr(vals); vals.push(ParseVal::Expr(Expr::Binary { op, left: Box::new(left), right: Box::new(r) }));
        }
        ParseCont::ExprMatchWrap => {
            let sp = p.peek().span;
            let ParseVal::Stmt(mut m) = vals.pop().expect("match stmt") else { unreachable!("expected Stmt") };
            if let Stmt::Match { target, cases, .. } = &mut *m {
                let tgt = std::mem::replace(target, Expr::Ident(String::new()));
                vals.push(ParseVal::Expr(Expr::Match { target: Box::new(tgt), cases: std::mem::take(cases) }));
            } else { return Err(TranspileError::at("Invalid match expression", sp)); }
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
            stack.push(ParseCont::ExprUnary { op }); stack.push(ParseCont::Expr(16));
        }
        TokenKind::AmpAmp => {
            p.advance();
            let inner_op = if p.eat(TokenKind::Mut) { UnaryOp::RefMut } else { UnaryOp::Ref };
            stack.push(ParseCont::ExprDblRef { inner_op }); stack.push(ParseCont::Expr(16));
        }
        TokenKind::Await => { p.advance(); stack.push(ParseCont::ExprAwait); stack.push(ParseCont::Expr(16)); }
        _ if let Some(e) = lit_expr_from_tok(p, &tok) => { p.advance(); vals.push(ParseVal::Expr(e)); }
        TokenKind::TemplateHead => {
            let head = p.advance();
            stack.push(ParseCont::ExprTemplate { quasis: vec![head.lexeme], exprs: Vec::new() }); stack.push(ParseCont::Expr(1));
        }
        TokenKind::LParen => step_paren_open(p, stack, vals),
        TokenKind::LBracket => {
            p.advance();
            if p.peek_kind() == TokenKind::RBracket || p.at_eof() {
                p.expect(TokenKind::RBracket, "Expected ']'")?; vals.push(ParseVal::Expr(Expr::Array(Vec::new())));
            } else { stack.push(ParseCont::ExprArray(Vec::new())); stack.push(ParseCont::Expr(1)); }
        }
        TokenKind::LBrace => {
            p.advance();
            if p.peek_kind() == TokenKind::RBrace || p.at_eof() {
                p.expect(TokenKind::RBrace, "Expected '}'")?; vals.push(ParseVal::Expr(Expr::Record(Vec::new())));
            } else if crate::parser_iter_comp::is_brace_comp_ahead(p) {
                stack.push(ParseCont::ExprBraceCompKey); stack.push(ParseCont::Expr(1));
            } else { start_record_entry(p, Vec::new(), stack)?; }
        }
        TokenKind::Fn if looks_like_closure_after_fn(p) || looks_like_gen_closure(p, 1) => {
            p.advance();
            if p.eat(TokenKind::Star) { stack.push(ParseCont::ExprUnary { op: UnaryOp::Generator }); }
            p.expect(TokenKind::LParen, "Expected '('")?;
            step_closure_params(p, false, Vec::new(), stack, vals)?;
        }
        _ if crate::parser_iter_lit::is_move_closure_ahead(p, &tok) => crate::parser_iter_lit::start_move_closure(p, stack, vals)?,
        TokenKind::Async if p.peek_n(1).kind == TokenKind::Fn => {
            p.advance(); p.advance();
            if p.eat(TokenKind::Star) { stack.push(ParseCont::ExprUnary { op: UnaryOp::Generator }); }
            p.expect(TokenKind::LParen, "Expected '('")?;
            step_closure_params(p, true, Vec::new(), stack, vals)?;
        }
        TokenKind::Match if is_match_ahead(p, false) => { stack.push(ParseCont::ExprMatchWrap); start_match(p, stack)?; }
        TokenKind::Dollar => {
            p.advance();
            let name = p.expect_ident_or_kw("Expected identifier after '$'")?.lexeme;
            vals.push(ParseVal::Expr(Expr::Ident(format!("${name}"))));
        }
        TokenKind::Colon | TokenKind::Hash if tok.span.end_byte == p.peek_n(1).span.start_byte && (p.peek_n(1).kind == TokenKind::Ident || p.peek_n(1).is_keyword()) => {
            let pfx = p.advance().lexeme;
            vals.push(ParseVal::Expr(Expr::Ident(format!("{pfx}{}", p.advance().lexeme))));
        }
        _ if is_new_prefix_start(p, &tok) => parse_new_prefix(p, stack, vals)?,
        TokenKind::Ident if tok.lexeme == "raw" && matches!(p.peek_n(1).kind, TokenKind::String | TokenKind::TripleString) => {
            p.advance(); vals.push(ParseVal::Expr(Expr::Raw(p.advance().lexeme)));
        }
        _ if let Some(op) = try_contextual_unary(p, &tok) => {
            p.advance();
            if op == UnaryOp::YieldStar { p.advance(); }
            let arg_prec = if matches!(op, UnaryOp::Yield | UnaryOp::YieldStar) { 2 } else { 16 };
            stack.push(ParseCont::ExprUnary { op });
            stack.push(ParseCont::Expr(arg_prec));
        }
        TokenKind::Let if crate::parser_stmt::try_parse_let_cond(p, stack) => {}
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
                    callee: Box::new(lhs), args: Vec::new(), is_optional: false, is_tagged: false, is_new: false,
                }));
            } else {
                stack.push(ParseCont::ExprCallArg { callee: lhs, args: Vec::new(), is_optional: false, is_new: false });
                stack.push(ParseCont::Expr(1));
            }
        }
        TokenKind::LBracket => {
            p.advance();
            stack.push(ParseCont::ExprIndex { object: lhs, args: Vec::new(), is_optional: false });
            stack.push(ParseCont::Expr(1));
        }
        TokenKind::TemplateNoSubst => {
            let tpl = Expr::Template { quasis: vec![p.advance().lexeme], exprs: Vec::new() };
            vals.push(ParseVal::Expr(Expr::Call { callee: Box::new(lhs), args: vec![tpl], is_optional: false, is_tagged: true, is_new: false }));
        }
        TokenKind::TemplateHead => {
            let head = p.advance();
            stack.push(ParseCont::ExprTaggedTemplate { callee: lhs });
            stack.push(ParseCont::ExprTemplate { quasis: vec![head.lexeme], exprs: Vec::new() });
            stack.push(ParseCont::Expr(1));
        }
        TokenKind::MacroBody => {
            let tok = p.advance();
            if !matches!(lhs, Expr::Ident(_) | Expr::Member { kind: MemberKind::Scope, .. }) {
                return Err(TranspileError::at("Invalid macro invocation target", tok.span));
            }
            vals.push(ParseVal::Expr(Expr::Ident(format!("{}{}", crate::printer_expr::print_expr(&lhs).replace("\\#nil", "nil"), tok.lexeme))));
        }
        TokenKind::Dot | TokenKind::QuestionDot | TokenKind::ColonColon | TokenKind::Turbofish => {
            step_member_infix(p, lhs, kind, stack, vals)?;
        }
        TokenKind::PlusPlus | TokenKind::MinusMinus => {
            p.advance();
            let op = if kind == TokenKind::PlusPlus { UnaryOp::Inc } else { UnaryOp::Dec };
            vals.push(ParseVal::Expr(Expr::Unary { op, is_postfix: true, operand: Box::new(lhs) }));
        }
        TokenKind::Question => {
            if is_elvis_ahead(p) {
                p.advance(); p.advance();
                stack.push(ParseCont::ExprBinary { left: lhs, op: BinaryOp::Elvis });
                stack.push(ParseCont::Expr(6));
            } else {
                p.advance();
                stack.push(ParseCont::ExprTernaryThen { cond: lhs, next_prec });
                stack.push(ParseCont::Expr(1));
            }
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
