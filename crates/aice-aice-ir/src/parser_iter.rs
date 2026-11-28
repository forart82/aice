use crate::ir::{TranspileError, Trivia};
use crate::ir_code::{
    AssignOp, BinaryOp, CatchClause, CompClause, CompKind, Expr, MatchCase, Pattern, RecordEntry, Stmt,
};
use crate::ir_types::{AiceType, ParamDecl};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_iter_comp::step_comp_cont;
use crate::parser_iter_expr::step_expr_cont;
use crate::parser_iter_pat::step_pat_cont;
use crate::parser_iter_stmt::step_stmt_cont;
use crate::parser_new::step_new_cont;

pub(crate) enum ParseVal {
    Expr(Expr),
    Stmt(Box<Stmt>),
    Block(Vec<Stmt>),
    Pat(Pattern),
}

pub(crate) enum ParseCont {
    // Expressions
    Expr(u8),
    ExprInfix(u8),
    ExprUnary { op: crate::ir_code::UnaryOp },
    ExprDblRef { inner_op: crate::ir_code::UnaryOp },
    ExprAwait,
    ExprParenClose,
    ExprWalrusClose { name: String, rhs_start: usize },
    ExprCallArg { callee: Expr, args: Vec<Expr>, is_optional: bool, is_new: bool },
    ExprNewArrayRankCont,
    ExprNewArrayInit { callee: Expr, items: Vec<Expr> },
    ExprNewObjInit { callee: Expr, args: Vec<Expr>, has_parens: bool },
    ExprTaggedTemplate { callee: Expr },
    ExprIndex { object: Expr, args: Vec<Expr>, is_optional: bool },
    ExprTernaryThen { cond: Expr, next_prec: u8 },
    ExprTernaryElse { cond: Expr, then_expr: Expr },
    ExprAssign { target: Expr, op: AssignOp },
    ExprBinary { left: Expr, op: BinaryOp },
    ExprTemplate { quasis: Vec<String>, exprs: Vec<Expr> },
    ExprArray(Vec<Expr>),
    ExprRecord { entries: Vec<RecordEntry>, key: Option<String>, is_spread: bool },
    ExprClosureParamDefault { is_async: bool, params: Vec<ParamDecl>, cur: ParamDecl },
    ExprClosureFinish { is_async: bool, params: Vec<ParamDecl>, ret: Option<AiceType>, is_block: bool },
    ExprMatchWrap,
    ExprBraceCompKey,
    ExprBraceCompVal { key: Expr },
    ExprCompIter {
        kind: CompKind,
        body: Expr,
        value: Option<Expr>,
        clauses: Vec<CompClause>,
        is_async: bool,
        target: String,
        wrap_call: Option<(Expr, bool, bool)>,
    },
    ExprCompFilter {
        kind: CompKind,
        body: Expr,
        value: Option<Expr>,
        clauses: Vec<CompClause>,
        wrap_call: Option<(Expr, bool, bool)>,
    },

