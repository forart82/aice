pub(crate) fn match_cpp_raw_string(b: &[u8], i: usize) -> Option<(usize, bool)> {
    if i > 0 && (b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'_') {
        return None;
    }
    let r_pos = if b[i] == b'R' {
        i
    } else if matches!(b[i], b'L' | b'u' | b'U') && b.get(i + 1) == Some(&b'R') {
        i + 1
    } else if b[i..].starts_with(b"u8R") {
        i + 2
    } else {
        return None;
    };
    if b.get(r_pos + 1) != Some(&b'"') {
        return None;
    }
    let d_start = r_pos + 2;
    let mut d_end = d_start;
    while d_end < b.len() && d_end - d_start <= 16 && b[d_end] != b'(' {
        if matches!(b[d_end], b')' | b'\\' | b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C) {
            return None;
        }
        d_end += 1;
    }
    if d_end - d_start > 16 || b.get(d_end) != Some(&b'(') {
        return None;
    }
    let delim = &b[d_start..d_end];
    let mut j = d_end + 1;
    while j < b.len() {
        if b[j] == b')'
            && b.get(j + 1..j + 1 + delim.len()) == Some(delim)
            && b.get(j + 1 + delim.len()) == Some(&b'"')
        {
            return Some((j + 2 + delim.len(), true));
        }
        j += 1;
    }
    Some((b.len(), false))
}

pub(crate) fn match_php_heredoc(b: &[u8], i: usize) -> Option<(usize, bool)> {
    if !b[i..].starts_with(b"<<<") {
        return None;
    }
    let mut k = i + 3;
    while k < b.len() && matches!(b[k], b' ' | b'\t') {
        k += 1;
    }
    let quote = b.get(k).copied().filter(|&c| c == b'\'' || c == b'"');
    if quote.is_some() {
        k += 1;
    }
    let l_start = k;
    if k >= b.len() || !(b[k].is_ascii_alphabetic() || b[k] == b'_' || b[k] >= 0x80) {
        return None;
    }
    while k < b.len() && (b[k].is_ascii_alphanumeric() || b[k] == b'_' || b[k] >= 0x80) {
        k += 1;
    }
    let label = &b[l_start..k];
    if let Some(q) = quote {
        if b.get(k) != Some(&q) {
            return None;
        }
        k += 1;
    }
    while k < b.len() && matches!(b[k], b' ' | b'\t') {
        k += 1;
    }
    if k == b.len() {
        return Some((b.len(), false));
    }
    if b[k] == b'\r' {
        k += 1;
    }
    if k >= b.len() || b[k] != b'\n' {
        return None;
    }
    k += 1;
    while k < b.len() {
        let line_end = b[k..].iter().position(|&c| c == b'\n').map_or(b.len(), |p| k + p);
        let mut t = k;
        while t < line_end && matches!(b[t], b' ' | b'\t') {
            t += 1;
        }
        if b[t..line_end].starts_with(label) {
            let after = t + label.len();
            if after == line_end
                || matches!(
                    b[after],
                    b';' | b',' | b')' | b']' | b' ' | b'\t' | b'\r' | b'\n'
                )
            {
                return Some((after, true));
            }
        }
        k = if line_end < b.len() { line_end + 1 } else { b.len() };
    }
    Some((b.len(), false))
}
