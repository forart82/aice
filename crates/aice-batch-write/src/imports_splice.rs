use aice_lang_registry::LanguageId;

use crate::types::{join_lines_keep, split_lines_keep};

fn uses_hash_comments(lang: LanguageId) -> bool {
    matches!(lang, LanguageId::Python | LanguageId::Ruby | LanguageId::Bash | LanguageId::Php | LanguageId::Yaml | LanguageId::Toml)
}

fn uses_slash_comments(lang: LanguageId) -> bool {
    !matches!(lang, LanguageId::Python | LanguageId::Ruby | LanguageId::Bash | LanguageId::Yaml | LanguageId::Toml)
}

fn allows_single_quote_str(lang: LanguageId) -> bool {
    !matches!(lang, LanguageId::Rust | LanguageId::Go | LanguageId::C | LanguageId::Cpp | LanguageId::CSharp | LanguageId::Java)
}

fn allows_backtick_str(lang: LanguageId) -> bool {
    matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx | LanguageId::Go)
}

fn requires_semicolon(lang: LanguageId) -> bool {
    matches!(lang, LanguageId::Rust | LanguageId::CSharp | LanguageId::Java | LanguageId::Php | LanguageId::Dart)
}

fn starts_with_word(s: &str, word: &str) -> bool {
    s.strip_prefix(word)
        .is_some_and(|r| r.is_empty() || (!r.as_bytes()[0].is_ascii_alphanumeric() && r.as_bytes()[0] != b'_'))
}

fn skip_preamble(lines: &[String]) -> usize {
    let mut i = 0;
    while i < lines.len() {
        let t = lines[i].trim();
        if t.starts_with("#![") {
            let mut d = 0i32;
            while i < lines.len() {
                for b in lines[i].bytes() {
                    if b == b'[' { d += 1; } else if b == b']' { d -= 1; }
                }
                i += 1;
                if d <= 0 { break; }
            }
            continue;
        }
        let pre = t.is_empty() || t.starts_with("#!") || t.starts_with("package ")
            || t.starts_with("\"use ") || t.starts_with("'use ")
            || t == "<?php" || t.starts_with("<?php ") || t.starts_with("//!");
        if !pre { break; }
        i += 1;
    }
    i
}

fn skip_trivia(lines: &[String], mut idx: usize, lang: LanguageId, skip_py_doc: bool) -> usize {
    let (mut in_block, mut py_doc): (bool, Option<&str>) = (false, None);
    while idx < lines.len() {
        let t = lines[idx].trim();
        if let Some(delim) = py_doc {
            if t.contains(delim) { py_doc = None; }
            idx += 1;
            continue;
        }
        if in_block {
            if t.contains("*/") { in_block = false; }
            idx += 1;
            continue;
        }
        if t.is_empty()
            || (uses_slash_comments(lang) && t.starts_with("//"))
            || (uses_hash_comments(lang) && t.starts_with('#'))
        {
            idx += 1;
        } else if uses_slash_comments(lang) && t.starts_with("/*") {
            if !t[2..].contains("*/") { in_block = true; }
            idx += 1;
        } else if skip_py_doc && lang == LanguageId::Python && (t.starts_with("\"\"\"") || t.starts_with("'''")) {
            let d = &t[..3];
            if !t[3..].contains(d) { py_doc = Some(d); }
            idx += 1;
        } else {
            break;
        }
    }
    idx
}

#[derive(Default)]
struct ScanState {
    depth: i32,
    in_block: bool,
    in_bt: bool,
    saw_str: bool,
    saw_semi: bool,
    saw_require: bool,
    last_byte: Option<u8>,
    last_word: String,
    trailing_bs: bool,
}

