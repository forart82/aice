use tree_sitter::Node;

use crate::decompile::cst_util::{named_children, node_text, strip_quotes};
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
    if raw == "_" { return Pattern::Wildcard; }
    if raw == "true" { return Pattern::Literal(LiteralVal::Bool(true)); }
    if raw == "false" { return Pattern::Literal(LiteralVal::Bool(false)); }
    if (raw.starts_with('"') && raw.ends_with('"')) || (raw.starts_with('\'') && raw.ends_with('\'')) {
        return Pattern::Literal(LiteralVal::Str { value: strip_quotes(raw), multiline: false });
    }
    if raw.chars().all(|c| c.is_ascii_digit() || c == '-') && raw.chars().any(|c| c.is_ascii_digit()) {
        return Pattern::Literal(LiteralVal::Int(raw.to_string()));
    }
    Pattern::Ident(raw.to_string())
}
