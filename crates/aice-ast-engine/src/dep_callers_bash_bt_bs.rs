use crate::dep_callers_bash::BashCaseTracker;
use crate::dep_callers_bash_dq::BashDqTracker;

pub(crate) fn ansi_sq_bs_rem(bs: usize, depth: usize) -> usize {
    let mut rem = bs;
    for _ in 0..depth.min(32) {
        rem = rem.div_ceil(2);
    }
    rem
}

pub(crate) fn ansi_sq_dollar_or_bt_escaped(bs: usize, depth: usize, in_ansi_sq: bool) -> bool {
    let rem = bs >> depth.min(63);
    if in_ansi_sq {
        matches!(rem % 4, 1 | 2)
    } else {
        (rem & 1) == 1
    }
}

pub(crate) fn is_esc_dq_quote(bs: usize, mask: u32, depth: usize) -> bool {
    let mut rem = bs;
    for bit in 0..depth.min(32) {
        rem = if (mask >> bit) & 1 == 1 {
            rem / 2
        } else {
            rem.div_ceil(2)
        };
    }
    rem.is_multiple_of(2)
}

pub(crate) enum EscDqBsAction {
    ExitEscDq(usize),
    OpenEscBt(usize),
    ExitBt { take: usize, to_dq: bool, dropped_q: bool },
    Mask(usize),
}

pub(crate) fn classify_esc_dq_bs(
    dq: &mut BashDqTracker,
    case: &mut BashCaseTracker,
    bt_ctx: (usize, u32),
    raw: &str,
    i: usize,
    bs: usize,
) -> EscDqBsAction {
    let b = raw.as_bytes();
    let (bt_base, bt_mask_base) = bt_ctx;
    let d = bt_base + case.bt_depth();
    if (dq.in_esc_dq() || dq.in_param() || dq.in_dq()) && i + bs < b.len() && b[i + bs] == b'"' {
        if is_esc_dq_quote(bs, case.bt_unescape_mask(bt_mask_base, bt_base), d) {
            if dq.in_esc_dq() || dq.in_dq() {
                if dq.in_esc_dq() {
                    dq.on_exit_esc_dq();
                } else {
                    dq.on_exit_dq();
                }
                if !dq.in_param() {
                    case.on_quote_end();
                    return EscDqBsAction::ExitEscDq(bs + 1);
                }
            } else {
                dq.mark_param_quote_or_dollar();
                dq.on_open_esc_dq();
            }
        }
        return EscDqBsAction::Mask(bs + 1);
    }
    if i + bs < b.len() && b[i + bs] == b'`' {
        let layer = dq.effective_bt_layer(bs, d);
        if layer <= d && case.bt_depth() > 0 {
            let local_layer = layer.saturating_sub(bt_base).max(1);
            let (to_dq, popped) = case.on_exit_bt_layer(local_layer).unwrap_or((false, 0));
            let dropped_q = dq.on_exit_bt_layers(popped);
            return EscDqBsAction::ExitBt { take: bs + 1, to_dq, dropped_q };
        }
        if (dq.in_esc_dq() || dq.in_param() || dq.in_sq() || dq.in_dq())
            && layer == d + 1
            && !dq.ansi_sq_dollar_escaped(bs, d)
        {
            dq.mark_param_quote_or_dollar();
            let unescape_dq = dq.bt_unescape_on_enter();
            dq.on_open_esc_bt();
            case.on_enter_bt(true, unescape_dq);
            return EscDqBsAction::OpenEscBt(bs + 1);
        }
        if layer > d {
            return EscDqBsAction::Mask(bs + 1);
        }
    }
    if i + bs < b.len() && (b[i + bs] == b'$' || (dq.in_sq() && b[i + bs] == b'`')) {
        let esc = dq.ansi_sq_dollar_escaped(bs, d);
        if bs > 0 && b[i + bs] == b'$' {
            dq.mark_param_backslash();
        }
        return EscDqBsAction::Mask(if esc { bs + 1 } else { bs });
    }
    if dq.in_sq() && i + bs < b.len() && b[i + bs] == b'\'' {
        let take = if dq.in_ansi_sq() {
            let rem = ansi_sq_bs_rem(bs, d);
            if rem % 2 == 1 {
                dq.on_ansi_sq_esc_sq(rem);
                bs + 1
            } else {
                if rem % 4 == 2
                    && crate::dep_callers_bash_dq_lex::dq_ansi_close_escapes_brace(
                        b,
                        i + bs + 1,
                        (d, case.bt_unescape_mask(bt_mask_base, bt_base)),
                        dq.param_depth(),
                    )
                {
                    dq.trigger_bad_sub_on_enclosing_dq();
                }
                bs
            }
        } else {
            bs
        };
        return EscDqBsAction::Mask(take);
    }
    let take = if i + bs < b.len() && bs % 2 == 1 {
        bs + raw[i + bs..].chars().next().unwrap().len_utf8()
    } else {
        bs
    };
    EscDqBsAction::Mask(take)
}
