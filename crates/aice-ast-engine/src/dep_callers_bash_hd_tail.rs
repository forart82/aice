use aice_lang_registry::LanguageId;

use crate::dep_callers_bash::CompoundKind;
use crate::dep_callers_bash_abort::BashAbortState;
use crate::dep_callers_bash_hd::HdHdrMeta;
use crate::dep_callers_bash_span::{
    find_inline_cond_tail_span, find_inline_if_alt_tail_span, mask_range_spaces,
    step_inline_hd_grp_close,
};
use crate::dep_callers_quote::{QuoteDepthTracker, StepKind};
use crate::r5::bash_hd_bt::{and_list_tail_span_bang, find_dq_close};

fn apply_inline_cond_tail(
    imp_line: &mut String,
    code_line: &mut String,
    abort: &mut BashAbortState,
    (bt_depth, pd, kind, idx, in_bang): (usize, usize, CompoundKind, usize, bool),
    semi_pos: usize,
) {
    if kind == CompoundKind::If {
        if !in_bang {
            if let Some((bs, end, closed)) = find_inline_cond_tail_span(code_line, semi_pos, kind) {
                if end > bs {
                    mask_range_spaces(imp_line, bs, end);
                    mask_range_spaces(code_line, bs, end);
                }
                if !closed {
                    abort.set_inline_cond_body_abort(bt_depth, pd, kind, idx);
                }
            }
        } else if let Some((bs, end, closed)) = find_inline_if_alt_tail_span(code_line, semi_pos) {
            if end > bs {
                mask_range_spaces(imp_line, bs, end);
                mask_range_spaces(code_line, bs, end);
            }
            if !closed {
                abort.set_if_rest_abort(bt_depth, pd, idx, bs < end);
            }
        }
    } else if ((kind == CompoundKind::While && !in_bang) || (kind == CompoundKind::Until && in_bang))
        && let Some((bs, end, closed)) = find_inline_cond_tail_span(code_line, semi_pos, kind)
    {
        if end > bs {
            mask_range_spaces(imp_line, bs, end);
            mask_range_spaces(code_line, bs, end);
        }
        if !closed {
            abort.set_inline_cond_body_abort(bt_depth, pd, kind, idx);
        }
    }
}

