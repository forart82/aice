use aice_lang_registry::LanguageId;

use crate::dep_callers_bash::CompoundKind;
use crate::dep_callers_bash_cont::{
    bash_dq_eol_continues, bash_eol_continues, try_parse_bash_heredoc_in_bt,
};
use crate::dep_callers_heredoc::HeredocTracker;
use crate::dep_callers_quote::QuoteDepthTracker;
use crate::r5::bash_hd_bt::{
    HdMeta, is_simple_heredoc_header, strip_hd_op,
};
use crate::r5::bash_hd_delim::CoalesceHdDelim;
use crate::r5::bash_hd_cond::{handle_norm_compound_event, step_norm_pending_grp};
use crate::r5::bash_hd_meta::{
    HdSlot, NormAbortCtx, finalize_hd_meta, flush_pending_meta,
};
use crate::r5::bash_hd_norm_step::{
    finalize_hd_edits, step_active_hd_line, sync_norm_case_bangs, try_carry_hd_bt_cont,
};
use crate::r5::bash_heredoc::{pop_bash_arith, step_bash_tr_char, try_step_bash_heredoc_or_arith};

pub(super) fn recover_bash_heredoc_desync(src: &str, slot_pfx: &str) -> Option<(String, Vec<HdSlot>)> {
    recover_bash_heredoc_impl(src, false, slot_pfx)
}

pub(super) fn recover_bash_heredoc_errors(src: &str, slot_pfx: &str) -> Option<(String, Vec<HdSlot>)> {
    recover_bash_heredoc_impl(src, true, slot_pfx)
}

fn starts_kw(s: &str, kw: &str) -> bool {
    s.starts_with(kw) && s.as_bytes().get(kw.len()).is_none_or(|&b| !b.is_ascii_alphanumeric() && b != b'_')
}

fn toggle_bang_at(bangs: &mut Vec<(usize, usize, usize)>, k: (usize, usize, usize)) {
    if let Some(p) = bangs.iter().rposition(|&x| x == k) { bangs.remove(p); } else { bangs.push(k); }
}

