use crate::dep_callers_bash::CompoundKind;
use crate::dep_callers_bash_abort::{BashAbortState, BashBufs, SnapEntry, SnapKind};
use crate::dep_callers_bash_cmd::CmdPartKind;
use crate::dep_callers_bash_span::mask_from_cursor_ch;

impl BashAbortState {
    pub(crate) fn clear_abort_floor(&mut self) {
        (
            self.abort_floor, self.abort_scope, self.in_failed_part, self.nl_clear_depth,
            self.continues_list, self.in_rhs_list, self.and_only_abort, self.or_only_abort,
            self.abort_if_branch, self.abort_if_elif_cond, self.abort_while_hd_body,
            self.abort_in_case_body, self.sub_assign_abort, self.fd0_in_redir_abort,
        ) = (None, 0, false, None, false, false, false, false, None, None, None, None, None, false);
    }

    pub(crate) fn clear_pending_hd_at(&mut self, bt_depth: usize, paren_depth: usize) {
        if self.pending_cond_hd_abort.is_some_and(|(bd, pd, _, _, _)| bd == bt_depth && pd == paren_depth) {
            self.pending_cond_hd_abort = None;
        }
        if self.pending_case_hd_abort.is_some_and(|(bd, pd, _, _, _)| bd == bt_depth && pd == paren_depth) {
            self.pending_case_hd_abort = None;
        }
    }

    pub(crate) fn set_hd_and_abort(&mut self, bt_depth: usize, paren_depth: usize, active_braces: usize) {
        if active_braces == 0 {
            self.abort_floor = Some((bt_depth, paren_depth));
            (self.abort_scope, self.in_failed_part, self.and_only_abort, self.or_only_abort) = (0, false, true, false);
            self.nl_clear_depth = Some(paren_depth);
            (self.continues_list, self.in_rhs_list, self.prev_ch) = (true, true, None);
        }
    }

    pub(crate) fn set_hd_or_abort(&mut self, bt_depth: usize, paren_depth: usize, active_braces: usize) {
        if active_braces == 0 {
            self.abort_floor = Some((bt_depth, paren_depth));
            (self.abort_scope, self.in_failed_part, self.and_only_abort, self.or_only_abort) = (0, false, false, true);
            self.nl_clear_depth = Some(paren_depth);
            (self.continues_list, self.in_rhs_list, self.prev_ch) = (true, true, None);
        }
    }

    pub(crate) fn set_cmdsub_hd_abort(&mut self, bt_depth: usize, paren_depth: usize, is_zero: bool) {
        self.cmdsub_hd_abort = Some((bt_depth, paren_depth, is_zero));
    }

    pub(crate) fn set_bt_hd_abort(&mut self, bt_depth: usize, paren_depth: usize, is_zero: bool) {
        self.bt_hd_abort = Some((bt_depth, paren_depth, is_zero));
    }

    pub(crate) fn set_hd_brace_abort(&mut self, bt_depth: usize, paren_depth: usize, brace_grp_depth: usize, is_zero: bool) {
        self.pending_hd_brace_abort = Some((bt_depth, paren_depth, brace_grp_depth, is_zero));
    }

    pub(crate) fn set_pending_exit_abort(&mut self, bt_depth: usize, paren_depth: usize, bg: usize, in_bang: bool) {
        self.pending_exit_abort = Some((bt_depth, paren_depth, bg, in_bang, false, true));
    }

    pub(crate) fn set_cond_hd_abort(&mut self, bt_depth: usize, paren_depth: usize, kind: CompoundKind, idx: usize, in_bang: bool) {
        self.pending_cond_hd_abort = Some((bt_depth, paren_depth, kind, idx, in_bang));
    }

    pub(crate) fn set_if_rest_abort(&mut self, bt_depth: usize, paren_depth: usize, idx: usize, open_now: bool) {
        if open_now {
            if !self.abort_floor.is_some_and(|(obf, opf)| obf < bt_depth || (obf == bt_depth && opf <= paren_depth)) {
                self.abort_floor = Some((bt_depth, paren_depth));
                (self.abort_scope, self.in_failed_part, self.and_only_abort, self.or_only_abort) = (0, false, false, false);
                self.nl_clear_depth = None;
                self.abort_if_elif_cond = Some((bt_depth, paren_depth, idx));
            }
        } else {
            self.abort_if_rest.push((bt_depth, paren_depth, idx));
        }
    }

    pub(crate) fn set_inline_cond_body_abort(&mut self, bt_depth: usize, paren_depth: usize, kind: CompoundKind, idx: usize) {
        if !self.abort_floor.is_some_and(|(obf, opf)| obf < bt_depth || (obf == bt_depth && opf <= paren_depth)) {
            self.abort_floor = Some((bt_depth, paren_depth));
            (self.abort_scope, self.in_failed_part, self.and_only_abort, self.or_only_abort) = (0, false, false, false);
            self.nl_clear_depth = None;
            match kind {
                CompoundKind::If => self.abort_if_branch = Some((bt_depth, paren_depth, idx)),
                CompoundKind::While | CompoundKind::Until => self.abort_while_hd_body = Some((bt_depth, paren_depth, idx)),
                CompoundKind::Loop => {}
            }
        }
    }