pub(crate) fn mask_hd_header_tail(
    imp_lines: &mut [String],
    code_lines: &mut [String],
    abort: &mut BashAbortState,
    meta: HdHdrMeta,
    bt_depth: usize,
) -> Option<usize> {
    if meta.line >= code_lines.len() || meta.col > code_lines[meta.line].len() {
        return None;
    }
    let line = &code_lines[meta.line];
    let mut tr = QuoteDepthTracker::new_for(LanguageId::Bash);
    let (mut seen_op, mut trailing_op, mut saw_stop_sep) = (false, false, false);
    let (mut first_op, mut stop_col) = (None::<usize>, line.len());
    let (mut redir_spans, mut cur_redir, mut redir_state) = (Vec::new(), None::<usize>, 0u8);
    let mut prev_ch: Option<char> = None;
    let mut iter = line[meta.col..].char_indices().peekable();
    while let Some((rel, ch)) = iter.next() {
        let abs = meta.col + rel;
        let top = tr.at_top_level();
        if top && ch == '#' && tr.bash_allows_hash(line.as_bytes(), abs, meta.col) {
            if let Some(rs) = cur_redir.take() && redir_state == 2 { redir_spans.push((rs, abs)); }
            stop_col = abs;
            break;
        }
        let next = iter.peek().map(|&(_, n)| n);
        if top {
            let is_and = ch == '&' && next == Some('&');
            let is_or = ch == '|' && next == Some('|');
            let is_primary = if meta.in_bang { is_or } else { is_and };
            let is_other_list = if meta.in_bang { is_and } else { is_or };
            if is_primary {
                if let Some(rs) = cur_redir.take() && redir_state == 2 { redir_spans.push((rs, abs)); }
                if first_op.is_none() { first_op = Some(abs); }
                (seen_op, trailing_op) = (true, true);
                tr.step(ch, next);
                if let Some((_, nch)) = iter.next() { tr.step(nch, iter.peek().map(|&(_, c)| c)); prev_ch = Some(nch); }
                continue;
            }
            if is_other_list || ch == ';'
                || (ch == '&' && next != Some('>'))
                || (ch == '|' && !seen_op && prev_ch != Some('>'))
                || matches!(ch, ')' | '}')
            {
                if let Some(rs) = cur_redir.take() && redir_state == 2 { redir_spans.push((rs, abs)); }
                stop_col = abs;
                trailing_op = false;
                saw_stop_sep = true;
                break;
            }
            if first_op.is_none() {
                if (matches!(ch, '>' | '<') && next != Some('(')) || (ch == '&' && next == Some('>')) {
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
    let stop_is_semi = line.as_bytes().get(stop_col) == Some(&b';');
    for (rs, re) in redir_spans {
        mask_range_spaces(&mut imp_lines[meta.line], rs, re);
        mask_range_spaces(&mut code_lines[meta.line], rs, re);
    }
    if let Some(fa) = first_op {
        mask_range_spaces(&mut imp_lines[meta.line], fa, stop_col);
        mask_range_spaces(&mut code_lines[meta.line], fa, stop_col);
    }
    if trailing_op {
        if meta.in_bang {
            abort.set_hd_or_abort(bt_depth, meta.paren_depth, 0);
        } else {
            abort.set_hd_and_abort(bt_depth, meta.paren_depth, 0);
        }
    } else if !saw_stop_sep {
        if let Some((kind, idx)) = meta.in_cond {
            abort.set_cond_hd_abort(bt_depth, meta.paren_depth, kind, idx, meta.in_bang);
        } else if let Some((case_d, arm_matches)) = meta.in_case_arm {
            abort.set_case_hd_abort(bt_depth, meta.paren_depth, case_d, arm_matches, meta.in_bang);
        } else if meta.in_inner_brace_grp {
            abort.set_hd_brace_abort(bt_depth, meta.paren_depth, meta.brace_grp_depth, meta.in_bang);
        } else if meta.in_bt_top && meta.bt_depth > 0 {
            abort.set_bt_hd_abort(meta.bt_depth, meta.paren_depth, meta.in_bang);
        } else if meta.paren_depth > 0 {
            let only_sub_bang = meta.in_bang && abort.is_subshell_sole_cmd(bt_depth, meta.paren_depth);
            abort.set_cmdsub_hd_abort(bt_depth, meta.paren_depth - 1, meta.in_bang && !only_sub_bang);
        }
    } else if stop_is_semi && let Some((kind, idx)) = meta.in_cond {
        apply_inline_cond_tail(
            &mut imp_lines[meta.line],
            &mut code_lines[meta.line],
            abort,
            (bt_depth, meta.paren_depth, kind, idx, meta.in_bang),
            stop_col,
        );
    } else if !meta.outer_grp_bangs.is_empty()
        && let Some((after_p, last_kind, final_bang, closed_cnt)) = step_inline_hd_grp_close(
            &code_lines[meta.line], stop_col, &meta.outer_grp_bangs, meta.in_bang,
        )
    {
        let (g_bt, g_pd, g_bg, _, _) = meta.outer_grp_bangs[closed_cnt - 1];
        let mut scan_p = after_p;
        if matches!(last_kind, 2 | 4) && let Some(dq_end) = find_dq_close(&code_lines[meta.line], scan_p) {
            scan_p = dq_end + 1;
        }
        let b = code_lines[meta.line].as_bytes();
        let mut ws_p = scan_p;
        while ws_p < b.len() && matches!(b[ws_p], b' ' | b'\t') { ws_p += 1; }
        if let Some((ck, cidx, c_sd, c_bd)) = meta.outer_cond && (g_pd, g_bg) == (c_sd, c_bd) {
            if b.get(ws_p) == Some(&b';') {
                apply_inline_cond_tail(
                    &mut imp_lines[meta.line],
                    &mut code_lines[meta.line],
                    abort,
                    (bt_depth, c_sd, ck, cidx, final_bang),
                    ws_p,
                );
            } else if ws_p == b.len() || b[ws_p] == b'#' {
                abort.set_cond_hd_abort(bt_depth, c_sd, ck, cidx, final_bang);
            }
        } else if closed_cnt == meta.outer_grp_bangs.len() {
            if let Some((as_, ae)) = and_list_tail_span_bang(&code_lines[meta.line], after_p, last_kind, final_bang) {
                let tail_trimmed = code_lines[meta.line][as_..ae].trim_end();
                let op_trail = if final_bang { tail_trimmed.ends_with("||") } else { tail_trimmed.ends_with("&&") };
                mask_range_spaces(&mut imp_lines[meta.line], as_, ae);
                mask_range_spaces(&mut code_lines[meta.line], as_, ae);
                if op_trail {
                    if final_bang {
                        abort.set_hd_or_abort(g_bt, g_pd, 0);
                    } else {
                        abort.set_hd_and_abort(g_bt, g_pd, 0);
                    }
                }
            }
        } else if last_kind == 0 && (ws_p == b.len() || b[ws_p] == b'#') {
            abort.set_pending_exit_abort(g_bt, g_pd, g_bg, final_bang);
        }
    }
    Some(stop_col)
}
