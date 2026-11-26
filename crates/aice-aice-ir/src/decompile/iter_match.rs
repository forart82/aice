use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, named_children, node_text};
use crate::decompile::iter_env::{DTask, DecompEnv};
use crate::decompile::iter_stmt::StmtFin;
use crate::decompile::match_cf::{
    parse_rust_pattern_iter, parse_simple_pattern, push_c_switch_arms, push_php_match_arm, push_py_case_arm,
};
use crate::decompile::stmt_common::find_body_node;
use crate::decompile::trivia::{collect_header_trailing, collect_trivia};
use crate::ir_code::{BinaryOp, Expr, FnBody, Pattern, UnaryOp};
use crate::ir_expr::LiteralVal;

pub(crate) fn push_match_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>, is_expr: bool) {
    let (target_node, is_subjectless) = if node.kind() == "when_expression" {
        let ws = child_by_kind(node, "when_subject").and_then(|s| named_children(s).into_iter().next());
        (ws, ws.is_none())
    } else if node.kind() == "case" {
        let val = node.child_by_field_name("value");
        (val, val.is_none())
    } else {
        let tn = node.child_by_field_name("value").or_else(|| node.child_by_field_name("condition"))
            .or_else(|| named_children(node).into_iter().next());
        (tn, false)
    };
    let container = node.child_by_field_name("body").or_else(|| child_by_kind(node, "match_block"))
        .or_else(|| child_by_kind(node, "switch_block")).unwrap_or(node);
    let hdr_tr = (container.id() != node.id()).then(|| collect_header_trailing(container, env.src, env.opts)).flatten();
    env.tasks.push(DTask::StartMatchArms { node, is_expr, hdr_tr });
    if let Some(tn) = target_node {
        env.tasks.push(DTask::Expr(tn));
    } else {
        env.exprs.push(if is_subjectless { Expr::Literal(LiteralVal::Bool(true)) } else { Expr::Ident("_".into()) });
    }
}

pub(crate) fn push_match_arms<'a>(env: &mut DecompEnv<'a>, node: Node<'a>, is_expr: bool, hdr_tr: Option<String>) {
    let tgt = env.exprs.pop().expect("match target");
    env.match_targets.push(tgt);
    let is_subjectless = (node.kind() == "when_expression"
        && child_by_kind(node, "when_subject").and_then(|s| named_children(s).into_iter().next()).is_none())
        || (node.kind() == "case" && node.child_by_field_name("value").is_none());
    let container = node.child_by_field_name("body").or_else(|| child_by_kind(node, "match_block"))
        .or_else(|| child_by_kind(node, "switch_block")).unwrap_or(node);
    let arm_nodes: Vec<Node<'a>> = named_children(container).into_iter().filter(|ch| matches!(
        ch.kind(),
        "match_arm" | "when_entry" | "switch_case" | "switch_default" | "case_clause"
            | "expression_case" | "default_case" | "case_statement"
            | "match_conditional_expression" | "match_default_expression"
    ) || (node.kind() == "case" && matches!(ch.kind(), "when" | "else"))).collect();

    if node.kind() == "switch_statement" && matches!(env.lang, LanguageId::C | LanguageId::Cpp) {
        push_c_switch_arms(env, &arm_nodes, is_expr, hdr_tr);
        return;
    }
    env.tasks.push(DTask::FinishStmt(StmtFin::Match { is_expr, case_len: arm_nodes.len(), hdr_tr }));
    for ch in arm_nodes.into_iter().rev() {
        match ch.kind() {
            "match_arm" => push_rust_arm(env, ch),
            "when_entry" => push_kotlin_when_entry(env, ch, is_subjectless),
            "match_conditional_expression" | "match_default_expression" => push_php_match_arm(env, ch),
            "case_clause" if env.lang == LanguageId::Python => push_py_case_arm(env, ch),
            "when" if node.kind() == "case" => push_ruby_when(env, ch, is_subjectless),
            "else" if node.kind() == "case" => {
                let bn = ch.child_by_field_name("body").or_else(|| child_by_kind(ch, "then")).unwrap_or(ch);
                env.tasks.push(DTask::FinishStmt(StmtFin::MatchArm { pat: Pattern::Wildcard, has_guard: false, trivia: collect_trivia(ch, env.src, env.opts) }));
                env.tasks.push(DTask::FinishFnBodyFromBlock { single_expr_collapse: true });
                env.tasks.push(DTask::Block(bn));
            }
            _ => {
                let pat = if matches!(ch.kind(), "switch_default" | "default_case") { Pattern::Wildcard } else {
                    field_text(ch, "value", env.src).or_else(|| field_text(ch, "pattern", env.src))
                        .map(|s| parse_simple_pattern(s.trim())).unwrap_or(Pattern::Wildcard)
                };
                env.tasks.push(DTask::FinishStmt(StmtFin::MatchArm { pat, has_guard: false, trivia: collect_trivia(ch, env.src, env.opts) }));
                if let Some(bn) = find_body_node(ch) {
                    env.tasks.push(DTask::FinishFnBodyFromBlock { single_expr_collapse: false });
                    env.tasks.push(DTask::Block(bn));
                } else { env.bodies.push(FnBody::Block(Vec::new())); }
            }
        }
    }
}

