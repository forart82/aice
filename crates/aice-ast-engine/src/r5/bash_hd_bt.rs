use aice_lang_registry::LanguageId;

use crate::dep_callers_bash::CompoundKind;
use crate::dep_callers_bash_mask::ends_with_bash_assign_eq;
use crate::dep_callers_quote::{QuoteDepthTracker, StepKind};
use crate::r5::bash_hd_unq::extract_unquoted_heredoc_substitutions_checked;
use crate::r5::bash_subst::unescape_backtick_layer;

pub(super) struct HdMeta {
    pub(super) hdr_start: usize,
    pub(super) hdr_end: usize,
    pub(super) hdr_line_end: usize,
    pub(super) close_line_end: usize,
    pub(super) quoted: bool,
    pub(super) neutralize: bool,
    pub(super) bt_depth: usize,
    pub(super) bt_mask: u32,
    pub(super) pd: usize,
    pub(super) hdr_tail_ctrl: bool,
    pub(super) grp_ctx: Option<(usize, usize, usize, u8)>,
    pub(super) outer_grp_bangs: Vec<(usize, usize, usize, u8, bool)>,
    pub(super) outer_cond: Option<(CompoundKind, usize, usize, usize)>,
    pub(super) cond_ctx: Option<(CompoundKind, usize)>,
    pub(super) case_ctx: Option<(usize, bool)>,
    pub(super) in_bang: bool,
    pub(super) in_sub_sole: bool,
    pub(super) body: String,
    pub(super) body_lines: Vec<(usize, usize)>,
}

pub(super) fn strip_hd_op(s: &str) -> &str {
    let rest = s.strip_prefix("<<").unwrap_or(s);
    let rest = rest.strip_prefix('-').unwrap_or(rest);
    rest.trim_start_matches([' ', '\t'])
}

pub(super) fn is_simple_heredoc_header(raw_delim: &str) -> bool {
    if raw_delim.is_empty() || !raw_delim.is_ascii() {
        return false;
    }
    if let Some(inner) = raw_delim.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')) {
        return !inner.is_empty() && !inner.contains(['\'', '\\', '\n']);
    }
    if let Some(inner) = raw_delim.strip_prefix('"').and_then(|s| s.strip_suffix('"')) {
        return !inner.is_empty() && !inner.contains(['"', '\\', '\n', '$', '`']);
    }
    if let Some(rest) = raw_delim.strip_prefix('\\') {
        return !rest.is_empty() && !rest.contains(['\'', '"', '\\', '$', '#', '\n', '`']);
    }
    !raw_delim.contains(['\'', '"', '\\', '$', '#', '\n', '`'])
}

pub(super) fn blank_preserving_nl(slice: &str) -> String {
    slice.bytes().map(|b| if b == b'\n' { '\n' } else { ' ' }).collect()
}

pub(super) fn has_hdr_tail_ctrl(tail: &str) -> bool {
    let mut quote: Option<char> = None;
    let mut esc = false;
    let mut prev = '\0';
    for ch in tail.chars() {
        if esc {
            esc = false;
            prev = ch;
            continue;
        }
        match quote {
            Some('\'') => {
                if ch == '\'' { quote = None; }
            }
            Some('"') => {
                if ch == '\\' { esc = true; } else if ch == '"' { quote = None; }
            }
            _ => {
                if ch == '\\' { esc = true; }
                else if matches!(ch, '\'' | '"') { quote = Some(ch); }
                else if ch == '#' && (prev == '\0' || prev.is_ascii_whitespace() || matches!(prev, ';' | '&' | '|' | '(')) {
                    break;
                } else if matches!(ch, ')' | '}' | ';') || (ch == '|' && prev != '>') || (ch == '&' && prev == '&') {
                    return true;
                }
            }
        }
        prev = ch;
    }
    false
}

fn coalesce_unquoted_hd_body(body: &str) -> String {
    let mut out = String::with_capacity(body.len());
    let mut rest = body;
    while let Some(nl) = rest.find('\n') {
        let line = &rest[..nl];
        let bs = line.as_bytes().iter().rev().take_while(|&&c| c == b'\\').count();
        if bs % 2 == 1 {
            out.push_str(&line[..line.len() - 1]);
        } else {
            out.push_str(line);
            out.push('\n');
        }
        rest = &rest[nl + 1..];
    }
    out.push_str(rest);
    out
}

