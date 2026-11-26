use aice_lang_registry::LanguageId;

use crate::dep_callers_heredoc::{HeredocLine, HeredocTracker};
use crate::dep_callers_quote::QuoteDepthTracker;
use crate::r5::bash_hd_unq::new_dq_param_tracker;
use crate::r5::bash_heredoc::{
    pop_bash_arith, scan_line_until, step_bash_line_bt_start, step_bash_tr_char,
    try_step_bash_heredoc_or_arith,
};
use crate::r5::bash_subst::{
    ExpAbort, char_len, extract_expansion_substitutions_checked,
    extract_expansion_substitutions_with_tail, is_ws_followed_by_dollar,
};
use crate::r5::cst_helpers::node_text;

pub(super) fn bash_cst_bt_desynced(root: tree_sitter::Node<'_>, src: &str, spans: &[(usize, usize)]) -> bool {
    if spans.is_empty() { return false; }
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        if node.kind() == "command_substitution" && node_text(node, src).starts_with('`') {
            let (cs, ce) = (node.start_byte(), node.end_byte());
            if spans.iter().any(|&(bs, be)| (bs == cs && be != ce) || (bs < cs && cs < be && be < ce)) {
                return true;
            }
            continue;
        }
        if node.kind() == "heredoc_body" { continue; }
        for i in (0..node.named_child_count()).rev() {
            if let Some(c) = node.named_child(i as u32) { stack.push(c); }
        }
    }
    false
}

pub(super) fn bash_cst_compound_bang_desynced(root: tree_sitter::Node<'_>, src: &str) -> bool {
    if !src.contains("<<") { return false; }
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        if node.kind() == "negated_command" {
            for i in 0..node.named_child_count() {
                if let Some(c) = node.named_child(i as u32) && c.kind() == "command"
                    && let Some(nm) = c.child_by_field_name("name")
                {
                    let nt = node_text(nm, src).trim();
                    if matches!(nt, "{" | "case" | "if" | "while" | "until" | "for") {
                        return true;
                    }
                    if nt == "!"
                        && (0..c.named_child_count()).filter_map(|j| c.named_child(j as u32)).any(|a| {
                            !matches!(a.kind(), "command_name" | "comment")
                                && matches!(node_text(a, src).trim(), "{" | "case" | "if" | "while" | "until" | "for")
                        })
                    {
                        return true;
                    }
                }
            }
        }
        if node.kind() == "heredoc_body" { continue; }
        for i in (0..node.named_child_count()).rev() {
            if let Some(c) = node.named_child(i as u32) { stack.push(c); }
        }
    }
    false
}

pub(super) fn is_heredoc_redirect_quoted(node: tree_sitter::Node<'_>, src: &str) -> bool {
    (0..node.named_child_count()).filter_map(|i| node.named_child(i as u32))
        .find(|c| c.kind() == "heredoc_start")
        .is_some_and(|c| node_text(c, src).contains(['\'', '"', '\\']))
}

pub(super) fn bash_cst_expansions_desynced(root: tree_sitter::Node<'_>, src: &str) -> bool {
    if !src.contains('$') { return false; }
    let mut stack = vec![(root, false, false)];
    while let Some((node, in_dq, in_str)) = stack.pop() {
        let (mut child_dq, mut child_str) = (in_dq, in_str);
        match node.kind() {
            "command_substitution" => {
                if node_text(node, src).starts_with('`') { continue; }
                (child_dq, child_str) = (false, false);
            }
            "heredoc_redirect" => {
                let quoted = is_heredoc_redirect_quoted(node, src);
                for i in (0..node.named_child_count()).rev() {
                    if let Some(c) = node.named_child(i as u32)
                        && !matches!(c.kind(), "heredoc_start" | "heredoc_end")
                        && (!quoted || c.kind() != "heredoc_body")
                    {
                        stack.push((c, child_dq, child_str));
                    }
                }
                continue;
            }
            "string" => (child_dq, child_str) = (true, true),
            "heredoc_body" => (child_dq, child_str) = (true, false),
            "simple_expansion" if in_str => {
                if node_text(node, src).as_bytes().iter().any(u8::is_ascii_whitespace) { return true; }
            }
            "expansion" => {
                let txt = node_text(node, src).trim_start_matches(|c: char| c.is_ascii_whitespace());
                if txt.starts_with("${") && is_bash_expansion_desynced(txt, in_dq) { return true; }
            }
            _ => {}
        }
        for i in (0..node.named_child_count()).rev() {
            if let Some(c) = node.named_child(i as u32) { stack.push((c, child_dq, child_str)); }
        }
    }
    false
}

