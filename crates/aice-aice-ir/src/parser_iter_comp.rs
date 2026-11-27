use crate::ir::TranspileError;
use crate::ir_code::{CompClause, CompKind, Expr};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_iter::{ParseCont, ParseVal};
use crate::parser_iter_expr::pop_expr;

pub(crate) fn is_comp_for_ahead(p: &Parser<'_>) -> bool {
    p.peek_kind() == TokenKind::For
        || (p.peek_kind() == TokenKind::Async && p.peek_n(1).kind == TokenKind::For)
}

pub(crate) fn is_brace_comp_ahead(p: &Parser<'_>) -> bool {
    let (mut idx, mut depth) = (p.pos, 0usize);
    while idx < p.tokens.len() {
        match p.tokens[idx].kind {
            TokenKind::LParen | TokenKind::LBracket | TokenKind::LBrace => depth += 1,
            TokenKind::RParen | TokenKind::RBracket => {
                if depth == 0 { return false; }
                depth -= 1;
            }
            TokenKind::RBrace => {
                if depth == 0 { return false; }
                depth -= 1;
            }
            TokenKind::Comma | TokenKind::Eof if depth == 0 => return false,
            TokenKind::For if depth == 0 => return true,
            TokenKind::Async
                if depth == 0
                    && p.tokens.get(idx + 1).is_some_and(|t| t.kind == TokenKind::For) =>
            {
                return true;
            }
            _ => {}
        }
        idx += 1;
    }
    false
}

fn parse_comp_target(p: &mut Parser<'_>) -> Result<String, TranspileError> {
    let sp = p.peek().span;
    let (mut start, mut end, mut depth) = (None, 0usize, 0usize);
    while !p.at_eof() {
        let k = p.peek_kind();
        if depth == 0
            && matches!(
                k,
                TokenKind::In | TokenKind::Newline | TokenKind::RBracket | TokenKind::RBrace | TokenKind::RParen
            )
        {
            break;
        }
        let tok = p.advance();
        match tok.kind {
            TokenKind::LParen | TokenKind::LBracket | TokenKind::LBrace => depth += 1,
            TokenKind::RParen | TokenKind::RBracket | TokenKind::RBrace => depth = depth.saturating_sub(1),
            _ => {}
        }
        if tok.span.end_byte > tok.span.start_byte {
            if start.is_none() { start = Some(tok.span.start_byte); }
            end = tok.span.end_byte;
        }
    }
    p.expect(TokenKind::In, "Expected 'in' in comprehension")?;
    let target = start.map(|s| p.src[s..end].trim().to_string()).unwrap_or_default();
    if target.is_empty() {
        return Err(TranspileError::at("Expected target variable after 'for' in comprehension", sp));
    }
    Ok(target)
}

pub(crate) fn start_comp_clauses(
    p: &mut Parser<'_>,
    kind: CompKind,
    body: Expr,
    value: Option<Expr>,
    clauses: Vec<CompClause>,
    wrap_call: Option<(Expr, bool, bool)>,
    stack: &mut Vec<ParseCont>,
) -> Result<(), TranspileError> {
    let is_async = p.eat(TokenKind::Async);
    p.expect(TokenKind::For, "Expected 'for' in comprehension")?;
    let target = parse_comp_target(p)?;
    stack.push(ParseCont::ExprCompIter { kind, body, value, clauses, is_async, target, wrap_call });
    stack.push(ParseCont::Expr(1));
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn continue_comp_clauses(
    p: &mut Parser<'_>,
    kind: CompKind,
    body: Expr,
    value: Option<Expr>,
    clauses: Vec<CompClause>,
    wrap_call: Option<(Expr, bool, bool)>,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> Result<(), TranspileError> {
    if p.eat(TokenKind::If) {
        stack.push(ParseCont::ExprCompFilter { kind, body, value, clauses, wrap_call });
        stack.push(ParseCont::Expr(1));
        return Ok(());
    }
    if is_comp_for_ahead(p) {
        return start_comp_clauses(p, kind, body, value, clauses, wrap_call, stack);
    }
    match kind {
        CompKind::List => p.expect(TokenKind::RBracket, "Expected ']'")?,
        CompKind::Set | CompKind::Dict => p.expect(TokenKind::RBrace, "Expected '}'")?,
        CompKind::Generator => p.expect(TokenKind::RParen, "Expected ')'")?,
    };
    let comp = Expr::Comprehension {
        kind,
        body: Box::new(body),
        value: value.map(Box::new),
        clauses,
    };
    if let Some((callee, is_optional, is_new)) = wrap_call {
        vals.push(ParseVal::Expr(Expr::Call {
            callee: Box::new(callee),
            args: vec![comp],
            is_optional,
            is_tagged: false,
            is_new,
        }));
    } else {
        vals.push(ParseVal::Expr(comp));
    }
    Ok(())
}

pub(crate) fn step_comp_cont(
    p: &mut Parser<'_>,
    cont: ParseCont,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> Result<(), TranspileError> {
    match cont {
        ParseCont::ExprBraceCompKey => {
            let key = pop_expr(vals);
            if p.eat(TokenKind::Colon) {
                stack.push(ParseCont::ExprBraceCompVal { key });
                stack.push(ParseCont::Expr(1));
            } else {
                start_comp_clauses(p, CompKind::Set, key, None, Vec::new(), None, stack)?;
            }
        }
        ParseCont::ExprBraceCompVal { key } => {
            let val = pop_expr(vals);
            start_comp_clauses(p, CompKind::Dict, key, Some(val), Vec::new(), None, stack)?;
        }
        ParseCont::ExprCompIter { kind, body, value, mut clauses, is_async, target, wrap_call } => {
            let iter = pop_expr(vals);
            clauses.push(CompClause { is_async, target, iter, filters: Vec::new() });
            continue_comp_clauses(p, kind, body, value, clauses, wrap_call, stack, vals)?;
        }
        ParseCont::ExprCompFilter { kind, body, value, mut clauses, wrap_call } => {
            let cond = pop_expr(vals);
            if let Some(last) = clauses.last_mut() {
                last.filters.push(cond);
            }
            continue_comp_clauses(p, kind, body, value, clauses, wrap_call, stack, vals)?;
        }
        _ => unreachable!(),
    }
    Ok(())
}
