use crate::ir_domain::{DataNode, DataScalar};
use crate::printer_expr::escape_str;

pub(crate) fn has_comment_hazard(s: &str) -> bool {
    s.contains("//")
        || s.contains("/*")
        || s.contains("# ")
        || s.contains("#\t")
        || s.contains("##")
        || s.contains("#!")
        || s.ends_with('#')
}

pub(crate) fn is_clean_attr_key(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && (b[0].is_ascii_alphabetic() || b[0] == b'_')
        && b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'_' || *c == b'-')
        && !s.ends_with('-')
        && !s.contains("--")
}

pub(crate) fn fmt_attr_key(s: &str) -> String {
    if is_clean_attr_key(s) { s.to_string() } else { format!("\"{}\"", escape_str(s)) }
}

pub(crate) fn fmt_data_key(s: &str) -> String {
    let b = s.as_bytes();
    let ok = !b.is_empty()
        && (b[0].is_ascii_alphabetic() || b[0] == b'_')
        && b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'_' || *c == b'-')
        && !s.ends_with('-')
        && !s.contains("--")
        && !matches!(s, "section" | "xml" | "dtd" | "prolog");
    if ok { s.to_string() } else { format!("\"{}\"", escape_str(s)) }
}

pub(crate) fn is_clean_attr_val(s: &str) -> bool {
    !s.is_empty()
        && !has_comment_hazard(s)
        && s.bytes().all(|c| {
            c.is_ascii_graphic()
                && !matches!(c, b'"' | b'\'' | b'`' | b'\\' | b',' | b'(' | b')' | b';')
        })
}

pub(crate) fn fmt_attr_val(s: &str) -> String {
    if is_clean_attr_val(s) { s.to_string() } else { format!("\"{}\"", escape_str(s)) }
}

pub(crate) fn is_clean_inline_text(s: &str) -> bool {
    !s.is_empty()
        && s == s.trim()
        && !s.contains('\n')
        && !s.contains('\r')
        && !has_comment_hazard(s)
        && !s.starts_with('"')
        && !s.starts_with('\'')
        && !s.starts_with('`')
        && s.chars().all(|c| {
            if c.is_ascii() {
                (c.is_ascii_graphic() || c == ' ') && !matches!(c, '"' | '\'' | '`' | '\\')
            } else {
                c.is_alphabetic()
            }
        })
}

pub(crate) fn is_clean_data_str(s: &str, in_seq: bool) -> bool {
    if s.is_empty() || s != s.trim() || s.contains('\n') || s.contains('\r') || has_comment_hazard(s) {
        return false;
    }
    if matches!(s, "true" | "false" | "nil" | "null" | "~" | "[]" | "{}") {
        return false;
    }
    let first = s.as_bytes()[0];
    if matches!(first, b'"' | b'\'' | b'`' | b'[' | b'{' | b'-' | b'+') {
        return false;
    }
    if is_pure_number_like(s) {
        return false;
    }
    s.bytes().all(|c| {
        let base_ok = c.is_ascii_graphic()
            && !matches!(c, b'"' | b'\'' | b'`' | b'\\' | b'[' | b']' | b'{' | b'}' | b';');
        if in_seq { base_ok && c != b',' } else { base_ok }
    })
}

fn is_pure_number_like(s: &str) -> bool {
    let b = s.as_bytes();
    if b.is_empty() || !b[0].is_ascii_digit() {
        return false;
    }
    if s.starts_with("0x") || s.starts_with("0X") || s.starts_with("0b") || s.starts_with("0B")
        || s.starts_with("0o") || s.starts_with("0O")
    {
        return b[2..].iter().all(|c| c.is_ascii_hexdigit() || *c == b'_');
    }
    let mut dots = 0usize;
    let mut exps = 0usize;
    let mut prev_e = false;
    for &c in b {
        if c.is_ascii_digit() || c == b'_' {
            prev_e = false;
        } else if c == b'.' && exps == 0 {
            dots += 1;
            if dots > 1 { return false; }
            prev_e = false;
        } else if (c == b'e' || c == b'E') && exps == 0 {
            exps += 1;
            prev_e = true;
        } else if (c == b'+' || c == b'-') && prev_e {
            prev_e = false;
        } else {
            return false;
        }
    }
    !s.ends_with('.') && !prev_e
}

pub(crate) fn fmt_data_scalar(val: &DataScalar, in_seq: bool) -> String {
    match val {
        DataScalar::Str(s) => {
            if is_clean_data_str(s, in_seq) { s.clone() } else { format!("\"{}\"", escape_str(s)) }
        }
        DataScalar::Int(s) | DataScalar::Float(s) | DataScalar::Raw(s) => s.clone(),
        DataScalar::Bool(b) => if *b { "true".into() } else { "false".into() },
        DataScalar::Null => "nil".into(),
    }
}

