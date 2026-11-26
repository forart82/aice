use aice_lang_registry::LanguageId;

use crate::dep_callers_scan::{push_binding, push_unique_sym};

pub(crate) fn is_js_import_start(t: &str) -> bool {
    t.strip_prefix("import")
        .is_some_and(|r| r.starts_with(|c: char| c.is_whitespace() || matches!(c, '{' | '*' | '\'' | '"')))
}

pub(crate) fn is_export_from(t: &str) -> bool {
    let Some(rest) = t.strip_prefix("export") else { return false; };
    if !rest.starts_with(|c: char| c.is_whitespace() || c == '{' || c == '*') { return false; }
    let after_exp = rest.trim_start();
    let after_type = if let Some(r) = after_exp.strip_prefix("type")
        && r.starts_with(|c: char| c.is_whitespace() || c == '{' || c == '*')
    {
        r.trim_start()
    } else {
        after_exp
    };
    after_type.starts_with('{') || after_type.starts_with('*')
}

pub(crate) fn find_from_kw(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    let (mut i, mut braces, mut parens) = (0usize, 0i32, 0i32);
    let mut quote: Option<u8> = None;
    while i < b.len() {
        if quote.is_some() {
            if b[i] == b'\\' && i + 1 < b.len() {
                i += 1 + s[i + 1..].chars().next().map_or(1, char::len_utf8);
                continue;
            }
            if Some(b[i]) == quote {
                quote = None;
            }
            i += char_len(s, i);
            continue;
        }
        match b[i] {
            b'\'' | b'"' | b'`' => { quote = Some(b[i]); i += 1; }
            b'{' => { braces += 1; i += 1; }
            b'}' => { braces -= 1; i += 1; }
            b'(' => { parens += 1; i += 1; }
            b')' => { parens -= 1; i += 1; }
            b'f' if braces == 0 && parens == 0 && b[i..].starts_with(b"from") => {
                let prev_ok = i > 0 && (b[i - 1].is_ascii_whitespace() || matches!(b[i - 1], b'}' | b'*'));
                let rest = &b[i + 4..];
                let edge_ok = rest.first().is_none_or(|&c| c.is_ascii_whitespace() || matches!(c, b'\'' | b'"'));
                let next_non_ws = rest.iter().copied().find(|c| !c.is_ascii_whitespace());
                let next_ok = edge_ok && next_non_ws.is_none_or(|c| matches!(c, b'\'' | b'"'));
                if prev_ok && next_ok {
                    return Some(i);
                }
                i += 1;
            }
            _ => { i += char_len(s, i); }
        }
    }
    None
}

fn char_len(s: &str, i: usize) -> usize {
    s[i..].chars().next().map_or(1, char::len_utf8)
}

fn strip_type_modifier(s: &str) -> &str {
    let t = s.trim();
    if let Some(rest) = t.strip_prefix("type")
        && rest.starts_with(|c: char| c.is_whitespace() || c == '*')
    {
        let trimmed = rest.trim_start();
        if trimmed
            .strip_prefix("as")
            .is_some_and(|after_as| after_as.starts_with(char::is_whitespace))
        {
            return t;
        }
        trimmed
    } else {
        t
    }
}

fn strip_kw_prefix<'a>(s: &'a str, kw: &str) -> Option<&'a str> {
    let rest = s.strip_prefix(kw)?;
    rest.starts_with(|c: char| c.is_whitespace() || matches!(c, '{' | '*' | '\'' | '"'))
        .then(|| rest.trim_start())
}

