use aice_lang_registry::{IntraBlockKind, LanguageId};

pub(crate) fn classify_ts_kind(lang: LanguageId, kind: &str) -> Option<IntraBlockKind> {
    use IntraBlockKind::{Branch, Closure, ErrorHandler, Loop, RuleBlock};
    match lang {
        LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript => match kind {
            "if_statement"
            | "else_clause"
            | "switch_statement"
            | "switch_case"
            | "switch_default"
            | "ternary_expression" => Some(Branch),
            "for_statement" | "for_in_statement" | "while_statement" | "do_statement" => Some(Loop),
            "try_statement" | "catch_clause" | "finally_clause" => Some(ErrorHandler),
            "arrow_function" | "function_expression" | "generator_function" => Some(Closure),
            "class_static_block" => Some(RuleBlock),
            _ => None,
        },
        LanguageId::Rust => match kind {
            "if_expression" | "else_clause" | "match_expression" | "match_arm" => Some(Branch),
            "for_expression" | "while_expression" | "loop_expression" => Some(Loop),
            "try_block" => Some(ErrorHandler),
            "closure_expression" => Some(Closure),
            "async_block" | "unsafe_block" | "const_block" => Some(RuleBlock),
            _ => None,
        },
        LanguageId::Python => match kind {
            "if_statement"
            | "elif_clause"
            | "else_clause"
            | "match_statement"
            | "case_clause"
            | "conditional_expression" => Some(Branch),
            "for_statement" | "while_statement" => Some(Loop),
            "try_statement" | "except_clause" | "finally_clause" | "with_statement" => {
                Some(ErrorHandler)
            }
            "lambda" => Some(Closure),
            _ => None,
        },
        LanguageId::Go => match kind {
            "if_statement"
            | "expression_switch_statement"
            | "type_switch_statement"
            | "select_statement"
            | "expression_case"
            | "type_case"
            | "default_case"
            | "communication_case" => Some(Branch),
            "for_statement" => Some(Loop),
            "defer_statement" => Some(ErrorHandler),
            "func_literal" => Some(Closure),
            _ => None,
        },
        LanguageId::C => match kind {
            "if_statement"
            | "else_clause"
            | "switch_statement"
            | "case_statement"
            | "conditional_expression"
            | "preproc_if"
            | "preproc_ifdef"
            | "preproc_elif"
            | "preproc_elifdef"
            | "preproc_else" => Some(Branch),
            "for_statement" | "while_statement" | "do_statement" => Some(Loop),
            "seh_try_statement" | "seh_except_clause" | "seh_finally_clause" => Some(ErrorHandler),
            _ => None,
        },
        LanguageId::Cpp => match kind {
            "if_statement"
            | "else_clause"
            | "switch_statement"
            | "case_statement"
            | "conditional_expression"
            | "preproc_if"
            | "preproc_ifdef"
            | "preproc_elif"
            | "preproc_elifdef"
            | "preproc_else" => Some(Branch),
            "for_statement" | "for_range_loop" | "while_statement" | "do_statement" => Some(Loop),
            "try_statement"
            | "catch_clause"
            | "seh_try_statement"
            | "seh_except_clause"
            | "seh_finally_clause" => Some(ErrorHandler),
            "lambda_expression" => Some(Closure),
            _ => None,
        },
        LanguageId::CSharp => match kind {
            "if_statement"
            | "switch_statement"
            | "switch_section"
            | "switch_expression"
            | "switch_expression_arm"
            | "conditional_expression"
            | "preproc_if"
            | "preproc_elif"
            | "preproc_else" => Some(Branch),
            "for_statement" | "foreach_statement" | "while_statement" | "do_statement" => {
                Some(Loop)
            }
            "try_statement" | "catch_clause" | "finally_clause" | "using_statement" => {
                Some(ErrorHandler)
            }
            "lambda_expression" | "anonymous_method_expression" => Some(Closure),
            _ => None,
        },
        LanguageId::Java => match kind {
            "if_statement"
            | "switch_expression"
            | "switch_block_statement_group"
            | "switch_rule"
            | "ternary_expression" => Some(Branch),
            "for_statement" | "enhanced_for_statement" | "while_statement" | "do_statement" => {
                Some(Loop)
            }
            "try_statement"
            | "try_with_resources_statement"
            | "catch_clause"
            | "finally_clause" => Some(ErrorHandler),
            "lambda_expression" => Some(Closure),
            "synchronized_statement" => Some(RuleBlock),
            _ => None,
        },
        LanguageId::Kotlin => match kind {
            "if_expression" | "when_expression" | "when_entry" => Some(Branch),
            "for_statement" | "while_statement" | "do_while_statement" => Some(Loop),
            "try_expression" | "catch_block" | "finally_block" => Some(ErrorHandler),
            "lambda_literal" | "anonymous_function" => Some(Closure),
            _ => None,
        },
        LanguageId::Dart => match kind {
            "if_statement"
            | "if_element"
            | "switch_statement"
            | "switch_statement_case"
            | "switch_statement_default"
            | "switch_expression"
            | "switch_expression_case"
            | "conditional_expression" => Some(Branch),
            "for_statement" | "for_element" | "while_statement" | "do_statement" => Some(Loop),
            "try_statement" | "finally_clause" => Some(ErrorHandler),
            "function_expression" => Some(Closure),
            _ => None,
        },
        LanguageId::Php => match kind {
            "if_statement"
            | "else_if_clause"
            | "else_clause"
            | "switch_statement"
            | "case_statement"
            | "default_statement"
            | "match_expression"
            | "match_conditional_expression"
            | "match_default_expression"
            | "conditional_expression" => Some(Branch),
            "for_statement" | "foreach_statement" | "while_statement" | "do_statement" => {
                Some(Loop)
            }
            "try_statement" | "catch_clause" | "finally_clause" => Some(ErrorHandler),
            "anonymous_function" | "arrow_function" => Some(Closure),
            _ => None,
        },
        LanguageId::Ruby => match kind {
            "if" | "elsif" | "else" | "unless" | "case" | "case_match" | "when"
            | "in_clause" | "conditional" | "if_modifier" | "unless_modifier" => Some(Branch),
            "for" | "while" | "until" | "while_modifier" | "until_modifier" => Some(Loop),
            "begin" | "rescue" | "ensure" | "rescue_modifier" => Some(ErrorHandler),
            "do_block" | "block" | "lambda" => Some(Closure),
            "begin_block" | "end_block" => Some(RuleBlock),
            _ => None,
        },
        LanguageId::Bash => match kind {
            "if_statement"
            | "elif_clause"
            | "else_clause"
            | "case_statement"
            | "case_item"
            | "ternary_expression" => Some(Branch),
            "for_statement" | "c_style_for_statement" | "while_statement" => Some(Loop),
            _ => None,
        },
        _ => classify_data_query_kind(lang, kind),
    }
}

