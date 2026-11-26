use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, named_children, node_text, strip_quotes};
use crate::decompile::expr_common::{push_index_task, push_template_task};
use crate::decompile::expr_lit::decompile_string_lit;
use crate::decompile::iter_env::{DTask, DecompEnv};
use crate::decompile::iter_expr_call::{push_call_task, push_object_task, push_php_array_task};
use crate::decompile::iter_expr_fin::{
    push_binary_task, push_lambda_task, push_unary_task,
};
use crate::decompile::iter_match::push_match_task;
use crate::decompile::op_map::find_assign_parts;
use crate::decompile::trivia::is_comment_kind;
use crate::ir_code::{AssignOp, BinaryOp, Expr, LiteralVal, MemberKind, Stmt, UnaryOp};
use crate::ir_types::{AiceType, ParamDecl};

pub(crate) enum ObjSlot {
    Field(String),
    Shorthand,
    Spread,
}

pub(crate) enum ExprFin {
    Conditional,
    Member { property: String, kind: MemberKind },
    Index { is_optional: bool, argc: usize },
    Call { has_callee_expr: bool, callee_name: String, recv_prop: Option<String>, recv_safe: bool, argc: usize, has_ruby_blk: bool, is_optional: bool, is_new: bool },
    Template { quasis: Vec<String> },
    TaggedTemplate,
    RubyNilCheck,
    Binary(BinaryOp),
    BinaryIdentRhs(BinaryOp, String),
    Unary { op: UnaryOp, is_postfix: bool },
    PostfixTry,
    Assign(AssignOp),
    StructExpr { sname: String, slots: Vec<ObjSlot> },
    Object(Vec<ObjSlot>),
    Array(usize),
    TypeCast(String),
    Await,
    Closure { is_async: bool, params: Vec<ParamDecl>, default_mask: Vec<bool>, destruct_stmts: Vec<Stmt>, ret: Option<AiceType>, body_kind: u8 },
    RubyBlock { params: Vec<ParamDecl>, has_body: bool },
    InlineJsx(bool),
}

