use crate::dep_callers_bash::{BashCaseTracker, OpenParenKind};
use crate::dep_callers_bash_abort::{BashAbortState, BashBufs, SnapKind};
use crate::dep_callers_bash_cmd::CmdPartKind;
pub(crate) use crate::dep_callers_bash_span::{
    mask_cursor_span, mask_from_cursor_ch, mask_range_spaces,
};

fn is_glued_word_delim(c: u8) -> bool {
    c.is_ascii_whitespace() || matches!(c, b';' | b'&' | b'|' | b'(' | b')' | b'{' | b'}' | b'`' | b'<' | b'>')
}

pub(crate) fn ends_with_bash_assign_eq(s: &str) -> bool {
    let b = s.as_bytes();
    let mut w = b.len();
    while w > 0 && !is_glued_word_delim(b[w - 1]) { w -= 1; }
    let Some(eq_rel) = b[w..].iter().position(|&c| c == b'=') else { return false };
    let stem = &b[w..w + eq_rel];
    let mut end = stem.len();
    if end > 0 && stem[end - 1] == b'+' { end -= 1; }
    if end > 1 && stem[end - 1] == b']'
        && let Some(lb) = stem[..end - 1].iter().rposition(|&c| c == b'[')
        && lb + 1 < end - 1
    {
        end = lb;
    }
    let name = &stem[..end];
    !name.is_empty() && !name[0].is_ascii_digit() && name.iter().all(|&c| c.is_ascii_alphanumeric() || c == b'_')
}

pub(crate) fn is_glued_bt_prefix(s: &str) -> bool {
    s.as_bytes().last().is_some_and(|&c| !is_glued_word_delim(c))
}

pub(crate) fn is_glued_after_byte(next: Option<&u8>) -> bool {
    next.is_some_and(|&c| !c.is_ascii_whitespace() && !matches!(c, b';' | b'&' | b'|' | b'(' | b')' | b'{' | b'}'))
}

fn scope_rank(s: u8) -> u8 {
    match s { 0 => 3, 2 => 2, 1 => 1, _ => 0 }
}

