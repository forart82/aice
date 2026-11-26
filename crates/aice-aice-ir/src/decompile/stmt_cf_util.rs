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
