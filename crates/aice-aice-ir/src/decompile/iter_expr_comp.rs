use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{field_text, named_children, node_text};
use crate::decompile::iter_env::{DTask, DecompEnv};
use crate::decompile::iter_expr::{ExprFin, ObjSlot};
use crate::decompile::op_map::map_binary_op;
use crate::decompile::trivia::is_comment_kind;
use crate::decompile::ts_helpers::normalize_single_line;
use crate::ir_code::{BinaryOp, CompClause, CompKind, Expr};

pub(crate) fn push_tuple_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>, raw: &str) {
    let kids: Vec<Node<'a>> = named_children(node)
        .into_iter()
        .filter(|c| !is_comment_kind(c.kind()))
        .collect();
    if env.lang == LanguageId::Rust && kids.iter().any(|c| c.kind() == "attribute_item") {
        env.exprs.push(Expr::Raw(raw.to_string()));
        return;
    }
    if env.lang == LanguageId::CSharp
        && kids.iter().any(|c| {
            c.kind() == "argument"
                && (c.child_by_field_name("name").is_some()
                    || named_children(*c)
                        .into_iter()
                        .filter(|k| !is_comment_kind(k.kind()))
                        .count()
                        != 1)
        })
    {
        env.exprs.push(Expr::Raw(raw.to_string()));
        return;
    }
    if kids.is_empty() {
        env.exprs.push(Expr::Call {
            callee: Box::new(Expr::Ident(String::new())),
            args: Vec::new(),
            is_optional: false,
            is_tagged: false,
            is_new: false,
        });
        return;
    }
    env.tasks.push(DTask::FinishExpr(ExprFin::Tuple(kids.len())));
    for k in kids.into_iter().rev() {
        env.tasks.push(DTask::Expr(k));
    }
}

pub(crate) fn finish_tuple_expr(env: &mut DecompEnv<'_>, n: usize) -> Expr {
    let mut args = env.exprs.split_off(env.exprs.len() - n);
    if args.len() == 1 {
        args.push(Expr::Ident(String::new()));
    }
    Expr::Call {
        callee: Box::new(Expr::Ident(String::new())),
        args,
        is_optional: false,
        is_tagged: false,
        is_new: false,
    }
}

pub(crate) fn push_py_set_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>) {
    let kids: Vec<Node<'a>> = named_children(node)
        .into_iter()
        .filter(|c| !is_comment_kind(c.kind()))
        .collect();
    let slots = (0..kids.len()).map(|_| ObjSlot::Shorthand).collect();
    env.tasks.push(DTask::FinishExpr(ExprFin::Object(slots)));
    for k in kids.into_iter().rev() {
        env.tasks.push(DTask::Expr(k));
    }
}

pub(crate) fn push_py_comp_task<'a>(
    env: &mut DecompEnv<'a>,
    node: Node<'a>,
    kind: CompKind,
    raw: &str,
) {
    let kids: Vec<Node<'a>> = named_children(node)
        .into_iter()
        .filter(|c| !is_comment_kind(c.kind()))
        .collect();
    let Some(body_node) = node.child_by_field_name("body").or_else(|| kids.first().copied()) else {
        env.exprs.push(Expr::Raw(raw.to_string()));
        return;
    };
    let (body_expr, val_node) = if kind == CompKind::Dict {
        let bk = named_children(body_node);
        let k = body_node.child_by_field_name("key").or_else(|| bk.first().copied());
        let v = body_node.child_by_field_name("value").or_else(|| bk.get(1).copied());
        let Some((k, v)) = k.zip(v) else {
            env.exprs.push(Expr::Raw(raw.to_string()));
            return;
        };
        (k, Some(v))
    } else {
        (body_node, None)
    };

    let mut clauses: Vec<(bool, String, Node<'a>, Vec<Node<'a>>)> = Vec::new();
    for ch in kids {
        if ch.id() == body_node.id() {
            continue;
        }
        match ch.kind() {
            "for_in_clause" => {
                let is_async = node_text(ch, env.src).trim_start().starts_with("async ");
                let Some(left) = ch.child_by_field_name("left") else {
                    env.exprs.push(Expr::Raw(raw.to_string()));
                    return;
                };
                let Some(right) = ch.child_by_field_name("right") else {
                    env.exprs.push(Expr::Raw(raw.to_string()));
                    return;
                };
                let target = normalize_single_line(node_text(left, env.src));
                clauses.push((is_async, target, right, Vec::new()));
            }
            "if_clause" => {
                let Some(cond) = named_children(ch).into_iter().find(|c| !is_comment_kind(c.kind())) else {
                    env.exprs.push(Expr::Raw(raw.to_string()));
                    return;
                };
                let Some(last) = clauses.last_mut() else {
                    env.exprs.push(Expr::Raw(raw.to_string()));
                    return;
                };
                last.3.push(cond);
            }
            _ => {
                env.exprs.push(Expr::Raw(raw.to_string()));
                return;
            }
        }
    }
    if clauses.is_empty() {
        env.exprs.push(Expr::Raw(raw.to_string()));
        return;
    }
    let clause_specs: Vec<(bool, String, usize)> = clauses
        .iter()
        .map(|(a, t, _, fs)| (*a, t.clone(), fs.len()))
        .collect();
    env.tasks.push(DTask::FinishExpr(ExprFin::Comprehension {
        kind,
        has_val: val_node.is_some(),
        clause_specs,
    }));
    for (_, _, iter_n, filters) in clauses.into_iter().rev() {
        for f in filters.into_iter().rev() {
            env.tasks.push(DTask::Expr(f));
        }
        env.tasks.push(DTask::Expr(iter_n));
    }
    if let Some(vn) = val_node {
        env.tasks.push(DTask::Expr(vn));
    }
    env.tasks.push(DTask::Expr(body_expr));
}