fn classify_data_query_kind(lang: LanguageId, kind: &str) -> Option<IntraBlockKind> {
    use IntraBlockKind::{Branch, Cte, Loop, RuleBlock, Subquery};
    match lang {
        LanguageId::Css => matches!(
            kind,
            "rule_set"
                | "media_statement"
                | "keyframes_statement"
                | "keyframe_block"
                | "supports_statement"
                | "at_rule"
        )
        .then_some(RuleBlock),
        LanguageId::Html => {
            matches!(kind, "element" | "script_element" | "style_element").then_some(RuleBlock)
        }
        LanguageId::Xml => matches!(
            kind,
            "element" | "elementdecl" | "AttlistDecl" | "conditionalSect"
        )
        .then_some(RuleBlock),
        LanguageId::Markdown => matches!(
            kind,
            "section" | "fenced_code_block" | "block_quote" | "pipe_table" | "html_block"
        )
        .then_some(RuleBlock),
        LanguageId::Json => matches!(kind, "pair" | "object").then_some(RuleBlock),
        LanguageId::Yaml => {
            matches!(kind, "block_mapping_pair" | "flow_pair").then_some(RuleBlock)
        }
        LanguageId::Toml => {
            matches!(kind, "table" | "table_array_element" | "pair").then_some(RuleBlock)
        }
        LanguageId::AnsiSql | LanguageId::PostgreSql => match kind {
            "case" | "when_clause" => Some(Branch),
            "while_statement" => Some(Loop),
            "cte" => Some(Cte),
            "subquery" => Some(Subquery),
            "block" | "window_clause" | "window_specification" => Some(RuleBlock),
            _ => None,
        },
        LanguageId::Prisma => matches!(
            kind,
            "model_declaration"
                | "view_declaration"
                | "type_declaration"
                | "enum_declaration"
                | "datasource_declaration"
                | "generator_declaration"
                | "column_declaration"
        )
        .then_some(RuleBlock),
        LanguageId::GraphQl => matches!(
            kind,
            "operation_definition"
                | "fragment_definition"
                | "object_type_definition"
                | "object_type_extension"
                | "interface_type_definition"
                | "input_object_type_definition"
                | "enum_type_definition"
                | "selection_set"
                | "field"
                | "field_definition"
        )
        .then_some(RuleBlock),
        LanguageId::Cypher => match kind {
            "case_expression" | "case_when_clause" | "case_else_clause" => Some(Branch),
            "exists_subquery" | "call_clause" => Some(Subquery),
            "match_clause"
            | "with_clause"
            | "unwind_clause"
            | "create_clause"
            | "merge_clause"
            | "delete_clause"
            | "set_clause"
            | "return_clause"
            | "where_clause" => Some(RuleBlock),
            _ => None,
        },
        _ => None,
    }
}
