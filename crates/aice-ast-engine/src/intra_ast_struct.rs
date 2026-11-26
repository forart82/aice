use aice_lang_registry::{IntraBlockKind, IntraBlockNode};

use crate::intra_ast_match::{error_handler_sub_rank, label_word_matches, starts_with_word};

pub(crate) struct TaggedIntraBlock {
    pub(crate) node: IntraBlockNode,
    pub(crate) ast_kind: Option<String>,
}

pub(crate) fn is_structural_block_keyword(pat: &str) -> bool {
    matches!(
        pat.to_ascii_lowercase().as_str(),
        "match"
            | "switch"
            | "if"
            | "else_if"
            | "for"
            | "while"
            | "loop"
            | "try"
            | "catch"
            | "finally"
            | "closure"
            | "lambda"
            | "cte"
            | "subquery"
    )
}

fn is_else_if_prefix(low: &str) -> bool {
    ["else if", "elseif", "elif", "elsif"]
        .iter()
        .any(|kw| starts_with_word(low, kw))
}

pub(crate) fn match_structural_keyword(
    kind: IntraBlockKind,
    ast_kind: Option<&str>,
    label: &str,
    pat: &str,
) -> Option<(u8, u8)> {
    let low = label.trim_start().to_ascii_lowercase();
    match pat.to_ascii_lowercase().as_str() {
        "match" => match ast_kind {
            Some("match_expression" | "match_statement" | "case_match" | "match_clause") => {
                Some((0, 0))
            }
            Some(
                "switch_statement"
                | "switch_expression"
                | "expression_switch_statement"
                | "type_switch_statement"
                | "when_expression"
                | "case"
                | "case_expression",
            ) => Some((1, 0)),
            Some("case_statement") => Some((1, 1)),
            None if kind == IntraBlockKind::Branch && starts_with_word(&low, "case") => {
                Some((1, 0))
            }
            _ => None,
        },
        "switch" => match ast_kind {
            Some(
                "switch_statement"
                | "switch_expression"
                | "expression_switch_statement"
                | "type_switch_statement",
            ) => Some((0, 0)),
            Some(
                "match_expression"
                | "match_statement"
                | "when_expression"
                | "case"
                | "case_match"
                | "case_expression",
            ) => Some((1, 0)),
            Some("case_statement") => Some((1, 1)),
            None if kind == IntraBlockKind::Branch && starts_with_word(&low, "case") => {
                Some((1, 0))
            }
            _ => None,
        },
        "if" => match ast_kind {
            Some(
                "if_statement"
                | "if_expression"
                | "if_element"
                | "if"
                | "if_modifier"
                | "preproc_if"
                | "preproc_ifdef",
            ) => Some((0, 0)),
            None if kind == IntraBlockKind::Branch && starts_with_word(&low, "if") => Some((0, 0)),
            _ => None,
        },
        "else_if" => match ast_kind {
            Some(
                "else_if_clause" | "elif_clause" | "elsif" | "preproc_elif" | "preproc_elifdef",
            ) => Some((0, 0)),
            Some("else_clause") if is_else_if_prefix(&low) => Some((0, 0)),
            None if kind == IntraBlockKind::Branch && is_else_if_prefix(&low) => Some((0, 0)),
            _ => None,
        },
        "for" => match ast_kind {
            Some(
                "for_statement"
                | "for_in_statement"
                | "for_expression"
                | "for_range_loop"
                | "foreach_statement"
                | "enhanced_for_statement"
                | "for_element"
                | "c_style_for_statement"
                | "for",
            ) => Some((0, 0)),
            None if kind == IntraBlockKind::Loop
                && (starts_with_word(&low, "for") || starts_with_word(&low, "foreach")) =>
            {
                Some((0, 0))
            }
            _ => None,
        },
        "while" => match ast_kind {
            Some(
                "while_statement"
                | "while_expression"
                | "do_while_statement"
                | "while"
                | "while_modifier",
            ) => Some((0, 0)),
            Some("do_statement") => Some((1, 0)),
            None if kind == IntraBlockKind::Loop && starts_with_word(&low, "while") => Some((0, 0)),
            _ => None,
        },
        "loop" => match ast_kind {
            Some("loop_expression") => Some((0, 0)),
            _ if kind == IntraBlockKind::Loop => {
                Some((if starts_with_word(&low, "loop") { 0 } else { 1 }, 0))
            }
            _ => None,
        },
        "try" => match ast_kind {
            Some(
                "try_statement"
                | "try_block"
                | "seh_try_statement"
                | "try_with_resources_statement"
                | "try_expression",
            ) => Some((0, 0)),
            Some("begin") if kind == IntraBlockKind::ErrorHandler => Some((1, 0)),
            None if kind == IntraBlockKind::ErrorHandler
                && (starts_with_word(&low, "try") || starts_with_word(&low, "begin try")) =>
            {
                Some((0, 0))
            }
            _ => None,
        },
        "catch" => match ast_kind {
            Some(
                "catch_clause"
                | "catch_block"
                | "except_clause"
                | "seh_except_clause"
                | "rescue"
                | "rescue_modifier"
                | "on",
            ) => {
                if starts_with_word(&low, "catch") {
                    Some((0, 0))
                } else if label_word_matches(label, "catch", false) {
                    Some((0, 1))
                } else {
                    Some((1, 0))
                }
            }
            None if kind == IntraBlockKind::ErrorHandler && error_handler_sub_rank(label) == 0 => {
                let tier =
                    if starts_with_word(&low, "catch") || starts_with_word(&low, "begin catch") {
                        0
                    } else {
                        1
                    };
                Some((tier, 0))
            }
            _ => None,
        },
        "finally" => match ast_kind {
            Some("finally_clause" | "finally_block" | "seh_finally_clause" | "ensure") => {
                Some((0, 0))
            }
            Some("defer_statement") => Some((1, 0)),
            None if kind == IntraBlockKind::ErrorHandler
                && (starts_with_word(&low, "finally") || starts_with_word(&low, "ensure")) =>
            {
                Some((0, 0))
            }
            _ => None,
        },
        "closure" if kind == IntraBlockKind::Closure => {
            Some((if ast_kind == Some("closure_expression") { 0 } else { 1 }, 0))
        }
        "lambda" if kind == IntraBlockKind::Closure => {
            let exact = matches!(
                ast_kind,
                Some("lambda" | "lambda_expression" | "lambda_literal")
            );
            Some((if exact { 0 } else { 1 }, 0))
        }
        "cte" if kind == IntraBlockKind::Cte => Some((0, 0)),
        "subquery" if kind == IntraBlockKind::Subquery => Some((0, 0)),
        _ => None,
    }
}
