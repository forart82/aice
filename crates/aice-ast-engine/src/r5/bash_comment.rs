pub(super) fn char_len(s: &str, i: usize) -> usize {
    s[i..].chars().next().map_or(1, char::len_utf8)
}

pub(super) fn find_bash_hash_comment_end(s: &str, hash_idx: usize, bt_depth: usize) -> (usize, bool) {
    let b = s.as_bytes();
    if bt_depth == 0 {
        let mut j = hash_idx + 1;
        while j < b.len() {
            if b[j] == b'\n' {
                return (j + 1, true);
            }
            j += 1;
        }
        return (b.len(), false);
    }
    let mut j = hash_idx + 1;
    while j < b.len() {
        if b[j] == b'\n' {
            return (j + 1, true);
        }
        if b[j] == b'`' {
            return (j, false);
        }
        if b[j] == b'\\' {
            let mut bs = 0usize;
            while j + bs < b.len() && b[j + bs] == b'\\' {
                bs += 1;
            }
            if j + bs < b.len() && b[j + bs] == b'`' {
                let layer = (bs + 1).trailing_zeros() as usize + 1;
                if layer <= bt_depth {
                    return (j, false);
                }
                j += bs + 1;
            } else if j + bs < b.len() && b[j + bs] == b'\n' {
                if bs == 0 || (bs.trailing_zeros() as usize) >= bt_depth {
                    return (j + bs + 1, true);
                }
                j += bs + 1;
            } else if j + bs < b.len() && bs % 2 == 1 {
                j += bs + char_len(s, j + bs);
            } else {
                j += bs;
            }
        } else {
            j += char_len(s, j);
        }
    }
    (b.len(), false)
}

pub(super) fn try_skip_bash_hash_comment(
    tr: &mut crate::dep_callers_quote::QuoteDepthTracker,
    s: &str,
    abs: usize,
    line_start: usize,
    base_offset: usize,
    iter: &mut std::iter::Peekable<std::str::CharIndices<'_>>,
) -> bool {
    if !(tr.quote.is_none() && !tr.is_escaped() && tr.bash_allows_hash(s.as_bytes(), abs, line_start)) {
        return false;
    }
    let bt_d = if tr.in_bash_bt() { tr.bash_bt_depth() } else { 0 };
    let (stop, hit_nl) = find_bash_hash_comment_end(s, abs, bt_d);
    while let Some(&(nrel, _)) = iter.peek() {
        if base_offset + nrel >= stop {
            break;
        }
        iter.next();
    }
    if hit_nl {
        tr.end_line();
    }
    true
}
