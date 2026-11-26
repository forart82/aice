pub(crate) fn bash_eol_continues(bs: usize, bt_depth: usize, in_sq: bool) -> bool {
    if bs == 0 {
        return false;
    }
    if in_sq {
        bt_depth > 0 && (bs.trailing_zeros() as usize) < bt_depth
    } else {
        (bs.trailing_zeros() as usize) <= bt_depth
    }
}

pub(crate) fn bash_eol_surviving_bs(bs: usize, bt_depth: usize, in_sq: bool) -> usize {
    let mut rem = bs;
    for layer in 0..bt_depth {
        if rem % 2 == 1 {
            return ((rem - 1) / 2) << (layer + 1);
        }
        rem /= 2;
    }
    if in_sq { rem << bt_depth } else { ((rem / 2) * 2) << bt_depth }
}

pub(crate) fn bash_end_line_bs(ansi_sq: bool, bt_depth: usize, bs: usize) -> usize {
    if ansi_sq && bt_depth > 0 && bash_eol_continues(bs, bt_depth, true) {
        bash_eol_surviving_bs(bs, bt_depth, true)
    } else {
        0
    }
}

pub(crate) fn bash_dq_eol_continues(bs: usize, bt_depth: usize, in_ansi_sq: bool) -> bool {
    if bs == 0 {
        return false;
    }
    if (bs.trailing_zeros() as usize) < bt_depth {
        return true;
    }
    let rem = bs >> bt_depth.min(63);
    if in_ansi_sq { matches!(rem % 4, 1 | 2) } else { rem % 2 == 1 }
}

pub(crate) fn bash_dq_eol_surviving_bs(bs: usize, bt_depth: usize, in_ansi_sq: bool) -> usize {
    let mut rem = bs;
    for layer in 0..bt_depth {
        if rem % 2 == 1 {
            return ((rem - 1) / 2) << (layer + 1);
        }
        rem /= 2;
    }
    if in_ansi_sq { 0 } else { ((rem / 2) * 2) << bt_depth }
}

pub(crate) fn bash_sq_suppresses_dollar_ansi(bs: usize, bt_depth: usize, in_ansi_sq: bool) -> bool {
    bs > 0
        && (bs.trailing_zeros() as usize) >= bt_depth
        && bash_dq_eol_surviving_bs(bs, bt_depth, in_ansi_sq) == 0
}

pub(crate) fn bash_end_line_reset_dollar(
    bs: usize,
    d: usize,
    in_dq_sq: bool,
    in_ansi_sq: bool,
    escaped: bool,
) -> bool {
    let sq_bt_reset = d > 0
        && in_dq_sq
        && ((bs.trailing_zeros() as usize) == d || (in_ansi_sq && bash_sq_suppresses_dollar_ansi(bs, d, true)));
    !escaped
        && (sq_bt_reset
            || !(bash_dq_eol_continues(bs, d, in_ansi_sq)
                && bash_dq_eol_surviving_bs(bs, d, in_ansi_sq) == 0))
}

#[derive(Default)]
pub(crate) struct ContLineAccum {
    pub(crate) cur_imp: String,
    pub(crate) cur_code: String,
    pub(crate) carry: String,
    pub(crate) cont_slots: usize,
    pub(crate) sq_carry_bs: usize,
}

