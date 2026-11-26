use crate::r5::snippet_hdr::has_depth0_assign;
use crate::r5::snippet_ts_expr::is_ts_fn_type_param_arrow;
use crate::r5::snippet_ts_hdr::strip_trailing_angles;

fn has_matching_gt_from(b: &[u8], start: usize, depth: usize) -> bool {
    let (mut ad, mut pd, mut bd, mut cd, mut saw_colon) = (depth, 0usize, 0usize, 0usize, false);
    for (j, &c) in b.iter().enumerate().skip(start) {
        match c {
            b'(' => pd += 1,
            b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1,
            b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1,
            b'}' if pd == 0 && bd == 0 && cd == 0 => return false,
            b'}' => cd = cd.saturating_sub(1),
            b';' if pd == 0 && bd == 0 && cd == 0 => return false,
            b':' if pd == 0 && bd == 0 && cd == 0 => saw_colon = true,
            b'<' if pd == 0 && bd == 0 && cd == 0 => ad += 1,
            b'>' if pd == 0 && bd == 0 && cd == 0 && (j == 0 || !matches!(b[j - 1], b'-' | b'=')) => {
                ad -= 1;
                if ad < depth {
                    return saw_colon;
                }
            }
            _ => {}
        }
    }
    false
}

fn has_depth0_qmark(s: &str) -> bool {
    let b = s.as_bytes();
    let (mut pd, mut bd, mut cd) = (0usize, 0usize, 0usize);
    let mut lt_stack: Vec<usize> = Vec::new();
    for (i, &c) in b.iter().enumerate() {
        match c {
            b'(' => pd += 1,
            b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1,
            b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1,
            b'}' if pd == 0 && bd == 0 && cd == 0 => lt_stack.clear(),
            b'}' => cd = cd.saturating_sub(1),
            b';' if pd == 0 && bd == 0 && cd == 0 => lt_stack.clear(),
            b'<' if pd == 0 && bd == 0 && cd == 0 => {
                if !matches!(b.get(i + 1), Some(b'=' | b'<')) {
                    lt_stack.push(i);
                }
            }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => {
                lt_stack.pop();
            }
            b'?' if pd == 0 && bd == 0 && cd == 0 => {
                let in_cond_generic = lt_stack.last().is_some_and(|&lt_pos| {
                    let between = &s[lt_pos + 1..i];
                    let has_extends = between
                        .split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '_')
                        .any(|w| w == "extends");
                    has_extends && has_matching_gt_from(b, i + 1, lt_stack.len())
                });
                if !in_cond_generic {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn has_depth0_word(s: &str, word: &str) -> bool {
    let (b, wb) = (s.as_bytes(), word.as_bytes());
    let (mut pd, mut bd, mut cd) = (0usize, 0usize, 0usize);
    let is_id = |c: u8| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$');
    for (i, &c) in b.iter().enumerate() {
        match c {
            b'(' => pd += 1,
            b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1,
            b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1,
            b'}' => cd = cd.saturating_sub(1),
            _ if pd == 0 && bd == 0 && cd == 0
                && b[i..].starts_with(wb)
                && (i == 0 || !is_id(b[i - 1]))
                && b.get(i + wb.len()).is_none_or(|&n| !is_id(n)) =>
            {
                return true;
            }
            _ => {}
        }
    }
    false
}

fn is_ts_fn_or_method_head(head: &str) -> bool {
    if has_depth0_word(head, "function") {
        return true;
    }
    let h = strip_trailing_angles(head);
    if h.is_empty()
        || has_depth0_assign(h)
        || h.ends_with([':', ',', '(', '[', '{', '?', '&', '|', '+', '-', '*', '/', '%', '!', '~', '<', '>', '='])
    {
        return false;
    }
    let Some(last_c) = h.as_bytes().last().copied() else { return false; };
    if !(last_c.is_ascii_alphanumeric() || matches!(last_c, b'_' | b'$' | b']')) {
        return false;
    }
    let last_word = h
        .rsplit(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$'))
        .next()
        .unwrap_or("");
    !matches!(
        last_word,
        "async" | "return" | "throw" | "yield" | "await" | "typeof" | "void"
            | "delete" | "new" | "case" | "default" | "else" | "export"
    )
}

fn ts_ret_after_expects_obj_type(after: &str, is_fn_or_method: bool) -> bool {
    let at = after.trim_end();
    if at.is_empty() {
        return true;
    }
    if !at.ends_with(['&', '|', '?', ':', '<', '[', '(', ',']) && !at.ends_with("=>") {
        return false;
    }
    let b = at.as_bytes();
    let (mut i, mut cd, mut trailing_colon_ok) = (0usize, 0usize, false);
    let mut frames: Vec<(u8, bool, usize)> = vec![(0, false, 0)];
    let is_id = |c: u8| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$');
    while i < b.len() {
        match b[i] {
            b'{' => cd += 1,
            b'}' => cd = cd.saturating_sub(1),
            b'(' | b'[' if cd == 0 => frames.push((b[i], false, 0)),
            b')' if cd == 0 => {
                if frames.last().is_some_and(|f| f.0 == b'(') { frames.pop(); }
            }
            b']' if cd == 0 => {
                if frames.last().is_some_and(|f| f.0 == b'[') { frames.pop(); }
            }
            b'<' if cd == 0 => {
                if b.get(i + 1) == Some(&b'=') { i += 2; continue; }
                frames.push((b'<', false, 0));
            }
            b'>' if cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => {
                if frames.last().is_some_and(|f| f.0 == b'<') { frames.pop(); }
            }
            _ if cd == 0 => match b[i] {
                b'e' if b[i..].starts_with(b"extends")
                    && (i == 0 || !is_id(b[i - 1]))
                    && b.get(i + 7).is_none_or(|&c| !is_id(c)) =>
                {
                    frames.last_mut().unwrap().1 = true;
                    i += 7;
                    continue;
                }
                b'?' => {
                    let top = frames.last_mut().unwrap();
                    if top.1 { top.1 = false; top.2 += 1; }
                    else if frames.len() == 1 { return false; }
                }
                b':' => {
                    let top = frames.last_mut().unwrap();
                    if top.2 > 0 {
                        top.2 -= 1;
                        if i + 1 == at.len() { trailing_colon_ok = true; }
                    } else if frames.len() == 1 {
                        return false;
                    }
                }
                b'=' if b.get(i + 1) == Some(&b'>') => {
                    if i + 2 == at.len() {
                        return frames.len() > 1 || is_fn_or_method || is_ts_fn_type_param_arrow(at);
                    }
                    if frames.len() == 1
                        && !is_fn_or_method
                        && !frames[0].1
                        && frames[0].2 == 0
                        && !is_ts_fn_type_param_arrow(&at[..i + 2])
                    {
                        return false;
                    }
                    i += 2;
                    continue;
                }
                _ => {}
            },
            _ => {}
        }
        i += 1;
    }
    if at.ends_with(['&', '|', '<', '[']) { true }
    else if let Some(pre) = at.strip_suffix('(').map(str::trim_end) {
        pre.is_empty() || pre.ends_with(['<', '&', '|', '?', ':', '[', '(', ',']) || pre.ends_with("=>")
    }
    else if at.ends_with(',') { frames.len() > 1 }
    else if at.ends_with('?') { frames.last().is_some_and(|f| f.2 > 0) }
    else if at.ends_with(':') { trailing_colon_ok }
    else { false }
}
pub(crate) fn is_ts_ret_type_colon(hdr_before_brace: &str) -> bool {
    let first_word = hdr_before_brace
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .find(|w| !w.is_empty());
    if matches!(first_word, Some("case" | "default")) {
        return false;
    }
    let b = hdr_before_brace.as_bytes();
    let (mut pd, mut bd, mut cd, mut top_lparen) = (0usize, 0usize, 0usize, None);
    for (i, &c) in b.iter().enumerate() {
        match c {
            b'(' => {
                if pd == 0 && bd == 0 && cd == 0 { top_lparen = Some(i); }
                pd += 1;
            }
            b')' => {
                pd = pd.saturating_sub(1);
                if pd == 0 && bd == 0 && cd == 0 {
                    let rest = hdr_before_brace[i + 1..].trim_start();
                    if let Some(after) = rest.strip_prefix(':') {
                        if has_depth0_qmark(&hdr_before_brace[..i + 1]) || has_depth0_assign(after) {
                            return false;
                        }
                        let head = top_lparen.map_or("", |lp| hdr_before_brace[..lp].trim_end());
                        return ts_ret_after_expects_obj_type(after, is_ts_fn_or_method_head(head));
                    }
                }
            }
            b'[' => bd += 1,
            b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1,
            b'}' => cd = cd.saturating_sub(1),
            _ => {}
        }
    }
    false
}

pub(crate) fn unclosed_delim_positions(s: &str) -> Vec<(u8, usize)> {
    let mut stack: Vec<(u8, usize)> = Vec::new();
    for (i, &c) in s.as_bytes().iter().enumerate() {
        if matches!(c, b'(' | b'[' | b'{') {
            stack.push((c, i));
        } else if matches!(c, b')' | b']' | b'}') {
            let want = match c { b')' => b'(', b']' => b'[', _ => b'{' };
            if let Some(pos) = stack.iter().rposition(|&(d, _)| d == want) {
                stack.remove(pos);
            }
        }
    }
    stack
}

pub(crate) fn strip_switch_case_labels(mut s: &str) -> &str {
    loop {
        let t = s.trim_start();
        let first = t.split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
        if !matches!(first, "case" | "default") { return t; }
        let b = t.as_bytes();
        let (mut pd, mut bd, mut cd, mut qd, mut colon) = (0usize, 0usize, 0usize, 0usize, None);
        for (i, &c) in b.iter().enumerate().skip(first.len()) {
            match c {
                b'(' => pd += 1,
                b')' => pd = pd.saturating_sub(1),
                b'[' => bd += 1,
                b']' => bd = bd.saturating_sub(1),
                b'{' => cd += 1,
                b'}' => cd = cd.saturating_sub(1),
                b'?' if pd == 0 && bd == 0 && cd == 0 => qd += 1,
                b':' if pd == 0 && bd == 0 && cd == 0 => {
                    if qd > 0 { qd -= 1; } else { colon = Some(i + 1); break; }
                }
                _ => {}
            }
        }
        let Some(p) = colon else { return t; };
        s = &t[p..];
    }
}
