use aice_lang_registry::LanguageId;

use crate::dep_callers_bash::{CompoundEvent, CompoundKind};
use crate::dep_callers_bash_abort::BashBufs;
use crate::dep_callers_bash_cmd::Cursor;
use crate::dep_callers_bash_delim::mask_tail_spaces;
use crate::dep_callers_quote::{QuoteDepthTracker, StepKind};

pub(crate) fn mask_range_spaces(s: &mut String, from: usize, to: usize) {
    let f = from.min(s.len());
    let t = to.min(s.len());
    if f < t && s.is_char_boundary(f) && s.is_char_boundary(t) {
        s.replace_range(f..t, &" ".repeat(t - f));
    }
}

pub(crate) fn mask_cursor_span(bufs: &mut BashBufs<'_>, start: Cursor, end: Cursor) {
    if start.0 == end.0 {
        if start.0 < bufs.imp_lines.len() {
            mask_range_spaces(&mut bufs.imp_lines[start.0], start.1, end.1);
            mask_range_spaces(&mut bufs.code_lines[start.0], start.2, end.2);
        } else {
            mask_range_spaces(bufs.imp, start.1, end.1);
            mask_range_spaces(bufs.code, start.2, end.2);
        }
        return;
    }
    if start.0 < bufs.imp_lines.len() {
        mask_tail_spaces(&mut bufs.imp_lines[start.0], start.1);
        mask_tail_spaces(&mut bufs.code_lines[start.0], start.2);
        let mid_end = end.0.min(bufs.imp_lines.len());
        for ln in (start.0 + 1)..mid_end {
            mask_tail_spaces(&mut bufs.imp_lines[ln], 0);
            mask_tail_spaces(&mut bufs.code_lines[ln], 0);
        }
        if end.0 < bufs.imp_lines.len() {
            mask_range_spaces(&mut bufs.imp_lines[end.0], 0, end.1);
            mask_range_spaces(&mut bufs.code_lines[end.0], 0, end.2);
        } else {
            mask_range_spaces(bufs.imp, 0, end.1);
            mask_range_spaces(bufs.code, 0, end.2);
        }
    }
}

pub(crate) fn mask_from_cursor_ch(
    bufs: &mut BashBufs<'_>,
    line: usize,
    imp_col: usize,
    code_col: usize,
    mask_imp: bool,
    fill: char,
) {
    let fill_tail = |s: &mut String, col: usize| {
        if fill == ' ' {
            mask_tail_spaces(s, col);
        } else if col < s.len() {
            let n = s.len() - col;
            s.truncate(col);
            for _ in 0..n {
                s.push(fill);
            }
        }
    };
    if line < bufs.imp_lines.len() {
        if mask_imp {
            fill_tail(&mut bufs.imp_lines[line], imp_col);
            for row in &mut bufs.imp_lines[line + 1..] {
                fill_tail(row, 0);
            }
            fill_tail(bufs.imp, 0);
        }
        fill_tail(&mut bufs.code_lines[line], code_col);
        for row in &mut bufs.code_lines[line + 1..] {
            fill_tail(row, 0);
        }
        fill_tail(bufs.code, 0);
    } else {
        if mask_imp {
            fill_tail(bufs.imp, imp_col);
        }
        fill_tail(bufs.code, code_col);
    }
}

