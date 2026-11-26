use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, named_children, node_text};
use crate::decompile::iter_env::{DTask, DecompEnv};
use crate::decompile::iter_match::finish_kotlin_arm_conds;
use crate::decompile::iter_stmt::StmtFin;
use crate::decompile::stmt_cf_util::insert_updates_before_continue;
use crate::decompile::stmt_common::find_body_node;
use crate::decompile::stmt_for::{
    extract_c_for_parts, extract_go_range_binding, extract_kotlin_for_parts,
    extract_php_foreach_binding, normalize_for_binding,
};
use crate::decompile::trivia::collect_header_trailing;
use crate::ir::Trivia;
use crate::ir_code::{CatchClause, Expr, MatchCase, RecordEntry, Stmt, UnaryOp};
use crate::ir_expr::LiteralVal;

pub(crate) fn push_for_stmt<'a>(env: &mut DecompEnv<'a>, node: Node<'a>) {
    let bn = find_body_node(node);
    let hdr_tr = bn.and_then(|b| collect_header_trailing(b, env.src, env.opts));
    let tr = Trivia { trailing: hdr_tr, ..Trivia::default() };
    if let Some(rc) = child_by_kind(node, "range_clause") {
        let binding = extract_go_range_binding(rc, env.src);
        let iter_n = rc.child_by_field_name("right");
        env.tasks.push(DTask::FinishStmt(StmtFin::For {
            binding, has_body: bn.is_some(), has_iter: iter_n.is_some(), fallback_iter: "items".into(), trivia: tr,
        }));
        if let Some(b) = bn { env.tasks.push(DTask::Block(b)); }
        if let Some(it) = iter_n { env.tasks.push(DTask::Expr(it)); }
        return;
    }
    if let Some(parts) = extract_c_for_parts(node, env.lang, bn) {
        let has_cond = !parts.is_loop && parts.cond.is_some();
        env.tasks.push(DTask::FinishStmt(StmtFin::ForClause {
            has_cond,
            has_body: bn.is_some(),
            upd_count: parts.upds.len(),
            is_loop: parts.is_loop,
            trivia: tr,
        }));
        for u in parts.upds.into_iter().rev() { env.tasks.push(DTask::Stmt(u)); }
        if let Some(b) = bn { env.tasks.push(DTask::Block(b)); }
        if has_cond && let Some(c) = parts.cond { env.tasks.push(DTask::Expr(c)); }
        for i in parts.inits.into_iter().rev() { env.tasks.push(DTask::Stmt(i)); }
        return;
    }
    if env.lang == LanguageId::Kotlin && node.kind() == "for_statement" {
        let (binding, iter_n) = extract_kotlin_for_parts(node, env.src, bn);
        env.tasks.push(DTask::FinishStmt(StmtFin::For {
            binding, has_body: bn.is_some(), has_iter: iter_n.is_some(), fallback_iter: "items".into(), trivia: tr,
        }));
        if let Some(b) = bn { env.tasks.push(DTask::Block(b)); }
        if let Some(it) = iter_n { env.tasks.push(DTask::Expr(it)); }
        return;
    }
    if env.lang == LanguageId::Php && node.kind() == "foreach_statement" {
        let body_n = node.child_by_field_name("body");
        let kids: Vec<_> = named_children(node).into_iter().filter(|k| Some(*k) != body_n).collect();
        let iter_n = kids.first().copied();
        let raw_bind = kids.get(1).map(|c| node_text(*c, env.src)).unwrap_or("item");
        let binding = extract_php_foreach_binding(raw_bind);
        env.tasks.push(DTask::FinishStmt(StmtFin::For {
            binding, has_body: bn.is_some(), has_iter: iter_n.is_some(), fallback_iter: "items".into(), trivia: tr,
        }));
        if let Some(b) = bn { env.tasks.push(DTask::Block(b)); }
        if let Some(it) = iter_n { env.tasks.push(DTask::Expr(it)); }
        return;
    }
    let id_fb = child_by_kind(node, "identifier").map(|n| node_text(n, env.src));
    let raw_b = field_text(node, "left", env.src).or_else(|| field_text(node, "pattern", env.src))
        .or_else(|| field_text(node, "declarator", env.src)).or_else(|| field_text(node, "name", env.src))
        .or(id_fb)
        .unwrap_or("item");
    let binding = normalize_for_binding(raw_b);
    let iter_n = node.child_by_field_name("right").or_else(|| node.child_by_field_name("value"))
        .or_else(|| node.child_by_field_name("collection")).map(|c| {
            if env.lang == LanguageId::Ruby && c.kind() == "in" {
                named_children(c).into_iter().next().unwrap_or(c)
            } else { c }
        });
    env.tasks.push(DTask::FinishStmt(StmtFin::For {
        binding, has_body: bn.is_some(), has_iter: iter_n.is_some(), fallback_iter: "items".into(), trivia: tr,
    }));
    if let Some(b) = bn { env.tasks.push(DTask::Block(b)); }
    if let Some(it) = iter_n { env.tasks.push(DTask::Expr(it)); }
}

