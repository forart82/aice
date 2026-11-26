use crate::dep_callers_bash_dq::{BashDqAction, BashDqFrame, BashDqTracker};
use crate::dep_callers_bash_param::ParamHdr;

impl BashDqTracker {
    pub(crate) fn step_dq(&mut self, ch: char, next: Option<char>) -> BashDqAction {
        let was_dollar = std::mem::replace(&mut self.prev_dollar, false);
        let top = self.frames.last().copied();
        if was_dollar && !matches!(top, Some(BashDqFrame::Bt)) {
            if ch == '$' {
                self.mark_param_quote_or_dollar();
                return BashDqAction::Stay;
            }
            if ch == '(' {
                self.mark_param_quote_or_dollar();
                self.frames.push(BashDqFrame::Sub);
                return BashDqAction::EnterSub;
            }
            if ch == '{' && !matches!(top, Some(BashDqFrame::SqInParam(_))) {
                self.mark_param_quote_or_dollar();
                self.frames.push(BashDqFrame::Param(ParamHdr::Init));
                return BashDqAction::EnterParam;
            }
        }
        let act = match top {
            Some(BashDqFrame::SqInParam(_)) => {
                if ch == '\'' {
                    self.frames.pop();
                    BashDqAction::Stay
                } else if ch == '$' && next == Some('(') {
                    self.frames.push(BashDqFrame::Sub);
                    BashDqAction::EnterSub
                } else if ch == '`' {
                    self.bt_marks.push(self.frames.len());
                    self.frames.push(BashDqFrame::Bt);
                    BashDqAction::EnterBt
                } else {
                    BashDqAction::Stay
                }
            }
            Some(BashDqFrame::EscDq) => {
                if ch == '$' && next == Some('(') {
                    self.frames.push(BashDqFrame::Sub);
                    BashDqAction::EnterSub
                } else if ch == '$' && next == Some('{') {
                    self.frames.push(BashDqFrame::Param(ParamHdr::Init));
                    BashDqAction::EnterParam
                } else if ch == '"' {
                    self.frames.pop();
                    if matches!(self.frames.last(), Some(BashDqFrame::Param(_))) {
                        BashDqAction::Stay
                    } else {
                        BashDqAction::ExitDq
                    }
                } else {
                    BashDqAction::Stay
                }
            }
            Some(BashDqFrame::Bt) => {
                if ch == '`' {
                    self.frames.pop();
                }
                BashDqAction::Stay
            }
            Some(BashDqFrame::Param(_)) => {
                if ch == '$' && next == Some('(') {
                    self.mark_param_quote_or_dollar();
                    self.frames.push(BashDqFrame::Sub);
                    BashDqAction::EnterSub
                } else if ch == '$' && next == Some('{') {
                    self.mark_param_quote_or_dollar();
                    self.frames.push(BashDqFrame::Param(ParamHdr::Init));
                    BashDqAction::EnterParam
                } else if ch == '`' {
                    self.mark_param_quote_or_dollar();
                    self.bt_marks.push(self.frames.len());
                    self.frames.push(BashDqFrame::Bt);
                    BashDqAction::EnterBt
                } else if ch == '\'' {
                    self.mark_param_quote_or_dollar();
                    let hd_param_top = self.in_heredoc_param
                        && !self.frames.iter().any(|f| matches!(f, BashDqFrame::Sub | BashDqFrame::Bt));
                    self.frames
                        .push(BashDqFrame::SqInParam(was_dollar && !hd_param_top));
                    BashDqAction::Stay
                } else if ch == '}' {
                    let valid = matches!(self.frames.pop(), Some(BashDqFrame::Param(h)) if h.is_valid_end());
                    if !valid {
                        self.last_closed_param_bad = true;
                        self.trigger_bad_sub_on_enclosing_dq();
                    }
                    BashDqAction::Stay
                } else if ch == '"' {
                    self.mark_param_quote_or_dollar();
                    self.frames.push(BashDqFrame::Dq);
                    BashDqAction::Stay
                } else {
                    self.mark_param_char(ch);
                    BashDqAction::Stay
                }
            }
            _ => {
                if ch == '$' && next == Some('(') {
                    self.frames.push(BashDqFrame::Sub);
                    BashDqAction::EnterSub
                } else if ch == '$' && next == Some('{') {
                    self.frames.push(BashDqFrame::Param(ParamHdr::Init));
                    BashDqAction::EnterParam
                } else if ch == '`' {
                    self.bt_marks.push(self.frames.len());
                    self.frames.push(BashDqFrame::Bt);
                    BashDqAction::EnterBt
                } else if ch == '"' {
                    if matches!(self.frames.last(), Some(BashDqFrame::Dq)) {
                        self.frames.pop();
                    }
                    if matches!(self.frames.last(), Some(BashDqFrame::Param(_))) {
                        BashDqAction::Stay
                    } else {
                        BashDqAction::ExitDq
                    }
                } else {
                    BashDqAction::Stay
                }
            }
        };
        if matches!(act, BashDqAction::Stay) && ch == '$' && !matches!(top, Some(BashDqFrame::Bt)) {
            self.prev_dollar = true;
        }
        self.clear_bad_sub_if_exited();
        act
    }