pub(crate) fn fmt_inline_data_seq(items: &[DataNode]) -> Option<String> {
    if items.is_empty() || items.len() > 16 {
        return None;
    }
    let mut parts = Vec::with_capacity(items.len());
    for it in items {
        let DataNode::Scalar { key: None, val, trivia, .. } = it else { return None; };
        if !trivia.is_empty() { return None; }
        if let DataScalar::Raw(r) = val
            && (r.contains(',') || r.contains(']') || r.contains('\n'))
        {
            return None;
        }
        parts.push(fmt_data_scalar(val, true));
    }
    Some(format!("[{}]", parts.join(",")))
}

pub(crate) fn compact_sql_ws(s: &str) -> String {
    if s.contains("--") || s.contains("//") || s.contains('#') {
        return s.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n");
    }
    let mut out = String::with_capacity(s.len());
    let mut in_q: Option<char> = None;
    let mut prev_ws = false;
    for ch in s.chars() {
        if let Some(q) = in_q {
            if ch == q { in_q = None; }
            out.push(ch);
            prev_ws = false;
        } else if ch == '\'' || ch == '"' || ch == '`' {
            in_q = Some(ch);
            out.push(ch);
            prev_ws = false;
        } else if ch.is_ascii_whitespace() {
            if !out.is_empty() && !prev_ws {
                out.push(' ');
                prev_ws = true;
            }
        } else {
            out.push(ch);
            prev_ws = false;
        }
    }
    if out.ends_with(' ') { out.pop(); }
    out
}

pub(crate) fn compress_sql_constraint(s: &str) -> String {
    let mut r = s.to_string();
    for (long, short) in [
        ("PRIMARY KEY", "PK"),
        ("NOT NULL", "NN"),
        ("AUTO_INCREMENT", "AI"),
        ("CURRENT_TIMESTAMP", "CUR_TS"),
    ] {
        r = replace_sql_phrase(&r, long, short);
    }
    r
}

pub(crate) fn expand_sql_constraint(s: &str) -> String {
    let mut r = s.to_string();
    for (short, long) in [
        ("CUR_TS", "CURRENT_TIMESTAMP"),
        ("AI", "AUTO_INCREMENT"),
        ("NN", "NOT NULL"),
        ("PK", "PRIMARY KEY"),
    ] {
        r = replace_sql_phrase(&r, short, long);
    }
    r
}

fn replace_sql_phrase(s: &str, pat: &str, rep: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let b = s.as_bytes();
    let mut i = 0usize;
    let mut in_q: Option<u8> = None;
    while i < b.len() {
        if let Some(q) = in_q {
            if b[i] == q { in_q = None; }
            let ch = s[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
            continue;
        }
        if b[i] == b'\'' || b[i] == b'"' || b[i] == b'`' {
            in_q = Some(b[i]);
            out.push(b[i] as char);
            i += 1;
            continue;
        }
        if s[i..].starts_with(pat) {
            let left_ok = i == 0 || !(b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'_');
            let end = i + pat.len();
            let right_ok = end == b.len() || !(b[end].is_ascii_alphanumeric() || b[end] == b'_');
            if left_ok && right_ok {
                out.push_str(rep);
                i = end;
                continue;
            }
        }
        let ch = s[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

pub(crate) fn is_clean_db_word(s: &str) -> bool {
    let b = s.as_bytes();
    if b.is_empty() { return false; }
    if b[0] == b'[' && *b.last().unwrap() == b']' && b.len() > 2 {
        return b[1..b.len() - 1].iter().all(|c| c.is_ascii_alphanumeric() || *c == b'_');
    }
    (b[0].is_ascii_alphabetic() || b[0] == b'_')
        && b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'_' || *c == b'.')
        && !s.ends_with('.')
        && !s.contains("..")
}

pub(crate) fn fmt_db_word(s: &str) -> String {
    if is_clean_db_word(s) { s.to_string() } else { format!("\"{}\"", escape_str(s)) }
}

pub(crate) fn is_clean_db_type(s: &str) -> bool {
    !s.is_empty()
        && s == s.trim()
        && !s.contains('\n')
        && !s.contains('\r')
        && !has_comment_hazard(s)
        && !s.starts_with('"')
        && !s.starts_with('\'')
        && !s.starts_with('`')
        && s.bytes().all(|c| {
            (c.is_ascii_graphic() || c == b' ')
                && !matches!(c, b'"' | b'\'' | b'`' | b'\\' | b'|' | b';' | b':')
        })
}

pub(crate) fn fmt_db_type(s: &str) -> String {
    if is_clean_db_type(s) { s.to_string() } else { format!("\"{}\"", escape_str(s)) }
}

pub(crate) fn is_clean_db_expr_tail(s: &str) -> bool {
    !s.is_empty()
        && s == s.trim()
        && !s.contains('\n')
        && !s.contains('\r')
        && !has_comment_hazard(s)
        && s.bytes().all(|c| {
            (c.is_ascii_graphic() || c == b' ')
                && !matches!(c, b'`' | b'\\' | b'|' | b';')
        })
        && crate::lexer::lex_with_trivia(s).is_ok()
}

pub(crate) fn fmt_db_segment(s: &str) -> String {
    if is_clean_db_type(s) { s.to_string() } else { format!("\"{}\"", escape_str(s)) }
}
