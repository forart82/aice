use aice_lang_registry::LanguageId;

use crate::r5::snippet_blk::find_blk_comment_close;
use crate::r5::snippet_lit::{JsLexState, StepQuote};
pub use crate::r5::snippet_ml_lit::quote_allows_escape;

pub fn is_code_lang(lang: LanguageId) -> bool {
    use LanguageId::{Bash, C, Cpp, CSharp, Dart, Go, Java, JavaScript, Kotlin, Php, Python, Ruby, Rust, Tsx, TypeScript};
    matches!(lang, Bash | Rust | TypeScript | Tsx | JavaScript | Python | Go | C | Cpp | CSharp | Java | Kotlin | Dart | Php | Ruby)
}

pub fn has_hash_comments(lang: LanguageId) -> bool {
    matches!(lang, LanguageId::Bash | LanguageId::Python | LanguageId::Ruby | LanguageId::Yaml | LanguageId::Toml | LanguageId::Php)
}

pub fn has_slash_comments(lang: LanguageId) -> bool {
    use LanguageId::{C, Cpp, CSharp, Css, Dart, Go, Java, JavaScript, Kotlin, Php, Rust, Tsx, TypeScript};
    matches!(lang, Rust | TypeScript | Tsx | JavaScript | Go | C | Cpp | CSharp | Java | Kotlin | Dart | Php | Css)
}

pub fn is_quote_opener(lang: LanguageId, ch: u8) -> bool {
    ch == b'"'
        || (ch == b'\'' && lang != LanguageId::Rust)
        || (ch == b'`' && matches!(lang, LanguageId::Bash | LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx | LanguageId::Go))
}

pub(crate) fn is_hash_comment_at(b: &[u8], i: usize) -> bool {
    b[i] == b'#'
        && (i == 0 || b[i - 1].is_ascii_whitespace() || matches!(b[i - 1], b';' | b'(' | b'{'))
}

fn skip_unmasked_comment(
    lang: LanguageId,
    b: &[u8],
    i: &mut usize,
    slash: bool,
    hash: bool,
    js: &mut JsLexState,
) -> Option<bool> {
    if (slash && lang != LanguageId::Css && b[*i..].starts_with(b"//"))
        || (hash && is_hash_comment_at(b, *i))
    {
        js.just_closed_paren_nl_decl = false;
        while *i < b.len() && b[*i] != b'\n' {
            *i += 1;
        }
        return Some(true);
    }
    if slash && b[*i..].starts_with(b"/*") {
        js.just_closed_paren_nl_decl = false;
        let (Some(after), _) = find_blk_comment_close(lang, b, *i + 2, 1) else {
            return Some(false);
        };
        *i = after;
        return Some(true);
    }
    None
}
pub fn count_unclosed_quotes_unmasked(lang: LanguageId, src: &str, masked: &[(usize, usize)]) -> usize {
    if !is_code_lang(lang) {
        return 0;
    }
    let (b, mut unclosed, mut m_idx, mut i) = (src.as_bytes(), 0usize, 0usize, 0usize);
    let (slash, hash, mut js) = (has_slash_comments(lang), has_hash_comments(lang), JsLexState::new());
    while i < b.len() {
        if js.step_masked(lang, b, &mut m_idx, masked, &mut i) {
            continue;
        }
        if b[i] == b'\n' {
            if js.on_newline(lang) {
                unclosed += 1;
            }
            i += 1;
            continue;
        }
        if js.step_quote(lang, b, &mut i) != StepQuote::NotInQuote {
            continue;
        }
        if let Some((end, closed)) = js.match_special(lang, b, i) {
            if !closed {
                return unclosed + 1;
            }
            i = end;
            continue;
        }
        if let Some(cont) = skip_unmasked_comment(lang, b, &mut i, slash, hash, &mut js) {
            if !cont {
                break;
            }
            continue;
        }
        js.step_byte(lang, b, &mut i);
    }
    unclosed + usize::from(js.has_open_quote())
}

pub fn lexical_comment_start(lang: LanguageId, s: &str) -> Option<usize> {
    let b = s.as_bytes();
    let (slash, hash) = (has_slash_comments(lang), has_hash_comments(lang));
    let (mut i, mut js) = (0usize, JsLexState::new());
    while i < b.len() {
        if b[i] == b'\n' {
            js.on_newline(lang);
            i += 1;
            continue;
        }
        if js.step_quote(lang, b, &mut i) != StepQuote::NotInQuote {
            continue;
        }
        if let Some((end, _)) = js.match_special(lang, b, i) {
            i = end;
            continue;
        }
        if js.open_quote(lang, b, &mut i) {
            continue;
        }
        if (slash && lang != LanguageId::Css && b[i..].starts_with(b"//"))
            || (hash && is_hash_comment_at(b, i))
        {
            return Some(i);
        }
        if slash && b[i..].starts_with(b"/*") {
            let (Some(after), _) = find_blk_comment_close(lang, b, i + 2, 1) else {
                return Some(i);
            };
            if s[after..].trim().is_empty() {
                return Some(i);
            }
            i = after;
            continue;
        }
        js.step_byte(lang, b, &mut i);
    }
    None
}

pub fn scan_unmasked_delims(lang: LanguageId, src: &str, masked: &[(usize, usize)]) -> (Vec<u8>, usize) {
    let (stack, unmatched) = scan_unmasked_delims_detail(lang, src, masked);
    (stack, unmatched.len())
}