fn scan_line(line: &str, lang: LanguageId, st: &mut ScanState) {
    let b = line.as_bytes();
    let (mut i, mut in_q): (usize, Option<u8>) = (0, None);
    st.trailing_bs = false;
    while i < b.len() {
        if st.in_block {
            if b[i] == b'*' && b.get(i + 1) == Some(&b'/') { st.in_block = false; i += 2; } else { i += 1; }
            continue;
        }
        if st.in_bt {
            if lang != LanguageId::Go && b[i] == b'\\' && i + 1 < b.len() { i += 2; continue; }
            if b[i] == b'`' { st.in_bt = false; st.saw_str = true; }
            i += 1;
            continue;
        }
        if let Some(q) = in_q {
            if b[i] == b'\\' && i + 1 < b.len() { i += 2; continue; }
            if b[i] == q { in_q = None; st.saw_str = true; }
            i += 1;
            continue;
        }
        if uses_slash_comments(lang) && b[i] == b'/' && b.get(i + 1) == Some(&b'/') { break; }
        if uses_slash_comments(lang) && b[i] == b'/' && b.get(i + 1) == Some(&b'*') { st.in_block = true; i += 2; continue; }
        if uses_hash_comments(lang) && b[i] == b'#' { break; }
        if b[i] == b'"' || (b[i] == b'\'' && allows_single_quote_str(lang)) || (b[i] == b'`' && allows_backtick_str(lang)) {
            if b[i] == b'`' { st.in_bt = true; } else { in_q = Some(b[i]); }
            st.saw_str = true;
            st.last_byte = Some(b[i]);
            st.last_word.clear();
            st.trailing_bs = false;
            i += 1;
            continue;
        }
        if b[i].is_ascii_whitespace() { i += 1; continue; }
        if b[i] == b'\\' { st.trailing_bs = true; i += 1; continue; }
        st.trailing_bs = false;
        if b[i].is_ascii_alphabetic() || b[i] == b'_' {
            let s = i;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') { i += 1; }
            let w = &line[s..i];
            if st.depth == 0 && w == "require" && line[i..].trim_start().starts_with('(') {
                st.saw_require = true;
            }
            st.last_word.clear();
            st.last_word.push_str(w);
            st.last_byte = Some(b[i - 1]);
            continue;
        }
        match b[i] {
            b'(' | b'{' | b'[' => st.depth += 1,
            b')' | b'}' | b']' => st.depth = (st.depth - 1).max(0),
            b';' if st.depth == 0 => st.saw_semi = true,
            _ => {}
        }
        st.last_byte = Some(b[i]);
        st.last_word.clear();
        i += 1;
    }
}

fn looks_like_decl(t: &str) -> bool {
    const P: &[&str] = &[
        "fn ", "pub ", "struct ", "enum ", "trait ", "impl ", "mod ", "const ", "static ",
        "type ", "class ", "interface ", "function ", "namespace ", "export ", "def ", "func ", "#[",
    ];
    P.iter().any(|p| t.starts_with(p))
}

fn is_direct_import_start(t: &str, lang: LanguageId) -> bool {
    let imp = t.starts_with("import ") || t.starts_with("import\t") || t == "import"
        || t.starts_with("import{") || t.starts_with("import\"") || t.starts_with("import'")
        || t.starts_with("import*") || (lang == LanguageId::Go && t.starts_with("import("));
    imp || (t.starts_with("from ") && (lang == LanguageId::Python || t.contains(" import")))
        || t.starts_with("use ") || t.starts_with("#include")
        || t.starts_with("using ") || t.starts_with("global using ")
}

fn stmt_continues(st: &ScanState, lang: LanguageId, js_imp: bool, next_nt: Option<&str>) -> bool {
    if st.depth > 0 || st.in_block || st.in_bt || st.trailing_bs { return true; }
    if st.saw_semi { return false; }
    if requires_semicolon(lang) { return next_nt.is_some_and(|n| !looks_like_decl(n)); }
    if js_imp {
        if st.last_byte == Some(b',') || matches!(st.last_word.as_str(), "from" | "as" | "import" | "type" | "assert" | "with") {
            return true;
        }
        if let Some(n) = next_nt {
            if starts_with_word(n, "with") || starts_with_word(n, "assert") { return true; }
            if !st.saw_str && (starts_with_word(n, "from") || starts_with_word(n, "as") || n.starts_with('{') || n.starts_with('*')) {
                return true;
            }
        }
    }
    false
}

