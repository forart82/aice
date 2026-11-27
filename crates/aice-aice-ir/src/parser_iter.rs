use crate::ir::{TranspileError, Trivia};
use crate::ir_code::{
    AssignOp, BinaryOp, CatchClause, CompClause, CompKind, Expr, MatchCase, Pattern, RecordEntry, Stmt,
};
use crate::ir_types::{AiceType, ParamDecl};
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
