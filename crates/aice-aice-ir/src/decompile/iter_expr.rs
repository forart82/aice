use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, named_children, node_text};
use crate::decompile::expr_common::{
    push_c_cast_task, push_cs_special_expr, push_index_task, push_new_array_task,
    push_template_task, push_yield_task,
};
use crate::decompile::expr_interp::{push_cs_interp_task, push_string_lit_task};
use crate::decompile::expr_lit_esc::{is_c_arrow_field, is_c_paren_unary, is_c_raw_member, is_cs_mod_arg, is_raw_passthrough_expr};
use crate::decompile::iter_env::{DTask, DecompEnv};
use crate::decompile::iter_expr_call::{push_call_task, push_object_task, push_php_array_task, push_rs_turbofish_task};
use crate::decompile::iter_expr_comp::{
    push_dart_type_test_task, push_py_comp_task, push_py_set_task, push_struct_expr_task, push_tuple_task,
};
use crate::decompile::iter_expr_fin::{
    push_binary_task, push_lambda_task, push_unary_task,
};
use crate::decompile::iter_match::push_match_task;
use crate::decompile::op_map::find_assign_parts;
use crate::ir_code::{AssignOp, BinaryOp, CompKind, Expr, LiteralVal, MemberKind, Stmt, UnaryOp};
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
    EmptyIndex(String),
    NewArray { has_init: bool },
    NewObjInit { callee_name: String, argc: usize, has_parens: bool },
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
    TypeCast { ty: String, quote_mode: u8 },
    Await,
    Closure { is_async: bool, is_generator: bool, is_move: bool, params: Vec<ParamDecl>, default_mask: Vec<bool>, destruct_stmts: Vec<Stmt>, ret: Option<AiceType>, body_kind: u8 },
    RubyBlock { params: Vec<ParamDecl>, has_body: bool },
    InlineJsx(bool),
    Tuple(usize),
    Comprehension { kind: CompKind, has_val: bool, clause_specs: Vec<(bool, String, usize)> },
}