pub(crate) fn finish_stmt_task(env: &mut DecompEnv<'_>, f: StmtFin) {
    match f {
        StmtFin::ForClause { has_cond, has_body, upd_count, is_loop, trivia } => {
            let upds = if upd_count > 0 {
                env.stmts.split_off(env.stmts.len() - upd_count)
            } else {
                Vec::new()
            };
            let mut body = if has_body { env.blocks.pop().unwrap_or_default() } else { Vec::new() };
            let cond = if !is_loop && has_cond {
                env.exprs.pop().expect("fc cond")
            } else {
                Expr::Literal(LiteralVal::Bool(true))
            };
            if !upds.is_empty() {
                insert_updates_before_continue(&mut body, &upds);
                if !matches!(body.last(), Some(Stmt::Return { .. } | Stmt::Break { .. } | Stmt::Continue { .. } | Stmt::Throw { .. })) {
                    body.extend(upds);
                }
            }
            if is_loop {
                env.stmts.push(Stmt::Loop { body, trivia });
            } else {
                env.stmts.push(Stmt::While { cond, body, trivia });
            }
        }
        StmtFin::Return(has) => {
            let value = if has { Some(env.exprs.pop().expect("ret val")) } else { None };
            env.stmts.push(Stmt::Return { value, trivia: Trivia::default() });
        }
        StmtFin::ReturnRecord(n) => {
            let es = env.exprs.split_off(env.exprs.len() - n);
            let recs = es.into_iter().map(|v| RecordEntry::Field { key: None, value: v }).collect();
            env.stmts.push(Stmt::Return { value: Some(Expr::Record(recs)), trivia: Trivia::default() });
        }
        StmtFin::Throw(has_cause) => {
            let cause = if has_cause { Some(env.exprs.pop().expect("throw cause")) } else { None };
            let expr = env.exprs.pop().expect("throw");
            env.stmts.push(Stmt::Throw { expr, cause, trivia: Trivia::default() });
        }
        StmtFin::ExprStmt => env.stmts.push(Stmt::Expr { expr: env.exprs.pop().expect("expr stmt"), trivia: Trivia::default() }),
        StmtFin::Unless { has_else } => {
            let else_body = if has_else { Some(env.blocks.pop().unwrap_or_default()) } else { None };
            let then_body = env.blocks.pop().unwrap_or_default();
            let raw_cond = env.exprs.pop().expect("unless cond");
            let cond = Expr::Unary { op: UnaryOp::Not, is_postfix: false, operand: Box::new(raw_cond) };
            env.stmts.push(Stmt::If {
                cond, then_body, elifs: Vec::new(), elif_trivias: Vec::new(), else_body,
                else_trivia: Trivia::default(), trivia: Trivia::default(),
            });
        }
        StmtFin::Modifier { is_unless } => {
            let body_stmt = env.stmts.pop().unwrap_or(Stmt::Pass);
            let raw_cond = env.exprs.pop().expect("mod cond");
            let cond = if is_unless {
                Expr::Unary { op: UnaryOp::Not, is_postfix: false, operand: Box::new(raw_cond) }
            } else { raw_cond };
            env.stmts.push(Stmt::If {
                cond, then_body: vec![body_stmt], elifs: Vec::new(), elif_trivias: Vec::new(),
                else_body: None, else_trivia: Trivia::default(), trivia: Trivia::default(),
            });
        }
        StmtFin::While { has_body, trivia } => {
            let body = if has_body { env.blocks.pop().unwrap_or_default() } else { Vec::new() };
            let cond = env.exprs.pop().expect("while cond");
            env.stmts.push(Stmt::While { cond, body, trivia });
        }
        StmtFin::Loop { has_body, trivia } => {
            let body = if has_body { env.blocks.pop().unwrap_or_default() } else { Vec::new() };
            env.stmts.push(Stmt::Loop { body, trivia });
        }
        StmtFin::For { binding, has_body, has_iter, fallback_iter, trivia } => {
            let body = if has_body { env.blocks.pop().unwrap_or_default() } else { Vec::new() };
            let iter = if has_iter { env.exprs.pop().expect("for iter") } else { Expr::Ident(fallback_iter) };
            env.stmts.push(Stmt::For { binding, iter, body, trivia });
        }
        StmtFin::VarDecl { name, is_mut, ty, has_init } => {
            let init = if has_init { env.exprs.pop().expect("var init") } else { Expr::Literal(LiteralVal::Nil) };
            env.stmts.push(Stmt::Let { name, is_mut, ty, init, trivia: Trivia::default() });
        }
        StmtFin::Destructure { names, is_mut, has_init } => {
            let init = if has_init { env.exprs.pop().expect("destr init") } else { Expr::Literal(LiteralVal::Nil) };
            env.stmts.push(Stmt::Destructure { names, is_mut, ty: None, init, trivia: Trivia::default() });
        }
        StmtFin::Assign { op } => {
            let value = env.exprs.pop().expect("as val");
            let target = env.exprs.pop().expect("as tgt");
            env.stmts.push(Stmt::Assign { target, op, value, trivia: Trivia::default() });
        }
        StmtFin::If { elif_count, has_else, elif_trivias, else_trivia, trivia, has_thens, has_else_body } => {
            let else_body = if has_else {
                Some(if has_else_body { env.blocks.pop().unwrap_or_default() } else { Vec::new() })
            } else { None };
            let mut elifs = Vec::with_capacity(elif_count);
            let first_then = has_thens[0];
            for has_tb in has_thens.into_iter().skip(1).rev() {
                let eb = if has_tb { env.blocks.pop().unwrap_or_default() } else { Vec::new() };
                let ec = env.exprs.pop().expect("elif cond");
                elifs.push((ec, eb));
            }
            elifs.reverse();
            let then_body = if first_then { env.blocks.pop().unwrap_or_default() } else { Vec::new() };
            let cond = env.exprs.pop().expect("if cond");
            env.stmts.push(Stmt::If { cond, then_body, elifs, elif_trivias, else_body, else_trivia, trivia });
        }
        StmtFin::Try { catch_len, has_else, else_trivia, has_finally, finally_trivia, trivia } => {
            let finally_body = if has_finally { Some(env.blocks.pop().unwrap_or_default()) } else { None };
            let else_body = if has_else { Some(env.blocks.pop().unwrap_or_default()) } else { None };
            let catches = env.catches.split_off(env.catches.len() - catch_len);
            let try_body = env.blocks.pop().unwrap_or_default();
            env.stmts.push(Stmt::Try { try_body, catches, else_body, else_trivia, finally_body, finally_trivia, trivia });
        }
        StmtFin::Catch { param, ty, has_body, trivia } => {
            let body = if has_body { env.blocks.pop().unwrap_or_default() } else { Vec::new() };
            env.catches.push(CatchClause { param, ty, body, trivia });
        }
        StmtFin::Match { is_expr, case_len, hdr_tr } => {
            let cases = env.cases.split_off(env.cases.len() - case_len);
            let target = env.match_targets.pop().expect("match tgt");
            if is_expr {
                env.exprs.push(Expr::Match { target: Box::new(target), cases });
            } else {
                env.stmts.push(Stmt::Match { target, cases, trivia: Trivia { trailing: hdr_tr, ..Trivia::default() } });
            }
        }
        StmtFin::MatchArm { pat, has_guard, trivia } => {
            let body = env.bodies.pop().expect("arm body");
            let guard = if has_guard { Some(env.exprs.pop().expect("arm guard")) } else { None };
            env.cases.push(MatchCase { pattern: pat, guard, body, trivia });
        }
        StmtFin::KotlinArm { is_subjectless, cond_pats, trivia } => {
            let body = env.bodies.pop().expect("kt arm body");
            let tgt = env.match_targets.last().cloned().unwrap_or(Expr::Ident("_".into()));
            let (pattern, guard) = finish_kotlin_arm_conds(env, &tgt, is_subjectless, cond_pats);
            env.cases.push(MatchCase { pattern, guard, body, trivia });
        }
    }
}
