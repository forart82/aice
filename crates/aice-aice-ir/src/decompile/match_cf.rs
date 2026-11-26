use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, named_children, node_text, strip_quotes};
use crate::decompile::expr_lit::strip_quotes_opt;
use crate::decompile::iter_env::{DTask, DecompEnv};
use crate::decompile::iter_stmt::{StmtFin, push_stmt_nodes};
use crate::decompile::stmt_common::find_body_node;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::ir_code::{FnBody, Pattern, Stmt};
use crate::ir_expr::LiteralVal;

pub(crate) fn parse_rust_pattern_iter(root: Node<'_>, src: &str) -> Pattern {
    enum PTask<'a> {
        Enter(Node<'a>),
        FinishCtor(String, usize),
    }
    let mut tasks = vec![PTask::Enter(root)];
    let mut out: Vec<Pattern> = Vec::new();
    while let Some(t) = tasks.pop() {
        match t {
            PTask::Enter(n) => {
                let raw = node_text(n, src).trim();
                if raw == "_" || n.kind() == "wildcard_pattern" {
                    out.push(Pattern::Wildcard);
                } else if n.kind() == "tuple_struct_pattern" {
                    let kids = named_children(n);
                    if let Some(first) = kids.first() {
                        let nm = node_text(*first, src).trim().to_string();
                        tasks.push(PTask::FinishCtor(nm, kids.len() - 1));
                        for k in kids.into_iter().skip(1).rev() {
                            tasks.push(PTask::Enter(k));
                        }
                    } else {
                        out.push(parse_simple_pattern(raw));
                    }
                } else {
                    out.push(parse_simple_pattern(raw));
                }
            }
            PTask::FinishCtor(name, len) => {
                let args = out.split_off(out.len() - len);
                out.push(Pattern::Constructor { name, args });
            }
        }
    }
    out.pop().unwrap_or(Pattern::Wildcard)
}

pub(crate) fn stmts_to_arm_body(mut stmts: Vec<Stmt>) -> FnBody {
    if stmts.len() == 1 && matches!(stmts[0], Stmt::Expr { .. }) {
        let mut s = stmts.remove(0);
        if let Stmt::Expr { expr, .. } = &mut s {
            return FnBody::Expr(std::mem::replace(expr, crate::ir_code::Expr::Ident(String::new())));
        }
    }
    FnBody::Block(stmts)
}

pub(crate) fn parse_simple_pattern(raw: &str) -> Pattern {
    let t = raw.trim();
    if t == "_" { return Pattern::Wildcard; }
    if t == "true" || t == "True" { return Pattern::Literal(LiteralVal::Bool(true)); }
    if t == "false" || t == "False" { return Pattern::Literal(LiteralVal::Bool(false)); }
    if let Some(unq) = strip_quotes_opt(t) {
        return Pattern::Literal(LiteralVal::Str { value: unq, multiline: false });
    }
    if t.chars().all(|c| c.is_ascii_digit() || c == '-') && t.chars().any(|c| c.is_ascii_digit()) {
        return Pattern::Literal(LiteralVal::Int(t.to_string()));
    }
    if t.contains('.') && t.chars().all(|c| c.is_ascii_digit() || c == '-' || c == '.') && t.chars().any(|c| c.is_ascii_digit()) {
        return Pattern::Literal(LiteralVal::Float(t.to_string()));
    }
    Pattern::Ident(t.to_string())
}

fn extract_c_case_parts<'a>(ch: Node<'a>, src: &'a str) -> (Vec<Pattern>, bool, Vec<Node<'a>>) {
    let (mut pats, mut cur, mut is_default) = (Vec::new(), ch, false);
    loop {
        let val_n = cur.child_by_field_name("value");
        if let Some(vn) = val_n {
            pats.push(parse_simple_pattern(node_text(vn, src).trim()));
        } else if node_text(cur, src).trim_start().starts_with("default") {
            is_default = true;
        }
        let kids: Vec<Node<'a>> = named_children(cur)
            .into_iter()
            .filter(|k| Some(*k) != val_n && !is_comment_kind(k.kind()))
            .collect();
        if kids.len() == 1 && kids[0].kind() == "case_statement" {
            cur = kids[0];
            continue;
        }
        return (pats, is_default, kids);
    }
}