pub(super) fn extract_hd_body_subs_checked(body: &str, bt_depth: usize, bt_mask: u32) -> (Vec<String>, bool) {
    if bt_depth == 0 {
        return extract_unquoted_heredoc_substitutions_checked(body);
    }
    let mut cur = body.to_string();
    for layer in 0..bt_depth.min(8) {
        cur = unescape_backtick_layer(&cur, ((bt_mask >> layer) & 1) == 1);
    }
    if cur.contains("\\\n") {
        cur = coalesce_unquoted_hd_body(&cur);
    }
    extract_unquoted_heredoc_substitutions_checked(&cur)
}

pub(super) fn should_neutralize_meta(m: &HdMeta, force_neutralize: bool) -> bool {
    m.neutralize || (force_neutralize && (m.body.contains("<<") || m.body.contains("$'") || m.body.contains("${") || m.hdr_tail_ctrl))
}

pub(crate) fn find_dq_close(src: &str, start: usize) -> Option<usize> {
    let b = src.as_bytes();
    let mut i = start;
    while i < b.len() {
        if b[i] == b'\\' && i + 1 < b.len() {
            i += 1 + src[i + 1..].chars().next().map_or(1, char::len_utf8);
            continue;
        }
        if b[i] == b'"' { return Some(i); }
        if b[i] == b'`' || (b[i] == b'$' && matches!(b.get(i + 1), Some(b'(' | b'{'))) {
            return None;
        }
        i += src[i..].chars().next().map_or(1, char::len_utf8);
    }
    None
}

pub(crate) fn and_list_tail_span_bang(
    src: &str,
    mut start: usize,
    grp_kind: u8,
    in_bang: bool,
) -> Option<(usize, usize)> {
    if matches!(grp_kind, 2 | 4) {
        start = find_dq_close(src, start)? + 1;
    }
    if start >= src.len() {
        return None;
    }
    let mut tr = QuoteDepthTracker::new_for(LanguageId::Bash);
    let (mut first_and, mut trailing_and, mut tok_s) = (None::<usize>, false, None::<usize>);
    let mut prev_ch: Option<char> = None;
    let mut iter = src[start..].char_indices().peekable();
    while let Some((rel, ch)) = iter.next() {
        let abs = start + rel;
        let top = tr.at_top_level();
        if top && ch == '#' && tr.bash_allows_hash(src.as_bytes(), abs, start) {
            return first_and.map(|fa| (fa, abs));
        }
        let next = iter.peek().map(|&(_, n)| n);
        if top {
            let is_and = ch == '&' && next == Some('&');
            let is_or = ch == '|' && next == Some('|');
            let is_primary = if in_bang { is_or } else { is_and };
            let is_other = if in_bang { is_and } else { is_or };
            if is_primary {
                if let Some(ts) = tok_s.take() && (grp_kind == 0 || !ends_with_bash_assign_eq(&src[ts..abs])) {
                    return None;
                }
                if first_and.is_none() { first_and = Some(abs); }
                trailing_and = true;
                tr.step(ch, next);
                if let Some((_, nch)) = iter.next() { tr.step(nch, iter.peek().map(|&(_, c)| c)); prev_ch = Some(nch); }
                continue;
            }
            if is_other || ch == ';' || (ch == '&' && next != Some('>'))
                || (ch == '|' && prev_ch != Some('>')) || matches!(ch, ')' | '}') || (ch == '\n' && !trailing_and)
            {
                return first_and.map(|fa| (fa, abs));
            }
            if first_and.is_none() {
                if ch.is_ascii_whitespace() {
                    if let Some(ts) = tok_s.take() && (grp_kind == 0 || !ends_with_bash_assign_eq(&src[ts..abs])) {
                        return None;
                    }
                } else if grp_kind == 0 || (ch == '$' && matches!(next, Some('(' | '{'))) || ch == '`' {
                    return None;
                } else if tok_s.is_none() {
                    tok_s = Some(abs);
                }
            } else if !ch.is_ascii_whitespace() && !matches!(ch, '{' | '(' | '|') {
                trailing_and = false;
            }
        }
        if ch == '\n' { tr.end_line(); prev_ch = Some('\n'); }
        else if tr.step(ch, next) == StepKind::EnterTemplate {
            if let Some((_, nch)) = iter.next() { prev_ch = Some(nch); }
        } else {
            prev_ch = Some(ch);
        }
    }
    first_and.map(|fa| (fa, src.len()))
}