fn is_bash_expansion_desynced(txt: &str, in_dq: bool) -> bool {
    let mut tr = QuoteDepthTracker::new_for(LanguageId::Bash);
    if in_dq { tr.step('"', txt.chars().next()); }
    let (mut heredoc, mut arith, mut closed_early, mut line_start) = (HeredocTracker::default(), Vec::new(), false, 0usize);
    while line_start < txt.len() {
        let rel_nl = txt[line_start..].find('\n');
        let line_end = rel_nl.map_or(txt.len(), |p| line_start + p);
        let line = &txt[line_start..line_end];
        if let Some(start_rel) = step_bash_line_bt_start(&mut heredoc, line) {
            let mut iter = line[start_rel..].char_indices().peekable();
            while let Some((irel, ch)) = iter.next() {
                let rel = start_rel + irel;
                if closed_early { return true; }
                if try_step_bash_heredoc_or_arith(&mut tr, &mut heredoc, &mut arith, line, rel, start_rel, &mut iter) { continue; }
                let prev_d = tr.bash_param_depth();
                if step_bash_tr_char(&mut tr, txt, line_start + rel, line_start, line_start + start_rel, ch, &mut iter).is_none() { continue; }
                heredoc.prune_bt_above(tr.bash_bt_depth());
                pop_bash_arith(ch, &tr, &mut arith);
                if prev_d > 0 && tr.bash_param_depth() == 0 { closed_early = true; }
            }
        }
        if rel_nl.is_none() { break; }
        tr.end_line(); heredoc.flush_pending(); line_start = line_end + 1;
    }
    tr.bash_param_depth() != 0 || tr.in_bash_bt() || tr.bash_paren_depth() != 0 || tr.quote != if in_dq { Some('"') } else { None }
}

enum HbMode {
    Top,
    Aborted,
    InParam { p_tr: QuoteDepthTracker, p_hd: HeredocTracker, p_arith: Vec<usize>, start: usize },
    InCmdSub { s_tr: QuoteDepthTracker, s_hd: HeredocTracker, s_param: Option<(usize, bool)>, s_arith: Vec<usize> },
    InBt { b_tr: QuoteDepthTracker, b_hd: HeredocTracker, b_arith: Vec<usize> },
}