    pub(crate) fn push_snap(&mut self, kind: SnapKind, bt_depth: usize, paren_depth: usize, bufs: &BashBufs<'_>, offset: usize) {
        let cmd_bt = if kind == SnapKind::Bt { bt_depth.saturating_sub(1) } else { bt_depth };
        let cmd_pd = if matches!(kind, SnapKind::Bt | SnapKind::Sub) { paren_depth.saturating_sub(1) } else { paren_depth };
        let (part, part_start) = if let Some(c) = self.active_cmd_mut(cmd_bt, cmd_pd) {
            if let Some((rs, _)) = c.cur_redir { (CmdPartKind::Redir, Some(rs)) }
            else if let Some(asg) = c.cur_assign { (CmdPartKind::Assign, Some(asg)) }
            else { (CmdPartKind::Word, None) }
        } else {
            (CmdPartKind::Word, None)
        };
        if matches!(kind, SnapKind::Bt | SnapKind::Sub) {
            self.saved_cmd_ready.push((bt_depth, paren_depth, self.cmd_ready));
            self.cmd_ready = true;
        }
        self.snaps.push(SnapEntry {
            kind, bt_depth, paren_depth, line: bufs.imp_lines.len(),
            imp_col: bufs.imp.len().saturating_sub(offset), code_col: bufs.code.len().saturating_sub(offset),
            part, part_start,
        });
    }

    pub(crate) fn pop_snap_kind(&mut self, kind: SnapKind) {
        if let Some(pos) = self.snaps.iter().rposition(|s| s.kind == kind) { self.snaps.remove(pos); }
    }

    pub(super) fn restore_cmd_ready_bt(&mut self, bt_depth: usize) {
        while let Some(&(b, _, r)) = self.saved_cmd_ready.last() {
            if b <= bt_depth { break; }
            self.saved_cmd_ready.pop();
            self.cmd_ready = r;
        }
    }

    pub(crate) fn prune_bt(&mut self, bt_depth: usize) {
        self.snaps.retain(|s| s.bt_depth <= bt_depth);
        self.cmd_snaps.retain(|s| s.bt_depth <= bt_depth);
        if self.bt_hd_abort.is_some_and(|(bd, _, _)| bd > bt_depth) {
            self.bt_hd_abort = None;
        }
        self.bang_stack.retain(|&(b, _, _)| b <= bt_depth);
        self.pipe_stages.retain(|&(b, _, _)| b <= bt_depth);
        self.subshell_entry_cmds.retain(|&(b, _, _)| b <= bt_depth);
        self.restore_cmd_ready_bt(bt_depth);
    }

    pub(crate) fn on_cmdsub_close(&mut self, bt_depth: usize, prev_pd: usize, new_pd: usize, bg: usize, case_ctx: Option<(usize, bool)>) {
        if self.abort_floor == Some((bt_depth, prev_pd))
            && self.cmd_at(bt_depth, new_pd).is_some_and(|c| !c.has_non_sub_word)
        {
            let outer_bang = self.has_bang_at(bt_depth, new_pd, bg);
            self.pending_bt_assign_abort = Some((bt_depth, new_pd, outer_bang));
            if let Some((cd, true)) = case_ctx {
                self.pending_case_bt_abort = Some((bt_depth, new_pd, cd, true, outer_bang));
            }
        }
    }

