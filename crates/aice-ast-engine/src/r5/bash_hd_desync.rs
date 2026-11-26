use aice_lang_registry::LanguageId;

use crate::dep_callers_bash_cont::{
    bash_dq_eol_continues, bash_dq_eol_surviving_bs, bash_eol_continues, bash_eol_surviving_bs,
};
use crate::dep_callers_heredoc::{HeredocLine, HeredocTracker};
use crate::dep_callers_quote::{QuoteDepthTracker, StepKind};
use crate::r5::bash_hd_delim::CoalesceHdDelim;
use crate::r5::bash_heredoc::{
    pop_bash_arith, push_coalesced_hd_line, step_bash_tr_char, try_step_bash_heredoc_or_arith,
};
use crate::r5::bash_subst::try_skip_bash_hash_comment;

pub(super) fn coalesce_bash_continuations(src: &str) -> String {
    let (mut tr, mut hd, mut arith) = (
        QuoteDepthTracker::new_for(LanguageId::Bash),
        HeredocTracker::default(),
        Vec::new(),
    );
    let (mut out, mut prev_joined, mut dl) = (String::with_capacity(src.len()), None::<u8>, CoalesceHdDelim::default());
    let (mut carry, mut work_buf) = (String::new(), String::new());
    let mut lines = src.split('\n').peekable();
    while let Some(raw_line) = lines.next() {
        let has_nl = lines.peek().is_some();
        let line = if carry.is_empty() {
            raw_line
        } else {
            work_buf.clear();
            work_buf.push_str(&carry);
            work_buf.push_str(raw_line);
            carry.clear();
            work_buf.as_str()
        };
        let mut start_rel = 0usize;
        if prev_joined.is_none() {
            match hd.step_bash_line_bt(line) {
                (HeredocLine::NotActive, _) => {}
                (_, Some(j)) => {
                    out.push_str(&line[..j]);
                    start_rel = j;
                }
                (hl, None) => {
                    push_coalesced_hd_line(&hd, hl, line, has_nl, &mut out);
                    continue;
                }
            }
        }
        let (mut iter, mut in_comment) = (line[start_rel..].char_indices().peekable(), false);
        while let Some((irel, ch)) = iter.next() {
            let rel = start_rel + irel;
            let hash_ok = rel > 0 || prev_joined.is_none_or(|p| tr.bash_allows_hash(&[p, b'#'], 1, 0));
            if ch == '#' && hash_ok && try_skip_bash_hash_comment(&mut tr, line, rel, 0, start_rel, &mut iter) {
                in_comment = true;
                dl.on_comment();
                break;
            }
            if !dl.in_hd_delim()
                && try_step_bash_heredoc_or_arith(&mut tr, &mut hd, &mut arith, line, rel, start_rel, &mut iter)
            {
                dl.on_parsed_hd();
                continue;
            }
            dl.step_before_char(&tr, &arith, ch, rel);
            let (was_q, was_esc) = (tr.quote.is_some(), tr.is_escaped());
            let kind = tr.step(ch, iter.peek().map(|&(_, n)| n));
            let mut end_rel = rel + ch.len_utf8();
            if kind == StepKind::EnterTemplate && let Some((nirel, nch)) = iter.next() {
                end_rel = start_rel + nirel + nch.len_utf8();
            }
            hd.prune_bt_above(tr.bash_bt_depth());
            pop_bash_arith(ch, &tr, &mut arith);
            dl.step_after_char(&mut tr, &mut hd, ch, (was_q, was_esc), (rel, end_rel, line.len(), start_rel), &mut iter);
        }
        let bs = line.as_bytes()[start_rel..].iter().rev().take_while(|&&c| c == b'\\').count();
        let (in_sq, in_dq, ansi_sq) = (tr.quote == Some('\''), tr.quote == Some('"'), tr.bash_in_dq_ansi_sq());
        let eol_cont = if in_dq { bash_dq_eol_continues(bs, 0, ansi_sq) } else { bash_eol_continues(bs, 0, in_sq) };
        if !in_comment && tr.bash_bt_depth() == 0 && eol_cont {
            let surv = if in_dq { bash_dq_eol_surviving_bs(bs, 0, ansi_sq) } else { bash_eol_surviving_bs(bs, 0, in_sq) };
            if let Some(hd_pos) = dl.cont_hd_start() && hd_pos >= start_rel {
                out.push_str(&line[start_rel..hd_pos]);
                carry.push_str(&line[hd_pos..line.len() - bs]);
                for _ in 0..surv { carry.push('\\'); }
                if let Some((snap_tr, snap_arith, _)) = dl.take_snap() {
                    tr = snap_tr;
                    arith = snap_arith;
                } else {
                    tr.bash_end_continuation(bs);
                    if let Some(q) = tr.quote { tr.step(q, None); }
                }
                dl = CoalesceHdDelim::default();
                prev_joined = Some(b'<');
                continue;
            }
            out.push_str(&line[start_rel..line.len() - bs]);
            for _ in 0..surv {
                out.push('\\');
            }
            if surv == 0 && tr.bash_in_dq_sq() && out.ends_with('$') {
                out.push(' ');
            }
            prev_joined = if surv > 0 { Some(b'\\') } else { out.as_bytes().last().copied() };
            tr.bash_end_continuation(bs);
            continue;
        }
        prev_joined = None;
        tr.end_line();
        dl.on_newline();
        if tr.quote.is_none() {
            hd.flush_pending();
        }
        out.push_str(&line[start_rel..]);
        out.push('\n');
    }
    if !carry.is_empty() {
        out.push_str(&carry);
    }
    if !src.ends_with('\n') && out.ends_with('\n') {
        out.pop();
    }
    out
}

