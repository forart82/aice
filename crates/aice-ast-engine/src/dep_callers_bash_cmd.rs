use crate::dep_callers_bash_kw_char::{
    IdentKind, ident_kind, is_bash_kw, tok_is_subscript_lhs_prefix,
};

pub(crate) type Cursor = (usize, usize, usize);

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum CmdPartKind {
    Word,
    Assign,
    Redir,
}

#[derive(Clone)]
pub(crate) struct CmdSnap {
    pub(crate) bt_depth: usize,
    pub(crate) paren_depth: usize,
    pub(crate) start: Cursor,
    pub(crate) has_cmd_word: bool,
    pub(crate) has_non_sub_word: bool,
    pub(crate) tok_start: Option<Cursor>,
    pub(crate) tok_digits: bool,
    pub(crate) tok_buf: String,
    pub(crate) cur_assign: Option<Cursor>,
    pub(crate) cur_assign_is_sub: bool,
    pub(crate) in_lhs_sub: bool,
    pub(crate) lhs_sub_abort: bool,
    pub(crate) pending_lhs_sub_floor: bool,
    pub(crate) cur_redir: Option<(Cursor, u8)>,
    pub(crate) cur_redir_is_fd0_in: bool,
    pub(crate) assign_name_end: Option<(Cursor, Cursor)>,
    pub(crate) assign_spans: Vec<(Cursor, Cursor)>,
    pub(crate) sub_assign_spans: Vec<(Cursor, Cursor)>,
    pub(crate) assign_name_spans: Vec<(Cursor, Cursor)>,
    pub(crate) redir_spans: Vec<(Cursor, Cursor)>,
    pub(crate) bare_word_spans: Vec<(Cursor, Cursor)>,
    time_state: u8,
}

impl CmdSnap {
    pub(crate) fn new(bt_depth: usize, paren_depth: usize, start: Cursor) -> Self {
        Self {
            bt_depth,
            paren_depth,
            start,
            has_cmd_word: false,
            has_non_sub_word: false,
            tok_start: None,
            tok_digits: true,
            tok_buf: String::new(),
            cur_assign: None,
            cur_assign_is_sub: false,
            in_lhs_sub: false,
            lhs_sub_abort: false,
            pending_lhs_sub_floor: false,
            cur_redir: None,
            cur_redir_is_fd0_in: false,
            assign_name_end: None,
            assign_spans: Vec::new(),
            sub_assign_spans: Vec::new(),
            assign_name_spans: Vec::new(),
            redir_spans: Vec::new(),
            bare_word_spans: Vec::new(),
            time_state: 0,
        }
    }

    pub(crate) fn on_part_open(&mut self, cur: Cursor, is_cmdsub: bool) {
        if let Some((s, st)) = self.cur_redir {
            if st != 2 {
                self.cur_redir = Some((s, 2));
            }
        } else if self.cur_assign.is_none() {
            if !self.has_cmd_word && self.cur_redir.is_none() && tok_is_subscript_lhs_prefix(&self.tok_buf) {
                self.in_lhs_sub = true;
                return;
            }
            if is_cmdsub && self.tok_buf == "$" {
                self.tok_start = None;
                self.tok_buf.clear();
                self.tok_digits = true;
            }
            self.flush_bare_word(cur, true);
            self.has_cmd_word = true;
            if !is_cmdsub {
                self.has_non_sub_word = true;
            }
            self.time_state = 0;
        }
    }

    pub(crate) fn flush_on_newline(&mut self, cur: Cursor) {
        self.flush_assign(cur);
        self.flush_redir(cur);
        self.flush_bare_word(cur, true);
    }

    fn flush_bare_word(&mut self, cur: Cursor, record_span: bool) {
        if let Some(ts) = self.tok_start.take() {
            let is_kw = is_bash_kw(&self.tok_buf, self.time_state);
            if !self.tok_buf.is_empty() && !is_kw {
                if record_span {
                    self.has_cmd_word = true;
                    self.has_non_sub_word = true;
                    self.bare_word_spans.push((ts, cur));
                }
                self.time_state = 0;
            } else {
                self.time_state = if !record_span || self.has_cmd_word {
                    0
                } else if self.tok_buf == "time" {
                    1
                } else if self.tok_buf == "-p" && self.time_state == 1 {
                    2
                } else if self.tok_buf == "--" && matches!(self.time_state, 1 | 2) {
                    3
                } else {
                    0
                };
            }
            self.tok_digits = true;
            self.tok_buf.clear();
        }
    }

    pub(crate) fn has_lhs_sub_abort(&self) -> bool {
        (self.lhs_sub_abort || self.pending_lhs_sub_floor) && !self.has_non_sub_word
    }

