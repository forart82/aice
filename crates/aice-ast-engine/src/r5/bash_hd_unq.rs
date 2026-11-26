use aice_lang_registry::LanguageId;

use crate::dep_callers_heredoc::HeredocTracker;
use crate::dep_callers_quote::QuoteDepthTracker;
use crate::r5::bash_desync::is_heredoc_redirect_quoted;
use crate::r5::bash_heredoc::{
    pop_bash_arith, step_bash_line_bt_start, step_bash_tr_char, try_step_bash_heredoc_or_arith,
};
use crate::r5::bash_subst::{
    ExpAbort, char_len, extract_expansion_substitutions_checked, scan_cmdsub_in_exp,
    unescape_backtick_layer,
};

pub(super) fn heredoc_redirect_body_span(node: tree_sitter::Node<'_>, src: &str) -> Option<(usize, usize, usize)> {
    let (mut hdr_end, mut body_span, mut end_start) = (node.start_byte(), None, None);
    for i in 0..node.named_child_count() {
        if let Some(c) = node.named_child(i as u32) {
            match c.kind() {
                "heredoc_start" => hdr_end = c.end_byte(),
                "heredoc_body" => body_span = Some((c.start_byte(), c.end_byte())),
                "heredoc_end" => end_start = Some(c.start_byte()),
                _ => {}
            }
        }
    }
    let line_end = src[hdr_end..].find('\n').map_or(src.len(), |p| hdr_end + p);
    let (bs, be) = body_span?;
    let body_start = if let Some(es) = end_start && line_end < es && bs > line_end + 1 {
        line_end + 1
    } else {
        bs
    };
    let body_end = if let Some(es) = end_start && body_start <= es { es.max(be) } else { be };
    Some((hdr_end, body_start, body_end))
}

pub(super) fn heredoc_redirect_aborts(node: tree_sitter::Node<'_>, src: &str) -> bool {
    if is_heredoc_redirect_quoted(node, src) {
        return false;
    }
    if let Some((_, bs, be)) = heredoc_redirect_body_span(node, src)
        && bs <= be && be <= src.len()
        && extract_unquoted_heredoc_substitutions_checked(&src[bs..be]).1
    {
        return true;
    }
    false
}

pub(super) fn new_dq_param_tracker() -> QuoteDepthTracker {
    let mut tr = QuoteDepthTracker::new_for(LanguageId::Bash);
    tr.bash_dq.set_heredoc_param(true);
    tr.step('"', Some('$'));
    tr.step('$', Some('{'));
    tr
}

fn scan_heredoc_end(body: &str, start: usize, stop_bt: bool) -> (usize, bool) {
    let mut tr = if stop_bt { QuoteDepthTracker::new_for(LanguageId::Bash) } else { new_dq_param_tracker() };
    if stop_bt { tr.step('`', body[start..].chars().next()); }
    let (mut heredoc, mut arith, mut line_start) = (HeredocTracker::default(), Vec::new(), start);
    while line_start < body.len() {
        let rel_nl = body[line_start..].find('\n');
        let line_end = rel_nl.map_or(body.len(), |p| line_start + p);
        let line = &body[line_start..line_end];
        if let Some(start_rel) = step_bash_line_bt_start(&mut heredoc, line) {
            let mut iter = line[start_rel..].char_indices().peekable();
            while let Some((irel, ch)) = iter.next() {
                let rel = start_rel + irel;
                if try_step_bash_heredoc_or_arith(&mut tr, &mut heredoc, &mut arith, line, rel, start_rel, &mut iter) { continue; }
                let Some(end_idx) = step_bash_tr_char(&mut tr, body, line_start + rel, line_start, line_start + start_rel, ch, &mut iter) else { continue; };
                heredoc.prune_bt_above(tr.bash_bt_depth());
                pop_bash_arith(ch, &tr, &mut arith);
                let done = if stop_bt { !tr.in_bash_bt() && tr.quote.is_none() } else { tr.bash_param_depth() == 0 };
                if done { return (end_idx, true); }
            }
        }
        if rel_nl.is_none() { break; }
        tr.end_line();
        heredoc.flush_pending();
        line_start = line_end + 1;
    }
    (body.len(), false)
}

