use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, named_children, node_span, node_text};
use crate::decompile::iter_env::{DTask, DecompEnv};
use crate::decompile::iter_expr::{ExprFin, ObjSlot};
use crate::decompile::trivia::is_comment_kind;
use crate::ir::{AiceItem, AiceModule, Trivia, Visibility};
use crate::ir_code::{AccessorKind, AssignOp, Expr, FnBody, MethodDecl, Stmt};
use crate::lexer_tokens::keyword_kind;

fn is_ident_body(s: &str) -> bool {
    let mut chars = s.chars();
    let Some(first) = chars.next() else { return false; };
    if !(first.is_ascii_alphabetic() || first == '_' || (!first.is_ascii() && first.is_alphabetic())) {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || (!c.is_ascii() && c.is_alphanumeric()))
}

pub(crate) fn is_safe_bare_ident(raw: &str) -> bool {
    if raw.is_empty() { return false; }
    if let Some(rest) = raw.strip_prefix('$').or_else(|| raw.strip_prefix(':')) {
        return is_ident_body(rest) && !matches!(rest, "true" | "false" | "nil");
    }
    if let Some(rest) = raw.strip_prefix('#') {
        return is_ident_body(rest)
            && !matches!(rest, "true" | "false" | "nil")
            && !(matches!(rest.len(), 3 | 4 | 6 | 8) && rest.bytes().all(|b| b.is_ascii_hexdigit()));
    }
    is_ident_body(raw) && keyword_kind(raw).is_none()
        && !matches!(raw, "raw" | "new" | "typeof" | "void" | "delete" | "yield" | "move" | "is" | "with" | "var")
}

pub(crate) fn ident_or_raw(raw: &str) -> Expr {
    let t = raw.trim();
    if is_safe_bare_ident(t) { Expr::Ident(t.to_string()) } else { Expr::Raw(t.to_string()) }
}

pub(crate) fn ident_node_or_raw(raw: &str) -> Expr {
    let t = raw.trim();
    if !t.is_empty()
        && !t.contains(char::is_whitespace)
        && !t.contains(['`', '"', '\'', '(', ')', '[', ']', '{', '}', ';', ',', '@'])
        && (is_ident_body(t)
            || t.strip_prefix('$').is_some_and(is_ident_body)
            || t.strip_prefix('#').is_some_and(|r| {
                is_ident_body(r)
                    && !(matches!(r.len(), 3 | 4 | 6 | 8) && r.bytes().all(|b| b.is_ascii_hexdigit()))
            }))
    {
        Expr::Ident(t.to_string())
    } else {
        Expr::Raw(t.to_string())
    }
}

fn dedent_raw_slice(raw: &str, src: &str, start_byte: usize) -> String {
    let trimmed = raw.trim_end();
    if !trimmed.contains('\n') {
        return trimmed.trim().to_string();
    }
    let sb = start_byte.min(src.len());
    let line_start = src[..sb].rfind('\n').map_or(0, |p| p + 1);
    let base_indent = src[line_start..sb].bytes().take_while(|b| *b == b' ' || *b == b'\t').count();
    let norm = trimmed.replace("\r\n", "\n");
    norm.split('\n').enumerate().map(|(i, line)| {
        if i == 0 {
            line.trim_start()
        } else {
            let strip = line.bytes().take(base_indent).take_while(|b| *b == b' ' || *b == b'\t').count();
            &line[strip..]
        }
    }).collect::<Vec<_>>().join("\n")
}

pub(crate) fn dedent_node_text(node: Node<'_>, src: &str) -> String {
    dedent_raw_slice(node_text(node, src), src, node.start_byte())
}

