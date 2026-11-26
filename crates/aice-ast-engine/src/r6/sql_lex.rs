use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex_scan::{
    scan_block_comment, scan_bracket, scan_dollar, scan_param, scan_punct, scan_quoted,
};

#[derive(Debug, Clone)]
pub struct LineIndex {
    starts: Vec<usize>,
    len: usize,
}

impl LineIndex {
    pub fn new(src: &str) -> Self {
        let mut starts = vec![0];
        for (i, b) in src.bytes().enumerate() {
            if b == b'\n' {
                starts.push(i + 1);
            }
        }
        Self { starts, len: src.len() }
    }

    pub fn line_col(&self, byte: usize) -> (usize, usize) {
        let b = byte.min(self.len);
        let idx = self.starts.partition_point(|&s| s <= b);
        let line = idx.max(1);
        let start = self.starts[line - 1];
        (line, b.saturating_sub(start) + 1)
    }

    pub fn end_line(&self, src: &str, start_byte: usize, end_byte: usize) -> usize {
        let b = src.as_bytes();
        let end = end_byte.min(b.len());
        if end > start_byte && b[end - 1] == b'\n' {
            self.line_col(end - 1).0.max(self.line_col(start_byte).0)
        } else {
            self.line_col(end.saturating_sub(1).max(start_byte)).0
        }
    }

