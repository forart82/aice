use std::collections::HashSet;

use aice_lang_registry::LanguageId;

use crate::dep_callers_other_match::extract_dart;
use crate::dep_callers_scan::{contains_word, push_binding, push_unique_sym};

#[allow(clippy::too_many_arguments)]
pub(crate) fn extract_other(
    stmt: &str,
    lang: LanguageId,
    kw: &str,
    target_stems: &[&str],
    target_syms: &HashSet<&str>,
    target_type_syms: &HashSet<&str>,
    imported: &mut Vec<String>,
    bindings: &mut Vec<(String, String)>,
    ns_aliases: &mut Vec<String>,
    unqual_star: &mut bool,
) {
    use LanguageId as L;
    match lang {
        L::Go => extract_go(stmt, target_stems, imported, ns_aliases, unqual_star),
        L::Php if kw == "use" => extract_php_use(stmt, target_stems, imported, bindings, ns_aliases),
        L::Java | L::Kotlin => {
            extract_jvm(stmt, target_stems, target_type_syms, imported, bindings, ns_aliases, unqual_star)
        }
        L::CSharp => extract_csharp(stmt, imported, bindings, ns_aliases, unqual_star),
        L::Cpp => extract_cpp(stmt, imported, bindings, ns_aliases, unqual_star),
        L::Dart => extract_dart(stmt, target_syms, imported, bindings, ns_aliases, unqual_star),
        _ => {
            push_unique_sym(imported, "*");
            *unqual_star = true;
        }
    }
}

fn extract_go(
    stmt: &str,
    stems: &[&str],
    imported: &mut Vec<String>,
    ns_aliases: &mut Vec<String>,
    unqual_star: &mut bool,
) {
    let body = stmt.trim().strip_prefix("import").unwrap_or("").trim();
    let inner = body
        .trim_end_matches(';')
        .trim()
        .strip_prefix('(')
        .and_then(|s| s.strip_suffix(')'))
        .unwrap_or(body);
    for item in inner.split(['\n', ';']) {
        let it = item.trim();
        let Some(q1) = it.find('"') else { continue };
        let Some(q2_rel) = it[q1 + 1..].find('"') else { continue };
        let pkg = &it[q1 + 1..q1 + 1 + q2_rel];
        if !stems.iter().any(|st| contains_word(pkg, st)) {
            continue;
        }
        let alias = it[..q1].trim();
        let def_pkg = pkg.rsplit('/').next().unwrap_or(pkg);
        if alias == "." {
            push_unique_sym(imported, "*");
            *unqual_star = true;
        } else if alias != "_" {
            push_unique_sym(imported, "*");
            push_unique_sym(ns_aliases, if alias.is_empty() { def_pkg } else { alias });
        }
    }
}

fn extract_php_use(
    stmt: &str,
    stems: &[&str],
    imported: &mut Vec<String>,
    bindings: &mut Vec<(String, String)>,
    ns_aliases: &mut Vec<String>,
) {
    let s = strip_php_kind(strip_kw_ci(stmt.trim(), "use").unwrap_or(""));
    let body = s.trim_end_matches(';').trim();
    let (prefix, list) = match (body.find('{'), body.rfind('}')) {
        (Some(o), Some(c)) if o < c => (body[..o].trim(), &body[o + 1..c]),
        _ => ("", body),
    };
    for raw_item in list.split(',') {
        let item = strip_php_kind(raw_item.trim());
        if item.is_empty() {
            continue;
        }
        let (canon, local) = split_as_ci(item);
        if stems.iter().any(|st| (!prefix.is_empty() && contains_word(prefix, st)) || contains_word(canon, st)) {
            let leaf = canon.rsplit('\\').next().unwrap_or(canon).trim();
            push_binding(imported, bindings, leaf, local);
            if stems.contains(&leaf) {
                push_unique_sym(ns_aliases, local);
                push_unique_sym(imported, "*");
            }
        }
    }
}

pub(crate) fn strip_php_kind(mut t: &str) -> &str {
    for m in ["function", "const"] {
        if let Some(r) = strip_kw_ci(t, m) {
            t = r;
            break;
        }
    }
    t
}

pub(crate) fn strip_kw_ci<'a>(s: &'a str, kw: &str) -> Option<&'a str> {
    let head = s.get(..kw.len())?;
    if head.eq_ignore_ascii_case(kw) && s[kw.len()..].starts_with(char::is_whitespace) {
        Some(s[kw.len()..].trim_start())
    } else {
        None
    }
}

