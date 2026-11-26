use crate::dep_callers_bash::{CompoundEvent, CompoundKind};
use crate::dep_callers_bash_abort::BashAbortState;

impl BashAbortState {
    pub(crate) fn on_enter_cond(&mut self, bt_depth: usize, paren_depth: usize, bg: usize) {
        let had_bang = self.has_bang_at(bt_depth, paren_depth, bg);
        self.bang_stack.retain(|&x| x != (bt_depth, paren_depth, bg));
        self.cond_outer_bangs.push(had_bang);
    }

    pub(crate) fn sync_cond_outer_bangs(&mut self, len: usize) {
        self.cond_outer_bangs.truncate(len);
    }

    pub(super) fn step_and_or_op(
        &mut self,
        is_and: bool,
        ch: char,
        bt_depth: usize,
        paren_depth: usize,
        bg: usize,
    ) -> bool {
        self.clear_pending_hd_at(bt_depth, paren_depth);
        if !is_and {
            self.cur_cmd_id += 1;
        }
        let pe = self.pending_exit_abort.filter(|&(bd, pd, _, _, oc, _)| !oc && bd == bt_depth && pd == paren_depth);
        if pe.is_none() && self.pending_exit_abort.is_some_and(|(bd, pd, _, _, oc, _)| oc && bd == bt_depth && pd == paren_depth) {
            self.pending_exit_abort = None;
        }
        let pb = self.pending_bt_assign_abort
            .filter(|&(bd, pd, _)| bd == bt_depth && pd == paren_depth)
            .filter(|_| self.cmd_at(bt_depth, paren_depth).is_some_and(|c| !c.has_non_sub_word));
        if let Some((_, _, _, in_bang, _, _)) = pe {
            self.pending_exit_abort = None;
            self.clear_bang_pipe_at(bt_depth, paren_depth, bg, true);
            let blocks = if is_and { !in_bang } else { in_bang };
            if blocks && !self.abort_floor.is_some_and(|(obf, opf)| obf < bt_depth || (obf == bt_depth && opf < paren_depth)) {
                if is_and { self.set_hd_and_abort(bt_depth, paren_depth, 0); }
                else { self.set_hd_or_abort(bt_depth, paren_depth, 0); }
            }
            self.prev_ch = Some(ch);
            return true;
        }
        if let Some((_, _, bt_bang)) = pb {
            self.pending_bt_assign_abort = None;
            let in_bang = bt_bang;
            self.clear_bang_pipe_at(bt_depth, paren_depth, bg, true);
            let blocks = if is_and { !in_bang } else { in_bang };
            if blocks && !self.abort_floor.is_some_and(|(obf, opf)| obf < bt_depth || (obf == bt_depth && opf < paren_depth)) {
                if is_and { self.set_hd_and_abort(bt_depth, paren_depth, 0); }
                else { self.set_hd_or_abort(bt_depth, paren_depth, 0); }
            }
            self.prev_ch = Some(ch);
            return true;
        }
        if self.fd0_in_redir_abort && self.abort_floor == Some((bt_depth, paren_depth)) && !self.in_rhs_list {
            let in_bang = self.has_bang_at(bt_depth, paren_depth, bg);
            self.clear_bang_pipe_at(bt_depth, paren_depth, bg, true);
            self.clear_abort_floor();
            if is_and != in_bang {
                if is_and { self.set_hd_and_abort(bt_depth, paren_depth, 0); }
                else { self.set_hd_or_abort(bt_depth, paren_depth, 0); }
            }
            self.prev_ch = Some(ch);
            return true;
        }
        let clear_other = if is_and { self.or_only_abort } else { self.and_only_abort };
        if clear_other && self.abort_floor.is_some_and(|(bf, pf)| bt_depth <= bf && paren_depth <= pf) {
            self.clear_abort_floor();
        } else if self.abort_floor == Some((bt_depth, paren_depth)) && self.in_pipe_stage(bt_depth, paren_depth, bg) {
            let in_bang = self.has_bang_at(bt_depth, paren_depth, bg);
            self.clear_bang_pipe_at(bt_depth, paren_depth, bg, true);
            if is_and == in_bang {
                self.clear_abort_floor();
            } else if is_and {
                self.set_hd_and_abort(bt_depth, paren_depth, 0);
            } else {
                self.set_hd_or_abort(bt_depth, paren_depth, 0);
            }
            self.prev_ch = Some(ch);
            return true;
        }
        self.clear_bang_pipe_at(bt_depth, paren_depth, bg, true);
        false
    }

