use std::path::{Path, PathBuf};

pub use crate::heredoc_targets::{has_non_drive_colon_slash, has_non_drive_colon_slash_str};
pub fn split_target_selector(raw: &str) -> (&str, Option<&str>) {
    let offset = if is_drive_prefix(raw) { 2 } else { 0 };
    let tail = &raw[offset..];
    if let Some(pos) = tail.find([':', '#']) {
        let split_at = offset + pos;
        if split_at > 0 {
            let file_part = &raw[..split_at];
            let sel_part = &raw[split_at + 1..];
            if is_valid_selector_tail(sel_part) {
                return (file_part, Some(sel_part));
            }
        }
    }
    (raw, None)
}

fn is_drive_prefix(raw: &str) -> bool {
    let bytes = raw.as_bytes();
    if bytes.len() < 2 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' {
        return false;
    }
    if bytes.len() == 2 || bytes[2] == b'\\' {
        return true;
    }
    if bytes[2] != b'/' {
        return false;
    }
    let tail = &raw[2..];
    if bytes[0].is_ascii_uppercase() {
        !matches!(regex_selector_body(tail), Some(body) if has_regex_syntax(body))
    } else {
        !is_valid_selector_tail(tail)
    }
}

fn has_regex_syntax(body: &str) -> bool {
    body.bytes().any(|b| {
        matches!(
            b,
            b'|' | b'\\' | b'*' | b'+' | b'?' | b'(' | b')' | b'[' | b']'
                | b'{' | b'}' | b'^' | b'$' | b':' | b'#'
        ) || b.is_ascii_whitespace()
    })
}

fn has_valid_unique_regex_flags(flags: &[u8]) -> bool {
    let mut seen = 0u8;
    for &b in flags {
        let bit = match b {
            b'g' => 1 << 0,
            b'i' => 1 << 1,
            b'm' => 1 << 2,
            b's' => 1 << 3,
            b'u' => 1 << 4,
            b'y' => 1 << 5,
            _ => return false,
        };
        if (seen & bit) != 0 {
            return false;
        }
        seen |= bit;
    }
    true
}

pub fn strip_selector(raw: &str) -> &str {
    split_target_selector(raw).0
}

fn regex_selector_body(sel: &str) -> Option<&str> {
    if !sel.starts_with('/') || sel.contains("..") {
        return None;
    }
    let bytes = sel.as_bytes();
    let mut i = 1;
    let mut in_class = false;
    while i < bytes.len() {
        match bytes[i] {
            b'\n' | b'\r' => return None,
            b'\\' => {
                if i + 1 >= bytes.len() {
                    return None;
                }
                i += 2;
            }
            b'[' if !in_class => {
                in_class = true;
                i += 1;
            }
            b']' if in_class => {
                in_class = false;
                i += 1;
            }
            b'/' if !in_class => {
                if i > 1 && has_valid_unique_regex_flags(&bytes[i + 1..]) {
                    return Some(&sel[1..i]);
                }
                return None;
            }
            _ => i += 1,
        }
    }
    None
}

fn is_valid_regex_selector(sel: &str) -> bool {
    regex_selector_body(sel).is_some()
}

fn is_valid_single_selector(sel: &str) -> bool {
    if sel.is_empty() || sel.contains("..") {
        return false;
    }
    if sel.starts_with('/') {
        return is_valid_regex_selector(sel);
    }
    !sel.contains('\\') && !sel.contains('/')
}

pub fn is_valid_selector_tail(sel: &str) -> bool {
    if sel.is_empty() || sel.contains("..") {
        return false;
    }
    let bytes = sel.as_bytes();
    let (mut start, mut i) = (0, 0);
    let (mut in_regex, mut in_class, mut in_quote) = (false, false, None);
    while i < bytes.len() {
        let b = bytes[i];
        if let Some(q) = in_quote {
            if b == b'\\' { i += 2; continue; }
            if b == q { in_quote = None; }
        } else if in_regex {
            match b {
                b'\\' => { i += 2; continue; }
                b'[' if !in_class => in_class = true,
                b']' if in_class => in_class = false,
                b'/' if !in_class => in_regex = false,
                _ => {}
            }
        } else {
            match b {
                b'\'' | b'"' => in_quote = Some(b),
                b'/' if i == start => in_regex = true,
                b',' => {
                    if !is_valid_single_selector(&sel[start..i]) { return false; }
                    start = i + 1;
                }
                _ => {}
            }
        }
        i += 1;
    }
    !in_regex && !in_class && in_quote.is_none() && is_valid_single_selector(&sel[start..])
}

pub fn has_regex_selector_part(sel: &str) -> bool {
    let bytes = sel.as_bytes();
    let (mut start, mut i) = (0, 0);
    let (mut in_regex, mut in_class, mut in_quote) = (false, false, None);
    while i < bytes.len() {
        let b = bytes[i];
        if let Some(q) = in_quote {
            if b == b'\\' { i += 2; continue; }
            if b == q { in_quote = None; }
        } else if in_regex {
            match b {
                b'\\' => { i += 2; continue; }
                b'[' if !in_class => in_class = true,
                b']' if in_class => in_class = false,
                b'/' if !in_class => in_regex = false,
                _ => {}
            }
        } else {
            match b {
                b'\'' | b'"' => in_quote = Some(b),
                b'/' if i == start => in_regex = true,
                b',' => {
                    if sel[start..i].starts_with('/') { return true; }
                    start = i + 1;
                }
                _ => {}
            }
        }
        i += 1;
    }
    sel.get(start..).is_some_and(|tail| tail.starts_with('/'))
}

pub(crate) fn push_unique_path(out: &mut Vec<PathBuf>, path: PathBuf) {
    if !out.contains(&path) {
        out.push(path);
    }
}

pub(crate) fn push_raw_target(out: &mut Vec<PathBuf>, raw: &str) {
    push_unique_path(out, PathBuf::from(strip_selector(raw)));
}

pub(crate) fn push_path_buf(out: &mut Vec<PathBuf>, path: &Path) {
    push_unique_path(out, path.to_path_buf());
}
