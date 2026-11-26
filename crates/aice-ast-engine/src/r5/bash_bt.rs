use aice_lang_registry::LanguageId;

use crate::dep_callers_bash_mask::{ends_with_bash_assign_eq, is_glued_after_byte, is_glued_bt_prefix};
use crate::dep_callers_heredoc::HeredocTracker;
use crate::dep_callers_quote::QuoteDepthTracker;
use crate::r5::bash_heredoc::{
    pop_bash_arith, step_bash_line_bt_start, step_bash_tr_char, try_step_bash_heredoc_or_arith,
};
use crate::r5::bash_subst::{unescape_backtick_layer, unescape_bt_body};

pub(super) type ErrBackticks = (Vec<String>, Vec<(usize, usize)>, Option<usize>, bool);

pub(super) fn extract_error_backticks(src: &str) -> ErrBackticks {
    let (mut tr, mut heredoc, mut arith) = (
        QuoteDepthTracker::new_for(LanguageId::Bash),
        HeredocTracker::default(),
        Vec::new(),
    );
    let (mut out, mut spans, mut bt_start, mut bt_in_dq, mut line_start) =
        (Vec::new(), Vec::new(), None, false, 0usize);
    let (mut bt_opens, mut broken): (Vec<usize>, Vec<(usize, usize)>) = (Vec::new(), Vec::new());
    let mut unclosed_sq: Option<usize> = None;
    while line_start < src.len() {
        let rel_nl = src[line_start..].find('\n');
        let line_end = rel_nl.map_or(src.len(), |p| line_start + p);
        let line = &src[line_start..line_end];
        if let Some(start_rel) = step_bash_line_bt_start(&mut heredoc, line) {
            let mut iter = line[start_rel..].char_indices().peekable();
            while let Some((irel, ch)) = iter.next() {
                let rel = start_rel + irel;
                if try_step_bash_heredoc_or_arith(
                    &mut tr, &mut heredoc, &mut arith, line, rel, start_rel, &mut iter,
                ) {
                    continue;
                }
                let (prev_d, prev_dq) = (tr.bash_bt_depth(), tr.quote == Some('"'));
                let Some(end_idx) = step_bash_tr_char(
                    &mut tr, src, line_start + rel, line_start, line_start + start_rel, ch, &mut iter,
                ) else {
                    continue;
                };
                heredoc.prune_bt_above(tr.bash_bt_depth());
                pop_bash_arith(ch, &tr, &mut arith);
                let cur_d = tr.bash_bt_depth();
                let sq_open = tr.quote == Some('\'') || tr.bash_dq.has_sq();
                if cur_d == 0 {
                    if sq_open && unclosed_sq.is_none() {
                        unclosed_sq = Some(line_start + rel);
                    } else if !sq_open {
                        unclosed_sq = None;
                    }
                }
                if cur_d > prev_d {
                    bt_opens.push(line_start + rel);
                    if prev_d == 0 {
                        let _ = tr.bash_dq.take_dropped_q();
                        bt_start = Some((line_start + rel, end_idx));
                        bt_in_dq = prev_dq;
                    }
                } else if cur_d < prev_d {
                    let popped = prev_d - cur_d;
                    let mut first_popped = None;
                    for _ in 0..popped {
                        if let Some(op) = bt_opens.pop() { first_popped = Some(op); }
                    }
                    if cur_d == 0 {
                        let dropped_q = tr.bash_dq.take_dropped_q();
                        if let Some((open_pos, s)) = bt_start.take() && !tr.bash_dq.in_bad_sub() {
                            spans.push((open_pos, end_idx));
                            if popped == 1 && !dropped_q {
                                let inner = unescape_bt_body(src, s, line_start + rel, &broken, bt_in_dq);
                                if !inner.trim().is_empty() {
                                    out.push((open_pos, inner));
                                }
                            }
                        }
                        broken.clear();
                    } else if popped > 1 && let Some(op) = first_popped {
                        broken.push((op, end_idx));
                    }
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
    if let Some((open_pos, _)) = bt_start {
        spans.push((open_pos, src.len()));
    }
    let final_sq = if tr.quote == Some('\'') || tr.bash_dq.has_sq() { unclosed_sq } else { None };
    let has_unclosed_q = tr.quote.is_some() || tr.bash_dq.has_sq() || tr.in_bash_bt();
    let filtered = out
        .into_iter()
        .filter(|(open_pos, _)| final_sq.is_none_or(|sq| *open_pos < sq))
        .map(|(_, s)| s)
        .collect();
    (filtered, spans, final_sq, has_unclosed_q)
}

pub(super) fn replace_error_bt_spans(src: &str, spans: &[(usize, usize)]) -> String {
    let mut out = String::with_capacity(src.len());
    let mut cur = 0usize;
    for &(s, e) in spans {
        if s >= cur && e <= src.len() {
            out.push_str(&src[cur..s]);
            let repl = if ends_with_bash_assign_eq(&src[..s])
                || (is_glued_bt_prefix(&src[..s]) && is_glued_after_byte(src.as_bytes().get(e)))
            {
                'x'
            } else if e < src.len()
                && src[e..].starts_with(|c: char| c == ' ' || c == '\t' || (!c.is_ascii_whitespace() && !matches!(c, ';' | '&' | '|' | ')' | '}')))
            {
                ' '
            } else {
                'x'
            };
            out.push(repl);
            cur = e;
        }
    }
    out.push_str(&src[cur..]);
    out
}

pub(super) fn split_bash_backtick_segments(txt: &str, in_direct_dq: bool, glued_kind: u8) -> Vec<String> {
    if txt.len() < 2 || !txt.starts_with('`') || !txt.ends_with('`') {
        return Vec::new();
    }
    if !txt[1..txt.len() - 1].contains('`') {
        let inner = unescape_backtick_layer(&txt[1..txt.len() - 1], in_direct_dq);
        return if inner.trim().is_empty() { Vec::new() } else { vec![inner] };
    }
    let (mut tr, mut heredoc, mut arith) = (
        QuoteDepthTracker::new_for(LanguageId::Bash),
        HeredocTracker::default(),
        Vec::new(),
    );
    if in_direct_dq {
        tr.step('"', txt.chars().next());
    }
    let (mut out, mut bt_start, mut gap_start, mut line_start) = (Vec::new(), None, 0usize, 0usize);
    let (mut bt_opens, mut broken): (Vec<usize>, Vec<(usize, usize)>) = (Vec::new(), Vec::new());
    while line_start < txt.len() {
        let rel_nl = txt[line_start..].find('\n');
        let line_end = rel_nl.map_or(txt.len(), |p| line_start + p);
        let line = &txt[line_start..line_end];
        if let Some(start_rel) = step_bash_line_bt_start(&mut heredoc, line) {
            let mut iter = line[start_rel..].char_indices().peekable();
            while let Some((irel, ch)) = iter.next() {
                let rel = start_rel + irel;
                if try_step_bash_heredoc_or_arith(
                    &mut tr, &mut heredoc, &mut arith, line, rel, start_rel, &mut iter,
                ) {
                    continue;
                }
                let prev_d = tr.bash_bt_depth();
                let Some(end_idx) = step_bash_tr_char(
                    &mut tr, txt, line_start + rel, line_start, line_start + start_rel, ch, &mut iter,
                ) else {
                    continue;
                };
                heredoc.prune_bt_above(tr.bash_bt_depth());
                pop_bash_arith(ch, &tr, &mut arith);
                let cur_d = tr.bash_bt_depth();
                if cur_d > prev_d {
                    bt_opens.push(line_start + rel);
                    if prev_d == 0 {
                        let _ = tr.bash_dq.take_dropped_q();
                        let gap = &txt[gap_start..line_start + rel];
                        if !gap.trim().is_empty() && (!in_direct_dq || gap.contains('$')) {
                            if in_direct_dq {
                                out.push(format!("\"{gap}\""));
                            } else if glued_kind == 1 && !gap.starts_with(char::is_whitespace) {
                                out.push(format!("x={gap}"));
                            } else if glued_kind == 2 && !gap.starts_with(char::is_whitespace) {
                                out.push(format!("x{gap}"));
                            } else {
                                out.push(gap.to_string());
                            }
                        }
                        bt_start = Some(end_idx);
                    }
                } else if cur_d < prev_d {
                    let popped = prev_d - cur_d;
                    let mut first_popped = None;
                    for _ in 0..popped {
                        if let Some(op) = bt_opens.pop() { first_popped = Some(op); }
                    }
                    if cur_d == 0 {
                        let dropped_q = tr.bash_dq.take_dropped_q();
                        if let Some(s) = bt_start.take() && popped == 1 && !dropped_q {
                            let inner = unescape_bt_body(txt, s, line_start + rel, &broken, in_direct_dq);
                            if !inner.trim().is_empty() {
                                out.push(inner);
                            }
                        }
                        broken.clear();
                        gap_start = end_idx;
                    } else if popped > 1 && let Some(op) = first_popped {
                        broken.push((op, end_idx));
                    }
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
    if let Some(s) = bt_start.take()
        && s < txt.len()
    {
        let end = if txt.as_bytes().last() == Some(&b'`') && txt.len() > s {
            txt.len() - 1
        } else {
            txt.len()
        };
        let inner = unescape_bt_body(txt, s, end, &broken, in_direct_dq);
        if !inner.trim().is_empty() {
            out.push(inner);
        }
    }
    out
}
