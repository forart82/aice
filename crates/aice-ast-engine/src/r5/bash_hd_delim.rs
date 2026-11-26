use crate::dep_callers_bash_hd::{is_hd_delim_lt, next_trail_lt};
use crate::dep_callers_heredoc::{HeredocEntry, HeredocTracker};
use crate::dep_callers_quote::{QuoteDepthTracker, StepKind};

type PreCtx = (bool, usize, usize, usize, usize);
type HdSnap = (QuoteDepthTracker, Vec<usize>, usize);

#[derive(Default)]
pub(super) struct CoalesceHdDelim {
    lt: u8,
    lt_start: Option<usize>,
    hd_q: u8,
    hd_start: Option<usize>,
    hd_p: usize,
    hd_bt: usize,
    hd_param: usize,
    hd_sub: Option<(usize, usize, usize, usize, u8)>,
    hd_quoted: bool,
    hd_ml: bool,
    pre_ctx: PreCtx,
    pre_lt1: Option<HdSnap>,
    snap: Option<HdSnap>,
}

impl CoalesceHdDelim {
    pub(super) fn in_hd_delim(&self) -> bool {
        self.hd_q != 0 || self.hd_sub.is_some() || self.lt == 8
    }

    pub(super) fn on_parsed_hd(&mut self) {
        (self.lt, self.lt_start, self.hd_quoted, self.hd_ml) = (0, None, false, false);
        (self.pre_lt1, self.snap) = (None, None);
    }

    pub(super) fn on_comment(&mut self) {
        (self.lt, self.lt_start, self.hd_quoted, self.hd_ml) = (0, None, false, false);
        (self.pre_lt1, self.snap) = (None, None);
    }

    pub(super) fn on_newline(&mut self) {
        self.hd_q = match self.hd_q { 1 => 2, 3 => 4, x => x };
        if matches!(self.hd_q, 2 | 4) {
            self.hd_ml = true;
        }
        if let Some((_, _, _, _, ref mut sq)) = self.hd_sub {
            *sq = 8;
            self.hd_ml = true;
        }
        (self.lt, self.lt_start, self.pre_lt1, self.snap) = (0, None, None, None);
    }

    pub(super) fn cont_hd_start(&self) -> Option<usize> {
        if self.hd_ml {
            return None;
        }
        if is_hd_delim_lt(self.lt) || self.lt == 1 {
            self.lt_start
        } else if matches!(self.hd_q, 1 | 3) || self.hd_sub.is_some_and(|s| s.4 == 7) {
            self.hd_start
        } else {
            None
        }
    }

    pub(super) fn take_snap(&mut self) -> Option<HdSnap> {
        self.snap.take()
    }

    pub(super) fn step_before_char(
        &mut self,
        tr: &QuoteDepthTracker,
        arith: &[usize],
        ch: char,
        abs: usize,
    ) {
        self.pre_ctx = (
            tr.bash_last_is_dollar(),
            tr.bash_paren_depth(),
            tr.bash_active_braces(),
            tr.bash_bt_depth(),
            tr.bash_param_depth(),
        );
        if self.lt == 0
            && ch == '<'
            && tr.quote.is_none()
            && !tr.is_bash_escaped(false)
            && !self.in_hd_delim()
            && arith.is_empty()
            && tr.bash_active_braces() == 0
        {
            self.pre_lt1 = Some((tr.clone(), arith.to_vec(), abs));
        }
    }

    fn finish_ml_header(
        &mut self,
        tr: &mut QuoteDepthTracker,
        hd: &mut HeredocTracker,
        spans: (usize, usize, usize, usize),
        iter: &mut std::iter::Peekable<std::str::CharIndices<'_>>,
    ) -> Option<(usize, usize, bool)> {
        let (abs, end_idx, line_end, base_abs) = spans;
        let (base_p, base_br, base_bt, base_param) = (
            tr.bash_paren_depth(),
            tr.bash_active_braces(),
            tr.bash_bt_depth(),
            tr.bash_param_depth(),
        );
        let mut hdr_end = end_idx;
        while let Some(&(nirel, nch)) = iter.peek() {
            let nabs = base_abs + nirel;
            if nabs < hdr_end { iter.next(); continue; }
            if nabs >= line_end { break; }
            let in_seg = tr.quote.is_some()
                || tr.is_escaped()
                || tr.bash_paren_depth() > base_p
                || tr.bash_active_braces() > base_br
                || tr.bash_bt_depth() > base_bt
                || tr.bash_param_depth() > base_param;
            if !in_seg {
                if nch == '`' && tr.bash_bt_depth() > 0 { break; }
                if !((tr.bash_last_is_dollar() && matches!(nch, '(' | '{'))
                    || matches!(nch, '\'' | '"' | '\\' | '`')
                    || next_trail_lt(7, nch) == 7)
                {
                    break;
                }
                if matches!(nch, '\'' | '"' | '\\') {
                    self.hd_quoted = true;
                }
            }
            iter.next();
            let next = iter.peek().map(|&(_, nn)| nn);
            let kind = tr.step(nch, next);
            hdr_end = nabs + nch.len_utf8();
            if kind == StepKind::EnterTemplate && let Some((trel, tch)) = iter.next() {
                hdr_end = base_abs + trel + tch.len_utf8();
            }
        }
        if let Some(q) = tr.quote {
            self.hd_q = if q == '\'' { 1 } else { 3 };
            (self.hd_p, self.hd_bt, self.hd_param) = (base_p, base_bt, base_param);
            return None;
        }
        if tr.bash_paren_depth() > base_p
            || tr.bash_active_braces() > base_br
            || tr.bash_bt_depth() > base_bt
            || tr.bash_param_depth() > base_param
        {
            self.hd_sub = Some((base_p, base_br, base_bt, base_param, 8));
            self.hd_ml = true;
            return None;
        }
        let quoted = self.hd_quoted;
        hd.pending.push(HeredocEntry {
            delim: "\n".to_string(),
            strip_ws: false,
            quoted,
            bt_depth: tr.bash_bt_depth(),
            bt_mask: tr.bash_bt_unescape_mask(),
        });
        let res = Some((self.hd_start.unwrap_or(abs), hdr_end, quoted));
        (self.hd_q, self.hd_start, self.lt, self.lt_start, self.hd_quoted, self.hd_ml) =
            (0, None, 0, None, false, false);
        (self.pre_lt1, self.snap) = (None, None);
        res
    }