fn scan_require_stmt(lines: &[String], start: usize, lang: LanguageId) -> Option<usize> {
    let t = lines[start].trim();
    if !(t.starts_with("const ") || t.starts_with("let ") || t.starts_with("var ")) { return None; }
    let (mut st, mut i, lim) = (ScanState::default(), start, (start + 64).min(lines.len()));
    while i < lim {
        scan_line(&lines[i], lang, &mut st);
        i += 1;
        if st.depth == 0 && !st.in_block && !st.in_bt && !st.trailing_bs
            && (st.saw_semi || !matches!(st.last_byte, Some(b',' | b'=' | b'(' | b'{' | b'[')))
        {
            break;
        }
    }
    st.saw_require.then_some(i)
}

fn scan_import_stmt(lines: &[String], start: usize, lang: LanguageId) -> Option<usize> {
    let t = lines.get(start)?.trim_start_matches('\u{FEFF}').trim();
    if lang == LanguageId::Rust && t.starts_with("#[") {
        let mut k = start + 1;
        while k < lines.len() && lines[k].trim().starts_with("#[") { k += 1; }
        let body = skip_trivia(lines, k, lang, false);
        return if lines.get(body).is_some_and(|l| l.trim().starts_with("use ")) {
            scan_import_stmt(lines, body, lang)
        } else { None };
    }
    if !is_direct_import_start(t, lang) { return scan_require_stmt(lines, start, lang); }
    let js_imp = matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx) && t.starts_with("import");
    let (mut st, mut i) = (ScanState::default(), start);
    while i < lines.len() {
        scan_line(&lines[i], lang, &mut st);
        i += 1;
        let next_nt = lines.get(skip_trivia(lines, i, lang, false)).map(|l| l.trim());
        if !stmt_continues(&st, lang, js_imp, next_nt) { break; }
    }
    Some(i)
}

pub fn apply_imports_splice(src: &str, lang: LanguageId, eol: &str, payload: &str) -> (String, String, usize, usize) {
    let has_bom = src.starts_with('\u{FEFF}');
    let (lines, trailing_nl) = split_lines_keep(src.strip_prefix('\u{FEFF}').unwrap_or(src));
    let preamble_end = skip_preamble(&lines);
    let first_cand = skip_trivia(&lines, preamble_end, lang, true);
    let (start, end) = if let Some(mut cur_end) = scan_import_stmt(&lines, first_cand, lang) {
        while let Some(next_end) = scan_import_stmt(&lines, skip_trivia(&lines, cur_end, lang, false), lang) {
            cur_end = next_end;
        }
        (first_cand, cur_end)
    } else {
        (preamble_end, preamble_end)
    };
    let (new_imp, _) = split_lines_keep(payload.trim_end_matches(['\r', '\n']));
    let (mut out, orig, sl, el) = if end > start {
        let orig = lines[start..end].join(eol);
        let mut next = Vec::with_capacity(lines.len());
        next.extend_from_slice(&lines[..start]);
        next.extend(new_imp);
        next.extend_from_slice(&lines[end..]);
        (join_lines_keep(&next, trailing_nl, eol), orig, start + 1, end)
    } else {
        let mut next = Vec::with_capacity(lines.len() + new_imp.len() + 1);
        next.extend_from_slice(&lines[..start]);
        next.extend(new_imp);
        if start < lines.len() && !lines[start].trim().is_empty() { next.push(String::new()); }
        next.extend_from_slice(&lines[start..]);
        (join_lines_keep(&next, trailing_nl, eol), String::new(), start + 1, start + 1)
    };
    if has_bom && !out.is_empty() && !out.starts_with('\u{FEFF}') { out.insert(0, '\u{FEFF}'); }
    (out, orig, sl, el)
}
