use aice_lang_registry::LanguageId;

use crate::ir_code::{Expr, LiteralVal};

pub(crate) fn is_regular_interpreted_str(t: &str, lang: LanguageId) -> bool {
    match lang {
        LanguageId::Rust | LanguageId::C | LanguageId::Cpp | LanguageId::Go | LanguageId::Java | LanguageId::Ruby => {
            t.starts_with('"') && t.ends_with('"') && t.len() >= 2
        }
        LanguageId::CSharp | LanguageId::Kotlin => {
            t.starts_with('"') && !t.starts_with("\"\"\"") && t.ends_with('"') && t.len() >= 2
        }
        LanguageId::Python => {
            let body = t
                .strip_prefix('u')
                .or_else(|| t.strip_prefix('U'))
                .unwrap_or(t);
            (body.starts_with('"') && body.ends_with('"') && body.len() >= 2)
                || (body.starts_with('\'') && body.ends_with('\'') && body.len() >= 2)
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
    let multiline = inner.contains('\n');
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