fn push_rust_arm<'a>(env: &mut DecompEnv<'a>, arm: Node<'a>) {
    let pat_wrap = arm.child_by_field_name("pattern");
    let mut guard_n = arm.child_by_field_name("condition");
    let pat = if let Some(pw) = pat_wrap {
        if pw.kind() == "match_pattern" {
            if guard_n.is_none() { guard_n = pw.child_by_field_name("condition"); }
            parse_rust_pattern_iter(named_children(pw).into_iter().next().unwrap_or(pw), env.src)
        } else { parse_rust_pattern_iter(pw, env.src) }
    } else { Pattern::Wildcard };
    let val_n = arm.child_by_field_name("value");
    env.tasks.push(DTask::FinishStmt(StmtFin::MatchArm {
        pat, has_guard: guard_n.is_some(), trivia: collect_trivia(arm, env.src, env.opts),
    }));
    match val_n {
        Some(v) if v.kind() == "block" => {
            env.tasks.push(DTask::FinishFnBodyFromBlock { single_expr_collapse: false });
            env.tasks.push(DTask::Block(v));
        }
        Some(v) => {
            env.tasks.push(DTask::FinishFnBodyFromExpr);
            env.tasks.push(DTask::Expr(v));
        }
        None => env.bodies.push(FnBody::SignatureOnly),
    }
    if let Some(g) = guard_n { env.tasks.push(DTask::Expr(g)); }
}

fn push_ruby_when<'a>(env: &mut DecompEnv<'a>, ch: Node<'a>, is_subjectless: bool) {
    let mut cur = ch.walk();
    let mut pat_nodes: Vec<Node<'a>> = ch.children_by_field_name("pattern", &mut cur).collect();
    if pat_nodes.is_empty() {
        for c in named_children(ch) { if c.kind() == "pattern" { pat_nodes.push(c); } }
    }
    let unwrapped: Vec<Node<'a>> = pat_nodes.into_iter()
        .map(|p| if p.kind() == "pattern" { named_children(p).into_iter().next().unwrap_or(p) } else { p }).collect();
    let bn = ch.child_by_field_name("body").or_else(|| child_by_kind(ch, "then"));
    if is_subjectless && !unwrapped.is_empty() {
        let len = unwrapped.len();
        env.tasks.push(DTask::FinishStmt(StmtFin::KotlinArm {
            is_subjectless: true, cond_pats: vec![Err(len)], trivia: collect_trivia(ch, env.src, env.opts),
        }));
        if let Some(b) = bn {
            env.tasks.push(DTask::FinishFnBodyFromBlock { single_expr_collapse: true });
            env.tasks.push(DTask::Block(b));
        } else { env.bodies.push(FnBody::SignatureOnly); }
        for pn in unwrapped.into_iter().rev() { env.tasks.push(DTask::Expr(pn)); }
        return;
    }
    let pat = if unwrapped.is_empty() {
        Pattern::Wildcard
    } else {
        let mut pats: Vec<Pattern> = unwrapped.iter().map(|pn| {
            if pn.kind() == "range" {
                let kids = named_children(*pn);
                let sn = pn.child_by_field_name("begin").or_else(|| kids.first().copied());
                let en = pn.child_by_field_name("end").or_else(|| kids.last().copied());
                if let (Some(s), Some(e)) = (sn, en) {
                    let between = if s.end_byte() <= e.start_byte() { &env.src[s.end_byte()..e.start_byte()] } else { node_text(*pn, env.src) };
                    return Pattern::Range {
                        start: Box::new(crate::decompile::expr_common::decompile_expr(s, env.src, env.lang)),
                        end: Box::new(crate::decompile::expr_common::decompile_expr(e, env.src, env.lang)),
                        inclusive: !between.contains("..."), negated: false,
                    };
                }
            }
            parse_simple_pattern(node_text(*pn, env.src).trim())
        }).collect();
        if pats.len() == 1 { pats.remove(0) } else { Pattern::Or(pats) }
    };
    env.tasks.push(DTask::FinishStmt(StmtFin::MatchArm {
        pat, has_guard: false, trivia: collect_trivia(ch, env.src, env.opts),
    }));
    if let Some(b) = bn {
        env.tasks.push(DTask::FinishFnBodyFromBlock { single_expr_collapse: true });
        env.tasks.push(DTask::Block(b));
    } else { env.bodies.push(FnBody::SignatureOnly); }
}