    pub(crate) fn ansi_sq_bt_ctx(&self, total_d: usize) -> Option<(usize, usize)> {
        let idx_sq = self.frames.iter().rposition(|f| matches!(f, BashDqFrame::SqInParam(true)))?;
        let inner_bts = self.bt_marks.iter().filter(|&&m| m > idx_sq).count();
        Some((total_d.saturating_sub(inner_bts), inner_bts))
    }

    pub(crate) fn effective_bt_layer(&self, bs: usize, d: usize) -> usize {
        if let Some((outer_d, _)) = self.ansi_sq_bt_ctx(d) {
            return ansi_effective_bt_layer(bs, outer_d);
        }
        (bs + 1).trailing_zeros() as usize + 1
    }

    pub(crate) fn ansi_sq_dollar_escaped(&self, bs: usize, d: usize) -> bool {
        if let Some((outer_d, inner_bts)) = self.ansi_sq_bt_ctx(d) {
            let rem = bs >> outer_d.min(63);
            return ((rem.div_ceil(2) >> inner_bts.min(63)) & 1) == 1;
        }
        crate::dep_callers_bash_bt::ansi_sq_dollar_or_bt_escaped(bs, d, self.in_ansi_sq())
    }

    pub(crate) fn bt_in_sq_in_param(&self) -> Option<(usize, bool, usize)> {
        let idx_sq = self.frames.iter().rposition(|f| matches!(f, BashDqFrame::SqInParam(_)))?;
        if self.frames[idx_sq + 1..].iter().any(|f| matches!(f, BashDqFrame::Sub)) {
            return None;
        }
        let inner_bts = self.bt_marks.iter().filter(|&&m| m > idx_sq).count();
        (inner_bts > 0).then(|| (idx_sq, matches!(self.frames[idx_sq], BashDqFrame::SqInParam(true)), inner_bts))
    }

    pub(crate) fn abort_bt_to_sq_in_param(&mut self, idx_sq: usize, inner_bts: usize) {
        self.prev_dollar = false;
        self.last_exit_dropped_q = false;
        for _ in 0..inner_bts { self.bt_marks.pop(); }
        self.frames.truncate(idx_sq);
        self.trigger_bad_sub_on_enclosing_dq();
    }
}

pub(crate) fn ansi_effective_bt_layer(bs: usize, outer_d: usize) -> usize {
    let raw_layer = (bs + 1).trailing_zeros() as usize + 1;
    if raw_layer > outer_d {
        let m = (bs >> outer_d.min(63)).div_ceil(2);
        return outer_d + (m + 1).trailing_zeros() as usize + 1;
    }
    raw_layer
}

pub(crate) fn dq_ansi_close_escapes_brace(
    b: &[u8],
    after_sq: usize,
    (d, mask): (usize, u32),
    mut need: usize,
) -> bool {
    if after_sq >= b.len() || b[after_sq] != b'}' || need == 0 {
        return false;
    }
    let mut j = after_sq + 1;
    while j < b.len() {
        if b[j] == b'\\' {
            let mut bs = 0usize;
            while j + bs < b.len() && b[j + bs] == b'\\' {
                bs += 1;
            }
            if j + bs == b.len() {
                return false;
            }
            if b[j + bs] == b'"' && crate::dep_callers_bash_bt::is_esc_dq_quote(bs, mask, d) {
                return need > 0;
            }
            if b[j + bs] == b'}' && crate::dep_callers_bash_bt::is_esc_dq_quote(bs, 0, d) {
                need = need.saturating_sub(1);
                if need == 0 {
                    return false;
                }
                j += bs + 1;
                continue;
            }
            j += bs + usize::from(bs % 2 == 1 && b[j + bs] < 0x80);
        } else if b[j] == b'"' {
            if crate::dep_callers_bash_bt::is_esc_dq_quote(0, mask, d) {
                return need > 0;
            }
            j += 1;
        } else if b[j] == b'}' {
            need = need.saturating_sub(1);
            if need == 0 {
                return false;
            }
            j += 1;
        } else {
            j += 1;
        }
    }
    false
}
