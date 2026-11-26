use crate::r5::snippet_rs_angle::strip_rust_comments_strings;
use crate::r5::snippet_rs_attr::is_rust_type_hdr_clean;

pub(crate) fn is_rust_type_hdr(hdr: &str) -> bool {
    is_rust_type_hdr_clean(&strip_rust_comments_strings(hdr))
}
pub(crate) fn scan_rust_hdr_to(
    prefix_lines: &[&str],
    prefix: &str,
    open_pos: usize,
    line_idx: usize,
    min_byte: usize,
) -> String {
    let ls = prefix[..open_pos].rfind('\n').map_or(0, |p| p + 1);
    let tail_part = &prefix[ls.max(min_byte)..=open_pos];
    let min_line = if min_byte > ls { line_idx } else { line_idx.saturating_sub(16) };
    let mut start = line_idx;
    while start > min_line {
        let cur = if start < line_idx {
            format!("{}\n{tail_part}", prefix_lines[start..line_idx].join("\n"))
        } else {
            tail_part.to_string()
        };
        if is_rust_type_hdr(&cur) {
            return cur;
        }
        let prev = strip_rust_comments_strings(prefix_lines[start - 1]);
        if prev.trim_end().ends_with([';', '}', '{']) {
            return cur;
        }
        start -= 1;
    }
    if start < line_idx {
        format!("{}\n{tail_part}", prefix_lines[start..line_idx].join("\n"))
    } else {
        tail_part.to_string()
    }
}

pub(crate) fn skip_rust_item_prefix(clean: &str, mods: &[&str]) -> usize {
    let b = clean.as_bytes();
    let (mut i, mut bd, mut pd) = (0usize, 0usize, 0usize);
    while i < b.len() {
        if b[i] == b'[' { bd += 1; i += 1; continue; }
        if b[i] == b']' { bd = bd.saturating_sub(1); i += 1; continue; }
        if bd > 0 { i += 1; continue; }
        if b[i] == b'(' { pd += 1; i += 1; continue; }
        if b[i] == b')' { pd = pd.saturating_sub(1); i += 1; continue; }
        if pd > 0 { i += 1; continue; }
        if b[i].is_ascii_whitespace() || b[i] == b'#' || b[i] == b'!' { i += 1; continue; }
        if b[i].is_ascii_alphabetic() || b[i] == b'_' {
            let start = i;
            let mut j = i;
            while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'_') { j += 1; }
            if mods.contains(&&clean[start..j]) { i = j; continue; }
        }
        return i;
    }
    b.len()
}

pub(crate) fn is_rust_type_item(ctx_clean: &str) -> bool {
    let i = skip_rust_item_prefix(ctx_clean, &["pub", "default", "unsafe"]);
    let tail = &ctx_clean[i..];
    let w = tail.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').next().unwrap_or("");
    w == "type"
}

pub(crate) fn rust_fn_has_params_or_where(clean: &str) -> bool {
    let b = clean.as_bytes();
    let (mut i, mut pd, mut bd, mut cd, mut ad) = (0usize, 0usize, 0usize, 0usize, 0usize);
    let is_id = |c: u8| c.is_ascii_alphanumeric() || c == b'_';
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1,
            b')' => {
                pd = pd.saturating_sub(1);
                if pd == 0 && bd == 0 && cd == 0 && ad == 0 { return true; }
            }
            b'[' => bd += 1,
            b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1,
            b'}' => cd = cd.saturating_sub(1),
            b'<' if pd == 0 && bd == 0 && cd == 0 => {
                if b.get(i + 1) == Some(&b'=') { i += 2; continue; }
                ad += 1;
            }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => {
                ad = ad.saturating_sub(1);
            }
            b'w' if pd == 0 && bd == 0 && cd == 0 && ad == 0 && b[i..].starts_with(b"where")
                && (i == 0 || !is_id(b[i - 1]))
                && b.get(i + 5).is_none_or(|&c| !is_id(c)) => return true,
            _ => {}
        }
        i += 1;
    }
    false
}

