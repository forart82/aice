use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, named_children, node_text};
use crate::decompile::trivia::is_comment_kind;

pub(crate) struct CForParts<'a> {
    pub inits: Vec<Node<'a>>,
    pub cond: Option<Node<'a>>,
    pub upds: Vec<Node<'a>>,
    pub is_loop: bool,
}

fn clean_cond<'a>(n: Option<Node<'a>>) -> Option<Node<'a>> {
    n.filter(|c| !matches!(c.kind(), "empty_statement" | ";"))
}

fn collect_for_exprs<'a>(node: Node<'a>, field: &str) -> Vec<Node<'a>> {
    let mut cur = node.walk();
    let raw: Vec<Node<'a>> = node.children_by_field_name(field, &mut cur).collect();
    let mut stack: Vec<Node<'a>> = raw.into_iter().rev().collect();
    let mut out = Vec::new();
    while let Some(n) = stack.pop() {
        if matches!(n.kind(), "empty_statement" | ";" | ",")
            || !n.is_named()
            || is_comment_kind(n.kind())
        {
            continue;
        }
        if matches!(n.kind(), "comma_expression" | "sequence_expression") {
            let kids = named_children(n);
            for k in kids.into_iter().rev() {
                stack.push(k);
            }
        } else {
            out.push(n);
        }
    }
    out
}

pub(crate) fn extract_c_for_parts<'a>(
    node: Node<'a>,
    lang: LanguageId,
    bn: Option<Node<'a>>,
) -> Option<CForParts<'a>> {
    if node.kind() != "for_statement" {
        return None;
    }
    let (inits, cond, upds) = match lang {
        LanguageId::Go => {
            if let Some(fc) = child_by_kind(node, "for_clause") {
                (
                    collect_for_exprs(fc, "initializer"),
                    clean_cond(fc.child_by_field_name("condition")),
                    collect_for_exprs(fc, "update"),
                )
            } else if child_by_kind(node, "range_clause").is_some() {
                return None;
            } else {
                let cond = named_children(node)
                    .into_iter()
                    .find(|c| Some(*c) != bn && !is_comment_kind(c.kind()));
                return Some(CForParts {
                    inits: Vec::new(),
                    cond,
                    upds: Vec::new(),
                    is_loop: cond.is_none(),
                });
            }
        }
        LanguageId::Python | LanguageId::Kotlin | LanguageId::Rust | LanguageId::Ruby => {
            return None;
        }
        LanguageId::Dart => {
            if node.child_by_field_name("value").is_some()
                || child_by_kind(node, "in").is_some()
            {
                return None;
            }
            (
                collect_for_exprs(node, "init"),
                clean_cond(node.child_by_field_name("condition")),
                collect_for_exprs(node, "update"),
            )
        }
        LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript => (
            collect_for_exprs(node, "initializer"),
            clean_cond(node.child_by_field_name("condition")),
            collect_for_exprs(node, "increment"),
        ),
        LanguageId::Java => (
            collect_for_exprs(node, "init"),
            clean_cond(node.child_by_field_name("condition")),
            collect_for_exprs(node, "update"),
        ),
        LanguageId::Php => (
            collect_for_exprs(node, "initialize"),
            clean_cond(node.child_by_field_name("condition")),
            collect_for_exprs(node, "update"),
        ),
        LanguageId::C | LanguageId::Cpp | LanguageId::CSharp => (
            collect_for_exprs(node, "initializer"),
            clean_cond(node.child_by_field_name("condition")),
            collect_for_exprs(node, "update"),
        ),
        _ => return None,
    };
    let is_loop = cond.is_none();
    Some(CForParts { inits, cond, upds, is_loop })
}

