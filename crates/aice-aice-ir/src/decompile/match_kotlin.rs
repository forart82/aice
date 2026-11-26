use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, map_type_str, named_children, node_text};
use crate::decompile::expr_common::decompile_expr;
use crate::ir_code::{BinaryOp, Expr, Pattern, UnaryOp};

pub(crate) fn parse_kotlin_when_cond_shallow<'a>(
    cond: Node<'a>,
    src: &'a str,
    lang: LanguageId,
) -> Result<Pattern, (bool, Option<Node<'a>>, String)> {
    let inner = if cond.kind() == "when_condition" {
        named_children(cond).into_iter().next().unwrap_or(cond)
    } else {
        cond
    };
    let raw = node_text(inner, src).trim();
    if inner.kind() == "range_test" || raw.starts_with("in ") || raw.starts_with("!in ") {
        let negated = raw.starts_with("!in");
        if let Some(rn) = child_by_kind(inner, "range_expression")
            .or_else(|| named_children(inner).into_iter().find(|c| c.kind().contains("range")))
        {
            let kids = named_children(rn);
            if kids.len() >= 2 {
                let start = decompile_expr(kids[0], src, lang);
                let end = decompile_expr(kids[kids.len() - 1], src, lang);
                return Ok(Pattern::Range { start: Box::new(start), end: Box::new(end), inclusive: true, negated });
            }
        }
        if let Some(inf) = child_by_kind(inner, "infix_expression") {
            let kids = named_children(inf);
            let is_until = (kids.len() >= 3 && node_text(kids[1], src).trim() == "until")
                || node_text(inf, src).contains(" until ");
            if is_until && kids.len() >= 2 {
                let start = decompile_expr(kids[0], src, lang);
                let end = decompile_expr(kids[kids.len() - 1], src, lang);
                return Ok(Pattern::Range { start: Box::new(start), end: Box::new(end), inclusive: false, negated });
            }
        }
        let coll = named_children(inner).into_iter().last();
        let fallback = raw.trim_start_matches('!').trim_start_matches("in").trim().to_string();
        return Err((negated, coll, fallback));
    }
    if inner.kind() == "type_test" || raw.starts_with("is ") || raw.starts_with("!is ") {
        let negated = raw.starts_with("!is");
        let ty_str = named_children(inner)
            .into_iter()
            .last()
            .map(|t| node_text(t, src).trim().to_string())
            .unwrap_or_else(|| raw.trim_start_matches('!').trim_start_matches("is").trim().to_string());
        return Ok(Pattern::TypeCheck { ty: map_type_str(&ty_str, lang), negated });
    }
    Ok(crate::decompile::match_cf::parse_simple_pattern(raw))
}

pub(crate) fn pattern_to_cond_expr_iter(target: &Expr, root: Pattern) -> Expr {
    enum PTask {
        Enter(Pattern),
        OrFinish(usize),
    }
    let mut tasks = vec![PTask::Enter(root)];
    let mut out: Vec<Expr> = Vec::new();
    while let Some(t) = tasks.pop() {
        match t {
            PTask::Enter(mut pat) => match &mut pat {
                Pattern::Literal(l) => out.push(Expr::Binary {
                    op: BinaryOp::Eq, left: Box::new(target.clone()), right: Box::new(Expr::Literal(l.clone())),
                }),
                Pattern::Ident(s) => out.push(Expr::Binary {
                    op: BinaryOp::Eq, left: Box::new(target.clone()), right: Box::new(Expr::Ident(std::mem::take(s))),
                }),
                Pattern::Range { start, end, inclusive, negated } => {
                    let s = std::mem::replace(&mut **start, Expr::Ident(String::new()));
                    let e = std::mem::replace(&mut **end, Expr::Ident(String::new()));
                    let lo = Expr::Binary { op: BinaryOp::GtEq, left: Box::new(target.clone()), right: Box::new(s) };
                    let hi = Expr::Binary {
                        op: if *inclusive { BinaryOp::LtEq } else { BinaryOp::Lt },
                        left: Box::new(target.clone()), right: Box::new(e),
                    };
                    let c = Expr::Binary { op: BinaryOp::And, left: Box::new(lo), right: Box::new(hi) };
                    out.push(if *negated { Expr::Unary { op: UnaryOp::Not, is_postfix: false, operand: Box::new(c) } } else { c });
                }
                Pattern::Or(ps) => {
                    let list = std::mem::take(ps);
                    tasks.push(PTask::OrFinish(list.len()));
                    for p in list.into_iter().rev() { tasks.push(PTask::Enter(p)); }
                }
                _ => out.push(Expr::Literal(crate::ir_expr::LiteralVal::Bool(true))),
            },
            PTask::OrFinish(n) => {
                let mut xs = out.split_off(out.len() - n);
                let combined = xs.drain(..).reduce(|a, b| Expr::Binary { op: BinaryOp::Or, left: Box::new(a), right: Box::new(b) })
                    .unwrap_or(Expr::Literal(crate::ir_expr::LiteralVal::Bool(true)));
                out.push(combined);
            }
        }
    }
    out.pop().unwrap_or(Expr::Literal(crate::ir_expr::LiteralVal::Bool(true)))
}
