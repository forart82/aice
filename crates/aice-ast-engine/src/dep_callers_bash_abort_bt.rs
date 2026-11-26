use crate::dep_callers_bash::CaseTermKind;
use crate::dep_callers_bash_abort::BashAbortState;

impl BashAbortState {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn on_exit_bt_delim(
        &mut self,
        prev_bt: usize,
        prev_pd: usize,
        popped: usize,
        new_bt: usize,
        new_pd: usize,
        new_bg: usize,
        case_ctx: Option<(usize, bool)>,
    ) {
        let can_outer = self.cmd_at(new_bt, new_pd).is_some_and(|c| !c.has_non_sub_word);
        if let Some((bd, bpd, is_zero)) = self.bt_hd_abort && bd > new_bt {
            self.bt_hd_abort = None;
            if bpd == new_pd + 1 && can_outer {
                let in_b = is_zero ^ self.has_bang_at(new_bt, new_pd, new_bg);
                self.pending_bt_assign_abort = Some((new_bt, new_pd, in_b));
                if let Some((cd, true)) = case_ctx {
                    self.pending_case_bt_abort = Some((new_bt, new_pd, cd, true, in_b));
                }
            } else if self.pending_bt_assign_abort.is_some_and(|(b, p, _)| (b, p) == (new_bt, new_pd)) {
                self.pending_bt_assign_abort = None;
            }
            return;
        }
        if popped == 1 && new_bt + 1 == prev_bt && new_pd + 1 == prev_pd && can_outer {
            let prev_no_word = self.cmd_at(prev_bt, prev_pd).is_none_or(|c| !c.has_non_sub_word);
            let inner_bang = if let Some((bd, pd, _, in_bang, _, _)) = self.pending_exit_abort
                && (bd, pd) == (prev_bt, prev_pd) && prev_no_word
            {
                self.pending_exit_abort = None;
                Some(in_bang)
            } else if let Some((bd, pd, in_b)) = self.pending_bt_assign_abort
                && (bd, pd) == (prev_bt, prev_pd) && prev_no_word
            {
                self.pending_bt_assign_abort = None;
                Some(in_b)
            } else if self.abort_floor == Some((prev_bt, prev_pd)) {
                Some(false)
            } else {
                None
            };
            if let Some(ib) = inner_bang {
                let in_b = ib ^ self.has_bang_at(new_bt, new_pd, new_bg);
                self.pending_bt_assign_abort = Some((new_bt, new_pd, in_b));
                if let Some((cd, true)) = case_ctx {
                    self.pending_case_bt_abort = Some((new_bt, new_pd, cd, true, in_b));
                }
                return;
            }
        }
        if self.pending_bt_assign_abort.is_some_and(|(b, p, _)| (b, p) == (new_bt, new_pd)) {
            self.pending_bt_assign_abort = None;
        }
    }

    pub(crate) fn on_subshell_close(
        &mut self,
        bt_depth: usize,
        prev_pd: usize,
        new_pd: usize,
        bg: usize,
        case_ctx: Option<(usize, bool)>,
    ) {
        let bt_bang = self.pending_bt_assign_abort
            .filter(|&(bd, pd, _)| bd == bt_depth && pd == prev_pd)
            .filter(|_| self.cmd_at(bt_depth, prev_pd).is_none_or(|c| !c.has_non_sub_word))
            .map(|(_, _, b)| b);
        if bt_bang.is_some() {
            self.pending_bt_assign_abort = None;
        }
        let sole_cmd_bang = self.abort_floor == Some((bt_depth, prev_pd))
            && self.is_subshell_sole_cmd(bt_depth, prev_pd)
            && self.has_bang_at(bt_depth, prev_pd, 0);
        let lhs_sub = self.cmd_at(bt_depth, prev_pd).is_some_and(|c| c.has_lhs_sub_abort());
        if self.abort_floor == Some((bt_depth, prev_pd)) || bt_bang.is_some() || lhs_sub {
            let in_bang = bt_bang.unwrap_or(sole_cmd_bang) ^ self.has_bang_at(bt_depth, new_pd, bg);
            self.pending_exit_abort = Some((bt_depth, new_pd, bg, in_bang, false, false));
            if let Some((cd, true)) = case_ctx {
                self.pending_case_bt_abort = Some((bt_depth, new_pd, cd, true, in_bang));
            }
        }
    }

