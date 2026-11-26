use crate::ir::{TranspileError, Trivia};
use crate::ir_code::{AssignOp, BinaryOp, CatchClause, Expr, MatchCase, MemberKind, Pattern, RecordEntry, Stmt};
use crate::ir_types::{AiceType, ParamDecl};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_iter_expr::{pop_expr, step_expr_cont};
use crate::parser_iter_pat::step_pat_cont;
use crate::parser_iter_stmt::step_stmt_cont;

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
    ExprCallArg { callee: Expr, args: Vec<Expr>, is_optional: bool, is_new: bool },
    ExprNewArrayRankCont,
    ExprNewArrayInit { callee: Expr, items: Vec<Expr> },
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

    // Statements & Blocks
    IndentedBlock(Vec<Stmt>),
    CurlyBlock(Vec<Stmt>),
    InlineSingleBlock,
    BlockPushStmt { is_curly: bool, stmts: Vec<Stmt>, tr: Trivia },
    StmtParse,
    StmtRet,
    StmtThrow,
    StmtThrowCause { expr: Expr },
    StmtLet { name: String, is_mut: bool, ty: Option<AiceType> },
    StmtDestructure { names: Vec<String>, is_mut: bool },
    StmtExprOrAssign,
    StmtAssignRhs { target: Expr, op: AssignOp },
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
            | ParseCont::ExprDblRef { .. } | ParseCont::ExprAwait | ParseCont::ExprParenClose
            | ParseCont::ExprCallArg { .. } | ParseCont::ExprTaggedTemplate { .. }
            | ParseCont::ExprIndex { .. }
            | ParseCont::ExprTernaryThen { .. } | ParseCont::ExprTernaryElse { .. }
            | ParseCont::ExprAssign { .. } | ParseCont::ExprBinary { .. }
            | ParseCont::ExprTemplate { .. } | ParseCont::ExprArray(_)
            | ParseCont::ExprRecord { .. } | ParseCont::ExprClosureParamDefault { .. }
            | ParseCont::ExprClosureFinish { .. } | ParseCont::ExprMatchWrap => {
                step_expr_cont(p, cont, &mut stack, &mut vals)?;
            }
            ParseCont::ExprNewArrayRankCont | ParseCont::ExprNewArrayInit { .. } => {
                step_new_array_cont(p, cont, &mut stack, &mut vals)?;
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

fn append_ctor_suffix(ctor: &mut Expr, suffix: &str) {
    match ctor {
        Expr::Ident(s) => s.push_str(suffix),
        Expr::Member { property, .. } => property.push_str(suffix),
        _ => {}
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
    if p.peek_kind() == TokenKind::LBracket {
        return step_new_array_rank(p, Expr::Ident(String::new()), stack, vals);
    }
    let mut ctor = Expr::Ident(p.advance().lexeme);
    while matches!(p.peek_kind(), TokenKind::Dot | TokenKind::ColonColon) {
        let mk = if p.advance().kind == TokenKind::ColonColon { MemberKind::Scope } else { MemberKind::Dot };
        let prop = p.expect_ident_or_kw("Expected member name")?.lexeme;
        ctor = Expr::Member { object: Box::new(ctor), property: prop, kind: mk };
    }
    if p.eat(TokenKind::Concat) {
        append_ctor_suffix(&mut ctor, "<>");
    } else if p.peek_kind() == TokenKind::Lt {
        let start = p.peek().span.start_byte;
        let (mut depth, mut end) = (0usize, start);
        while !p.at_eof() {
            let t = p.advance();
            end = t.span.end_byte;
            if t.kind == TokenKind::Lt { depth += 1; }
            else if t.kind == TokenKind::Gt {
                depth = depth.saturating_sub(1);
                if depth == 0 { break; }
            } else if t.kind == TokenKind::Shr {
                depth = depth.saturating_sub(2);
                if depth == 0 { break; }
            }
        }
        append_ctor_suffix(&mut ctor, &p.src[start..end]);
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

fn step_new_array_cont(
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
        _ => unreachable!(),
    }
}
