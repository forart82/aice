use crate::ir::{Span, TranspileError};
use crate::lexer_scan::{RawKind, RawTok};
use crate::lexer_tokens::TokenKind;

pub(crate) struct Scanner<'a> {
    pub src: &'a str,
    pub b: &'a [u8],
    pub i: usize,
    pub line: usize,
    pub line_start: usize,
    pub at_line_start: bool,
    pub at_stmt_start: bool,
    pub on_import_line: bool,
    pub prev_val_tok: bool,
    pub template_stack: Vec<usize>,
    pub out: Vec<RawTok>,
}

impl<'a> Scanner<'a> {
    pub fn new(src: &'a str) -> Self {
        Self {
            src,
            b: src.as_bytes(),
            i: 0,
            line: 1,
            line_start: 0,
            at_line_start: true,
            at_stmt_start: true,
            on_import_line: false,
            prev_val_tok: false,
            template_stack: Vec::new(),
            out: Vec::new(),
        }
    }

    pub fn col(&self, pos: usize) -> usize {
        pos.saturating_sub(self.line_start) + 1
    }

    pub fn peek(&self, offset: usize) -> Option<u8> {
        self.b.get(self.i + offset).copied()
    }

    pub fn next_char(&mut self) -> char {
        let ch = self.src[self.i..].chars().next().unwrap_or('\0');
        self.i += ch.len_utf8();
        ch
    }

    pub fn push_tok(&mut self, kind: TokenKind, lexeme: String, start: usize, end: usize) {
        self.at_stmt_start = false;
        self.prev_val_tok = matches!(
            kind,
            TokenKind::Ident | TokenKind::Number | TokenKind::String | TokenKind::TripleString
                | TokenKind::Boolean | TokenKind::Nil | TokenKind::HexColor | TokenKind::Regex
                | TokenKind::TemplateTail | TokenKind::TemplateNoSubst | TokenKind::MacroBody | TokenKind::Turbofish
                | TokenKind::RParen | TokenKind::RBracket | TokenKind::RBrace
                | TokenKind::PlusPlus | TokenKind::MinusMinus | TokenKind::Question
        );
        if matches!(kind, TokenKind::Module | TokenKind::From | TokenKind::Import) {
            self.on_import_line = true;
        }
        let sp = Span::new(self.line, self.col(start), start, end);
        self.out.push(RawTok { kind: RawKind::Tok(kind, lexeme), span: sp });
    }

    pub fn scan_hash(&mut self, start: usize) -> Result<(), TranspileError> {
        let mut k = self.i + 1;
        while k < self.b.len() && self.b[k].is_ascii_hexdigit() {
            k += 1;
        }
        let hex_len = k - (self.i + 1);
        let next_ok = k >= self.b.len()
            || !(self.b[k].is_ascii_alphanumeric() || self.b[k] == b'_' || self.b[k] == b'-');
        if matches!(hex_len, 3 | 4 | 6 | 8) && next_ok {
            self.i = k;
            self.push_tok(TokenKind::HexColor, self.src[start..k].to_string(), start, k);
            return Ok(());
        }
        if matches!(self.peek(1), None | Some(b' ' | b'\t' | b'\r' | b'\n' | b'#' | b'!')) {
            self.i += 1;
            let t0 = self.i;
            while self.i < self.b.len() && self.b[self.i] != b'\n' {
                self.i += 1;
            }
            let raw = self.src[t0..self.i].trim_end_matches('\r');
            let text = raw.strip_prefix(' ').unwrap_or(raw).to_string();
            self.push_tok(TokenKind::Comment, text, start, self.i);
            return Ok(());
        }
        self.i += 1;
        self.push_tok(TokenKind::Hash, "#".to_string(), start, self.i);
        Ok(())
    }

    pub fn scan_block_comment(&mut self, start: usize) -> Result<(), TranspileError> {
        let (sl, sc) = (self.line, self.col(start));
        self.i += 2;
        let t0 = self.i;
        while self.i + 1 < self.b.len() {
            if self.b[self.i] == b'*' && self.b[self.i + 1] == b'/' {
                let raw = self.src[t0..self.i].trim().to_string();
                self.i += 2;
                self.push_tok(TokenKind::Comment, raw, start, self.i);
                return Ok(());
            }
            if self.b[self.i] == b'\n' {
                self.line += 1;
                self.line_start = self.i + 1;
            }
            self.i += 1;
        }
        Err(TranspileError::at("Unclosed block comment", Span::new(sl, sc, start, self.i)))
    }

