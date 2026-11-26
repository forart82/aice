use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::named_children;
use crate::decompile::iter_expr::{ExprFin, push_expr_task};
use crate::decompile::iter_expr_fin::finish_expr_task;
use crate::decompile::iter_jsx::{JsxFin, finish_jsx_task, finish_layout_to_expr, push_jsx_node};
use crate::decompile::iter_match::push_match_arms;
use crate::decompile::iter_stmt::{StmtFin, push_block_task, push_stmt_task};
use crate::decompile::iter_stmt_fin::finish_stmt_task;
use crate::decompile::trivia::is_comment_kind;
use crate::ir::{TranspileOpts, Trivia};
use crate::ir_code::{CatchClause, Expr, FnBody, MatchCase, RecordEntry, Stmt};
use crate::ir_domain::LayoutNode;

pub(crate) enum DTask<'a> {
    Block(Node<'a>),
    Stmt(Node<'a>),
    AttachTrivia(Trivia),
    FinishBlock(usize),
    FinishStmt(StmtFin),
    Expr(Node<'a>),
    FinishExpr(ExprFin),
    JsxNode(Node<'a>),
    FinishJsx(JsxFin),
    LayoutToExpr(LayoutNode, bool),
    FinishLayoutToExpr { eff_tag: String, rec_entries: Vec<RecordEntry>, len: usize },
    StartMatchArms { node: Node<'a>, is_expr: bool, hdr_tr: Option<String> },
    FinishFnBodyFromBlock { single_expr_collapse: bool },
    FinishFnBodyFromExpr,
}

pub(crate) struct DecompEnv<'a> {
    pub src: &'a str,
    pub lang: LanguageId,
    pub opts: &'a TranspileOpts,
    pub tasks: Vec<DTask<'a>>,
    pub stmts: Vec<Stmt>,
    pub exprs: Vec<Expr>,
    pub layouts: Vec<LayoutNode>,
    pub catches: Vec<CatchClause>,
    pub cases: Vec<MatchCase>,
    pub blocks: Vec<Vec<Stmt>>,
    pub bodies: Vec<FnBody>,
    pub match_targets: Vec<Expr>,
}

impl<'a> DecompEnv<'a> {
    pub fn new(src: &'a str, lang: LanguageId, opts: &'a TranspileOpts) -> Self {
        Self {
            src,
            lang,
            opts,
            tasks: Vec::new(),
            stmts: Vec::new(),
            exprs: Vec::new(),
            layouts: Vec::new(),
            catches: Vec::new(),
            cases: Vec::new(),
            blocks: Vec::new(),
            bodies: Vec::new(),
            match_targets: Vec::new(),
        }
    }

    pub fn run(&mut self) {
        while let Some(task) = self.tasks.pop() {
            match task {
                DTask::Block(n) => push_block_task(self, n),
                DTask::Stmt(n) => push_stmt_task(self, n),
                DTask::AttachTrivia(tr) => {
                    if let Some(last) = self.stmts.last_mut() {
                        attach_tr(last, tr);
                    }
                }
                DTask::FinishBlock(base) => {
                    let blk = self.stmts.split_off(base);
                    self.blocks.push(blk);
                }
                DTask::FinishStmt(f) => finish_stmt_task(self, f),
                DTask::Expr(n) => push_expr_task(self, n),
                DTask::FinishExpr(f) => finish_expr_task(self, f),
                DTask::JsxNode(n) => push_jsx_node(self, n),
                DTask::FinishJsx(f) => finish_jsx_task(self, f),
                DTask::LayoutToExpr(ln, force) => finish_layout_to_expr(self, ln, force),
                DTask::FinishLayoutToExpr { eff_tag, rec_entries, len } => {
                    let mut args = vec![
                        Expr::Literal(crate::ir_expr::LiteralVal::Str { value: eff_tag, multiline: false }),
                        Expr::Record(rec_entries),
                    ];
                    args.extend(self.exprs.split_off(self.exprs.len() - len));
                    self.exprs.push(Expr::Call {
                        callee: Box::new(Expr::Ident("__jsx".into())),
                        args,
                        is_optional: false,
                        is_tagged: false,
                        is_new: false,
                    });
                }
                DTask::StartMatchArms { node, is_expr, hdr_tr } => {
                    push_match_arms(self, node, is_expr, hdr_tr);
                }
                DTask::FinishFnBodyFromBlock { single_expr_collapse } => {
                    let stmts = self.blocks.pop().expect("fn body blk");
                    let b = if single_expr_collapse {
                        crate::decompile::match_cf::stmts_to_arm_body(stmts)
                    } else {
                        FnBody::Block(stmts)
                    };
                    self.bodies.push(b);
                }
                DTask::FinishFnBodyFromExpr => {
                    let e = self.exprs.pop().expect("fn body expr");
                    self.bodies.push(FnBody::Expr(e));
                }
            }
        }
    }
}

pub(crate) fn flatten_block_children<'a>(root: Node<'a>) -> Vec<Node<'a>> {
    let mut stack: Vec<Node<'a>> = named_children(root)
        .into_iter()
        .rev()
        .filter(|c| !is_comment_kind(c.kind()))
        .collect();
    let mut out = Vec::new();
    while let Some(n) = stack.pop() {
        if matches!(n.kind(), "statement_list" | "statements" | "body_statement" | "then") {
            for ch in named_children(n).into_iter().rev() {
                if !is_comment_kind(ch.kind()) {
                    stack.push(ch);
                }
            }
        } else {
            out.push(n);
        }
    }
    out
}

pub(crate) fn attach_tr(st: &mut Stmt, mut tr: Trivia) {
    match st {
        Stmt::Let { trivia, .. } | Stmt::Destructure { trivia, .. } | Stmt::Assign { trivia, .. }
        | Stmt::Return { trivia, .. } | Stmt::Expr { trivia, .. } | Stmt::If { trivia, .. }
        | Stmt::Match { trivia, .. } | Stmt::For { trivia, .. } | Stmt::While { trivia, .. }
        | Stmt::Loop { trivia, .. } | Stmt::Try { trivia, .. } | Stmt::Throw { trivia, .. }
        | Stmt::Break { trivia, .. } | Stmt::Continue { trivia, .. } => {
            if tr.trailing.is_none() {
                tr.trailing = trivia.trailing.take();
            }
            *trivia = tr;
        }
        Stmt::Pass | Stmt::Comment(_) => {}
    }
}