pub(crate) fn extract_kotlin_for_parts<'a>(
    node: Node<'a>,
    src: &'a str,
    bn: Option<Node<'a>>,
) -> (String, Option<Node<'a>>) {
    let ident_text = |n: Node<'a>| -> Option<String> {
        child_by_kind(n, "simple_identifier")
            .or_else(|| child_by_kind(n, "identifier"))
            .map(|id| node_text(id, src).trim().to_string())
            .filter(|s| !s.is_empty())
    };
    let binding = if let Some(vd) = child_by_kind(node, "variable_declaration") {
        ident_text(vd).unwrap_or_else(|| "item".into())
    } else if let Some(mvd) = child_by_kind(node, "multi_variable_declaration") {
        let parts: Vec<String> = named_children(mvd)
            .into_iter()
            .filter_map(|c| {
                if c.kind() == "variable_declaration" {
                    ident_text(c)
                } else if matches!(c.kind(), "simple_identifier" | "identifier") {
                    Some(node_text(c, src).trim().to_string())
                } else {
                    None
                }
            })
            .collect();
        if parts.is_empty() {
            "item".into()
        } else {
            format!("({})", parts.join(", "))
        }
    } else {
        "item".into()
    };
    let iter_n = named_children(node).into_iter().find(|c| {
        Some(*c) != bn
            && !is_comment_kind(c.kind())
            && !matches!(
                c.kind(),
                "label" | "annotation" | "variable_declaration" | "multi_variable_declaration"
            )
    });
    (binding, iter_n)
}

pub(crate) fn extract_go_range_binding(rc: Node<'_>, src: &str) -> String {
    let Some(left) = rc.child_by_field_name("left") else {
        return "_".to_string();
    };
    let parts: Vec<String> = node_text(left, src)
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    match parts.as_slice() {
        [] => "item".to_string(),
        [only] => only.clone(),
        [first, second] if first == "_" => second.clone(),
        many => format!("({})", many.join(", ")),
    }
}

