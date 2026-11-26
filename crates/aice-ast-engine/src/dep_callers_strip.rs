use aice_lang_registry::LanguageId;

use crate::dep_callers_bash_abort::{BashAbortState, BashBufs, SnapKind};
use crate::dep_callers_bash_cont::{
    bash_continues_bt_hash_comment, bash_eol_continues, bash_find_bt_after_hash,
};
use crate::dep_callers_bash_dq_step::step_bash_quoted_state;
use crate::dep_callers_bash_hd::{HeredocSubKind, heredoc_sub_done};
use crate::dep_callers_bash_strip::BashStripState;
use crate::dep_callers_heredoc::HeredocTracker;
use crate::dep_callers_js_lex::{JsRegexCtx, step_js_code_token, try_consume_js_slash};
use crate::dep_callers_span::{StripCfg, step_non_bash_state};
use crate::dep_callers_strip_code::step_non_bash_code_char;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ScanState {
    Code,
    BlockComment,
    Backtick,
    BashDq,
    BashSq { ansi_c: bool },
    BashBtComment,
    Triple { double: bool },
    RustRaw { hashes: usize },
}

pub(crate) use crate::dep_callers_strip_code::{strip_comments_and_strings, strip_line_bash};

#[allow(clippy::too_many_arguments)]
pub(super) fn strip_line_inner(
    raw: &str,
    mut i: usize,
    cfg: &StripCfg,
    state: &mut ScanState,
    tpl_stack: &mut Vec<usize>,
    bash: &mut BashStripState,
    abort: &mut BashAbortState,
    js_ctx: &mut JsRegexCtx,
    heredoc: &mut HeredocTracker,
    prev_joined: Option<u8>,
    stop_kind: Option<HeredocSubKind>,
    mut skip_imp_bs: usize,
    allow_eol_cont: bool,
    bufs: &mut BashBufs<'_>,
) -> (Option<usize>, Option<usize>) {
    let b = raw.as_bytes();
    if b.is_empty() && matches!(*state, ScanState::BashBtComment) {
        *state = ScanState::Code;
    }
    while i < b.len() {
        if let Some(ni) = step_non_bash_state(raw, i, cfg, state, tpl_stack, js_ctx, (bufs.imp, bufs.code)) {
            i = ni;
            continue;
        }
        match *state {
            ScanState::BashDq | ScanState::BashSq { .. } => {
                if let Some(res) = step_bash_quoted_state(
                    raw, b, &mut i, state, bash, abort, heredoc, stop_kind, &mut skip_imp_bs,
                    allow_eol_cont, bufs,
                ) {
                    return res;
                }
            }
            ScanState::BashBtComment => {
                if let Some(bt_idx) = bash_find_bt_after_hash(bash.bt_depth(), raw, b, i) { *state = ScanState::Code; i = bt_idx; }
                else { if !bash_continues_bt_hash_comment(bash.bt_depth(), b) { *state = ScanState::Code; } break; }
            }
            ScanState::BlockComment | ScanState::Triple { .. } | ScanState::Backtick | ScanState::RustRaw { .. } => unreachable!(),
            ScanState::Code => {
                if let Some(ni) = step_non_bash_code_char(raw, b, i, cfg, state, tpl_stack, js_ctx, bufs.imp, bufs.code) {
                    i = ni;
                    continue;
                }
                if cfg.lang == LanguageId::Bash {
                    let is_eol_cont = allow_eol_cont
                        && b[i] == b'\\'
                        && b[i..].iter().all(|&c| c == b'\\')
                        && bash_eol_continues(b.len() - i, bash.bt_depth(), false);
                    let is_exiting_bt_bs = b[i] == b'\\' && bash.bt_depth() > 0 && {
                        let mut bs = 0usize;
                        while i + bs < b.len() && b[i + bs] == b'\\' { bs += 1; }
                        b.get(i + bs) == Some(&b'`')
                            && bash.dq.effective_bt_layer(bs, bash.bt_depth()) <= bash.bt_depth()
                    };
                    if bash.case.boundary
                        && bash.active_braces() == 0
                        && !matches!(b[i], b')' | b'}' | b';' | b'&' | b'|' | b'#')
                        && !(b[i] == b'`' && bash.bt_depth() > 0)
                        && !is_exiting_bt_bs
                        && !b[i].is_ascii_whitespace()
                        && !is_eol_cont
                    {
                        abort.mark_cmd_start(
                            bash.bt_depth(), bash.paren_depth(), bash.case.brace_grp_depth(), bash.case.in_cond(), bufs,
                        );
                    }
                    if b[i] == b'"' {
                        let cur = (bufs.imp_lines.len(), bufs.imp.len(), bufs.code.len());
                        let is_dq_sub = raw[i + 1..].starts_with("$(") || raw[i + 1..].starts_with('`');
                        if bash.active_braces() == 0 {
                            abort.on_part_open(bash.bt_depth(), bash.paren_depth(), cur, is_dq_sub, bufs);
                        } else {
                            bash.mark_code_param_quote_or_dollar();
                        }
                        abort.push_snap(SnapKind::Dq, bash.bt_depth(), bash.paren_depth(), bufs, 0);
                        bash.push_dq();
                        *state = ScanState::BashDq;
                        let bad = bash.in_bad_sub(abort);
                        bufs.imp.push(if bash.in_hd_multiline() || bad { ' ' } else { '"' });
                        bufs.code.push(if bash.in_hd_delim() || bad { ' ' } else { '"' });
                        i += 1;
                        continue;
                    }
                    if b[i] == b'\'' {
                        if bash.try_abort_bt_sq_in_param(0, abort, bufs) {
                            *state = ScanState::BashDq;
                            bufs.imp.push(' ');
                            bufs.code.push(' ');
                            i += 1;
                            continue;
                        }
                        let cur = (bufs.imp_lines.len(), bufs.imp.len(), bufs.code.len());
                        if bash.active_braces() == 0 {
                            abort.on_part_open(bash.bt_depth(), bash.paren_depth(), cur, false, bufs);
                        } else {
                            bash.mark_code_param_quote_or_dollar();
                        }
                        let ansi_c = bash.last_is_dollar();
                        bash.on_sq_start();
                        *state = ScanState::BashSq { ansi_c };
                        let bad = bash.in_bad_sub(abort);
                        bufs.imp.push(if bash.in_hd_multiline() || bad { ' ' } else { '\'' });
                        bufs.code.push(if bash.in_hd_delim() || bad { ' ' } else { '\'' });
                        i += 1;
                        continue;
                    }
                }
                if (cfg.has_slash && i + 1 < b.len() && b[i] == b'/' && b[i + 1] == b'/')
                    || (cfg.has_dash && i + 1 < b.len() && b[i] == b'-' && b[i + 1] == b'-')
                    || (cfg.has_hash
                        && b[i] == b'#'
                        && (cfg.lang != LanguageId::Bash || bash.allows_hash_comment(b, i, prev_joined)))
                {
                    if cfg.lang == LanguageId::Bash && bash.in_backtick() {
                        if let Some(bt_idx) = bash_find_bt_after_hash(bash.bt_depth(), raw, b, i + 1) {
                            i = bt_idx;
                            continue;
                        }
                        if bash_continues_bt_hash_comment(bash.bt_depth(), b) {
                            *state = ScanState::BashBtComment;
                        }
                    }
                    break;
                }
                if allow_eol_cont
                    && cfg.lang == LanguageId::Bash
                    && b[i] == b'\\'
                    && b[i..].iter().all(|&c| c == b'\\')
                    && bash_eol_continues(b.len() - i, bash.bt_depth(), false)
                {
                    return (None, Some(b.len() - i));
                }
                let pend_before = heredoc.pending.len();
                if let Some(end_idx) = crate::dep_callers_bash_delim::try_step_heredoc(
                    cfg.lang, raw, b, i, bash, heredoc, bufs.imp, bufs.code,
                ) {
                    if cfg.lang == LanguageId::Bash {
                        bash.push_pending_hd_range(abort, heredoc, pend_before, bufs.imp.len());
                    }
                    i = end_idx;
                    continue;
                }
                if (cfg.has_slash || cfg.has_dash) && i + 1 < b.len() && b[i] == b'/' && b[i + 1] == b'*' {
                    *state = ScanState::BlockComment;
                    i += 2;
                    continue;
                }
                if cfg.lang == LanguageId::Bash {
                    if raw[i..].starts_with("$((") || (raw[i..].starts_with("((") && bash.allows_arith_cmd()) {
                        bash.on_enter_arith();
                    }
                    let bad_before = bash.in_bad_sub(abort);
                    let (prev_cases, prev_conds) = (bash.case.case_depth(), bash.case.cond_depth());
                    let (was_hd, starts) = ((bash.in_hd_delim(), bash.in_hd_multiline()), (bufs.imp.len(), bufs.code.len()));
                    let step_res = bash.step_code_char(raw, b, i, abort, bufs);
                    let (cur_cases, cur_conds) = (bash.case.case_depth(), bash.case.cond_depth());
                    if cur_cases > prev_cases {
                        abort.on_enter_case(bash.bt_depth(), bash.paren_depth(), bash.case.brace_grp_depth());
                        if !bad_before && !bash.in_bad_sub(abort) && bufs.imp.ends_with("case") {
                            abort.push_case_start(bash.bt_depth(), bash.paren_depth(), bufs.imp_lines.len(), bufs.imp.len() - 4);
                        } else {
                            abort.push_case_start(usize::MAX, usize::MAX, 0, 0);
                        }
                    } else if cur_cases < prev_cases {
                        abort.sync_case_starts(cur_cases);
                        abort.sync_case_outer_bangs(cur_cases);
                    }
                    if cur_conds > prev_conds {
                        abort.on_enter_cond(bash.bt_depth(), bash.paren_depth(), bash.case.brace_grp_depth());
                    } else if cur_conds < prev_conds {
                        abort.sync_cond_outer_bangs(cur_conds);
                    }
                    if let Some((ni, to_dq, exited_delim)) = step_res {
                        let bad_after = bash.in_bad_sub(abort);
                        let mask_b = bad_after || (bad_before && !exited_delim);
                        crate::dep_callers_bash_delim::mask_bash_hd(
                            (bash.in_hd_delim() || mask_b, bash.in_hd_multiline() || mask_b),
                            (was_hd.0 || (bad_before && !exited_delim), was_hd.1 || (bad_before && !exited_delim)),
                            bufs.imp, bufs.code, starts,
                        );
                        if to_dq { *state = ScanState::BashDq; }
                        heredoc.prune_bt_above(bash.bt_depth());
                        let bd = bash.bt_depth();
                        bash.pending_hd_cols.retain(|h| h.bt_depth <= bd);
                        i = ni;
                        if let Some(k) = stop_kind && heredoc_sub_done(k, *state, bash) {
                            return (Some(i), None);
                        }
                        continue;
                    }
                }
                if cfg.is_js && b[i] == b'/' {
                    i = try_consume_js_slash(raw, b, i, cfg.is_tsx, js_ctx, bufs.imp, bufs.code);
                    continue;
                }
                if cfg.is_js {
                    i = step_js_code_token(raw, b, i, cfg.is_tsx, js_ctx, bufs.imp, bufs.code);
                    continue;
                }
                let ch = raw[i..].chars().next().unwrap();
                if cfg.lang == LanguageId::Bash {
                    let next = raw[i + ch.len_utf8()..].chars().next();
                    let is_hd_op = (bash.trail_lt == 2 && next != Some('<'))
                        || (ch == '<' && bash.trail_lt == 1 && raw[i..].starts_with("<<") && !raw[i..].starts_with("<<<"));
                    abort.on_code_char(
                        ch, next, &raw[i + ch.len_utf8()..], (is_hd_op, bash.case.in_case_pat_context()),
                        (bash.bt_depth(), bash.paren_depth(), bash.active_braces(), bash.case.brace_grp_depth()),
                        bash.case.in_cond(), bufs,
                    );
                }
                let bad = cfg.lang == LanguageId::Bash
                    && (bash.in_bad_sub(abort)
                        || ((ch.is_ascii_alphanumeric() || ch == '_')
                            && abort.is_failed_cmd_bare_word(
                                bash.bt_depth(), bash.paren_depth(), bash.active_braces(),
                                ch, &raw[i + ch.len_utf8()..],
                            )));
                let mask_ml = cfg.lang == LanguageId::Bash && (bash.in_hd_multiline() || bad);
                let mask_code = cfg.lang == LanguageId::Bash && (bash.in_hd_delim() || bad);
                for _ in 0..ch.len_utf8() {
                    if mask_ml { bufs.imp.push(' '); }
                    if mask_code { bufs.code.push(' '); }
                }
                if !mask_ml { bufs.imp.push(ch); }
                if !mask_code { bufs.code.push(ch); }
                i += ch.len_utf8();
                if let Some(k) = stop_kind && heredoc_sub_done(k, *state, bash) {
                    return (Some(i), None);
                }
            }
        }
    }
    if cfg.is_js { js_ctx.on_newline(); }
    if cfg.lang == LanguageId::Bash {
        let (prev_cases, prev_conds) = (bash.case.case_depth(), bash.case.cond_depth());
        let cur = (bufs.imp_lines.len(), bufs.imp.len(), bufs.code.len());
        if let (true, ltlt_pos) = bash.on_newline(matches!(*state, ScanState::Code), heredoc, abort, cur) {
            crate::dep_callers_bash_delim::mask_imp_from_ltlt(bufs.imp, ltlt_pos);
        }
        let (cur_cases, cur_conds) = (bash.case.case_depth(), bash.case.cond_depth());
        if cur_cases > prev_cases {
            abort.on_enter_case(bash.bt_depth(), bash.paren_depth(), bash.case.brace_grp_depth());
            if !bash.in_bad_sub(abort) && bufs.imp.ends_with("case") {
                abort.push_case_start(bash.bt_depth(), bash.paren_depth(), bufs.imp_lines.len(), bufs.imp.len() - 4);
            } else {
                abort.push_case_start(usize::MAX, usize::MAX, 0, 0);
            }
        } else if cur_cases < prev_cases {
            abort.sync_case_starts(cur_cases);
            abort.sync_case_outer_bangs(cur_cases);
        }
        if cur_conds > prev_conds {
            abort.on_enter_cond(bash.bt_depth(), bash.paren_depth(), bash.case.brace_grp_depth());
        } else if cur_conds < prev_conds {
            abort.sync_cond_outer_bangs(cur_conds);
        }
    }
    (None, None)
}