pub(crate) fn is_known_expr_node_kind(kind: &str, lang: LanguageId) -> bool {
    if kind == "macro_invocation" && lang == LanguageId::Rust {
        return true;
    }
    matches!(
        kind,
        "parenthesized_expression" | "parenthesized_statements" | "argument" | "value_argument" | "expression_list"
            | "condition_clause" | "control_structure_body" | "assignable_expression"
            | "number" | "integer" | "integer_literal" | "int_literal" | "number_literal"
            | "decimal_integer_literal" | "hex_integer_literal" | "binary_integer_literal"
            | "octal_integer_literal" | "hex_literal" | "bin_literal" | "long_literal"
            | "unsigned_literal" | "float" | "float_literal" | "decimal_floating_point_literal"
            | "real_literal" | "hex_floating_point_literal"
            | "true" | "false" | "boolean_literal" | "boolean" | "null" | "nil" | "none" | "None" | "null_literal"
            | "string" | "string_literal" | "interpreted_string_literal" | "raw_string_literal"
            | "verbatim_string_literal" | "raw_string" | "multiline_string_literal"
            | "encapsed_string" | "interpolated_string_expression" | "template_string" | "regex"
            | "simple_symbol" | "char_literal" | "character_literal" | "rune_literal"
            | "byte_literal" | "byte_string_literal" | "raw_byte_string_literal"
            | "c_string_literal" | "raw_c_string_literal"
            | "identifier" | "type_identifier" | "property_identifier" | "field_identifier"
            | "private_property_identifier" | "simple_identifier" | "this" | "self" | "super"
            | "this_expression" | "super_expression" | "variable_name" | "constant"
            | "shorthand_property_identifier" | "shorthand_property_identifier_pattern"
            | "shorthand_field_initializer" | "instance_variable"
            | "spread_element" | "ternary_expression" | "conditional_expression" | "conditional"
            | "member_expression" | "field_expression" | "field_access" | "attribute" | "navigation_expression"
            | "selector_expression" | "scoped_identifier" | "qualified_identifier" | "member_access_expression"
            | "null_aware_member_expression" | "generic_function" | "generic_type_with_turbofish"
            | "subscript_expression" | "subscript" | "index_expression" | "element_access_expression"
            | "element_reference" | "array_access" | "null_aware_index_expression" | "conditional_access_expression"
            | "call_expression" | "call" | "invocation_expression" | "method_invocation"
            | "function_call_expression" | "member_call_expression" | "object_creation_expression"
            | "implicit_object_creation_expression" | "new_expression"
            | "binary_expression" | "binary_operator" | "boolean_operator" | "comparison_operator"
            | "binary" | "in_expression" | "equality_expression" | "relational_expression"
            | "additive_expression" | "multiplicative_expression" | "logical_and_expression"
            | "logical_or_expression" | "if_null_expression" | "bitwise_or_expression"
            | "bitwise_xor_expression" | "bitwise_and_expression" | "shift_expression"
            | "type_test_expression" | "non_null_expression" | "null_assertion_expression"
            | "yield_expression" | "yield" | "unary_expression" | "unary_operator"
            | "not_operator" | "prefix_unary_expression" | "update_expression"
            | "postfix_unary_expression" | "pointer_expression" | "unary" | "unary_op_expression"
            | "inc_statement" | "dec_statement" | "postfix_expression" | "reference_expression"
            | "struct_expression" | "tuple" | "tuple_expression" | "unit_expression" | "set"
            | "list_comprehension" | "dictionary_comprehension" | "set_comprehension"
            | "generator_expression" | "object" | "dictionary" | "hash" | "set_or_map_literal"
            | "array_creation_expression" | "implicit_array_creation_expression"
            | "initializer_expression" | "element_binding_expression" | "with_expression"
            | "anonymous_object_creation_expression" | "array" | "array_expression" | "list"
            | "array_literal" | "list_literal" | "arrow_function" | "closure_expression"
            | "lambda" | "lambda_expression" | "function_expression" | "generator_function"
            | "cast_expression" | "type_cast_expression" | "as_expression"
            | "jsx_element" | "jsx_self_closing_element" | "jsx_fragment" | "await_expression"
    )
}

pub(crate) fn push_expr_fallback<'a>(env: &mut DecompEnv<'a>, node: Node<'a>, raw: &str) {
    match node.kind() {
        "macro_invocation" if env.lang == LanguageId::Rust => {
            env.exprs.push(if crate::lexer::lex(raw).is_ok() { Expr::Ident(raw.to_string()) } else { Expr::Raw(raw.to_string()) });
        }
        "block" if env.lang == LanguageId::Rust && child_by_kind(node, "label").is_none() && !raw.contains('\n') => {
            let kids: Vec<_> = named_children(node).into_iter().filter(|c| !is_comment_kind(c.kind())).collect();
            if kids.len() == 1 && is_known_expr_node_kind(kids[0].kind(), env.lang) && !raw.contains(';') {
                env.tasks.push(DTask::FinishExpr(ExprFin::Object(vec![ObjSlot::Shorthand])));
                env.tasks.push(DTask::Expr(kids[0]));
            } else {
                env.exprs.push(Expr::Raw(raw.to_string()));
            }
        }
        "pattern_list" | "left_assignment_list" | "right_assignment_list"
            if !raw.contains('\n') && crate::lexer::lex(raw).is_ok() =>
        {
            env.exprs.push(Expr::Ident(raw.to_string()));
        }
        "expression_list" if env.lang == LanguageId::Go && !raw.contains('\n') && crate::lexer::lex(raw).is_ok() => {
            env.exprs.push(Expr::Ident(raw.to_string()));
        }
        "assignable_expression" if env.lang == LanguageId::Dart => {
            env.exprs.push(crate::decompile::dart_params::decompile_dart_assignable(node, env.src)
                .unwrap_or_else(|| ident_or_raw(raw)));
        }
        "keyword_argument" if env.lang == LanguageId::Python => {
            if let (Some(n), Some(v)) = (node.child_by_field_name("name"), node.child_by_field_name("value")) {
                env.tasks.push(DTask::FinishExpr(ExprFin::Assign(AssignOp::Assign)));
                env.tasks.push(DTask::Expr(v)); env.tasks.push(DTask::Expr(n));
            } else { env.exprs.push(ident_or_raw(raw)); }
        }
        "value_argument" if env.lang == LanguageId::Kotlin => {
            let ks: Vec<_> = named_children(node).into_iter().filter(|c| !is_comment_kind(c.kind())).collect();
            if ks.len() == 2 && !raw.starts_with('*') && env.src.get(ks[0].end_byte()..ks[1].start_byte()).is_some_and(|g| g.trim() == "=") {
                env.tasks.push(DTask::FinishExpr(ExprFin::Assign(AssignOp::Assign)));
                env.tasks.push(DTask::Expr(ks[1])); env.tasks.push(DTask::Expr(ks[0]));
            } else { env.exprs.push(ident_or_raw(raw)); }
        }
        _ => env.exprs.push(ident_or_raw(raw)),
    }
}

