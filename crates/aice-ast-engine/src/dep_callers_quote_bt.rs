use crate::dep_callers_bash::BashCaseTracker;
use crate::dep_callers_bash_bt::is_esc_dq_quote;
use crate::dep_callers_bash_dq::BashDqTracker;

pub(crate) enum QuoteEscDqOutcome {
    ConsumedQuote,
    OpenedBt,
    ExitBt(usize),
    ExitedDq,
    Fallthrough,
}

pub(crate) fn step_quote_esc_dq_bs(
    dq: &mut BashDqTracker,
    bc: Option<&mut BashCaseTracker>,
    bs: usize,
    ch: char,
    bt_depth: usize,
    bt_mask: u32,
) -> QuoteEscDqOutcome {
    if (dq.in_esc_dq() || dq.in_param() || dq.in_dq()) && ch == '"' {
        if is_esc_dq_quote(bs, bt_mask, bt_depth) {
            if dq.in_esc_dq() || dq.in_dq() {
                if dq.in_esc_dq() { dq.on_exit_esc_dq(); } else { dq.on_exit_dq(); }
                if !dq.in_param() {
                    if let Some(bc) = bc { bc.on_quote_end(); }
                    return QuoteEscDqOutcome::ExitedDq;
                }
            } else {
                dq.on_open_esc_dq();
            }
        }
        return QuoteEscDqOutcome::ConsumedQuote;
    }
    if ch == '`' {
        let layer = dq.effective_bt_layer(bs, bt_depth);
        if layer <= bt_depth && bt_depth > 0 {
            return QuoteEscDqOutcome::ExitBt(layer);
        }
        if (dq.in_esc_dq() || dq.in_param() || dq.in_sq() || dq.in_dq())
            && layer == bt_depth + 1
            && !dq.ansi_sq_dollar_escaped(bs, bt_depth)
        {
            let unescape_dq = dq.bt_unescape_on_enter();
            dq.on_open_esc_bt();
            if let Some(bc) = bc { bc.on_enter_bt(true, unescape_dq); }
            return QuoteEscDqOutcome::OpenedBt;
        }
        return QuoteEscDqOutcome::ConsumedQuote;
    }
    if ch == '$' {
        if dq.ansi_sq_dollar_escaped(bs, bt_depth) {
            return QuoteEscDqOutcome::ConsumedQuote;
        }
        if ((bs >> bt_depth.min(63)) >> 1) > 0 {
            dq.reset_dollar();
        }
        return QuoteEscDqOutcome::Fallthrough;
    }
    let esc = if dq.in_sq() && ch == '\'' {
        dq.in_ansi_sq() && !is_esc_dq_quote(bs, 0, bt_depth)
    } else {
        bs % 2 == 1
    };
    if esc { QuoteEscDqOutcome::ConsumedQuote } else { QuoteEscDqOutcome::Fallthrough }
}

pub(crate) enum QuoteSqOutcome {
    InQuote,
    ExitedSq,
    ExitBt(usize),
}

pub(crate) fn step_quote_bash_sq(
    bash_bs: &mut usize,
    (ansi_sq, ansi_outer_d): (bool, Option<usize>),
    bt_depth: usize,
    ch: char,
) -> QuoteSqOutcome {
    if ch == '\\' && (ansi_sq || bt_depth > 0) {
        *bash_bs += 1;
        return QuoteSqOutcome::InQuote;
    }
    let bs = std::mem::take(bash_bs);
    if ch == '`' && bt_depth > 0 {
        let layer = ansi_outer_d.map_or_else(
            || (bs + 1).trailing_zeros() as usize + 1,
            |od| crate::dep_callers_bash_dq_lex::ansi_effective_bt_layer(bs, od),
        );
        if layer <= bt_depth {
            return QuoteSqOutcome::ExitBt(layer);
        }
    }
    if ch == '\'' && (!ansi_sq || is_esc_dq_quote(bs, 0, bt_depth)) {
        return QuoteSqOutcome::ExitedSq;
    }
    QuoteSqOutcome::InQuote
}

pub(crate) fn step_quote_bash_bt_delim(
    bc: &mut BashCaseTracker,
    dq: &mut BashDqTracker,
    bt_base: usize,
    layer: usize,
) -> Option<bool> {
    let d = bt_base + bc.bt_depth();
    if d == 0 && layer == 1 {
        bc.on_enter_bt(false, false);
        dq.on_enter_bt_from_code();
        None
    } else if layer <= d && bc.bt_depth() > 0 {
        let local_layer = layer.saturating_sub(bt_base).max(1);
        if let Some((to_dq, popped)) = bc.on_exit_bt_layer(local_layer) {
            dq.on_exit_bt_layers(popped);
            Some(to_dq)
        } else {
            None
        }
    } else if layer == d + 1 {
        bc.on_enter_nested_bt(false);
        dq.on_enter_bt_from_code();
        None
    } else {
        bc.on_escape_char();
        None
    }
}

pub(crate) enum QuoteBtCodeAction { BtDelim(usize), OpenEscDq, ReturnOther, Fallthrough }

pub(crate) fn classify_quote_bash_bt_bs(
    bc: &mut BashCaseTracker,
    dq: &mut BashDqTracker,
    bs: usize,
    ch: char,
    d: usize,
    mask: u32,
) -> QuoteBtCodeAction {
    if ch == '`' {
        return QuoteBtCodeAction::BtDelim(dq.effective_bt_layer(bs, d));
    }
    if ch == '"' {
        if is_esc_dq_quote(bs, mask, d) {
            dq.on_open_esc_dq();
            bc.on_quote_start();
            return QuoteBtCodeAction::OpenEscDq;
        }
        bc.on_escape_char();
        return QuoteBtCodeAction::ReturnOther;
    }
    if ch == '$' {
        let escaped = ((bs >> d.min(63)) & 1) == 1;
        if escaped || ((bs >> d.min(63)) >> 1) > 0 { bc.on_escape_char(); }
        return if escaped { QuoteBtCodeAction::ReturnOther } else { QuoteBtCodeAction::Fallthrough };
    }
    bc.on_escape_char();
    if bs % 2 == 1 { QuoteBtCodeAction::ReturnOther } else { QuoteBtCodeAction::Fallthrough }
}