pub(crate) fn line_starts_rust_item(line: &str) -> bool {
    let clean = strip_rust_comments_strings(line);
    let mut i = skip_rust_item_prefix(&clean, &["pub", "default", "unsafe", "async", "extern"]);
    let b = clean.as_bytes();
    if i < b.len() && (b[i].is_ascii_alphabetic() || b[i] == b'_') {
        let start = i;
        while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') { i += 1; }
        if matches!(&clean[start..i], "fn" | "const" | "static" | "type") {
            while i < b.len() && b[i].is_ascii_whitespace() { i += 1; }
            return b.get(i).is_some_and(|&c| c.is_ascii_alphabetic() || c == b'_');
        }
    }
    false
}

pub(crate) fn line_starts_rust_field(line: &str) -> bool {
    let clean = strip_rust_comments_strings(line);
    let mut i = skip_rust_item_prefix(&clean, &["pub"]);
    let b = clean.as_bytes();
    if i < b.len() && (b[i].is_ascii_alphabetic() || b[i] == b'_') {
        while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') { i += 1; }
        while i < b.len() && b[i].is_ascii_whitespace() { i += 1; }
        return b.get(i) == Some(&b':') && b.get(i + 1) != Some(&b':');
    }
    false
}

pub(crate) fn line_starts_rust_variant(line: &str, allow_bare: bool) -> bool {
    let clean = strip_rust_comments_strings(line);
    let mut i = skip_rust_item_prefix(&clean, &["pub"]);
    let b = clean.as_bytes();
    if i < b.len() && (b[i].is_ascii_alphabetic() || b[i] == b'_') {
        while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') { i += 1; }
        while i < b.len() && b[i].is_ascii_whitespace() { i += 1; }
        return matches!(b.get(i), Some(b'(' | b'{' | b','))
            || (b.get(i) == Some(&b'=') && b.get(i + 1) != Some(&b'='))
            || (allow_bare && matches!(b.get(i), None | Some(b'}')));
    }
    false
}

pub(crate) fn is_incomplete_rust_item(item: &str) -> bool {
    let clean = strip_rust_comments_strings(item);
    if clean.trim().is_empty() { return false; }
    let b = clean.as_bytes();
    let (mut i, mut pd, mut bd, mut cd, mut ad) = (0usize, 0usize, 0usize, 0usize, 0usize);
    let (mut in_type_alias, mut saw_eq, mut brack_semi): (bool, bool, Vec<bool>) = (false, false, Vec::new());
    while i < b.len() {
        let in_arr_len = brack_semi.iter().any(|&x| x);
        match b[i] {
            b'(' if cd == 0 => pd += 1,
            b')' if cd == 0 => pd = pd.saturating_sub(1),
            b'[' if cd == 0 => { bd += 1; brack_semi.push(false); }
            b']' if cd == 0 => { bd = bd.saturating_sub(1); brack_semi.pop(); }
            b'{' => cd += 1,
            b'}' => {
                cd = cd.saturating_sub(1);
                if cd == 0 && pd == 0 && bd == 0 && ad == 0 { return false; }
            }
            b';' => {
                if cd == 0 && let Some(last) = brack_semi.last_mut() { *last = true; }
                if cd == 0 && pd == 0 && bd == 0 && ad == 0 { return false; }
            }
            b'=' if cd == 0 && pd == 0 && bd == 0 && ad == 0 && !in_type_alias
                && !matches!(b.get(i + 1), Some(b'=' | b'>'))
                && (i == 0 || !matches!(b[i - 1], b'=' | b'!' | b'<' | b'>')) => saw_eq = true,
            b't' if cd == 0 && pd == 0 && bd == 0 && ad == 0 && b[i..].starts_with(b"type")
                && (i == 0 || (!b[i - 1].is_ascii_alphanumeric() && !matches!(b[i - 1], b'_' | b'#')))
                && b.get(i + 4).is_none_or(|c| !c.is_ascii_alphanumeric() && *c != b'_') => in_type_alias = true,
            b'<' if cd == 0 && pd == 0 && !in_arr_len => {
                let turbo = b[..i].iter().rposition(|c| !c.is_ascii_whitespace())
                    .is_some_and(|p| p >= 1 && b[p - 1] == b':' && b[p] == b':');
                if !saw_eq || turbo {
                    if matches!(b.get(i + 1), Some(b'=' | b'<')) { i += 2; continue; }
                    ad += 1;
                }
            }
            b'>' if cd == 0 && pd == 0 && !in_arr_len && (!saw_eq || ad > 0)
                && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => ad = ad.saturating_sub(1),
            _ => {}
        }
        i += 1;
    }
    true
}