pub(crate) fn scan_unmasked_delims_detail(
    lang: LanguageId,
    src: &str,
    masked: &[(usize, usize)],
) -> (Vec<u8>, Vec<u8>) {
    if !is_code_lang(lang) {
        return (Vec::new(), Vec::new());
    }
    let (b, slash, hash) = (src.as_bytes(), has_slash_comments(lang), has_hash_comments(lang));
    let (mut m_idx, mut i) = (0usize, 0usize);
    let (mut stack, mut unmatched, mut js) = (Vec::new(), Vec::new(), JsLexState::new());
    while i < b.len() {
        if js.step_masked(lang, b, &mut m_idx, masked, &mut i) {
            continue;
        }
        if b[i] == b'\n' {
            js.on_newline(lang);
            i += 1;
            continue;
        }
        match js.step_quote(lang, b, &mut i) {
            StepQuote::Consumed => continue,
            StepQuote::EnteredInterp => {
                stack.push(b'{');
                continue;
            }
            StepQuote::NotInQuote => {}
        }
        if let Some((end, _)) = js.match_special(lang, b, i) {
            i = end;
            continue;
        }
        if js.open_quote(lang, b, &mut i) {
            continue;
        }
        if let Some(cont) = skip_unmasked_comment(lang, b, &mut i, slash, hash, &mut js) {
            if !cont {
                break;
            }
            continue;
        }
        if matches!(b[i], b'(' | b'[' | b'{') {
            stack.push(b[i]);
            js.step_byte(lang, b, &mut i);
            continue;
        }
        if matches!(b[i], b')' | b']' | b'}') {
            let want = match b[i] { b')' => b'(', b']' => b'[', _ => b'{' };
            if stack.last() == Some(&want) {
                stack.pop();
            } else if let Some(pos) = stack.iter().rposition(|&c| c == want) {
                stack.remove(pos);
            } else if !(lang == LanguageId::Bash && b[i] == b')') {
                unmatched.push(b[i]);
            }
            js.step_byte(lang, b, &mut i);
            continue;
        }
        js.step_byte(lang, b, &mut i);
    }
    (stack, unmatched)
}

pub fn split_top_level_stmt_segments(lang: LanguageId, line: &str) -> Vec<&str> {
    if !is_code_lang(lang) {
        return vec![line.trim()];
    }
    let (b, slash, hash) = (line.as_bytes(), has_slash_comments(lang), has_hash_comments(lang));
    let (mut depth, mut start, mut i) = (0usize, 0usize, 0usize);
    let (mut out, mut js) = (Vec::new(), JsLexState::new());
    while i < b.len() {
        if b[i] == b'\n' {
            js.on_newline(lang);
            i += 1;
            continue;
        }
        match js.step_quote(lang, b, &mut i) {
            StepQuote::Consumed => continue,
            StepQuote::EnteredInterp => {
                depth += 1;
                continue;
            }
            StepQuote::NotInQuote => {}
        }
        if let Some((end, _)) = js.match_special(lang, b, i) {
            i = end;
            continue;
        }
        if let Some(cont) = skip_unmasked_comment(lang, b, &mut i, slash, hash, &mut js) {
            if !cont {
                break;
            }
            continue;
        }
        if matches!(b[i], b'(' | b'[' | b'{') {
            depth += 1;
            js.step_byte(lang, b, &mut i);
            continue;
        }
        if matches!(b[i], b')' | b']' | b'}') {
            depth = depth.saturating_sub(1);
            js.step_byte(lang, b, &mut i);
            continue;
        }
        if depth == 0 && (b[i] == b';' || b[i..].starts_with(b"&&") || b[i..].starts_with(b"||")) {
            let seg = line[start..i].trim();
            if !seg.is_empty() {
                out.push(seg);
            }
            i += if b[i] == b';' { 1 } else { 2 };
            start = i;
            js.on_open_delim();
            continue;
        }
        js.step_byte(lang, b, &mut i);
    }
    let tail = line[start..].trim();
    if !tail.is_empty() {
        out.push(tail);
    }
    out
}

pub fn snippet_wrappers(lang: LanguageId, slice: &str) -> Vec<(usize, String)> {
    let w = |pre: &str, post: &str| (pre.len(), format!("{pre}{slice}{post}"));
    use LanguageId::{C, Cpp, CSharp, Css, Dart, Go, Java, JavaScript, Json, Kotlin, Php, Python, Rust, Tsx, TypeScript};
    match lang {
        Rust => vec![w("fn _aice_probe_() {\n", "\n}")],
        TypeScript | Tsx | JavaScript => vec![w("function _aice_probe_() {\n", "\n}"), w("class _AiceProbe_ {\n", "\n}")],
        Python => vec![w("def _aice_probe_():\n", "")],
        C | Dart => vec![w("void _aice_probe_() {\n", "\n}")],
        Cpp => vec![w("void _aice_probe_() {\n", "\n}"), w("class _AiceProbe_ {\n", "\n};")],
        CSharp | Java => vec![w("class _AiceProbe_ {\n", "\n}"), w("class _AiceProbe_ { void _m_() {\n", "\n} }")],
        Kotlin => vec![w("fun _aice_probe_() {\n", "\n}")],
        Go => vec![w("package _aice\n", ""), w("package _aice\nfunc _aice_probe_() {\n", "\n}")],
        Php => vec![w("<?php\n", ""), w("<?php\nfunction _aice_probe_() {\n", "\n}")],
        Css => vec![w("._aice_ {\n", "\n}")],
        Json => vec![w("{\n", "\n}"), w("{\n", "\n\"_aice_end_\": 0\n}"), w("[\n", "\n]")],
        _ => Vec::new(),
    }
}
