use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, named_children, node_text};
use crate::decompile::iter_env::{DTask, DecompEnv};
use crate::decompile::iter_expr::{ExprFin, ObjSlot};
use crate::decompile::trivia::is_comment_kind;
use crate::ir::TranspileOpts;
use crate::ir_code::{AssignOp, BinaryOp, Expr, UnaryOp};

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

pub(crate) fn push_yield_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>, raw: &str) {
    if let Some(arg) = named_children(node).into_iter().next() {
        let is_star = raw
            .strip_prefix("yield")
            .is_some_and(|r| r.trim_start().starts_with('*'));
        let op = if is_star { UnaryOp::YieldStar } else { UnaryOp::Yield };
        env.tasks.push(DTask::FinishExpr(ExprFin::Unary { op, is_postfix: false }));
        env.tasks.push(DTask::Expr(arg));
    } else {
        env.exprs.push(Expr::Ident(raw.to_string()));
    }
}

pub(crate) fn is_simple_cast_ident(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && (b[0].is_ascii_alphabetic() || b[0] == b'_')
        && b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'_')
        && !matches!(
            s,
            "true" | "false" | "nil" | "fn" | "async" | "await" | "match" | "not" | "and" | "or" | "in" | "as" | "is"
        )
}

pub(crate) fn push_c_cast_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>, raw: &str) {
    let kids = named_children(node);
    let ty = node.child_by_field_name("type").or_else(|| kids.first().copied());
    let val = node.child_by_field_name("value").or_else(|| kids.last().copied().filter(|v| Some(*v) != ty));
    if let (Some(t), Some(v)) = (ty, val) {
        let raw_t = if env.lang == LanguageId::Java && kids.len() > 2 {
            env.src.get(t.start_byte()..v.start_byte()).unwrap_or(node_text(t, env.src)).trim().trim_end_matches(')').trim()
        } else { node_text(t, env.src).trim() };
        let clean_t = if t.kind() == "cast_type" { raw_t.trim_start_matches('(').trim_end_matches(')').trim() } else { raw_t };
        let ty_s = clean_t.split_whitespace().collect::<Vec<_>>().join(" ");
        let quote_mode = if matches!(env.lang, LanguageId::CSharp | LanguageId::Php) { 2 } else { 1 };
        env.tasks.push(DTask::FinishExpr(ExprFin::TypeCast { ty: ty_s, quote_mode }));
        env.tasks.push(DTask::Expr(v));
    } else { env.exprs.push(Expr::Ident(raw.to_string())); }
}

pub(crate) fn push_new_array_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>, raw: &str) {
    let mut ranks: Vec<(Vec<Node<'a>>, String)> = Vec::new();
    let elem_ty = if node.kind() == "implicit_array_creation_expression" {
        let mut commas = 0usize;
        let mut cur = node.walk();
        for c in node.children(&mut cur) {
            if c.kind() == "," { commas += 1; }
        }
        ranks.push((Vec::new(), ",".repeat(commas)));
        String::new()
    } else if env.lang == LanguageId::CSharp {
        let Some(mut ty_n) = node.child_by_field_name("type") else {
            env.exprs.push(Expr::Ident(raw.to_string()));
            return;
        };
        let mut rev_ranks = Vec::new();
        while ty_n.kind() == "array_type" {
            let mut cur = ty_n.walk();
            let mut rk_nodes: Vec<Node<'a>> = ty_n.children_by_field_name("rank", &mut cur).collect();
            if rk_nodes.is_empty() {
                rk_nodes = named_children(ty_n).into_iter().filter(|c| c.kind() == "array_rank_specifier").collect();
            }
            for rk in rk_nodes.into_iter().rev() {
                let dims: Vec<Node<'a>> = named_children(rk).into_iter().filter(|c| !is_comment_kind(c.kind())).collect();
                let mut commas = 0usize;
                let mut rc = rk.walk();
                for c in rk.children(&mut rc) { if c.kind() == "," { commas += 1; } }
                rev_ranks.push((dims, ",".repeat(commas)));
            }
            let Some(inner) = ty_n.child_by_field_name("type") else { break; };
            ty_n = inner;
        }
        rev_ranks.reverse();
        ranks = rev_ranks;
        node_text(ty_n, env.src).trim().to_string()
    } else {
        let Some(ty_n) = node.child_by_field_name("type") else {
            env.exprs.push(Expr::Ident(raw.to_string()));
            return;
        };
        for ch in named_children(node) {
            if ch.kind() == "dimensions_expr" {
                let dims: Vec<Node<'a>> = named_children(ch).into_iter().filter(|c| !is_comment_kind(c.kind())).collect();
                ranks.push((dims, String::new()));
            } else if ch.kind() == "dimensions" {
                let cnt = node_text(ch, env.src).matches('[').count().max(1);
                for _ in 0..cnt { ranks.push((Vec::new(), String::new())); }
            }
        }
        node_text(ty_n, env.src).trim().to_string()
    };
    if ranks.is_empty() {
        env.exprs.push(Expr::Ident(raw.to_string()));
        return;
    }
    let init_node = child_by_kind(node, "initializer_expression")
        .or_else(|| child_by_kind(node, "array_initializer"))
        .or_else(|| node.child_by_field_name("value").filter(|v| v.kind() == "array_initializer"));
    let init_elems: Option<Vec<Node<'a>>> = init_node.map(|n| {
        named_children(n).into_iter().filter(|c| !is_comment_kind(c.kind())).collect()
    });
    env.exprs.push(Expr::Ident(elem_ty));
    env.tasks.push(DTask::FinishExpr(ExprFin::NewArray { has_init: init_elems.is_some() }));
    if let Some(elems) = init_elems {
        env.tasks.push(DTask::FinishExpr(ExprFin::Array(elems.len())));
        for el in elems.into_iter().rev() {
            env.tasks.push(DTask::Expr(el));
        }
    }
    for (dims, empty_sep) in ranks.into_iter().rev() {
        if dims.is_empty() {
            env.tasks.push(DTask::FinishExpr(ExprFin::EmptyIndex(empty_sep)));
        } else {
            env.tasks.push(DTask::FinishExpr(ExprFin::Index { is_optional: false, argc: dims.len() }));
            for d in dims.into_iter().rev() {
                env.tasks.push(DTask::Expr(d));
            }
        }
    }
}