pub(crate) fn find_inline_if_alt_tail_span(line: &str, semi_pos: usize) -> Option<(usize, usize, bool)> {
    let b = line.as_bytes();
    let mut p = semi_pos + 1;
    while p < b.len() && matches!(b[p], b' ' | b'\t') { p += 1; }
    if !line[p..].starts_with("then") { return None; }
    let body_start = p + 4;
    if b.get(body_start).is_some_and(|&c| c.is_ascii_alphanumeric() || c == b'_') { return None; }
    let mut tr = QuoteDepthTracker::new_for(LanguageId::Bash);
    for ch in "if x; then ".chars() { tr.step(ch, None); }
    tr.bash_take_event();
    let mut alt_start: Option<usize> = None;
    let mut iter = line[body_start..].char_indices().peekable();
    while let Some((rel, ch)) = iter.next() {
        let abs = body_start + rel;
        if tr.at_top_level() && ch == '#' && tr.bash_allows_hash(b, abs, body_start) { break; }
        let next = iter.peek().map(|&(_, n)| n);
        if tr.step(ch, next) == StepKind::EnterTemplate { iter.next(); }
        match tr.bash_take_event() {
            CompoundEvent::IfElif(1) | CompoundEvent::IfElse(1) => {
                if alt_start.is_none() { alt_start = Some(abs.saturating_sub(4)); }
            }
            CompoundEvent::IfFi(1, _) => {
                let end = abs.saturating_sub(2);
                return Some(if let Some(as_) = alt_start { (as_, end, true) } else { (end, end, true) });
            }
            _ => {}
        }
    }
    tr.end_line();
    match tr.bash_take_event() {
        CompoundEvent::IfElif(1) | CompoundEvent::IfElse(1) => {
            if alt_start.is_none() { alt_start = Some(line.len().saturating_sub(4)); }
        }
        CompoundEvent::IfFi(1, _) => {
            let end = line.len().saturating_sub(2);
            return Some(if let Some(as_) = alt_start { (as_, end, true) } else { (end, end, true) });
        }
        _ => {}
    }
    Some(if let Some(as_) = alt_start { (as_, line.len(), false) } else { (line.len(), line.len(), false) })
}

pub(crate) fn step_inline_hd_grp_close(
    line: &str,
    stop_col: usize,
    outer_grp_bangs: &[(usize, usize, usize, u8, bool)],
    init_bang: bool,
) -> Option<(usize, u8, bool, usize)> {
    let b = line.as_bytes();
    let (mut p, mut idx, mut bang) = (stop_col, 0usize, init_bang);
    if b.get(p) == Some(&b';') {
        p += 1;
        while p < b.len() && matches!(b[p], b' ' | b'\t') { p += 1; }
        if !matches!(b.get(p), Some(&b')' | &b'}' | &b'`')) { return None; }
    }
    let mut last_kind = 0u8;
    while idx < outer_grp_bangs.len() {
        while p < b.len() && matches!(b[p], b' ' | b'\t') { p += 1; }
        if !matches!(b.get(p), Some(&b')' | &b'}' | &b'`')) { break; }
        bang ^= outer_grp_bangs[idx].4;
        last_kind = outer_grp_bangs[idx].3;
        p += 1;
        idx += 1;
        if matches!(last_kind, 2 | 4) { break; }
        let mut q = p;
        while q < b.len() && matches!(b[q], b' ' | b'\t') { q += 1; }
        if idx < outer_grp_bangs.len() {
            if b.get(q) == Some(&b';') {
                q += 1;
                while q < b.len() && matches!(b[q], b' ' | b'\t') { q += 1; }
                if matches!(b.get(q), Some(&b')' | &b'}' | &b'`')) { p = q; continue; }
            } else if matches!(b.get(q), Some(&b')' | &b'}' | &b'`')) {
                p = q;
                continue;
            }
        }
        break;
    }
    (idx > 0).then_some((p, last_kind, bang, idx))
}