pub(crate) fn finish_comp_expr(
    env: &mut DecompEnv<'_>,
    kind: CompKind,
    has_val: bool,
    clause_specs: Vec<(bool, String, usize)>,
) -> Expr {
    let mut clauses = Vec::with_capacity(clause_specs.len());
    for (is_async, target, n_filters) in clause_specs.into_iter().rev() {
        let filters = env.exprs.split_off(env.exprs.len() - n_filters);
        let iter = env.exprs.pop().expect("comp iter");
        clauses.push(CompClause { is_async, target, iter, filters });
    }
    clauses.reverse();
    let value = has_val.then(|| Box::new(env.exprs.pop().expect("comp val")));
    let body = Box::new(env.exprs.pop().expect("comp body"));
    Expr::Comprehension { kind, body, value, clauses }
}

pub(crate) fn push_dart_type_test_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>, raw: &str) {
    let kids: Vec<Node<'a>> = named_children(node)
        .into_iter()
        .filter(|c| !is_comment_kind(c.kind()))
        .collect();
    if kids.len() != 2 {
        env.exprs.push(Expr::Ident(raw.to_string()));
        return;
    }
    let tt = kids[1];
    let tt_txt = node_text(tt, env.src).trim();
    let (op, ty_txt) = if let Some(rest) = tt_txt.strip_prefix("is!") {
        (BinaryOp::IsNot, rest.trim())
    } else if let Some(rest) = tt_txt.strip_prefix("is") {
        (BinaryOp::Is, rest.trim())
    } else {
        env.exprs.push(Expr::Ident(raw.to_string()));
        return;
    };
    if ty_txt.is_empty() {
        env.exprs.push(Expr::Ident(raw.to_string()));
        return;
    }
    env.tasks.push(DTask::FinishExpr(ExprFin::BinaryIdentRhs(op, ty_txt.to_string())));
    env.tasks.push(DTask::Expr(kids[0]));
}

pub(crate) fn push_dart_chained_binary<'a>(
    env: &mut DecompEnv<'a>,
    kids: &[Node<'a>],
    raw: &str,
) {
    let mut ops = Vec::with_capacity(kids.len() - 1);
    for pair in kids.windows(2) {
        let gap = env.src.get(pair[0].end_byte()..pair[1].start_byte()).unwrap_or("").trim();
        let Some(op) = map_binary_op(gap, env.lang) else {
            env.exprs.push(Expr::Ident(raw.to_string()));
            return;
        };
        ops.push(op);
    }
    for i in (1..kids.len()).rev() {
        env.tasks.push(DTask::FinishExpr(ExprFin::Binary(ops[i - 1])));
        env.tasks.push(DTask::Expr(kids[i]));
    }
    env.tasks.push(DTask::Expr(kids[0]));
}

pub(crate) fn push_struct_expr_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>) {
    let sname = field_text(node, "name", env.src).unwrap_or("Struct").trim().to_string();
    let (mut slots, mut vals) = (Vec::new(), Vec::new());
    if let Some(body) = node.child_by_field_name("body") {
        for ch in named_children(body) {
            match ch.kind() {
                "field_initializer" => {
                    let k = field_text(ch, "field", env.src)
                        .or_else(|| field_text(ch, "name", env.src))
                        .map(crate::decompile::cst_util::strip_quotes);
                    let vn = ch.child_by_field_name("value").or_else(|| named_children(ch).into_iter().last());
                    if let (Some(key), Some(v)) = (k, vn) {
                        slots.push(ObjSlot::Field(key));
                        vals.push(v);
                    }
                }
                "shorthand_field_initializer" => {
                    let id = crate::decompile::cst_util::child_by_kind(ch, "identifier").unwrap_or(ch);
                    slots.push(ObjSlot::Shorthand);
                    vals.push(id);
                }
                "base_field_initializer" => {
                    if let Some(base) = named_children(ch).into_iter().last() {
                        slots.push(ObjSlot::Spread);
                        vals.push(base);
                    }
                }
                _ => {}
            }
        }
    }
    env.tasks.push(DTask::FinishExpr(ExprFin::StructExpr { sname, slots }));
    for v in vals.into_iter().rev() {
        env.tasks.push(DTask::Expr(v));
    }
}