fn recover_bash_heredoc_impl(src: &str, force_neutralize: bool, slot_pfx: &str) -> Option<(String, Vec<HdSlot>)> {
    if !src.contains("<<") { return None; }
    let (mut tr, mut hd, mut arith) = (QuoteDepthTracker::new_for(LanguageId::Bash), HeredocTracker::default(), Vec::new());
    let (mut pending_meta, mut active_meta): (Vec<HdMeta>, Vec<HdMeta>) = (Vec::new(), Vec::new());
    let (mut edits, mut hd_slots, mut dl) = (Vec::new(), Vec::new(), CoalesceHdDelim::default());
    let (mut bt_cont_hd, mut work_buf) = (None::<(usize, String)>, String::new());
    let (mut ctx, mut bangs): (NormAbortCtx, Vec<(usize, usize, usize)>) = (NormAbortCtx::default(), Vec::new());
    let (mut line_start, mut prev_ch, mut cont_pipe) = (0usize, None::<char>, false);
    while line_start < src.len() {
        let rel_nl = src[line_start..].find('\n');
        let line_end = rel_nl.map_or(src.len(), |p| line_start + p);
        let line = &src[line_start..line_end];
        let start_rel = step_active_hd_line(
            &mut hd, &mut active_meta, bt_cont_hd.is_some(), line, line_start, line_end,
            rel_nl.is_some(), force_neutralize, src, slot_pfx, &mut hd_slots, &mut edits, &mut ctx,
        );
        if let Some(rel_start) = start_rel {
            let cont_ctx = bt_cont_hd.take();
            let (work, carry_len, saved_hdr_start) = if let Some((hs, carry)) = cont_ctx.as_ref() {
                work_buf.clear(); work_buf.push_str(carry); work_buf.push_str(line);
                (work_buf.as_str(), carry.len(), Some(*hs))
            } else {
                (line, 0usize, None)
            };
            let mut in_comment = false;
            let mut iter = work[rel_start..].char_indices().peekable();
            while let Some((irel, ch)) = iter.next() {
                let rel = rel_start + irel;
                if tr.quote.is_none() && !tr.is_bash_escaped(false) && !dl.in_hd_delim() && arith.is_empty()
                    && tr.bash_active_braces() == 0 && work[rel..].starts_with("<<")
                    && let Some((entry, end_rel)) = try_parse_bash_heredoc_in_bt(
                        work, rel, tr.bash_bt_depth(), tr.bash_bt_unescape_mask(),
                    )
                {
                    let (hdr_s, hdr_e) = if rel < carry_len {
                        (saved_hdr_start.unwrap_or(line_start), line_start + end_rel.saturating_sub(carry_len))
                    } else {
                        (line_start + rel - carry_len, line_start + end_rel - carry_len)
                    };
                    let simple = rel >= carry_len && is_simple_heredoc_header(strip_hd_op(&work[rel..end_rel]));
                    let (bd, pd, bg) = (entry.bt_depth, tr.bash_paren_depth(), tr.bash_brace_grp_depth());
                    pending_meta.push(HdMeta {
                        hdr_start: hdr_s, hdr_end: hdr_e, hdr_line_end: line_end, close_line_end: src.len(),
                        quoted: entry.quoted, neutralize: !simple || (force_neutralize && entry.quoted),
                        bt_depth: bd, bt_mask: entry.bt_mask, pd, hdr_tail_ctrl: false,
                        grp_ctx: tr.bash_hd_group_ctx(), outer_grp_bangs: tr.bash_hd_group_outer_bangs(&bangs),
                        outer_cond: tr.bash_outer_cond_for_grp(),
                        cond_ctx: tr.bash_in_cond(),
                        case_ctx: tr.bash_in_case_body(), in_bang: bangs.contains(&(bd, pd, bg)),
                        in_sub_sole: ctx.is_subshell_sole_cmd(bd, pd),
                        body: String::new(), body_lines: Vec::new(),
                    });
                    (ctx.pending_grp, ctx.pending_cond, ctx.pending_case) = (None, None, None);
                    ctx.pending_grp_bangs.clear();
                    hd.pending.push(entry);
                    tr.bash_on_escape_char();
                    dl.on_parsed_hd();
                    while let Some(&(nirel, _)) = iter.peek() { if rel_start + nirel >= end_rel { break; } iter.next(); }
                    prev_ch = None;
                    continue;
                }
                if !dl.in_hd_delim()
                    && try_step_bash_heredoc_or_arith(&mut tr, &mut hd, &mut arith, work, rel, rel_start, &mut iter)
                {
                    dl.on_parsed_hd();
                    prev_ch = None;
                    continue;
                }
                if tr.quote.is_none() && !tr.is_bash_escaped(false) && tr.bash_active_braces() == 0
                    && !(ch == '#' && tr.bash_allows_hash(work.as_bytes(), rel, rel_start))
                    && !ch.is_ascii_whitespace() && ch != ';' && tr.bash_boundary()
                {
                    if let Some((_, _, kind, _, _)) = ctx.pending_cond {
                        let ok = match kind {
                            CompoundKind::If => starts_kw(&work[rel..], "then"),
                            CompoundKind::While | CompoundKind::Until => starts_kw(&work[rel..], "do"),
                            CompoundKind::Loop => false,
                        };
                        if !ok { ctx.pending_cond = None; }
                    }
                    if ctx.pending_case.is_some() && !starts_kw(&work[rel..], "esac") { ctx.pending_case = None; }
                }
                let snap_abs = if carry_len == 0 { line_start + rel } else { rel };
                dl.step_before_char(&tr, &arith, ch, snap_abs);
                let (was_q, was_esc, pd_before, bg_before, cases_before, conds_before) = (
                    tr.quote.is_some(), tr.is_escaped(), tr.bash_paren_depth(),
                    tr.bash_brace_grp_depth(), tr.bash_case_depth(), tr.bash_cond_depth(),
                );
                let next = iter.peek().map(|&(_, n)| n);
                if tr.quote.is_none() && !tr.is_bash_escaped(false) && tr.bash_active_braces() == 0 {
                    if tr.bash_boundary() && ctx.cmd_ready
                        && !matches!(ch, ')' | '}' | ';' | '&' | '|' | '#')
                        && !(ch == '`' && tr.bash_bt_depth() > 0) && !ch.is_ascii_whitespace()
                    {
                        ctx.cmd_ready = false;
                        ctx.on_subshell_cmd_start(tr.bash_bt_depth(), pd_before, bg_before);
                    }
                    if matches!(ch, ';' | '{' | '(') || (ch == '|' && prev_ch != Some('>'))
                        || (ch == '&' && next != Some('>') && !matches!(prev_ch, Some('>' | '<')))
                    {
                        ctx.cmd_ready = true;
                    }
                }
                let Some(end_idx) = step_bash_tr_char(&mut tr, work, rel, 0, rel_start, ch, &mut iter) else {
                    in_comment = true;
                    dl.on_comment();
                    continue;
                };
                if ch == '(' && tr.bash_paren_depth() > pd_before && tr.bash_in_normal_subshell() {
                    ctx.on_enter_subshell(tr.bash_bt_depth(), tr.bash_paren_depth());
                }
                if tr.bash_take_bang() {
                    let pd_b = if ch == '(' { pd_before } else { tr.bash_paren_depth() };
                    let bg_b = if ch == '{' && tr.bash_brace_grp_depth() > bg_before { bg_before } else { tr.bash_brace_grp_depth() };
                    toggle_bang_at(&mut bangs, (tr.bash_bt_depth(), pd_b, bg_b));
                }
                let (c_bt, c_pd, c_bg) = (tr.bash_bt_depth(), tr.bash_paren_depth(), tr.bash_brace_grp_depth());
                bangs.retain(|&(b, p, g)| b < c_bt || (b == c_bt && (p < c_pd || (p == c_pd && g <= c_bg))));
                let was_sole_sub = ch == ')' && c_pd < pd_before && ctx.is_subshell_sole_cmd(c_bt, pd_before);
                ctx.prune_subshells(c_bt, c_pd);
                if !was_q && !was_esc && tr.bash_active_braces() == 0 {
                    let is_pipe = ch == '|' && next != Some('|') && !matches!(prev_ch, Some('|' | '>'));
                    if is_pipe {
                        cont_pipe = true;
                    } else if !matches!(ch, ' ' | '\t') && !(ch == '&' && prev_ch == Some('|')) {
                        cont_pipe = false;
                    }
                    let is_amp = ch == '&' && next != Some('>') && !matches!(prev_ch, Some('>' | '<' | '|'));
                    if ch == ';' || is_amp || (ch == '|' && prev_ch == Some('|')) {
                        bangs.retain(|&x| x != (c_bt, c_pd, c_bg));
                        ctx.on_subshell_sep(c_bt, c_pd, c_bg, is_amp || (ch == '|' && prev_ch == Some('|')));
                    } else if is_pipe {
                        ctx.on_subshell_sep(c_bt, c_pd, c_bg, true);
                    }
                } else {
                    cont_pipe = false;
                }
                let abs = line_start + rel - carry_len;
                handle_norm_compound_event(&mut ctx, &mut tr, pd_before, abs, src, &mut edits);
                sync_norm_case_bangs(&mut ctx, cases_before, conds_before, &mut tr, &mut bangs);
                hd.prune_bt_above(tr.bash_bt_depth());
                pending_meta.retain(|m| m.bt_depth <= tr.bash_bt_depth());
                while active_meta.len() > hd.active.len() {
                    let Some(idx) = active_meta.iter().position(|m| m.bt_depth > tr.bash_bt_depth()) else { break; };
                    finalize_hd_meta(active_meta.remove(idx), force_neutralize, src, slot_pfx, &mut hd_slots, &mut edits, &mut ctx);
                }
                let after = line_start + end_idx - carry_len;
                step_norm_pending_grp(&mut ctx, &tr, &bangs, ch, (abs, after, src), was_sole_sub, &mut edits);
                pop_bash_arith(ch, &tr, &mut arith);
                let spans = if carry_len == 0 {
                    (line_start + rel, line_start + end_idx, line_end, line_start + rel_start)
                } else {
                    (rel, end_idx, work.len(), rel_start)
                };
                if let Some((hs_raw, he_raw, q)) = dl.step_after_char(&mut tr, &mut hd, ch, (was_q, was_esc), spans, &mut iter) {
                    let (hs, he) = if carry_len == 0 { (hs_raw, he_raw) } else {
                        let hs = if hs_raw < carry_len { saved_hdr_start.unwrap_or(line_start) } else { line_start + hs_raw - carry_len };
                        (hs, line_start + he_raw.saturating_sub(carry_len))
                    };
                    let (bd, pd, bg) = (tr.bash_bt_depth(), tr.bash_paren_depth(), tr.bash_brace_grp_depth());
                    pending_meta.push(HdMeta {
                        hdr_start: hs, hdr_end: he, hdr_line_end: line_end, close_line_end: src.len(),
                        quoted: q, neutralize: true, bt_depth: bd, bt_mask: tr.bash_bt_unescape_mask(),
                        pd, hdr_tail_ctrl: false, grp_ctx: tr.bash_hd_group_ctx(),
                        outer_grp_bangs: tr.bash_hd_group_outer_bangs(&bangs),
                        outer_cond: tr.bash_outer_cond_for_grp(),
                        cond_ctx: tr.bash_in_cond(), case_ctx: tr.bash_in_case_body(),
                        in_bang: bangs.contains(&(bd, pd, bg)),
                        in_sub_sole: ctx.is_subshell_sole_cmd(bd, pd),
                        body: String::new(), body_lines: Vec::new(),
                    });
                    (ctx.pending_grp, ctx.pending_cond, ctx.pending_case) = (None, None, None);
                    ctx.pending_grp_bangs.clear();
                }
                prev_ch = Some(ch);
            }
            if rel_nl.is_some() {
                let bs = work.as_bytes()[rel_start..].iter().rev().take_while(|&&c| c == b'\\').count();
                let (d, in_sq, in_dq, ansi_sq) = (tr.bash_bt_depth(), tr.quote == Some('\''), tr.quote == Some('"'), tr.bash_in_dq_ansi_sq());
                let eol_cont = if in_dq { bash_dq_eol_continues(bs, d, ansi_sq) } else { bash_eol_continues(bs, d, in_sq) };
                if !in_comment && d > 0 && eol_cont {
                    if let Some(carried) = try_carry_hd_bt_cont(
                        &mut dl, &mut tr, &mut arith, work, rel_start, carry_len, line_start, saved_hdr_start,
                        (bs, d, in_sq, in_dq, ansi_sq),
                    ) {
                        bt_cont_hd = Some(carried);
                        line_start = line_end + 1;
                        continue;
                    }
                    tr.bash_end_continuation(bs);
                    line_start = line_end + 1;
                    continue;
                }
                let (cases_before, conds_before) = (tr.bash_case_depth(), tr.bash_cond_depth());
                tr.end_line();
                if tr.bash_take_bang() {
                    toggle_bang_at(&mut bangs, (tr.bash_bt_depth(), tr.bash_paren_depth(), tr.bash_brace_grp_depth()));
                }
                sync_norm_case_bangs(&mut ctx, cases_before, conds_before, &mut tr, &mut bangs);
                if tr.quote.is_none() {
                    ctx.cmd_ready = true;
                    if !cont_pipe {
                        bangs.retain(|&x| x != (tr.bash_bt_depth(), tr.bash_paren_depth(), tr.bash_brace_grp_depth()));
                        ctx.on_subshell_sep(tr.bash_bt_depth(), tr.bash_paren_depth(), tr.bash_brace_grp_depth(), false);
                    }
                    cont_pipe = false;
                }
                let pd_nl = tr.bash_paren_depth();
                handle_norm_compound_event(&mut ctx, &mut tr, pd_nl, line_end, src, &mut edits);
                dl.on_newline();
                if tr.quote.is_none() {
                    flush_pending_meta(&mut pending_meta, &mut active_meta, src, line_end);
                    hd.flush_pending();
                }
            }
        }
        if rel_nl.is_none() { break; }
        line_start = line_end + 1;
        prev_ch = None;
    }
    finalize_hd_edits(pending_meta, active_meta, edits, hd_slots, force_neutralize, src, slot_pfx)
}