pub(super) fn fix_subshell_in_cmdsub(src: &str) -> Option<String> {
    if !src.contains("$((") {
        return None;
    }
    let (mut tr, mut hd, mut arith) = (
        QuoteDepthTracker::new_for(LanguageId::Bash),
        HeredocTracker::default(),
        Vec::new(),
    );
    let mut stack: Vec<(usize, usize)> = Vec::new();
    let mut inserts: Vec<usize> = Vec::new();
    let mut line_start = 0usize;
    while line_start < src.len() {
        let rel_nl = src[line_start..].find('\n');
        let line_end = rel_nl.map_or(src.len(), |p| line_start + p);
        let line = &src[line_start..line_end];
        if let Some(start_rel) = crate::r5::bash_heredoc::step_bash_line_bt_start(&mut hd, line) {
            let mut iter = line[start_rel..].char_indices().peekable();
            while let Some((irel, ch)) = iter.next() {
                let rel = start_rel + irel;
                let abs = line_start + rel;
                let is_dbl = (tr.quote.is_none() || tr.quote == Some('"'))
                    && !tr.is_bash_escaped(tr.quote == Some('"'))
                    && line[rel..].starts_with("$((");
                if try_step_bash_heredoc_or_arith(&mut tr, &mut hd, &mut arith, line, rel, start_rel, &mut iter) {
                    continue;
                }
                let next = iter.peek().map(|&(_, n)| n);
                if is_dbl {
                    stack.push((tr.bash_paren_depth() + 1, abs + 2));
                }
                if step_bash_tr_char(&mut tr, src, abs, line_start, line_start + start_rel, ch, &mut iter).is_none() {
                    continue;
                }
                hd.prune_bt_above(tr.bash_bt_depth());
                pop_bash_arith(ch, &tr, &mut arith);
                if ch == ')' {
                    while let Some(&(target_pd, ins_pos)) = stack.last() {
                        if tr.bash_paren_depth() < target_pd {
                            stack.pop();
                        } else if tr.bash_paren_depth() == target_pd {
                            stack.pop();
                            if next != Some(')') {
                                inserts.push(ins_pos);
                            }
                            break;
                        } else {
                            break;
                        }
                    }
                }
            }
        }
        if rel_nl.is_none() {
            break;
        }
        tr.end_line();
        hd.flush_pending();
        line_start = line_end + 1;
    }
    if inserts.is_empty() {
        return None;
    }
    inserts.sort_unstable();
    inserts.dedup();
    let mut out = String::with_capacity(src.len() + inserts.len());
    let mut cur = 0usize;
    for pos in inserts {
        out.push_str(&src[cur..pos]);
        out.push(' ');
        cur = pos;
    }
    out.push_str(&src[cur..]);
    Some(out)
}