impl BashAbortState {
    pub(crate) fn trigger_bad_sub(
        &mut self,
        case: &BashCaseTracker,
        bt_depth: usize,
        bufs: &mut BashBufs<'_>,
        from_closed_param: bool,
    ) -> Option<(u8, usize, usize)> {
        let (mut paren_floor, mut bt_paren_base) = (0usize, 0usize);
        for (idx, (k, _)) in case.paren_stack.iter().enumerate().rev() {
            if matches!(k, OpenParenKind::UnqBt | OpenParenKind::QuotedBt(_) | OpenParenKind::NestedBt(_)) {
                bt_paren_base = idx + 1;
                break;
            }
            let stops = if from_closed_param {
                matches!(
                    k,
                    OpenParenKind::Normal | OpenParenKind::ProcSub | OpenParenKind::UnqSub | OpenParenKind::QuotedSub
                )
            } else {
                *k == OpenParenKind::Normal
            };
            if stops && paren_floor == 0 { paren_floor = idx + 1; }
        }
        let pf = if paren_floor != 0 { paren_floor } else { bt_paren_base };
        let after_bt = self.snaps.iter().rposition(|s| s.kind == SnapKind::Bt).map_or(0, |p| p + 1);
        let sub_snap = if from_closed_param { None } else {
            self.snaps[after_bt..].iter().find(|s| s.kind == SnapKind::Sub).copied()
        };
        let mut abort_scope = 0u8;
        let fail_rel = if from_closed_param {
            self.snaps[after_bt..].iter().rposition(|s| s.kind == SnapKind::Param)
        } else {
            self.snaps[after_bt..].iter().position(|s| matches!(s.kind, SnapKind::Dq | SnapKind::Sub | SnapKind::Param))
        };
        if let Some(rel) = fail_rel {
            let idx = after_bt + rel;
            let mut snap = self.snaps[idx];
            let escalated_sub = !from_closed_param && sub_snap.is_none() && snap.paren_depth > pf;
            let fail_snap = sub_snap.unwrap_or(snap);
            let target_pd = if escalated_sub {
                pf
            } else {
                fail_snap.paren_depth.saturating_sub(usize::from(sub_snap.is_some()))
            };
            let cmd_pos = self.cmd_snaps.iter().rposition(|c| c.bt_depth == bt_depth && c.paren_depth == target_pd);
            if let Some(p) = cmd_pos
                && self.cmd_snaps[p].in_lhs_sub
                && target_pd == case.paren_depth()
                && !escalated_sub
                && sub_snap.is_none()
            {
                mask_from_cursor_ch(bufs, snap.line, snap.imp_col, snap.code_col, true, ' ');
                self.cmd_snaps[p].lhs_sub_abort = true;
                self.snaps.truncate(idx);
                return None;
            }
            let part = if escalated_sub { CmdPartKind::Word } else { fail_snap.part };
            match part {
                CmdPartKind::Redir => {
                    if let Some(p) = cmd_pos {
                        let bws = std::mem::take(&mut self.cmd_snaps[p].bare_word_spans);
                        for (bs, be) in bws { mask_cursor_span(bufs, bs, be); }
                    }
                    if let Some((ln, ic, cc)) = fail_snap.part_start { (snap.line, snap.imp_col, snap.code_col) = (ln, ic, cc); }
                    abort_scope = 1;
                }
                CmdPartKind::Assign => {
                    if let Some(p) = cmd_pos {
                        let redirs = std::mem::take(&mut self.cmd_snaps[p].redir_spans);
                        for (rs, re) in redirs { mask_cursor_span(bufs, rs, re); }
                        if sub_snap.is_none() {
                            let anames = std::mem::take(&mut self.cmd_snaps[p].assign_name_spans);
                            for (ns, ne) in anames { mask_cursor_span(bufs, ns, ne); }
                            if let Some((ns, ne)) = self.cmd_snaps[p].assign_name_end.take() {
                                mask_cursor_span(bufs, ns, ne);
                            }
                        }
                    }
                    if sub_snap.is_some() && let Some((ln, ic, cc)) = fail_snap.part_start {
                        (snap.line, snap.imp_col, snap.code_col) = (ln, ic, cc);
                    }
                    abort_scope = 2;
                }
                CmdPartKind::Word => {
                    if let Some(p) = cmd_pos {
                        if sub_snap.is_some() || escalated_sub {
                            let st = self.cmd_snaps[p].start;
                            if st.0 < snap.line || (st.0 == snap.line && st.1 < snap.imp_col) {
                                (snap.line, snap.imp_col, snap.code_col) = st;
                            }
                        } else {
                            let assigns = std::mem::take(&mut self.cmd_snaps[p].assign_spans);
                            let anames = std::mem::take(&mut self.cmd_snaps[p].assign_name_spans);
                            let redirs = std::mem::take(&mut self.cmd_snaps[p].redir_spans);
                            let bws = std::mem::take(&mut self.cmd_snaps[p].bare_word_spans);
                            for (asg_s, asg_e) in assigns { mask_cursor_span(bufs, asg_s, asg_e); }
                            for (ns, ne) in anames { mask_cursor_span(bufs, ns, ne); }
                            if let Some((ns, ne)) = self.cmd_snaps[p].assign_name_end.take() {
                                mask_cursor_span(bufs, ns, ne);
                            }
                            for (rs, re) in redirs { mask_cursor_span(bufs, rs, re); }
                            for (bs, be) in bws { mask_cursor_span(bufs, bs, be); }
                        }
                    }
                }
            }
            mask_from_cursor_ch(bufs, snap.line, snap.imp_col, snap.code_col, true, ' ');
            if self.sq_code_snap.is_some_and(|(ln, ic, _)| ln > snap.line || (ln == snap.line && ic >= snap.imp_col)) {
                self.sq_code_snap = None;
            }
            self.snaps.truncate(idx);
        }
        if after_bt > 0 {
            let bt_snap = self.snaps[after_bt - 1];
            let ob = bt_snap.bt_depth.saturating_sub(1);
            let op = bt_snap.paren_depth.saturating_sub(1);
            if bt_snap.bt_depth == bt_depth
                && matches!(bt_snap.part, CmdPartKind::Assign | CmdPartKind::Word)
                && self.cmd_at(ob, op).is_some_and(|c| !c.has_non_sub_word)
            {
                self.pending_bt_assign_abort = Some((ob, op, false));
            }
        }
        let new_scope = abort_scope;
        if new_scope == 0
            && let Some(sc) = case.unentered_case_scope()
            && let Some(&(cb, cs, ln, col)) = self.case_starts.last()
            && cb == bt_depth && cs == pf && sc == pf
        {
            let target = if ln < bufs.imp_lines.len() { &mut bufs.imp_lines[ln] } else { &mut *bufs.imp };
            mask_range_spaces(target, col, col + 4);
        }
        let is_fd0_in = new_scope == 1
            && self.cmd_at(bt_depth, pf).is_some_and(|c| c.cur_redir_is_fd0_in && !c.has_cmd_word);
        match self.abort_floor {
            Some((obf, opf)) if obf < bt_depth || (obf == bt_depth && opf < pf) => None,
            Some((obf, opf)) if obf == bt_depth && opf == pf && !self.and_only_abort && !self.or_only_abort => {
                let is_sub_asg = new_scope == 2 && self.cmd_at(bt_depth, pf).is_some_and(|c| c.cur_assign_is_sub);
                if !(self.abort_scope == 1 && is_sub_asg && !self.fd0_in_redir_abort)
                    && (scope_rank(new_scope) >= scope_rank(self.abort_scope)
                        || (new_scope == 1 && self.sub_assign_abort.is_some()))
                {
                    let had_redir = self.abort_scope == 1;
                    self.abort_scope = new_scope;
                    self.in_failed_part = new_scope != 0;
                    if new_scope != 1 || !is_fd0_in {
                        self.fd0_in_redir_abort = false;
                    }
                    self.sub_assign_abort = (is_sub_asg && !had_redir).then_some((bt_depth, pf));
                }
                if self.nl_clear_depth.is_none() && bt_depth == 0 && paren_floor == 0 {
                    self.nl_clear_depth = Some(0);
                }
                Some((new_scope, bt_depth, pf))
            }
            _ => {
                self.abort_floor = Some((bt_depth, pf));
                self.abort_scope = new_scope;
                self.in_failed_part = new_scope != 0;
                self.fd0_in_redir_abort = is_fd0_in;
                self.sub_assign_abort = (new_scope == 2 && self.cmd_at(bt_depth, pf).is_some_and(|c| c.cur_assign_is_sub))
                    .then_some((bt_depth, pf));
                (self.and_only_abort, self.or_only_abort) = (false, false);
                self.nl_clear_depth = (bt_depth == 0 && paren_floor == 0).then_some(0);
                (self.continues_list, self.in_rhs_list, self.prev_ch) = (false, false, None);
                if pf == case.paren_depth() {
                    self.abort_in_case_body = case.in_case_body().map(|(cd, g)| (bt_depth, pf, cd, g));
                    if let Some((ci, is_elif_cond)) = case.if_branch_kind() {
                        if is_elif_cond {
                            self.abort_if_elif_cond = Some((bt_depth, pf, ci));
                            self.abort_if_branch = None;
                        } else {
                            self.abort_if_branch = Some((bt_depth, pf, ci));
                            self.abort_if_elif_cond = None;
                        }
                    } else {
                        (self.abort_if_branch, self.abort_if_elif_cond) = (None, None);
                    }
                    self.abort_while_hd_body = None;
                }
                Some((new_scope, bt_depth, pf))
            }
        }
    }