pub(crate) fn push_expr_task<'a>(env: &mut DecompEnv<'a>, mut node: Node<'a>) {
    loop {
        match node.kind() {
            "parenthesized_expression" | "expression_statement" | "argument" => {
                if node.kind() == "argument" && env.lang == LanguageId::CSharp && is_cs_mod_arg(node) {
                    env.exprs.push(Expr::Raw(node_text(node, env.src).trim().into())); return;
                }
                if let Some(ch) = named_children(node).into_iter().next() {
                    if node.kind() == "parenthesized_expression" && ch.kind() == "named_expression" {
                        env.exprs.push(Expr::Ident(crate::decompile::ts_helpers::normalize_single_line(node_text(node, env.src))));
                        return;
                    }
                    node = ch;
                } else { env.exprs.push(Expr::Ident(node_text(node, env.src).trim().into())); return; }
            }
            "value_argument" if named_children(node).len() == 1 && !node_text(node, env.src).trim_start().starts_with('*') => {
                node = named_children(node)[0];
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
        k if is_raw_passthrough_expr(k, env.lang) => env.exprs.push(Expr::Raw(raw.to_string())),
        "qualified_identifier" if env.lang == LanguageId::Cpp && raw.contains('<') => env.exprs.push(Expr::Raw(raw.to_string())),
        "string" | "string_literal" | "interpreted_string_literal" | "raw_string_literal"
        | "verbatim_string_literal" | "raw_string" | "multiline_string_literal" => {
            push_string_lit_task(env, node, raw);
        }
        "encapsed_string" if env.lang == LanguageId::Php => push_string_lit_task(env, node, raw),
        "interpolated_string_expression" if env.lang == LanguageId::CSharp => push_cs_interp_task(env, node),
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
            crate::decompile::stmt_cf_util::push_cond_expr_task(env, node, raw);
        }
        "instance_variable" => env.exprs.push(Expr::Member {
            object: Box::new(Expr::Ident("this".into())), property: raw.trim_start_matches('@').into(), kind: MemberKind::Dot,
        }),
        "member_expression" | "field_expression" | "attribute" | "navigation_expression"
        | "selector_expression" | "scoped_identifier" | "member_access_expression"
        | "null_aware_member_expression" => {
            let kids: Vec<_> = named_children(node).into_iter()
                .filter(|c| c.kind() != "optional_chain").collect();
            if kids.len() >= 2 {
                let last = kids[kids.len() - 1];
                if is_c_raw_member(node, last, env.src, env.lang) { env.exprs.push(Expr::Raw(raw.to_string())); return; }
                let property = node_text(last, env.src).trim().trim_start_matches('.').to_string();
                let gap = env.src.get(kids[0].end_byte()..last.start_byte()).unwrap_or("");
                let is_opt = node.kind() == "null_aware_member_expression"
                    || child_by_kind(node, "optional_chain").is_some() || gap.contains("?.")
                    || (env.lang == LanguageId::Ruby && gap.contains("&."))
                    || (env.lang == LanguageId::Php && gap.contains("?->"))
                    || is_c_arrow_field(node, gap, env.src, env.lang);
                let kind = if is_opt { MemberKind::SafeNav } else if gap.contains("::") { MemberKind::Scope } else { MemberKind::Dot };
                env.tasks.push(DTask::FinishExpr(ExprFin::Member { property, kind }));
                if is_c_paren_unary(kids[0], env.lang) {
                    env.exprs.push(Expr::Raw(node_text(kids[0], env.src).trim().into()));
                } else { env.tasks.push(DTask::Expr(kids[0])); }
            } else { env.exprs.push(Expr::Ident(raw.to_string())); }
        }
        "generic_function" | "generic_type_with_turbofish" if env.lang == LanguageId::Rust => push_rs_turbofish_task(env, node, raw),
        "subscript_expression" | "index_expression" | "element_access_expression" | "array_access"
        | "null_aware_index_expression" => push_index_task(env, node, raw),
        "conditional_access_expression" if child_by_kind(node, "element_binding_expression").is_some() => push_index_task(env, node, raw),
        "call_expression" | "call" | "invocation_expression" | "method_invocation"
        | "function_call_expression" | "member_call_expression" | "object_creation_expression"
        | "implicit_object_creation_expression" | "new_expression" => push_call_task(env, node, raw),
        "binary_expression" | "binary_operator" | "boolean_operator" | "comparison_operator"
        | "binary" | "in_expression" | "equality_expression" | "relational_expression"
        | "additive_expression" | "multiplicative_expression" | "logical_and_expression"
        | "logical_or_expression" | "if_null_expression" | "bitwise_or_expression"
        | "bitwise_xor_expression" | "bitwise_and_expression" | "shift_expression" => {
            push_binary_task(env, node, raw);
        }
        "type_test_expression" if env.lang == LanguageId::Dart => push_dart_type_test_task(env, node, raw),
        "try_expression" if env.lang == LanguageId::Rust => {
            if let Some(inner) = named_children(node).into_iter().next() {
                env.tasks.push(DTask::FinishExpr(ExprFin::PostfixTry));
                env.tasks.push(DTask::Expr(inner));
            } else {
                env.exprs.push(Expr::Ident(raw.to_string()));
            }
        }
        "yield_expression" | "yield" if !raw.starts_with("yield from") => push_yield_task(env, node, raw),
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
        "struct_expression" => push_struct_expr_task(env, node),
        "tuple" | "tuple_expression" => push_tuple_task(env, node, raw),
        "expression_list" if env.lang == LanguageId::Python && named_children(node).len() >= 2 => {
            push_tuple_task(env, node, raw);
        }
        "set" if env.lang == LanguageId::Python => push_py_set_task(env, node),
        "list_comprehension" if env.lang == LanguageId::Python => push_py_comp_task(env, node, CompKind::List, raw),
        "dictionary_comprehension" if env.lang == LanguageId::Python => push_py_comp_task(env, node, CompKind::Dict, raw),
        "set_comprehension" if env.lang == LanguageId::Python => push_py_comp_task(env, node, CompKind::Set, raw),
        "generator_expression" if env.lang == LanguageId::Python => push_py_comp_task(env, node, CompKind::Generator, raw),
        "object" | "dictionary" | "hash" | "set_or_map_literal" => push_object_task(env, node, raw),
        "array_creation_expression" if env.lang == LanguageId::Php => push_php_array_task(env, node),
        "array_creation_expression" | "implicit_array_creation_expression" if matches!(env.lang, LanguageId::CSharp | LanguageId::Java) => push_new_array_task(env, node, raw),
        "initializer_expression" | "element_binding_expression" | "with_expression" | "anonymous_object_creation_expression" if env.lang == LanguageId::CSharp => push_cs_special_expr(env, node, raw),
        "array" | "array_expression" | "list" | "array_literal" | "list_literal" => {
            let xs: Vec<_> = named_children(node).into_iter()
                .filter(|c| !matches!(c.kind(), "type_arguments" | "type_argument_list")).collect();
            env.tasks.push(DTask::FinishExpr(ExprFin::Array(xs.len())));
            for c in xs.into_iter().rev() { env.tasks.push(DTask::Expr(c)); }
        }
        "arrow_function" | "closure_expression" | "lambda" | "lambda_expression"
        | "function_expression" | "generator_function" | "function_declaration" | "method_definition" => push_lambda_task(env, node),
        "cast_expression" if matches!(env.lang, LanguageId::C | LanguageId::Cpp | LanguageId::Java | LanguageId::CSharp | LanguageId::Php) => push_c_cast_task(env, node, raw),
        "type_cast_expression" | "as_expression" => {
            let val = node.child_by_field_name("value").or_else(|| named_children(node).into_iter().next());
            let ty = node.child_by_field_name("type").or_else(|| named_children(node).into_iter().nth(1));
            if let (Some(v), Some(t)) = (val, ty) {
                env.tasks.push(DTask::FinishExpr(ExprFin::TypeCast { ty: node_text(t, env.src).trim().into(), quote_mode: 0 }));
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
