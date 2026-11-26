use std::borrow::Cow;

use aice_lang_registry::LanguageId;

use crate::dep_callers_quote::{QuoteDepthTracker, StepKind};

pub(crate) fn scan_bash_delim_dq(raw: &str, start_q: usize, delim: &mut String) -> Option<usize> {
    let b = raw.as_bytes();
    let mut tr = QuoteDepthTracker::new_for(LanguageId::Bash);
    tr.step('"', raw[start_q + 1..].chars().next());
    let mut j = start_q + 1;
    let mut stop_push = false;
    let mut inner_sq = false;
    while j < b.len() {
        let in_inner_dq = tr.quote == Some('"')
            && tr.bash_dq.in_dq()
            && (tr.bash_param_depth() > 0 || tr.bash_paren_depth() > 0);
        if b[j] == b'\\' {
            if j + 1 >= b.len() {
                return None;
            }
            let nch = raw[j + 1..].chars().next()?;
            if !stop_push {
                if !inner_sq && (in_inner_dq || matches!(nch, '"' | '\\' | '$' | '`')) {
                    delim.push(nch);
                } else {
                    delim.push('\\');
                    delim.push(nch);
                }
            }
            if tr.in_bash_bt() && nch == '`' && tr.quote != Some('\'') {
                tr.step('\\', Some('`'));
                let next_after = raw[j + 2..].chars().next();
                tr.step('`', next_after);
            } else if tr.bash_paren_depth() == 0
                && tr.bash_param_depth() == 0
                && !tr.in_bash_bt()
                && !tr.bash_in_dq_sq()
            {
                tr.step('\\', Some(nch));
                let next_after = raw[j + 1 + nch.len_utf8()..].chars().next();
                tr.step(nch, next_after);
            } else {
                tr.bash_on_escape_char();
                tr.bash_dq_reset_dollar();
            }
            j += 1 + nch.len_utf8();
            continue;
        }
        let ch = raw[j..].chars().next()?;
        let next = raw[j + ch.len_utf8()..].chars().next();
        if ch == '\'' && tr.bash_in_param() && tr.bash_dq_prev_dollar() && j > 0 && b[j - 1] == b'$' {
            if !stop_push {
                delim.pop();
            }
            tr.bash_dq_reset_dollar();
            let mut tmp = String::new();
            let (nj, seen_nul) = scan_bash_delim_ansi_sq(raw, j - 1, &mut tmp)?;
            if !stop_push {
                tmp.retain(|c| c != '"');
                delim.push_str(&tmp);
                if seen_nul {
                    stop_push = true;
                }
            }
            j = nj;
            continue;
        }
        if in_inner_dq && ch == '\'' {
            inner_sq = !inner_sq;
            tr.step(ch, next);
            j += 1;
            continue;
        }
        let kind = tr.step(ch, next);
        j += ch.len_utf8();
        if kind == StepKind::EnterTemplate {
            if !stop_push {
                delim.push(ch);
                if let Some(nch) = next {
                    delim.push(nch);
                }
            }
            if let Some(nch) = next {
                j += nch.len_utf8();
            }
            continue;
        }
        if tr.quote.is_none()
            && tr.bash_paren_depth() == 0
            && tr.bash_param_depth() == 0
            && !tr.in_bash_bt()
        {
            if inner_sq && ch == '"' && !stop_push {
                delim.push('"');
            }
            return Some(j);
        }
        if !stop_push && (inner_sq || !(ch == '"' && tr.quote != Some('\'') && !tr.bash_in_dq_sq())) {
            delim.push(ch);
        }
    }
    None
}

fn push_ansi_ch(ch: char, delim: &mut String, seen_nul: &mut bool) {
    if ch == '\0' {
        *seen_nul = true;
    } else if !*seen_nul {
        delim.push(ch);
    }
}

