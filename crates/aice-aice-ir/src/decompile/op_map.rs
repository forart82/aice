use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{named_children, node_text};
use crate::decompile::trivia::is_comment_kind;
use crate::ir_code::{AssignOp, BinaryOp, UnaryOp};

pub(crate) fn parse_assign_op_str(op: &str) -> Option<AssignOp> {
    Some(match op.trim() {
        "=" => AssignOp::Assign,
        "+=" => AssignOp::AddAssign,
        "-=" => AssignOp::SubAssign,
        "*=" => AssignOp::MulAssign,
        "/=" => AssignOp::DivAssign,
        "//=" => AssignOp::FloorDivAssign,
        "~/=" => AssignOp::TruncDivAssign,
        "%=" => AssignOp::ModAssign,
        "**=" => AssignOp::PowAssign,
        "&=" => AssignOp::BitAndAssign,
        "&^=" => AssignOp::BitClearAssign,
        "|=" => AssignOp::BitOrAssign,
        "^=" => AssignOp::BitXorAssign,
        "<<=" => AssignOp::ShlAssign,
        ">>=" => AssignOp::ShrAssign,
        ">>>=" => AssignOp::UshrAssign,
        "??=" => AssignOp::CoalesceAssign,
        "&&=" => AssignOp::AndAssign,
        "||=" => AssignOp::OrAssign,
        ".=" => AssignOp::ConcatAssign,
        _ => return None,
    })
}

fn unwrap_single_expr_list(node: Node<'_>) -> Option<Node<'_>> {
    if node.kind() != "expression_list" {
        return Some(node);
    }
    let mut items = named_children(node)
        .into_iter()
        .filter(|c| !is_comment_kind(c.kind()));
    let first = items.next()?;
    if items.next().is_some() {
        return None;
    }
    Some(first)
}

pub(crate) fn find_assign_parts<'a>(
    node: Node<'a>,
    src: &'a str,
) -> Option<(AssignOp, Node<'a>, Node<'a>)> {
    let kids: Vec<Node<'a>> = named_children(node)
        .into_iter()
        .filter(|c| !is_comment_kind(c.kind()))
        .collect();
    let raw_lhs = node.child_by_field_name("left").or_else(|| kids.first().copied())?;
    let raw_rhs = node
        .child_by_field_name("right")
        .or_else(|| if kids.len() >= 2 { kids.last().copied() } else { None })?;
    if raw_lhs.id() == raw_rhs.id() {
        return None;
    }
    let lhs = unwrap_single_expr_list(raw_lhs)?;
    let rhs = unwrap_single_expr_list(raw_rhs)?;

    if let Some(op_node) = node.child_by_field_name("operator")
        && let Some(op) = parse_assign_op_str(node_text(op_node, src))
    {
        return Some((op, lhs, rhs));
    }

    let mut cur = node.walk();
    for ch in node.children(&mut cur) {
        if ch.start_byte() >= raw_lhs.end_byte()
            && ch.end_byte() <= raw_rhs.start_byte()
            && let Some(op) = parse_assign_op_str(node_text(ch, src))
        {
            return Some((op, lhs, rhs));
        }
    }

    if raw_lhs.end_byte() <= raw_rhs.start_byte()
        && let Some(op) = parse_assign_op_str(&src[raw_lhs.end_byte()..raw_rhs.start_byte()])
    {
        return Some((op, lhs, rhs));
    }
    None
}

pub(crate) fn map_binary_op(op_str: &str, lang: LanguageId) -> Option<BinaryOp> {
    Some(match op_str {
        "+" => BinaryOp::Add,
        "." if lang == LanguageId::Php => BinaryOp::Concat,
        "-" => BinaryOp::Sub,
        "*" => BinaryOp::Mul,
        "/" => BinaryOp::Div,
        "//" | "~/" => BinaryOp::FloorDiv,
        "%" => BinaryOp::Mod,
        "**" => BinaryOp::Pow,
        "==" | "===" => BinaryOp::Eq,
        "!=" | "!==" => BinaryOp::NotEq,
        "<" => BinaryOp::Lt,
        "<=" => BinaryOp::LtEq,
        ">" => BinaryOp::Gt,
        ">=" => BinaryOp::GtEq,
        "<=>" => BinaryOp::Spaceship,
        "&&" | "and" => BinaryOp::And,
        "||" | "or" => BinaryOp::Or,
        "??" => BinaryOp::Coalesce,
        "?:" => BinaryOp::Elvis,
        "&" => BinaryOp::BitAnd,
        "&^" => BinaryOp::BitClear,
        "|" => BinaryOp::BitOr,
        "^" => BinaryOp::BitXor,
        "<<" => BinaryOp::Shl,
        ">>" => BinaryOp::Shr,
        ">>>" => BinaryOp::Ushr,
        "in" => BinaryOp::In,
        "not in" | "!in" => BinaryOp::NotIn,
        "is" => BinaryOp::Is,
        "is not" | "!is" | "is!" => BinaryOp::IsNot,
        "instanceof" => BinaryOp::Instanceof,
        _ => return None,
    })
}

pub(crate) fn map_unary_op(op_str: &str, node_kind: &str, lang: LanguageId) -> Option<UnaryOp> {
    Some(match op_str {
        "!" | "not" => UnaryOp::Not,
        "+" => UnaryOp::Pos,
        "-" => UnaryOp::Neg,
        "~" => UnaryOp::BitNot,
        "^" if lang == LanguageId::Go => UnaryOp::BitNot,
        "&mut" | "& mut" => UnaryOp::RefMut,
        "&" => UnaryOp::Ref,
        "*" => UnaryOp::Deref,
        "++" => UnaryOp::Inc,
        "--" => UnaryOp::Dec,
        "typeof" => UnaryOp::Typeof,
        "void" => UnaryOp::Void,
        "delete" => UnaryOp::Delete,
        _ => match node_kind {
            "inc_statement" => UnaryOp::Inc,
            "dec_statement" => UnaryOp::Dec,
            _ => return None,
        },
    })
}
