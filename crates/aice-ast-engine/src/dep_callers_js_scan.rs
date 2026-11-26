use crate::dep_callers_quote::{QuoteDepthTracker, StepKind, is_js_ident_char, is_js_ident_start};

pub(crate) fn scan_js_regex_len(raw: &str, b: &[u8], start: usize) -> Option<usize> {
    let mut j = start + 1;
    let mut in_class = false;
    while j < b.len() {
        if b[j] == b'\\' {
            if j + 1 >= b.len() {
                return None;
            }
            j += 1 + char_len(raw, j + 1);
            continue;
        }
        if in_class {
            if b[j] == b']' {
                in_class = false;
            }
            j += char_len(raw, j);
            continue;
        }
        if b[j] == b'[' {
            in_class = true;
            j += 1;
        } else if b[j] == b'/' {
            j += 1;
            while j < b.len() && b[j].is_ascii_alphabetic() {
                j += 1;
            }
            return Some(j - start);
        } else {
            j += char_len(raw, j);
        }
    }
    None
}

pub(crate) fn scan_ident_end(raw: &str, i: usize) -> usize {
    let mut end = i;
    for (rel, c) in raw[i..].char_indices() {
        if c.is_alphanumeric() || c == '_' || c == '$' {
            end = i + rel + c.len_utf8();
        } else {
            break;
        }
    }
    end
}

pub(crate) fn scan_js_number_end(raw: &str, b: &[u8], i: usize) -> usize {
    let is_radix = ["0x", "0X", "0b", "0B", "0o", "0O"]
        .iter()
        .any(|p| raw[i..].starts_with(p));
    let mut j = if b[i] == b'.' { i + 1 } else { i };
    let mut seen_dot = b[i] == b'.';
    while j < b.len() {
        if b[j].is_ascii_alphanumeric() || b[j] == b'_' {
            if !is_radix
                && matches!(b[j], b'e' | b'E')
                && matches!(b.get(j + 1), Some(b'+' | b'-'))
            {
                j += 2;
            } else {
                j += 1;
            }
        } else if b[j] == b'.' && !seen_dot && b.get(j + 1) != Some(&b'.') {
            seen_dot = true;
            j += 1;
        } else {
            break;
        }
    }
    j
}

fn char_len(raw: &str, i: usize) -> usize {
    raw[i..].chars().next().map_or(1, char::len_utf8)
}

pub(crate) fn is_valid_js_ident(s: &str) -> bool {
    !s.is_empty()
        && !s.starts_with(|c: char| c.is_ascii_digit())
        && s.chars().all(is_js_ident_char)
}

fn prev_ident_token(s: &str) -> Option<(&str, &str)> {
    let t = s.trim_end();
    let word = t.rsplit(|c: char| !is_js_ident_char(c)).next().unwrap_or("");
    if !is_valid_js_ident(word) {
        return None;
    }
    let before = &t[..t.len() - word.len()];
    (!before.trim_end().ends_with('.')).then_some((before, word))
}

fn can_open_angle_before_kw(prefix: &str) -> bool {
    let t = prefix.trim_end();
    if t.ends_with("=>") {
        return true;
    }
    if let Some(before_star) = t.strip_suffix('*') {
        return prev_ident_token(before_star).is_some_and(|(_, w)| w == "function");
    }
    let Some((before1, w1)) = prev_ident_token(t) else {
        return false;
    };
    if matches!(
        w1,
        "async" | "return" | "function" | "await" | "yield" | "typeof" | "void" | "throw" | "class"
    ) {
        return true;
    }
    let b1 = before1.trim_end();
    if let Some(before_star) = b1.strip_suffix('*') {
        return prev_ident_token(before_star).is_some_and(|(_, w2)| w2 == "function");
    }
    prev_ident_token(b1).is_some_and(|(_, w2)| matches!(w2, "function" | "class" | "extends"))
}

const MAX_TYPE_ARG_LOOKAHEAD: usize = 8192;

fn trailing_ident_is_valid(t: &str) -> bool {
    let word = t.rsplit(|c: char| !is_js_ident_char(c)).next().unwrap_or("");
    is_valid_js_ident(word)
}

fn can_before_type_args(prefix: &str) -> bool {
    let mut t = prefix.trim_end();
    if let Some(before_opt) = t.strip_suffix("?.") {
        t = before_opt.trim_end();
    }
    if t.ends_with(['(', ',', '=', ':', '?', '&', '|', '>']) {
        return false;
    }
    let Some(last) = t.chars().next_back() else { return false };
    if matches!(last, ')' | ']') {
        return true;
    }
    if last == '!' {
        let before_bang = t[..t.len() - 1].trim_end();
        return before_bang
            .chars()
            .next_back()
            .is_some_and(|c| matches!(c, ')' | ']') || trailing_ident_is_valid(before_bang));
    }
    trailing_ident_is_valid(t)
}

