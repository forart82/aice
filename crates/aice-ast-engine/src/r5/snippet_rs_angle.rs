use aice_lang_registry::LanguageId;

use crate::r5::snippet_blk::find_blk_comment_close;
use crate::r5::snippet_lit::{JsLexState, StepQuote};

pub(crate) fn has_depth0_single_colon(s: &str) -> bool {
    let b = s.as_bytes();
    let (mut ad, mut pd, mut bd) = (0usize, 0usize, 0usize);
    for (k, &c) in b.iter().enumerate() {
        match c {
            b'(' => pd += 1,
            b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1,
            b']' => bd = bd.saturating_sub(1),
            b'<' if pd == 0 && bd == 0 => ad += 1,
            b'>' if pd == 0 && bd == 0 && (k == 0 || !matches!(b[k - 1], b'-' | b'=')) => {
                ad = ad.saturating_sub(1);
            }
            b':' if ad == 0 && pd == 0 && bd == 0
                && b.get(k + 1) != Some(&b':')
                && (k == 0 || b[k - 1] != b':') =>
            {
                return true;
            }
            _ => {}
        }
    }
    false
}


pub(crate) fn strip_rust_comments_strings(s: &str) -> String {
    let b = s.as_bytes();
    let (mut i, mut js, mut out) = (0usize, JsLexState::new(), String::with_capacity(s.len()));
    while i < b.len() {
        if b[i] == b'\n' {
            js.on_newline(LanguageId::Rust);
            out.push('\n');
            i += 1;
            continue;
        }
        if js.step_quote(LanguageId::Rust, b, &mut i) != StepQuote::NotInQuote {
            out.push(' ');
            continue;
        }
        if let Some((end, _)) = js.match_special(LanguageId::Rust, b, i) {
            out.push(' ');
            i = end;
            continue;
        }
        if js.open_quote(LanguageId::Rust, b, &mut i) {
            out.push(' ');
            continue;
        }
        if b[i..].starts_with(b"//") {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            out.push(' ');
            continue;
        }
        if b[i..].starts_with(b"/*") {
            let (Some(after), _) = find_blk_comment_close(LanguageId::Rust, b, i + 2, 1) else {
                break;
            };
            out.push(' ');
            i = after;
            continue;
        }
        let ch = s[i..].chars().next().unwrap_or(' ');
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

pub(crate) fn unclosed_rust_angles_after(prefix: &str, open_pos: usize) -> Vec<usize> {
    let sub = &prefix[open_pos + 1..];
    let b = sub.as_bytes();
    let (mut i, mut js, mut bd, mut pd, mut brd) = (0usize, JsLexState::new(), 0usize, 0usize, 0usize);
    let mut lts: Vec<(usize, bool)> = Vec::new();
    let (mut in_type_alias, mut saw_eq) = (false, false);
    while i < b.len() {
        if b[i] == b'\n' { js.on_newline(LanguageId::Rust); i += 1; continue; }
        if js.step_quote(LanguageId::Rust, b, &mut i) != StepQuote::NotInQuote { continue; }
        if let Some((end, _)) = js.match_special(LanguageId::Rust, b, i) { i = end; continue; }
        if js.open_quote(LanguageId::Rust, b, &mut i) { continue; }
        if b[i..].starts_with(b"//") { while i < b.len() && b[i] != b'\n' { i += 1; } continue; }
        if b[i..].starts_with(b"/*") {
            let (Some(after), _) = find_blk_comment_close(LanguageId::Rust, b, i + 2, 1) else { break; };
            i = after;
            continue;
        }
        match b[i] {
            b'{' => bd += 1,
            b'}' => bd = bd.saturating_sub(1),
            b'(' if bd == 0 => pd += 1,
            b')' if bd == 0 => pd = pd.saturating_sub(1),
            b'[' if bd == 0 => brd += 1,
            b']' if bd == 0 => brd = brd.saturating_sub(1),
            b't' if bd == 0 && pd == 0 && brd == 0 && lts.is_empty() && b[i..].starts_with(b"type")
                && (i == 0 || (!b[i - 1].is_ascii_alphanumeric() && !matches!(b[i - 1], b'_' | b'#')))
                && b.get(i + 4).is_none_or(|c| !c.is_ascii_alphanumeric() && *c != b'_') =>
            {
                in_type_alias = true;
            }
            b'=' if bd == 0 && pd == 0 && brd == 0 && lts.is_empty() && !in_type_alias
                && !matches!(b.get(i + 1), Some(b'=' | b'>'))
                && (i == 0 || !matches!(b[i - 1], b'=' | b'!' | b'<' | b'>')) =>
            {
                saw_eq = true;
            }
            b';' if bd == 0 && pd == 0 && brd == 0 => {
                lts.clear();
                in_type_alias = false;
                saw_eq = false;
            }
            b'<' if bd == 0 && pd == 0 && brd == 0 => {
                let turbo = b[..i]
                    .iter()
                    .rposition(|c| !c.is_ascii_whitespace())
                    .is_some_and(|p| p >= 1 && b[p - 1] == b':' && b[p] == b':');
                if b.get(i + 1) == Some(&b'=') || (saw_eq && !turbo && b.get(i + 1) == Some(&b'<')) {
                    i += 2;
                    continue;
                }
                lts.push((open_pos + 1 + i, saw_eq && !turbo));
            }
            b'>' if bd == 0 && pd == 0 && brd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => {
                if saw_eq && b.get(i + 1) == Some(&b'>') && lts.last().is_none_or(|&(_, eq)| eq) {
                    i += 2;
                    continue;
                }
                if b.get(i + 1) == Some(&b'=') && lts.last().is_none_or(|&(_, eq)| eq) {
                    i += 2;
                    continue;
                }
                lts.pop();
            }
            _ => {}
        }
        js.step_byte(LanguageId::Rust, b, &mut i);
    }
    lts.into_iter().map(|(p, _)| p).collect()
}

pub(crate) fn cand_closes_rust_angle(cand: &str) -> bool {
    let clean = strip_rust_comments_strings(cand);
    let b = clean.as_bytes();
    let (mut i, mut ad, mut bd, mut pd, mut brd) = (0usize, 0usize, 0usize, 0usize, 0usize);
    while i < b.len() {
        match b[i] {
            b'{' => bd += 1,
            b'}' => bd = bd.saturating_sub(1),
            b'(' if bd == 0 => pd += 1,
            b')' if bd == 0 => pd = pd.saturating_sub(1),
            b'[' if bd == 0 => brd += 1,
            b']' if bd == 0 => brd = brd.saturating_sub(1),
            b'<' if bd == 0 && pd == 0 && brd == 0 => {
                if b.get(i + 1) == Some(&b'=') { i += 2; continue; }
                ad += 1;
            }
            b'>' if bd == 0 && pd == 0 && brd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => {
                if ad == 0 {
                    if b.get(i + 1) != Some(&b'=') { return true; }
                    i += 2;
                    continue;
                }
                ad -= 1;
            }
            _ => {}
        }
        i += 1;
    }
    false
}
pub(crate) fn rust_next_code_line(sub: &str, pos: usize) -> Option<&str> {
    let b = sub.as_bytes();
    let (mut i, mut js, mut line_start, mut attr_bd) = (pos, JsLexState::new(), pos, 0usize);
    while i < b.len() {
        if b[i] == b'\n' {
            js.on_newline(LanguageId::Rust);
            i += 1;
            line_start = i;
            continue;
        }
        if attr_bd > 0 {
            if js.step_quote(LanguageId::Rust, b, &mut i) != StepQuote::NotInQuote { continue; }
            if let Some((end, _)) = js.match_special(LanguageId::Rust, b, i) { i = end; continue; }
            if js.open_quote(LanguageId::Rust, b, &mut i) { continue; }
            if b[i..].starts_with(b"//") {
                while i < b.len() && b[i] != b'\n' { i += 1; }
                continue;
            }
            if b[i..].starts_with(b"/*") {
                let (Some(after), _) = find_blk_comment_close(LanguageId::Rust, b, i + 2, 1) else {
                    return None;
                };
                if let Some(nl) = b[i + 2..after].iter().rposition(|&c| c == b'\n') {
                    line_start = i + 2 + nl + 1;
                }
                i = after;
                continue;
            }
            match b[i] {
                b'[' => attr_bd += 1,
                b']' => {
                    attr_bd = attr_bd.saturating_sub(1);
                    if attr_bd == 0 { line_start = i + 1; }
                }
                _ => {}
            }
            js.step_byte(LanguageId::Rust, b, &mut i);
            continue;
        }
        if b[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }
        if b[i..].starts_with(b"//") {
            while i < b.len() && b[i] != b'\n' { i += 1; }
            continue;
        }
        if b[i..].starts_with(b"/*") {
            let (Some(after), _) = find_blk_comment_close(LanguageId::Rust, b, i + 2, 1) else {
                return None;
            };
            line_start = after;
            i = after;
            continue;
        }
        if b[i] == b'#' {
            let mut k = i + 1;
            while k < b.len() && matches!(b[k], b' ' | b'\t') { k += 1; }
            if b.get(k) == Some(&b'!') {
                k += 1;
                while k < b.len() && matches!(b[k], b' ' | b'\t') { k += 1; }
            }
            if b.get(k) == Some(&b'[') {
                attr_bd = 1;
                i = k + 1;
                continue;
            }
        }
        let end = sub[line_start..].find('\n').map_or(sub.len(), |k| line_start + k);
        return Some(&sub[line_start..end]);
    }
    None
}

pub(crate) fn cand_before_close_angle(cand_clean: &str, mut open_lts: usize) -> &str {
    let b = cand_clean.as_bytes();
    let (mut i, mut pd, mut bd, mut cd) = (0usize, 0usize, 0usize, 0usize);
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1,
            b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1,
            b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1,
            b'}' => cd = cd.saturating_sub(1),
            b'<' if pd == 0 && bd == 0 && cd == 0 => {
                if b.get(i + 1) == Some(&b'=') { i += 2; continue; }
                open_lts += 1;
            }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => {
                open_lts = open_lts.saturating_sub(1);
                if open_lts == 0 {
                    return &cand_clean[..i];
                }
            }
            _ => {}
        }
        i += 1;
    }
    cand_clean
}