pub(crate) fn scan_bash_delim_ansi_sq(
    raw: &str,
    start_dollar: usize,
    delim: &mut String,
) -> Option<(usize, bool)> {
    let b = raw.as_bytes();
    let mut j = start_dollar + 2;
    let mut seen_nul = false;
    while j < b.len() {
        if b[j] == b'\'' {
            return Some((j + 1, seen_nul));
        }
        if b[j] != b'\\' {
            let ch = raw[j..].chars().next()?;
            push_ansi_ch(ch, delim, &mut seen_nul);
            j += ch.len_utf8();
            continue;
        }
        j += 1;
        if j >= b.len() {
            return None;
        }
        match b[j] {
            b'\'' | b'"' | b'\\' | b'?' => {
                push_ansi_ch(b[j] as char, delim, &mut seen_nul);
                j += 1;
            }
            b'a' => { push_ansi_ch('\x07', delim, &mut seen_nul); j += 1; }
            b'b' => { push_ansi_ch('\x08', delim, &mut seen_nul); j += 1; }
            b'e' | b'E' => { push_ansi_ch('\x1b', delim, &mut seen_nul); j += 1; }
            b'f' => { push_ansi_ch('\x0c', delim, &mut seen_nul); j += 1; }
            b'n' => { push_ansi_ch('\n', delim, &mut seen_nul); j += 1; }
            b'r' => { push_ansi_ch('\r', delim, &mut seen_nul); j += 1; }
            b't' => { push_ansi_ch('\t', delim, &mut seen_nul); j += 1; }
            b'v' => { push_ansi_ch('\x0b', delim, &mut seen_nul); j += 1; }
            b'0'..=b'7' => {
                let mut v = 0u32;
                let mut cnt = 0;
                while cnt < 3 && j < b.len() && matches!(b[j], b'0'..=b'7') {
                    v = v * 8 + (b[j] - b'0') as u32;
                    j += 1;
                    cnt += 1;
                }
                push_ansi_ch(char::from((v & 0xff) as u8), delim, &mut seen_nul);
            }
            b'x' => {
                j += 1;
                let (v, cnt) = take_hex(b, j, 2);
                if cnt == 0 {
                    if !seen_nul { delim.push_str("\\x"); }
                } else {
                    push_ansi_ch(char::from((v & 0xff) as u8), delim, &mut seen_nul);
                    j += cnt;
                }
            }
            u @ (b'u' | b'U') => {
                j += 1;
                let max_d = if u == b'u' { 4 } else { 8 };
                let (v, cnt) = take_hex(b, j, max_d);
                if cnt == 0 {
                    if !seen_nul { delim.push('\\'); delim.push(u as char); }
                } else {
                    push_ansi_ch(char::from_u32(v).unwrap_or('\u{FFFD}'), delim, &mut seen_nul);
                    j += cnt;
                }
            }
            b'c' => {
                j += 1;
                let uch = raw[j..].chars().next()?;
                let ch = b[j];
                j += uch.len_utf8();
                if ch == b'\\' && j < b.len() && b[j] == b'\\' {
                    j += 1;
                }
                let ctrl = if ch == b'?' { 0x7f } else { ch.to_ascii_uppercase() & 0x1f };
                push_ansi_ch(char::from(ctrl), delim, &mut seen_nul);
                if ch >= 0x80 && !seen_nul {
                    for _ in 1..uch.len_utf8() {
                        delim.push('\u{FFFD}');
                    }
                }
            }
            _ => {
                let ch = raw[j..].chars().next()?;
                if !seen_nul { delim.push('\\'); }
                push_ansi_ch(ch, delim, &mut seen_nul);
                j += ch.len_utf8();
            }
        }
    }
    None
}

fn take_hex(b: &[u8], start: usize, max_digits: usize) -> (u32, usize) {
    let mut v = 0u32;
    let mut cnt = 0;
    while cnt < max_digits && start + cnt < b.len() {
        let d = match b[start + cnt] {
            c @ b'0'..=b'9' => (c - b'0') as u32,
            c @ b'a'..=b'f' => (c - b'a' + 10) as u32,
            c @ b'A'..=b'F' => (c - b'A' + 10) as u32,
            _ => break,
        };
        v = v * 16 + d;
        cnt += 1;
    }
    (v, cnt)
}

pub(crate) fn unescape_bash_bt_layers(s: &str, bt_depth: usize, bt_mask: u32) -> Cow<'_, str> {
    if bt_depth == 0 || !s.contains('\\') {
        return Cow::Borrowed(s);
    }
    let mut cur = s.to_string();
    for layer in 0..bt_depth.min(8) {
        let unesc_dq = ((bt_mask >> layer) & 1) == 1;
        let (b, mut next_s, mut p) = (cur.as_bytes(), String::with_capacity(cur.len()), 0usize);
        while p < b.len() {
            if b[p] == b'\\' && p + 1 < b.len() {
                let nch = cur[p + 1..].chars().next().unwrap();
                if !(matches!(nch, '`' | '\\' | '$') || (unesc_dq && nch == '"')) {
                    next_s.push('\\');
                }
                next_s.push(nch);
                p += 1 + nch.len_utf8();
            } else {
                let ch = cur[p..].chars().next().unwrap();
                next_s.push(ch);
                p += ch.len_utf8();
            }
        }
        cur = next_s;
    }
    Cow::Owned(cur)
}
