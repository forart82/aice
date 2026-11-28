use crate::ir::TranspileError;
use crate::ir_code::{Expr, Pattern, UnaryOp};
use crate::ir_expr::LiteralVal;
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_iter::{ParseCont, ParseVal};
use crate::parser_types::parse_type_expr;

fn pop_pat(vals: &mut Vec<ParseVal>) -> Pattern {
    match vals.pop().expect("expected Pat") {
        ParseVal::Pat(pat) => pat,
        _ => unreachable!("expected ParseVal::Pat"),
    }
}

fn pop_expr(vals: &mut Vec<ParseVal>) -> Expr {
    match vals.pop().expect("expected Expr") {
        ParseVal::Expr(e) => e,
        _ => unreachable!("expected ParseVal::Expr"),
    }
}

pub(crate) fn step_pat_cont(
    p: &mut Parser<'_>,
    cont: ParseCont,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> Result<(), TranspileError> {
    match cont {
        ParseCont::PatParse => {
            stack.push(ParseCont::PatOrTail(Vec::new()));
            stack.push(ParseCont::PatSingle);
        }
        ParseCont::PatOrTail(mut items) => {
            items.push(pop_pat(vals));
            if p.eat(TokenKind::Pipe) {
                stack.push(ParseCont::PatOrTail(items));
                stack.push(ParseCont::PatSingle);
            } else if items.len() == 1 {
                vals.push(ParseVal::Pat(items.pop().unwrap()));
            } else {
                vals.push(ParseVal::Pat(Pattern::Or(items)));
            }
        }
        ParseCont::PatSingle => step_single_pattern(p, stack, vals)?,
        ParseCont::PatCtorArg { name, mut args } => {
            args.push(pop_pat(vals));
            if p.eat(TokenKind::Comma) && p.peek_kind() != TokenKind::RParen && !p.at_eof() {
                stack.push(ParseCont::PatCtorArg { name, args });
                stack.push(ParseCont::PatParse);
            } else {
                p.expect(TokenKind::RParen, "Expected ')'")?;
                vals.push(ParseVal::Pat(Pattern::Constructor { name, args }));
            }
        }
        ParseCont::PatRangeEnd { start, inclusive, negated } => {
            let end = pop_expr(vals);
            vals.push(ParseVal::Pat(Pattern::Range {
                start: Box::new(start), end: Box::new(end), inclusive, negated,
            }));
        }
        ParseCont::PatRangeWrap { negs } => {
            p.expect(TokenKind::RParen, "Expected ')'")?;
            let mut e = pop_expr(vals);
            for _ in 0..negs {
                e = Expr::Unary { op: UnaryOp::Neg, is_postfix: false, operand: Box::new(e) };
            }
            vals.push(ParseVal::Expr(e));
        }
        _ => unreachable!(),
    }
    Ok(())
}

fn step_single_pattern(p: &mut Parser<'_>, stack: &mut Vec<ParseCont>, vals: &mut Vec<ParseVal>) -> Result<(), TranspileError> {
    if p.peek().lexeme == "_" { p.advance(); vals.push(ParseVal::Pat(Pattern::Wildcard)); return Ok(()); }
    if p.peek_kind() == TokenKind::Bang && p.peek_n(1).kind == TokenKind::In {
        p.advance();
        p.advance();
        return start_range_pattern(p, true, stack, vals);
    }
    if p.eat(TokenKind::In) {
        return start_range_pattern(p, false, stack, vals);
    }
    if p.peek_kind() == TokenKind::Bang && p.peek_n(1).lexeme == "is" {
        p.advance();
        p.advance();
        vals.push(ParseVal::Pat(Pattern::TypeCheck { ty: parse_type_expr(p)?, negated: true }));
        return Ok(());
    }
    if p.peek().lexeme == "is"
        && !matches!(p.peek_n(1).kind, TokenKind::FatArrow | TokenKind::If | TokenKind::Pipe | TokenKind::Comma | TokenKind::RParen)
    {
        p.advance();
        vals.push(ParseVal::Pat(Pattern::TypeCheck { ty: parse_type_expr(p)?, negated: false }));
        return Ok(());
    }
    match p.peek_kind() {
        TokenKind::Minus if p.peek_n(1).kind == TokenKind::Number => {
            if p.peek_n(2).kind == TokenKind::Dot && p.peek_n(3).kind == TokenKind::Dot {
                return start_range_pattern(p, false, stack, vals);
            }
            p.advance();
            let lex = format!("-{}", p.advance().lexeme);
            let lit = if lex.contains('.') { LiteralVal::Float(lex) } else { LiteralVal::Int(lex) };
            vals.push(ParseVal::Pat(Pattern::Literal(lit)));
        }
        TokenKind::Number => {
            if p.peek_n(1).kind == TokenKind::Dot && p.peek_n(2).kind == TokenKind::Dot {
                return start_range_pattern(p, false, stack, vals);
            }
            let lex = p.advance().lexeme;
            let lit = if lex.contains('.') { LiteralVal::Float(lex) } else { LiteralVal::Int(lex) };
            vals.push(ParseVal::Pat(Pattern::Literal(lit)));
        }
        TokenKind::String => vals.push(ParseVal::Pat(Pattern::Literal(LiteralVal::Str { value: p.advance().lexeme, multiline: false }))),
        TokenKind::Boolean => vals.push(ParseVal::Pat(Pattern::Literal(LiteralVal::Bool(p.advance().lexeme == "true")))),
        TokenKind::Nil => { p.advance(); vals.push(ParseVal::Pat(Pattern::Literal(LiteralVal::Nil))); }
        TokenKind::Ident if p.peek().lexeme == "raw" && matches!(p.peek_n(1).kind, TokenKind::String | TokenKind::TripleString) => {
            p.advance(); vals.push(ParseVal::Pat(Pattern::Ident(p.advance().lexeme)));
        }
        _ => {
            let mut name = p.expect_ident_or_kw("Expected pattern")?.lexeme;
            while p.eat(TokenKind::ColonColon) || p.eat(TokenKind::Dot) {
                name.push_str("::");
                name.push_str(&p.expect_ident_or_kw("Expected pattern segment")?.lexeme);
            }
            if p.eat(TokenKind::LParen) {
                if p.peek_kind() == TokenKind::RParen || p.at_eof() {
                    p.expect(TokenKind::RParen, "Expected ')'")?;
                    vals.push(ParseVal::Pat(Pattern::Constructor { name, args: Vec::new() }));
                } else {
                    stack.push(ParseCont::PatCtorArg { name, args: Vec::new() });
                    stack.push(ParseCont::PatParse);
                }
            } else if p.eat(TokenKind::LBrace) {
                let mut inner = Vec::new();
                while p.peek_kind() != TokenKind::RBrace && !p.at_eof() {
                    if p.eat(TokenKind::Ellipsis) || p.peek().lexeme == ".." {
                        if p.peek().lexeme == ".." { p.advance(); }
                        inner.push("..".to_string());
                    } else if p.eat(TokenKind::Dot) && p.eat(TokenKind::Dot) {
                        inner.push("..".to_string());
                    } else {
                        inner.push(p.expect_ident_or_kw("Expected field pattern")?.lexeme);
                    }
                    if !p.eat(TokenKind::Comma) { break; }
                }
                p.expect(TokenKind::RBrace, "Expected '}'")?;
                vals.push(ParseVal::Pat(Pattern::Ident(format!("{name} {{ {} }}", inner.join(", ")))));
            } else {
                vals.push(ParseVal::Pat(Pattern::Ident(name)));
            }
        }
    }
    Ok(())
}

fn start_range_pattern(
    p: &mut Parser<'_>,
    negated: bool,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> Result<(), TranspileError> {
    let start = parse_sync_range_bound(p)?;
    p.expect(TokenKind::Dot, "Expected '..' in range pattern")?;
    p.expect(TokenKind::Dot, "Expected '..' in range pattern")?;
    let inclusive = p.eat(TokenKind::Equal);
    let mut negs = 0usize;
    while p.eat(TokenKind::Minus) { negs += 1; }
    if p.peek_kind() == TokenKind::LParen {
        p.advance();
        stack.push(ParseCont::PatRangeEnd { start, inclusive, negated });
        stack.push(ParseCont::PatRangeWrap { negs });
        stack.push(ParseCont::Expr(1));
        return Ok(());
    }
    let mut end = parse_atom_range_bound(p)?;
    for _ in 0..negs {
        end = Expr::Unary { op: UnaryOp::Neg, is_postfix: false, operand: Box::new(end) };
    }
    vals.push(ParseVal::Pat(Pattern::Range { start: Box::new(start), end: Box::new(end), inclusive, negated }));
    Ok(())
}

fn parse_sync_range_bound(p: &mut Parser<'_>) -> Result<Expr, TranspileError> {
    let mut negs = 0usize;
    while p.eat(TokenKind::Minus) { negs += 1; }
    let mut e = if p.peek_kind() == TokenKind::LParen {
        p.advance();
        let inner = crate::parser_expr::parse_expr(p)?;
        p.expect(TokenKind::RParen, "Expected ')'")?;
        inner
    } else {
        parse_atom_range_bound(p)?
    };
    for _ in 0..negs {
        e = Expr::Unary { op: UnaryOp::Neg, is_postfix: false, operand: Box::new(e) };
    }
    Ok(e)
}

fn parse_atom_range_bound(p: &mut Parser<'_>) -> Result<Expr, TranspileError> {
    let tok = p.peek().clone();
    match tok.kind {
        TokenKind::Number => {
            p.advance();
            let lit = if tok.lexeme.contains('.') { LiteralVal::Float(tok.lexeme) } else { LiteralVal::Int(tok.lexeme) };
            Ok(Expr::Literal(lit))
        }
        TokenKind::String => { p.advance(); Ok(Expr::Literal(LiteralVal::Str { value: tok.lexeme, multiline: false })) }
        TokenKind::Ident => { p.advance(); Ok(Expr::Ident(tok.lexeme)) }
        _ if tok.is_keyword() => { p.advance(); Ok(Expr::Ident(tok.lexeme)) }
        _ => Err(TranspileError::at(format!("Expected range bound, got {:?}", tok.kind), tok.span)),
    }
}
