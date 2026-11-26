use std::io::{self, ErrorKind, Read};

pub(crate) enum HeaderProbe {
    Complete { has_cl_or_ct: bool },
    NeedMore,
    NotHeader,
}

pub(crate) fn read_chunk_into<R: Read>(
    reader: &mut R,
    buf: &mut Vec<u8>,
    eof: &mut bool,
) -> io::Result<usize> {
    let mut chunk = [0u8; 4096];
    loop {
        match reader.read(&mut chunk) {
            Ok(0) => {
                *eof = true;
                return Ok(0);
            }
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                return Ok(n);
            }
            Err(e) if e.kind() == ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        }
    }
}

pub(crate) fn ensure_header_prefix<R: Read>(
    reader: &mut R,
    buf: &mut Vec<u8>,
    eof: &mut bool,
    idx: usize,
) -> io::Result<()> {
    while !*eof && buf.len().saturating_sub(idx) < 15 {
        if !is_header_prefix_candidate(&buf[idx..]) {
            break;
        }
        if read_chunk_into(reader, buf, eof)? == 0 {
            break;
        }
    }
    Ok(())
}

fn is_header_prefix_candidate(tail: &[u8]) -> bool {
    !tail.is_empty()
        && (b"content-length:"
            .get(..tail.len())
            .is_some_and(|p| p.eq_ignore_ascii_case(tail))
            || b"content-type:"
                .get(..tail.len())
                .is_some_and(|p| p.eq_ignore_ascii_case(tail)))
}

pub(crate) fn confirm_header_at<R: Read>(
    reader: &mut R,
    buf: &mut Vec<u8>,
    eof: &mut bool,
    pos: usize,
) -> io::Result<bool> {
    if pos > 0 {
        let prev = buf[pos - 1];
        if !(prev == b'}' || prev == b']' || prev.is_ascii_whitespace()) {
            return Ok(false);
        }
    }
    loop {
        match inspect_header_state(&buf[pos..]) {
            HeaderProbe::Complete { has_cl_or_ct } => {
                if !has_cl_or_ct {
                    return Ok(false);
                }
                let Some((hdr_end, _)) = find_header_end(&buf[pos..]) else {
                    return Ok(false);
                };
                let hdr_str = String::from_utf8_lossy(&buf[pos..pos + hdr_end]);
                return Ok(has_valid_content_length(&hdr_str));
            }
            HeaderProbe::NotHeader => return Ok(false),
            HeaderProbe::NeedMore => {
                if *eof || read_chunk_into(reader, buf, eof)? == 0 {
                    let hdr_str = String::from_utf8_lossy(&buf[pos..]);
                    return Ok(has_valid_content_length(&hdr_str));
                }
            }
        }
    }
}

pub(crate) fn parse_content_length_header(headers: &str) -> Option<usize> {
    let mut found: Option<usize> = None;
    for line in headers.lines() {
        let trimmed = line.trim();
        if starts_with_ci(trimmed.as_bytes(), b"content-length:") {
            if found.is_some() {
                return None;
            }
            let val = trimmed.get(15..).unwrap_or("").trim();
            if val.is_empty() || !val.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            found = Some(val.parse::<usize>().ok()?);
        }
    }
    found
}

fn has_valid_content_length(hdr_str: &str) -> bool {
    parse_content_length_header(hdr_str).is_some()
}

pub(crate) fn trim_ascii_slice(slice: &[u8]) -> &[u8] {
    let start = slice
        .iter()
        .position(|b| !matches!(b, b' ' | b'\t' | b'\r' | b'\n'))
        .unwrap_or(slice.len());
    let end = slice[start..]
        .iter()
        .rposition(|b| !matches!(b, b' ' | b'\t' | b'\r' | b'\n'))
        .map_or(start, |idx| start + idx + 1);
    &slice[start..end]
}

pub(crate) fn find_header_end(buf: &[u8]) -> Option<(usize, usize)> {
    const SEPS: [&[u8]; 4] = [b"\r\n\r\n", b"\n\r\n", b"\r\n\n", b"\n\n"];
    SEPS.into_iter()
        .filter_map(|sep| {
            buf.windows(sep.len())
                .position(|w| w == sep)
                .map(|pos| (pos, sep.len()))
        })
        .min_by_key(|&(pos, _)| pos)
}

pub(crate) fn starts_with_ci(line: &[u8], prefix_lower: &[u8]) -> bool {
    line.get(..prefix_lower.len())
        .is_some_and(|p| p.eq_ignore_ascii_case(prefix_lower))
}

pub(crate) fn inspect_header_state(buf: &[u8]) -> HeaderProbe {
    let mut pos = 0usize;
    let mut has_cl_or_ct = false;
    while pos < buf.len() {
        let rest = &buf[pos..];
        let Some(rel_nl) = rest.iter().position(|&b| b == b'\n') else {
            if pos > 0 && (rest.is_empty() || rest == b"\r") {
                return HeaderProbe::NeedMore;
            }
            return match rest.iter().position(|&b| b == b':') {
                Some(colon)
                    if colon > 0 && rest[..colon].iter().copied().all(is_header_name_byte) =>
                {
                    HeaderProbe::NeedMore
                }
                None if !rest.is_empty() && rest.iter().copied().all(is_header_name_byte) => {
                    HeaderProbe::NeedMore
                }
                _ => HeaderProbe::NotHeader,
            };
        };
        let line = rest[..rel_nl].strip_suffix(b"\r").unwrap_or(&rest[..rel_nl]);
        if line.is_empty() {
            return if pos > 0 {
                HeaderProbe::Complete { has_cl_or_ct }
            } else {
                HeaderProbe::NotHeader
            };
        }
        let Some(colon) = line.iter().position(|&b| b == b':') else {
            return HeaderProbe::NotHeader;
        };
        if colon == 0 || !line[..colon].iter().copied().all(is_header_name_byte) {
            return HeaderProbe::NotHeader;
        }
        if starts_with_ci(line, b"content-length:") || starts_with_ci(line, b"content-type:") {
            has_cl_or_ct = true;
        }
        pos += rel_nl + 1;
    }
    HeaderProbe::NeedMore
}

fn is_header_name_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'-' || b == b'_'
}