    pub(crate) fn trigger_bt_unclosed_sq(&mut self, target_bt_depth: usize, glued_after: bool, bufs: &mut BashBufs<'_>) {
        self.last_bt_glued = false;
        if let Some(pos) = self.snaps.iter().position(|s| s.kind == SnapKind::Bt && s.bt_depth >= target_bt_depth) {
            let snap = self.snaps[pos];
            let prefix = if snap.line < bufs.imp_lines.len() {
                &bufs.imp_lines[snap.line][..snap.imp_col.min(bufs.imp_lines[snap.line].len())]
            } else {
                &bufs.imp[..snap.imp_col.min(bufs.imp.len())]
            };
            self.last_bt_glued = ends_with_bash_assign_eq(prefix) || (glued_after && is_glued_bt_prefix(prefix));
            let fill = if self.last_bt_glued { 'x' } else { ' ' };
            mask_from_cursor_ch(bufs, snap.line, snap.imp_col, snap.code_col, true, fill);
            self.sq_code_snap = None;
            self.snaps.truncate(pos);
            self.cmd_snaps.retain(|s| s.bt_depth < target_bt_depth);
            self.restore_cmd_ready_bt(target_bt_depth.saturating_sub(1));
        }
        if self.abort_floor.is_some_and(|(bf, _)| target_bt_depth <= bf) {
            self.clear_abort_floor();
            self.prev_ch = None;
        }
    }
}
