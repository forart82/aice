use std::collections::HashSet;

use aice_lang_registry::LanguageId;

use crate::dep_callers_other_ext::{split_kw_as, strip_balanced_angles};
use crate::dep_callers_scan::{TargetLookup, contains_word, push_binding, push_unique_sym};

pub(crate) fn has_qual_ref(line: &str, sym: &str, sep: &str) -> bool {
    let mut start = 0;
    while let Some(pos) = line[start..].find(sym) {
        let abs = start + pos;
        let b_ok = line[..abs].chars().next_back().is_none_or(|c| !c.is_alphanumeric() && c != '_');
        let after = abs + sym.len();
        if b_ok && line[after..].trim_start().starts_with(sep) {
            return true;
        }
        start = abs + line[abs..].chars().next().map_or(1, char::len_utf8);
    }
    false
}

fn is_kw_boundary(r: &str) -> bool {
    r.is_empty() || r.starts_with(|c: char| c.is_whitespace() || matches!(c, '(' | ';' | '"' | '\''))
}

fn kw_ok(s: &str, kw: &str) -> bool {
    s.strip_prefix(kw).is_some_and(is_kw_boundary)
}

fn kw_ok_ci(s: &str, kw: &str) -> bool {
    s.get(..kw.len()).is_some_and(|p| p.eq_ignore_ascii_case(kw)) && is_kw_boundary(&s[kw.len()..])
}

pub(crate) fn match_other_kw(lang: LanguageId, s: &str) -> Option<&'static str> {
    use LanguageId as L;
    match lang {
        L::Go | L::Java | L::Kotlin => kw_ok(s, "import").then_some("import"),
        L::Dart => kw_ok(s, "import").then_some("import").or_else(|| kw_ok(s, "export").then_some("export")),
        L::Cpp => kw_ok(s, "using").then_some("using"),
        L::CSharp => {
            if kw_ok(s, "using") {
                Some("using")
            } else if let Some(r) = s.strip_prefix("global")
                && r.starts_with(char::is_whitespace)
                && kw_ok(r.trim_start(), "using")
            {
                Some("using")
            } else {
                None
            }
        }
        L::Php => ["require_once", "require", "include_once", "include", "use"]
            .into_iter()
            .find(|&kw| kw_ok_ci(s, kw)),
        L::Ruby => ["require_relative", "require"].into_iter().find(|&kw| kw_ok(s, kw)),
        L::Bash => {
            if kw_ok(s, "source") {
                Some("source")
            } else if s.starts_with('.') && s[1..].starts_with([' ', '\t']) {
                Some(".")
            } else {
                None
            }
        }
        _ => None,
    }
}

