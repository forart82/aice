use crate::lang_id::LanguageId;

const CPP_HEADERS: &[&str] = &[
    "<iostream>",
    "<vector>",
    "<string>",
    "<memory>",
    "<map>",
    "<unordered_map>",
    "<set>",
    "<unordered_set>",
    "<algorithm>",
    "<optional>",
    "<variant>",
    "<span>",
    "<array>",
    "<tuple>",
    "<functional>",
    "<sstream>",
    "<fstream>",
    "<thread>",
    "<mutex>",
    "<concepts>",
    "<ranges>",
    "<compare>",
    "<format>",
    "<coroutine>",
    "<bit>",
    "<cstdint>",
    "<type_traits>",
    "<filesystem>",
    "<string_view>",
    "<any>",
];

const CPP_WORDS: &[&str] = &[
    "class",
    "namespace",
    "constexpr",
    "nullptr",
    "consteval",
    "constinit",
    "concept",
    "requires",
    "co_await",
    "co_return",
    "co_yield",
    "noexcept",
];

const CPP_SUBSTRS: &[&str] = &[
    "using namespace",
    "template<",
    "template <",
    "std::",
    "public:",
    "private:",
    "protected:",
    "enum struct",
    "<=>",
];

pub(crate) fn detect_c_or_cpp(ext: &str, sample: &str) -> LanguageId {
    if ext != "h" {
        return LanguageId::Cpp;
    }
    let cleaned = strip_comments_and_strings(sample, b"//", true, true);
    let is_cpp = CPP_WORDS.iter().any(|w| has_word(&cleaned, w))
        || CPP_SUBSTRS.iter().any(|s| cleaned.contains(s))
        || CPP_HEADERS.iter().any(|h| cleaned.contains(h));
    if is_cpp {
        LanguageId::Cpp
    } else {
        LanguageId::C
    }
}

pub(crate) fn strip_comments_and_strings(
    sample: &str,
    line_comment: &[u8; 2],
    double_quotes: bool,
    backslash_escape: bool,
) -> String {
    let b = sample.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    let line_cont = line_comment == b"//";
    while i < b.len() {
        if i + 1 < b.len() && b[i] == line_comment[0] && b[i + 1] == line_comment[1] {
            let mut prev_bs = false;
            while i < b.len() {
                if b[i] == b'\n' {
                    if !(line_cont && prev_bs) {
                        break;
                    }
                    out.push(b'\n');
                    prev_bs = false;
                    i += 1;
                    continue;
                }
                if b[i] == b'\r' {
                    out.push(b'\r');
                    i += 1;
                    continue;
                }
                prev_bs = b[i] == b'\\';
                out.push(b' ');
                i += 1;
            }
        } else if i + 1 < b.len() && b[i] == b'/' && b[i + 1] == b'*' {
            out.extend_from_slice(b"  ");
            i += 2;
            while i < b.len() {
                if i + 1 < b.len() && b[i] == b'*' && b[i + 1] == b'/' {
                    out.extend_from_slice(b"  ");
                    i += 2;
                    break;
                }
                out.push(if matches!(b[i], b'\n' | b'\r') { b[i] } else { b' ' });
                i += 1;
            }
        } else if b[i] == b'\'' || (double_quotes && b[i] == b'"') {
            let q = b[i];
            out.push(b' ');
            i += 1;
            while i < b.len() {
                if backslash_escape && b[i] == b'\\' {
                    out.push(b' ');
                    i += 1;
                    if i < b.len() {
                        out.push(if matches!(b[i], b'\n' | b'\r') { b[i] } else { b' ' });
                        i += 1;
                    }
                    continue;
                }
                let ch = b[i];
                out.push(if matches!(ch, b'\n' | b'\r') { ch } else { b' ' });
                i += 1;
                if ch == q {
                    if !backslash_escape && q == b'\'' && i < b.len() && b[i] == b'\'' {
                        out.push(b' ');
                        i += 1;
                        continue;
                    }
                    break;
                }
            }
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).unwrap_or_else(|_| sample.to_string())
}

pub(crate) fn has_word(haystack: &str, word: &str) -> bool {
    let hb = haystack.as_bytes();
    let wb = word.as_bytes();
    if wb.is_empty() || hb.len() < wb.len() {
        return false;
    }
    let mut offset = 0;
    while let Some(pos) = haystack[offset..].find(word) {
        let start = offset + pos;
        let end = start + wb.len();
        let left_ok = start == 0 || !is_ident_byte(hb[start - 1]);
        let right_ok = end == hb.len() || !is_ident_byte(hb[end]);
        if left_ok && right_ok {
            return true;
        }
        offset = start + 1;
    }
    false
}
pub(crate) fn is_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

pub(crate) fn is_mysql_delimiter_tok(tok: &str) -> bool {
    if tok == ";" {
        return true;
    }
    tok.len() >= 2
        && tok
            .bytes()
            .all(|b| matches!(b, b'$' | b'/' | b';' | b'@' | b'|' | b'#' | b':' | b'~' | b'%'))
}

pub(crate) fn has_mysql_delimiter(upper: &str) -> bool {
    let mut at_stmt_start = true;
    for l in upper.lines() {
        let t = l.trim();
        if t.is_empty() {
            continue;
        }
        if at_stmt_start
            && let Some(rest) = t.strip_prefix("DELIMITER")
            && rest.starts_with(char::is_whitespace)
        {
            let mut parts = rest.split_whitespace();
            if matches!(
                (parts.next(), parts.next()),
                (Some(tok), None) if is_mysql_delimiter_tok(tok)
            ) {
                return true;
            }
        }
        at_stmt_start = t.ends_with(';') || t.ends_with("\\G");
    }
    false
}