    pub(crate) fn on_brace_grp_close(
        &mut self,
        bt_depth: usize,
        paren_depth: usize,
        closed_depth: usize,
        new_bg: usize,
        case_ctx: Option<(usize, bool)>,
    ) {
        self.bang_stack.retain(|&(b, p, bg)| !(b == bt_depth && p == paren_depth && bg >= closed_depth));
        self.pipe_stages.retain(|&(b, p, bg)| !(b == bt_depth && p == paren_depth && bg >= closed_depth));
        let inner_bang = if let Some((bd, pd, cd, is_zero)) = self.pending_hd_brace_abort
            && (bd, pd, cd) == (bt_depth, paren_depth, closed_depth)
        {
            self.pending_hd_brace_abort = None;
            Some((is_zero, true))
        } else if let Some((bd, pd, pbg, in_bang, _, fh)) = self.pending_exit_abort
            && (bd, pd, pbg) == (bt_depth, paren_depth, closed_depth)
        {
            Some((in_bang, fh))
        } else if let Some((bd, pd, in_b)) = self.pending_bt_assign_abort
            && (bd, pd) == (bt_depth, paren_depth)
            && self.cmd_at(bt_depth, paren_depth).is_none_or(|c| !c.has_non_sub_word)
        {
            self.pending_bt_assign_abort = None;
            Some((in_b, false))
        } else {
            None
        };
        if let Some((ib, fh)) = inner_bang {
            let final_b = ib ^ self.has_bang_at(bt_depth, paren_depth, new_bg);
            self.pending_exit_abort = Some((bt_depth, paren_depth, new_bg, final_b, false, fh));
            if let Some((case_d, true)) = case_ctx {
                self.pending_case_bt_abort = Some((bt_depth, paren_depth, case_d, true, final_b));
            }
        }
    }

    pub(super) fn on_case_term_event(
        &mut self,
        case_d: usize,
        kind: CaseTermKind,
        bt_depth: usize,
        paren_depth: usize,
        bg: usize,
    ) -> bool {
        let mut cleared_case = false;
        if let Some((bf, pf, cd, guaranteed)) = self.abort_in_case_body
            && bf == bt_depth && pf == paren_depth && cd == case_d
        {
            let in_pipe = self.in_pipe_stage(bt_depth, paren_depth, bg);
            let in_bang = self.has_bang_at(bt_depth, paren_depth, bg);
            self.clear_bang_pipe_at(bt_depth, paren_depth, bg, true);
            self.clear_abort_floor();
            cleared_case = true;
            if kind == CaseTermKind::Dsemi && guaranteed {
                if in_pipe {
                    if !in_bang {
                        self.case_hd_esac_abort = Some((bt_depth, paren_depth, case_d, false, false));
                    }
                } else {
                    self.case_non_hd_esac_abort = Some((bt_depth, paren_depth, case_d, false));
                }
            }
        }
        match kind {
            CaseTermKind::Dsemi => {
                if let Some((bd, pd, cd, true, ab)) = self.pending_case_hd_abort
                    && (bd, pd, cd) == (bt_depth, paren_depth, case_d)
                {
                    self.pending_case_hd_abort = None;
                    self.case_hd_esac_abort = Some((bt_depth, paren_depth, case_d, false, ab));
                } else if self.pending_case_hd_abort.is_some_and(|(bd, pd, cd, _, _)| (bd, pd, cd) == (bt_depth, paren_depth, case_d)) {
                    self.pending_case_hd_abort = None;
                }
                if let Some((bd, pd, cd, true, ab)) = self.pending_case_bt_abort
                    && (bd, pd, cd) == (bt_depth, paren_depth, case_d)
                {
                    self.pending_case_bt_abort = None;
                    self.pending_bt_assign_abort = None;
                    self.pending_exit_abort = None;
                    self.case_hd_esac_abort = Some((bt_depth, paren_depth, case_d, false, ab));
                } else if self.pending_case_bt_abort.is_some_and(|(bd, pd, cd, _, _)| (bd, pd, cd) == (bt_depth, paren_depth, case_d)) {
                    self.pending_case_bt_abort = None;
                }
            }
            CaseTermKind::SemiAmp => {
                if self.pending_case_hd_abort.is_some_and(|(bd, pd, cd, _, _)| (bd, pd, cd) == (bt_depth, paren_depth, case_d)) {
                    self.pending_case_hd_abort = None;
                }
                if self.pending_case_bt_abort.is_some_and(|(bd, pd, cd, _, _)| (bd, pd, cd) == (bt_depth, paren_depth, case_d)) {
                    self.pending_case_bt_abort = None;
                }
                if self.case_hd_esac_abort.is_some_and(|(bd, pd, cd, _, _)| (bd, pd, cd) == (bt_depth, paren_depth, case_d)) {
                    self.case_hd_esac_abort = None;
                }
                if self.case_non_hd_esac_abort.is_some_and(|(bd, pd, cd, _)| (bd, pd, cd) == (bt_depth, paren_depth, case_d)) {
                    self.case_non_hd_esac_abort = None;
                }
            }
            CaseTermKind::DsemiAmp => {
                if self.case_non_hd_esac_abort == Some((bt_depth, paren_depth, case_d, false)) {
                    self.case_non_hd_esac_abort = Some((bt_depth, paren_depth, case_d, true));
                }
                if let Some((bd, pd, cd, false, ab)) = self.case_hd_esac_abort
                    && (bd, pd, cd) == (bt_depth, paren_depth, case_d)
                {
                    self.case_hd_esac_abort = Some((bt_depth, paren_depth, case_d, true, ab));
                } else if self.pending_case_hd_abort.is_some_and(|(bd, pd, cd, _, _)| (bd, pd, cd) == (bt_depth, paren_depth, case_d)) {
                    self.pending_case_hd_abort = None;
                }
                if self.pending_case_bt_abort.is_some_and(|(bd, pd, cd, _, _)| (bd, pd, cd) == (bt_depth, paren_depth, case_d)) {
                    self.pending_case_bt_abort = None;
                }
            }
        }
        cleared_case
    }