pub(crate) fn extract_js_imports(
    stmt: &str,
    lang: LanguageId,
    imported: &mut Vec<String>,
    bindings: &mut Vec<(String, String)>,
    ns_aliases: &mut Vec<String>,
    unqual_star: &mut bool,
) {
    let from_pos = find_from_kw(stmt);
    if stmt.trim_start().starts_with("export") && from_pos.is_none() {
        return;
    }
    let head = match from_pos {
        Some(pos) => stmt[..pos].trim(),
        None => {
            let trimmed = stmt.trim().trim_end_matches(';').trim();
            if let Some(after_imp) = strip_kw_prefix(trimmed, "import")
                && let Some((lhs, rhs)) = after_imp.split_once('=')
            {
                let alias = strip_type_modifier(lhs);
                let r = rhs.trim_start();
                if r.strip_prefix("require").is_some_and(|a| a.trim_start().starts_with('('))
                    && !alias.is_empty()
                    && !alias.contains(char::is_whitespace)
                {
                    push_unique_sym(imported, "*");
                    push_unique_sym(ns_aliases, alias);
                }
                return;
            }
            stmt.trim()
        }
    };
    if let (Some(o), Some(c)) = (head.find('{'), head.rfind('}')) && o < c {
        for item in head[o + 1..c].split(',') {
            let s = strip_type_modifier(item);
            if s.is_empty() { continue; }
            let parts: Vec<&str> = s.split_whitespace().collect();
            let (canon, local) = if parts.len() >= 3 && parts[1] == "as" {
                (parts[0], parts[2])
            } else {
                let mut sp = s.split(" as ");
                let c0 = sp.next().unwrap_or("").trim();
                let l0 = sp.next().map_or(c0, str::trim);
                (c0, l0)
            };
            push_binding(imported, bindings, canon, local);
        }
    }
    let before_brace = head.split('{').next().unwrap_or(head).trim();
    let list = strip_kw_prefix(before_brace, "import")
        .or_else(|| strip_kw_prefix(before_brace, "export"))
        .unwrap_or("");
    for part in list.split(',') {
        let p = strip_type_modifier(part);
        if p.is_empty() || p == "type" || p.starts_with('\'') || p.starts_with('"') { continue; }
        if let Some(after_star) = p.strip_prefix('*') {
            let rest = after_star.trim_start();
            if rest.is_empty() {
                push_unique_sym(imported, "*");
                *unqual_star = true;
            } else if let Some(alias_part) = rest.strip_prefix("as")
                && alias_part.starts_with(char::is_whitespace)
                && let Some(alias) = alias_part.split_whitespace().next()
            {
                push_unique_sym(imported, "*");
                push_unique_sym(ns_aliases, alias);
            }
        } else if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript) {
            push_binding(imported, bindings, p, p);
        }
    }
}

pub(crate) fn rust_use_body(stmt: &str) -> Option<&str> {
    let mut s = stmt.trim_start();
    while s.starts_with("#[") || s.starts_with("#![") {
        let open = s.find('[')?;
        let (mut depth, mut in_dq, mut escaped, mut end) = (0usize, false, false, None);
        for (idx, ch) in s[open..].char_indices() {
            if in_dq {
                if escaped { escaped = false; } else if ch == '\\' { escaped = true; } else if ch == '"' { in_dq = false; }
                continue;
            }
            match ch {
                '"' => in_dq = true,
                '[' => depth += 1,
                ']' => {
                    depth -= 1;
                    if depth == 0 { end = Some(open + idx + 1); break; }
                }
                _ => {}
            }
        }
        s = s[end?..].trim_start();
    }
    if let Some(after_pub) = s.strip_prefix("pub") {
        let t = after_pub.trim_start();
        if t.starts_with('(') {
            let (mut depth, mut end) = (0usize, None);
            for (idx, ch) in t.char_indices() {
                if ch == '(' { depth += 1; } else if ch == ')' {
                    depth -= 1;
                    if depth == 0 { end = Some(idx + 1); break; }
                }
            }
            s = t[end?..].trim_start();
        } else if after_pub.starts_with(char::is_whitespace) {
            s = t;
        }
    }
    let after_use = s.strip_prefix("use")?;
    (after_use.starts_with(char::is_whitespace) || after_use.starts_with("::"))
        .then(|| after_use.trim_start())
}