#[allow(clippy::too_many_arguments)]
fn step_recovery_code_line(
    src: &str, line_start: usize, line_end: usize, rel_start: usize, stop_on_cmdsub_end: bool,
    tr: &mut QuoteDepthTracker, heredoc: &mut HeredocTracker, param_start: &mut Option<(usize, bool)>,
    arith: &mut Vec<usize>, out: &mut String, subs: &mut Vec<String>, copied_until: &mut usize,
) -> Option<usize> {
    let line = &src[line_start..line_end];
    let mut iter = src[line_start + rel_start..line_end].char_indices().peekable();
    while let Some((irel, ch)) = iter.next() {
        let (rel, abs) = (rel_start + irel, line_start + rel_start + irel);
        if try_step_bash_heredoc_or_arith(tr, heredoc, arith, line, rel, rel_start, &mut iter) { continue; }
        let (prev_d, in_dq) = (tr.bash_param_depth(), tr.quote == Some('"'));
        let Some(end_idx) = step_bash_tr_char(tr, src, abs, line_start, line_start + rel_start, ch, &mut iter) else { continue; };
        heredoc.prune_bt_above(tr.bash_bt_depth());
        pop_bash_arith(ch, tr, arith);
        let cur_d = tr.bash_param_depth();
        if prev_d == 0 && cur_d > 0 && param_start.is_none() && !tr.in_bash_bt() {
            let start = if ch == '{' && abs > 0 && src.as_bytes()[abs - 1] == b'$' { abs - 1 } else { abs };
            *param_start = Some((start, in_dq));
        } else if prev_d > 0 && cur_d == 0 && let Some((start, was_dq)) = param_start.take() {
            let tail = if was_dq { &src[end_idx..] } else { "" };
            let (esubs, abort) = extract_expansion_substitutions_with_tail(&src[start..end_idx], was_dq, false, tail);
            subs.extend(esubs);
            if abort == ExpAbort::None {
                out.push_str(&src[*copied_until..start]); out.push('x'); *copied_until = end_idx;
            } else if abort == ExpAbort::ClosedBadSub && &src[start..end_idx] != "${}" {
                out.push_str(&src[*copied_until..start]); out.push_str("${}"); *copied_until = end_idx;
            } else if abort == ExpAbort::BadSub && src[start..end_idx].contains('`') {
                out.push_str(&src[*copied_until..start]); out.push_str("${_:-$'\\''}"); *copied_until = end_idx;
            }
        } else if ch == '$' && prev_d == 0 && cur_d == 0 && param_start.is_none() && !tr.in_bash_bt()
            && tr.bash_dq_prev_dollar() && is_ws_followed_by_dollar(&src.as_bytes()[end_idx..])
        {
            out.push_str(&src[*copied_until..abs]); out.push('x'); *copied_until = end_idx;
        }
        if stop_on_cmdsub_end && tr.bash_paren_depth() == 0 && !tr.in_bash_bt() && tr.quote.is_none() { return Some(end_idx - line_start); }
    }
    None
}