fn push_kotlin_when_entry<'a>(env: &mut DecompEnv<'a>, entry: Node<'a>, is_subjectless: bool) {
    let raw = node_text(entry, env.src).trim_start();
    let is_else = raw.starts_with("else");
    let mut cur = entry.walk();
    let mut cond_nodes: Vec<Node<'a>> = entry.children_by_field_name("condition", &mut cur).collect();
    if cond_nodes.is_empty() && !is_else && let Some(wc) = child_by_kind(entry, "when_condition") { cond_nodes.push(wc); }
    let cond_ids: Vec<usize> = cond_nodes.iter().map(|n| n.id()).collect();
    let body_node = named_children(entry).into_iter().rev().find(|c| !cond_ids.contains(&c.id()));
    let tr = collect_trivia(entry, env.src, env.opts);

    if is_else || cond_nodes.is_empty() {
        env.tasks.push(DTask::FinishStmt(StmtFin::MatchArm { pat: Pattern::Wildcard, has_guard: false, trivia: tr }));
        if let Some(bn) = body_node { push_when_body(env, bn); } else { env.bodies.push(FnBody::SignatureOnly); }
        return;
    }
    if is_subjectless {
        env.tasks.push(DTask::FinishStmt(StmtFin::KotlinArm {
            is_subjectless: true, cond_pats: vec![Err(cond_nodes.len())], trivia: tr,
        }));
        if let Some(bn) = body_node { push_when_body(env, bn); } else { env.bodies.push(FnBody::SignatureOnly); }
        for c in cond_nodes.into_iter().rev() {
            let inner = if c.kind() == "when_condition" { named_children(c).into_iter().next().unwrap_or(c) } else { c };
            env.tasks.push(DTask::Expr(inner));
        }
        return;
    }
    let mut cond_pats = Vec::new();
    let mut err_nodes = Vec::new();
    for c in cond_nodes {
        match crate::decompile::match_kotlin::parse_kotlin_when_cond_shallow(c, env.src, env.lang) {
            Ok(p) => cond_pats.push(Ok(p)),
            Err((neg, coll_n, fallback)) => {
                cond_pats.push(Err(if neg { 1 } else { 0 }));
                err_nodes.push((coll_n, fallback));
            }
        }
    }
    env.tasks.push(DTask::FinishStmt(StmtFin::KotlinArm {
        is_subjectless: false, cond_pats, trivia: tr,
    }));
    if let Some(bn) = body_node { push_when_body(env, bn); } else { env.bodies.push(FnBody::SignatureOnly); }
    for (coll_n, fallback) in err_nodes.into_iter().rev() {
        if let Some(cn) = coll_n { env.tasks.push(DTask::Expr(cn)); } else { env.exprs.push(Expr::Ident(fallback)); }
    }
}