pub(crate) fn push_expr_task<'a>(env: &mut DecompEnv<'a>, mut node: Node<'a>) {
    loop {
        match node.kind() {
            "parenthesized_expression" | "expression_statement" | "argument" => {
                if let Some(ch) = named_children(node).into_iter().next() {
                    if node.kind() == "parenthesized_expression" && ch.kind() == "named_expression" {
                        let txt = crate::decompile::ts_helpers::normalize_single_line(node_text(node, env.src));
                        env.exprs.push(Expr::Ident(txt));
                        return;
                    }
                    node = ch;
                } else {
                    env.exprs.push(Expr::Ident(node_text(node, env.src).trim().into()));
                    return;
                }
            }
            "expression_list" if named_children(node).len() == 1 => { node = named_children(node)[0]; }
            "condition_clause" => {
                if node.child_by_field_name("initializer").is_none()
                    && let Some(val) = node.child_by_field_name("value")
                    && !matches!(val.kind(), "declaration" | "comma_expression")
                {
                    node = val;
                } else {
                    env.exprs.push(Expr::Ident(node_text(node, env.src).trim().into()));
                    return;
                }
            }
            "control_structure_body" => {
                let mut cur = node;
                if let Some(ch) = named_children(cur).into_iter().next() { cur = ch; }
                if matches!(cur.kind(), "block" | "statements") {
                    let kids = named_children(cur);
                    if kids.len() == 1 { node = kids[0]; continue; }
                }
                if cur.id() != node.id() { node = cur; continue; }
                env.exprs.push(Expr::Ident(node_text(node, env.src).trim().into()));
                return;
            }
            _ => break,
        }
    }
    let raw = node_text(node, env.src).trim();
    match node.kind() {
        "number" | "integer" | "integer_literal" | "number_literal" | "decimal_integer_literal" => {
            env.exprs.push(Expr::Literal(LiteralVal::Int(raw.to_string())));
        }
        "float" | "float_literal" | "decimal_floating_point_literal" => {
            env.exprs.push(Expr::Literal(LiteralVal::Float(raw.to_string())));
        }
        "true" | "boolean_literal" if raw == "true" || raw == "True" => env.exprs.push(Expr::Literal(LiteralVal::Bool(true))),
        "false" | "boolean_literal" if raw == "false" || raw == "False" => env.exprs.push(Expr::Literal(LiteralVal::Bool(false))),
        "null" | "nil" | "none" | "None" | "null_literal" => env.exprs.push(Expr::Literal(LiteralVal::Nil)),
        "string" | "string_literal" | "interpreted_string_literal" | "raw_string_literal"
        | "verbatim_string_literal" | "byte_string_literal" | "raw_byte_string_literal"
        | "c_string_literal" | "raw_c_string_literal" | "raw_string"
        | "char_literal" | "character_literal" => {
            env.exprs.push(decompile_string_lit(raw, env.lang));
        }
        "template_string" => push_template_task(env, node, false),
        "identifier" | "type_identifier" | "property_identifier" | "field_identifier"
        | "private_property_identifier" | "simple_identifier" | "this" | "self"
        | "super" | "variable_name" | "constant" | "shorthand_property_identifier"
        | "shorthand_property_identifier_pattern" | "shorthand_field_initializer" => {
            env.exprs.push(Expr::Ident(raw.to_string()));
        }
        "spread_element" => {
            if let Some(inner) = named_children(node).into_iter().next() {
                env.tasks.push(DTask::FinishExpr(ExprFin::Unary { op: UnaryOp::Spread, is_postfix: false }));
                env.tasks.push(DTask::Expr(inner));
            } else {
                env.exprs.push(Expr::Ident(raw.to_string()));
            }
        }
        "regex" => env.exprs.push(Expr::Literal(LiteralVal::Regex(raw.to_string()))),
        "ternary_expression" | "conditional_expression" | "if_expression" | "conditional" => {
            let kids: Vec<_> = named_children(node)
                .into_iter()
                .filter(|c| !is_comment_kind(c.kind()))
                .collect();
            if env.lang == LanguageId::Php
                && node.kind() == "conditional_expression"
                && node.child_by_field_name("body").is_none()
                && kids.len() == 2
            {
                env.tasks.push(DTask::FinishExpr(ExprFin::Binary(BinaryOp::Elvis)));
                env.tasks.push(DTask::Expr(kids[1]));
                env.tasks.push(DTask::Expr(kids[0]));
                return;
            }
            let (cond, then_n, raw_else) = if env.lang == LanguageId::Python && node.kind() == "conditional_expression" {
                (kids.get(1).copied(), kids.first().copied(), kids.get(2).copied())
            } else {
                (
                    node.child_by_field_name("condition").or_else(|| kids.first().copied()),
                    node.child_by_field_name("consequence")
                        .or_else(|| node.child_by_field_name("body"))
                        .or_else(|| kids.get(1).copied()),
                    node.child_by_field_name("alternative").or_else(|| kids.get(2).copied()),
                )
            };
            let else_n = raw_else.map(|e| {
                if e.kind() == "else_clause" {
                    named_children(e).into_iter().find(|c| !is_comment_kind(c.kind())).unwrap_or(e)
                } else {
                    e
                }
            });
            if let (Some(c), Some(t), Some(e)) = (cond, then_n, else_n) {
                env.tasks.push(DTask::FinishExpr(ExprFin::Conditional));
                env.tasks.push(DTask::Expr(e));
                env.tasks.push(DTask::Expr(t));
                env.tasks.push(DTask::Expr(c));
            } else { env.exprs.push(Expr::Ident(raw.to_string())); }
        }
        "instance_variable" => env.exprs.push(Expr::Member {
            object: Box::new(Expr::Ident("this".into())), property: raw.trim_start_matches('@').into(), kind: MemberKind::Dot,
        }),
        "member_expression" | "field_expression" | "attribute" | "navigation_expression"
        | "selector_expression" | "scoped_identifier" | "member_access_expression" => {
            let kids: Vec<_> = named_children(node).into_iter()
                .filter(|c| c.kind() != "optional_chain").collect();
            if kids.len() >= 2 {
                let last = kids[kids.len() - 1];
                let property = node_text(last, env.src).trim().trim_start_matches('.').to_string();
                let gap = env.src.get(kids[0].end_byte()..last.start_byte()).unwrap_or("");
                let is_opt = child_by_kind(node, "optional_chain").is_some()
                    || gap.contains("?.")
                    || (env.lang == LanguageId::Ruby && gap.contains("&."))
                    || (env.lang == LanguageId::Php && gap.contains("?->"));
                let kind = if is_opt { MemberKind::SafeNav } else if gap.contains("::") { MemberKind::Scope } else { MemberKind::Dot };
                env.tasks.push(DTask::FinishExpr(ExprFin::Member { property, kind }));
                env.tasks.push(DTask::Expr(kids[0]));
            } else { env.exprs.push(Expr::Ident(raw.to_string())); }
        }
        "subscript_expression" | "index_expression" | "element_access_expression" | "array_access" => {
            push_index_task(env, node, raw);
        }
        "conditional_access_expression" if child_by_kind(node, "element_binding_expression").is_some() => {
            push_index_task(env, node, raw);
        }
        "call_expression" | "call" | "invocation_expression" | "method_invocation"
        | "function_call_expression" | "member_call_expression" | "object_creation_expression"
        | "implicit_object_creation_expression" | "new_expression" => push_call_task(env, node, raw),
        "binary_expression" | "binary_operator" | "boolean_operator" | "comparison_operator"
        | "binary" | "in_expression" => {
            push_binary_task(env, node, raw);
        }
        "try_expression" if env.lang == LanguageId::Rust => {
            if let Some(inner) = named_children(node).into_iter().next() {
                env.tasks.push(DTask::FinishExpr(ExprFin::PostfixTry));
                env.tasks.push(DTask::Expr(inner));
            } else {
                env.exprs.push(Expr::Ident(raw.to_string()));
            }
        }
        "yield_expression" | "yield" if !raw.starts_with("yield from") && !raw.starts_with("yield*") => {
            if let Some(arg) = named_children(node).into_iter().next() {
                env.tasks.push(DTask::FinishExpr(ExprFin::Unary { op: UnaryOp::Yield, is_postfix: false }));
                env.tasks.push(DTask::Expr(arg));
            } else {
                env.exprs.push(Expr::Ident(raw.to_string()));
            }
        }
        "unary_expression" | "unary_operator" | "not_operator" | "prefix_unary_expression"
        | "update_expression" | "postfix_unary_expression" | "pointer_expression" | "unary"
        | "unary_op_expression" | "inc_statement" | "dec_statement" => {
            push_unary_task(env, node, raw);
        }
        "postfix_expression" if env.lang == LanguageId::Dart => push_unary_task(env, node, raw),
        "reference_expression" => {
            let is_mut = raw.starts_with("&mut ") || raw.starts_with("& mut ") || child_by_kind(node, "mutable_specifier").is_some();
            let op = if is_mut { UnaryOp::RefMut } else { UnaryOp::Ref };
            if let Some(val) = node.child_by_field_name("value").or_else(|| named_children(node).into_iter().last()) {
                env.tasks.push(DTask::FinishExpr(ExprFin::Unary { op, is_postfix: false }));
                env.tasks.push(DTask::Expr(val));
            } else { env.exprs.push(Expr::Ident(raw.to_string())); }
        }
        "assignment_expression" | "augmented_assignment_expression" | "compound_assignment_expr"
        | "augmented_assignment" | "operator_assignment" => {
            if let Some((op, tgt, val)) = find_assign_parts(node, env.src) {
                env.tasks.push(DTask::FinishExpr(ExprFin::Assign(op)));
                env.tasks.push(DTask::Expr(val));
                env.tasks.push(DTask::Expr(tgt));
            } else { env.exprs.push(Expr::Ident(raw.to_string())); }
        }
        "struct_expression" => {
            let sname = field_text(node, "name", env.src).unwrap_or("Struct").trim().to_string();
            let (mut slots, mut vals) = (Vec::new(), Vec::new());
            if let Some(body) = node.child_by_field_name("body") {
                for ch in named_children(body) {
                    match ch.kind() {
                        "field_initializer" => {
                            let k = field_text(ch, "field", env.src).or_else(|| field_text(ch, "name", env.src)).map(strip_quotes);
                            let vn = ch.child_by_field_name("value").or_else(|| named_children(ch).into_iter().last());
                            if let (Some(key), Some(v)) = (k, vn) { slots.push(ObjSlot::Field(key)); vals.push(v); }
                        }
                        "shorthand_field_initializer" => {
                            let id = child_by_kind(ch, "identifier").unwrap_or(ch);
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
            for v in vals.into_iter().rev() { env.tasks.push(DTask::Expr(v)); }
        }
        "object" | "dictionary" | "hash" | "set_or_map_literal" => push_object_task(env, node, raw),
        "array_creation_expression" => push_php_array_task(env, node),
        "array" | "array_expression" | "list" | "array_literal" | "list_literal" => {
            let xs: Vec<_> = named_children(node).into_iter()
                .filter(|c| !matches!(c.kind(), "type_arguments" | "type_argument_list")).collect();
            env.tasks.push(DTask::FinishExpr(ExprFin::Array(xs.len())));
            for c in xs.into_iter().rev() { env.tasks.push(DTask::Expr(c)); }
        }
        "arrow_function" | "closure_expression" | "lambda" | "lambda_expression"
        | "function_expression" | "function_declaration" | "method_definition" => push_lambda_task(env, node),
        "type_cast_expression" | "as_expression" => {
            let val = node.child_by_field_name("value").or_else(|| named_children(node).into_iter().next());
            let ty = node.child_by_field_name("type").or_else(|| named_children(node).into_iter().nth(1));
            if let (Some(v), Some(t)) = (val, ty) {
                env.tasks.push(DTask::FinishExpr(ExprFin::TypeCast(node_text(t, env.src).trim().into())));
                env.tasks.push(DTask::Expr(v));
            } else { env.exprs.push(Expr::Ident(raw.to_string())); }
        }
        "match_expression" | "when_expression" | "case" => push_match_task(env, node, true),
        "jsx_element" | "jsx_self_closing_element" | "jsx_fragment" => {
            env.tasks.push(DTask::FinishExpr(ExprFin::InlineJsx(node.kind() == "jsx_fragment")));
            env.tasks.push(DTask::JsxNode(node));
        }
        "await_expression" => {
            if let Some(c) = named_children(node).into_iter().next() {
                env.tasks.push(DTask::FinishExpr(ExprFin::Await));
                env.tasks.push(DTask::Expr(c));
            } else { env.exprs.push(Expr::Ident(raw.to_string())); }
        }
        _ => env.exprs.push(Expr::Ident(raw.to_string())),
    }
}
