use crate::dep_callers_bash::CompoundKind;
use crate::dep_callers_bash_cmd::{CmdPartKind, CmdSnap, Cursor};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum SnapKind { Dq, Sub, Bt, Param }

#[derive(Clone, Copy)]
pub(crate) struct SnapEntry {
    pub(crate) kind: SnapKind,
    pub(crate) bt_depth: usize,
    pub(crate) paren_depth: usize,
    pub(crate) line: usize,
    pub(crate) imp_col: usize,
    pub(crate) code_col: usize,
    pub(crate) part: CmdPartKind,
    pub(crate) part_start: Option<Cursor>,
}

pub(crate) struct BashBufs<'a> {
    pub(crate) imp_lines: &'a mut Vec<String>,
    pub(crate) code_lines: &'a mut Vec<String>,
    pub(crate) imp: &'a mut String,
    pub(crate) code: &'a mut String,
}

pub(crate) struct BashAbortState {
    pub(super) snaps: Vec<SnapEntry>,
    pub(super) cmd_snaps: Vec<CmdSnap>,
    pub(super) cmd_ready: bool,
    pub(super) saved_cmd_ready: Vec<(usize, usize, bool)>,
    pub(super) sq_code_snap: Option<Cursor>,
    pub(super) abort_floor: Option<(usize, usize)>,
    pub(super) abort_scope: u8,
    pub(super) in_failed_part: bool,
    pub(super) and_only_abort: bool,
    pub(super) or_only_abort: bool,
    pub(super) nl_clear_depth: Option<usize>,
    pub(super) continues_list: bool,
    pub(super) continues_pipe: bool,
    pub(super) in_rhs_list: bool,
    pub(super) prev_ch: Option<char>,
    pub(super) last_bt_glued: bool,
    pub(crate) cur_cmd_id: usize,
    pub(super) cmdsub_hd_abort: Option<(usize, usize, bool)>,
    pub(super) bt_hd_abort: Option<(usize, usize, bool)>,
    pub(super) pending_exit_abort: Option<(usize, usize, usize, bool, bool, bool)>,
    pub(super) pending_bt_assign_abort: Option<(usize, usize, bool)>,
    pub(super) pending_hd_brace_abort: Option<(usize, usize, usize, bool)>,
    pub(super) abort_if_branch: Option<(usize, usize, usize)>,
    pub(super) abort_if_elif_cond: Option<(usize, usize, usize)>,
    pub(super) abort_if_rest: Vec<(usize, usize, usize)>,
    pub(super) abort_while_hd_body: Option<(usize, usize, usize)>,
    pub(super) abort_in_case_body: Option<(usize, usize, usize, bool)>,
    pub(super) pending_cond_hd_abort: Option<(usize, usize, CompoundKind, usize, bool)>,
    pub(super) cond_candidate_abort: Option<(usize, usize, CompoundKind, bool)>,
    pub(super) pending_case_hd_abort: Option<(usize, usize, usize, bool, bool)>,
    pub(super) case_hd_esac_abort: Option<(usize, usize, usize, bool, bool)>,
    pub(super) case_non_hd_esac_abort: Option<(usize, usize, usize, bool)>,
    pub(super) pending_case_bt_abort: Option<(usize, usize, usize, bool, bool)>,
    pub(super) fd0_in_redir_abort: bool,
    pub(super) subshell_entry_cmds: Vec<(usize, usize, u8)>,
    pub(super) cond_outer_bangs: Vec<bool>,
    pub(super) case_outer_bangs: Vec<bool>,
    pub(super) case_starts: Vec<(usize, usize, usize, usize)>,
    pub(super) pipe_stages: Vec<(usize, usize, usize)>,
    pub(super) bang_stack: Vec<(usize, usize, usize)>,
    pub(super) sub_assign_abort: Option<(usize, usize)>,
}

