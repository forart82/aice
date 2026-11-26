use aice_lang_registry::LanguageId;

use crate::r5::cst_helpers::node_text;

pub(crate) fn extract_type_ref(
    lang: LanguageId,
    node: tree_sitter::Node<'_>,
    parent: Option<tree_sitter::Node<'_>>,
    src: &str,
) -> Option<String> {
    let raw = match node.kind() {
        "type_identifier" | "scoped_type_identifier" | "qualified_type" => node_text(node, src),
        "user_type" if lang == LanguageId::Kotlin => node_text(node, src),
        "named_type" if lang == LanguageId::Php => node_text(node, src),
        "type" if lang == LanguageId::Python => {
            if matches!(
                parent.map(|p| p.kind()),
                Some(
                    "typed_parameter"
                        | "typed_default_parameter"
                        | "function_definition"
                        | "assignment"
                        | "annotation"
                        | "type_alias_statement"
                )
            ) {
                node_text(node, src)
            } else {
                return None;
            }
        }
        "identifier" | "qualified_name" if lang == LanguageId::CSharp => {
            let p = parent?;
            if p.child_by_field_name("type") == Some(node) {
                node_text(node, src)
            } else {
                return None;
            }
        }
        "constant"
            if lang == LanguageId::Ruby && parent.is_some_and(|p| p.kind() == "superclass") =>
        {
            node_text(node, src)
        }
        _ => return None,
    };
    if is_decl_name_node(node, parent) {
        return None;
    }
    clean_symbol_ref(raw)
}

fn is_decl_name_node(
    node: tree_sitter::Node<'_>,
    parent: Option<tree_sitter::Node<'_>>,
) -> bool {
    let Some(p) = parent else { return false };
    let is_type_decl = matches!(
        p.kind(),
        "struct_item"
            | "enum_item"
            | "trait_item"
            | "type_item"
            | "union_item"
            | "class_declaration"
            | "abstract_class_declaration"
            | "interface_declaration"
            | "type_alias_declaration"
            | "enum_declaration"
            | "class_definition"
            | "type_spec"
            | "type_alias"
            | "struct_specifier"
            | "enum_specifier"
            | "class_specifier"
            | "struct_declaration"
            | "record_declaration"
            | "object_declaration"
            | "mixin_declaration"
            | "extension_declaration"
            | "extension_type_declaration"
            | "class"
            | "module"
    );
    is_type_decl && p.child_by_field_name("name") == Some(node)
}

pub(crate) fn extract_call_target(
    lang: LanguageId,
    node: tree_sitter::Node<'_>,
    src: &str,
) -> Option<String> {
    let raw = match node.kind() {
        "call_expression" => node
            .child_by_field_name("function")
            .or_else(|| (lang == LanguageId::Kotlin).then(|| node.named_child(0)).flatten())
            .map(|n| node_text(n, src)),
        "method_call_expression" => node.child_by_field_name("name").map(|n| node_text(n, src)),
        "macro_invocation" => node.child_by_field_name("macro").map(|n| node_text(n, src)),
        "new_expression" => node
            .child_by_field_name("constructor")
            .or_else(|| node.child_by_field_name("type"))
            .map(|n| node_text(n, src)),
        "call" => {
            if lang == LanguageId::Ruby {
                let m = node.child_by_field_name("method").map(|n| node_text(n, src).trim())?;
                if matches!(m, "require" | "require_relative") {
                    return None;
                }
                Some(m)
            } else {
                node.child_by_field_name("function").map(|n| node_text(n, src))
            }
        }
        "invocation_expression" => node.child_by_field_name("function").map(|n| node_text(n, src)),
        "object_creation_expression" => node.child_by_field_name("type").map(|n| node_text(n, src)),
        "method_invocation" => {
            let name = node.child_by_field_name("name").map(|n| node_text(n, src).trim())?;
            if let Some(obj) = node.child_by_field_name("object") {
                return clean_symbol_ref(&format!("{}.{name}", node_text(obj, src).trim()));
            }
            Some(name)
        }
        "function_call_expression" => {
            node.child_by_field_name("function").map(|n| node_text(n, src))
        }
        "member_call_expression" => node.child_by_field_name("name").map(|n| node_text(n, src)),
        "scoped_call_expression" => {
            let sc = node.child_by_field_name("scope").map(|n| node_text(n, src).trim())?;
            let nm = node.child_by_field_name("name").map(|n| node_text(n, src).trim())?;
            return clean_symbol_ref(&format!("{sc}::{nm}"));
        }
        _ => None,
    }?;
    clean_symbol_ref(raw)
}

fn clean_symbol_ref(raw: &str) -> Option<String> {
    let base = raw.split(['<', '(', '[']).next().unwrap_or(raw).trim();
    if base.is_empty() || base.len() > 80 || base.contains('\n') {
        None
    } else {
        Some(base.split_whitespace().collect::<String>())
    }
}

pub(crate) fn is_builtin_type(ty: &str) -> bool {
    matches!(
        ty,
        "void" | "bool" | "boolean" | "number" | "string" | "any" | "unknown" | "never"
            | "object" | "null" | "undefined" | "int" | "float" | "double" | "char" | "str"
            | "usize" | "isize" | "Self" | "self" | "i8" | "i16" | "i32" | "i64" | "i128"
            | "u8" | "u16" | "u32" | "u64" | "u128" | "f32" | "f64" | "error" | "rune"
            | "byte" | "short" | "long" | "dynamic" | "var" | "val"
    )
}
