use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, named_children, node_text};
use crate::decompile::iter_env::{DTask, DecompEnv};
use crate::decompile::iter_expr::ExprFin;
use crate::decompile::trivia::is_comment_kind;
use crate::ir::TranspileOpts;
use crate::ir_code::Expr;

pub(crate) fn decompile_expr(node: Node<'_>, src: &str, lang: LanguageId) -> Expr {
    let opts = TranspileOpts::default();
    let mut env = DecompEnv::new(src, lang, &opts);
    env.tasks.push(DTask::Expr(node));
    env.run();
    env.exprs.pop().unwrap_or_else(|| Expr::Ident(String::new()))
}

pub(crate) fn push_index_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>, raw: &str) {
    let is_optional = child_by_kind(node, "optional_chain").is_some()
        || node.kind() == "conditional_access_expression";
    let (obj_n, idx_n) = match (
        node.child_by_field_name("object")
            .or_else(|| node.child_by_field_name("argument"))
            .or_else(|| node.child_by_field_name("expression"))
            .or_else(|| node.child_by_field_name("condition")),
        node.child_by_field_name("index")
            .or_else(|| node.child_by_field_name("indices"))
            .or_else(|| node.child_by_field_name("subscript"))
            .or_else(|| child_by_kind(node, "element_binding_expression")),
    ) {
        (Some(o), Some(i)) => (Some(o), Some(i)),
        _ => {
            let kids: Vec<_> = named_children(node)
                .into_iter()
                .filter(|c| c.kind() != "optional_chain" && !is_comment_kind(c.kind()))
                .collect();
            (kids.first().copied(), kids.get(1).copied())
        }
    };
    let Some((o, i)) = obj_n.zip(idx_n) else {
        env.exprs.push(Expr::Ident(raw.to_string()));
        return;
    };
    if matches!(
        i.kind(),
        "subscript_argument_list" | "bracketed_argument_list" | "element_binding_expression"
    ) {
        let args: Vec<_> = named_children(i)
            .into_iter()
            .filter(|c| !is_comment_kind(c.kind()))
            .collect();
        if args.is_empty() {
            env.exprs.push(Expr::Ident(raw.to_string()));
            return;
        }
        env.tasks.push(DTask::FinishExpr(ExprFin::Index { is_optional, argc: args.len() }));
        for a in args.into_iter().rev() {
            env.tasks.push(DTask::Expr(a));
        }
        env.tasks.push(DTask::Expr(o));
    } else {
        env.tasks.push(DTask::FinishExpr(ExprFin::Index { is_optional, argc: 1 }));
        env.tasks.push(DTask::Expr(i));
        env.tasks.push(DTask::Expr(o));
    }
}

pub(crate) fn push_template_task<'a>(
    env: &mut DecompEnv<'a>,
    node: Node<'a>,
    force_template: bool,
) {
    let raw = node_text(node, env.src);
    let sb = node.start_byte();
    let eb = node.end_byte();
    let has_bt = env.src.as_bytes().get(sb) == Some(&b'`')
        && eb >= sb + 2
        && env.src.as_bytes().get(eb - 1) == Some(&b'`');
    let (inner_start, inner_end) = if has_bt { (sb + 1, eb - 1) } else { (sb, eb) };
    let mut quasis = Vec::new();
    let mut sub_exprs = Vec::new();
    let mut cursor = inner_start;
    for ch in named_children(node) {
        if ch.kind() == "template_substitution" {
            quasis.push(env.src.get(cursor..ch.start_byte()).unwrap_or("").to_string());
            if let Some(ex) = named_children(ch)
                .into_iter()
                .find(|c| !is_comment_kind(c.kind()))
            {
                sub_exprs.push(ex);
            } else {
                sub_exprs.push(ch);
            }
            cursor = ch.end_byte();
        }
    }
    quasis.push(env.src.get(cursor..inner_end).unwrap_or("").to_string());
    if sub_exprs.is_empty() && !force_template {
        env.exprs.push(crate::decompile::expr_lit::decompile_string_lit(raw, env.lang));
        return;
    }
    env.tasks.push(DTask::FinishExpr(ExprFin::Template { quasis }));
    for ex in sub_exprs.into_iter().rev() {
        env.tasks.push(DTask::Expr(ex));
    }
}
