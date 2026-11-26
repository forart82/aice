use aice_lang_registry::LanguageId;

use crate::r5::snippet_ml_extra::{match_cpp_raw_string, match_php_heredoc};

#[inline]
pub(crate) fn quote_allows_multiline(lang: LanguageId, q: u8) -> bool {
    q == b'`'
        || (lang == LanguageId::Rust && q == b'"')
        || matches!(lang, LanguageId::Php | LanguageId::Bash | LanguageId::Ruby)
}

#[inline]
pub(crate) fn allows_escaped_newline(lang: LanguageId) -> bool {
    matches!(
        lang,
        LanguageId::C
            | LanguageId::Cpp
            | LanguageId::JavaScript
            | LanguageId::TypeScript
            | LanguageId::Tsx
            | LanguageId::Python
            | LanguageId::Css
    )
}

pub fn quote_allows_escape(lang: LanguageId, q: u8) -> bool {
    !((lang == LanguageId::Bash && q == b'\'') || (lang == LanguageId::Go && q == b'`'))
}

pub(crate) fn step_quote(lang: LanguageId, b: &[u8], i: &mut usize, quote: &mut Option<u8>) -> bool {
    if let Some(q) = *quote {
        if b[*i] == b'\\' && quote_allows_escape(lang, q) {
            if *i + 1 >= b.len()
                || (matches!(b[*i + 1], b'\n' | b'\r') && !allows_escaped_newline(lang))
            {
                *i += 1;
            } else {
                *i += if b[*i + 1] == b'\r' && b.get(*i + 2) == Some(&b'\n') { 3 } else { 2 };
                while *i < b.len() && (b[*i] & 0xC0) == 0x80 {
                    *i += 1;
                }
            }
        } else {
            if b[*i] == q {
                *quote = None;
            }
            *i += 1;
        }
        return true;
    }
    false
}

pub(crate) fn match_ml_literal_end(
    lang: LanguageId,
    b: &[u8],
    i: usize,
) -> Option<(usize, bool)> {
    match lang {
        LanguageId::Rust => {
            if b[i] == b'\'' {
                rust_char_end(b, i).map(|end| (end, true))
            } else {
                match_rust_raw_string(b, i)
            }
        }
        LanguageId::Python => match_triple_quote(b, i, b'"', true, false)
            .or_else(|| match_triple_quote(b, i, b'\'', true, false)),
        LanguageId::Java => match_java_text_block(b, i),
        LanguageId::Kotlin => match_triple_quote(b, i, b'"', false, true),
        LanguageId::Dart => match_dart_string(b, i),
        LanguageId::CSharp => match_csharp_string(b, i),
        LanguageId::Cpp => match_cpp_raw_string(b, i),
        LanguageId::Php => match_php_heredoc(b, i),
        _ => None,
    }
}

fn rust_char_end(b: &[u8], i: usize) -> Option<usize> {
    if b[i] != b'\'' || i + 2 >= b.len() {
        return None;
    }
    if b[i + 1] == b'\\' {
        for (offset, &ch) in b[(i + 3)..(i + 12).min(b.len())].iter().enumerate() {
            if matches!(ch, b'\n' | b'\r') {
                break;
            }
            if ch == b'\'' {
                return Some(i + 3 + offset + 1);
            }
        }
        return None;
    }
    if matches!(b[i + 1], b'\'' | b'\n' | b'\r') {
        return None;
    }
    let clen = match b[i + 1] {
        0..=0x7F => 1,
        0xC2..=0xDF => 2,
        0xE0..=0xEF => 3,
        0xF0..=0xF4 => 4,
        _ => return None,
    };
    (i + 1 + clen < b.len() && b[i + 1 + clen] == b'\'').then_some(i + 2 + clen)
}