pub(crate) fn try_multi_assign_stmt(node: Node<'_>, src: &str, lang: LanguageId) -> Option<Stmt> {
    if !matches!(lang, LanguageId::Go | LanguageId::Python | LanguageId::Ruby) {
        return None;
    }
    let raw = node_text(node, src).trim();
    if raw.contains('\n') {
        return None;
    }
    let lhs = node.child_by_field_name("left")?;
    let rhs = node.child_by_field_name("right")?;
    let gap = src.get(lhs.end_byte()..rhs.start_byte())?.trim();
    if gap != "=" {
        return None;
    }
    let lhs_s = node_text(lhs, src).trim();
    let rhs_s = node_text(rhs, src).trim();
    if lhs_s.is_empty() || rhs_s.is_empty() || crate::lexer::lex(raw).is_err() {
        return None;
    }
    Some(Stmt::Assign {
        target: Expr::Ident(lhs_s.to_string()),
        op: AssignOp::Assign,
        value: Expr::Ident(rhs_s.to_string()),
        trivia: Trivia::default(),
    })
}

pub(crate) fn is_non_trivia_fallback(node: Node<'_>, src: &str) -> bool {
    if !node.is_named() || is_comment_kind(node.kind()) {
        return false;
    }
    if matches!(
        node.kind(),
        "empty_statement" | "empty_declaration" | "semicolon" | ";" | "pass_statement"
    ) {
        return false;
    }
    let t = node_text(node, src).trim();
    !t.is_empty() && t != ";"
}

pub(crate) fn push_top_directive_vec(
    out: &mut Vec<AiceItem>,
    node: Node<'_>,
    src: &str,
    trivia: Trivia,
) {
    if !is_non_trivia_fallback(node, src) {
        return;
    }
    let text = dedent_node_text(node, src);
    if !text.is_empty() {
        out.push(AiceItem::Directive { text, trivia, span: node_span(node) });
    }
}

pub(crate) fn push_top_directive(m: &mut AiceModule, node: Node<'_>, src: &str, trivia: Trivia) {
    push_top_directive_vec(&mut m.items, node, src, trivia);
}

pub(crate) fn push_raw_member_span(
    methods: &mut Vec<MethodDecl>,
    start_node: Node<'_>,
    end_node: Node<'_>,
    src: &str,
    vis: Visibility,
    trivia: Trivia,
) {
    let sb = start_node.start_byte().min(src.len());
    let eb = end_node.end_byte().min(src.len());
    if eb <= sb { return; }
    let text = dedent_raw_slice(&src[sb..eb], src, sb);
    if text.is_empty() || text == ";" { return; }
    let mut sp = node_span(start_node);
    sp.end_byte = eb;
    methods.push(MethodDecl {
        vis, is_static: false, is_async: false, is_const: false,
        accessor: AccessorKind::Raw, name: text,
        type_params: Vec::new(), params: Vec::new(), return_type: None,
        body: FnBody::SignatureOnly, trivia, span: sp,
    });
}

pub(crate) fn push_raw_member(
    methods: &mut Vec<MethodDecl>,
    node: Node<'_>,
    src: &str,
    vis: Visibility,
    trivia: Trivia,
) {
    if !is_non_trivia_fallback(node, src) { return; }
    let text = dedent_node_text(node, src);
    if !text.is_empty() {
        methods.push(MethodDecl {
            vis, is_static: false, is_async: false, is_const: false,
            accessor: AccessorKind::Raw, name: text,
            type_params: Vec::new(), params: Vec::new(), return_type: None,
            body: FnBody::SignatureOnly, trivia, span: node_span(node),
        });
    }
}
