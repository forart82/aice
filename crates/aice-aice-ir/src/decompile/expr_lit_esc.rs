use aice_lang_registry::LanguageId;

use crate::ir_code::{Expr, LiteralVal};

pub(crate) fn is_raw_passthrough_expr(kind: &str, lang: LanguageId) -> bool {
    matches!(
        kind,
        "char_literal"
            | "character_literal"
            | "rune_literal"
            | "byte_literal"
            | "byte_string_literal"
            | "raw_byte_string_literal"
            | "c_string_literal"
            | "raw_c_string_literal"
    ) || matches!(
        (kind, lang),
        ("object_literal", LanguageId::Kotlin)
            | ("anonymous_class" | "arrow_function", LanguageId::Php)
            | ("text_block", LanguageId::Java)
            | ("switch_expression", LanguageId::Java | LanguageId::CSharp)
            | ("send_statement" | "channel_type" | "composite_literal", LanguageId::Go)
            | ("range_expression", LanguageId::Rust)
            | ("template_function", LanguageId::Cpp)
    )
}

pub(crate) fn is_rust_prefixed_raw_str(t: &str) -> bool {
    t.starts_with("b\"")
        || t.starts_with("br\"")
        || t.starts_with("br#")
        || t.starts_with("c\"")
        || t.starts_with("cr\"")
        || t.starts_with("cr#")
}

pub(crate) fn is_py_prefixed_raw_str(t: &str) -> bool {
    let pfx_len = t.bytes().take_while(|b| b.is_ascii_alphabetic()).count();
    if pfx_len == 0 || pfx_len > 2 {
        return false;
    }
    let rest = &t[pfx_len..];
    if !(rest.starts_with('"') || rest.starts_with('\'')) {
        return false;
    }
    matches!(
        t[..pfx_len].to_ascii_lowercase().as_str(),
        "b" | "rb" | "br" | "u"
    )
}

pub(crate) fn is_regular_interpreted_str(t: &str, lang: LanguageId) -> bool {
    match lang {
        LanguageId::Rust | LanguageId::C | LanguageId::Cpp | LanguageId::Go | LanguageId::Ruby => {
            t.starts_with('"') && t.ends_with('"') && t.len() >= 2
        }
        LanguageId::Java | LanguageId::CSharp | LanguageId::Kotlin => {
            t.starts_with('"') && !t.starts_with("\"\"\"") && t.ends_with('"') && t.len() >= 2
        }
        LanguageId::Python => {
            (t.starts_with('"') && !t.starts_with("\"\"\"") && t.ends_with('"') && t.len() >= 2)
                || (t.starts_with('\'') && !t.starts_with("'''") && t.ends_with('\'') && t.len() >= 2)
        }
        LanguageId::Dart => {
            (t.starts_with('"') && t.ends_with('"') && t.len() >= 2)
                || (t.starts_with('\'') && t.ends_with('\'') && t.len() >= 2)
        }
        _ => false,
    }
}

pub(crate) fn try_unescape_std_str(s: &str, allow_single_quote: bool) -> Option<String> {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('\\') => out.push('\\'),
            Some('"') => out.push('"'),
            Some('\'') if allow_single_quote => out.push('\''),
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('t') => out.push('\t'),
            _ => return None,
        }
    }
    Some(out)
}

pub(crate) fn unescape_ruby_single_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('\\') => out.push('\\'),
            Some('\'') => out.push('\''),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

pub(crate) fn decompile_non_js_str(t: &str, inner: String, lang: LanguageId) -> Expr {
    if lang == LanguageId::Rust && is_rust_prefixed_raw_str(t) {
        return Expr::Raw(t.to_string());
    }
    if lang == LanguageId::Python && is_py_prefixed_raw_str(t) {
        return Expr::Raw(t.to_string());
    }
    if lang == LanguageId::Java && t.starts_with("\"\"\"") && t.ends_with("\"\"\"") && t.len() >= 6 {
        return Expr::Raw(t.to_string());
    }
    let multiline = inner.contains('\n');
    if lang == LanguageId::Php {
        return decompile_php_str(t, inner, multiline);
    }
    if lang == LanguageId::Ruby && t.starts_with('\'') && t.ends_with('\'') && t.len() >= 2 {
        let value = if inner.contains('\\') { unescape_ruby_single_str(&inner) } else { inner };
        return Expr::Literal(LiteralVal::Str { value, multiline });
    }
    if is_regular_interpreted_str(t, lang) && inner.contains('\\') {
        let allow_sq = lang != LanguageId::Go;
        return match try_unescape_std_str(&inner, allow_sq) {
            Some(value) => Expr::Literal(LiteralVal::Str { value, multiline }),
            None => Expr::Raw(t.to_string()),
        };
    }
    Expr::Literal(LiteralVal::Str { value: inner, multiline })
}

fn decompile_php_str(t: &str, inner: String, multiline: bool) -> Expr {
    if t.starts_with('\'') && t.ends_with('\'') && t.len() >= 2 {
        if inner.contains('\\') || inner.contains('$') {
            return Expr::Raw(t.to_string());
        }
        return Expr::Literal(LiteralVal::Str { value: inner, multiline });
    }
    if t.starts_with('"') && t.ends_with('"') && t.len() >= 2 {
        if inner.contains('$') {
            return Expr::Raw(t.to_string());
        }
        if inner.contains('\\') {
            return match try_unescape_std_str(&inner, false) {
                Some(value) => Expr::Literal(LiteralVal::Str { value, multiline }),
                None => Expr::Raw(t.to_string()),
            };
        }
        return Expr::Literal(LiteralVal::Str { value: inner, multiline });
    }
    Expr::Raw(t.to_string())
}
