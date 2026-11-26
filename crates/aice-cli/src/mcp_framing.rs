use std::io::{self, Read};

use aice_governance::{JsonValue, parse_json};

use crate::mcp_framing_drain::drain_orphaned_body;
use crate::mcp_framing_probe::{
    HeaderProbe, find_header_end, inspect_header_state, read_chunk_into, starts_with_ci,
    trim_ascii_slice,
};

#[derive(Debug)]
pub enum FrameEvent {
    Message(JsonValue),
    ParseError,
}

pub struct McpFrameReader<R: Read> {
    reader: R,
    buf: Vec<u8>,
    eof: bool,
    is_framed: bool,
}

impl<R: Read> McpFrameReader<R> {
    pub fn new(reader: R) -> Self {
        Self { reader, buf: Vec::with_capacity(4096), eof: false, is_framed: false }
    }

    pub fn is_framed(&self) -> bool {
        self.is_framed
    }

    pub fn next_frame(&mut self) -> io::Result<Option<FrameEvent>> {
        loop {
            trim_leading_ws(&mut self.buf);
            if self.buf.is_empty() {
                if self.eof || self.read_chunk()? == 0 {
                    return Ok(None);
                }
                continue;
            }
            if let Some(has_cl_or_ct) = self.detect_framed_header()? {
                if has_cl_or_ct {
                    self.is_framed = true;
                }
                return self.read_content_length_frame();
            }
            if let Some(nl) = self.buf.iter().position(|&b| b == b'\n') {
                let raw: Vec<u8> = self.buf.drain(..=nl).collect();
                let trimmed = trim_ascii_slice(&raw);
                if !trimmed.is_empty() {
                    return Ok(Some(parse_utf8_json(trimmed)));
                }
                continue;
            }
            if self.eof {
                let raw = std::mem::take(&mut self.buf);
                let trimmed = trim_ascii_slice(&raw);
                return Ok((!trimmed.is_empty()).then(|| parse_utf8_json(trimmed)));
            }
            self.read_chunk()?;
        }
    }

    fn read_chunk(&mut self) -> io::Result<usize> {
        read_chunk_into(&mut self.reader, &mut self.buf, &mut self.eof)
    }

    fn detect_framed_header(&mut self) -> io::Result<Option<bool>> {
        loop {
            match inspect_header_state(&self.buf) {
                HeaderProbe::Complete { has_cl_or_ct } => return Ok(Some(has_cl_or_ct)),
                HeaderProbe::NotHeader => return Ok(None),
                HeaderProbe::NeedMore => {
                    if self.eof {
                        let has_cl_or_ct = self.buf.split(|&b| b == b'\n').any(|l| {
                            let t = trim_ascii_slice(l);
                            starts_with_ci(t, b"content-length:")
                                || starts_with_ci(t, b"content-type:")
                        });
                        return Ok(has_cl_or_ct.then_some(true));
                    }
                    self.read_chunk()?;
                }
            }
        }
    }

    fn read_content_length_frame(&mut self) -> io::Result<Option<FrameEvent>> {
        let (hdr_end, sep_len) = loop {
            if let Some(found) = find_header_end(&self.buf) {
                break found;
            }
            if self.eof {
                self.buf.clear();
                return Ok(Some(FrameEvent::ParseError));
            }
            self.read_chunk()?;
        };

        let header_str = String::from_utf8_lossy(&self.buf[..hdr_end]).into_owned();
        self.buf.drain(..hdr_end + sep_len);

        let Some(content_len) = parse_content_length_header(&header_str) else {
            drain_orphaned_body(&mut self.reader, &mut self.buf, &mut self.eof)?;
            return Ok(Some(FrameEvent::ParseError));
        };

        while self.buf.len() < content_len {
            if self.eof {
                self.buf.clear();
                return Ok(Some(FrameEvent::ParseError));
            }
            self.read_chunk()?;
        }

        let body: Vec<u8> = self.buf.drain(..content_len).collect();
        Ok(Some(parse_utf8_json(&body)))
    }
}

fn trim_leading_ws(buf: &mut Vec<u8>) {
    let skip = buf
        .iter()
        .take_while(|b| matches!(b, b' ' | b'\t' | b'\r' | b'\n'))
        .count();
    if skip > 0 {
        buf.drain(..skip);
    }
}

fn parse_content_length_header(headers: &str) -> Option<usize> {
    for line in headers.lines() {
        let trimmed = line.trim();
        if trimmed
            .get(..15)
            .is_some_and(|p| p.eq_ignore_ascii_case("content-length:"))
        {
            let val = trimmed.get(15..).unwrap_or("").trim();
            return val.parse::<usize>().ok();
        }
    }
    None
}