fn push_when_body<'a>(env: &mut DecompEnv<'a>, mut bn: Node<'a>) {
    while bn.kind() == "control_structure_body" {
        if let Some(blk) = child_by_kind(bn, "block").or_else(|| child_by_kind(bn, "statements")) {
            env.tasks.push(DTask::FinishFnBodyFromBlock { single_expr_collapse: true });
            env.tasks.push(DTask::Block(blk));
            return;
        }
        if let Some(ex) = named_children(bn).into_iter().next() { bn = ex; } else { break; }
    }
    match bn.kind() {
        "block" | "statements" => {
            env.tasks.push(DTask::FinishFnBodyFromBlock { single_expr_collapse: true });
            env.tasks.push(DTask::Block(bn));
        }
        "return_expression" | "jump_expression" | "throw_expression" | "throw_statement"
        | "break_expression" | "continue_expression" => {
            env.tasks.push(DTask::FinishFnBodyFromBlock { single_expr_collapse: false });
            let base = env.stmts.len();
            env.tasks.push(DTask::FinishBlock(base));
            env.tasks.push(DTask::Stmt(bn));
        }
        _ => {
            env.tasks.push(DTask::FinishFnBodyFromExpr);
            env.tasks.push(DTask::Expr(bn));
        }
    }
}

pub(crate) fn push_select_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>) {
    let arms: Vec<Node<'a>> = named_children(node).into_iter()
        .filter(|c| matches!(c.kind(), "communication_case" | "default_case")).collect();
    env.match_targets.push(Expr::Ident("__select".into()));
    env.tasks.push(DTask::FinishStmt(StmtFin::Match { is_expr: false, case_len: arms.len(), hdr_tr: None }));
    for ch in arms.into_iter().rev() {
        let pat = if ch.kind() == "communication_case" {
            let comm = ch.child_by_field_name("communication").or_else(|| named_children(ch).into_iter().next())
                .map(|n| node_text(n, env.src).trim().to_string()).unwrap_or_default();
            Pattern::Literal(LiteralVal::Str { value: comm, multiline: false })
        } else { Pattern::Wildcard };
        env.tasks.push(DTask::FinishStmt(StmtFin::MatchArm { pat, has_guard: false, trivia: collect_trivia(ch, env.src, env.opts) }));
        if let Some(sl) = child_by_kind(ch, "statement_list") {
            env.tasks.push(DTask::FinishFnBodyFromBlock { single_expr_collapse: false });
            env.tasks.push(DTask::Block(sl));
        } else if ch.kind() == "communication_case" {
            env.tasks.push(DTask::FinishFnBodyFromBlock { single_expr_collapse: false });
            let base = env.stmts.len();
            env.tasks.push(DTask::FinishBlock(base));
            for s in named_children(ch).into_iter().skip(1).rev() { env.tasks.push(DTask::Stmt(s)); }
        } else {
            env.bodies.push(FnBody::Block(Vec::new()));
        }
    }
}

pub(crate) fn finish_kotlin_arm_conds(
    env: &mut DecompEnv<'_>,
    target: &Expr,
    is_subjectless: bool,
    cond_pats: Vec<Result<Pattern, usize>>,
) -> (Pattern, Option<Expr>) {
    if is_subjectless {
        let len = cond_pats[0].as_ref().err().copied().unwrap_or(0);
        let mut exprs = env.exprs.split_off(env.exprs.len() - len);
        let combined = exprs.drain(..).reduce(|a, b| Expr::Binary { op: BinaryOp::Or, left: Box::new(a), right: Box::new(b) });
        return (Pattern::Wildcard, combined);
    }
    let err_cnt = cond_pats.iter().filter(|r| r.is_err()).count();
    let mut err_exprs = env.exprs.split_off(env.exprs.len() - err_cnt);
    if err_cnt == 0 {
        let mut pats: Vec<Pattern> = cond_pats.into_iter().filter_map(Result::ok).collect();
        let pat = if pats.len() == 1 { pats.remove(0) } else { Pattern::Or(pats) };
        return (pat, None);
    }
    let mut ei = err_exprs.drain(..);
    let mut exprs: Vec<Expr> = cond_pats.into_iter().map(|r| match r {
        Ok(p) => crate::decompile::match_kotlin::pattern_to_cond_expr_iter(target, p),
        Err(neg) => {
            let coll = ei.next().unwrap_or(Expr::Ident("_".into()));
            let in_e = Expr::Binary { op: BinaryOp::In, left: Box::new(target.clone()), right: Box::new(coll) };
            if neg == 1 { Expr::Unary { op: UnaryOp::Not, is_postfix: false, operand: Box::new(in_e) } } else { in_e }
        }
    }).collect();
    let combined = exprs.drain(..).reduce(|a, b| Expr::Binary { op: BinaryOp::Or, left: Box::new(a), right: Box::new(b) });
    (Pattern::Wildcard, combined)
}