impl ContLineAccum {
    pub(crate) fn prepare<'a>(&mut self, raw: &'a str, is_ansi_sq: bool, buf: &'a mut String) -> (&'a str, usize) {
        if !self.carry.is_empty() {
            *buf = format!("{}{raw}", std::mem::take(&mut self.carry));
            (buf.as_str(), 0)
        } else if self.sq_carry_bs > 0 {
            let bs = std::mem::take(&mut self.sq_carry_bs);
            if is_ansi_sq {
                *buf = format!("{}{raw}", "\\".repeat(bs));
                (buf.as_str(), bs)
            } else {
                (raw, 0)
            }
        } else {
            (raw, 0)
        }
    }

    pub(crate) fn prev_joined(&self) -> Option<u8> {
        (self.cont_slots > 0)
            .then(|| self.cur_imp.as_bytes().last().copied())
            .flatten()
    }

    pub(crate) fn on_cont_hd(
        &mut self,
        bs: usize,
        bt_depth: usize,
        in_sq: bool,
        imp_pos: usize,
        code_pos: usize,
    ) -> bool {
        if imp_pos > self.cur_imp.len() || code_pos > self.cur_code.len()
            || !self.cur_code[code_pos..].starts_with("<<")
        {
            return false;
        }
        self.cont_slots += 1;
        let surv = bash_eol_surviving_bs(bs, bt_depth, in_sq);
        let prefix = self.cur_imp.split_off(imp_pos);
        self.cur_code.truncate(code_pos);
        self.carry = format!("{prefix}{}", "\\".repeat(surv));
        true
    }

    pub(crate) fn on_cont(
        &mut self,
        bs: usize,
        bt_depth: usize,
        (in_dq, in_ansi_sq): (bool, bool),
        in_code: bool,
        trail_dollar: bool,
        trail_lt: u8,
    ) {
        self.cont_slots += 1;
        let surv = bash_dq_eol_surviving_bs(bs, bt_depth, in_dq && in_ansi_sq);
        self.carry = "\\".repeat(surv);
        if trail_lt == 7 {
            if let Some(p2) = self.cur_code.rfind("<<")
                && let Some(p1) = if self.cur_imp.len() == self.cur_code.len() { Some(p2) } else { self.cur_imp.rfind("<<") }
            {
                let prefix = self.cur_imp.split_off(p1);
                self.cur_code.truncate(p2);
                self.carry = format!("{prefix}{}", self.carry);
            }
        } else if surv == 0 && (in_dq || in_code) && trail_dollar && self.cur_imp.ends_with('$') {
            self.cur_imp.pop();
            self.cur_code.pop();
            self.carry.push('$');
        } else if in_code && matches!(trail_lt, 1 | 2 | 4 | 5 | 6) && (surv == 0 || trail_lt != 1) {
            let mut ws = String::new();
            if matches!(trail_lt, 5 | 6) {
                while let Some(c @ (' ' | '\t')) = self.cur_imp.chars().next_back() {
                    self.cur_imp.pop();
                    self.cur_code.pop();
                    ws.push(c);
                }
            }
            let prefix = match trail_lt { 1 => "<", 2 | 5 => "<<", _ => "<<-" };
            if self.cur_imp.ends_with(prefix) {
                for _ in 0..prefix.len() { self.cur_imp.pop(); self.cur_code.pop(); }
                let mut next = String::from(prefix);
                for c in ws.chars().rev() { next.push(c); }
                next.push_str(&self.carry);
                self.carry = next;
            } else {
                for c in ws.chars().rev() { self.cur_imp.push(c); self.cur_code.push(c); }
            }
        }
    }

    pub(crate) fn finish_line(
        &mut self,
        work: &str,
        is_ansi_sq: bool,
        bt_depth: usize,
        imp_lines: &mut Vec<String>,
        code_lines: &mut Vec<String>,
    ) {
        if is_ansi_sq && bt_depth > 0 {
            let bs = work.as_bytes().iter().rev().take_while(|&&c| c == b'\\').count();
            if bash_eol_continues(bs, bt_depth, true) {
                self.sq_carry_bs = bash_eol_surviving_bs(bs, bt_depth, true);
            }
        }
        imp_lines.push(std::mem::take(&mut self.cur_imp));
        code_lines.push(std::mem::take(&mut self.cur_code));
        for _ in 0..self.cont_slots {
            imp_lines.push(String::new());
            code_lines.push(String::new());
        }
        self.cont_slots = 0;
    }

    pub(crate) fn flush_eof(&mut self, imp_lines: &mut Vec<String>, code_lines: &mut Vec<String>) {
        self.carry.clear();
        self.sq_carry_bs = 0;
        if self.cont_slots > 0 {
            imp_lines.push(std::mem::take(&mut self.cur_imp));
            code_lines.push(std::mem::take(&mut self.cur_code));
            for _ in 1..self.cont_slots {
                imp_lines.push(String::new());
                code_lines.push(String::new());
            }
            self.cont_slots = 0;
        }
    }
}

pub(crate) use crate::dep_callers_bash_sq::{
    bash_continues_bt_hash_comment, bash_find_bt_after_hash, step_bash_sq,
};
pub(crate) use crate::dep_callers_heredoc::try_parse_bash_heredoc_in_bt;
