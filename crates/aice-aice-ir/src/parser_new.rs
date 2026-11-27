use crate::ir::TranspileError;
use crate::ir_code::{Expr, MemberKind};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_iter::{ParseCont, ParseVal};
use crate::parser_iter_expr::pop_expr;

fn append_ctor_suffix(ctor: &mut Expr, suffix: &str) {
    match ctor {
        Expr::Ident(s) => s.push_str(suffix),
        Expr::Member { property, .. } => property.push_str(suffix),
        _ => {}
    }
}

pub(crate) fn try_attach_new_init(
    p: &Parser<'_>,
    min_prec: u8,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> bool {
    if p.peek_kind() != TokenKind::LBrace {
        return false;
    }
    let ok = matches!(
        vals.last(),
        Some(ParseVal::Expr(Expr::Call { callee, is_tagged: false, is_new, .. }))
            if *is_new || matches!(callee.as_ref(), Expr::Ident(s) if s == "new")
    );
    if !ok {
        return false;
    }
    let mut lhs = pop_expr(vals);
    if let Expr::Call { callee, args, is_new, .. } = &mut lhs {
        let ctor = if *is_new {
            std::mem::replace(callee.as_mut(), Expr::Ident(String::new()))
        } else {
            Expr::Ident(String::new())
        };
        let taken_args = std::mem::take(args);
        stack.push(ParseCont::ExprInfix(min_prec));
        stack.push(ParseCont::ExprNewObjInit { callee: ctor, args: taken_args, has_parens: true });
        stack.push(ParseCont::Expr(18));
        true
    } else {
        false
    }
}

fn finish_new_call_args(
    p: &mut Parser<'_>,
    ctor: Expr,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> Result<(), TranspileError> {
    if p.eat(TokenKind::LParen) {
        if p.peek_kind() == TokenKind::RParen || p.at_eof() {
            p.expect(TokenKind::RParen, "Expected ')'")?;
            vals.push(ParseVal::Expr(Expr::Call {
                callee: Box::new(ctor), args: Vec::new(), is_optional: false, is_tagged: false, is_new: true,
            }));
        } else {
            stack.push(ParseCont::ExprCallArg { callee: ctor, args: Vec::new(), is_optional: false, is_new: true });
            stack.push(ParseCont::Expr(1));
        }
    } else if p.peek_kind() == TokenKind::LBrace {
        stack.push(ParseCont::ExprNewObjInit { callee: ctor, args: Vec::new(), has_parens: false });
        stack.push(ParseCont::Expr(18));
    } else {
        vals.push(ParseVal::Expr(Expr::Call {
            callee: Box::new(ctor), args: Vec::new(), is_optional: false, is_tagged: false, is_new: true,
        }));
    }
    Ok(())
}

pub(crate) fn parse_new_prefix(
    p: &mut Parser<'_>,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> Result<(), TranspileError> {
    p.advance(); // "new"
    if p.peek_kind() == TokenKind::LBrace {
        stack.push(ParseCont::ExprNewObjInit {
            callee: Expr::Ident(String::new()), args: Vec::new(), has_parens: false,
        });
        stack.push(ParseCont::Expr(18));
        return Ok(());
    }
    if p.peek_kind() == TokenKind::LBracket {
        return step_new_array_rank(p, Expr::Ident(String::new()), stack, vals);
    }
    let mut ctor = Expr::Ident(p.advance().lexeme);
    loop {
        if p.eat(TokenKind::Concat) {
            append_ctor_suffix(&mut ctor, "<>");
        } else if p.peek_kind() == TokenKind::Lt {
            let start = p.peek().span.start_byte;
            let (mut depth, mut end) = (0usize, start);
            while !p.at_eof() {
                let t = p.advance();
                end = t.span.end_byte;
                if t.kind == TokenKind::Lt {
                    depth += 1;
                } else if t.kind == TokenKind::Gt {
                    depth = depth.saturating_sub(1);
                    if depth == 0 { break; }
                } else if t.kind == TokenKind::Shr {
                    depth = depth.saturating_sub(2);
                    if depth == 0 { break; }
                } else if t.kind == TokenKind::Ushr {
                    depth = depth.saturating_sub(3);
                    if depth == 0 { break; }
                }
            }
            append_ctor_suffix(&mut ctor, &p.src[start..end]);
        }
        if matches!(p.peek_kind(), TokenKind::Dot | TokenKind::ColonColon) {
            let mk = if p.advance().kind == TokenKind::ColonColon { MemberKind::Scope } else { MemberKind::Dot };
            let prop = p.expect_ident_or_kw("Expected member name")?.lexeme;
            ctor = Expr::Member { object: Box::new(ctor), property: prop, kind: mk };
        } else {
            break;
        }
    }
    if p.peek_kind() == TokenKind::Question && p.peek_n(1).kind == TokenKind::LBracket {
        p.advance();
        append_ctor_suffix(&mut ctor, "?");
    }
    if p.peek_kind() == TokenKind::LBracket {
        return step_new_array_rank(p, ctor, stack, vals);
    }
    finish_new_call_args(p, ctor, stack, vals)
}

fn step_new_array_rank(
    p: &mut Parser<'_>,
    mut ctor: Expr,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> Result<(), TranspileError> {
    while p.eat(TokenKind::LBracket) {
        if p.eat(TokenKind::RBracket) {
            ctor = Expr::Index { object: Box::new(ctor), index: Box::new(Expr::Ident(String::new())), is_optional: false };
        } else if p.peek_kind() == TokenKind::Comma {
            let mut commas = 0usize;
            while p.eat(TokenKind::Comma) { commas += 1; }
            p.expect(TokenKind::RBracket, "Expected ']'")?;
            ctor = Expr::Index { object: Box::new(ctor), index: Box::new(Expr::Ident(",".repeat(commas))), is_optional: false };
        } else {
            stack.push(ParseCont::ExprNewArrayRankCont);
            stack.push(ParseCont::ExprIndex { object: ctor, args: Vec::new(), is_optional: false });
            stack.push(ParseCont::Expr(1));
            return Ok(());
        }
    }
    if p.peek_kind() == TokenKind::LParen {
        return finish_new_call_args(p, ctor, stack, vals);
    }
    if p.eat(TokenKind::LBrace) {
        if p.eat(TokenKind::RBrace) {
            vals.push(ParseVal::Expr(Expr::Call {
                callee: Box::new(ctor), args: vec![Expr::Array(Vec::new())],
                is_optional: false, is_tagged: true, is_new: true,
            }));
        } else {
            stack.push(ParseCont::ExprNewArrayInit { callee: ctor, items: Vec::new() });
            stack.push(ParseCont::Expr(1));
        }
        return Ok(());
    }
    vals.push(ParseVal::Expr(Expr::Call {
        callee: Box::new(ctor), args: Vec::new(), is_optional: false, is_tagged: true, is_new: true,
    }));
    Ok(())
}

pub(crate) fn step_new_cont(
    p: &mut Parser<'_>,
    cont: ParseCont,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> Result<(), TranspileError> {
    match cont {
        ParseCont::ExprNewArrayRankCont => {
            let ctor = pop_expr(vals);
            step_new_array_rank(p, ctor, stack, vals)
        }
        ParseCont::ExprNewArrayInit { callee, mut items } => {
            items.push(pop_expr(vals));
            if p.eat(TokenKind::Comma) && p.peek_kind() != TokenKind::RBrace && !p.at_eof() {
                stack.push(ParseCont::ExprNewArrayInit { callee, items });
                stack.push(ParseCont::Expr(1));
            } else {
                p.expect(TokenKind::RBrace, "Expected '}'")?;
                vals.push(ParseVal::Expr(Expr::Call {
                    callee: Box::new(callee), args: vec![Expr::Array(items)],
                    is_optional: false, is_tagged: true, is_new: true,
                }));
            }
            Ok(())
        }
        ParseCont::ExprNewObjInit { callee, mut args, has_parens } => {
            args.push(pop_expr(vals));
            vals.push(ParseVal::Expr(Expr::Call {
                callee: Box::new(callee), args, is_optional: has_parens, is_tagged: true, is_new: true,
            }));
            Ok(())
        }
        _ => unreachable!(),
    }
}
