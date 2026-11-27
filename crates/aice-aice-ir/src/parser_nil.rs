use crate::ir::{AiceItem, AiceModule};
use crate::ir_code::{Expr, FnBody, LiteralVal, RecordEntry, Stmt};
use crate::lexer_tokens::{Token, TokenKind};
use crate::parser::Parser;

fn fix_nil_target(e: &mut Expr) {
    let mut stack = vec![e];
    while let Some(cur) = stack.pop() {
        match cur {
            Expr::Literal(LiteralVal::Nil) => *cur = Expr::Ident("nil".into()),
            Expr::Array(items) => stack.extend(items.iter_mut()),
            _ => {}
        }
    }
}

enum NilTask<'a> {
    Stmt(&'a mut Stmt),
    Slice(&'a mut [Stmt]),
    Expr(&'a mut Expr),
    Body(&'a mut FnBody),
}

fn run_nil_tasks<'a>(init: NilTask<'a>) {
    let mut tasks = vec![init];
    while let Some(task) = tasks.pop() {
        match task {
            NilTask::Slice(stmts) => {
                for st in stmts.iter_mut().rev() { tasks.push(NilTask::Stmt(st)); }
            }
            NilTask::Body(body) => match body {
                FnBody::SignatureOnly => {}
                FnBody::Expr(e) => tasks.push(NilTask::Expr(e)),
                FnBody::Block(stmts) => {
                    for st in stmts.iter_mut().rev() { tasks.push(NilTask::Stmt(st)); }
                }
            },
            NilTask::Stmt(st) => match st {
                Stmt::Let { init: Some(e), .. } => tasks.push(NilTask::Expr(e)),
                Stmt::Destructure { init, .. } => tasks.push(NilTask::Expr(init)),
                Stmt::Assign { target, value, .. } => {
                    fix_nil_target(target);
                    tasks.push(NilTask::Expr(value));
                    tasks.push(NilTask::Expr(target));
                }
                Stmt::Expr { expr, .. } => tasks.push(NilTask::Expr(expr)),
                Stmt::Return { value: Some(v), .. } => tasks.push(NilTask::Expr(v)),
                Stmt::Throw { expr, cause, .. } => {
                    if let Some(c) = cause { tasks.push(NilTask::Expr(c)); }
                    tasks.push(NilTask::Expr(expr));
                }
                Stmt::If { cond, then_body, elifs, else_body, .. } => {
                    if let Some(eb) = else_body { tasks.push(NilTask::Slice(eb)); }
                    for (ec, eb) in elifs.iter_mut().rev() {
                        tasks.push(NilTask::Slice(eb));
                        tasks.push(NilTask::Expr(ec));
                    }
                    tasks.push(NilTask::Slice(then_body));
                    tasks.push(NilTask::Expr(cond));
                }
                Stmt::While { cond, body, .. } => {
                    tasks.push(NilTask::Slice(body));
                    tasks.push(NilTask::Expr(cond));
                }
                Stmt::For { iter, body, .. } => {
                    tasks.push(NilTask::Slice(body));
                    tasks.push(NilTask::Expr(iter));
                }
                Stmt::Loop { body, .. } => tasks.push(NilTask::Slice(body)),
                Stmt::Match { target, cases, .. } => {
                    for c in cases.iter_mut().rev() {
                        tasks.push(NilTask::Body(&mut c.body));
                        if let Some(g) = &mut c.guard { tasks.push(NilTask::Expr(g)); }
                    }
                    tasks.push(NilTask::Expr(target));
                }
                Stmt::Try { try_body, catches, else_body, finally_body, .. } => {
                    if let Some(fb) = finally_body { tasks.push(NilTask::Slice(fb)); }
                    if let Some(eb) = else_body { tasks.push(NilTask::Slice(eb)); }
                    for cc in catches.iter_mut().rev() { tasks.push(NilTask::Slice(&mut cc.body)); }
                    tasks.push(NilTask::Slice(try_body));
                }
                _ => {}
            },
            NilTask::Expr(e) => match e {
                Expr::Assign { target, value, .. } => {
                    fix_nil_target(target);
                    tasks.push(NilTask::Expr(value));
                    tasks.push(NilTask::Expr(target));
                }
                Expr::Binary { left, right, .. } | Expr::Index { object: left, index: right, .. } => {
                    tasks.push(NilTask::Expr(right));
                    tasks.push(NilTask::Expr(left));
                }
                Expr::Unary { operand, .. } | Expr::Await(operand) | Expr::PostfixTry(operand) | Expr::Member { object: operand, .. } => {
                    tasks.push(NilTask::Expr(operand));
                }
                Expr::Call { callee, args, .. } => {
                    for a in args.iter_mut().rev() { tasks.push(NilTask::Expr(a)); }
                    tasks.push(NilTask::Expr(callee));
                }
                Expr::Array(items) | Expr::Template { exprs: items, .. } => {
                    for it in items.iter_mut().rev() { tasks.push(NilTask::Expr(it)); }
                }
                Expr::Record(entries) => {
                    for en in entries.iter_mut().rev() {
                        let (RecordEntry::Field { value, .. } | RecordEntry::Spread(value)) = en;
                        tasks.push(NilTask::Expr(value));
                    }
                }
                Expr::Conditional { cond, then_expr, else_expr } => {
                    tasks.push(NilTask::Expr(else_expr));
                    tasks.push(NilTask::Expr(then_expr));
                    tasks.push(NilTask::Expr(cond));
                }
                Expr::Closure { params, body, .. } => {
                    tasks.push(NilTask::Body(body));
                    for p in params.iter_mut().rev() {
                        if let Some(d) = &mut p.default { tasks.push(NilTask::Expr(d)); }
                    }
                }
                Expr::Match { target, cases } => {
                    for c in cases.iter_mut().rev() {
                        tasks.push(NilTask::Body(&mut c.body));
                        if let Some(g) = &mut c.guard { tasks.push(NilTask::Expr(g)); }
                    }
                    tasks.push(NilTask::Expr(target));
                }
                Expr::Comprehension { body, value, clauses, .. } => {
                    for cl in clauses.iter_mut().rev() {
                        for f in cl.filters.iter_mut().rev() { tasks.push(NilTask::Expr(f)); }
                        tasks.push(NilTask::Expr(&mut cl.iter));
                    }
                    if let Some(v) = value { tasks.push(NilTask::Expr(v)); }
                    tasks.push(NilTask::Expr(body));
                }
                _ => {}
            },
        }
    }
}

pub(crate) fn resolve_bound_nil_in_module(m: &mut AiceModule) {
    for it in &mut m.items {
        match it {
            AiceItem::Fn(f) => {
                for p in &mut f.params {
                    if let Some(d) = &mut p.default { run_nil_tasks(NilTask::Expr(d)); }
                }
                run_nil_tasks(NilTask::Body(&mut f.body));
            }
            AiceItem::Class(c) => {
                for prop in &mut c.props {
                    if let Some(init) = &mut prop.init { run_nil_tasks(NilTask::Expr(init)); }
                }
                for mth in &mut c.methods {
                    for p in &mut mth.params {
                        if let Some(d) = &mut p.default { run_nil_tasks(NilTask::Expr(d)); }
                    }
                    run_nil_tasks(NilTask::Body(&mut mth.body));
                }
                for sb in &mut c.static_blocks { run_nil_tasks(NilTask::Slice(sb)); }
            }
            AiceItem::Var(v) => run_nil_tasks(NilTask::Expr(&mut v.value)),
            AiceItem::Const(c) => run_nil_tasks(NilTask::Expr(&mut c.value)),
            AiceItem::Component(comp) => run_nil_tasks(NilTask::Slice(&mut comp.body_stmts)),
            _ => {}
        }
    }
}

pub(crate) fn is_multi_walrus_ahead(p: &Parser<'_>) -> bool {
    if !Parser::is_binding_tok(p.peek()) || p.peek_n(1).kind != TokenKind::Comma { return false; }
    let (mut idx, mut count) = (p.pos, 0usize);
    while let Some(tok) = p.tokens.get(idx) {
        if !Parser::is_binding_tok(tok) { return false; }
        count += 1; idx += 1;
        if p.tokens.get(idx).is_some_and(|t| t.kind == TokenKind::Comma) { idx += 1; } else { break; }
    }
    count >= 2 && p.tokens.get(idx).is_some_and(|t| matches!(t.kind, TokenKind::ColonEqual | TokenKind::ColonColonEqual))
}

fn is_valid_lhs_target(tokens: &[Token]) -> bool {
    if tokens.is_empty() { return false; }
    let mut i = usize::from(matches!(tokens[0].kind, TokenKind::Star | TokenKind::At | TokenKind::Dollar));
    if i >= tokens.len() { return false; }
    if matches!(tokens[i].kind, TokenKind::LParen | TokenKind::LBracket) {
        let (open, close) = if tokens[i].kind == TokenKind::LParen { (TokenKind::LParen, TokenKind::RParen) } else { (TokenKind::LBracket, TokenKind::RBracket) };
        let mut depth = 1usize; i += 1;
        while i < tokens.len() && depth > 0 {
            if tokens[i].kind == open { depth += 1; } else if tokens[i].kind == close { depth -= 1; }
            i += 1;
        }
        if depth != 0 { return false; }
    } else if Parser::is_binding_tok(&tokens[i]) {
        i += 1;
    } else { return false; }
    while i < tokens.len() {
        if tokens[i].kind == TokenKind::Dot {
            i += 1;
            if !tokens.get(i).is_some_and(Parser::is_binding_tok) { return false; }
            i += 1;
        } else if tokens[i].kind == TokenKind::LBracket {
            let mut depth = 1usize; i += 1;
            while i < tokens.len() && depth > 0 {
                if tokens[i].kind == TokenKind::LBracket { depth += 1; } else if tokens[i].kind == TokenKind::RBracket { depth -= 1; }
                i += 1;
            }
            if depth != 0 { return false; }
        } else { return false; }
    }
    true
}

pub(crate) fn find_multi_assign_eq(p: &Parser<'_>) -> Option<usize> {
    let (mut idx, mut depth, mut seg_start, mut seg_count, mut has_comma) = (p.pos, 0usize, p.pos, 0usize, false);
    while idx < p.tokens.len() {
        match p.tokens[idx].kind {
            TokenKind::LParen | TokenKind::LBracket | TokenKind::LBrace => depth += 1,
            TokenKind::RParen | TokenKind::RBracket | TokenKind::RBrace => { if depth == 0 { return None; } depth -= 1; }
            TokenKind::Comma if depth == 0 => {
                if !is_valid_lhs_target(&p.tokens[seg_start..idx]) { return None; }
                seg_count += 1; has_comma = true; seg_start = idx + 1;
            }
            TokenKind::Equal if depth == 0 => {
                if !has_comma { return None; }
                if seg_start < idx {
                    if !is_valid_lhs_target(&p.tokens[seg_start..idx]) { return None; }
                    seg_count += 1;
                }
                return (seg_count >= 1).then_some(idx);
            }
            TokenKind::Newline | TokenKind::Semicolon | TokenKind::Eof | TokenKind::Dedent | TokenKind::Indent
            | TokenKind::Colon | TokenKind::FatArrow | TokenKind::ColonEqual | TokenKind::ColonColonEqual if depth == 0 => return None,
            _ => {}
        }
        idx += 1;
    }
    None
}

pub(crate) fn is_var_decl_stmt_ahead(p: &Parser<'_>) -> bool {
    if p.peek_kind() != TokenKind::Ident || p.peek().lexeme != "var" { return false; }
    let t1 = p.peek_n(1);
    if !Parser::is_binding_tok(t1) || t1.lexeme == "is"
        || matches!(t1.kind, TokenKind::In | TokenKind::And | TokenKind::Or | TokenKind::Instanceof | TokenKind::As)
    { return false; }
    !matches!(p.peek_n(2).kind, TokenKind::Newline | TokenKind::Semicolon | TokenKind::Comment | TokenKind::Dedent | TokenKind::RBrace | TokenKind::Eof | TokenKind::Colon)
}

pub(crate) fn consume_raw_stmt_line(p: &mut Parser<'_>) -> String {
    let start = p.peek().span.start_byte;
    let (mut end, mut depth) = (start, 0usize);
    while !p.at_eof() {
        match p.peek_kind() {
            TokenKind::Newline | TokenKind::Semicolon | TokenKind::Comment | TokenKind::Dedent | TokenKind::RBrace | TokenKind::Eof if depth == 0 => break,
            TokenKind::LParen | TokenKind::LBracket | TokenKind::LBrace => { depth += 1; end = p.advance().span.end_byte; }
            TokenKind::RParen | TokenKind::RBracket | TokenKind::RBrace => { depth = depth.saturating_sub(1); end = p.advance().span.end_byte; }
            _ => { let tok = p.advance(); if tok.span.end_byte > tok.span.start_byte { end = tok.span.end_byte; } }
        }
    }
    p.src.get(start..end).unwrap_or("").trim().to_string()
}
