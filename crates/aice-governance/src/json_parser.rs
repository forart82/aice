use std::collections::BTreeMap;

use crate::json::{JsonError, JsonValue};

const MAX_JSON_DEPTH: usize = 128;

pub fn parse_json(input: &str) -> Result<JsonValue, JsonError> {
    let input = input.trim_start_matches('\u{FEFF}');
    let mut parser = Parser {
        bytes: input.as_bytes(),
        pos: 0,
        depth: 0,
    };
    parser.skip_ws();
    let val = parser.parse_value()?;
    parser.skip_ws();
    if parser.pos != parser.bytes.len() {
        return Err(parser.err("trailing characters after JSON value"));
    }
    Ok(val)
}

struct Parser<'a> {
    bytes: &'a [u8],
    pos: usize,
    depth: usize,
}

impl<'a> Parser<'a> {
    fn err(&self, msg: &str) -> JsonError {
        JsonError {
            message: msg.to_string(),
            offset: self.pos,
        }
    }

    fn skip_ws(&mut self) {
        while let Some(&b) = self.bytes.get(self.pos) {
            if matches!(b, b' ' | b'\t' | b'\n' | b'\r') {
                self.pos += 1;
            } else {
                break;
            }
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn parse_value(&mut self) -> Result<JsonValue, JsonError> {
        self.skip_ws();
        match self.peek() {
            Some(b'n') => self.expect_lit(b"null", JsonValue::Null),
            Some(b't') => self.expect_lit(b"true", JsonValue::Bool(true)),
            Some(b'f') => self.expect_lit(b"false", JsonValue::Bool(false)),
            Some(b'"') => self.parse_string().map(JsonValue::String),
            Some(b'[') => self.parse_array(),
            Some(b'{') => self.parse_object(),
            Some(b'-' | b'0'..=b'9') => self.parse_number(),
            _ => Err(self.err("unexpected token")),
        }
    }

    fn expect_lit(&mut self, lit: &[u8], val: JsonValue) -> Result<JsonValue, JsonError> {
        if self.bytes[self.pos..].starts_with(lit) {
            self.pos += lit.len();
            Ok(val)
        } else {
            Err(self.err("invalid literal"))
        }
    }

    fn parse_string(&mut self) -> Result<String, JsonError> {
        self.pos += 1;
        let mut out = String::new();
        while let Some(&b) = self.bytes.get(self.pos) {
            if b == b'"' {
                self.pos += 1;
                return Ok(out);
            }
            if b == b'\\' {
                self.pos += 1;
                let esc = *self
                    .bytes
                    .get(self.pos)
                    .ok_or_else(|| self.err("unterminated escape"))?;
                self.pos += 1;
                match esc {
                    b'"' => out.push('"'),
                    b'\\' => out.push('\\'),
                    b'/' => out.push('/'),
                    b'b' => out.push('\u{0008}'),
                    b'f' => out.push('\u{000c}'),
                    b'n' => out.push('\n'),
                    b'r' => out.push('\r'),
                    b't' => out.push('\t'),
                    b'u' => out.push(self.parse_unicode_escape()?),
                    _ => return Err(self.err("invalid escape sequence")),
                }
            } else if b < 0x20 {
                return Err(self.err("unescaped control character in string"));
            } else {
                let s = std::str::from_utf8(&self.bytes[self.pos..])
                    .map_err(|_| self.err("invalid utf-8 in string"))?;
                let ch = s.chars().next().ok_or_else(|| self.err("unexpected eof"))?;
                out.push(ch);
                self.pos += ch.len_utf8();
            }
        }
        Err(self.err("unterminated string"))
    }

    fn parse_unicode_escape(&mut self) -> Result<char, JsonError> {
        let code = self.parse_hex4()?;
        if (0xD800..=0xDBFF).contains(&code) {
            if self.bytes.get(self.pos..self.pos + 2) != Some(b"\\u") {
                return Err(self.err("unpaired high UTF-16 surrogate"));
            }
            self.pos += 2;
            let low = self.parse_hex4()?;
            if !(0xDC00..=0xDFFF).contains(&low) {
                return Err(self.err("invalid low UTF-16 surrogate"));
            }
            let combined = 0x10000 + (((code - 0xD800) << 10) | (low - 0xDC00));
            return char::from_u32(combined).ok_or_else(|| self.err("invalid surrogate scalar"));
        }
        if (0xDC00..=0xDFFF).contains(&code) {
            return Err(self.err("unpaired low UTF-16 surrogate"));
        }
        char::from_u32(code).ok_or_else(|| self.err("invalid unicode scalar"))
    }

    fn parse_hex4(&mut self) -> Result<u32, JsonError> {
        if self.pos + 4 > self.bytes.len() {
            return Err(self.err("truncated \\u escape"));
        }
        let hex = std::str::from_utf8(&self.bytes[self.pos..self.pos + 4])
            .map_err(|_| self.err("invalid hex"))?;
        if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(self.err("invalid hex digits"));
        }
        self.pos += 4;
        u32::from_str_radix(hex, 16).map_err(|_| self.err("invalid hex digits"))
    }
    fn parse_number(&mut self) -> Result<JsonValue, JsonError> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        match self.peek() {
            Some(b'0') => {
                self.pos += 1;
                if matches!(self.peek(), Some(b'0'..=b'9')) {
                    return Err(self.err("leading zeros not allowed in JSON number"));
                }
            }
            Some(b'1'..=b'9') => {
                while matches!(self.peek(), Some(b'0'..=b'9')) {
                    self.pos += 1;
                }
            }
            _ => return Err(self.err("invalid JSON number")),
        }
        if self.peek() == Some(b'.') {
            self.pos += 1;
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(self.err("expected digit after decimal point"));
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.pos += 1;
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.pos += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.pos += 1;
            }
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(self.err("expected digit in exponent"));
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.pos += 1;
            }
        }
        let raw = std::str::from_utf8(&self.bytes[start..self.pos])
            .map_err(|_| self.err("invalid utf-8 number"))?;
        let num = raw.parse::<f64>().map_err(|_| self.err("invalid number"))?;
        if !num.is_finite() {
            return Err(self.err("non-finite JSON number"));
        }
        Ok(JsonValue::Number(num))
    }

    fn parse_array(&mut self) -> Result<JsonValue, JsonError> {
        self.depth += 1;
        if self.depth > MAX_JSON_DEPTH {
            return Err(self.err("JSON nesting depth exceeded"));
        }
        self.pos += 1;
        let mut items = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b']') {
            self.pos += 1;
            self.depth -= 1;
            return Ok(JsonValue::Array(items));
        }
        loop {
            items.push(self.parse_value()?);
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b']') => {
                    self.pos += 1;
                    self.depth -= 1;
                    return Ok(JsonValue::Array(items));
                }
                _ => return Err(self.err("expected ',' or ']'")),
            }
        }
    }

    fn parse_object(&mut self) -> Result<JsonValue, JsonError> {
        self.depth += 1;
        if self.depth > MAX_JSON_DEPTH {
            return Err(self.err("JSON nesting depth exceeded"));
        }
        self.pos += 1;
        let mut map = BTreeMap::new();
        self.skip_ws();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            self.depth -= 1;
            return Ok(JsonValue::Object(map));
        }
        loop {
            self.skip_ws();
            if self.peek() != Some(b'"') {
                return Err(self.err("expected object key"));
            }
            let key = self.parse_string()?;
            self.skip_ws();
            if self.peek() != Some(b':') {
                return Err(self.err("expected ':'"));
            }
            self.pos += 1;
            let val = self.parse_value()?;
            map.insert(key, val);
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b'}') => {
                    self.pos += 1;
                    self.depth -= 1;
                    return Ok(JsonValue::Object(map));
                }
                _ => return Err(self.err("expected ',' or '}'")),
            }
        }
    }
}
