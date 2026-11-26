use crate::dep_callers_bash_abort::{BashAbortState, BashBufs, SnapKind};
use crate::dep_callers_bash_cont::ContLineAccum;
use crate::dep_callers_bash_hd::{is_hd_delim_lt, next_lt_after_bt_bs};
use crate::dep_callers_bash_strip::BashStripState;

pub(crate) fn keep_bt_dollar(b: &[u8], after: usize, bs: usize, d: usize) -> bool {
    after < b.len() && b[after] == b'$' && ((bs >> d.min(63)) & 1) == 0 && ((bs >> d.min(63)) >> 1) == 0
}

pub(crate) fn step_code_backslash(
    bash: &mut BashStripState,
    abort: &mut BashAbortState,
    raw: &str,
    b: &[u8],
    i: usize,
    bufs: &mut BashBufs<'_>,
) -> (usize, bool, bool) {
    if !bash.in_backtick() {
        let next_lt = if is_hd_delim_lt(bash.trail_lt) {
            if bash.trail_lt == 8 { 8 } else { 7 }
        } else {
            0
        };
        if next_lt != 0 {
            bash.hd_quoted = true;
        }
        (bash.trail_dollar, bash.trail_lt) = (false, next_lt);
        let nch = raw[i + 1..].chars().next().unwrap();
        if bash.active_braces() == 0 {
            let cur = (bufs.imp_lines.len(), bufs.imp.len(), bufs.code.len());
            abort.on_part_open(bash.bt_depth(), bash.paren_depth(), cur, false, bufs);
        } else if nch != '\n' {
            bash.mark_code_param_backslash();
        }
        bash.case.on_escape_char();
        if next_lt == 0 && (nch.is_ascii_alphanumeric() || nch == '_') {
            bufs.imp.push(nch);
            bufs.code.push(nch);
        } else {
            bufs.imp.push('\\');
            bufs.imp.push(nch);
            bufs.code.push('\\');
            bufs.code.push(nch);
        }
        return (i + 1 + nch.len_utf8(), false, false);
    }
    let mut bs = 0usize;
    while i + bs < b.len() && b[i + bs] == b'\\' {
        bs += 1;
    }
    let (after, prev_lt) = (i + bs, bash.trail_lt);
    let d = bash.bt_depth();
    if keep_bt_dollar(b, after, bs, d) {
        bash.trail_lt = 0;
    } else {
        (bash.trail_dollar, bash.trail_lt) = (false, 0);
    }
    if after < b.len() && b[after] == b'`' {
        let layer = bash.dq.effective_bt_layer(bs, d);
        if is_hd_delim_lt(prev_lt) && bash.hd_sub.is_none() && layer == d + 1 {
            let sq = if prev_lt == 8 { 8 } else { 7 };
            bash.hd_sub = Some((bash.paren_depth(), bash.active_braces(), sq));
        }
        let exiting = layer <= d && bash.case.bt_depth() > 0;
        let ga = crate::dep_callers_bash_mask::is_glued_after_byte(b.get(after + 1));
        let to_dq = bash.step_bt_delim(layer, abort, bufs, (false, ga));
        let dropped_q = bash.dq.take_dropped_q();
        if exiting && dropped_q {
            let fill = if abort.last_bt_glued_assign() { 'x' } else { ' ' };
            for _ in 0..(after + 1 - i) { bufs.imp.push(fill); bufs.code.push(fill); }
        } else {
            bufs.imp.push_str(&raw[i..after + 1]);
            bufs.code.push_str(&raw[i..after + 1]);
        }
        if layer == d + 1 {
            abort.push_snap(SnapKind::Bt, bash.bt_depth(), bash.paren_depth(), bufs, after + 1 - i);
        }
        return (after + 1, to_dq, exiting);
    }
    if after < b.len() && b[after] == b'\''
        && bash.try_abort_bt_sq_in_param(bs, abort, bufs)
    {
        for _ in 0..=bs { bufs.imp.push(' '); bufs.code.push(' '); }
        return (after + 1, true, true);
    }
    if after < b.len() && b[after] == b'"' {
        let mask = bash.bt_unescape_mask();
        if crate::dep_callers_bash_bt::is_esc_dq_quote(bs, mask, d) {
            if bash.active_braces() > 0 { bash.mark_code_param_quote_or_dollar(); }
            abort.push_snap(SnapKind::Dq, bash.bt_depth(), bash.paren_depth(), bufs, 0);
            bash.hd_q = if bash.hd_sub.is_none() && is_hd_delim_lt(prev_lt) {
                bash.hd_quoted = true;
                if prev_lt == 8 { 6 } else { 3 }
            } else { 0 };
            bash.dq.on_open_esc_dq();
            bash.case.on_quote_start();
            bufs.imp.push_str(&raw[i..after + 1]);
            bufs.code.push_str(&raw[i..after + 1]);
            return (after + 1, true, false);
        }
        if is_hd_delim_lt(prev_lt) {
            bash.trail_lt = if prev_lt == 8 { 8 } else { 7 };
            bash.hd_quoted = true;
        }
        bash.case.on_escape_char();
        if bash.active_braces() > 0 { bash.mark_code_param_backslash(); }
        bufs.imp.push_str(&raw[i..after + 1]);
        bufs.code.push_str(&raw[i..after + 1]);
        return (after + 1, false, false);
    }
    bash.trail_lt = next_lt_after_bt_bs(prev_lt, b, after);
    if bash.trail_lt != 0 {
        bash.hd_quoted = true;
    }
    let mask = bash.bt_unescape_mask();
    let (next_i, esc_ch, to_dq) = step_bt_code_bs(raw, b, i, bs, (d, mask, is_hd_delim_lt(prev_lt)), bufs.imp, bufs.code);
    if esc_ch {
        bash.case.on_escape_char();
        if bash.active_braces() > 0 && !(after < b.len() && b[after] == b'\n') {
            bash.mark_code_param_backslash();
        }
    }
    (next_i, to_dq, false)
}