    pub fn looks_like_regex(&self) -> bool {
        let mut k = self.i + 1;
        let mut in_cls = false;
        while k < self.b.len() {
            let c = self.b[k];
            if c == b'\n' || c == b'\r' {
                return false;
            }
            if c == b'\\' { k += 2; continue; }
            if c == b'[' { in_cls = true; }
            else if c == b']' { in_cls = false; }
            else if c == b'/' && !in_cls { return k > self.i + 1; }
            k += 1;
        }
        false
    }

    pub fn scan_regex(&mut self, start: usize) -> Result<(), TranspileError> {
        self.i += 1;
        let mut in_cls = false;
        while self.i < self.b.len() {
            let c = self.b[self.i];
            if c == b'\\' && self.i + 1 < self.b.len() { self.i += 2; continue; }
            if c == b'[' { in_cls = true; }
            else if c == b']' { in_cls = false; }
            else if c == b'/' && !in_cls {
                self.i += 1;
                while self.i < self.b.len() && self.b[self.i].is_ascii_alphabetic() {
                    self.i += 1;
                }
                self.push_tok(TokenKind::Regex, self.src[start..self.i].to_string(), start, self.i);
                return Ok(());
            }
            self.i += 1;
        }
        Err(TranspileError::at("Unclosed regex literal", Span::new(self.line, self.col(start), start, self.i)))
    }

    pub fn scan_quote(&mut self, start: usize, q: u8) -> Result<(), TranspileError> {
        if self.peek(1) == Some(q) && self.peek(2) == Some(q) {
            return self.scan_triple_quote(start, q);
        }
        self.i += 1;
        let mut val = String::new();
        while self.i < self.b.len() {
            let c = self.b[self.i];
            if c == b'\n' { break; }
            if c == q {
                self.i += 1;
                self.push_tok(TokenKind::String, val, start, self.i);
                return Ok(());
            }
            if c == b'\\' && self.i + 1 < self.b.len() {
                val.push(self.unescape());
                continue;
            }
            let ch = self.next_char();
            val.push(ch);
        }
        Err(TranspileError::at("Unclosed string literal", Span::new(self.line, self.col(start), start, self.i)))
    }

    fn scan_triple_quote(&mut self, start: usize, q: u8) -> Result<(), TranspileError> {
        let (sl, sc) = (self.line, self.col(start));
        self.i += 3;
        if self.b.get(self.i) == Some(&b'\r') { self.i += 1; }
        if self.b.get(self.i) == Some(&b'\n') {
            self.i += 1;
            self.line += 1;
            self.line_start = self.i;
        }
        let body_start = self.i;
        while self.i + 2 < self.b.len() {
            if self.b[self.i] == q && self.b[self.i + 1] == q && self.b[self.i + 2] == q {
                let mut val = self.src[body_start..self.i].to_string();
                if val.ends_with('\n') { val.pop(); if val.ends_with('\r') { val.pop(); } }
                self.i += 3;
                self.push_tok(TokenKind::TripleString, val, start, self.i);
                return Ok(());
            }
            if self.b[self.i] == b'\n' { self.line += 1; self.line_start = self.i + 1; }
            self.i += 1;
        }
        Err(TranspileError::at("Unclosed triple-quoted string", Span::new(sl, sc, start, self.i)))
    }

    pub fn scan_template(&mut self, start: usize, is_open: bool) -> Result<(), TranspileError> {
        let (sl, sc) = (self.line, self.col(start));
        if is_open { self.i += 1; }
        let mut val = String::new();
        while self.i < self.b.len() {
            let c = self.b[self.i];
            if c == b'`' {
                self.i += 1;
                let k = if is_open { TokenKind::TemplateNoSubst } else { TokenKind::TemplateTail };
                self.push_tok(k, val, start, self.i);
                return Ok(());
            }
            if c == b'$' && self.peek(1) == Some(b'{') {
                self.i += 2;
                self.template_stack.push(0);
                let k = if is_open { TokenKind::TemplateHead } else { TokenKind::TemplateMiddle };
                self.push_tok(k, val, start, self.i);
                return Ok(());
            }
            if c == b'\\' && self.i + 1 < self.b.len() { val.push(self.unescape()); continue; }
            if c == b'\n' { self.line += 1; self.line_start = self.i + 1; }
            let ch = self.next_char();
            val.push(ch);
        }
        Err(TranspileError::at("Unclosed template literal", Span::new(sl, sc, start, self.i)))
    }

    fn unescape(&mut self) -> char {
        self.i += 1;
        match self.next_char() {
            'n' => '\n', 't' => '\t', 'r' => '\r', '0' => '\0',
            '\\' => '\\', '"' => '"', '\'' => '\'', '`' => '`', other => other,
        }
    }
}
