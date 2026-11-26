use aice_lang_registry::LanguageId;

use crate::r5::snippet_blk::find_blk_comment_close;
use crate::r5::snippet_lit::{JsLexState, StepQuote};
use crate::r5::snippet_rs_angle::{
    has_depth0_single_colon, rust_next_code_line, strip_rust_comments_strings,
};
use crate::r5::snippet_rs_hdr::{line_starts_rust_field, line_starts_rust_item, line_starts_rust_variant};
pub(crate) fn rust_scan_container_tail(sub: &str, is_enum: bool) -> (usize, bool) {
    let (sep, saw_eq, _, _) = rust_scan_container_tail_flags(sub, is_enum);
    (sep, saw_eq)
}

pub(crate) fn rust_scan_container_tail_flags(sub: &str, is_enum: bool) -> (usize, bool, bool, bool) {
    let b = sub.as_bytes();
    let (mut i, mut js, mut bd, mut last_sep) = (0usize, JsLexState::new(), 0usize, 0usize);
    let (mut stack, mut brack_semi, mut brack_eq): (Vec<u8>, Vec<bool>, Vec<u8>) =
        (Vec::new(), Vec::new(), Vec::new());
    let (mut in_type_alias, mut saw_eq, mut in_fn_sig, mut saw_open_attr) = (false, false, false, false);
    let pop_to = |delim: u8, stk: &mut Vec<u8>, bs: &mut Vec<bool>, be: &mut Vec<u8>| {
        if let Some(p) = stk.iter().rposition(|&d| d == delim) {
            stk.truncate(p);
            let n_br = stk.iter().filter(|&&d| d == b'[').count();
            bs.truncate(n_br);
            be.truncate(n_br);
        }
    };
    while i < b.len() {
        if b[i] == b'\n' {
            let has_brack_semi = brack_semi.iter().any(|&x| x);
            let has_brack_eq = stack.contains(&b'[') && (saw_eq || brack_eq.contains(&1));
            if bd == 0 && !stack.is_empty() && (has_brack_semi || has_brack_eq || (is_enum && saw_open_attr))
                && let Some(next_line) = rust_next_code_line(sub, i + 1)
            {
                let pre_nl_comma = strip_rust_comments_strings(&sub[..i]).trim_end().ends_with(',');
                if line_starts_rust_item(next_line)
                    || (!is_enum && (has_brack_semi || has_brack_eq) && !pre_nl_comma && line_starts_rust_field(next_line))
                    || (is_enum && (has_brack_semi || saw_open_attr) && line_starts_rust_variant(next_line, false))
                {
                    stack.clear(); brack_semi.clear(); brack_eq.clear();
                    last_sep = i + 1;
                    (in_type_alias, saw_eq, in_fn_sig, saw_open_attr) = (false, false, false, false);
                }
            }
        }
        if js.open_quote(LanguageId::Rust, b, &mut i) { continue; }
        if b[i..].starts_with(b"//") { while i < b.len() && b[i] != b'\n' { i += 1; } continue; }
        if b[i..].starts_with(b"/*") {
            let (Some(after), _) = find_blk_comment_close(LanguageId::Rust, b, i + 2, 1) else { break; };
            i = after; continue;
        }
        let in_arr_len = brack_semi.iter().any(|&x| x);
        match b[i] {
            b'{' => bd += 1,
            b'}' if bd > 0 => {
                bd -= 1;
                if bd == 0 && stack.is_empty() {
                    last_sep = i + 1;
                    (in_type_alias, saw_eq, in_fn_sig, saw_open_attr) = (false, false, false, false);
                }
            }
            b'(' if bd == 0 => stack.push(b'('),
            b')' if bd == 0 => pop_to(b'(', &mut stack, &mut brack_semi, &mut brack_eq),
            b'[' if bd == 0 => {
                let is_attr = b[last_sep..i].iter().rfind(|c| !c.is_ascii_whitespace())
                    .is_some_and(|&c| c == b'#' || c == b'!');
                stack.push(b'['); brack_semi.push(false); brack_eq.push(if is_attr { 2 } else { 0 });
            }
            b']' if bd == 0 => {
                let was_attr = brack_eq.last() == Some(&2);
                pop_to(b'[', &mut stack, &mut brack_semi, &mut brack_eq);
                if was_attr && !stack.is_empty() && saw_eq { saw_open_attr = true; }
            }
            b';' if bd == 0 => {
                let eq_in_brack = brack_eq.contains(&1);
                if let Some(last) = brack_semi.last_mut() { *last = true; }
                if !stack.contains(&b'[') || in_arr_len || eq_in_brack || stack.last() == Some(&b'(') {
                    stack.clear(); brack_semi.clear(); brack_eq.clear();
                    last_sep = i + 1;
                    (in_type_alias, saw_eq, in_fn_sig, saw_open_attr) = (false, false, false, false);
                }
            }
            b',' if bd == 0 && stack.is_empty() => {
                if is_enum || (!saw_eq && !in_fn_sig) { last_sep = i + 1; }
                in_type_alias = false;
                if is_enum { saw_eq = false; }
                saw_open_attr = false;
            }
            b'=' if bd == 0 && !in_type_alias
                && !matches!(b.get(i + 1), Some(b'=' | b'>'))
                && (i == 0 || !matches!(b[i - 1], b'=' | b'!' | b'<' | b'>')) =>
            {
                if stack.is_empty() { saw_eq = true; }
                else if stack.last() == Some(&b'[')
                    && let Some(last) = brack_eq.last_mut() && *last == 0 { *last = 1; }
            }
            b'f' if !is_enum && bd == 0 && stack.is_empty() && b[i..].starts_with(b"fn")
                && (i == 0 || (!b[i - 1].is_ascii_alphanumeric() && !matches!(b[i - 1], b'_' | b'#')))
                && b.get(i + 2).is_none_or(|c| !c.is_ascii_alphanumeric() && *c != b'_')
                && !has_depth0_single_colon(&sub[last_sep..i]) => { in_fn_sig = true; }
            b'w' if !is_enum && bd == 0 && stack.is_empty() && b[i..].starts_with(b"where")
                && (i == 0 || (!b[i - 1].is_ascii_alphanumeric() && !matches!(b[i - 1], b'_' | b'#')))
                && b.get(i + 5).is_none_or(|c| !c.is_ascii_alphanumeric() && *c != b'_') => { in_fn_sig = true; }
            b't' if bd == 0 && stack.is_empty() && b[i..].starts_with(b"type")
                && (i == 0 || (!b[i - 1].is_ascii_alphanumeric() && !matches!(b[i - 1], b'_' | b'#')))
                && b.get(i + 4).is_none_or(|c| !c.is_ascii_alphanumeric() && *c != b'_') => { in_type_alias = true; }
            b'<' if bd == 0 && !in_arr_len => {
                let turbo = b[..i]
                    .iter()
                    .rposition(|c| !c.is_ascii_whitespace())
                    .is_some_and(|p| p >= 1 && b[p - 1] == b':' && b[p] == b':');
                if !saw_eq || turbo {
                    if b.get(i + 1) == Some(&b'=') || (saw_eq && !turbo && b.get(i + 1) == Some(&b'<')) {
                        i += 2;
                        continue;
                    }
                    stack.push(b'<');
                }
            }
            b'>' if bd == 0 && !in_arr_len && (!saw_eq || stack.contains(&b'<'))
                && (i == 0 || !matches!(b[i - 1], b'-' | b'='))
                && stack.last() == Some(&b'<') =>
            {
                stack.pop();
            }
            _ => {}
        }
        js.step_byte(LanguageId::Rust, b, &mut i);
    }
    let has_brack_semi = bd == 0 && brack_semi.iter().any(|&x| x);
    let has_brack_eq = bd == 0 && stack.contains(&b'[') && (saw_eq || brack_eq.contains(&1));
    (last_sep, saw_eq, has_brack_semi, has_brack_eq)
}

