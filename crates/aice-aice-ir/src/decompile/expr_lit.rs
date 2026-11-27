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

pub(crate) fn is_py_fstring(raw: &str) -> bool {
    let t = raw.trim();
    let pfx_len = t.bytes().take_while(|b| b.is_ascii_alphabetic()).count();
    if pfx_len == 0 || pfx_len > 2 {
        return false;
    }
    let pfx = t[..pfx_len].to_ascii_lowercase();
    let rest = &t[pfx_len..];
    matches!(pfx.as_str(), "f" | "fr" | "rf") && (rest.starts_with('"') || rest.starts_with('\''))
}

fn unescape_js_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('\\') => out.push('\\'),
            Some('"') => out.push('"'),
            Some('\'') => out.push('\''),
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('t') => out.push('\t'),
            Some('0') if chars.peek().is_none_or(|n| !n.is_ascii_digit()) => out.push('\0'),
            Some('\n') => {}
            Some('\r') => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
            }
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

pub(crate) fn decompile_string_lit(raw: &str, lang: LanguageId) -> Expr {
    let t = raw.trim();
    if lang == LanguageId::Dart && (t.starts_with("r\"") || t.starts_with("r'")) {
        let inner = strip_quotes_lit(raw);
        if inner.contains('$') || inner.contains('\\') {
            return Expr::Raw(t.to_string());
        }
        return Expr::Literal(LiteralVal::Str { value: inner.clone(), multiline: inner.contains('\n') });
    }
    if lang == LanguageId::Ruby && t.starts_with('\'') && (t.contains("#{") || t.contains("#@") || t.contains("#$")) {
        return Expr::Raw(t.to_string());
    }
    if matches!(lang, LanguageId::Dart | LanguageId::Kotlin) && t.starts_with("\"\"\"") && t.contains('$') {
        return Expr::Raw(t.to_string());
    }
    let inner = strip_quotes_lit(raw);
    if lang == LanguageId::Python && is_py_fstring(raw) {
        parse_interp_text(&inner, "{", "}", raw)
    } else if matches!(lang, LanguageId::Dart | LanguageId::Kotlin) && raw.contains('$') {
        parse_dollar_interp(&inner, raw)
    } else if lang == LanguageId::Ruby && raw.starts_with('"') && raw.contains("#{") {
        parse_interp_text(&inner, "#{", "}", raw)
    } else if matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx) {
        let multiline = inner.contains('\n');
        let value = if inner.contains('\\') { unescape_js_str(&inner) } else { inner };
        Expr::Literal(LiteralVal::Str { value, multiline })
    } else {
        let multiline = inner.contains('\n');
        Expr::Literal(LiteralVal::Str { value: inner, multiline })
    }
}

fn find_matching_brace(s: &str, start: usize) -> Option<usize> {
    let b = s.as_bytes();
    let (mut i, mut depth, mut quote) = (start, 1usize, 0u8);
    while i < b.len() {
        let c = b[i];
        if quote != 0 {
            if c == b'\\' { i += 2; continue; }
            if c == quote { quote = 0; }
        } else if c == b'"' || c == b'\'' {
            quote = c;
        } else if c == b'{' {
            depth += 1;
        } else if c == b'}' {
            depth -= 1;
            if depth == 0 { return Some(i); }
        }
        i += 1;
    }
    None
}

pub(crate) fn parse_interp_text(s: &str, open: &str, close: &str, raw: &str) -> Expr {
    let mut quasis = Vec::new();
    let mut exprs = Vec::new();
    let mut cur = String::new();
    let b = s.as_bytes();
    let ob = open.as_bytes();
    let mut i = 0usize;
    while i < b.len() {
        if b[i] == b'\\' && i + 1 < b.len() {
            match b[i + 1] {
                b'\\' => { cur.push('\\'); i += 2; continue; }
                b'"' => { cur.push('"'); i += 2; continue; }
                b'\'' => { cur.push('\''); i += 2; continue; }
                b'#' if open.starts_with('#') => { cur.push('#'); i += 2; continue; }
                _ => return Expr::Raw(raw.trim().to_string()),
            }
        }
        if s[i..].starts_with(open) {
            let inner_start = i + ob.len();
            let end_opt = if close == "}" {
                find_matching_brace(s, inner_start)
            } else {
                s[inner_start..].find(close).map(|r| inner_start + r)
            };
            if let Some(end_idx) = end_opt {
                let ex_txt = s[inner_start..end_idx].trim();
                let ex = if let Some(ivar) = ex_txt.strip_prefix('@') {
                    Expr::Member {
                        object: Box::new(Expr::Ident("this".into())),
                        property: ivar.to_string(),
                        kind: MemberKind::Dot,
                    }
                } else {
                    Expr::Ident(ex_txt.to_string())
                };
                quasis.push(std::mem::take(&mut cur));
                exprs.push(ex);
                i = end_idx + close.len();
                continue;
            }
            return Expr::Raw(raw.trim().to_string());
        }
        let ch = s[i..].chars().next().unwrap();
        cur.push(ch);
        i += ch.len_utf8();
    }
    if exprs.is_empty() {
        if raw.contains("\\#{") { return Expr::Raw(raw.trim().to_string()); }
        return Expr::Literal(LiteralVal::Str { value: cur.clone(), multiline: cur.contains('\n') });
    }
    quasis.push(cur);
    Expr::Template { quasis, exprs }
}

pub(crate) fn parse_dollar_interp(s: &str, raw: &str) -> Expr {
    let mut quasis = Vec::new();
    let mut exprs = Vec::new();
    let mut cur = String::new();
    let mut i = 0usize;
    let b = s.as_bytes();
    while i < b.len() {
        if b[i] == b'\\' && i + 1 < b.len() {
            match b[i + 1] {
                b'$' => { cur.push('$'); i += 2; continue; }
                b'"' => { cur.push('"'); i += 2; continue; }
                b'\'' => { cur.push('\''); i += 2; continue; }
                b'\\' => { cur.push('\\'); i += 2; continue; }
                _ => return Expr::Raw(raw.trim().to_string()),
            }
        }
        if b[i] == b'$' {
            if b.get(i + 1) == Some(&b'{') {
                if let Some(end_idx) = find_matching_brace(s, i + 2) {
                    quasis.push(std::mem::take(&mut cur));
                    exprs.push(Expr::Ident(s[i + 2..end_idx].trim().to_string()));
                    i = end_idx + 1;
                    continue;
                }
                return Expr::Raw(raw.trim().to_string());
            } else if b.get(i + 1).is_some_and(|c| c.is_ascii_alphabetic() || *c == b'_') {
                quasis.push(std::mem::take(&mut cur));
                let mut k = i + 1;
                while k < b.len() && (b[k].is_ascii_alphanumeric() || b[k] == b'_') { k += 1; }
                exprs.push(Expr::Ident(s[i + 1..k].to_string()));
                i = k;
                continue;
            }
        }
        let ch = s[i..].chars().next().unwrap();
        cur.push(ch);
        i += ch.len_utf8();
    }
    if exprs.is_empty() {
        if raw.contains("\\$") { return Expr::Raw(raw.trim().to_string()); }
        return Expr::Literal(LiteralVal::Str { value: cur.clone(), multiline: cur.contains('\n') });
    }
    quasis.push(cur);
    Expr::Template { quasis, exprs }
}
