use aice_lang_registry::LanguageId;

use crate::ir_code::{Expr, LiteralVal, MemberKind};

fn is_str_prefix(p: &str) -> bool {
    matches!(p, "L" | "u8")
        || matches!(
            p.to_ascii_lowercase().as_str(),
            "r" | "b" | "u" | "f" | "c" | "rb" | "br" | "rf" | "fr" | "cr"
        )
}

pub(crate) fn strip_quotes_opt(s: &str) -> Option<String> {
    let t = s.trim();
    for q in ["\"\"\"", "'''", "\"", "'", "`"] {
        if t.len() >= q.len() * 2 && t.starts_with(q) && t.ends_with(q) {
            return Some(t[q.len()..t.len() - q.len()].to_string());
        }
    }
    if t.len() >= 3 && t.starts_with("@\"") && t.ends_with('"') {
        return Some(t[2..t.len() - 1].replace("\"\"", "\""));
    }
    for pfx in ["br", "cr", "r"] {
        if let Some(rest) = t.strip_prefix(pfx) {
            let hashes = rest.bytes().take_while(|&b| b == b'#').count();
            if hashes > 0 {
                let after = &rest[hashes..];
                if after.len() >= 2 + hashes
                    && after.starts_with('"')
                    && after.as_bytes()[after.len() - 1 - hashes] == b'"'
                    && after.as_bytes()[after.len() - hashes..].iter().all(|&b| b == b'#')
                {
                    return Some(after[1..after.len() - 1 - hashes].to_string());
                }
            }
        }
    }
    if t.len() >= 5 && t.starts_with("R\"") && t.ends_with('"') {
        let body = &t[2..t.len() - 1];
        if let Some(lp) = body.find('(') {
            let delim = &body[..lp];
            if let Some(inner) = body[lp + 1..].strip_suffix(delim).and_then(|x| x.strip_suffix(')')) {
                return Some(inner.to_string());
            }
        }
    }
    let pfx_len = t.bytes().take_while(|b| b.is_ascii_alphanumeric()).count();
    if pfx_len > 0 && pfx_len <= 2 && is_str_prefix(&t[..pfx_len]) {
        let body = &t[pfx_len..];
        for q in ["\"\"\"", "'''", "\"", "'"] {
            if body.len() >= q.len() * 2 && body.starts_with(q) && body.ends_with(q) {
                return Some(body[q.len()..body.len() - q.len()].to_string());
            }
        }
    }
    None
}

pub(crate) fn strip_quotes_lit(s: &str) -> String {
    strip_quotes_opt(s).unwrap_or_else(|| s.trim().to_string())
}

fn is_py_fstring(raw: &str) -> bool {
    let t = raw.trim();
    let pfx_len = t.bytes().take_while(|b| b.is_ascii_alphabetic()).count();
    if pfx_len == 0 || pfx_len > 2 {
        return false;
    }
    let pfx = t[..pfx_len].to_ascii_lowercase();
    let rest = &t[pfx_len..];
    matches!(pfx.as_str(), "f" | "fr" | "rf") && (rest.starts_with('"') || rest.starts_with('\''))
}

pub(crate) fn decompile_string_lit(raw: &str, lang: LanguageId) -> Expr {
    let inner = strip_quotes_lit(raw);
    if lang == LanguageId::Python && is_py_fstring(raw) {
        parse_interp_text(&inner, "{", "}")
    } else if matches!(lang, LanguageId::Dart | LanguageId::Kotlin) && raw.contains('$') {
        parse_dollar_interp(&inner)
    } else if lang == LanguageId::Ruby && raw.starts_with('"') && raw.contains("#{") {
        parse_interp_text(&inner, "#{", "}")
    } else {
        let multiline = inner.contains('\n');
        Expr::Literal(LiteralVal::Str { value: inner, multiline })
    }
}

pub(crate) fn parse_interp_text(s: &str, open: &str, close: &str) -> Expr {
    let mut quasis = Vec::new();
    let mut exprs = Vec::new();
    let mut pos = 0usize;
    while let Some(rel) = s[pos..].find(open) {
        let start = pos + rel;
        quasis.push(s[pos..start].to_string());
        let inner_start = start + open.len();
        if let Some(end_rel) = s[inner_start..].find(close) {
            let ex_txt = s[inner_start..inner_start + end_rel].trim();
            let ex = if let Some(ivar) = ex_txt.strip_prefix('@') {
                Expr::Member {
                    object: Box::new(Expr::Ident("this".into())),
                    property: ivar.to_string(),
                    kind: MemberKind::Dot,
                }
            } else {
                Expr::Ident(ex_txt.to_string())
            };
            exprs.push(ex);
            pos = inner_start + end_rel + close.len();
        } else {
            pos = start;
            break;
        }
    }
    if exprs.is_empty() {
        return Expr::Literal(LiteralVal::Str { value: s.to_string(), multiline: s.contains('\n') });
    }
    quasis.push(s[pos..].to_string());
    Expr::Template { quasis, exprs }
}

pub(crate) fn parse_dollar_interp(s: &str) -> Expr {
    let mut quasis = Vec::new();
    let mut exprs = Vec::new();
    let (mut i, mut q_start) = (0usize, 0usize);
    let b = s.as_bytes();
    while i < b.len() {
        if b[i] == b'$' {
            if b.get(i + 1) == Some(&b'{') {
                quasis.push(s[q_start..i].to_string());
                if let Some(end_rel) = s[i + 2..].find('}') {
                    exprs.push(Expr::Ident(s[i + 2..i + 2 + end_rel].trim().to_string()));
                    i = i + 2 + end_rel + 1;
                    q_start = i;
                    continue;
                }
            } else if b.get(i + 1).is_some_and(|c| c.is_ascii_alphabetic() || *c == b'_') {
                quasis.push(s[q_start..i].to_string());
                let mut k = i + 1;
                while k < b.len() && (b[k].is_ascii_alphanumeric() || b[k] == b'_') { k += 1; }
                exprs.push(Expr::Ident(s[i + 1..k].to_string()));
                i = k;
                q_start = i;
                continue;
            }
        }
        i += 1;
    }
    if exprs.is_empty() {
        return Expr::Literal(LiteralVal::Str { value: s.to_string(), multiline: s.contains('\n') });
    }
    quasis.push(s[q_start..].to_string());
    Expr::Template { quasis, exprs }
}
