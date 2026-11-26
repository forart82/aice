use crate::printer_expr::escape_str;

pub(crate) fn emit_ts_raw_type(s: &str) -> String {
    if is_ts_raw_type_expr(s) {
        s.to_string()
    } else {
        format!("\"{}\"", escape_str(s))
    }
}

fn is_ts_raw_type_expr(s: &str) -> bool {
    let t = s.trim();
    if t.is_empty() {
        return false;
    }
    if t.len() >= 2
        && ((t.starts_with('"') && t.ends_with('"'))
            || (t.starts_with('\'') && t.ends_with('\''))
            || (t.starts_with('`') && t.ends_with('`')))
    {
        return true;
    }
    if t.starts_with('{')
        || t.starts_with('(')
        || t.starts_with('[')
        || t.ends_with("[]")
        || t.contains("=>")
        || t.contains(" | ")
        || t.contains(" & ")
        || t.contains('<')
        || t.contains('>')
        || t.contains('[')
        || t.contains(']')
        || t.contains(';')
    {
        return true;
    }
    if [
        "readonly ",
        "keyof ",
        "typeof ",
        "infer ",
        "new ",
        "unique ",
        "asserts ",
        "abstract ",
    ]
    .iter()
    .any(|kw| t.starts_with(kw))
    {
        return true;
    }
    if t.contains(" extends ") || t.contains(" is ") || t.contains(" in ") {
        return true;
    }
    if t.contains('.')
        && t.split('.').all(is_js_ident)
        && t.split('.').any(|seg| seg.bytes().next().is_some_and(|b| b.is_ascii_uppercase()))
    {
        return true;
    }
    false
}

fn is_js_ident(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && (b[0].is_ascii_alphabetic() || b[0] == b'_' || b[0] == b'$')
        && b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'_' || *c == b'$')
}