    pub(super) fn step_after_char(
        &mut self,
        tr: &mut QuoteDepthTracker,
        hd: &mut HeredocTracker,
        ch: char,
        flags: (bool, bool),
        spans: (usize, usize, usize, usize),
        iter: &mut std::iter::Peekable<std::str::CharIndices<'_>>,
    ) -> Option<(usize, usize, bool)> {
        let (was_q, was_esc) = flags;
        let abs = spans.0;
        let (prev_dollar, prev_p, prev_br, prev_bt, prev_param) = self.pre_ctx;
        if let Some((bp, bbr, bbt, bparam, sq)) = self.hd_sub {
            if tr.quote.is_none()
                && tr.bash_paren_depth() == bp
                && tr.bash_active_braces() == bbr
                && tr.bash_bt_depth() == bbt
                && tr.bash_param_depth() == bparam
            {
                self.hd_sub = None;
                if sq == 8 || self.hd_ml {
                    return self.finish_ml_header(tr, hd, spans, iter);
                }
                self.lt_start = self.hd_start.take();
                self.lt = 7;
            }
            return None;
        }
        if !was_q && tr.quote.is_some() {
            if is_hd_delim_lt(self.lt) && matches!(ch, '\'' | '"') {
                self.hd_q = if ch == '\'' { 1 } else { 3 };
                self.hd_start = self.lt_start.take();
                self.hd_quoted = true;
                (self.hd_p, self.hd_bt, self.hd_param) = (prev_p, prev_bt, prev_param);
            } else if self.hd_q == 0 {
                (self.pre_lt1, self.snap, self.hd_quoted, self.hd_ml) = (None, None, false, false);
            }
            (self.lt, self.lt_start) = (0, None);
            return None;
        }
        if was_q && tr.quote.is_none() {
            if self.hd_q != 0
                && tr.bash_paren_depth() == self.hd_p
                && tr.bash_bt_depth() == self.hd_bt
                && tr.bash_param_depth() == self.hd_param
            {
                if matches!(self.hd_q, 2 | 4) || self.hd_ml {
                    self.hd_q = 0;
                    return self.finish_ml_header(tr, hd, spans, iter);
                }
                self.lt_start = self.hd_start.take();
                (self.hd_q, self.lt) = (0, 7);
            }
            return None;
        }
        if self.hd_q == 0 && tr.quote.is_none() {
            if is_hd_delim_lt(self.lt)
                && !was_esc
                && ((ch == '(' && prev_dollar && tr.bash_paren_depth() > prev_p)
                    || (ch == '{' && prev_dollar && tr.bash_param_depth() > prev_param)
                    || (ch == '`' && tr.bash_bt_depth() > prev_bt))
            {
                self.hd_sub = Some((prev_p, prev_br, prev_bt, prev_param, if self.lt == 8 { 8 } else { 7 }));
                self.hd_start = self.lt_start.take();
                self.lt = 0;
                return None;
            }
            if was_esc {
                self.lt = if is_hd_delim_lt(self.lt) {
                    self.hd_quoted = true;
                    if self.lt == 8 { 8 } else { 7 }
                } else {
                    0
                };
            } else if !tr.is_escaped() {
                if self.lt == 1 && ch == '<' {
                    self.snap = self.pre_lt1.take();
                    (self.hd_quoted, self.hd_ml) = (false, false);
                }
                let next_lt = next_trail_lt(self.lt, ch);
                if self.lt == 0 && next_lt == 1 {
                    self.lt_start = Some(abs);
                } else if next_lt == 0 {
                    (self.lt_start, self.pre_lt1, self.snap) = (None, None, None);
                    (self.hd_quoted, self.hd_ml) = (false, false);
                } else if ch != '<' {
                    self.pre_lt1 = None;
                }
                self.lt = next_lt;
            }
        }
        None
    }
}
