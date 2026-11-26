use crate::dep_callers_bash::CompoundKind;
use crate::dep_callers_bash_abort::BashAbortState;
use crate::dep_callers_bash_cont::ContLineAccum;
use crate::dep_callers_bash_delim::mask_tail_spaces;
use crate::dep_callers_bash_strip::BashStripState;
use crate::dep_callers_heredoc::HeredocTracker;
use crate::dep_callers_strip::ScanState;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum HeredocSubKind { Param, Sub, Bt }

pub(crate) struct HdHdrMeta {
    pub(crate) bt_depth: usize,
    pub(crate) line: usize,
    pub(crate) col: usize,
    pub(crate) paren_depth: usize,
    pub(crate) brace_grp_depth: usize,
    pub(crate) in_inner_brace_grp: bool,
    pub(crate) in_cond: Option<(CompoundKind, usize)>,
    pub(crate) outer_cond: Option<(CompoundKind, usize, usize, usize)>,
    pub(crate) outer_grp_bangs: Vec<(usize, usize, usize, u8, bool)>,
    pub(crate) in_case_arm: Option<(usize, bool)>,
    pub(crate) aborted: bool,
    pub(crate) suppressed: bool,
    pub(crate) in_bang: bool,
    pub(crate) in_bt_top: bool,
}

pub(crate) struct HeredocSubState {
    pub(crate) kind: HeredocSubKind,
    pub(crate) bash: BashStripState,
    pub(crate) abort: BashAbortState,
    pub(crate) state: ScanState,
    pub(crate) heredoc: HeredocTracker,
    pub(crate) nested: Option<Box<HeredocSubState>>,
    pub(crate) nested_ln: Option<(usize, usize, usize)>,
}

impl HeredocSubState {
    pub(crate) fn new(kind: HeredocSubKind, bash: BashStripState, state: ScanState) -> Self {
        Self {
            kind,
            bash,
            abort: BashAbortState::default(),
            state,
            heredoc: HeredocTracker::default(),
            nested: None,
            nested_ln: None,
        }
    }

    pub(crate) fn leaf(&self) -> &HeredocSubState {
        let mut cur = self;
        while let Some(n) = cur.nested.as_deref() {
            cur = n;
        }
        cur
    }
}

pub(crate) fn heredoc_sub_done(kind: HeredocSubKind, state: ScanState, bash: &BashStripState) -> bool {
    match kind {
        HeredocSubKind::Param => state == ScanState::BashDq && bash.param_depth() == 0,
        HeredocSubKind::Sub => state == ScanState::Code && bash.paren_depth() == 0,
        HeredocSubKind::Bt => state == ScanState::Code && bash.local_bt_depth() == 0,
    }
}

pub(crate) fn is_hd_delim_lt(lt: u8) -> bool {
    matches!(lt, 2 | 4 | 5 | 6 | 7 | 8)
}

pub(crate) fn next_trail_lt(prev_lt: u8, ch: char) -> u8 {
    match (prev_lt, ch) {
        (0, '<') => 1,
        (1, '<') => 2,
        (2 | 3, '<') => 3,
        (2, '-') => 4,
        (2 | 5, ' ' | '\t') => 5,
        (4 | 6, ' ' | '\t') => 6,
        (2 | 4 | 5 | 6 | 7 | 8, c)
            if !c.is_ascii_whitespace()
                && !matches!(c, ';' | '&' | '|' | '<' | '>' | '(' | ')' | '`' | '\'' | '"' | '\\')
                && (c != '#' || matches!(prev_lt, 7 | 8)) => if prev_lt == 8 { 8 } else { 7 },
        (_, '<') => 1,
        _ => 0,
    }
}

pub(crate) fn next_lt_after_bt_bs(prev_lt: u8, b: &[u8], after: usize) -> u8 {
    if is_hd_delim_lt(prev_lt) && after < b.len() {
        let ch = b[after];
        if ch != b'\n'
            && (ch >= 0x80
                || next_trail_lt(7, ch as char) == 7
                || matches!(ch, b' ' | b'\t' | b';' | b'&' | b'|' | b'<' | b'>' | b'(' | b')' | b'`' | b'\''))
        {
            return if prev_lt == 8 { 8 } else { 7 };
        }
    }
    0
}

pub(crate) fn push_multiline_hd_entry(heredoc: &mut HeredocTracker, bt_depth: usize, bt_mask: u32, quoted: bool) {
    heredoc.pending.push(crate::dep_callers_heredoc::HeredocEntry {
        delim: "\n".to_string(),
        strip_ws: false,
        quoted,
        bt_depth,
        bt_mask,
    });
}

pub(crate) fn mask_unclosed_hd_sub<T>(
    hd_sub: &mut Option<T>,
    hd_sub_line: &mut Option<(usize, usize, usize)>,
    imp_lines: &mut [String],
    code_lines: &mut [String],
    acc: Option<&mut ContLineAccum>,
) {
    if hd_sub.take().is_some() && let Some((ln, ic, cc)) = hd_sub_line.take() {
        if ln < imp_lines.len() {
            mask_tail_spaces(&mut imp_lines[ln], ic);
            mask_tail_spaces(&mut code_lines[ln], cc);
            for row in &mut imp_lines[ln + 1..] {
                *row = " ".repeat(row.len());
            }
            for row in &mut code_lines[ln + 1..] {
                *row = " ".repeat(row.len());
            }
            if let Some(a) = acc {
                a.cur_imp = " ".repeat(a.cur_imp.len());
                a.cur_code = " ".repeat(a.cur_code.len());
            }
        } else if let Some(a) = acc {
            mask_tail_spaces(&mut a.cur_imp, ic);
            mask_tail_spaces(&mut a.cur_code, cc);
        }
    }
}

pub(crate) use crate::dep_callers_bash_bs::{
    HdBsStep, keep_bt_dollar, step_code_backslash, step_hd_unq_bs,
};
pub(crate) use crate::dep_callers_bash_hd_tail::mask_hd_header_tail;