impl Default for BashAbortState {
    fn default() -> Self {
        Self {
            snaps: Vec::new(), cmd_snaps: Vec::new(), cmd_ready: true, saved_cmd_ready: Vec::new(),
            sq_code_snap: None, abort_floor: None, abort_scope: 0, in_failed_part: false,
            and_only_abort: false, or_only_abort: false, nl_clear_depth: None,
            continues_list: false, continues_pipe: false, in_rhs_list: false, prev_ch: None,
            last_bt_glued: false, cur_cmd_id: 0, cmdsub_hd_abort: None, bt_hd_abort: None, pending_exit_abort: None,
            pending_bt_assign_abort: None, pending_hd_brace_abort: None, abort_if_branch: None,
            abort_if_elif_cond: None, abort_if_rest: Vec::new(), abort_while_hd_body: None, abort_in_case_body: None,
            pending_cond_hd_abort: None, cond_candidate_abort: None, pending_case_hd_abort: None,
            case_hd_esac_abort: None, case_non_hd_esac_abort: None, pending_case_bt_abort: None,
            fd0_in_redir_abort: false, subshell_entry_cmds: Vec::new(), cond_outer_bangs: Vec::new(), case_outer_bangs: Vec::new(),
            case_starts: Vec::new(), pipe_stages: Vec::new(), bang_stack: Vec::new(), sub_assign_abort: None,
        }
    }
}