pub(crate) fn push_c_switch_arms<'a>(
    env: &mut DecompEnv<'a>,
    arm_nodes: &[Node<'a>],
    is_expr: bool,
    hdr_tr: Option<String>,
) {
    let mut groups: Vec<(Vec<Pattern>, bool, Vec<Node<'a>>, Node<'a>)> = Vec::new();
    let (mut pending_pats, mut pending_first): (Vec<Pattern>, Option<Node<'a>>) = (Vec::new(), None);
    for &ch in arm_nodes {
        let (mut pats, is_def, body) = extract_c_case_parts(ch, env.src);
        if body.is_empty() && !is_def && !pats.is_empty() {
            if pending_first.is_none() { pending_first = Some(ch); }
            pending_pats.append(&mut pats);
            continue;
        }
        let first = pending_first.take().unwrap_or(ch);
        if !pending_pats.is_empty() {
            let mut merged = std::mem::take(&mut pending_pats);
            merged.append(&mut pats);
            pats = merged;
        }
        groups.push((pats, is_def, body, first));
    }
    if !pending_pats.is_empty() && let Some(first) = pending_first {
        groups.push((pending_pats, false, Vec::new(), first));
    }
    env.tasks.push(DTask::FinishStmt(StmtFin::Match { is_expr, case_len: groups.len(), hdr_tr }));
    for (mut pats, is_def, body_nodes, first) in groups.into_iter().rev() {
        let pat = if is_def || pats.is_empty() { Pattern::Wildcard }
            else if pats.len() == 1 { pats.remove(0) }
            else { Pattern::Or(pats) };
        env.tasks.push(DTask::FinishStmt(StmtFin::MatchArm {
            pat, has_guard: false, trivia: collect_trivia(first, env.src, env.opts),
        }));
        if body_nodes.is_empty() {
            env.bodies.push(FnBody::Block(Vec::new()));
        } else if body_nodes.len() == 1 && body_nodes[0].kind() == "compound_statement" {
            env.tasks.push(DTask::FinishFnBodyFromBlock { single_expr_collapse: false });
            env.tasks.push(DTask::Block(body_nodes[0]));
        } else {
            env.tasks.push(DTask::FinishFnBodyFromBlock { single_expr_collapse: false });
            let base = env.stmts.len();
            env.tasks.push(DTask::FinishBlock(base));
            push_stmt_nodes(env, body_nodes);
        }
    }
}

pub(crate) fn push_php_match_arm<'a>(env: &mut DecompEnv<'a>, ch: Node<'a>) {
    let (pat, ret_n) = if ch.kind() == "match_default_expression" {
        let r = ch.child_by_field_name("return_expression")
            .or_else(|| named_children(ch).into_iter().rfind(|c| !is_comment_kind(c.kind())));
        (Pattern::Wildcard, r)
    } else {
        let cond_list = ch.child_by_field_name("conditional_expressions")
            .or_else(|| child_by_kind(ch, "match_condition_list"));
        let r = ch.child_by_field_name("return_expression").or_else(|| {
            named_children(ch)
                .into_iter()
                .rfind(|c| Some(*c) != cond_list && !is_comment_kind(c.kind()))
        });
        let mut pats: Vec<Pattern> = cond_list
            .map(|cl| {
                named_children(cl)
                    .into_iter()
                    .filter(|c| !is_comment_kind(c.kind()))
                    .map(|c| parse_simple_pattern(node_text(c, env.src).trim()))
                    .collect()
            })
            .unwrap_or_default();
        let pat = if pats.is_empty() {
            Pattern::Wildcard
        } else if pats.len() == 1 {
            pats.remove(0)
        } else {
            Pattern::Or(pats)
        };
        (pat, r)
    };
    env.tasks.push(DTask::FinishStmt(StmtFin::MatchArm {
        pat, has_guard: false, trivia: collect_trivia(ch, env.src, env.opts),
    }));
    if let Some(r) = ret_n {
        env.tasks.push(DTask::FinishFnBodyFromExpr);
        env.tasks.push(DTask::Expr(r));
    } else {
        env.bodies.push(FnBody::SignatureOnly);
    }
}