    pub(super) fn on_case_esac_event(&mut self, case_d: usize, bt_depth: usize, paren_depth: usize, bg: usize) {
        let outer_bang = self.case_outer_bangs.pop().unwrap_or(false);
        if self.abort_in_case_body.is_some_and(|(bf, pf, cd, _)| bf == bt_depth && pf == paren_depth && cd == case_d) {
            self.clear_abort_floor();
        }
        if self.case_non_hd_esac_abort.is_some_and(|(bd, pd, cd, _)| bd == bt_depth && pd == paren_depth && cd == case_d) {
            self.case_non_hd_esac_abort = None;
            if !self.abort_floor.is_some_and(|(obf, opf)| obf < bt_depth || (obf == bt_depth && opf < paren_depth)) {
                self.abort_floor = Some((bt_depth, paren_depth));
                (self.abort_scope, self.in_failed_part, self.and_only_abort, self.or_only_abort) = (0, false, false, false);
                self.nl_clear_depth = (bt_depth == 0 && paren_depth == 0).then_some(0);
                (self.continues_list, self.in_rhs_list, self.prev_ch) = (false, false, None);
            }
        } else if let Some((bd, pd, cd, _, ab)) = self.case_hd_esac_abort
            && (bd, pd, cd) == (bt_depth, paren_depth, case_d)
        {
            self.case_hd_esac_abort = None;
            let in_bang = ab ^ outer_bang ^ self.has_bang_at(bt_depth, paren_depth, bg);
            self.pending_exit_abort = Some((bt_depth, paren_depth, bg, in_bang, false, false));
        } else if let Some((bd, pd, cd, true, ab)) = self.pending_case_hd_abort
            && (bd, pd, cd) == (bt_depth, paren_depth, case_d)
        {
            self.pending_case_hd_abort = None;
            let in_bang = ab ^ outer_bang ^ self.has_bang_at(bt_depth, paren_depth, bg);
            self.pending_exit_abort = Some((bt_depth, paren_depth, bg, in_bang, false, false));
        } else if let Some((bd, pd, cd, true, ab)) = self.pending_case_bt_abort
            && (bd, pd, cd) == (bt_depth, paren_depth, case_d)
        {
            self.pending_case_bt_abort = None;
            self.pending_bt_assign_abort = None;
            let in_bang = ab ^ outer_bang ^ self.has_bang_at(bt_depth, paren_depth, bg);
            self.pending_exit_abort = Some((bt_depth, paren_depth, bg, in_bang, false, false));
        } else {
            if self.pending_case_hd_abort.is_some_and(|(bd, pd, cd, _, _)| (bd, pd, cd) == (bt_depth, paren_depth, case_d)) {
                self.pending_case_hd_abort = None;
            }
            if self.pending_case_bt_abort.is_some_and(|(bd, pd, cd, _, _)| (bd, pd, cd) == (bt_depth, paren_depth, case_d)) {
                self.pending_case_bt_abort = None;
            }
        }
    }
}