    pub(crate) fn prune_paren(&mut self, bt_depth: usize, paren_depth: usize, bg: usize, exited_normal_sub: bool) {
        let prev_pd = paren_depth + 1;
        let sole_sub_cmd = exited_normal_sub && self.is_subshell_sole_cmd(bt_depth, prev_pd);
        self.snaps.retain(|s| s.paren_depth <= paren_depth || !matches!(s.kind, SnapKind::Sub | SnapKind::Param));
        self.cmd_snaps.retain(|s| s.paren_depth <= paren_depth);
        self.bang_stack.retain(|&(b, p, _)| b < bt_depth || (b == bt_depth && p <= paren_depth));
        self.pipe_stages.retain(|&(b, p, _)| b < bt_depth || (b == bt_depth && p <= paren_depth));
        self.subshell_entry_cmds.retain(|&(b, p, _)| b < bt_depth || (b == bt_depth && p <= paren_depth));
        while let Some(&(b, p, r)) = self.saved_cmd_ready.last() {
            if b < bt_depth || (b == bt_depth && p <= paren_depth) { break; }
            self.saved_cmd_ready.pop();
            self.cmd_ready = r;
        }
        let can_prop = exited_normal_sub
            || self.cmd_at(bt_depth, paren_depth).is_some_and(|c| !c.has_cmd_word || !c.has_non_sub_word);
        if let Some((bd, pd, is_zero)) = self.cmdsub_hd_abort && bt_depth <= bd && paren_depth <= pd {
            self.cmdsub_hd_abort = None;
            if can_prop {
                let outer_bang = self.has_bang_at(bd, pd, bg);
                let final_bang = is_zero ^ outer_bang;
                if exited_normal_sub { self.pending_exit_abort = Some((bd, pd, bg, final_bang, false, false)); }
                else { self.pending_bt_assign_abort = Some((bd, pd, final_bang)); }
            }
        }
        if let Some((bd, pd, _, in_bang, _, from_hd)) = self.pending_exit_abort
            && (bd, pd) == (bt_depth, prev_pd) && can_prop
        {
            self.pending_exit_abort = None;
            let eff_bang = if sole_sub_cmd && from_hd { false } else { in_bang };
            let outer_bang = self.has_bang_at(bt_depth, paren_depth, bg);
            let final_bang = eff_bang ^ outer_bang;
            if exited_normal_sub { self.pending_exit_abort = Some((bt_depth, paren_depth, bg, final_bang, false, false)); }
            else { self.pending_bt_assign_abort = Some((bt_depth, paren_depth, final_bang)); }
        }
        if let Some((bd, pd, in_b)) = self.pending_bt_assign_abort
            && (bd, pd) == (bt_depth, prev_pd)
            && self.cmd_at(bt_depth, prev_pd).is_none_or(|c| !c.has_non_sub_word)
            && can_prop
        {
            self.pending_bt_assign_abort = None;
            let outer_bang = self.has_bang_at(bt_depth, paren_depth, bg);
            let final_bang = in_b ^ outer_bang;
            if exited_normal_sub { self.pending_exit_abort = Some((bt_depth, paren_depth, bg, final_bang, false, false)); }
            else { self.pending_bt_assign_abort = Some((bt_depth, paren_depth, final_bang)); }
        }
    }

    pub(crate) fn set_sq_snap(&mut self, line: usize, imp_col: usize, code_col: usize) {
        if self.sq_code_snap.is_none() { self.sq_code_snap = Some((line, imp_col, code_col)); }
    }
    pub(crate) fn clear_sq_snap(&mut self) { self.sq_code_snap = None; }
    pub(crate) fn mask_sq_snap(&mut self, bufs: &mut BashBufs<'_>) {
        if let Some((ln, ic, cc)) = self.sq_code_snap.take() { mask_from_cursor_ch(bufs, ln, ic, cc, true, ' '); }
    }
    pub(crate) fn clear_cmd_at(&mut self, bt_depth: usize, paren_depth: usize) {
        self.cmd_snaps.retain(|c| !(c.bt_depth == bt_depth && c.paren_depth == paren_depth));
    }

    pub(crate) fn on_depth_change(&mut self, bt_depth: usize, paren_depth: usize) {
        if self.pending_cond_hd_abort.is_some_and(|(bd, pd, _, _, _)| bt_depth < bd || paren_depth < pd) {
            self.pending_cond_hd_abort = None;
        }
        self.abort_if_rest.retain(|&(bd, pd, _)| bt_depth >= bd && paren_depth >= pd);
        if self.pending_case_hd_abort.is_some_and(|(bd, pd, _, _, _)| bt_depth < bd || paren_depth < pd) {
            self.pending_case_hd_abort = None;
        }
        if self.case_hd_esac_abort.is_some_and(|(bd, pd, _, _, _)| bt_depth < bd || paren_depth < pd) {
            self.case_hd_esac_abort = None;
        }
        if self.pending_case_bt_abort.is_some_and(|(bd, pd, _, _, _)| bt_depth < bd || paren_depth < pd) {
            self.pending_case_bt_abort = None;
        }
        if self.case_non_hd_esac_abort.is_some_and(|(bd, pd, _, _)| bt_depth < bd || paren_depth < pd) {
            self.case_non_hd_esac_abort = None;
        }
        if self.abort_floor.is_some_and(|(bf, pf)| bt_depth < bf || paren_depth < pf) {
            self.clear_abort_floor();
        }
    }

    pub(crate) fn on_enter_normal_paren(&mut self, bt_depth: usize, paren_depth: usize) {
        let prev_pd = paren_depth.saturating_sub(1);
        self.cond_candidate_abort = None;
        if self.pending_exit_abort.is_some_and(|(bd, pd, _, _, _, _)| bd == bt_depth && pd == prev_pd) {
            self.pending_exit_abort = None;
        }
        if self.pending_bt_assign_abort.is_some_and(|(bd, pd, _)| (bd, pd) == (bt_depth, prev_pd)) {
            self.pending_bt_assign_abort = None;
        }
        if self.pending_case_bt_abort.is_some_and(|(bd, pd, _, _, _)| (bd, pd) == (bt_depth, prev_pd)) {
            self.pending_case_bt_abort = None;
        }
        self.subshell_entry_cmds.push((bt_depth, paren_depth, 0));
        self.saved_cmd_ready.push((bt_depth, paren_depth, self.cmd_ready));
        self.cmd_ready = true;
        self.clear_pending_hd_at(bt_depth, prev_pd);
    }
}