pub(crate) fn stmt_matches_target(
    lang: LanguageId,
    stmt: &str,
    targets: &TargetLookup<'_>,
) -> bool {
    use LanguageId as L;
    if lang == L::Cpp {
        let body = stmt.trim().trim_end_matches(';').trim().strip_prefix("using").unwrap_or("").trim();
        if let Some(rest) = body.strip_prefix("namespace").filter(|r| r.starts_with(char::is_whitespace)) {
            let raw_ns: String = rest.split_whitespace().collect();
            let ns_path = raw_ns.trim_start_matches("::");
            return !ns_path.is_empty()
                && targets.mod_qnames.iter().any(|q| {
                    let qn_raw: String = q.split_whitespace().collect();
                    let qn = qn_raw.trim_start_matches("::");
                    qn == ns_path || qn.ends_with(&format!("::{ns_path}"))
                });
        }
        let rhs = body.split_once('=').map_or(body, |(_, r)| r.trim());
        let rhs = rhs
            .strip_prefix("typename")
            .filter(|r| r.starts_with(char::is_whitespace))
            .map_or(rhs, str::trim_start);
        let clean = strip_balanced_angles(rhs);
        return targets.stems.iter().any(|st| contains_word(&clean, st))
            || targets.syms.iter().any(|sym| contains_word(&clean, sym));
    }
    if lang == L::CSharp {
        let mut s = stmt.trim().trim_end_matches(';').trim();
        if let Some(r) = s.strip_prefix("global").filter(|r| r.starts_with(char::is_whitespace)) {
            s = r.trim_start();
        }
        let body = s.strip_prefix("using").unwrap_or("").trim();
        let rhs = body.split_once('=').map_or(body, |(_, r)| r.trim());
        let rhs = rhs
            .strip_prefix("static")
            .filter(|r| r.starts_with(char::is_whitespace))
            .map_or(rhs, str::trim_start);
        let clean = strip_balanced_angles(rhs);
        return targets.stems.iter().any(|st| contains_word(&clean, st))
            || targets.syms.iter().any(|sym| contains_word(&clean, sym));
    }
    if matches!(lang, L::Java | L::Kotlin) {
        if targets.stems.iter().any(|st| contains_word(stmt, st)) {
            return true;
        }
        let mut s = stmt.trim().trim_end_matches(';').trim().strip_prefix("import").unwrap_or("").trim();
        if let Some(r) = s.strip_prefix("static").filter(|r| r.starts_with(char::is_whitespace)) {
            s = r.trim_start();
        }
        let (raw_path, _) = split_kw_as(s);
        let path: String = raw_path.split_whitespace().collect();
        if let Some(prefix) = path.strip_suffix(".*") {
            let prefix_leaf = prefix.rsplit('.').next().unwrap_or(prefix);
            return targets.syms.contains(prefix) || targets.syms.contains(prefix_leaf);
        }
        let leaf = path.rsplit('.').next().unwrap_or(&path);
        let parent = path.rsplit_once('.').map(|(p, _)| p.rsplit('.').next().unwrap_or(p));
        return targets.syms.contains(leaf) || parent.is_some_and(|p| targets.type_syms.contains(p));
    }
    targets.stems.iter().any(|st| contains_word(stmt, st))
}

