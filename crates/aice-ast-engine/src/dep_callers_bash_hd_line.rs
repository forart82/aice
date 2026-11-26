use crate::dep_callers_bash_abort::{BashBufs, SnapKind};
use crate::dep_callers_bash_cont::{ContLineAccum, bash_eol_continues, bash_eol_surviving_bs};
use crate::dep_callers_bash_hd::{
    HdBsStep, HeredocSubKind, HeredocSubState, mask_unclosed_hd_sub, step_hd_unq_bs,
};
use crate::dep_callers_bash_strip::BashStripState;
use crate::dep_callers_heredoc::HeredocLine;
use crate::dep_callers_span::StripCfg;
use crate::dep_callers_strip::{ScanState, strip_line_bash};

pub(crate) type UnqCont = (usize, usize, (bool, bool), bool, bool, u8);

#[allow(clippy::too_many_arguments)]
pub(crate) fn step_heredoc_unquoted_line(
    work: &str,
    cfg: &StripCfg,
    hd_sub: &mut Option<HeredocSubState>,
    acc: &mut ContLineAccum,
    skip_imp_bs: usize,
    hd_sub_line: &mut Option<(usize, usize, usize)>,
    cur_line_idx: usize,
    bt_ctx: (usize, u32),
    allow_eol_cont: bool,
    hd_param_aborted: &mut bool,
    out: (&mut Vec<String>, &mut Vec<String>),
) -> Option<UnqCont> {
    let (bt_depth, bt_mask) = bt_ctx;
    let b = work.as_bytes();
    let mut i = 0usize;
    let mut skip_bs = skip_imp_bs;
    let mut trail_dollar = false;
    if let Some(sub) = hd_sub.as_mut()
        && (acc.cont_slots == 0 || !sub.heredoc.active.is_empty())
        && matches!(sub.state, ScanState::Code)
    {
        if acc.cont_slots > 0 { sub.heredoc.clear_cont_carry(); }
        let n_bt = sub.heredoc.active.first().map_or((0, 0), |h| (h.bt_depth, h.bt_mask));
        match sub.heredoc.step_bash_line_bt_outer(work, allow_eol_cont.then_some(bt_depth)) {
            (HeredocLine::DelimiterOrQuoted, None) => {
                mask_unclosed_hd_sub(&mut sub.nested, &mut sub.nested_ln, out.0, out.1, Some(acc));
                if allow_eol_cont && !sub.heredoc.active.is_empty() {
                    let bs = b.iter().rev().take_while(|&&c| c == b'\\').count();
                    if bash_eol_continues(bs, bt_depth, false) { return Some((bs, bt_depth, (false, false), true, false, 0)); }
                }
                return None;
            }
            (HeredocLine::DelimiterOrQuoted, Some(j)) => {
                mask_unclosed_hd_sub(&mut sub.nested, &mut sub.nested_ln, out.0, out.1, Some(acc));
                for _ in 0..j { acc.cur_imp.push(' '); acc.cur_code.push(' '); }
                i = j;
            }
            (HeredocLine::UnquotedBody, bt_cut) => {
                let mut nested = sub.nested.take().map(|n| *n);
                let slice = bt_cut.map_or(work, |j| &work[..j]);
                let mut nested_aborted = false;
                let res = step_heredoc_unquoted_line(
                    slice, cfg, &mut nested, acc, skip_bs, &mut sub.nested_ln, cur_line_idx,
                    n_bt, allow_eol_cont && bt_cut.is_none(), &mut nested_aborted, (out.0, out.1),
                );
                if let Some(j) = bt_cut {
                    mask_unclosed_hd_sub(&mut nested, &mut sub.nested_ln, out.0, out.1, Some(acc));
                    i = j;
                    skip_bs = 0;
                } else {
                    sub.nested = nested.map(Box::new);
                    return res;
                }
            }
            (HeredocLine::NotActive, _) => {}
        }
    }
    while i < b.len() {
        if let Some(sub) = hd_sub.as_mut() {
            let prev_joined = acc.prev_joined();
            let (stopped_at, eol_bs) = {
                let mut bufs = BashBufs {
                    imp_lines: out.0,
                    code_lines: out.1,
                    imp: &mut acc.cur_imp,
                    code: &mut acc.cur_code,
                };
                strip_line_bash(
                    work, i, cfg, &mut sub.state, &mut sub.bash, &mut sub.abort, &mut sub.heredoc,
                    prev_joined, Some(sub.kind), std::mem::take(&mut skip_bs),
                    allow_eol_cont, &mut bufs,
                )
            };
            if sub.kind == HeredocSubKind::Param {
                let closed_bad = stopped_at.is_some() && sub.bash.dq.take_closed_param_bad();
                if closed_bad
                    || (sub.bash.dq.in_bad_sub() && sub.bash.local_bt_depth() == 0 && sub.bash.paren_depth() == 0)
                {
                    *hd_param_aborted = true;
                }
            }
            if let Some(bs) = eol_bs {
                let in_code = matches!(sub.state, ScanState::Code);
                let in_sq = matches!(sub.state, ScanState::BashSq { .. });
                if !sub.bash.in_hd_multiline() && let Some((snap, ip, cp)) = sub.bash.take_hd_snap()
                    && acc.on_cont_hd(bs, sub.bash.bt_depth(), in_sq, ip, cp)
                {
                    sub.bash = snap;
                    sub.state = ScanState::Code;
                    return Some((bs, 0, (false, false), true, false, 9));
                }
                let (td, tlt) = sub.bash.trail_state(bs, in_code);
                if !in_code && tlt == 7 { sub.state = ScanState::Code; }
                return Some((bs, sub.bash.bt_depth(), (matches!(sub.state, ScanState::BashDq), sub.bash.dq.in_ansi_sq()), in_code, td, tlt));
            }
            if let Some(ni) = stopped_at {
                *hd_sub = None;
                *hd_sub_line = None;
                i = ni;
            } else {
                if matches!(sub.state, ScanState::Code) { sub.heredoc.flush_pending(); }
                break;
            }
        } else if b[i] == b'\\' && b[i..].iter().all(|&c| c == b'\\') {
            let bs = b.len() - i;
            if allow_eol_cont && bash_eol_continues(bs, bt_depth, false) {
                if bash_eol_surviving_bs(bs, bt_depth, false) == 0 && trail_dollar && acc.cur_imp.ends_with(' ') {
                    acc.cur_imp.pop(); acc.cur_imp.push('$');
                    acc.cur_code.pop(); acc.cur_code.push('$');
                }
                return Some((bs, bt_depth, (false, false), true, trail_dollar, 0));
            }
            for _ in 0..bs { acc.cur_imp.push(' '); acc.cur_code.push(' '); }
            break;
        } else if b[i] == b'\\' {
            let mut bs = 0usize;
            while i + bs < b.len() && b[i + bs] == b'\\' { bs += 1; }
            match step_hd_unq_bs(b, i, bs, bt_depth, &mut trail_dollar, acc) {
                HdBsStep::Advance(ni) => i = ni,
                HdBsStep::OpenBt(after) => {
                    *hd_sub_line = Some((cur_line_idx, acc.cur_imp.len(), acc.cur_code.len()));
                    acc.cur_imp.push_str(&work[i..after + 1]);
                    acc.cur_code.push_str(&work[i..after + 1]);
                    let bash = BashStripState::new_heredoc_in_bt(1, bt_depth, bt_mask);
                    *hd_sub = Some(HeredocSubState::new(HeredocSubKind::Bt, bash, ScanState::Code));
                    i = after + 1;
                }
            }
        } else if b[i] == b'$' && trail_dollar {
            trail_dollar = false;
            acc.cur_imp.push(' ');
            acc.cur_code.push(' ');
            i += 1;
        } else if work[i..].starts_with("$$") {
            trail_dollar = false;
            acc.cur_imp.push_str("  ");
            acc.cur_code.push_str("  ");
            i += 2;
        } else if work[i..].starts_with("${") {
            trail_dollar = false;
            *hd_sub_line = Some((cur_line_idx, acc.cur_imp.len(), acc.cur_code.len()));
            acc.cur_imp.push_str("${");
            acc.cur_code.push_str("  ");
            let bash = BashStripState::new_heredoc_in_bt(0, bt_depth, bt_mask);
            let mut sub = HeredocSubState::new(HeredocSubKind::Param, bash, ScanState::BashDq);
            let bufs = BashBufs {
                imp_lines: out.0, code_lines: out.1, imp: &mut acc.cur_imp, code: &mut acc.cur_code,
            };
            sub.abort.push_snap(SnapKind::Param, bt_depth, 0, &bufs, 2);
            *hd_sub = Some(sub);
            i += 2;
        } else if work[i..].starts_with("$(") {
            trail_dollar = false;
            let is_arith = work[i..].starts_with("$((");
            let mut bash = BashStripState::new_heredoc_in_bt(2, bt_depth, bt_mask);
            if is_arith {
                bash.on_enter_arith_at(0);
            }
            *hd_sub_line = Some((cur_line_idx, acc.cur_imp.len(), acc.cur_code.len()));
            acc.cur_imp.push_str("$(");
            acc.cur_code.push_str("$(");
            *hd_sub = Some(HeredocSubState::new(HeredocSubKind::Sub, bash, ScanState::Code));
            i += 2;
        } else if b[i] == b'`' {
            trail_dollar = false;
            *hd_sub_line = Some((cur_line_idx, acc.cur_imp.len(), acc.cur_code.len()));
            acc.cur_imp.push('`');
            acc.cur_code.push('`');
            let bash = BashStripState::new_heredoc_in_bt(1, bt_depth, bt_mask);
            *hd_sub = Some(HeredocSubState::new(HeredocSubKind::Bt, bash, ScanState::Code));
            i += 1;
        } else {
            let ch = work[i..].chars().next().unwrap();
            trail_dollar = ch == '$' && !trail_dollar;
            for _ in 0..ch.len_utf8() {
                acc.cur_imp.push(' ');
                acc.cur_code.push(' ');
            }
            i += ch.len_utf8();
        }
    }
    None
}