pub(crate) fn extract_rust_imports(
    stmt: &str, imported: &mut Vec<String>, bindings: &mut Vec<(String, String)>,
    ns_aliases: &mut Vec<String>, unqual_star: &mut bool,
) {
    let Some(after_use) = rust_use_body(stmt) else { return };
    let body = after_use.split(';').next().unwrap_or("").trim();
    if let (Some(o), Some(c)) = (body.find('{'), body.rfind('}')) && o < c {
        for item in body[o + 1..c].split(',') {
            let mut parts = item.split(" as ");
            let raw_c = parts.next().unwrap_or("").trim().trim_matches([' ', '\t', '\r', '\n', '}']);
            let leaf = raw_c.rsplit(['{', ':']).next().unwrap_or("").trim();
            let local = parts.next().map_or(leaf, |r| r.trim().trim_matches([' ', '\t', '\r', '\n', '}']));
            if !leaf.is_empty() && leaf != "self" {
                push_unique_sym(imported, leaf);
                if leaf == "*" { *unqual_star = true; }
                else if !local.is_empty() && local != "_" { bindings.push((leaf.to_string(), local.to_string())); }
            }
        }
    } else {
        let mut parts = body.split(" as ");
        let leaf = parts.next().unwrap_or("").trim().rsplit("::").next().unwrap_or("").trim();
        let alias = parts.next().map(str::trim);
        if !leaf.is_empty() {
            push_unique_sym(imported, leaf);
            if leaf == "*" { *unqual_star = true; }
            if let Some(a) = alias && !a.is_empty() && a != "_" {
                bindings.push((leaf.to_string(), a.to_string()));
                push_unique_sym(ns_aliases, a);
            } else if leaf != "*" {
                bindings.push((leaf.to_string(), leaf.to_string()));
            }
        }
    }
}

fn split_py_import_kw(s: &str) -> Option<(&str, &str)> {
    let mut pos = 0usize;
    while let Some(rel) = s[pos..].find(" import") {
        let abs = pos + rel;
        let after = &s[abs + 7..];
        if after.starts_with(' ') || after.starts_with('(') {
            return Some((&s[..abs], after));
        }
        pos = abs + 7;
    }
    None
}

pub(crate) fn extract_python_imports(
    stmt: &str, target_stems: &[&str], imported: &mut Vec<String>,
    bindings: &mut Vec<(String, String)>, ns_aliases: &mut Vec<String>, unqual_star: &mut bool,
) {
    let norm = stmt.replace(['\\', '\n', '\r', '\t'], " ");
    let norm_t = norm.trim();
    if norm_t.starts_with("from")
        && norm_t[4..].starts_with([' ', '.'])
        && let Some((before, after)) = split_py_import_kw(norm_t)
    {
        let clean = after.replace(['(', ')', ';'], " ");
        if clean.trim() == "*" {
            push_unique_sym(imported, "*");
            *unqual_star = true;
        } else {
            for item in clean.split(',').map(str::trim).filter(|s| !s.is_empty()) {
                let mut parts = item.split(" as ");
                let canon = parts.next().unwrap_or("").trim();
                let local = parts.next().map_or(canon, str::trim);
                if before.trim().ends_with('.') {
                    if target_stems.contains(&canon) && !local.is_empty() {
                        push_unique_sym(imported, "*");
                        push_unique_sym(ns_aliases, local);
                    }
                } else {
                    push_binding(imported, bindings, canon, local);
                }
            }
        }
    } else if let Some(rest) = norm_t.trim_end_matches(';').trim().strip_prefix("import ") {
        for item in rest.split(',') {
            let item = item.trim();
            if item.is_empty() { continue; }
            let alias = if let Some((_, rhs)) = item.split_once(" as ") { rhs.trim() }
                else { item.split('.').next().unwrap_or(item).trim() };
            if !alias.is_empty() {
                push_unique_sym(imported, "*");
                push_unique_sym(ns_aliases, alias);
            }
        }
    }
}