pub(crate) fn split_as_ci(s: &str) -> (&str, &str) {
    let t = s.trim();
    for (idx, ch) in t.char_indices() {
        if ch.is_whitespace()
            && let Some(alias) = strip_kw_ci(&t[idx + ch.len_utf8()..], "as")
        {
            return (t[..idx].trim(), alias.trim());
        }
    }
    (t, t.rsplit('\\').next().unwrap_or(t).trim())
}

pub(crate) fn split_kw_as(s: &str) -> (&str, Option<&str>) {
    let t = s.trim();
    for (idx, ch) in t.char_indices() {
        if ch.is_whitespace() {
            let after = t[idx + ch.len_utf8()..].trim_start();
            if let Some(rest) = after.strip_prefix("as")
                && rest.starts_with(char::is_whitespace)
            {
                return (t[..idx].trim(), Some(rest.trim()));
            }
        }
    }
    (t, None)
}

fn extract_jvm(
    stmt: &str,
    stems: &[&str],
    target_type_syms: &HashSet<&str>,
    imported: &mut Vec<String>,
    bindings: &mut Vec<(String, String)>,
    ns_aliases: &mut Vec<String>,
    unqual_star: &mut bool,
) {
    let mut s = stmt.trim().trim_end_matches(';').trim().strip_prefix("import").unwrap_or("").trim();
    if let Some(r) = s.strip_prefix("static")
        && r.starts_with(char::is_whitespace)
    {
        s = r.trim_start();
    }
    let (raw_path, alias) = split_kw_as(s);
    let path: String = raw_path.split_whitespace().collect();
    if path.ends_with(".*") {
        push_unique_sym(imported, "*");
        *unqual_star = true;
    } else {
        let leaf = path.rsplit('.').next().unwrap_or(&path).trim();
        let local = alias.unwrap_or(leaf);
        push_binding(imported, bindings, leaf, local);
        if stems.contains(&leaf) || target_type_syms.contains(leaf) {
            push_unique_sym(ns_aliases, local);
            push_unique_sym(imported, "*");
        }
    }
}

pub(crate) fn strip_balanced_angles(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut depth = 0usize;
    for ch in s.chars() {
        match ch {
            '<' => depth += 1,
            '>' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(ch),
            _ => {}
        }
    }
    out.trim_end_matches(|c: char| c.is_whitespace() || matches!(c, '*' | '&' | '?')).trim().to_string()
}

fn extract_csharp(
    stmt: &str,
    imported: &mut Vec<String>,
    bindings: &mut Vec<(String, String)>,
    ns_aliases: &mut Vec<String>,
    unqual_star: &mut bool,
) {
    let mut s = stmt.trim().trim_end_matches(';').trim();
    if let Some(r) = s.strip_prefix("global") {
        s = r.trim_start();
    }
    let body = s.strip_prefix("using").unwrap_or("").trim();
    if let Some((lhs, rhs)) = body.split_once('=') {
        let alias = lhs.trim();
        let clean_rhs = strip_balanced_angles(rhs);
        let leaf = clean_rhs.rsplit('.').next().unwrap_or("").trim();
        push_binding(imported, bindings, leaf, alias);
        push_unique_sym(ns_aliases, alias);
        push_unique_sym(imported, "*");
    } else {
        push_unique_sym(imported, "*");
        *unqual_star = true;
    }
}

fn extract_cpp(
    stmt: &str,
    imported: &mut Vec<String>,
    bindings: &mut Vec<(String, String)>,
    ns_aliases: &mut Vec<String>,
    unqual_star: &mut bool,
) {
    let body = stmt.trim().trim_end_matches(';').trim().strip_prefix("using").unwrap_or("").trim();
    if body.strip_prefix("namespace").is_some_and(|r| r.starts_with(char::is_whitespace)) {
        push_unique_sym(imported, "*");
        *unqual_star = true;
    } else if let Some((lhs, rhs)) = body.split_once('=') {
        let alias = lhs.trim();
        let clean_rhs = strip_balanced_angles(rhs);
        let sym = clean_rhs.rsplit("::").next().unwrap_or("").trim();
        push_binding(imported, bindings, sym, alias);
        push_unique_sym(ns_aliases, alias);
        push_unique_sym(imported, "*");
    } else {
        let clean_body = strip_balanced_angles(body);
        let sym = clean_body.rsplit("::").next().unwrap_or("").trim();
        push_binding(imported, bindings, sym, sym);
    }
}