    pub(crate) fn set_case_hd_abort(&mut self, bt_depth: usize, paren_depth: usize, case_depth: usize, arm_matches: bool, arm_in_bang: bool) {
        self.pending_case_hd_abort = Some((bt_depth, paren_depth, case_depth, arm_matches, arm_in_bang));
    }

    pub(crate) fn push_case_start(&mut self, bt_depth: usize, scope_depth: usize, line: usize, imp_col: usize) {
        self.case_starts.push((bt_depth, scope_depth, line, imp_col));
    }

    pub(crate) fn sync_case_starts(&mut self, len: usize) {
        self.case_starts.truncate(len);
    }

    pub(crate) fn on_compound_event(
        &mut self,
        ev: CompoundEvent,
        bt_depth: usize,
        paren_depth: usize,
        bg: usize,
    ) -> bool {
        let mut cleared_case = false;
        match ev {
            CompoundEvent::None => {}
            CompoundEvent::IfThen(idx, _) => {
                if let Some((bd, pd, _, in_bang)) = self.cond_candidate_abort.take() && (bd, pd) == (bt_depth, paren_depth) {
                    if in_bang {
                        self.abort_if_rest.push((bt_depth, paren_depth, idx));
                    } else if !self.abort_floor.is_some_and(|(obf, opf)| obf < bt_depth || (obf == bt_depth && opf <= paren_depth)) {
                        self.abort_floor = Some((bt_depth, paren_depth));
                        (self.abort_scope, self.in_failed_part, self.and_only_abort, self.or_only_abort) = (0, false, false, false);
                        self.nl_clear_depth = None;
                        self.abort_if_branch = Some((bt_depth, paren_depth, idx));
                    }
                } else if let Some((bd, pd, kind, ci, in_bang)) = self.pending_cond_hd_abort
                    && (bd, pd, kind, ci) == (bt_depth, paren_depth, CompoundKind::If, idx)
                {
                    self.pending_cond_hd_abort = None;
                    if in_bang {
                        self.abort_if_rest.push((bt_depth, paren_depth, idx));
                    } else if !self.abort_floor.is_some_and(|(obf, opf)| obf < bt_depth || (obf == bt_depth && opf <= paren_depth)) {
                        self.abort_floor = Some((bt_depth, paren_depth));
                        (self.abort_scope, self.in_failed_part, self.and_only_abort, self.or_only_abort) = (0, false, false, false);
                        self.nl_clear_depth = None;
                        self.abort_if_branch = Some((bt_depth, paren_depth, idx));
                    }
                }
            }
            CompoundEvent::IfElif(idx) => {
                if self.pending_cond_hd_abort.is_some_and(|(bd, pd, _, ci, _)| bd == bt_depth && pd == paren_depth && ci == idx) {
                    self.pending_cond_hd_abort = None;
                }
                if self.abort_if_branch.is_some_and(|(bf, pf, ci)| bf == bt_depth && pf == paren_depth && ci == idx) {
                    self.clear_abort_floor();
                }
                if self.abort_if_rest.contains(&(bt_depth, paren_depth, idx))
                    && !self.abort_floor.is_some_and(|(obf, opf)| obf < bt_depth || (obf == bt_depth && opf <= paren_depth))
                {
                    self.abort_floor = Some((bt_depth, paren_depth));
                    (self.abort_scope, self.in_failed_part, self.and_only_abort, self.or_only_abort) = (0, false, false, false);
                    self.nl_clear_depth = None;
                }
            }
            CompoundEvent::IfElse(idx) => {
                if self.abort_if_branch.is_some_and(|(bf, pf, ci)| bf == bt_depth && pf == paren_depth && ci == idx) {
                    self.clear_abort_floor();
                }
                if self.abort_if_rest.contains(&(bt_depth, paren_depth, idx))
                    && !self.abort_floor.is_some_and(|(obf, opf)| obf < bt_depth || (obf == bt_depth && opf <= paren_depth))
                {
                    self.abort_floor = Some((bt_depth, paren_depth));
                    (self.abort_scope, self.in_failed_part, self.and_only_abort, self.or_only_abort) = (0, false, false, false);
                    self.nl_clear_depth = None;
                }
            }
            CompoundEvent::IfFi(idx, _) => {
                let outer_bang = self.cond_outer_bangs.pop().unwrap_or(false);
                if self.pending_cond_hd_abort.is_some_and(|(bd, pd, _, ci, _)| bd == bt_depth && pd == paren_depth && ci == idx) {
                    self.pending_cond_hd_abort = None;
                }
                let solo_if_fail = self.abort_if_branch.is_some_and(|(bf, pf, ci)| bf == bt_depth && pf == paren_depth && ci == idx);
                let had_rest = self.abort_if_rest.iter().any(|&(bf, pf, ci)| bf == bt_depth && pf == paren_depth && ci == idx);
                if had_rest {
                    self.abort_if_rest.retain(|&(bf, pf, ci)| !(bf == bt_depth && pf == paren_depth && ci == idx));
                }
                if had_rest
                    || solo_if_fail
                    || self.abort_if_elif_cond.is_some_and(|(bf, pf, ci)| bf == bt_depth && pf == paren_depth && ci == idx)
                {
                    self.clear_abort_floor();
                }
                if solo_if_fail {
                    self.pending_exit_abort = Some((bt_depth, paren_depth, bg, !outer_bang, false, false));
                }
            }
            CompoundEvent::WhileDo(idx) => {
                let cand = self.cond_candidate_abort.take().filter(|&(bd, pd, _, _)| (bd, pd) == (bt_depth, paren_depth));
                let hd = if let Some((bd, pd, kind, ci, in_bang)) = self.pending_cond_hd_abort
                    && (bd, pd, ci) == (bt_depth, paren_depth, idx)
                    && matches!(kind, CompoundKind::While | CompoundKind::Until)
                {
                    self.pending_cond_hd_abort = None;
                    Some((kind, in_bang))
                } else {
                    None
                };
                if let Some((kind, in_bang)) = hd.or_else(|| cand.map(|(_, _, k, b)| (k, b))) {
                    let suppress = if kind == CompoundKind::Until { in_bang } else { !in_bang };
                    if suppress && !self.abort_floor.is_some_and(|(obf, opf)| obf < bt_depth || (obf == bt_depth && opf <= paren_depth)) {
                        self.abort_floor = Some((bt_depth, paren_depth));
                        (self.abort_scope, self.in_failed_part, self.and_only_abort, self.or_only_abort) = (0, false, false, false);
                        self.nl_clear_depth = None;
                        self.abort_while_hd_body = Some((bt_depth, paren_depth, idx));
                    }
                }
            }
            CompoundEvent::WhileDone(idx) => {
                let outer_bang = self.cond_outer_bangs.pop().unwrap_or(false);
                if self.pending_cond_hd_abort.is_some_and(|(bd, pd, _, wi, _)| bd == bt_depth && pd == paren_depth && wi == idx) {
                    self.pending_cond_hd_abort = None;
                }
                if self.abort_while_hd_body.is_some_and(|(bf, pf, wi)| bf == bt_depth && pf == paren_depth && wi == idx) {
                    self.clear_abort_floor();
                    self.pending_exit_abort = Some((bt_depth, paren_depth, bg, !outer_bang, false, false));
                }
            }
            CompoundEvent::CaseArm(case_d, all_nonmatch) => {
                if !all_nonmatch && self.case_hd_esac_abort.is_some_and(|(b, p, c, w, _)| (b, p, c, w) == (bt_depth, paren_depth, case_d, true)) {
                    self.case_hd_esac_abort = None;
                }
                if !all_nonmatch && self.case_non_hd_esac_abort == Some((bt_depth, paren_depth, case_d, true)) {
                    self.case_non_hd_esac_abort = None;
                }
            }
            CompoundEvent::CaseTerm(case_d, kind) => {
                cleared_case = self.on_case_term_event(case_d, kind, bt_depth, paren_depth, bg);
            }
            CompoundEvent::CaseEsac(case_d) => {
                self.on_case_esac_event(case_d, bt_depth, paren_depth, bg);
            }
        }
        cleared_case
    }
}