fn parse_utf8_json(bytes: &[u8]) -> FrameEvent {
    let Ok(s) = std::str::from_utf8(bytes) else {
        return FrameEvent::ParseError;
    };
    let trimmed = s.trim_start_matches('\u{FEFF}').trim();
    match parse_json(trimmed) {
        Ok(val) => FrameEvent::Message(val),
        Err(_) => FrameEvent::ParseError,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct ChunkedReader<'a> {
        chunks: Vec<&'a [u8]>,
        pos: usize,
    }

    impl Read for ChunkedReader<'_> {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            if self.pos >= self.chunks.len() {
                return Ok(0);
            }
            let chunk = self.chunks[self.pos];
            let n = chunk.len().min(buf.len());
            buf[..n].copy_from_slice(&chunk[..n]);
            if n == chunk.len() {
                self.pos += 1;
            } else {
                self.chunks[self.pos] = &chunk[n..];
            }
            Ok(n)
        }
    }

    fn drain_frames(chunks: Vec<&[u8]>) -> Vec<FrameEvent> {
        let mut r = McpFrameReader::new(ChunkedReader { chunks, pos: 0 });
        let mut out = Vec::new();
        while let Some(ev) = r.next_frame().expect("next_frame") {
            out.push(ev);
        }
        out
    }

    #[test]
    fn chunked_split_header_and_ct_bad_recover_valid_ping() {
        let cases: [Vec<&[u8]>; 5] = [
            vec![
                b"Content-Type: application/json\r\n\r\n{\"a\": 1\nContent-Len",
                b"gth: 40\r\n\r\n{\"jsonrpc\":\"2.0\",",
                b"\"id\":1,\"method\":\"ping\"}",
            ],
            vec![
                b"Content-Type: application/json\r\n\r\n{\"a\": \"unclosed\nContent-",
                b"Length: 40\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}",
            ],
            vec![
                b"Content-Type: application/json\r\n\r\n{\"a\": 1\nC",
                b"ontent-Length: 40\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}",
            ],
            vec![b"Content-Type: application/json\r\n\r\nhello Content-Type: bad\n\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n"],
            vec![b"Content-Type: application/json\r\n\r\n\njunk line\nContent-Length: 40\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}"],
        ];
        for chunks in cases {
            let frames = drain_frames(chunks);
            assert_eq!(frames.len(), 2);
            assert!(matches!(frames[0], FrameEvent::ParseError));
            assert!(matches!(frames[1], FrameEvent::Message(_)));
        }
    }

    #[test]
    fn json_orphan_backslash_nl_spaces_and_mixed_header_endings() {
        let ping_cl = b"Content-Length: 40\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}";
        let two_frame_cases: [Vec<Vec<u8>>; 6] = [
            vec![[b"Content-Type: application/json\r\n\r\n{\"a\": \"unclosed\\\n".as_slice(), ping_cl].concat()],
            vec![[b"Content-Type: application/json\r\n\r\n{\"a\": 1\n  ".as_slice(), ping_cl].concat()],
            vec![[b"Content-Type: application/json\r\n\r\n{\"a\": 1 ".as_slice(), ping_cl].concat()],
            vec![
                b"Content-Type: application/json\r\n\r\n{\"a\": 1\n  ".to_vec(),
                b"Content-Length: 40\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}".to_vec(),
            ],
            vec![
                b"Content-Type: application/json\r\n\r\n{\"a\": 1 ".to_vec(),
                b"C".to_vec(),
                b"ontent-Length: 40\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}".to_vec(),
            ],
            vec![
                b"Content-Type: application/json\r\n\r\n{\"a\": \"unclosed\\\r\n  "
                    .chunks(1)
                    .chain(ping_cl.chunks(1))
                    .flatten()
                    .copied()
                    .collect(),
            ],
        ];
        for owned in two_frame_cases {
            let refs: Vec<&[u8]> = owned.iter().map(Vec::as_slice).collect();
            let frames = drain_frames(refs);
            assert_eq!(frames.len(), 2);
            assert!(matches!(frames[0], FrameEvent::ParseError));
            assert!(matches!(frames[1], FrameEvent::Message(_)));
        }

        let one_byte_inline: Vec<&[u8]> = b"Content-Type: application/json\r\n\r\n{\"a\": 1 Content-Length: 40\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}"
            .chunks(1)
            .collect();
        let frames = drain_frames(one_byte_inline);
        assert_eq!(frames.len(), 2);
        assert!(matches!(frames[0], FrameEvent::ParseError));
        assert!(matches!(frames[1], FrameEvent::Message(_)));

        for sep in [b"\n\r\n".as_slice(), b"\r\n\n".as_slice()] {
            let msg = [b"Content-Length: 40", sep, b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}"].concat();
            let frames = drain_frames(vec![&msg]);
            assert_eq!(frames.len(), 1);
            assert!(matches!(frames[0], FrameEvent::Message(_)));
        }
    }
}