pub(crate) fn extract_php_foreach_binding(raw_bind: &str) -> String {
    let parts: Vec<String> = raw_bind
        .split("=>")
        .map(|s| s.trim().trim_start_matches(['&', '$']).trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    match parts.as_slice() {
        [] => "item".to_string(),
        [only] => only.clone(),
        many => format!("({})", many.join(", ")),
    }
}

pub(crate) fn normalize_for_binding(raw: &str) -> String {
    let cleaned = raw.trim().trim_start_matches(['&', '*', '$']).trim();
    if cleaned.is_empty() {
        return "item".to_string();
    }
    if cleaned.contains(',') && !(cleaned.starts_with('(') && cleaned.ends_with(')')) {
        let parts: Vec<&str> = cleaned
            .split(',')
            .map(|s| s.trim().trim_start_matches(['&', '*', '$']).trim())
            .filter(|s| !s.is_empty())
            .collect();
        if parts.len() > 1 {
            return format!("({})", parts.join(", "));
        }
    }
    cleaned.to_string()
}

pub(crate) fn is_single_stmt_node(kind: &str) -> bool {
    matches!(
        kind,
        "expression_statement" | "return_statement" | "return_expression"
            | "throw_statement" | "throw_expression" | "raise_statement"
            | "break_statement" | "break_expression" | "continue_statement" | "continue_expression"
            | "if_statement" | "if_expression" | "while_statement" | "while_expression"
            | "do_statement" | "do_while_statement" | "for_statement" | "for_in_statement"
            | "for_expression" | "for_range_loop" | "foreach_statement" | "enhanced_for_statement"
            | "loop_expression" | "try_statement" | "try_expression" | "switch_statement"
            | "match_expression" | "match_statement" | "lexical_declaration"
            | "variable_declaration" | "local_declaration_statement" | "local_variable_declaration"
            | "declaration" | "assignment_expression" | "augmented_assignment_expression"
            | "compound_assignment_expr" | "augmented_assignment" | "assignment_statement"
            | "operator_assignment"
    )
}

pub(crate) fn ts_non_null_depth(mut n: Node<'_>, src: &str) -> usize {
    let mut d = 0usize;
    loop {
        n = match n.kind() {
            "binary_expression" | "assignment_expression" | "augmented_assignment_expression" => {
                let Some(r) = n.child_by_field_name("right") else { break; }; r
            }
            "ternary_expression" => { let Some(r) = n.child_by_field_name("alternative") else { break; }; r }
            "unary_expression" | "prefix_expression" | "await_expression"
                if !matches!(n.child_by_field_name("operator").map(|o| node_text(o, src).trim()), Some("!!" | "++" | "--")) =>
            {
                let Some(r) = n.child_by_field_name("argument").or_else(|| named_children(n).into_iter().next()) else { break; }; r
            }
            _ => break,
        };
        d += 1;
    }
    d
}

pub(crate) fn ts_lhs_non_null_depth(mut n: Node<'_>, src: &str) -> usize {
    loop {
        n = match n.kind() {
            "non_null_expression" | "null_assertion_expression" => {
                return n.child_by_field_name("value").or_else(|| named_children(n).into_iter().next()).map_or(0, |a| ts_non_null_depth(a, src));
            }
            "unary_expression" if n.child_by_field_name("operator").is_some_and(|o| node_text(o, src).trim() == "!!") => {
                return n.child_by_field_name("argument").map_or(0, |a| ts_non_null_depth(a, src));
            }
            "member_expression" | "subscript_expression" | "navigation_expression" | "index_expression" => {
                let Some(o) = n.child_by_field_name("object").or_else(|| named_children(n).into_iter().next()) else { return 0; }; o
            }
            "call_expression" => {
                let Some(f) = n.child_by_field_name("function").or_else(|| named_children(n).into_iter().next()) else { return 0; }; f
            }
            _ => return 0,
        };
    }
}

pub(crate) fn lift_ts_postfix(mut outer: crate::ir_code::Expr, depth: usize) -> crate::ir_code::Expr {
    use crate::ir_code::{AssignOp, BinaryOp, Expr, UnaryOp};
    enum Frame { Bin(BinaryOp, Box<Expr>), Un(UnaryOp), Cond(Box<Expr>, Box<Expr>), Asn(Box<Expr>, AssignOp), Await }
    let slot = match &mut outer {
        Expr::Unary { op: UnaryOp::NonNull, is_postfix: true, operand } => operand,
        Expr::Member { object, .. } | Expr::Index { object, .. } => object,
        Expr::Call { callee, .. } => if let Expr::Member { object, .. } = callee.as_mut() { object } else { callee },
        _ => return outer,
    };
    let take = |e: &mut Expr| std::mem::replace(e, Expr::Ident(String::new()));
    let mut cur = take(slot.as_mut());
    let mut frames = Vec::with_capacity(depth);
    for _ in 0..depth {
        match &mut cur {
            Expr::Binary { op, left, right } => { let (o, l, r) = (*op, take(left), take(right)); frames.push(Frame::Bin(o, Box::new(l))); cur = r; }
            Expr::Unary { op, is_postfix: false, operand } => { let (o, r) = (*op, take(operand)); frames.push(Frame::Un(o)); cur = r; }
            Expr::Conditional { cond, then_expr, else_expr } => { let (c, t, r) = (take(cond), take(then_expr), take(else_expr)); frames.push(Frame::Cond(Box::new(c), Box::new(t))); cur = r; }
            Expr::Assign { target, op, value } => { let (t, o, r) = (take(target), *op, take(value)); frames.push(Frame::Asn(Box::new(t), o)); cur = r; }
            Expr::Await(inner) => { let r = take(inner); frames.push(Frame::Await); cur = r; }
            _ => break,
        }
    }
    **slot = cur;
    frames.into_iter().rev().fold(outer, |res, fr| match fr {
        Frame::Bin(op, left) => Expr::Binary { op, left, right: Box::new(res) },
        Frame::Un(op) => Expr::Unary { op, is_postfix: false, operand: Box::new(res) },
        Frame::Cond(cond, then_expr) => Expr::Conditional { cond, then_expr, else_expr: Box::new(res) },
        Frame::Asn(target, op) => Expr::Assign { target, op, value: Box::new(res) },
        Frame::Await => Expr::Await(Box::new(res)),
    })
}