    pub fn line_count(&self, src: &str) -> usize {
        src.lines().count().max(1)
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct LexOpts {
    pub allow_brackets: bool,
    pub allow_backtick: bool,
    pub allow_dollar: bool,
    pub allow_hash_comment: bool,
    pub nested_block_comments: bool,
    pub backslash_escape: bool,
    pub allow_at_var: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SqlTokKind {
    Word,
    QuotedIdent,
    BracketIdent,
    BacktickIdent,
    StringLit,
    DollarQuote { body_start: usize, body_end: usize },
    Number,
    Var,
    Param,
    Op,
    LParen,
    RParen,
    LBracket,
    RBracket,
    LBrace,
    RBrace,
    Comma,
    Semi,
    Dot,
    ColonColon,
    Comment,
}

#[derive(Debug, Clone, Copy)]
pub struct SqlTok {
    pub kind: SqlTokKind,
    pub start: usize,
    pub end: usize,
    pub line: usize,
    pub col: usize,
}

impl SqlTok {
    pub fn slice<'a>(&self, src: &'a str) -> &'a str {
        src.get(self.start..self.end).unwrap_or("")
    }

    pub fn is_kw(&self, src: &str, kw: &str) -> bool {
        self.kind == SqlTokKind::Word && self.slice(src).eq_ignore_ascii_case(kw)
    }

    pub fn is_op(&self, src: &str, op: &str) -> bool {
        self.kind == SqlTokKind::Op && self.slice(src) == op
    }

    pub fn ident_name(&self, src: &str) -> String {
        let raw = self.slice(src);
        match self.kind {
            SqlTokKind::QuotedIdent if raw.len() >= 2 => {
                raw[1..raw.len() - 1].replace("\"\"", "\"")
            }
            SqlTokKind::BracketIdent if raw.len() >= 2 => {
                raw[1..raw.len() - 1].replace("]]", "]")
            }
            SqlTokKind::BacktickIdent if raw.len() >= 2 => {
                raw[1..raw.len() - 1].replace("``", "`")
            }
            _ => raw.to_string(),
        }
    }
}

pub fn sp(line: usize, col: usize, msg: impl Into<String>) -> ErrorSpan {
    ErrorSpan { line, column: col, end_line: line, message: msg.into() }
}

pub fn lex_sql(src: &str, opts: LexOpts) -> (Vec<SqlTok>, Vec<ErrorSpan>, LineIndex) {
    let li = LineIndex::new(src);
    let b = src.as_bytes();
    let mut toks = Vec::new();
    let mut errs = Vec::new();
    let mut i = 0;

    while i < b.len() {
        if b[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }
        let (line, col) = li.line_col(i);
        let ch = b[i];
        if ch == b'-' && i + 1 < b.len() && b[i + 1] == b'-' {
            let start = i;
            i += 2;
            while i < b.len() && b[i] != b'\n' { i += 1; }
            toks.push(SqlTok { kind: SqlTokKind::Comment, start, end: i, line, col });
        } else if opts.allow_hash_comment && ch == b'#' {
            let start = i;
            i += 1;
            while i < b.len() && b[i] != b'\n' { i += 1; }
            toks.push(SqlTok { kind: SqlTokKind::Comment, start, end: i, line, col });
        } else if ch == b'/' && i + 1 < b.len() && b[i + 1] == b'*' {
            i = scan_block_comment(b, i, line, col, opts.nested_block_comments, &mut toks, &mut errs);
        } else if ch == b'\'' {
            i = scan_quoted(src, i, b'\'', SqlTokKind::StringLit, "Unterminated string literal", opts.backslash_escape, line, col, &mut toks, &mut errs);
        } else if matches!(ch, b'N' | b'n' | b'E' | b'e' | b'B' | b'b' | b'X' | b'x')
            && i + 1 < b.len() && b[i + 1] == b'\''
        {
            let esc = opts.backslash_escape || matches!(ch, b'E' | b'e');
            i = scan_quoted(src, i + 1, b'\'', SqlTokKind::StringLit, "Unterminated string literal", esc, line, col, &mut toks, &mut errs);
        } else if ch == b'"' {
            i = scan_quoted(src, i, b'"', SqlTokKind::QuotedIdent, "Unterminated quoted identifier", false, line, col, &mut toks, &mut errs);
        } else if opts.allow_backtick && ch == b'`' {
            i = scan_quoted(src, i, b'`', SqlTokKind::BacktickIdent, "Unterminated backtick identifier", false, line, col, &mut toks, &mut errs);
        } else if opts.allow_brackets && ch == b'[' {
            i = scan_bracket(src, i, line, col, &mut toks, &mut errs);
        } else if opts.allow_dollar && ch == b'$' {
            if let Some(next_i) = scan_dollar(src, i, line, col, &mut toks, &mut errs) {
                i = next_i;
            } else {
                i = scan_param(b, i, line, col, &mut toks);
            }
        } else if ch == b'$' {
            i = scan_param(b, i, line, col, &mut toks);
        } else if ch == b'@' {
            if !opts.allow_at_var {
                if i + 1 < b.len() && (b[i + 1] == b'>' || b[i + 1] == b'@') {
                    toks.push(SqlTok { kind: SqlTokKind::Op, start: i, end: i + 2, line, col });
                    i += 2;
                } else if i + 1 < b.len() && is_ident_cont(b[i + 1]) {
                    let start = i;
                    i += 1;
                    while i < b.len() && is_ident_cont(b[i]) { i += 1; }
                    toks.push(SqlTok { kind: SqlTokKind::Param, start, end: i, line, col });
                } else {
                    toks.push(SqlTok { kind: SqlTokKind::Op, start: i, end: i + 1, line, col });
                    i += 1;
                }
            } else if is_at_host_op(src, b, i, &toks) {
                toks.push(SqlTok { kind: SqlTokKind::Op, start: i, end: i + 1, line, col });
                i += 1;
            } else {
                let start = i;
                i += 1;
                if i < b.len() && b[i] == b'@' { i += 1; }
                while i < b.len() && is_ident_cont(b[i]) { i += 1; }
                if i == start + 1 || (i == start + 2 && b[start + 1] == b'@') {
                    errs.push(sp(line, col, "Empty '@' variable identifier"));
                }
                toks.push(SqlTok { kind: SqlTokKind::Var, start, end: i, line, col });
            }
        } else if !opts.allow_at_var && ch == b'<' && i + 1 < b.len() && b[i + 1] == b'@' {
            toks.push(SqlTok { kind: SqlTokKind::Op, start: i, end: i + 2, line, col });
            i += 2;
        } else if ch.is_ascii_digit() {
            let start = i;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'.' || b[i] == b'_') {
                i += 1;
            }
            toks.push(SqlTok { kind: SqlTokKind::Number, start, end: i, line, col });
        } else if is_ident_start(src, i) {
            let start = i;
            while i < b.len() {
                if b[i].is_ascii_alphanumeric() || b[i] == b'_' || b[i] == b'$' {
                    i += 1;
                } else if b[i] >= 0x80 {
                    let c = src[i..].chars().next().unwrap_or('\0');
                    if c.is_alphanumeric() { i += c.len_utf8(); } else { break; }
                } else {
                    break;
                }
            }
            toks.push(SqlTok { kind: SqlTokKind::Word, start, end: i, line, col });
        } else if ch == b':' && i + 1 < b.len() && b[i + 1] == b':' {
            toks.push(SqlTok { kind: SqlTokKind::ColonColon, start: i, end: i + 2, line, col });
            i += 2;
        } else {
            i = scan_punct(src, i, line, col, &mut toks);
        }
    }
    (toks, errs, li)
}

fn is_ident_start(src: &str, i: usize) -> bool {
    let b = src.as_bytes()[i];
    b.is_ascii_alphabetic() || b == b'_' || (b >= 0x80 && src[i..].chars().next().is_some_and(|c| c.is_alphabetic()))
}

fn is_ident_cont(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'$'
}

fn is_at_host_op(src: &str, b: &[u8], i: usize, toks: &[SqlTok]) -> bool {
    if matches!(b.get(i + 1).copied(), Some(b'\'' | b'`' | b'"')) {
        return true;
    }
    let mut k = i + 1;
    while k < b.len() && b[k].is_ascii_whitespace() {
        k += 1;
    }
    if k < b.len() && matches!(b[k], b'\'' | b'`' | b'"') {
        return toks.last().is_some_and(|p| {
            matches!(p.kind, SqlTokKind::StringLit | SqlTokKind::BacktickIdent | SqlTokKind::QuotedIdent)
                || (p.kind == SqlTokKind::Word && !p.is_kw(src, "SET") && !p.is_kw(src, "SELECT") && !p.is_kw(src, "RETURN"))
        });
    }
    false
}