pub(super) fn extract_unquoted_heredoc_substitutions_checked(body: &str) -> (Vec<String>, bool) {
    let (mut out, b, mut i) = (Vec::new(), body.as_bytes(), 0usize);
    while i < b.len() {
        if b[i] == b'\\' && i + 1 < b.len() {
            i += if matches!(b[i + 1], b'$' | b'`' | b'\\' | b'\n') { 2 } else { 1 };
        } else if b[i] == b'$' {
            let mut k = i + 1;
            while body[k..].starts_with("\\\n") { k += 2; }
            if body.as_bytes().get(k) == Some(&b'$') {
                i = k + 1;
            } else if body[k..].starts_with('{') {
                let (end, closed) = scan_heredoc_end(body, k + 1, false);
                if !closed {
                    return (out, true);
                }
                let exp = if k == i + 1 { body[i..end].to_string() } else { format!("${}", &body[k..end]) };
                let (esubs, abort) = extract_expansion_substitutions_checked(&exp, true, true);
                if abort != ExpAbort::None {
                    return (out, true);
                }
                out.extend(esubs);
                i = end;
            } else if body[k..].starts_with("((") {
                let (inner, next_i) = scan_cmdsub_in_exp(body, k + 1);
                if !inner.trim().is_empty() { out.push(format!("({inner})")); }
                i = next_i;
            } else if body[k..].starts_with('(') {
                let (inner, next_i) = scan_cmdsub_in_exp(body, k + 1);
                if !inner.trim().is_empty() { out.push(inner); }
                i = next_i;
            } else { i += 1; }
        } else if b[i] == b'`' {
            let (end, _) = scan_heredoc_end(body, i + 1, true);
            let bt_end = if end > i + 1 && body.as_bytes().get(end - 1) == Some(&b'`') { end - 1 } else { end };
            let inner = unescape_backtick_layer(&body[i + 1..bt_end], false);
            if !inner.trim().is_empty() { out.push(inner); }
            i = end;
        } else {
            i += char_len(body, i);
        }
    }
    (out, false)
}

pub(super) fn hd_header_tail_abort_span_bang(
    src: &str,
    hdr_end: usize,
    line_end: usize,
    init_seen_op: bool,
    in_bang: bool,
) -> (usize, bool) {
    let (se, ta, _) = hd_header_tail_abort_info_bang(src, hdr_end, line_end, init_seen_op, in_bang);
    (se, ta)
}

pub(super) fn hd_header_tail_abort_info_bang(
    src: &str,
    hdr_end: usize,
    line_end: usize,
    init_seen_op: bool,
    in_bang: bool,
) -> (usize, bool, Option<u8>) {
    if hdr_end >= line_end || line_end > src.len() {
        return (hdr_end, false, None);
    }
    let mut tr = QuoteDepthTracker::new_for(LanguageId::Bash);
    let (mut seen_op, mut trailing_op) = (init_seen_op, init_seen_op);
    let mut prev_ch: Option<char> = None;
    let mut iter = src[hdr_end..line_end].char_indices().peekable();
    while let Some((rel, ch)) = iter.next() {
        let abs = hdr_end + rel;
        let top = tr.at_top_level();
        if top && ch == '#' && tr.bash_allows_hash(src.as_bytes(), abs, hdr_end) {
            return (abs, trailing_op, None);
        }
        let next = iter.peek().map(|&(_, n)| n);
        if top {
            let is_and = ch == '&' && next == Some('&');
            let is_or = ch == '|' && next == Some('|');
            let is_primary = if in_bang { is_or } else { is_and };
            let is_other_list = if in_bang { is_and } else { is_or };
            if is_primary {
                (seen_op, trailing_op) = (true, true);
                tr.step(ch, next);
                if let Some((_, nch)) = iter.next() { tr.step(nch, iter.peek().map(|&(_, c)| c)); prev_ch = Some(nch); }
                continue;
            }
            if is_other_list
                || ch == ';'
                || (ch == '&' && next != Some('>'))
                || (ch == '|' && !seen_op && prev_ch != Some('>'))
                || matches!(ch, ')' | '}')
            {
                let stop = if matches!(ch, ')' | '}') { Some(ch as u8) } else { Some(b';') };
                return (abs, false, stop);
            }
            if !ch.is_ascii_whitespace() && !matches!(ch, '{' | '(' | '|') {
                trailing_op = false;
            }
        }
        let kind = tr.step(ch, next);
        if kind == crate::dep_callers_quote::StepKind::EnterTemplate {
            if let Some((_, nch)) = iter.next() { prev_ch = Some(nch); }
        } else {
            prev_ch = Some(ch);
        }
    }
    (line_end, trailing_op, None)
}