pub(crate) fn rust_enum_tail_ends_with_attr(rem_tail: &str) -> bool {
    let clean = strip_rust_comments_strings(rem_tail);
    let b = clean.trim_end().as_bytes();
    if b.last() != Some(&b']') {
        return false;
    }
    let (mut depth, mut i) = (0usize, b.len());
    while i > 0 {
        i -= 1;
        match b[i] {
            b']' => depth += 1,
            b'[' => {
                depth -= 1;
                if depth == 0 {
                    return b[..i]
                        .iter()
                        .rfind(|c| !c.is_ascii_whitespace())
                        .is_some_and(|&c| c == b'#');
                }
            }
            _ => {}
        }
    }
    false
}
pub(crate) fn rust_item_line_start_in(prefix: &str, start_pos: usize, end_pos: usize) -> Option<usize> {
    if end_pos <= start_pos { return None; }
    let sub = &prefix[start_pos..end_pos];
    let b = sub.as_bytes();
    let (mut i, mut js, mut bd, mut seg_bd, mut seg_start, mut last_item) =
        (0usize, JsLexState::new(), 0usize, 0usize, 0usize, None);
    while i < b.len() {
        if b[i] == b'\n' {
            if seg_bd == 0 && line_starts_rust_item(&sub[seg_start..i]) {
                last_item = Some(start_pos + seg_start);
            }
            js.on_newline(LanguageId::Rust);
            i += 1;
            seg_start = i;
            seg_bd = bd;
            continue;
        }
        if js.step_quote(LanguageId::Rust, b, &mut i) != StepQuote::NotInQuote { continue; }
        if let Some((end, _)) = js.match_special(LanguageId::Rust, b, i) { i = end; continue; }
        if js.open_quote(LanguageId::Rust, b, &mut i) { continue; }
        if b[i..].starts_with(b"//") { while i < b.len() && b[i] != b'\n' { i += 1; } continue; }
        if b[i..].starts_with(b"/*") {
            let (Some(after), _) = find_blk_comment_close(LanguageId::Rust, b, i + 2, 1) else { break; };
            i = after;
            continue;
        }
        if b[i] == b'{' {
            bd += 1;
        } else if b[i] == b'}' {
            bd = bd.saturating_sub(1);
        } else if b[i] == b';' && bd == 0 {
            if seg_bd == 0 && line_starts_rust_item(&sub[seg_start..i]) {
                last_item = Some(start_pos + seg_start);
            }
            i += 1;
            seg_start = i;
            seg_bd = bd;
            continue;
        }
        js.step_byte(LanguageId::Rust, b, &mut i);
    }
    if seg_bd == 0 && line_starts_rust_item(&sub[seg_start..]) {
        last_item = Some(start_pos + seg_start);
    }
    last_item
}
pub(crate) use crate::r5::snippet_rs_hdr::ctx_has_fn_decl;