impl BashAbortState {
    pub(super) fn cmd_at(&self, bf: usize, pf: usize) -> Option<&CmdSnap> {
        self.cmd_snaps.iter().rev().find(|c| c.bt_depth == bf && c.paren_depth == pf)
    }
    pub(crate) fn is_subshell_sole_cmd(&self, bt_depth: usize, paren_depth: usize) -> bool {
        self.subshell_entry_cmds.iter().rev()
            .find(|&&(bd, pd, _)| bd == bt_depth && pd == paren_depth)
            .is_some_and(|&(_, _, st)| matches!(st, 1 | 2))
    }
    pub(crate) fn on_subshell_sep(&mut self, bt_depth: usize, paren_depth: usize, bg: usize, is_multi: bool) {
        if bg == 0
            && let Some(&mut (bd, pd, ref mut st)) = self.subshell_entry_cmds.last_mut()
            && bd == bt_depth && pd == paren_depth
        {
            if is_multi { *st = 3; } else if *st == 1 { *st = 2; }
        }
    }
    pub(crate) fn mark_dq_non_sub_word(&mut self, bt_depth: usize, paren_depth: usize) {
        if let Some(c) = self.active_cmd_mut(bt_depth, paren_depth)
            && c.cur_assign.is_none() && c.cur_redir.is_none()
        {
            c.has_non_sub_word = true;
            if self.pending_bt_assign_abort.is_some_and(|(bd, pd, _)| (bd, pd) == (bt_depth, paren_depth)) {
                self.pending_bt_assign_abort = None;
                if self.pending_case_bt_abort.is_some_and(|(cbd, cpd, _, _, _)| (cbd, cpd) == (bt_depth, paren_depth)) {
                    self.pending_case_bt_abort = None;
                }
            }
            if self.pending_exit_abort.is_some_and(|(bd, pd, _, _, _, _)| (bd, pd) == (bt_depth, paren_depth)) {
                self.pending_exit_abort = None;
            }
        }
    }
    pub(crate) fn has_active_floor_at(&self, bt_depth: usize, paren_depth: usize) -> bool {
        self.abort_floor.is_some_and(|(bf, pf)| bt_depth <= bf && paren_depth <= pf)
    }
    pub(crate) fn is_active(&self) -> bool {
        let Some((bf, pf)) = self.abort_floor else { return false; };
        match self.abort_scope {
            0 => true,
            1 => self.in_failed_part || self.cmd_at(bf, pf).is_some_and(|c| c.cur_redir.is_some()),
            _ => self.in_failed_part || self.cmd_at(bf, pf).is_some_and(|c| c.cur_assign.is_some() || c.cur_redir.is_some()),
        }
    }
    pub(crate) fn is_failed_cmd_bare_word(
        &self, bt_depth: usize, paren_depth: usize, active_braces: usize, ch: char, tail: &str,
    ) -> bool {
        if !(active_braces == 0 && !self.in_failed_part && self.abort_scope != 0
            && self.abort_floor == Some((bt_depth, paren_depth))
            && self.cmd_at(bt_depth, paren_depth).is_some_and(|c| c.cur_assign.is_none() && c.cur_redir.is_none()))
        {
            return false;
        }
        if self.fd0_in_redir_abort && (ch.is_ascii_alphanumeric() || ch == '_') {
            let mut in_bracket = self.cmd_at(bt_depth, paren_depth)
                .is_some_and(|c| c.tok_buf.contains('['));
            for &b in tail.as_bytes() {
                if b == b'=' && !in_bracket { return false; }
                if b == b'[' { in_bracket = true; continue; }
                if b == b']' && in_bracket { in_bracket = false; continue; }
                if in_bracket {
                    if matches!(b, b'\n' | b'\r' | b';' | b'&' | b'|') { break; }
                    continue;
                }
                if !(b.is_ascii_alphanumeric() || b == b'_' || b == b'+') { break; }
            }
        }
        true
    }
    pub(crate) fn last_bt_glued_assign(&self) -> bool { self.last_bt_glued }
    pub(crate) fn mark_cmd_ready(&mut self) { self.cmd_ready = true; }
    pub(crate) fn active_cmd_mut(&mut self, bt_depth: usize, paren_depth: usize) -> Option<&mut CmdSnap> {
        self.cmd_snaps.last_mut().filter(|c| c.bt_depth == bt_depth && c.paren_depth == paren_depth)
    }
    pub(crate) fn toggle_bang(&mut self, bt_depth: usize, paren_depth: usize, bg: usize) {
        if let Some(pos) = self.bang_stack.iter().rposition(|&x| x == (bt_depth, paren_depth, bg)) {
            self.bang_stack.remove(pos);
        } else {
            self.bang_stack.push((bt_depth, paren_depth, bg));
        }
    }
    pub(crate) fn bang_slice(&self) -> &[(usize, usize, usize)] { &self.bang_stack }
    pub(crate) fn has_bang_at(&self, bt_depth: usize, paren_depth: usize, bg: usize) -> bool {
        self.bang_stack.contains(&(bt_depth, paren_depth, bg))
    }
    pub(super) fn in_pipe_stage(&self, bt_depth: usize, paren_depth: usize, bg: usize) -> bool {
        self.pipe_stages.contains(&(bt_depth, paren_depth, bg))
    }
    pub(super) fn clear_bang_pipe_at(&mut self, bt_depth: usize, paren_depth: usize, bg: usize, clear_pipe: bool) {
        self.bang_stack.retain(|&x| x != (bt_depth, paren_depth, bg));
        if clear_pipe { self.pipe_stages.retain(|&x| x != (bt_depth, paren_depth, bg)); }
    }