pub(super) type TailRedirInfo = (usize, bool, Option<u8>, Vec<(usize, usize)>, Option<usize>);

pub(super) fn hd_tail_redir_and_spans(
    src: &str,
    hdr_end: usize,
    line_end: usize,
    init_seen_op: bool,
    in_bang: bool,
) -> TailRedirInfo {
    if hdr_end >= line_end || line_end > src.len() {
        return (hdr_end, false, None, Vec::new(), None);
    }
    let mut tr = QuoteDepthTracker::new_for(LanguageId::Bash);
    let (mut seen_op, mut trailing_op) = (init_seen_op, init_seen_op);
    let (mut first_op, mut stop_col) = (None::<usize>, line_end);
    let (mut redir_spans, mut cur_redir, mut redir_state) = (Vec::new(), None::<usize>, 0u8);
    let mut prev_ch: Option<char> = None;
    let mut iter = src[hdr_end..line_end].char_indices().peekable();
    let mut stop_ch = None;
    while let Some((rel, ch)) = iter.next() {
        let abs = hdr_end + rel;
        let top = tr.at_top_level();
        if top && ch == '#' && tr.bash_allows_hash(src.as_bytes(), abs, hdr_end) {
            if let Some(rs) = cur_redir.take() && redir_state == 2 { redir_spans.push((rs, abs)); }
            stop_col = abs;
            break;
        }
        let next = iter.peek().map(|&(_, n)| n);
        if top {
            let is_and = ch == '&' && next == Some('&');
            let is_or = ch == '|' && next == Some('|');
            let is_primary = if in_bang { is_or } else { is_and };
            let is_other = if in_bang { is_and } else { is_or };
            if is_primary {
                if let Some(rs) = cur_redir.take() && redir_state == 2 { redir_spans.push((rs, abs)); }
                if first_op.is_none() { first_op = Some(abs); }
                (seen_op, trailing_op) = (true, true);
                tr.step(ch, next);
                if let Some((_, nch)) = iter.next() { tr.step(nch, iter.peek().map(|&(_, c)| c)); prev_ch = Some(nch); }
                continue;
            }
            if is_other || ch == ';' || (ch == '&' && next != Some('>'))
                || (ch == '|' && !seen_op && prev_ch != Some('>')) || matches!(ch, ')' | '}')
            {
                if let Some(rs) = cur_redir.take() && redir_state == 2 { redir_spans.push((rs, abs)); }
                stop_col = abs;
                trailing_op = false;
                stop_ch = Some(if matches!(ch, ')' | '}') { ch as u8 } else { b';' });
                break;
            }
            if first_op.is_none() {
                if ch == '<' && next == Some('<') && !src[abs..line_end].starts_with("<<<") {
                    if let Some(rs) = cur_redir.take() && redir_state == 2 { redir_spans.push((rs, abs)); }
                } else if (matches!(ch, '>' | '<') && next != Some('(')) || (ch == '&' && next == Some('>')) {
                    if cur_redir.is_none() { (cur_redir, redir_state) = (Some(abs), 0); }
                } else if ch.is_ascii_whitespace() {
                    if let Some(rs) = cur_redir {
                        if redir_state == 2 { redir_spans.push((rs, abs)); cur_redir = None; }
                        else if redir_state == 0 { redir_state = 1; }
                    }
                } else if cur_redir.is_some() && redir_state != 2 {
                    redir_state = 2;
                }
            } else if !ch.is_ascii_whitespace() && !matches!(ch, '{' | '(' | '|') {
                trailing_op = false;
            }
        }
        let kind = tr.step(ch, next);
        if kind == StepKind::EnterTemplate {
            if let Some((_, nch)) = iter.next() { prev_ch = Some(nch); }
        } else {
            prev_ch = Some(ch);
        }
    }
    if let Some(rs) = cur_redir && redir_state == 2 { redir_spans.push((rs, stop_col)); }
    (stop_col, trailing_op, stop_ch, redir_spans, first_op)
}
