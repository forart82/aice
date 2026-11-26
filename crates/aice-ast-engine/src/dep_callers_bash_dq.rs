use crate::dep_callers_bash_param::ParamHdr;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum BashDqFrame {
    Dq,
    Param(ParamHdr),
    Bt,
    SqInParam(bool),
    Sub,
    EscDq,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum BashDqAction {
    Stay,
    EnterSub,
    EnterBt,
    EnterParam,
    ExitDq,
}

#[derive(Clone)]
pub(crate) struct BashDqTracker {
    pub(super) frames: Vec<BashDqFrame>,
    pub(super) bt_marks: Vec<usize>,
    pub(super) prev_dollar: bool,
    bad_sub_dq_len: Option<usize>,
    pub(super) in_heredoc_param: bool,
    pub(super) last_exit_dropped_q: bool,
    pub(super) last_closed_param_bad: bool,
}

impl BashDqTracker {
    pub(crate) fn new() -> Self {
        Self {
            frames: Vec::new(),
            bt_marks: Vec::new(),
            prev_dollar: false,
            bad_sub_dq_len: None,
            in_heredoc_param: false,
            last_exit_dropped_q: false,
            last_closed_param_bad: false,
        }
    }

    pub(crate) fn take_closed_param_bad(&mut self) -> bool {
        std::mem::take(&mut self.last_closed_param_bad)
    }

    pub(crate) fn set_heredoc_param(&mut self, v: bool) {
        self.in_heredoc_param = v;
    }

    pub(crate) fn in_bad_sub(&self) -> bool {
        self.bad_sub_dq_len.is_some()
    }

    pub(crate) fn take_dropped_q(&mut self) -> bool {
        std::mem::take(&mut self.last_exit_dropped_q)
    }

    pub(crate) fn trigger_bad_sub_on_enclosing_dq(&mut self) {
        if self.bad_sub_dq_len.is_none() {
            let mut found = None;
            for (idx, &f) in self.frames.iter().enumerate().rev() {
                if matches!(f, BashDqFrame::Sub | BashDqFrame::Bt) {
                    break;
                }
                if matches!(f, BashDqFrame::Dq | BashDqFrame::EscDq) {
                    found = Some(idx + 1);
                }
            }
            self.bad_sub_dq_len = found;
        }
    }

    pub(crate) fn on_ansi_sq_esc_sq(&mut self, rem: usize) {
        if self.in_ansi_sq() && rem % 4 == 1 {
            self.trigger_bad_sub_on_enclosing_dq();
        }
    }

    pub(super) fn clear_bad_sub_if_exited(&mut self) {
        if self.bad_sub_dq_len.is_some_and(|d| self.frames.len() < d) {
            self.bad_sub_dq_len = None;
        }
    }

    pub(crate) fn reset_dollar(&mut self) {
        self.prev_dollar = false;
    }

    pub(crate) fn prev_dollar(&self) -> bool {
        self.prev_dollar
    }

    pub(crate) fn in_sq(&self) -> bool {
        matches!(self.frames.last(), Some(BashDqFrame::SqInParam(_)))
    }

    pub(crate) fn has_sq(&self) -> bool {
        self.frames.iter().any(|f| matches!(f, BashDqFrame::SqInParam(_)))
    }

    pub(crate) fn in_ansi_sq(&self) -> bool {
        matches!(self.frames.last(), Some(BashDqFrame::SqInParam(true)))
    }

    pub(crate) fn in_esc_dq(&self) -> bool {
        matches!(self.frames.last(), Some(BashDqFrame::EscDq))
    }

    pub(crate) fn in_param(&self) -> bool {
        matches!(self.frames.last(), Some(BashDqFrame::Param(_)))
    }

    pub(crate) fn mark_param_backslash(&mut self) {
        if let Some(BashDqFrame::Param(hdr)) = self.frames.last_mut() {
            hdr.on_backslash();
        }
    }

    pub(crate) fn mark_param_quote_or_dollar(&mut self) {
        if let Some(BashDqFrame::Param(hdr)) = self.frames.last_mut() {
            hdr.on_quote_or_dollar_open();
        }
    }

    pub(crate) fn mark_param_char(&mut self, ch: char) {
        if let Some(BashDqFrame::Param(hdr)) = self.frames.last_mut() {
            hdr.step_char(ch);
        }
    }

    pub(crate) fn param_depth(&self) -> usize {
        self.frames.iter().filter(|f| matches!(f, BashDqFrame::Param(_))).count()
    }

    pub(crate) fn in_dq(&self) -> bool {
        matches!(self.frames.last(), Some(BashDqFrame::Dq))
    }

    pub(crate) fn bt_unescape_on_enter(&self) -> bool {
        matches!(self.frames.last(), Some(BashDqFrame::EscDq | BashDqFrame::Dq))
            && !matches!(
                self.frames.get(self.frames.len().wrapping_sub(2)),
                Some(BashDqFrame::Param(_))
            )
    }

    pub(crate) fn last_bt_unescapes(&self) -> bool {
        self.frames.len() >= 2
            && self.frames[self.frames.len() - 2] == BashDqFrame::Dq
            && !matches!(
                self.frames.get(self.frames.len().wrapping_sub(3)),
                Some(BashDqFrame::Param(_))
            )
    }

    pub(crate) fn in_esc_dq_context(&self, base: usize) -> bool {
        base > 0
            || self
                .frames
                .iter()
                .any(|f| matches!(f, BashDqFrame::EscDq | BashDqFrame::Bt))
    }

    pub(crate) fn esc_dq_layers(&self, base: usize) -> usize {
        let mut idx = self.frames.len();
        let mut layers = 0usize;
        while idx > 0 {
            match self.frames[idx - 1] {
                BashDqFrame::Sub
                | BashDqFrame::EscDq
                | BashDqFrame::Param(_)
                | BashDqFrame::SqInParam(_)
                | BashDqFrame::Dq => idx -= 1,
                BashDqFrame::Bt => {
                    if idx >= 2
                        && (self.frames[idx - 2] == BashDqFrame::EscDq
                            || (self.frames[idx - 2] == BashDqFrame::Dq
                                && !matches!(
                                    self.frames.get(idx.wrapping_sub(3)),
                                    Some(BashDqFrame::Param(_))
                                )))
                    {
                        layers += 1;
                        idx -= 2;
                    } else {
                        idx -= 1;
                    }
                }
            }
        }
        base + layers
    }

    pub(crate) fn on_open_dq(&mut self) {
        self.prev_dollar = false;
        self.frames.push(BashDqFrame::Dq);
    }
    pub(crate) fn on_open_esc_dq(&mut self) {
        self.prev_dollar = false;
        self.frames.push(BashDqFrame::EscDq);
    }
    pub(crate) fn on_exit_esc_dq(&mut self) {
        self.prev_dollar = false;
        if matches!(self.frames.last(), Some(BashDqFrame::EscDq)) {
            self.frames.pop();
        }
        self.clear_bad_sub_if_exited();
    }
    pub(crate) fn on_exit_dq(&mut self) {
        self.prev_dollar = false;
        if matches!(self.frames.last(), Some(BashDqFrame::Dq)) {
            self.frames.pop();
        }
        self.clear_bad_sub_if_exited();
    }
    pub(crate) fn on_enter_bt_from_code(&mut self) {
        self.prev_dollar = false;
        self.last_exit_dropped_q = false;
        self.bt_marks.push(self.frames.len());
    }
    pub(crate) fn on_open_esc_bt(&mut self) {
        self.prev_dollar = false;
        self.last_exit_dropped_q = false;
        self.bt_marks.push(self.frames.len());
        self.frames.push(BashDqFrame::Bt);
    }
    pub(crate) fn on_exit_sub(&mut self) {
        self.prev_dollar = false;
        if matches!(self.frames.last(), Some(BashDqFrame::Sub)) {
            self.frames.pop();
        }
        self.clear_bad_sub_if_exited();
    }

    pub(crate) fn on_exit_bt_layers(&mut self, count: usize) -> bool {
        self.prev_dollar = false;
        let mut target = None;
        let mut popped = 0usize;
        while popped < count {
            if let Some(m) = self.bt_marks.pop() {
                target = Some(m);
                popped += 1;
            } else {
                break;
            }
        }
        let is_unclosed = |f: &BashDqFrame| {
            matches!(f, BashDqFrame::SqInParam(_) | BashDqFrame::Dq | BashDqFrame::EscDq)
        };
        let unclosed_inner_bt = count > 1 && count != usize::MAX;
        let dropped_q = if popped < count {
            let had = self.frames.iter().any(is_unclosed);
            self.frames.clear();
            had
        } else if let Some(m) = target {
            let had = self.frames[m..].iter().any(is_unclosed);
            self.frames.truncate(m);
            had
        } else {
            false
        } || unclosed_inner_bt;
        self.clear_bad_sub_if_exited();
        self.last_exit_dropped_q = dropped_q;
        dropped_q
    }
}
