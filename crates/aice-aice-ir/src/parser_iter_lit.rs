use crate::ir::{TranspileError, Trivia};
use crate::ir_code::{Expr, FnBody, RecordEntry};
use crate::ir_types::ParamDecl;
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_iter::{ParseCont, ParseVal};
use crate::parser_iter_expr::pop_expr;
use crate::parser_types::parse_type_expr;

pub(crate) fn step_lit_cont(
    p: &mut Parser<'_>,
    cont: ParseCont,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> Result<(), TranspileError> {
    match cont {
        ParseCont::ExprTemplate { mut quasis, mut exprs } => {
            exprs.push(pop_expr(vals));
            match p.peek_kind() {
                TokenKind::TemplateMiddle => {
                    quasis.push(p.advance().lexeme);
                    stack.push(ParseCont::ExprTemplate { quasis, exprs });
                    stack.push(ParseCont::Expr(1));
                }
                TokenKind::TemplateTail => {
                    quasis.push(p.advance().lexeme);
                    vals.push(ParseVal::Expr(Expr::Template { quasis, exprs }));
                }
                _ => return Err(TranspileError::at("Expected template continuation or closing '`'", p.peek().span)),
            }
        }
        ParseCont::ExprArray(mut items) => {
            let item = pop_expr(vals);
            if items.is_empty() && crate::parser_iter_comp::is_comp_for_ahead(p) {
                crate::parser_iter_comp::start_comp_clauses(
                    p, crate::ir_code::CompKind::List, item, None, Vec::new(), None, stack,
                )?;
                return Ok(());
            }
            items.push(item);
            if p.eat(TokenKind::Comma) && p.peek_kind() != TokenKind::RBracket && !p.at_eof() {
                stack.push(ParseCont::ExprArray(items));
                stack.push(ParseCont::Expr(1));
            } else {
                p.expect(TokenKind::RBracket, "Expected ']'")?;
                vals.push(ParseVal::Expr(Expr::Array(items)));
            }
        }
        ParseCont::ExprRecord { mut entries, key, is_spread } => {
            let e = pop_expr(vals);
            entries.push(if is_spread { RecordEntry::Spread(e) } else { RecordEntry::Field { key, value: e } });
            if p.eat(TokenKind::Comma) && p.peek_kind() != TokenKind::RBrace && !p.at_eof() {
                start_record_entry(p, entries, stack)?;
            } else {
                p.expect(TokenKind::RBrace, "Expected '}'")?;
                vals.push(ParseVal::Expr(Expr::Record(entries)));
            }
        }
        ParseCont::ExprClosureParamDefault { is_async, mut params, mut cur } => {
            cur.default = Some(pop_expr(vals));
            params.push(cur);
            if p.eat(TokenKind::Comma) {
                step_closure_params(p, is_async, params, stack, vals)?;
            } else {
                finish_closure_header(p, is_async, params, stack, vals)?;
            }
        }
        ParseCont::ExprClosureFinish { is_async, params, ret, is_block } => {
            let body = if is_block {
                let stmts = match vals.pop().expect("closure block") {
                    ParseVal::Block(b) => b,
                    _ => unreachable!("expected block"),
                };
                FnBody::Block(stmts)
            } else {
                FnBody::Expr(pop_expr(vals))
            };
            vals.push(ParseVal::Expr(Expr::Closure { is_async, params, ret, body: Box::new(body) }));
        }
        _ => unreachable!(),
    }
    Ok(())
}

pub(crate) fn start_record_entry(
    p: &mut Parser<'_>,
    entries: Vec<RecordEntry>,
    stack: &mut Vec<ParseCont>,
) -> Result<(), TranspileError> {
    if p.eat(TokenKind::Ellipsis) {
        stack.push(ParseCont::ExprRecord { entries, key: None, is_spread: true });
    } else if (Parser::is_binding_tok(p.peek()) || p.peek_kind() == TokenKind::String)
        && p.peek_n(1).kind == TokenKind::Colon
    {
        let key = p.advance().lexeme;
        p.advance();
        stack.push(ParseCont::ExprRecord { entries, key: Some(key), is_spread: false });
    } else {
        stack.push(ParseCont::ExprRecord { entries, key: None, is_spread: false });
    }
    stack.push(ParseCont::Expr(1));
    Ok(())
}

pub(crate) fn looks_like_closure_after_fn(p: &Parser<'_>) -> bool {
    if p.peek_n(1).kind != TokenKind::LParen {
        return false;
    }
    let (mut idx, mut depth) = (p.pos + 2, 1usize);
    while idx < p.tokens.len() && depth > 0 {
        match p.tokens[idx].kind {
            TokenKind::LParen => depth += 1,
            TokenKind::RParen => depth -= 1,
            TokenKind::Eof => return false,
            _ => {}
        }
        idx += 1;
    }
    matches!(
        p.tokens.get(idx).map(|t| t.kind),
        Some(TokenKind::Equal | TokenKind::FatArrow | TokenKind::LBrace | TokenKind::Arrow)
    )
}

pub(crate) fn step_closure_params(
    p: &mut Parser<'_>,
    is_async: bool,
    mut params: Vec<ParamDecl>,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> Result<(), TranspileError> {
    while p.peek_kind() != TokenKind::RParen && !p.at_eof() {
        let mod_ok = |p: &Parser<'_>| {
            !matches!(p.peek_n(1).kind, TokenKind::Colon | TokenKind::Equal | TokenKind::Comma | TokenKind::RParen | TokenKind::Question)
        };
        let vis = if mod_ok(p) { p.parse_visibility() } else { crate::ir::Visibility::Default };
        let is_readonly = p.peek().lexeme == "readonly" && mod_ok(p) && { p.advance(); true };
        let is_mut = p.peek_kind() == TokenKind::Mut && mod_ok(p) && p.eat(TokenKind::Mut);
        let is_rest = p.eat(TokenKind::Ellipsis);
        let name = if p.peek_kind() == TokenKind::Dollar {
            p.advance(); format!("${}", p.expect_ident_or_kw("Expected param name")?.lexeme)
        } else if p.peek_kind() == TokenKind::Amp {
            p.advance();
            if p.eat(TokenKind::Mut) { format!("&mut {}", p.expect_ident_or_kw("Expected param")?.lexeme) }
            else { format!("&{}", p.expect_ident_or_kw("Expected param")?.lexeme) }
        } else { p.expect_ident_or_kw("Expected parameter name")?.lexeme };
        let is_optional = p.eat(TokenKind::Question);
        let ty = if p.eat(TokenKind::Colon) { Some(parse_type_expr(p)?) } else { None };
        let cur = ParamDecl {
            name, vis, is_readonly, is_mut, is_optional, is_rest, ty, default: None, trivia: Trivia::default(),
        };
        if p.eat(TokenKind::Equal) {
            stack.push(ParseCont::ExprClosureParamDefault { is_async, params, cur });
            stack.push(ParseCont::Expr(1));
            return Ok(());
        }
        params.push(cur);
        if !p.eat(TokenKind::Comma) { break; }
    }
    finish_closure_header(p, is_async, params, stack, vals)
}

fn finish_closure_header(
    p: &mut Parser<'_>,
    is_async: bool,
    params: Vec<ParamDecl>,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> Result<(), TranspileError> {
    p.expect(TokenKind::RParen, "Expected ')'")?;
    let ret = if p.eat(TokenKind::Arrow) { Some(parse_type_expr(p)?) } else { None };
    if p.eat(TokenKind::Equal) {
        stack.push(ParseCont::ExprClosureFinish { is_async, params, ret, is_block: false });
        stack.push(ParseCont::Expr(1));
    } else if p.eat(TokenKind::FatArrow) {
        if p.peek_kind() == TokenKind::LBrace {
            stack.push(ParseCont::ExprClosureFinish { is_async, params, ret, is_block: true });
            p.expect(TokenKind::LBrace, "Expected '{'")?;
            p.skip_newlines();
            stack.push(ParseCont::CurlyBlock(Vec::new()));
        } else {
            stack.push(ParseCont::ExprClosureFinish { is_async, params, ret, is_block: false });
            stack.push(ParseCont::Expr(1));
        }
    } else if p.peek_kind() == TokenKind::LBrace {
        stack.push(ParseCont::ExprClosureFinish { is_async, params, ret, is_block: true });
        p.expect(TokenKind::LBrace, "Expected '{'")?;
        p.skip_newlines();
        stack.push(ParseCont::CurlyBlock(Vec::new()));
    } else {
        vals.push(ParseVal::Expr(Expr::Closure {
            is_async, params, ret, body: Box::new(FnBody::SignatureOnly),
        }));
    }
    Ok(())
}
