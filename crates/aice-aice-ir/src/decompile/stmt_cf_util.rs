use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, map_type_str, named_children, node_text};
use crate::decompile::iter_env::{DTask, DecompEnv};
use crate::decompile::iter_stmt::StmtFin;
use crate::decompile::stmt_vars::find_var_decls;
use crate::decompile::trivia::is_comment_kind;
use crate::ir::Trivia;
use crate::ir_code::{FnBody, Stmt};
use crate::ir_types::AiceType;

pub(crate) fn extract_kt_destructure<'a>(
    node: Node<'a>,
    src: &'a str,
) -> Option<(Vec<String>, bool, Option<Node<'a>>)> {
    let mvd = child_by_kind(node, "multi_variable_declaration")?;
    let mut names = Vec::new();
    for ch in named_children(mvd) {
        if is_comment_kind(ch.kind()) { continue; }
        let nm = child_by_kind(ch, "simple_identifier")
            .or_else(|| child_by_kind(ch, "identifier"))
            .map(|id| node_text(id, src))
            .unwrap_or_else(|| node_text(ch, src))
            .trim()
            .to_string();
        if !nm.is_empty() { names.push(nm); }
    }
    if names.is_empty() { return None; }
    let raw = node_text(node, src);
    let is_mut = raw.trim_start().starts_with("var ") || raw.contains(" var ");
    let init = node.child_by_field_name("value").or_else(|| {
        let mut cur = node.walk();
        let mut seen_eq = false;
        for c in node.children(&mut cur) {
            if c.kind() == "=" { seen_eq = true; }
            else if seen_eq && c.is_named() && !is_comment_kind(c.kind()) { return Some(c); }
        }
        None
    });
    Some((names, is_mut, init))
}

pub(crate) fn extract_py_except_parts(ch: Node<'_>, src: &str) -> (Option<String>, Option<AiceType>) {
    let val = ch.child_by_field_name("value").or_else(|| {
        named_children(ch)
            .into_iter()
            .find(|c| !matches!(c.kind(), "block" | "comment") && !is_comment_kind(c.kind()))
    });
    let Some(v) = val else { return (None, None); };
    if v.kind() == "as_pattern" {
        let alias = v.child_by_field_name("alias").or_else(|| child_by_kind(v, "as_pattern_target"));
        let param = alias.map(|a| node_text(a, src).trim().to_string()).filter(|s| !s.is_empty());
        let ty_node = named_children(v)
            .into_iter()
            .find(|c| Some(*c) != alias && !is_comment_kind(c.kind()));
        let ty = ty_node.map(|t| map_type_str(node_text(t, src).trim(), LanguageId::Python));
        (param, ty)
    } else {
        (None, Some(map_type_str(node_text(v, src).trim(), LanguageId::Python)))
    }
}

pub(crate) fn push_var_decl_stmt<'a>(env: &mut DecompEnv<'a>, node: Node<'a>) {
    if node.kind() == "property_declaration"
        && let Some((names, is_mut, init_n)) = extract_kt_destructure(node, env.src)
    {
        env.tasks.push(DTask::FinishStmt(StmtFin::Destructure { names, is_mut, has_init: init_n.is_some() }));
        if let Some(v) = init_n { env.tasks.push(DTask::Expr(v)); }
        return;
    }
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
        let trail = Trivia { leading: Vec::new(), trailing: tr.trailing.take(), blank_lines_before: 0 };
        Some((lead, trail))
    } else {
        None
    };
    if let Some((_, ref trail)) = split_tr && !trail.is_empty() {
        env.tasks.push(DTask::AttachTrivia(trail.clone()));
    }
    for (idx, (name, is_mut, ty, init_n)) in decls.into_iter().enumerate().rev() {
        if idx == 0 && let Some((ref lead, _)) = split_tr && !lead.is_empty() {
            env.tasks.push(DTask::AttachTrivia(lead.clone()));
        }
        env.tasks.push(DTask::FinishStmt(StmtFin::VarDecl { name, is_mut, ty, has_init: init_n.is_some() }));
        if let Some(v) = init_n { env.tasks.push(DTask::Expr(v)); }
    }
}

pub(crate) fn insert_updates_before_continue(stmts: &mut Vec<Stmt>, upds: &[Stmt]) {
    if upds.is_empty() {
        return;
    }
    let mut work: Vec<&mut Vec<Stmt>> = vec![stmts];
    while let Some(list) = work.pop() {
        let mut i = 0usize;
        while i < list.len() {
            if matches!(list[i], Stmt::Continue { label: None, .. }) {
                list.splice(i..i, upds.iter().cloned());
                i += upds.len() + 1;
            } else {
                i += 1;
            }
        }
        for s in list.iter_mut() {
            match s {
                Stmt::If { then_body, elifs, else_body, .. } => {
                    if let Some(eb) = else_body { work.push(eb); }
                    for (_, b) in elifs.iter_mut().rev() { work.push(b); }
                    work.push(then_body);
                }
                Stmt::Match { cases, .. } => {
                    for mc in cases.iter_mut().rev() {
                        if let FnBody::Block(b) = &mut mc.body { work.push(b); }
                    }
                }
                Stmt::Try { try_body, catches, else_body, finally_body, .. } => {
                    if let Some(fb) = finally_body { work.push(fb); }
                    if let Some(eb) = else_body { work.push(eb); }
                    for cc in catches.iter_mut().rev() { work.push(&mut cc.body); }
                    work.push(try_body);
                }
                _ => {}
            }
        }
    }
}