    pub(crate) fn take_lhs_sub_floor(&mut self) -> bool {
        let out = self.pending_lhs_sub_floor;
        self.pending_lhs_sub_floor = false;
        out
    }

    pub(crate) fn flush_assign(&mut self, cur: Cursor) {
        if let Some(s) = self.cur_assign.take() {
            self.assign_spans.push((s, cur));
            if self.cur_assign_is_sub {
                self.sub_assign_spans.push((s, cur));
                self.cur_assign_is_sub = false;
                if self.lhs_sub_abort {
                    self.lhs_sub_abort = false;
                    if !self.has_non_sub_word {
                        self.pending_lhs_sub_floor = true;
                    }
                }
            }
            if let Some(ns) = self.assign_name_end.take() {
                self.assign_name_spans.push(ns);
            }
        }
    }

    pub(crate) fn flush_redir(&mut self, cur: Cursor) {
        if let Some((s, st)) = self.cur_redir.take() && st == 2 {
            self.redir_spans.push((s, cur));
        }
        self.cur_redir_is_fd0_in = false;
    }

    pub(crate) fn step_char(
        &mut self,
        ch: char,
        next: Option<char>,
        prev_ch: Option<char>,
        is_heredoc_op: bool,
        cur: Cursor,
    ) {
        if ch == ';'
            || (ch == '|' && prev_ch != Some('>'))
            || (ch == '&' && next != Some('>') && !matches!(prev_ch, Some('>' | '<' | '&')))
        {
            self.flush_assign(cur);
            self.flush_redir(cur);
            self.flush_bare_word(cur, true);
            return;
        }
        if matches!(ch, ' ' | '\t') {
            if self.cur_assign.is_some() {
                self.flush_assign(cur);
            } else if let Some((s, st)) = self.cur_redir {
                if st == 2 {
                    self.redir_spans.push((s, cur));
                    self.cur_redir = None;
                    self.cur_redir_is_fd0_in = false;
                } else if st == 0 {
                    self.cur_redir = Some((s, 1));
                }
            } else {
                self.flush_bare_word(cur, true);
            }
            return;
        }
        if matches!(ch, '>' | '<') {
            if next == Some('(') {
                self.on_part_open(cur, false);
            } else if is_heredoc_op {
                self.flush_assign(cur);
                self.flush_redir(cur);
                self.flush_bare_word(cur, !self.tok_digits);
                self.time_state = 0;
            } else if !matches!(self.cur_redir, Some((_, 0))) {
                self.flush_assign(cur);
                self.flush_redir(cur);
                let is_fd0 = ch == '<' && !matches!(next, Some('<' | '&'))
                    && (self.tok_start.is_none() || (self.tok_digits && self.tok_buf == "0"));
                let start = self.tok_start.filter(|_| self.tok_digits).unwrap_or(cur);
                self.cur_redir = Some((start, 0));
                self.cur_redir_is_fd0_in = is_fd0;
                self.flush_bare_word(cur, !self.tok_digits);
                self.time_state = 0;
            }
            return;
        }
        if ch == '&' && next == Some('>') {
            self.flush_assign(cur);
            self.flush_redir(cur);
            self.cur_redir = Some((cur, 0));
            self.cur_redir_is_fd0_in = false;
            self.flush_bare_word(cur, true);
            self.time_state = 0;
            return;
        }
        if let Some((s, st)) = self.cur_redir {
            if st == 0 && ch == '&' {
                self.cur_redir_is_fd0_in = false;
            }
            if st != 2 && !(st == 0 && (ch == '&' || (ch == '|' && prev_ch == Some('>')))) {
                self.cur_redir = Some((s, 2));
            }
            return;
        }
        if self.cur_assign.is_none() {
            if self.in_lhs_sub {
                if ch == ']' {
                    self.tok_buf.push_str("x]");
                    self.in_lhs_sub = false;
                }
                return;
            }
            let ident_k = if ch == '=' && !self.has_cmd_word && self.tok_start.is_some() {
                ident_kind(&self.tok_buf)
            } else {
                IdentKind::Invalid
            };
            if ident_k != IdentKind::Invalid {
                self.cur_assign = self.tok_start.take();
                self.cur_assign_is_sub = ident_k == IdentKind::Subscript;
                self.assign_name_end = self.cur_assign.map(|s| (s, (cur.0, cur.1 + 1, cur.2 + 1)));
                self.tok_buf.clear();
                self.time_state = 0;
            } else if !matches!(ch, '(' | ')' | '{' | '}' | '&') {
                if self.tok_start.is_none() {
                    self.tok_start = Some(cur);
                    self.tok_digits = true;
                    self.tok_buf.clear();
                }
                if !ch.is_ascii_digit() {
                    self.tok_digits = false;
                }
                self.tok_buf.push(ch);
            }
        }
    }
}