fn parse_py_pattern_iter(root: Node<'_>, src: &str) -> Pattern {
    enum PTask<'a> {
        Enter(Node<'a>),
        FinishOr(usize),
        FinishCtor(String, usize),
    }
    let mut tasks = vec![PTask::Enter(root)];
    let mut out: Vec<Pattern> = Vec::new();
    while let Some(t) = tasks.pop() {
        match t {
            PTask::Enter(mut n) => {
                while n.kind() == "case_pattern" {
                    let raw_cp = node_text(n, src).trim();
                    if raw_cp == "_" {
                        break;
                    }
                    let kids: Vec<_> = named_children(n).into_iter().filter(|c| !is_comment_kind(c.kind())).collect();
                    if kids.len() == 1 {
                        n = kids[0];
                    } else {
                        break;
                    }
                }
                let raw = node_text(n, src).trim();
                if raw == "_" || n.kind() == "wildcard_pattern" {
                    out.push(Pattern::Wildcard);
                } else if n.kind() == "union_pattern" {
                    let mut parts = Vec::new();
                    let mut ustack = vec![n];
                    while let Some(u) = ustack.pop() {
                        if u.kind() == "union_pattern" {
                            for ch in named_children(u).into_iter().filter(|c| !is_comment_kind(c.kind())).rev() {
                                ustack.push(ch);
                            }
                        } else {
                            parts.push(u);
                        }
                    }
                    if parts.len() <= 1 {
                        out.push(parse_simple_pattern(raw));
                    } else {
                        tasks.push(PTask::FinishOr(parts.len()));
                        for p in parts.into_iter().rev() { tasks.push(PTask::Enter(p)); }
                    }
                } else if n.kind() == "class_pattern" {
                    let kids: Vec<_> = named_children(n).into_iter().filter(|c| !is_comment_kind(c.kind())).collect();
                    if let Some(first) = kids.first() {
                        let nm = node_text(*first, src).trim().to_string();
                        tasks.push(PTask::FinishCtor(nm, kids.len() - 1));
                        for k in kids.into_iter().skip(1).rev() { tasks.push(PTask::Enter(k)); }
                    } else {
                        out.push(parse_simple_pattern(raw));
                    }
                } else if n.kind() == "string" {
                    out.push(Pattern::Literal(LiteralVal::Str { value: strip_quotes(raw), multiline: false }));
                } else {
                    out.push(parse_simple_pattern(raw));
                }
            }
            PTask::FinishOr(len) => {
                let ps = out.split_off(out.len() - len);
                out.push(Pattern::Or(ps));
            }
            PTask::FinishCtor(name, len) => {
                let args = out.split_off(out.len() - len);
                out.push(Pattern::Constructor { name, args });
            }
        }
    }
    out.pop().unwrap_or(Pattern::Wildcard)
}

pub(crate) fn push_py_case_arm<'a>(env: &mut DecompEnv<'a>, ch: Node<'a>) {
    let pat_nodes: Vec<Node<'a>> = named_children(ch)
        .into_iter()
        .filter(|c| c.kind() == "case_pattern")
        .collect();
    let mut pats: Vec<Pattern> = pat_nodes.into_iter().map(|p| parse_py_pattern_iter(p, env.src)).collect();
    let pat = if pats.is_empty() {
        Pattern::Wildcard
    } else if pats.len() == 1 {
        pats.remove(0)
    } else {
        Pattern::Or(pats)
    };
    let guard_n = ch.child_by_field_name("guard")
        .or_else(|| child_by_kind(ch, "if_clause"))
        .and_then(|g| {
            if g.kind() == "if_clause" {
                named_children(g).into_iter().find(|c| !is_comment_kind(c.kind()))
            } else {
                Some(g)
            }
        });
    env.tasks.push(DTask::FinishStmt(StmtFin::MatchArm {
        pat, has_guard: guard_n.is_some(), trivia: collect_trivia(ch, env.src, env.opts),
    }));
    if let Some(bn) = find_body_node(ch) {
        env.tasks.push(DTask::FinishFnBodyFromBlock { single_expr_collapse: false });
        env.tasks.push(DTask::Block(bn));
    } else {
        env.bodies.push(FnBody::Block(Vec::new()));
    }
    if let Some(g) = guard_n {
        env.tasks.push(DTask::Expr(g));
    }
}