#[allow(clippy::too_many_arguments)]
fn step_unquoted_heredoc_line(
    src: &str, line_start: usize, line_end: usize, has_nl: bool, hb_mode: &mut HbMode,
    out: &mut String, subs: &mut Vec<String>, copied_until: &mut usize,
) {
    let line = &src[line_start..line_end];
    let mut rel = 0usize;
    while rel < line.len() {
        match hb_mode {
            HbMode::Top => {
                let b = line.as_bytes();
                if b[rel] == b'\\' && rel + 1 < line.len() { rel += 1 + char_len(line, rel + 1); }
                else if line[rel..].starts_with("$$") { rel += 2; }
                else if line[rel..].starts_with("${") {
                    *hb_mode = HbMode::InParam { p_tr: new_dq_param_tracker(), p_hd: HeredocTracker::default(), p_arith: Vec::new(), start: line_start + rel };
                    rel += 2;
                } else if line[rel..].starts_with("$(") {
                    let s_arith = if line[rel..].starts_with("$((") { vec![0] } else { Vec::new() };
                    let mut s_tr = QuoteDepthTracker::new_for(LanguageId::Bash);
                    s_tr.step('$', Some('(')); s_tr.step('(', line[rel + 2..].chars().next());
                    *hb_mode = HbMode::InCmdSub { s_tr, s_hd: HeredocTracker::default(), s_param: None, s_arith };
                    rel += 2;
                } else if b[rel] == b'`' {
                    let mut b_tr = QuoteDepthTracker::new_for(LanguageId::Bash);
                    b_tr.step('`', line[rel + 1..].chars().next());
                    *hb_mode = HbMode::InBt { b_tr, b_hd: HeredocTracker::default(), b_arith: Vec::new() };
                    rel += 1;
                } else { rel += char_len(line, rel); }
            }
            HbMode::Aborted => break,
            HbMode::InParam { p_tr, p_hd, p_arith, start } => {
                let start_off = *start;
                if let Some(end_idx) = scan_line_until(p_tr, p_hd, p_arith, src, line_start, line_end, rel, false) {
                    let (esubs, abort) = extract_expansion_substitutions_checked(&src[start_off..end_idx], true, true);
                    subs.extend(esubs);
                    if abort != ExpAbort::None {
                        *hb_mode = HbMode::Aborted;
                        break;
                    }
                    out.push_str(&src[*copied_until..start_off]);
                    out.push('x');
                    *copied_until = end_idx;
                    rel = end_idx - line_start;
                    *hb_mode = HbMode::Top;
                } else { break; }
            }
            HbMode::InCmdSub { s_tr, s_hd, s_param, s_arith } => {
                let Some(start_rel) = step_bash_line_bt_start(s_hd, line) else { break; };
                if let Some(nr) = step_recovery_code_line(src, line_start, line_end, rel.max(start_rel), true, s_tr, s_hd, s_param, s_arith, out, subs, copied_until) {
                    rel = nr; *hb_mode = HbMode::Top;
                } else { if has_nl { s_tr.end_line(); s_hd.flush_pending(); } break; }
            }
            HbMode::InBt { b_tr, b_hd, b_arith } => {
                if let Some(end_idx) = scan_line_until(b_tr, b_hd, b_arith, src, line_start, line_end, rel, true) {
                    rel = end_idx - line_start; *hb_mode = HbMode::Top;
                } else { break; }
            }
        }
    }
    if has_nl {
        if let HbMode::InParam { p_tr, p_hd, .. } = hb_mode { p_tr.end_line(); p_hd.flush_pending(); }
        else if let HbMode::InBt { b_tr, b_hd, .. } = hb_mode { b_tr.end_line(); b_hd.flush_pending(); }
    }
}

pub(super) fn recover_bash_error_expansions(src: &str) -> Option<(String, Vec<String>)> {
    let (mut tr, mut heredoc) = (QuoteDepthTracker::new_for(LanguageId::Bash), HeredocTracker::default());
    let (mut out, mut subs) = (String::with_capacity(src.len()), Vec::new());
    let (mut param_start, mut arith, mut copied_until) = (None, Vec::new(), 0usize);
    let (mut hb_mode, mut line_start) = (HbMode::Top, 0usize);
    while line_start < src.len() {
        let rel_nl = src[line_start..].find('\n');
        let line_end = rel_nl.map_or(src.len(), |p| line_start + p);
        match heredoc.step_bash_line_bt(&src[line_start..line_end]) {
            (HeredocLine::DelimiterOrQuoted, None) => {
                hb_mode = HbMode::Top;
            }
            (HeredocLine::UnquotedBody, None) => step_unquoted_heredoc_line(src, line_start, line_end, rel_nl.is_some(), &mut hb_mode, &mut out, &mut subs, &mut copied_until),
            (hl, bt_cut) => {
                if bt_cut.is_some() && matches!(hl, HeredocLine::DelimiterOrQuoted | HeredocLine::UnquotedBody) { hb_mode = HbMode::Top; }
                step_recovery_code_line(src, line_start, line_end, bt_cut.unwrap_or(0), false, &mut tr, &mut heredoc, &mut param_start, &mut arith, &mut out, &mut subs, &mut copied_until);
                if rel_nl.is_some() { tr.end_line(); heredoc.flush_pending(); if !heredoc.active.is_empty() { hb_mode = HbMode::Top; } }
            }
        }
        if rel_nl.is_none() { break; }
        line_start = line_end + 1;
    }
    if copied_until == 0 { return None; }
    out.push_str(&src[copied_until..]);
    if out == src { return None; }
    Some((out, subs))
}