pub(crate) enum HdBsStep {
    Advance(usize),
    OpenBt(usize),
}

pub(crate) fn step_hd_unq_bs(
    b: &[u8],
    i: usize,
    bs: usize,
    bt_depth: usize,
    trail_dollar: &mut bool,
    acc: &mut ContLineAccum,
) -> HdBsStep {
    let after = i + bs;
    if b[after] == b'$' {
        if ((bs >> bt_depth.min(63)) & 1) == 1 {
            *trail_dollar = false;
            for _ in 0..=bs { acc.cur_imp.push(' '); acc.cur_code.push(' '); }
            HdBsStep::Advance(after + 1)
        } else {
            if ((bs >> bt_depth.min(63)) >> 1) > 0 {
                *trail_dollar = false;
            }
            for _ in 0..bs { acc.cur_imp.push(' '); acc.cur_code.push(' '); }
            HdBsStep::Advance(after)
        }
    } else if b[after] == b'`' {
        *trail_dollar = false;
        let layer = (bs + 1).trailing_zeros() as usize + 1;
        if layer == bt_depth + 1 {
            HdBsStep::OpenBt(after)
        } else {
            for _ in 0..=bs { acc.cur_imp.push(' '); acc.cur_code.push(' '); }
            HdBsStep::Advance(after + 1)
        }
    } else {
        *trail_dollar = false;
        for _ in 0..bs { acc.cur_imp.push(' '); acc.cur_code.push(' '); }
        HdBsStep::Advance(after)
    }
}

pub(crate) fn step_bt_code_bs(
    raw: &str,
    b: &[u8],
    i: usize,
    bs: usize,
    bt_ctx: (usize, u32, bool),
    imp: &mut String,
    code: &mut String,
) -> (usize, bool, bool) {
    let (d, mask, in_hd_delim) = bt_ctx;
    let after = i + bs;
    if after == b.len() {
        imp.push_str(&raw[i..after]);
        code.push_str(&raw[i..after]);
        return (after, bs % 2 == 1, false);
    }
    if b[after] == b'$' {
        let escaped = ((bs >> d.min(63)) & 1) == 1;
        let surv_bs = (bs >> d.min(63)) >> 1;
        let take = if escaped { after + 1 } else { after };
        imp.push_str(&raw[i..take]);
        code.push_str(&raw[i..take]);
        return (take, escaped || surv_bs > 0, false);
    }
    if b[after] == b'\'' {
        let take = if crate::dep_callers_bash_bt::is_esc_dq_quote(bs, 0, d) { after } else { after + 1 };
        imp.push_str(&raw[i..take]);
        code.push_str(&raw[i..take]);
        return (take, true, false);
    }
    if !in_hd_delim && (b[after].is_ascii_alphanumeric() || b[after] == b'_') {
        let inner_bs = (0..d).fold(bs, |acc, _| acc.div_ceil(2));
        if inner_bs % 2 == 1 {
            let nch = b[after] as char;
            for _ in 0..(inner_bs / 2) { imp.push('\\'); code.push('\\'); }
            imp.push(nch);
            code.push(nch);
            return (after + 1, true, false);
        }
    }
    if bs % 2 == 1 || (b[after] == b'<' && !crate::dep_callers_bash_bt::is_esc_dq_quote(bs, mask, d)) {
        let nch = raw[after..].chars().next().unwrap();
        imp.push_str(&raw[i..after + nch.len_utf8()]);
        code.push_str(&raw[i..after + nch.len_utf8()]);
        return (after + nch.len_utf8(), true, false);
    }
    imp.push_str(&raw[i..after]);
    code.push_str(&raw[i..after]);
    (after, true, false)
}
