use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{field_text, named_children, node_text};
use crate::decompile::iter_env::{DTask, DecompEnv};
use crate::decompile::iter_match::{push_match_task, push_select_task};
use crate::decompile::iter_stmt_cf::{push_if_task, push_ruby_begin, push_try_task};
use crate::decompile::iter_stmt_fin::push_for_stmt;
use crate::decompile::op_map::find_assign_parts;
use crate::decompile::stmt_common::find_body_node;
use crate::decompile::stmt_for::{extract_c_for_parts, is_single_stmt_node};
use crate::decompile::stmt_vars::find_var_decls;
use crate::decompile::trivia::{collect_header_trailing, collect_trivia};
use crate::ir::Trivia;
use crate::ir_code::{AssignOp, Expr, Pattern, Stmt};
use crate::ir_expr::LiteralVal;
use crate::ir_types::AiceType;

pub(crate) enum StmtFin {
    ForClause { has_cond: bool, has_body: bool, upd_count: usize, is_loop: bool, trivia: Trivia },
    Return(bool),
    ReturnRecord(usize),
    Throw,
    ExprStmt,
    Unless { has_else: bool },
    Modifier { is_unless: bool },
    While { has_body: bool, trivia: Trivia },
    Loop { has_body: bool, trivia: Trivia },
    For { binding: String, has_body: bool, has_iter: bool, fallback_iter: String, trivia: Trivia },
    VarDecl { name: String, is_mut: bool, ty: Option<AiceType>, has_init: bool },
    Assign { op: AssignOp },
    If {
        elif_count: usize,
        has_else: bool,
        elif_trivias: Vec<Trivia>,
        else_trivia: Trivia,
        trivia: Trivia,
        has_thens: Vec<bool>,
        has_else_body: bool,
    },
    Try { catch_len: usize, has_finally: bool, finally_trivia: Trivia, trivia: Trivia },
    Catch { param: Option<String>, ty: Option<AiceType>, has_body: bool, trivia: Trivia },
    Match { is_expr: bool, case_len: usize, hdr_tr: Option<String> },
    MatchArm { pat: Pattern, has_guard: bool, trivia: Trivia },
    KotlinArm { is_subjectless: bool, cond_pats: Vec<Result<Pattern, usize>>, trivia: Trivia },
}

pub(crate) fn push_block_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>) {
    let base = env.stmts.len();
    env.tasks.push(DTask::FinishBlock(base));
    let kids = if node.kind() == "empty_statement" {
        Vec::new()
    } else if is_single_stmt_node(node.kind()) {
        vec![node]
    } else {
        crate::decompile::iter_env::flatten_block_children(node)
    };
    push_stmt_nodes(env, kids);
}

pub(crate) fn push_stmt_nodes<'a>(env: &mut DecompEnv<'a>, kids: Vec<Node<'a>>) {
    for ch in kids.into_iter().rev() {
        let bn = if ch.kind() == "for_statement" { find_body_node(ch) } else { None };
        if ch.kind() == "for_statement"
            && let Some(parts) = extract_c_for_parts(ch, env.lang, bn)
        {
            let mut tr = collect_trivia(ch, env.src, env.opts);
            if tr.trailing.is_none() {
                tr.trailing = bn.and_then(|b| collect_header_trailing(b, env.src, env.opts));
            }
            let has_cond = !parts.is_loop && parts.cond.is_some();
            env.tasks.push(DTask::FinishStmt(StmtFin::ForClause {
                has_cond,
                has_body: bn.is_some(),
                upd_count: parts.upds.len(),
                is_loop: parts.is_loop,
                trivia: tr,
            }));
            for u in parts.upds.into_iter().rev() {
                env.tasks.push(DTask::Stmt(u));
            }
            if let Some(b) = bn {
                env.tasks.push(DTask::Block(b));
            }
            if has_cond && let Some(c) = parts.cond {
                env.tasks.push(DTask::Expr(c));
            }
            for i in parts.inits.into_iter().rev() {
                env.tasks.push(DTask::Stmt(i));
            }
        } else {
            env.tasks.push(DTask::AttachTrivia(collect_trivia(ch, env.src, env.opts)));
            env.tasks.push(DTask::Stmt(ch));
        }
    }
}