fn dedent_node_text(node: Node<'_>, src: &str) -> String {
    let raw = node_text(node, src).trim_end();
    let col = node.start_position().column;
    if col == 0 || !raw.contains('\n') {
        return raw.trim().to_string();
    }
    raw.lines()
        .enumerate()
        .map(|(i, line)| {
            if i == 0 {
                line.trim_start()
            } else {
                let strip = line.bytes().take(col).take_while(|b| *b == b' ' || *b == b'\t').count();
                &line[strip..]
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn raw_passthrough_stmt_text(node: Node<'_>, src: &str, lang: LanguageId) -> Option<String> {
    let raw = node_text(node, src).trim();
    if raw.is_empty() { return None; }
    match (node.kind(), lang) {
        ("global_statement" | "nonlocal_statement", LanguageId::Python)
        | ("do_while_statement", LanguageId::Kotlin) => Some(raw.to_string()),
        ("function_definition" | "decorated_definition" | "class_definition", LanguageId::Python) => {
            Some(dedent_node_text(node, src))
        }
        ("do_statement", _) => {
            let mut s = raw.to_string();
            if !s.ends_with(';') { s.push(';'); }
            Some(s)
        }
        ("let_declaration", LanguageId::Rust)
            if node.child_by_field_name("alternative").is_some()
                || (0..node.child_count()).filter_map(|i| node.child(i)).any(|c| !c.is_named() && c.kind() == "else") =>
        {
            Some(raw.to_string())
        }
        (
            "function_item" | "const_item" | "static_item" | "struct_item" | "enum_item"
            | "type_item" | "use_declaration" | "impl_item" | "trait_item",
            LanguageId::Rust,
        ) => Some(raw.to_string()),
        _ => None,
    }
}

pub(crate) fn is_rs_if_let_expr(node: Node<'_>) -> bool {
    let mut cur = Some(node);
    while let Some(n) = cur.take() {
        if n.child_by_field_name("condition")
            .is_some_and(|c| matches!(c.kind(), "let_condition" | "let_chain"))
        {
            return true;
        }
        if let Some(alt) = n.child_by_field_name("alternative") {
            let inner = if alt.kind() == "else_clause" {
                named_children(alt).into_iter().find(|c| !is_comment_kind(c.kind()))
            } else {
                Some(alt)
            };
            if let Some(sub) = inner && sub.kind() == "if_expression" {
                cur = Some(sub);
            }
        }
    }
    false
}

pub(crate) fn unwrap_kt_if_expr_branch<'a>(n: Node<'a>) -> Option<Node<'a>> {
    if n.kind() != "block" { return Some(n); }
    let kids: Vec<Node<'a>> = named_children(n).into_iter().filter(|c| !is_comment_kind(c.kind())).collect();
    if kids.len() == 1
        && !matches!(kids[0].kind(), "property_declaration" | "assignment" | "for_statement" | "while_statement" | "do_while_statement")
    {
        Some(kids[0])
    } else {
        None
    }
}

pub(crate) fn push_cond_expr_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>, raw: &str) {
    use crate::decompile::iter_expr::ExprFin;
    use crate::ir_code::{BinaryOp, Expr};
    if env.lang == LanguageId::Rust && node.kind() == "if_expression" && is_rs_if_let_expr(node) {
        env.exprs.push(Expr::Raw(raw.to_string()));
        return;
    }
    let kids: Vec<_> = named_children(node).into_iter().filter(|c| !is_comment_kind(c.kind())).collect();
    if env.lang == LanguageId::Php
        && node.kind() == "conditional_expression"
        && node.child_by_field_name("body").is_none()
        && kids.len() == 2
    {
        env.tasks.push(DTask::FinishExpr(ExprFin::Binary(BinaryOp::Elvis)));
        env.tasks.push(DTask::Expr(kids[1]));
        env.tasks.push(DTask::Expr(kids[0]));
        return;
    }
    let (cond, then_n, raw_else) = if env.lang == LanguageId::Python && node.kind() == "conditional_expression" {
        (kids.get(1).copied(), kids.first().copied(), kids.get(2).copied())
    } else {
        (
            node.child_by_field_name("condition").or_else(|| kids.first().copied()),
            node.child_by_field_name("consequence")
                .or_else(|| node.child_by_field_name("body"))
                .or_else(|| kids.get(1).copied()),
            node.child_by_field_name("alternative").or_else(|| kids.get(2).copied()),
        )
    };
    let else_n = raw_else.map(|e| {
        if e.kind() == "else_clause" {
            named_children(e).into_iter().find(|c| !is_comment_kind(c.kind())).unwrap_or(e)
        } else { e }
    });
    if env.lang == LanguageId::Kotlin && node.kind() == "if_expression" {
        let t = then_n.and_then(unwrap_kt_if_expr_branch);
        let e = else_n.and_then(unwrap_kt_if_expr_branch);
        if let (Some(c), Some(t), Some(e)) = (cond, t, e) {
            env.tasks.push(DTask::FinishExpr(ExprFin::Conditional));
            env.tasks.push(DTask::Expr(e));
            env.tasks.push(DTask::Expr(t));
            env.tasks.push(DTask::Expr(c));
        } else { env.exprs.push(Expr::Raw(raw.to_string())); }
        return;
    }
    if let (Some(c), Some(t), Some(e)) = (cond, then_n, else_n) {
        env.tasks.push(DTask::FinishExpr(ExprFin::Conditional));
        env.tasks.push(DTask::Expr(e));
        env.tasks.push(DTask::Expr(t));
        env.tasks.push(DTask::Expr(c));
    } else { env.exprs.push(Expr::Ident(raw.to_string())); }
}
