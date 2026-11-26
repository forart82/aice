use crate::dep_callers_bash_cont::try_parse_bash_heredoc_in_bt;
use crate::dep_callers_heredoc::{HeredocLine, HeredocTracker};
use crate::dep_callers_quote::{QuoteDepthTracker, StepKind};
use crate::r5::bash_subst::try_skip_bash_hash_comment;

pub(super) fn try_step_bash_heredoc_or_arith(
    tr: &mut QuoteDepthTracker,
    heredoc: &mut HeredocTracker,
    arith: &mut Vec<usize>,
    line: &str,
    rel: usize,
    rel_start: usize,
    iter: &mut std::iter::Peekable<std::str::CharIndices<'_>>,
) -> bool {
    if tr.quote == Some('"') {
        if line[rel..].starts_with("$((") && !tr.is_bash_escaped(true) {
            arith.push(tr.bash_paren_depth());
        }
        return false;
    }
    if tr.quote.is_some() {
        return false;
    }
    if line[rel..].starts_with("$((") {
        if !tr.is_bash_escaped(true) {
            arith.push(tr.bash_paren_depth());
        }
        return false;
    }
    if line[rel..].starts_with("((") && (tr.bash_arith_boundary() || (rel == 0 && tr.bash_last_is_dollar())) {
        if !tr.is_bash_escaped(false) {
            arith.push(tr.bash_paren_depth());
        }
        return false;
    }
    if arith.is_empty()
        && tr.bash_active_braces() == 0
        && line[rel..].starts_with("<<")
        && !tr.is_bash_escaped(false)
        && let Some((entry, end_rel)) = try_parse_bash_heredoc_in_bt(line, rel, tr.bash_bt_depth(), tr.bash_bt_unescape_mask())
    {
        heredoc.pending.push(entry);
        tr.bash_on_escape_char();
        while let Some(&(nirel, _)) = iter.peek() {
            if rel_start + nirel >= end_rel {
                break;
            }
            iter.next();
        }
        return true;
    }
    false
}

pub(super) fn step_bash_line_bt_start(heredoc: &mut HeredocTracker, line: &str) -> Option<usize> {
    let (hl, bt_cut) = heredoc.step_bash_line_bt(line);
    if matches!(hl, HeredocLine::NotActive) { Some(0) } else { bt_cut }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn scan_line_until(
    tr: &mut QuoteDepthTracker,
    heredoc: &mut HeredocTracker,
    arith: &mut Vec<usize>,
    src: &str,
    line_start: usize,
    line_end: usize,
    rel: usize,
    stop_bt: bool,
) -> Option<usize> {
    let line = &src[line_start..line_end];
    let start_rel = if rel == 0 { step_bash_line_bt_start(heredoc, line)? } else { rel };
    let mut iter = src[line_start + start_rel..line_end].char_indices().peekable();
    while let Some((irel, ch)) = iter.next() {
        let r = start_rel + irel;
        if try_step_bash_heredoc_or_arith(tr, heredoc, arith, line, r, start_rel, &mut iter) {
            continue;
        }
        let Some(end_idx) = step_bash_tr_char(tr, src, line_start + r, line_start, line_start + start_rel, ch, &mut iter) else {
            continue;
        };
        heredoc.prune_bt_above(tr.bash_bt_depth());
        pop_bash_arith(ch, tr, arith);
        if if stop_bt { !tr.in_bash_bt() && tr.quote.is_none() } else { tr.bash_param_depth() == 0 } {
            return Some(end_idx);
        }
    }
    None
}

pub(super) fn pop_bash_arith(ch: char, tr: &QuoteDepthTracker, arith: &mut Vec<usize>) {
    if matches!(ch, ')' | '`') {
        while arith.last().is_some_and(|&p| tr.bash_paren_depth() <= p) {
            arith.pop();
        }
    }
}

pub(super) fn step_bash_tr_char(
    tr: &mut QuoteDepthTracker,
    src: &str,
    abs: usize,
    line_start: usize,
    base_off: usize,
    ch: char,
    iter: &mut std::iter::Peekable<std::str::CharIndices<'_>>,
) -> Option<usize> {
    let next = iter.peek().map(|&(_, n)| n);
    if ch == '#' && try_skip_bash_hash_comment(tr, src, abs, line_start, base_off, iter) {
        return None;
    }
    let kind = tr.step(ch, next);
    let mut end_idx = abs + ch.len_utf8();
    if kind == StepKind::EnterTemplate
        && let Some((nirel, nch)) = iter.next()
    {
        end_idx = base_off + nirel + nch.len_utf8();
    }
    Some(end_idx)
}

pub(super) fn push_coalesced_hd_line(
    hd: &HeredocTracker,
    hl: HeredocLine,
    line: &str,
    has_nl: bool,
    out: &mut String,
) {
    if has_nl && hl == HeredocLine::UnquotedBody && hd.is_cont_bt0_unquoted() {
        let bs = line.as_bytes().iter().rev().take_while(|&&c| c == b'\\').count();
        let surv = crate::dep_callers_bash_cont::bash_eol_surviving_bs(bs, 0, false);
        out.push_str(&line[..line.len() - bs]);
        for _ in 0..surv { out.push('\\'); }
    } else {
        out.push_str(line);
        out.push('\n');
    }
}

pub(super) fn unescape_bash_word(s: &str) -> String {
    if !s.contains(['\\', '\'', '"']) {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut quote: Option<char> = None;
    let mut chars = s.chars();
    while let Some(ch) = chars.next() {
        match quote {
            Some('\'') => {
                if ch == '\'' {
                    quote = None;
                } else {
                    out.push(ch);
                }
            }
            Some('"') => {
                if ch == '"' {
                    quote = None;
                } else if ch == '\\' {
                    if let Some(nch) = chars.next() {
                        if !matches!(nch, '"' | '\\' | '$' | '`') {
                            out.push('\\');
                        }
                        out.push(nch);
                    } else {
                        out.push('\\');
                    }
                } else {
                    out.push(ch);
                }
            }
            _ => {
                if matches!(ch, '\'' | '"') {
                    quote = Some(ch);
                } else if ch == '\\' {
                    if let Some(nch) = chars.next()
                        && nch != '\n'
                    {
                        out.push(nch);
                    }
                } else {
                    out.push(ch);
                }
            }
        }
    }
    out
}
