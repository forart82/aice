use crate::r5::bash_comment::char_len;

pub(super) fn unescape_backtick_layer(body: &str, unescape_dq: bool) -> String {
    let mut out = String::with_capacity(body.len());
    let mut chars = body.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            if let Some(nch) = chars.next() {
                if nch == '\n' {
                    continue;
                } else if nch == '`' || nch == '\\' || nch == '$' || (unescape_dq && nch == '"') {
                    out.push(nch);
                } else {
                    out.push('\\');
                    out.push(nch);
                }
            } else {
                out.push('\\');
            }
        } else {
            out.push(ch);
        }
    }
    out
}

pub(super) fn unescape_bt_body(
    s: &str,
    start: usize,
    end: usize,
    broken: &[(usize, usize)],
    unescape_dq: bool,
) -> String {
    if broken.is_empty() {
        return unescape_backtick_layer(&s[start..end], unescape_dq);
    }
    let mut raw = String::with_capacity(end.saturating_sub(start));
    let mut cur = start;
    for &(bs, be) in broken {
        if bs >= cur && be <= end {
            raw.push_str(&s[cur..bs]);
            raw.push(' ');
            cur = be;
        }
    }
    raw.push_str(&s[cur.min(end)..end]);
    unescape_backtick_layer(&raw, unescape_dq)
}

pub(super) fn scan_bt_in_exp(
    s: &str,
    start_bt: usize,
    unescape_dq: bool,
    in_sq_mode: Option<bool>,
) -> (String, usize, bool) {
    let b = s.as_bytes();
    let mut i = start_bt + 1;
    let mut depth = 1usize;
    let mut bt_opens = vec![start_bt];
    let mut broken: Vec<(usize, usize)> = Vec::new();
    while i < b.len() {
        if in_sq_mode.is_some() && b[i] == b'\'' {
            return (String::new(), i, true);
        }
        if b[i] == b'\\' {
            let mut bs = 0usize;
            while i + bs < b.len() && b[i + bs] == b'\\' { bs += 1; }
            let after = i + bs;
            if after < b.len() && b[after] == b'`' {
                let layer = if in_sq_mode == Some(true) {
                    (bs.div_ceil(2) + 1).trailing_zeros() as usize + 1
                } else {
                    (bs + 1).trailing_zeros() as usize + 1
                };
                if layer <= depth {
                    let popped = depth - (layer - 1);
                    depth = layer - 1;
                    let mut first_popped = None;
                    for _ in 0..popped {
                        if let Some(op) = bt_opens.pop() { first_popped = Some(op); }
                    }
                    if depth == 0 {
                        let body = if popped > 1 {
                            String::new()
                        } else {
                            unescape_bt_body(s, start_bt + 1, after, &broken, unescape_dq)
                        };
                        return (body, after + 1, false);
                    } else if popped > 1 && let Some(op) = first_popped {
                        broken.push((op, after + 1));
                    }
                } else if layer == depth + 1 {
                    depth += 1;
                    bt_opens.push(i);
                }
                i = after + 1;
            } else if in_sq_mode == Some(true) && after < b.len() && b[after] == b'\'' {
                if bs.is_multiple_of(2) { return (String::new(), after, true); }
                i = after + 1;
            } else if after < b.len() && bs % 2 == 1 && (in_sq_mode != Some(false) || b[after] != b'\'') {
                i = after + char_len(s, after);
            } else {
                i = after;
            }
        } else if b[i] == b'`' {
            let body = if depth > 1 {
                String::new()
            } else {
                unescape_bt_body(s, start_bt + 1, i, &broken, unescape_dq)
            };
            return (body, i + 1, false);
        } else {
            i += char_len(s, i);
        }
    }
    (String::new(), i, false)
}

pub(super) fn scan_cmdsub_in_exp(s: &str, start: usize) -> (String, usize) {
    let mut tr = crate::dep_callers_quote::QuoteDepthTracker::new_for(
        aice_lang_registry::LanguageId::Bash,
    );
    let mut heredoc = crate::dep_callers_heredoc::HeredocTracker::default();
    let mut arith = if s[start..].starts_with('(') { vec![0] } else { Vec::new() };
    tr.step('$', Some('('));
    tr.step('(', s[start..].chars().next());
    let mut line_start = start;
    while line_start < s.len() {
        let rel_nl = s[line_start..].find('\n');
        let line_end = rel_nl.map_or(s.len(), |p| line_start + p);
        let line = &s[line_start..line_end];
        if let Some(start_rel) = crate::r5::bash_heredoc::step_bash_line_bt_start(&mut heredoc, line) {
            let mut iter = line[start_rel..].char_indices().peekable();
            while let Some((irel, ch)) = iter.next() {
                let rel = start_rel + irel;
                let abs = line_start + rel;
                if crate::r5::bash_heredoc::try_step_bash_heredoc_or_arith(
                    &mut tr, &mut heredoc, &mut arith, line, rel, start_rel, &mut iter,
                ) {
                    continue;
                }
                let Some(_) = crate::r5::bash_heredoc::step_bash_tr_char(
                    &mut tr, s, abs, line_start, line_start + start_rel, ch, &mut iter,
                ) else {
                    continue;
                };
                heredoc.prune_bt_above(tr.bash_bt_depth());
                crate::r5::bash_heredoc::pop_bash_arith(ch, &tr, &mut arith);
                if tr.bash_paren_depth() == 0 && !tr.in_bash_bt() && tr.quote.is_none() {
                    return (s[start..abs].to_string(), abs + 1);
                }
            }
        }
        if rel_nl.is_none() {
            break;
        }
        tr.end_line();
        heredoc.flush_pending();
        line_start = line_end + 1;
    }
    (String::new(), s.len())
}

pub(super) fn is_ws_followed_by_dollar(rest: &[u8]) -> bool {
    let ws = rest.iter().take_while(|b| b.is_ascii_whitespace()).count();
    ws > 0 && rest.get(ws) == Some(&b'$')
}

pub(super) fn ansi_close_escapes_brace_in_exp(
    s_tail: &str,
    outer_dq_tail: &str,
    mut need: usize,
    at_outer_end: bool,
) -> bool {
    let scan_seg = |seg: &str, need: &mut usize| -> Option<bool> {
        let b = seg.as_bytes();
        let mut j = 0usize;
        while j < b.len() {
            if b[j] == b'\\' {
                let mut bs = 0usize;
                while j + bs < b.len() && b[j + bs] == b'\\' { bs += 1; }
                if j + bs == b.len() {
                    return Some(false);
                }
                if b[j + bs] == b'"' && bs.is_multiple_of(2) {
                    return Some(*need > 0);
                }
                if b[j + bs] == b'}' && bs.is_multiple_of(2) {
                    *need = need.saturating_sub(1);
                    if *need == 0 { return Some(false); }
                    j += bs + 1;
                    continue;
                }
                j += bs + usize::from(bs % 2 == 1 && b[j + bs] < 0x80);
            } else if b[j] == b'"' {
                return Some(*need > 0);
            } else if b[j] == b'}' {
                *need = need.saturating_sub(1);
                if *need == 0 { return Some(false); }
                j += 1;
            } else {
                j += 1;
            }
        }
        None
    };
    if !at_outer_end {
        if let Some(res) = scan_seg(s_tail, &mut need) {
            return res;
        }
        need = need.saturating_sub(1);
        if need == 0 { return false; }
    }
    scan_seg(outer_dq_tail, &mut need).unwrap_or(false)
}
