use std::io::{self, Read};

use crate::mcp_framing_probe::{
    confirm_header_at, ensure_header_prefix, read_chunk_into, starts_with_ci,
};

pub(crate) fn drain_orphaned_body<R: Read>(
    reader: &mut R,
    buf: &mut Vec<u8>,
    eof: &mut bool,
) -> io::Result<()> {
    let trimmed_start = loop {
        if let Some(pos) = buf
            .iter()
            .position(|b| !matches!(b, b' ' | b'\t' | b'\r' | b'\n'))
        {
            break pos;
        }
        buf.clear();
        if *eof || read_chunk_into(reader, buf, eof)? == 0 {
            return Ok(());
        }
    };

    ensure_header_prefix(reader, buf, eof, trimmed_start)?;
    let tail = &buf[trimmed_start..];
    if (starts_with_ci(tail, b"content-length:") || starts_with_ci(tail, b"content-type:"))
        && confirm_header_at(reader, buf, eof, trimmed_start)?
    {
        buf.drain(..trimmed_start);
        return Ok(());
    }

    if matches!(buf[trimmed_start], b'{' | b'[') {
        return drain_json_orphan(reader, buf, eof, trimmed_start);
    }
    buf.drain(..trimmed_start);
    drain_non_json_orphan(reader, buf, eof)
}

fn drain_json_orphan<R: Read>(
    reader: &mut R,
    buf: &mut Vec<u8>,
    eof: &mut bool,
    start: usize,
) -> io::Result<()> {
    let mut idx = start;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    loop {
        while idx < buf.len() {
            let b = buf[idx];
            if in_string {
                if b == b'\n' {
                    in_string = false;
                    escaped = false;
                } else if escaped {
                    escaped = false;
                } else if b == b'\\' {
                    escaped = true;
                } else if b == b'"' {
                    in_string = false;
                }
                idx += 1;
                continue;
            }
            if idx > start
                && (buf[idx - 1].is_ascii_whitespace()
                    || buf[idx - 1] == b'}'
                    || buf[idx - 1] == b']')
            {
                ensure_header_prefix(reader, buf, eof, idx)?;
                if (starts_with_ci(&buf[idx..], b"content-length:")
                    || starts_with_ci(&buf[idx..], b"content-type:"))
                    && confirm_header_at(reader, buf, eof, idx)?
                {
                    buf.drain(..idx);
                    return Ok(());
                }
            }
            match buf[idx] {
                b'"' => in_string = true,
                b'{' | b'[' => depth += 1,
                b'}' | b']' => {
                    depth = depth.saturating_sub(1);
                    if depth == 0 {
                        buf.drain(..=idx);
                        return Ok(());
                    }
                }
                _ => {}
            }
            idx += 1;
        }
        if *eof || read_chunk_into(reader, buf, eof)? == 0 {
            buf.clear();
            return Ok(());
        }
    }
}

fn drain_non_json_orphan<R: Read>(
    reader: &mut R,
    buf: &mut Vec<u8>,
    eof: &mut bool,
) -> io::Result<()> {
    loop {
        let nl = buf.iter().position(|&b| b == b'\n');
        let search_end = nl.unwrap_or(buf.len());
        let mut scan_from = 0usize;
        while scan_from < search_end {
            if let Some(rel) = find_candidate_boundary(&buf[scan_from..search_end]) {
                let pos = scan_from + rel;
                ensure_header_prefix(reader, buf, eof, pos)?;
                if confirm_header_at(reader, buf, eof, pos)? {
                    buf.drain(..pos);
                    return Ok(());
                }
                scan_from = pos + 1;
            } else {
                break;
            }
        }
        if let Some(nl_pos) = buf.iter().position(|&b| b == b'\n') {
            buf.drain(..=nl_pos);
            return Ok(());
        }
        if *eof || read_chunk_into(reader, buf, eof)? == 0 {
            buf.clear();
            return Ok(());
        }
    }
}

fn find_candidate_boundary(slice: &[u8]) -> Option<usize> {
    for i in 0..slice.len() {
        if starts_with_ci(&slice[i..], b"content-length:")
            || starts_with_ci(&slice[i..], b"content-type:")
        {
            return Some(i);
        }
    }
    None
}