pub(crate) fn extract_dart(
    stmt: &str,
    target_syms: &HashSet<&str>,
    imported: &mut Vec<String>,
    bindings: &mut Vec<(String, String)>,
    ns_aliases: &mut Vec<String>,
    unqual_star: &mut bool,
) {
    enum Mode { None, As, Show, Hide }
    let body = stmt.trim().trim_end_matches(';').trim();
    let after_q = body.rfind(['\'', '"']).map_or("", |i| &body[i + 1..]);
    let mut mode = Mode::None;
    let mut alias: Option<&str> = None;
    let (mut has_show, mut has_hide) = (false, false);
    let (mut show_ids, mut hide_ids) = (Vec::new(), HashSet::new());
    for tok in after_q.split(|c: char| c.is_whitespace() || c == ',').filter(|s| !s.is_empty()) {
        match tok {
            "deferred" => mode = Mode::None,
            "as" => mode = Mode::As,
            "show" => { mode = Mode::Show; has_show = true; }
            "hide" => { mode = Mode::Hide; has_hide = true; }
            _ => match mode {
                Mode::As => { alias = Some(tok); mode = Mode::None; }
                Mode::Show => if !show_ids.contains(&tok) { show_ids.push(tok); }
                Mode::Hide => { hide_ids.insert(tok); }
                Mode::None => {}
            },
        }
    }
    if let Some(a) = alias {
        push_unique_sym(ns_aliases, a);
    }
    if has_show {
        for id in show_ids {
            if !hide_ids.contains(id) {
                push_binding(imported, bindings, id, id);
            }
        }
    } else if has_hide {
        let mut syms: Vec<&str> = target_syms.iter().copied().collect();
        syms.sort_unstable();
        let mut any = false;
        for sym in syms {
            if !hide_ids.contains(sym) {
                push_binding(imported, bindings, sym, sym);
                any = true;
            }
        }
        if !any && target_syms.is_empty() {
            push_unique_sym(imported, "*");
            if alias.is_none() { *unqual_star = true; }
        }
    } else {
        push_unique_sym(imported, "*");
        if alias.is_none() { *unqual_star = true; }
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn collect_call_lines(
    code_lines: &[String],
    lang: LanguageId,
    target_leaf: Option<&str>,
    target_syms: &HashSet<&str>,
    imported: &[String],
    bindings: &[(String, String)],
    ns_aliases: &[String],
    unqual_star: bool,
) -> Vec<usize> {
    let mut lines = Vec::new();
    let has_star = imported.iter().any(|s| s == "*");
    let bare_or_unqual_star = (imported.is_empty() && ns_aliases.is_empty()) || unqual_star;
    let qual_sep = match lang {
        LanguageId::Cpp => Some("::"),
        LanguageId::CSharp | LanguageId::Dart | LanguageId::Java | LanguageId::Kotlin => Some("."),
        _ => None,
    };
    for (idx, line) in code_lines.iter().enumerate() {
        let hit = if let Some(leaf) = target_leaf {
            let has_qual = qual_sep.is_some_and(|sep| {
                target_syms.iter().any(|&sym| sym != leaf && has_qual_ref(line, sym, sep))
            });
            let explicit: Vec<&str> =
                bindings.iter().filter(|(c, _)| c == leaf).map(|(_, l)| l.as_str()).collect();
            explicit.iter().any(|l| contains_word(line, l))
                || (has_star && ns_aliases.iter().any(|ns| contains_word(line, ns)) && contains_word(line, leaf))
                || ((bare_or_unqual_star || has_qual) && contains_word(line, leaf))
        } else {
            let has_qual = qual_sep.is_some_and(|sep| {
                target_syms.iter().any(|&sym| {
                    has_qual_ref(line, sym, sep)
                        && target_syms.iter().any(|&s| s != sym && contains_word(line, s))
                })
            });
            bindings.iter().any(|(_, l)| contains_word(line, l))
                || ns_aliases.iter().any(|ns| contains_word(line, ns))
                || ((bare_or_unqual_star || has_qual)
                    && target_syms.iter().any(|sym| contains_word(line, sym)))
        };
        if hit {
            lines.push(idx + 1);
        }
    }
    lines
}

fn validate_bash_source_stmt(kw: &str, stmt: &str) -> bool {
    let rest = stmt.strip_prefix(kw).unwrap_or(stmt).trim_start();
    let (mut sq, mut dq, mut esc) = (false, false, false);
    for ch in rest.chars() {
        if esc { esc = false; continue; }
        if sq { if ch == '\'' { sq = false; } continue; }
        if dq {
            if ch == '\\' { esc = true; }
            else if ch == '"' { dq = false; }
            else if ch == '`' { return false; }
            continue;
        }
        if ch == '\\' { esc = true; }
        else if ch == '\'' { sq = true; }
        else if ch == '"' { dq = true; }
        else if ch == '`' { return false; }
        else if ch.is_ascii_whitespace() || matches!(ch, ';' | '&' | '|' | ')' | '>' | '<') { break; }
    }
    true
}

pub(crate) fn validate_other_stmt(lang: LanguageId, kw: &str, stmt: &str) -> bool {
    if lang == LanguageId::Bash {
        return validate_bash_source_stmt(kw, stmt);
    }
    if lang == LanguageId::Php && kw == "use" {
        return !stmt[3..].trim_start().starts_with('(');
    }
    if lang == LanguageId::CSharp {
        let mut s = stmt.trim().trim_end_matches(';').trim();
        if let Some(r) = s.strip_prefix("global") {
            s = r.trim_start();
        }
        let body = s.strip_prefix("using").unwrap_or("").trim();
        if body.is_empty() || body.starts_with('(') {
            return false;
        }
        if let Some((lhs, _)) = body.split_once('=') {
            return lhs.split_whitespace().count() == 1;
        }
        return body.strip_prefix("static").is_some_and(|r| r.starts_with(char::is_whitespace))
            || !body.contains(char::is_whitespace);
    }
    true
}