    // Statements & Blocks
    IndentedBlock(Vec<Stmt>),
    CurlyBlock(Vec<Stmt>),
    InlineSingleBlock,
    BlockPushStmt { is_curly: bool, stmts: Vec<Stmt>, tr: Trivia },
    StmtParse,
    StmtRet,
    StmtThrow,
    StmtThrowCause { expr: Expr },
    StmtLet { name: String, is_mut: bool, ty: Option<AiceType>, rhs_start: usize, is_comma: bool },
    StmtDestructure { names: Vec<String>, is_mut: bool },
    StmtExprOrAssign,
    StmtAssignRhs { target: Expr, op: AssignOp, rhs_start: usize, is_comma: bool },
    StmtWhileAfterCond,
    StmtWhileFinish { cond: Expr, trailing: Option<String> },
    StmtLoopFinish { trailing: Option<String> },
    StmtForAfterIter { binding: String },
    StmtForFinish { binding: String, iter: Expr, trailing: Option<String> },
    StmtIfAfterCond,
    StmtIfLoop {
        cond: Expr, then_body: Option<Vec<Stmt>>, elifs: Vec<(Expr, Vec<Stmt>)>,
        elif_trivias: Vec<Trivia>, trailing: Option<String>,
    },
    StmtElifAfterCond {
        cond: Expr, then_body: Vec<Stmt>, elifs: Vec<(Expr, Vec<Stmt>)>,
        elif_trivias: Vec<Trivia>, trailing: Option<String>, etr: Trivia,
    },
    StmtElifFinish {
        cond: Expr, then_body: Vec<Stmt>, elifs: Vec<(Expr, Vec<Stmt>)>,
        elif_trivias: Vec<Trivia>, trailing: Option<String>, econd: Expr, etr: Trivia,
    },
    StmtElseFinish {
        cond: Expr, then_body: Vec<Stmt>, elifs: Vec<(Expr, Vec<Stmt>)>,
        elif_trivias: Vec<Trivia>, trailing: Option<String>, else_trivia: Trivia,
    },
    StmtTryLoop {
        try_body: Option<Vec<Stmt>>, catches: Vec<CatchClause>,
        else_body: Option<Vec<Stmt>>, else_trivia: Trivia, trailing: Option<String>,
    },
    StmtCatchFinish {
        try_body: Vec<Stmt>, catches: Vec<CatchClause>,
        else_body: Option<Vec<Stmt>>, else_trivia: Trivia, trailing: Option<String>,
        param: Option<String>, ty: Option<AiceType>, ctr: Trivia,
    },
    StmtTryElseFinish {
        try_body: Vec<Stmt>, catches: Vec<CatchClause>,
        else_trivia: Trivia, trailing: Option<String>,
    },
    StmtFinallyFinish {
        try_body: Vec<Stmt>, catches: Vec<CatchClause>,
        else_body: Option<Vec<Stmt>>, else_trivia: Trivia,
        trailing: Option<String>, finally_trivia: Trivia,
    },
    StmtMatchAfterTarget,
    StmtMatchLoop { target: Expr, cases: Vec<MatchCase>, trailing: Option<String>, is_curly: bool },
    StmtMatchArmGuard {
        target: Expr, cases: Vec<MatchCase>, trailing: Option<String>, is_curly: bool, tr: Trivia,
    },
    StmtMatchArmBody {
        target: Expr, cases: Vec<MatchCase>, trailing: Option<String>, is_curly: bool,
        tr: Trivia, pattern: Pattern, has_guard: bool,
    },
    StmtMatchArmFinish {
        target: Expr, cases: Vec<MatchCase>, trailing: Option<String>, is_curly: bool,
        tr: Trivia, pattern: Pattern, guard: Option<Expr>, is_block: bool, eat_comma: bool,
    },

    // Patterns
    PatParse,
    PatSingle,
    PatOrTail(Vec<Pattern>),
    PatCtorArg { name: String, args: Vec<Pattern> },
    PatRangeEnd { start: Expr, inclusive: bool, negated: bool },
    PatRangeWrap { negs: usize },
}

