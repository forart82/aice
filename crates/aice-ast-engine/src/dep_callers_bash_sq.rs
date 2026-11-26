use crate::dep_callers_bash_bt::is_esc_dq_quote;
use crate::dep_callers_bash_cont::bash_eol_continues;

pub(crate) fn bash_continues_bt_hash_comment(bt_depth: usize, b: &[u8]) -> bool {
    if bt_depth == 0 {
        return false;
    }
    let bs = b.iter().rev().take_while(|&&c| c == b'\\').count();
    bs > 0 && (bs.trailing_zeros() as usize) < bt_depth
}

pub(crate) fn bash_find_bt_after_hash(
    bt_depth: usize,
    raw: &str,
    b: &[u8],
    start: usize,
) -> Option<usize> {
    let mut j = start;
    while j < b.len() {
        if b[j] == b'\\' {
            let mut bs = 0usize;
            while j + bs < b.len() && b[j + bs] == b'\\' {
                bs += 1;
            }
            if j + bs < b.len() && b[j + bs] == b'`' {
                if ((bs + 1).trailing_zeros() as usize + 1) <= bt_depth {
                    return Some(j);
                }
                j += bs + 1;
            } else if j + bs < b.len() && bs % 2 == 1 {
                j += bs + raw[j + bs..].chars().next().map_or(1, char::len_utf8);
            } else {
                j += bs;
            }
        } else if b[j] == b'`' {
            return Some(j);
        } else {
            j += raw[j..].chars().next().map_or(1, char::len_utf8);
        }
    }
    None
}

pub(crate) fn step_bash_sq(
    raw: &str,
    mut i: usize,
    (ansi_c, allow_eol_cont): (bool, bool),
    (bt_depth, ansi_outer_d): (usize, Option<usize>),
    skip_imp_bs: usize,
    imp: &mut String,
    code: &mut String,
) -> (usize, bool, Option<usize>, Option<usize>) {
    let b = raw.as_bytes();
    let mut skip_rem = skip_imp_bs;
    while i < b.len() {
        if allow_eol_cont
            && bt_depth > 0
            && b[i] == b'\\'
            && b[i..].iter().all(|&c| c == b'\\')
            && bash_eol_continues(b.len() - i, bt_depth, true)
        {
            return (i, false, Some(b.len() - i), None);
        }
        if (ansi_c || bt_depth > 0) && b[i] == b'\\' {
            let mut bs = 0usize;
            while i + bs < b.len() && b[i + bs] == b'\\' {
                bs += 1;
            }
            let after = i + bs;
            let skip = skip_rem.min(bs);
            skip_rem = 0;
            imp.push_str(&raw[i + skip..after]);
            for _ in 0..bs {
                code.push(' ');
            }
            if after == b.len() {
                return (after, false, None, None);
            }
            if bt_depth > 0 && b[after] == b'`' {
                let layer = ansi_outer_d.map_or_else(
                    || (bs + 1).trailing_zeros() as usize + 1,
                    |od| crate::dep_callers_bash_dq_lex::ansi_effective_bt_layer(bs, od),
                );
                if layer <= bt_depth {
                    return (after + 1, false, None, Some(layer));
                }
                imp.push('`');
                code.push(' ');
                i = after + 1;
            } else if ansi_c && b[after] == b'\'' {
                imp.push('\'');
                if is_esc_dq_quote(bs, 0, bt_depth) {
                    code.push('\'');
                    return (after + 1, true, None, None);
                }
                code.push(' ');
                i = after + 1;
            } else {
                i = after;
            }
        } else if b[i] == b'`' && bt_depth > 0 {
            return (i + 1, false, None, Some(1));
        } else if b[i] == b'\'' {
            imp.push('\'');
            code.push('\'');
            return (i + 1, true, None, None);
        } else {
            skip_rem = 0;
            let ch = raw[i..].chars().next().unwrap();
            imp.push(ch);
            for _ in 0..ch.len_utf8() {
                code.push(' ');
            }
            i += ch.len_utf8();
        }
    }
    (i, false, None, None)
}