pub(crate) fn find_inline_cond_tail_span(line: &str, semi_pos: usize, kind: CompoundKind) -> Option<(usize, usize, bool)> {
    let kw = match kind {
        CompoundKind::If => "then",
        CompoundKind::While | CompoundKind::Until => "do",
        CompoundKind::Loop => return None,
    };
    let mut p = semi_pos + 1;
    let b = line.as_bytes();
    while p < b.len() && matches!(b[p], b' ' | b'\t') { p += 1; }
    if !line[p..].starts_with(kw) { return None; }
    let body_start = p + kw.len();
    if b.get(body_start).is_some_and(|&c| c.is_ascii_alphanumeric() || c == b'_') { return None; }
    let mut tr = QuoteDepthTracker::new_for(LanguageId::Bash);
    let seed = match kind {
        CompoundKind::If => "if x; then ",
        CompoundKind::While => "while x; do ",
        CompoundKind::Until => "until x; do ",
        CompoundKind::Loop => return None,
    };
    for ch in seed.chars() { tr.step(ch, None); }
    tr.bash_take_event();
    let mut iter = line[body_start..].char_indices().peekable();
    while let Some((rel, ch)) = iter.next() {
        let abs = body_start + rel;
        if tr.at_top_level() && ch == '#' && tr.bash_allows_hash(b, abs, body_start) { break; }
        let next = iter.peek().map(|&(_, n)| n);
        if tr.step(ch, next) == StepKind::EnterTemplate { iter.next(); }
        let kw_len = match (kind, tr.bash_take_event()) {
            (CompoundKind::If, CompoundEvent::IfElif(1) | CompoundEvent::IfElse(1)) => Some(4),
            (CompoundKind::If, CompoundEvent::IfFi(1, _)) => Some(2),
            (CompoundKind::While | CompoundKind::Until, CompoundEvent::WhileDone(1)) => Some(4),
            _ => None,
        };
        if let Some(kl) = kw_len { return Some((body_start, abs.saturating_sub(kl), true)); }
    }
    tr.end_line();
    let kw_len = match (kind, tr.bash_take_event()) {
        (CompoundKind::If, CompoundEvent::IfElif(1) | CompoundEvent::IfElse(1)) => Some(4),
        (CompoundKind::If, CompoundEvent::IfFi(1, _)) => Some(2),
        (CompoundKind::While | CompoundKind::Until, CompoundEvent::WhileDone(1)) => Some(4),
        _ => None,
    };
    if let Some(kl) = kw_len { return Some((body_start, line.len().saturating_sub(kl), true)); }
    Some((body_start, line.len(), false))
}

pub(crate) fn cmd_has_static_word_ahead(raw: &str, mut i: usize) -> bool {
    let b = raw.as_bytes();
    let mut tr = QuoteDepthTracker::new_for(LanguageId::Bash);
    let mut seen_word_tok = false;
    let mut is_assign = false;
    let mut redir_state = 0u8;
    let mut prev: Option<char> = None;
    let mut iter = raw[i..].char_indices().peekable();
    while let Some((rel, ch)) = iter.next() {
        let abs = i + rel;
        let top = tr.at_top_level();
        if top && ch == '#' && tr.bash_allows_hash(b, abs, i) { break; }
        let next = iter.peek().map(|&(_, n)| n);
        if top {
            if matches!(ch, ';' | '&' | '|' | ')' | '}' | '\n') && !(ch == '&' && next == Some('>')) && !(ch == '|' && prev == Some('>')) {
                if seen_word_tok && !is_assign && redir_state != 2 { return true; }
                break;
            }
            if ch.is_ascii_whitespace() {
                if redir_state == 2 { redir_state = 0; }
                else if seen_word_tok && !is_assign { return true; }
                (seen_word_tok, is_assign) = (false, false);
                prev = Some(ch);
                continue;
            }
            if matches!(ch, '>' | '<') && next != Some('(') && redir_state == 0 {
                if seen_word_tok && !is_assign && !raw[i..abs].trim_start().bytes().all(|c| c.is_ascii_digit()) { return true; }
                (seen_word_tok, is_assign, redir_state) = (false, false, 1);
                i = abs + 1;
            } else if redir_state == 1 {
                if !matches!(ch, '>' | '<' | '&' | '-' | '|') { redir_state = 2; }
            } else if redir_state == 0 {
                if ch == '=' && !seen_word_tok { seen_word_tok = true; }
                else if !seen_word_tok {
                    if !(ch == '$' && matches!(next, Some('('))) && ch != '`' { seen_word_tok = true; }
                } else if ch == '=' && !is_assign && prev.is_some_and(|p| p.is_ascii_alphanumeric() || matches!(p, '_' | '+' | ']')) {
                    is_assign = true;
                }
            }
        }
        if tr.step(ch, next) == StepKind::EnterTemplate { if let Some((_, nc)) = iter.next() { prev = Some(nc); } }
        else { prev = Some(ch); }
    }
    seen_word_tok && !is_assign && redir_state != 2
}
