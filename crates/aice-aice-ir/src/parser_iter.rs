use crate::ir::{AiceItem, AiceModule, TranspileError, Trivia};
use crate::ir_code::{AssignOp, BinaryOp, CatchClause, Expr, FnBody, LiteralVal, MatchCase, Pattern, RecordEntry, Stmt};
use crate::ir_types::{AiceType, ParamDecl};
use crate::parser::Parser;
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

fn name_binds_nil(s: &str) -> bool {
    s == "nil" || s.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_')).any(|w| w == "nil")
}

fn body_binds_nil(stmts: &[Stmt]) -> bool {
    let mut stack: Vec<&[Stmt]> = vec![stmts];
    while let Some(slice) = stack.pop() {
        for st in slice {
            match st {
                Stmt::Let { name, .. } if name_binds_nil(name) => return true,
                Stmt::Destructure { names, .. } if names.iter().any(|n| name_binds_nil(n)) => return true,
                Stmt::Assign { target: Expr::Ident(n), .. } if n == "nil" => return true,
                Stmt::For { binding, body, .. } => { if name_binds_nil(binding) { return true; } stack.push(body); }
                Stmt::If { then_body, elifs, else_body, .. } => {
                    stack.push(then_body);
                    for (_, b) in elifs { stack.push(b); }
                    if let Some(eb) = else_body { stack.push(eb); }
                }
                Stmt::While { body, .. } | Stmt::Loop { body, .. } => stack.push(body),
                Stmt::Match { cases, .. } => {
                    for c in cases { if let FnBody::Block(b) = &c.body { stack.push(b); } }
                }
                Stmt::Try { try_body, catches, else_body, finally_body, .. } => {
                    stack.push(try_body);
                    for cc in catches {
                        if cc.param.as_deref().is_some_and(name_binds_nil) { return true; }
                        stack.push(&cc.body);
                    }
                    if let Some(eb) = else_body { stack.push(eb); }
                    if let Some(fb) = finally_body { stack.push(fb); }
                }
                _ => {}
            }
        }
    }
    false
}

fn rewrite_nil_in_body(body: &mut FnBody) {
    match body {
        FnBody::SignatureOnly => {}
        FnBody::Expr(e) => rewrite_nil_exprs(vec![e]),
        FnBody::Block(stmts) => rewrite_nil_stmts(stmts),
    }
}

fn rewrite_nil_stmts(stmts: &mut [Stmt]) {
    let (mut s_stack, mut e_stack): (Vec<&mut Stmt>, Vec<&mut Expr>) = (stmts.iter_mut().collect(), Vec::new());
    while let Some(st) = s_stack.pop() {
        match st {
            Stmt::Let { init, .. } | Stmt::Destructure { init, .. } | Stmt::Expr { expr: init, .. } => e_stack.push(init),
            Stmt::Assign { target, value, .. } => { e_stack.push(target); e_stack.push(value); }
            Stmt::Return { value: Some(v), .. } => e_stack.push(v),
            Stmt::Throw { expr, cause, .. } => { e_stack.push(expr); if let Some(c) = cause { e_stack.push(c); } }
            Stmt::If { cond, then_body, elifs, else_body, .. } => {
                e_stack.push(cond); s_stack.extend(then_body.iter_mut());
                for (ec, eb) in elifs { e_stack.push(ec); s_stack.extend(eb.iter_mut()); }
                if let Some(eb) = else_body { s_stack.extend(eb.iter_mut()); }
            }
            Stmt::While { cond, body, .. } | Stmt::For { iter: cond, body, .. } => { e_stack.push(cond); s_stack.extend(body.iter_mut()); }
            Stmt::Loop { body, .. } => s_stack.extend(body.iter_mut()),
            Stmt::Match { target, cases, .. } => {
                e_stack.push(target);
                for c in cases {
                    if let Some(g) = &mut c.guard { e_stack.push(g); }
                    match &mut c.body { FnBody::Expr(e) => e_stack.push(e), FnBody::Block(b) => s_stack.extend(b.iter_mut()), FnBody::SignatureOnly => {} }
                }
            }
            Stmt::Try { try_body, catches, else_body, finally_body, .. } => {
                s_stack.extend(try_body.iter_mut());
                for cc in catches { s_stack.extend(cc.body.iter_mut()); }
                if let Some(eb) = else_body { s_stack.extend(eb.iter_mut()); }
                if let Some(fb) = finally_body { s_stack.extend(fb.iter_mut()); }
            }
            _ => {}
        }
    }
    rewrite_nil_exprs(e_stack);
}

fn rewrite_nil_exprs(mut stack: Vec<&mut Expr>) {
    while let Some(e) = stack.pop() {
        match e {
            Expr::Literal(LiteralVal::Nil) => *e = Expr::Ident("nil".into()),
            Expr::Binary { left, right, .. } | Expr::Assign { target: left, value: right, .. } | Expr::Index { object: left, index: right, .. } => {
                stack.push(left); stack.push(right);
            }
            Expr::Unary { operand, .. } | Expr::Await(operand) | Expr::PostfixTry(operand) | Expr::Member { object: operand, .. } => stack.push(operand),
            Expr::Call { callee, args, .. } => { stack.push(callee); stack.extend(args.iter_mut()); }
            Expr::Array(items) | Expr::Template { exprs: items, .. } => stack.extend(items.iter_mut()),
            Expr::Record(entries) => {
                for en in entries {
                    let (RecordEntry::Field { value, .. } | RecordEntry::Spread(value)) = en;
                    stack.push(value);
                }
            }
            Expr::Conditional { cond, then_expr, else_expr } => { stack.push(cond); stack.push(then_expr); stack.push(else_expr); }
            Expr::Closure { body, .. } => rewrite_nil_in_body(body),
            Expr::Match { target, cases } => {
                stack.push(target);
                for c in cases { if let Some(g) = &mut c.guard { stack.push(g); } rewrite_nil_in_body(&mut c.body); }
            }
            _ => {}
        }
    }
}

pub(crate) fn resolve_bound_nil_in_module(m: &mut AiceModule) {
    let mod_binds_nil = m.items.iter().any(|it| match it {
        AiceItem::Var(v) => v.name == "nil", AiceItem::Const(c) => c.name == "nil", AiceItem::Fn(f) => f.name == "nil", _ => false,
    });
    for it in &mut m.items {
        match it {
            AiceItem::Fn(f) if mod_binds_nil || f.params.iter().any(|p| p.name == "nil") || matches!(&f.body, FnBody::Block(s) if body_binds_nil(s)) => {
                rewrite_nil_in_body(&mut f.body);
            }
            AiceItem::Class(c) => {
                for mth in &mut c.methods {
                    if mod_binds_nil || mth.params.iter().any(|p| p.name == "nil") || matches!(&mth.body, FnBody::Block(s) if body_binds_nil(s)) {
                        rewrite_nil_in_body(&mut mth.body);
                    }
                }
                for sb in &mut c.static_blocks { if mod_binds_nil || body_binds_nil(sb) { rewrite_nil_stmts(sb); } }
            }
            AiceItem::Var(v) if mod_binds_nil => rewrite_nil_exprs(vec![&mut v.value]),
            AiceItem::Const(c) if mod_binds_nil => rewrite_nil_exprs(vec![&mut c.value]),
            AiceItem::Component(comp) if mod_binds_nil || comp.params.iter().any(|p| p.name == "nil") || body_binds_nil(&comp.body_stmts) => {
                rewrite_nil_stmts(&mut comp.body_stmts);
            }
            _ => {}
        }
    }
}