pub(crate) fn run_parse_loop(p: &mut Parser<'_>, init: ParseCont) -> Result<ParseVal, TranspileError> {
    let mut stack = vec![init];
    let mut vals = Vec::new();
    while let Some(cont) = stack.pop() {
        match cont {
            ParseCont::Expr(_) | ParseCont::ExprInfix(_) | ParseCont::ExprUnary { .. }
            | ParseCont::ExprDblRef { .. } | ParseCont::ExprAwait | ParseCont::ExprParenClose | ParseCont::ExprWalrusClose { .. }
            | ParseCont::ExprCallArg { .. } | ParseCont::ExprTaggedTemplate { .. }
            | ParseCont::ExprIndex { .. }
            | ParseCont::ExprTernaryThen { .. } | ParseCont::ExprTernaryElse { .. }
            | ParseCont::ExprAssign { .. } | ParseCont::ExprBinary { .. }
            | ParseCont::ExprTemplate { .. } | ParseCont::ExprArray(_)
            | ParseCont::ExprRecord { .. } | ParseCont::ExprClosureParamDefault { .. }
            | ParseCont::ExprClosureFinish { .. } | ParseCont::ExprMatchWrap => {
                step_expr_cont(p, cont, &mut stack, &mut vals)?;
            }
            ParseCont::ExprNewArrayRankCont
            | ParseCont::ExprNewArrayInit { .. }
            | ParseCont::ExprNewObjInit { .. } => {
                step_new_cont(p, cont, &mut stack, &mut vals)?;
            }
            ParseCont::ExprBraceCompKey
            | ParseCont::ExprBraceCompVal { .. }
            | ParseCont::ExprCompIter { .. }
            | ParseCont::ExprCompFilter { .. } => {
                step_comp_cont(p, cont, &mut stack, &mut vals)?;
            }
            ParseCont::PatParse | ParseCont::PatSingle | ParseCont::PatOrTail(_)
            | ParseCont::PatCtorArg { .. } | ParseCont::PatRangeEnd { .. }
            | ParseCont::PatRangeWrap { .. } => {
                step_pat_cont(p, cont, &mut stack, &mut vals)?;
            }
            _ => {
                step_stmt_cont(p, cont, &mut stack, &mut vals)?;
            }
        }
    }
    Ok(vals.pop().expect("parse result"))
}

fn find_init_cond_end(p: &Parser<'_>, start_idx: usize) -> Option<(usize, usize)> {
    let (mut idx, mut depth, mut has_semi) = (start_idx, 0usize, false);
    while idx < p.tokens.len() {
        match p.tokens[idx].kind {
            TokenKind::LParen | TokenKind::LBracket | TokenKind::LBrace => depth += 1,
            TokenKind::RParen | TokenKind::RBracket | TokenKind::RBrace => { if depth == 0 { break; } depth -= 1; }
            TokenKind::Semicolon if depth == 0 => has_semi = true,
            TokenKind::Colon if depth == 0 => { if has_semi && idx > start_idx { return Some((idx - 1, idx)); } break; }
            TokenKind::Newline | TokenKind::Eof | TokenKind::Dedent | TokenKind::Indent if depth == 0 => break,
            _ => {}
        }
        idx += 1;
    }
    if p.tokens.get(start_idx).is_some_and(|t| t.kind == TokenKind::LParen) {
        let (mut i, mut d) = (start_idx + 1, 1usize);
        while i < p.tokens.len() && d > 0 {
            match p.tokens[i].kind {
                TokenKind::LParen => d += 1,
                TokenKind::RParen => d -= 1,
                TokenKind::Eof => return None,
                _ => {}
            }
            i += 1;
        }
        let close_idx = i.checked_sub(1)?;
        if d == 0 && p.tokens.get(close_idx + 1).is_some_and(|t| t.kind == TokenKind::Colon) {
            let inner = &p.tokens[start_idx + 1..close_idx];
            let (mut id, mut eq_i) = (0usize, None);
            for (k, tok) in inner.iter().enumerate() {
                match tok.kind {
                    TokenKind::LParen | TokenKind::LBracket | TokenKind::LBrace => id += 1,
                    TokenKind::RParen | TokenKind::RBracket | TokenKind::RBrace => id = id.saturating_sub(1),
                    TokenKind::Semicolon if id == 0 => return Some((close_idx, close_idx + 1)),
                    TokenKind::Equal if id == 0 && eq_i.is_none() => eq_i = Some(k),
                    _ => {}
                }
            }
            if let Some(eq) = eq_i && eq >= 2
                && matches!(inner[0].kind, TokenKind::Ident | TokenKind::Const)
                && Parser::is_binding_tok(&inner[eq - 1])
                && inner[..eq - 1].iter().all(|t| !matches!(t.kind, TokenKind::Dot | TokenKind::LParen | TokenKind::Plus | TokenKind::Minus | TokenKind::Slash | TokenKind::Percent | TokenKind::EqEq | TokenKind::NotEq | TokenKind::LtEq | TokenKind::GtEq | TokenKind::PipePipe | TokenKind::Question))
            { return Some((close_idx, close_idx + 1)); }
        }
    }
    None
}