pub(crate) fn cs_init_elems<'a>(init_node: Node<'a>) -> Option<Vec<Node<'a>>> {
    let elems: Vec<Node<'a>> = named_children(init_node)
        .into_iter()
        .filter(|c| !is_comment_kind(c.kind()))
        .collect();
    if elems.iter().any(|c| c.kind() == "preproc_if") { None } else { Some(elems) }
}

pub(crate) fn push_cs_special_expr<'a>(env: &mut DecompEnv<'a>, node: Node<'a>, raw: &str) {
    match node.kind() {
        "initializer_expression" => {
            let Some(elems) = cs_init_elems(node) else { env.exprs.push(Expr::Raw(raw.to_string())); return; };
            env.tasks.push(DTask::FinishExpr(ExprFin::Object((0..elems.len()).map(|_| ObjSlot::Shorthand).collect())));
            for el in elems.into_iter().rev() { env.tasks.push(DTask::Expr(el)); }
        }
        "element_binding_expression" => {
            let xs: Vec<_> = named_children(node).into_iter().filter(|c| !is_comment_kind(c.kind())).collect();
            env.tasks.push(DTask::FinishExpr(ExprFin::Array(xs.len())));
            for c in xs.into_iter().rev() { env.tasks.push(DTask::Expr(c)); }
        }
        "with_expression" => {
            let kids: Vec<_> = named_children(node).into_iter().filter(|c| !is_comment_kind(c.kind())).collect();
            let Some(&recv) = kids.first() else { env.exprs.push(Expr::Raw(raw.to_string())); return; };
            let mut pairs = Vec::new();
            for &wi in &kids[1..] {
                if wi.kind() != "with_initializer" { env.exprs.push(Expr::Raw(raw.to_string())); return; }
                let wk: Vec<_> = named_children(wi).into_iter().filter(|c| !is_comment_kind(c.kind())).collect();
                if wk.len() < 2 { env.exprs.push(Expr::Raw(raw.to_string())); return; }
                pairs.push((wk[0], wk[1]));
            }
            env.tasks.push(DTask::FinishExpr(ExprFin::Binary(BinaryOp::With)));
            env.tasks.push(DTask::FinishExpr(ExprFin::Object((0..pairs.len()).map(|_| ObjSlot::Shorthand).collect())));
            for (k, v) in pairs.into_iter().rev() {
                env.tasks.push(DTask::FinishExpr(ExprFin::Assign(AssignOp::Assign)));
                env.tasks.push(DTask::Expr(v));
                env.tasks.push(DTask::Expr(k));
            }
            env.tasks.push(DTask::Expr(recv));
        }
        "anonymous_object_creation_expression" => {
            let mut entries: Vec<(Option<Node<'a>>, Node<'a>)> = Vec::new();
            let mut cur = node.walk();
            let raw_kids: Vec<Node<'a>> = node.children(&mut cur).collect();
            let mut i = 0;
            while i < raw_kids.len() {
                let ch = raw_kids[i];
                if !ch.is_named() || is_comment_kind(ch.kind()) { i += 1; continue; }
                let mut j = i + 1;
                while j < raw_kids.len() && is_comment_kind(raw_kids[j].kind()) { j += 1; }
                if j < raw_kids.len() && !raw_kids[j].is_named() && raw_kids[j].kind() == "=" {
                    let mut k = j + 1;
                    while k < raw_kids.len() && (!raw_kids[k].is_named() || is_comment_kind(raw_kids[k].kind())) { k += 1; }
                    if k < raw_kids.len() { entries.push((Some(ch), raw_kids[k])); i = k + 1; continue; }
                }
                entries.push((None, ch));
                i += 1;
            }
            env.tasks.push(DTask::FinishExpr(ExprFin::NewObjInit { callee_name: String::new(), argc: 0, has_parens: false }));
            env.tasks.push(DTask::FinishExpr(ExprFin::Object((0..entries.len()).map(|_| ObjSlot::Shorthand).collect())));
            for (k, v) in entries.into_iter().rev() {
                if let Some(kn) = k {
                    env.tasks.push(DTask::FinishExpr(ExprFin::Assign(AssignOp::Assign)));
                    env.tasks.push(DTask::Expr(v));
                    env.tasks.push(DTask::Expr(kn));
                } else { env.tasks.push(DTask::Expr(v)); }
            }
        }
        _ => env.exprs.push(Expr::Ident(raw.to_string())),
    }
}