pub(crate) fn push_stmt_task<'a>(env: &mut DecompEnv<'a>, mut node: Node<'a>) {
    while node.kind() == "statement" {
        if let Some(ch) = named_children(node).into_iter().next() { node = ch; }
        else { env.stmts.push(Stmt::Pass); return; }
    }
    if node.kind() == "expression_statement" {
        if let Some(ch) = named_children(node).into_iter().next() {
            if matches!(
                ch.kind(),
                "return_expression" | "if_expression" | "for_expression" | "while_expression"
                    | "match_expression" | "loop_expression" | "break_expression" | "continue_expression"
                    | "throw_expression"
                    | "assignment_expression" | "augmented_assignment_expression"
                    | "compound_assignment_expr" | "augmented_assignment"
                    | "assignment" | "assignment_statement" | "operator_assignment"
            ) {
                node = ch;
            } else {
                env.tasks.push(DTask::FinishStmt(StmtFin::ExprStmt));
                env.tasks.push(DTask::Expr(ch));
                return;
            }
        } else {
            env.stmts.push(Stmt::Pass);
            return;
        }
    }
    match node.kind() {
        "jump_expression" => {
            let raw = node_text(node, env.src).trim_start();
            let first = named_children(node).into_iter().next();
            if raw.starts_with("return") {
                env.tasks.push(DTask::FinishStmt(StmtFin::Return(first.is_some())));
                if let Some(c) = first { env.tasks.push(DTask::Expr(c)); }
            } else if raw.starts_with("throw") {
                if let Some(c) = first {
                    env.tasks.push(DTask::FinishStmt(StmtFin::Throw));
                    env.tasks.push(DTask::Expr(c));
                } else {
                    env.stmts.push(Stmt::Throw { expr: Expr::Ident("err".into()), trivia: Trivia::default() });
                }
            } else if raw.starts_with("break") {
                env.stmts.push(Stmt::Break { label: None, trivia: Trivia::default() });
            } else if raw.starts_with("continue") {
                env.stmts.push(Stmt::Continue { label: None, trivia: Trivia::default() });
            } else {
                env.tasks.push(DTask::FinishStmt(StmtFin::ExprStmt));
                env.tasks.push(DTask::Expr(node));
            }
        }
        "return_statement" | "return_expression" | "return" => {
            let first = named_children(node).into_iter().next();
            match first {
                Some(c) if matches!(c.kind(), "expression_list" | "argument_list") => {
                    let items = named_children(c);
                    if items.len() == 1 {
                        env.tasks.push(DTask::FinishStmt(StmtFin::Return(true)));
                        env.tasks.push(DTask::Expr(items[0]));
                    } else {
                        env.tasks.push(DTask::FinishStmt(StmtFin::ReturnRecord(items.len())));
                        for it in items.into_iter().rev() { env.tasks.push(DTask::Expr(it)); }
                    }
                }
                Some(c) => {
                    env.tasks.push(DTask::FinishStmt(StmtFin::Return(true)));
                    env.tasks.push(DTask::Expr(c));
                }
                None => env.stmts.push(Stmt::Return { value: None, trivia: Trivia::default() }),
            }
        }
        "if_statement" | "if_expression" | "if" => push_if_task(env, node),
        "unless" => {
            let bn = find_body_node(node);
            let alt = node.child_by_field_name("alternative");
            env.tasks.push(DTask::FinishStmt(StmtFin::Unless { has_else: alt.is_some() }));
            if let Some(a) = alt { env.tasks.push(DTask::Block(a)); }
            if let Some(b) = bn { env.tasks.push(DTask::Block(b)); } else { env.blocks.push(Vec::new()); }
            if let Some(c) = node.child_by_field_name("condition") { env.tasks.push(DTask::Expr(c)); }
            else { env.exprs.push(Expr::Literal(LiteralVal::Bool(false))); }
        }
        "unless_modifier" | "if_modifier" => {
            let is_unless = node.kind() == "unless_modifier";
            let body_n = node.child_by_field_name("body");
            env.tasks.push(DTask::FinishStmt(StmtFin::Modifier { is_unless }));
            if let Some(b) = body_n { env.tasks.push(DTask::Stmt(b)); } else { env.stmts.push(Stmt::Pass); }
            if let Some(c) = node.child_by_field_name("condition") { env.tasks.push(DTask::Expr(c)); }
            else { env.exprs.push(Expr::Literal(LiteralVal::Bool(true))); }
        }
        "while_statement" | "while_expression" | "while" => {
            let bn = find_body_node(node);
            let hdr_tr = bn.and_then(|b| collect_header_trailing(b, env.src, env.opts));
            env.tasks.push(DTask::FinishStmt(StmtFin::While {
                has_body: bn.is_some(), trivia: Trivia { trailing: hdr_tr, ..Trivia::default() },
            }));
            if let Some(b) = bn { env.tasks.push(DTask::Block(b)); }
            if let Some(c) = node.child_by_field_name("condition") { env.tasks.push(DTask::Expr(c)); }
            else { env.exprs.push(Expr::Literal(LiteralVal::Bool(true))); }
        }
        "loop_expression" => {
            let bn = find_body_node(node);
            let hdr_tr = bn.and_then(|b| collect_header_trailing(b, env.src, env.opts));
            env.tasks.push(DTask::FinishStmt(StmtFin::Loop {
                has_body: bn.is_some(), trivia: Trivia { trailing: hdr_tr, ..Trivia::default() },
            }));
            if let Some(b) = bn { env.tasks.push(DTask::Block(b)); }
        }
        "for_statement" | "for_in_statement" | "for_expression" | "for_range_loop"
        | "foreach_statement" | "enhanced_for_statement" | "for" => push_for_stmt(env, node),
        "begin" => push_ruby_begin(env, node),
        "try_expression" if env.lang == LanguageId::Rust => {
            env.tasks.push(DTask::FinishStmt(StmtFin::ExprStmt));
            env.tasks.push(DTask::Expr(node));
        }
        "try_statement" | "try_expression" => push_try_task(env, node),
        "rethrow_statement" => env.stmts.push(Stmt::Expr { expr: Expr::Ident("rethrow".into()), trivia: Trivia::default() }),
        "throw_statement" | "throw_expression" | "raise_statement" => {
            if let Some(c) = named_children(node).into_iter().next() {
                env.tasks.push(DTask::FinishStmt(StmtFin::Throw));
                env.tasks.push(DTask::Expr(c));
            } else {
                env.stmts.push(Stmt::Throw { expr: Expr::Ident("err".into()), trivia: Trivia::default() });
            }
        }
        "break_statement" | "break_expression" | "break" => env.stmts.push(Stmt::Break { label: None, trivia: Trivia::default() }),
        "continue_statement" | "continue_expression" | "continue" => env.stmts.push(Stmt::Continue { label: None, trivia: Trivia::default() }),
        "match_expression" | "match_statement" | "switch_statement" | "switch_expression"
        | "when_expression" | "expression_switch_statement" | "case" => push_match_task(env, node, false),
        "select_statement" => push_select_task(env, node),
        "lexical_declaration" | "variable_declaration" | "let_declaration"
        | "short_var_declaration" | "local_variable_declaration" | "local_declaration_statement"
        | "initialized_variable_definition" | "property_declaration" | "declaration" => {
            let decls = find_var_decls(node, env.src, env.lang);
            let split_tr = if decls.len() > 1
                && matches!(env.tasks.last(), Some(DTask::AttachTrivia(_)))
                && let Some(DTask::AttachTrivia(mut tr)) = env.tasks.pop()
            {
                let lead = Trivia {
                    leading: std::mem::take(&mut tr.leading),
                    trailing: None,
                    blank_lines_before: std::mem::take(&mut tr.blank_lines_before),
                };
                let trail = Trivia {
                    leading: Vec::new(),
                    trailing: tr.trailing.take(),
                    blank_lines_before: 0,
                };
                Some((lead, trail))
            } else {
                None
            };
            if let Some((_, ref trail)) = split_tr
                && !trail.is_empty()
            {
                env.tasks.push(DTask::AttachTrivia(trail.clone()));
            }
            for (idx, (name, is_mut, ty, init_n)) in decls.into_iter().enumerate().rev() {
                if idx == 0
                    && let Some((ref lead, _)) = split_tr
                    && !lead.is_empty()
                {
                    env.tasks.push(DTask::AttachTrivia(lead.clone()));
                }
                env.tasks.push(DTask::FinishStmt(StmtFin::VarDecl {
                    name,
                    is_mut,
                    ty,
                    has_init: init_n.is_some(),
                }));
                if let Some(v) = init_n {
                    env.tasks.push(DTask::Expr(v));
                }
            }
        }
        "assignment_expression" | "augmented_assignment_expression"
        | "compound_assignment_expr" | "augmented_assignment"
        | "assignment" | "assignment_statement" | "operator_assignment" => {
            if let Some((op, tgt, val)) = find_assign_parts(node, env.src) {
                env.tasks.push(DTask::FinishStmt(StmtFin::Assign { op }));
                env.tasks.push(DTask::Expr(val));
                env.tasks.push(DTask::Expr(tgt));
            } else {
                env.tasks.push(DTask::FinishStmt(StmtFin::ExprStmt));
                env.tasks.push(DTask::Expr(node));
            }
        }
        "function_declaration" if matches!(env.lang, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript) => {
            let name = field_text(node, "name", env.src).unwrap_or("fn_local").to_string();
            env.tasks.push(DTask::FinishStmt(StmtFin::VarDecl { name, is_mut: false, ty: None, has_init: true }));
            env.tasks.push(DTask::Expr(node));
        }
        _ => {
            env.tasks.push(DTask::FinishStmt(StmtFin::ExprStmt));
            env.tasks.push(DTask::Expr(node));
        }
    }
}