fn match_rust_raw_string(b: &[u8], i: usize) -> Option<(usize, bool)> {
    if i > 0 && (b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'_') {
        return None;
    }
    let mut j = if b[i] == b'r' {
        i + 1
    } else if matches!(b[i], b'b' | b'c') && b.get(i + 1) == Some(&b'r') {
        i + 2
    } else {
        return None;
    };
    let mut hashes = 0usize;
    while b.get(j) == Some(&b'#') {
        hashes += 1;
        j += 1;
    }
    if b.get(j) != Some(&b'"') {
        return None;
    }
    j += 1;
    while j < b.len() {
        if b[j] == b'"'
            && b.get(j + 1..j + 1 + hashes)
                .is_some_and(|s| s.iter().all(|&c| c == b'#'))
        {
            return Some((j + 1 + hashes, true));
        }
        j += 1;
    }
    Some((b.len(), false))
}

fn match_triple_quote(
    b: &[u8],
    i: usize,
    q: u8,
    allow_escape: bool,
    consume_extra: bool,
) -> Option<(usize, bool)> {
    if i + 3 > b.len() || b[i] != q || b[i + 1] != q || b[i + 2] != q {
        return None;
    }
    let mut j = i + 3;
    while j < b.len() {
        if allow_escape && b[j] == b'\\' {
            if j + 1 < b.len() {
                j += if b[j + 1] == b'\r' && b.get(j + 2) == Some(&b'\n') { 3 } else { 2 };
                while j < b.len() && (b[j] & 0xC0) == 0x80 {
                    j += 1;
                }
            } else {
                j += 1;
            }
            continue;
        }
        if j + 3 <= b.len() && b[j] == q && b[j + 1] == q && b[j + 2] == q {
            let mut end = j + 3;
            if consume_extra {
                let mut extra = 0usize;
                while extra < 2 && end < b.len() && b[end] == q {
                    end += 1;
                    extra += 1;
                }
            }
            return Some((end, true));
        }
        j += 1;
    }
    Some((b.len(), false))
}

fn match_java_text_block(b: &[u8], i: usize) -> Option<(usize, bool)> {
    if !b[i..].starts_with(b"\"\"\"") {
        return None;
    }
    let mut k = i + 3;
    while k < b.len() && matches!(b[k], b' ' | b'\t' | 0x0C) {
        k += 1;
    }
    if k < b.len() && !matches!(b[k], b'\n' | b'\r') {
        return None;
    }
    match_triple_quote(b, i, b'"', true, false)
}

fn match_dart_string(b: &[u8], i: usize) -> Option<(usize, bool)> {
    if b[i] == b'r' && (i == 0 || !(b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'_')) {
        if b[i + 1..].starts_with(b"\"\"\"") {
            return match_triple_quote(b, i + 1, b'"', false, false);
        }
        if b[i + 1..].starts_with(b"'''") {
            return match_triple_quote(b, i + 1, b'\'', false, false);
        }
        if let Some(&q) = b.get(i + 1).filter(|&&c| c == b'"' || c == b'\'') {
            let mut j = i + 2;
            while j < b.len() {
                if b[j] == q {
                    return Some((j + 1, true));
                }
                if matches!(b[j], b'\n' | b'\r') {
                    return Some((j, false));
                }
                j += 1;
            }
            return Some((b.len(), false));
        }
    }
    match_triple_quote(b, i, b'"', true, false)
        .or_else(|| match_triple_quote(b, i, b'\'', true, false))
}

fn match_csharp_string(b: &[u8], i: usize) -> Option<(usize, bool)> {
    if b[i] == b'@' {
        let mut j = i + 1;
        if b.get(j) == Some(&b'$') {
            j += 1;
        }
        if b.get(j) == Some(&b'"') {
            j += 1;
            while j < b.len() {
                if b[j] == b'"' {
                    if b.get(j + 1) == Some(&b'"') {
                        j += 2;
                        continue;
                    }
                    return Some((j + 1, true));
                }
                j += 1;
            }
            return Some((b.len(), false));
        }
    }
    let mut n = 0usize;
    while i + n < b.len() && b[i + n] == b'"' {
        n += 1;
    }
    if n < 3 {
        return None;
    }
    let mut j = i + n;
    while j < b.len() {
        if b[j] == b'"' {
            let mut run = 0usize;
            while j + run < b.len() && b[j + run] == b'"' {
                run += 1;
            }
            if run >= n {
                return Some((j + run, true));
            }
            j += run;
            continue;
        }
        j += 1;
    }
    Some((b.len(), false))
}