    pub(crate) fn mark_cmd_start(
        &mut self,
        bt_depth: usize,
        paren_depth: usize,
        bg: usize,
        in_cond: Option<(CompoundKind, usize)>,
        bufs: &BashBufs<'_>,
    ) {
        if !self.cmd_ready { return; }
        self.cmd_ready = false;
        self.cur_cmd_id += 1;
        if bg == 0
            && let Some(&mut (bd, pd, ref mut st)) = self.subshell_entry_cmds.last_mut()
            && bd == bt_depth && pd == paren_depth
        {
            if *st == 0 { *st = 1; } else if *st == 2 { *st = 3; }
        }
        if self.pending_hd_brace_abort.is_some_and(|(bd, pd, _, _)| bd == bt_depth && pd == paren_depth) {
            self.pending_hd_brace_abort = None;
        }
        if paren_depth > 0 && self.cmdsub_hd_abort.is_some_and(|(bd, pd, _)| bd == bt_depth && pd == paren_depth - 1) {
            self.cmdsub_hd_abort = None;
        }
        if self.bt_hd_abort.is_some_and(|(bd, pd, _)| bd == bt_depth && pd == paren_depth) {
            self.bt_hd_abort = None;
        }
        if let Some((bd, pd, _, in_bang, only_close, _)) = self.pending_exit_abort
            && (bd, pd) == (bt_depth, paren_depth)
        {
            if !only_close && let Some((kind, _)) = in_cond {
                self.cond_candidate_abort = Some((bt_depth, paren_depth, kind, in_bang));
            }
            self.pending_exit_abort = None;
            if self.pending_case_bt_abort.is_some_and(|(cbd, cpd, _, _, _)| (cbd, cpd) == (bt_depth, paren_depth)) {
                self.pending_case_bt_abort = None;
            }
        }
        if let Some((bd, pd, in_b)) = self.pending_bt_assign_abort && (bd, pd) == (bt_depth, paren_depth) {
            if let Some((kind, _)) = in_cond {
                self.cond_candidate_abort = Some((bt_depth, paren_depth, kind, in_b));
            }
            self.pending_bt_assign_abort = None;
            if self.pending_case_bt_abort.is_some_and(|(cbd, cpd, _, _, _)| (cbd, cpd) == (bt_depth, paren_depth)) {
                self.pending_case_bt_abort = None;
            }
        }
        let cur = (bufs.imp_lines.len(), bufs.imp.len(), bufs.code.len());
        let entry = CmdSnap::new(bt_depth, paren_depth, cur);
        if let Some(last) = self.cmd_snaps.last_mut() && last.bt_depth == bt_depth && last.paren_depth == paren_depth {
            *last = entry;
        } else {
            self.cmd_snaps.push(entry);
        }
    }

    pub(crate) fn trigger_lhs_sub_floor(&mut self, bt_depth: usize, paren_depth: usize) {
        if !self.abort_floor.is_some_and(|(obf, opf)| obf < bt_depth || (obf == bt_depth && opf < paren_depth)) {
            self.abort_floor = Some((bt_depth, paren_depth));
            (self.abort_scope, self.in_failed_part, self.and_only_abort, self.or_only_abort) = (0, false, false, false);
            self.fd0_in_redir_abort = false;
            self.sub_assign_abort = None;
            self.nl_clear_depth = (bt_depth == 0 && paren_depth == 0).then_some(0);
            (self.continues_list, self.in_rhs_list) = (false, false);
        }
    }

    pub(crate) fn on_part_open(&mut self, bt_depth: usize, paren_depth: usize, cur: Cursor, is_cmdsub: bool, bufs: &mut BashBufs<'_>) {
        self.clear_pending_hd_at(bt_depth, paren_depth);
        self.cond_candidate_abort = None;
        if self.pending_exit_abort.is_some_and(|(bd, pd, _, _, _, _)| bd == bt_depth && pd == paren_depth) {
            self.pending_exit_abort = None;
        }
        if self.bt_hd_abort.is_some_and(|(bd, pd, _)| bd == bt_depth && pd == paren_depth) {
            self.bt_hd_abort = None;
        }
        let mut mask_subs = Vec::new();
        if let Some(c) = self.active_cmd_mut(bt_depth, paren_depth) {
            let in_asg = c.cur_assign.is_some();
            c.on_part_open(cur, is_cmdsub);
            if c.has_non_sub_word && !c.sub_assign_spans.is_empty() {
                mask_subs = std::mem::take(&mut c.sub_assign_spans);
            }
            if in_asg && self.pending_bt_assign_abort.is_some_and(|(bd, pd, _)| (bd, pd) == (bt_depth, paren_depth)) {
                self.pending_bt_assign_abort = None;
                if self.pending_case_bt_abort.is_some_and(|(cbd, cpd, _, _, _)| (cbd, cpd) == (bt_depth, paren_depth)) {
                    self.pending_case_bt_abort = None;
                }
            }
        }
        for (s, e) in mask_subs {
            crate::dep_callers_bash_span::mask_cursor_span(bufs, s, e);
        }
    }
}