fn starts_with_kw(s: &str, kw: &str) -> bool {
    s.strip_prefix(kw)
        .is_some_and(|r| r.chars().next().is_none_or(|c| !is_js_ident_char(c)))
}

fn starts_with_member(s: &str) -> bool {
    s.strip_prefix('.')
        .is_some_and(|r| r.trim_start().chars().next().is_some_and(is_js_ident_start))
        || s.strip_prefix("?.").is_some_and(|r| {
            let r = r.trim_start();
            r.starts_with(['(', '[']) || r.chars().next().is_some_and(is_js_ident_start)
        })
}

fn is_valid_after_type_args(after: &str) -> bool {
    let (s, allow_primary) = match after.strip_prefix('!').filter(|r| !r.starts_with('=')) {
        Some(r) => (r.trim_start(), false),
        None => (after, true),
    };
    let ops = ["||", "&&", "??", "==", "!="];
    let kws = ["as", "satisfies", "instanceof", "in"];
    s.is_empty()
        || s.starts_with([',', ';', ')', ']', ':', '?'])
        || (allow_primary && (s.starts_with(['(', '{', '`']) || starts_with_kw(s, "implements")))
        || ops.iter().any(|op| s.starts_with(op))
        || starts_with_member(s)
        || kws.iter().any(|kw| starts_with_kw(s, kw))
}

fn looks_like_type_args(rest: &str) -> bool {
    if rest[1..].starts_with(['<', '=']) {
        return false;
    }
    let mut tr = QuoteDepthTracker::new();
    let mut depth = 1usize;
    let mut iter = rest[1..].char_indices().peekable();
    while let Some((rel, ch)) = iter.next() {
        if rel >= MAX_TYPE_ARG_LOOKAHEAD {
            return false;
        }
        let next = iter.peek().map(|&(_, n)| n);
        let was_top = tr.at_top_level();
        let kind = tr.step(ch, next);
        if kind == StepKind::EnterTemplate {
            iter.next();
            continue;
        }
        if was_top && tr.quote.is_none() {
            if ch == '<' {
                if matches!(next, Some('<' | '=')) {
                    return false;
                }
                depth += 1;
            } else if ch == '=' {
                if next == Some('>') {
                    iter.next();
                    continue;
                }
                return false;
            } else if ch == ';' || (matches!(ch, '&' | '|' | '?') && next == Some(ch)) {
                return false;
            } else if ch == '>' {
                if next == Some('=') {
                    return false;
                }
                depth -= 1;
                if depth == 0 {
                    let after = rest[1 + rel + 1..].trim_start();
                    return is_valid_after_type_args(after);
                }
            }
        }
    }
    false
}

pub(crate) fn split_top_level_commas(inner: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut tr = QuoteDepthTracker::new();
    let (mut start, mut angle, mut can_open_angle, mut prev_eq) = (0usize, 0usize, true, false);
    let mut iter = inner.char_indices().peekable();
    while let Some((idx, ch)) = iter.next() {
        let next = iter.peek().map(|&(_, n)| n);
        let was_top = tr.at_top_level();
        let kind = tr.step(ch, next);
        if kind == StepKind::EnterTemplate {
            iter.next();
            prev_eq = false;
            continue;
        }
        if was_top && tr.quote.is_none() {
            if ch == '<'
                && (angle > 0
                    || can_open_angle
                    || can_open_angle_before_kw(&inner[..idx])
                    || (can_before_type_args(&inner[start..idx])
                        && looks_like_type_args(&inner[idx..])))
            {
                angle += 1;
                can_open_angle = false;
            } else if ch == '>' && angle > 0 && !prev_eq {
                angle -= 1;
                can_open_angle = false;
            } else if ch == ',' && tr.at_top_level() && angle == 0 {
                out.push(&inner[start..idx]);
                start = idx + 1;
                can_open_angle = true;
            } else if !ch.is_whitespace() {
                can_open_angle = (angle == 0 && prev_eq && ch == '>')
                    || matches!(ch, '=' | '(' | ',' | ':' | '?' | '&' | '|');
            }
            prev_eq = ch == '=';
        } else {
            if !was_top && tr.at_top_level() {
                can_open_angle = false;
            }
            prev_eq = false;
        }
    }
    out.push(&inner[start..]);
    out
}

pub(crate) fn strip_top_level_default(item: &str) -> &str {
    let mut tr = QuoteDepthTracker::new();
    let mut iter = item.char_indices().peekable();
    while let Some((idx, ch)) = iter.next() {
        let next = iter.peek().map(|&(_, n)| n);
        let kind = tr.step(ch, next);
        if kind == StepKind::EnterTemplate {
            iter.next();
            continue;
        }
        if kind == StepKind::Other && ch == '=' && tr.at_top_level() {
            return &item[..idx];
        }
    }
    item
}
