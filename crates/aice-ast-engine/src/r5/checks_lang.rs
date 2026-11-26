use aice_lang_registry::LanguageId;

use crate::r5::checks::{ErrorSpan, span_from_node};

pub(crate) fn check_jsx_elements(tree: &tree_sitter::Tree, src: &str) -> Vec<ErrorSpan> {
    let mut errors = Vec::new();
    let mut cursor = tree.walk();
    loop {
        let node = cursor.node();
        if node.kind() == "jsx_element"
            && let (Some(open), Some(close)) = (
                node.child_by_field_name("open_tag"),
                node.child_by_field_name("close_tag"),
            )
            && let (Some(oname), Some(cname)) = (
                open.child_by_field_name("name"),
                close.child_by_field_name("name"),
            )
        {
            let o = src.get(oname.byte_range()).unwrap_or("").trim();
            let c = src.get(cname.byte_range()).unwrap_or("").trim();
            if !o.is_empty() && !c.is_empty() && o != c {
                let pos = close.start_position();
                errors.push(ErrorSpan {
                    line: pos.row + 1,
                    column: pos.column + 1,
                    end_line: pos.row + 1,
                    message: format!("Mismatched JSX closing tag '</{c}>' for '<{o}>'"),
                });
            }
        }
        if cursor.goto_first_child() {
            continue;
        }
        while !cursor.goto_next_sibling() {
            if !cursor.goto_parent() {
                return errors;
            }
        }
    }
}

pub(crate) fn check_keyword_operands(
    tree: &tree_sitter::Tree,
    src: &str,
    lang: LanguageId,
) -> Vec<ErrorSpan> {
    let mut errors = Vec::new();
    walk_keyword_operands(tree.root_node(), src, lang, &mut errors);
    errors
}

fn is_invalid_kw_text(lang: LanguageId, txt: &str) -> bool {
    match lang {
        LanguageId::Ruby => matches!(txt, "and" | "or"),
        LanguageId::Php => {
            txt.eq_ignore_ascii_case("and")
                || txt.eq_ignore_ascii_case("or")
                || txt.eq_ignore_ascii_case("xor")
        }
        _ => false,
    }
}

fn is_valid_ruby_kw_ident(node: tree_sitter::Node<'_>) -> bool {
    let Some(parent) = node.parent() else {
        return false;
    };
    let nid = node.id();
    match parent.kind() {
        "method" | "singleton_method" | "setter" | "keyword_parameter" => {
            parent.child_by_field_name("name").is_some_and(|n| n.id() == nid)
        }
        "call" => {
            parent.child_by_field_name("method").is_some_and(|n| n.id() == nid)
                && parent.child_by_field_name("receiver").is_some()
        }
        "alias" | "undef" | "symbol" | "hash_key_symbol" | "bare_symbol" => true,
        _ => false,
    }
}

fn walk_keyword_operands(
    root: tree_sitter::Node<'_>,
    src: &str,
    lang: LanguageId,
    errors: &mut Vec<ErrorSpan>,
) {
    let mut cursor = root.walk();
    loop {
        let node = cursor.node();
        if node.is_named() {
            if lang == LanguageId::Ruby {
                if node.kind() == "identifier"
                    && let Some(txt) = src.get(node.byte_range())
                    && is_invalid_kw_text(lang, txt)
                    && !is_valid_ruby_kw_ident(node)
                {
                    errors.push(span_from_node(node, format!("Syntax error: unexpected keyword '{txt}'")));
                }
            } else if lang == LanguageId::Php && node.kind() == "binary_expression" {
                for field in ["left", "right"] {
                    if let Some(child) = node.child_by_field_name(field)
                        && child.kind() == "name"
                        && let Some(txt) = src.get(child.byte_range())
                        && is_invalid_kw_text(lang, txt)
                    {
                        errors.push(span_from_node(child, format!("Syntax error: unexpected keyword '{txt}'")));
                    }
                }
            }
        }
        if cursor.goto_first_child() {
            continue;
        }
        while !cursor.goto_next_sibling() {
            if !cursor.goto_parent() {
                return;
            }
        }
    }
}
pub(crate) fn check_kotlin_spread(tree: &tree_sitter::Tree, src: &str) -> Vec<ErrorSpan> {
    let mut errors = Vec::new();
    walk_kotlin_spread(tree.root_node(), src, &mut errors);
    errors
}
fn walk_kotlin_spread(root: tree_sitter::Node<'_>, src: &str, errors: &mut Vec<ErrorSpan>) {
    let mut cursor = root.walk();
    loop {
        let node = cursor.node();
        if node.is_named() {
            let in_value_arg = node.parent().is_some_and(|p| p.kind() == "value_argument");
            if node.kind() == "spread_expression" && !in_value_arg {
                errors.push(span_from_node(
                    node,
                    "Syntax error: unexpected spread operator '*' outside value_argument".to_string(),
                ));
            } else if node.kind() == "prefix_expression" && !in_value_arg {
                let mut c2 = node.walk();
                if node.children(&mut c2).any(|c| !c.is_named() && src.get(c.byte_range()) == Some("*")) {
                    errors.push(span_from_node(
                        node,
                        "Syntax error: unexpected prefix '*' outside value_argument".to_string(),
                    ));
                }
            }
        }
        if cursor.goto_first_child() {
            continue;
        }
        while !cursor.goto_next_sibling() {
            if !cursor.goto_parent() {
                return;
            }
        }
    }
}

pub(crate) fn check_rust_fn_trait_params(tree: &tree_sitter::Tree) -> Vec<ErrorSpan> {
    let mut errors = Vec::new();
    let mut cursor = tree.walk();
    loop {
        let node = cursor.node();
        if node.kind() == "function_type"
            && node.child_by_field_name("trait").is_some()
            && let Some(params) = node.child_by_field_name("parameters")
        {
            let mut c2 = params.walk();
            for p in params.named_children(&mut c2) {
                if p.kind() == "parameter" && p.child_by_field_name("pattern").is_some() {
                    errors.push(span_from_node(
                        p,
                        "Syntax error: named parameter not allowed in Fn trait bound".to_string(),
                    ));
                }
            }
        }
        if cursor.goto_first_child() {
            continue;
        }
        while !cursor.goto_next_sibling() {
            if !cursor.goto_parent() {
                return errors;
            }
        }
    }
}