pub(crate) fn ctx_has_fn_decl(ctx_tail: &str) -> bool {
    let clean = strip_rust_comments_strings(ctx_tail);
    let b = clean.as_bytes();
    let (mut i, mut pd, mut bd, mut cd, mut ad, mut last) = (0usize, 0usize, 0usize, 0usize, 0usize, 0usize);
    let (mut in_type_alias, mut saw_eq, mut brack_semi): (bool, bool, Vec<bool>) = (false, false, Vec::new());
    while i < b.len() {
        let in_arr_len = brack_semi.iter().any(|&x| x);
        match b[i] {
            b'(' if cd == 0 => pd += 1,
            b')' if cd == 0 => pd = pd.saturating_sub(1),
            b'[' if cd == 0 => { bd += 1; brack_semi.push(false); }
            b']' if cd == 0 => { bd = bd.saturating_sub(1); brack_semi.pop(); }
            b'{' => cd += 1,
            b'}' => {
                cd = cd.saturating_sub(1);
                if pd == 0 && bd == 0 && cd == 0 && ad == 0 {
                    last = i + 1;
                    (in_type_alias, saw_eq) = (false, false);
                }
            }
            b';' => {
                if cd == 0 && let Some(last_b) = brack_semi.last_mut() { *last_b = true; }
                if pd == 0 && bd == 0 && cd == 0 && ad == 0 {
                    last = i + 1;
                    (in_type_alias, saw_eq) = (false, false);
                }
            }
            b'=' if pd == 0 && bd == 0 && cd == 0 && ad == 0 && !in_type_alias
                && !matches!(b.get(i + 1), Some(b'=' | b'>'))
                && (i == 0 || !matches!(b[i - 1], b'=' | b'!' | b'<' | b'>')) => saw_eq = true,
            b't' if pd == 0 && bd == 0 && cd == 0 && ad == 0 && b[i..].starts_with(b"type")
                && (i == 0 || (!b[i - 1].is_ascii_alphanumeric() && !matches!(b[i - 1], b'_' | b'#')))
                && b.get(i + 4).is_none_or(|c| !c.is_ascii_alphanumeric() && *c != b'_') => in_type_alias = true,
            b'<' if pd == 0 && bd == 0 && cd == 0 && !in_arr_len => {
                let turbo = b[..i].iter().rposition(|c| !c.is_ascii_whitespace())
                    .is_some_and(|p| p >= 1 && b[p - 1] == b':' && b[p] == b':');
                if !saw_eq || turbo {
                    if matches!(b.get(i + 1), Some(b'=' | b'<')) { i += 2; continue; }
                    ad += 1;
                }
            }
            b'>' if pd == 0 && bd == 0 && cd == 0 && !in_arr_len && (!saw_eq || ad > 0)
                && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => ad = ad.saturating_sub(1),
            _ => {}
        }
        i += 1;
    }
    let ib = &clean.as_bytes()[last..];
    let (mut pd, mut bd, mut cd) = (0usize, 0usize, 0usize);
    for (i, &c) in ib.iter().enumerate() {
        match c {
            b'(' => pd += 1,
            b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1,
            b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1,
            b'}' => cd = cd.saturating_sub(1),
            b':' if pd == 0 && bd == 0 && cd == 0
                && ib.get(i + 1) != Some(&b':') && (i == 0 || ib[i - 1] != b':') => return false,
            b'=' if pd == 0 && bd == 0 && cd == 0
                && !matches!(ib.get(i + 1), Some(b'=' | b'>'))
                && (i == 0 || !matches!(ib[i - 1], b'=' | b'!' | b'<' | b'>')) => return false,
            b'f' if pd == 0 && bd == 0 && cd == 0 && ib[i..].starts_with(b"fn")
                && (i == 0 || (!ib[i - 1].is_ascii_alphanumeric() && !matches!(ib[i - 1], b'_' | b'#')))
                && ib.get(i + 2).is_none_or(|ch| !ch.is_ascii_alphanumeric() && *ch != b'_') => return true,
            _ => {}
        }
    }
    false
}