pub(crate) fn rust_ctx_state(s: &str) -> (Vec<u8>, usize, usize, bool) {
    let b = s.as_bytes();
    let (mut i, mut js, mut bd, mut extra_r, mut unm) = (0usize, JsLexState::new(), 0usize, 0usize, false);
    let (mut stack, mut brack_semi): (Vec<u8>, Vec<bool>) = (Vec::new(), Vec::new());
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
        let in_arr_len = brack_semi.iter().any(|&x| x);
        match b[i] {
            b'{' => bd += 1,
            b'}' => {
                if bd > 0 { bd -= 1; }
                else {
                    if !stack.is_empty() { unm = true; }
                    extra_r += 1;
                }
            }
            b'(' if bd == 0 => stack.push(b'('),
            b')' if bd == 0 => {
                if stack.last() == Some(&b'(') { stack.pop(); } else { unm = true; }
            }
            b'[' if bd == 0 => { stack.push(b'['); brack_semi.push(false); }
            b']' if bd == 0 => {
                brack_semi.pop();
                if stack.last() == Some(&b'[') { stack.pop(); } else { unm = true; }
            }
            b';' if bd == 0 => {
                if let Some(last) = brack_semi.last_mut() { *last = true; }
                if stack.is_empty() { in_type_alias = false; saw_eq = false; }
            }
            b',' if bd == 0 && stack.is_empty() => { in_type_alias = false; saw_eq = false; }
            b'=' if bd == 0 && stack.is_empty() && !in_type_alias
                && !matches!(b.get(i + 1), Some(b'=' | b'>'))
                && (i == 0 || !matches!(b[i - 1], b'=' | b'!' | b'<' | b'>')) => { saw_eq = true; }
            b't' if bd == 0 && stack.is_empty() && b[i..].starts_with(b"type")
                && (i == 0 || (!b[i - 1].is_ascii_alphanumeric() && !matches!(b[i - 1], b'_' | b'#')))
                && b.get(i + 4).is_none_or(|c| !c.is_ascii_alphanumeric() && *c != b'_') => { in_type_alias = true; }
            b'<' if bd == 0 && !in_arr_len => {
                let turbo = b[..i].iter().rposition(|c| !c.is_ascii_whitespace())
                    .is_some_and(|p| p >= 1 && b[p - 1] == b':' && b[p] == b':');
                if !saw_eq || turbo {
                    if b.get(i + 1) == Some(&b'=') || (saw_eq && !turbo && b.get(i + 1) == Some(&b'<')) {
                        i += 2;
                        continue;
                    }
                    stack.push(b'<');
                }
            }
            b'>' if bd == 0 && !in_arr_len && (!saw_eq || stack.contains(&b'<'))
                && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) =>
            {
                if b.get(i + 1) == Some(&b'=') && !stack.contains(&b'<') { i += 2; continue; }
                if stack.last() == Some(&b'<') { stack.pop(); }
            }
            _ => {}
        }
        js.step_byte(LanguageId::Rust, b, &mut i);
    }
    (stack, bd, extra_r, unm)
}