pub(crate) fn try_parse_init_cond(p: &mut Parser<'_>) -> Option<Expr> {
    let (end_tok, colon_idx) = find_init_cond_end(p, p.pos)?;
    let s = p.src.get(p.tokens[p.pos].span.start_byte..p.tokens[end_tok].span.end_byte).unwrap_or("").trim().to_string();
    p.pos = colon_idx;
    Some(Expr::Ident(s))
}

pub(crate) fn is_match_init_ahead(p: &Parser<'_>) -> bool {
    if p.peek_kind() != TokenKind::Match { return false; }
    let Some((_, colon_idx)) = find_init_cond_end(p, p.pos + 1) else { return false; };
    let mut k = colon_idx + 1;
    while p.tokens.get(k).is_some_and(|t| matches!(t.kind, TokenKind::Comment | TokenKind::Newline | TokenKind::Semicolon)) { k += 1; }
    p.tokens.get(k).is_some_and(|t| matches!(t.kind, TokenKind::Indent | TokenKind::LBrace))
        || p.tokens.get(colon_idx + 1).is_some_and(|t| matches!(t.kind, TokenKind::Newline | TokenKind::Comment | TokenKind::Eof))
}

pub(crate) fn parse_for_binding(p: &mut Parser<'_>) -> Result<String, TranspileError> {
    if p.peek_kind() == TokenKind::LParen {
        let saved = p.pos;
        let start = p.advance().span.start_byte;
        let (mut parts, mut simple) = (Vec::new(), true);
        while p.peek_kind() != TokenKind::RParen && !p.at_eof() {
            if Parser::is_binding_tok(p.peek()) {
                parts.push(p.advance().lexeme);
                if !p.eat(TokenKind::Comma) { break; }
            } else { simple = false; break; }
        }
        if simple && p.eat(TokenKind::RParen) { return Ok(format!("({})", parts.join(", "))); }
        p.pos = saved + 1;
        let (mut depth, mut end) = (1usize, start + 1);
        while !p.at_eof() && depth > 0 {
            let tok = p.advance();
            if tok.kind == TokenKind::LParen { depth += 1; } else if tok.kind == TokenKind::RParen { depth -= 1; end = tok.span.end_byte; }
        }
        return Ok(p.src.get(start..end).unwrap_or("()").trim().to_string());
    }
    let (mut idx, mut depth, mut has_bracket) = (p.pos, 0usize, false);
    while idx < p.tokens.len() {
        match p.tokens[idx].kind {
            TokenKind::LBracket => { has_bracket = true; depth += 1; }
            TokenKind::LParen | TokenKind::LBrace => depth += 1,
            TokenKind::RBracket | TokenKind::RParen | TokenKind::RBrace => { if depth == 0 { break; } depth -= 1; }
            TokenKind::In if depth == 0 && has_bracket && idx > p.pos => {
                let s = p.src.get(p.tokens[p.pos].span.start_byte..p.tokens[idx - 1].span.end_byte).unwrap_or("item").trim().to_string();
                p.pos = idx;
                return Ok(s);
            }
            TokenKind::Newline | TokenKind::Colon | TokenKind::Eof if depth == 0 => break,
            _ => {}
        }
        idx += 1;
    }
    Ok(p.expect_ident_or_kw("Expected loop binding")?.lexeme)
}
