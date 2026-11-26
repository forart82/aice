pub fn glob_matches(pattern: &str, path: &str) -> bool {
    if let Some((pre, inner, post)) = split_braces(pattern) {
        return split_top_level_commas(inner)
            .into_iter()
            .any(|alt| glob_matches(&format!("{pre}{alt}{post}"), path));
    }
    let p: Vec<char> = pattern.chars().collect();
    let s: Vec<char> = path.chars().collect();
    glob_rec(&p, &s, 0, 0)
}

pub(crate) fn split_braces(pat: &str) -> Option<(&str, &str, &str)> {
    let open = pat.find('{')?;
    let mut depth = 0usize;
    for (rel_idx, ch) in pat[open..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    let close = open + rel_idx;
                    return Some((&pat[..open], &pat[open + 1..close], &pat[close + 1..]));
                }
            }
            _ => {}
        }
    }
    None
}

pub(crate) fn split_top_level_commas(inner: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let (mut start, mut depth) = (0usize, 0usize);
    for (idx, ch) in inner.char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => {
                parts.push(&inner[start..idx]);
                start = idx + 1;
            }
            _ => {}
        }
    }
    parts.push(&inner[start..]);
    parts
}

fn glob_rec(p: &[char], s: &[char], mut pi: usize, mut si: usize) -> bool {
    while pi < p.len() {
        match p[pi] {
            '*' => {
                let is_double = pi + 1 < p.len() && p[pi + 1] == '*';
                if is_double {
                    while pi < p.len() && p[pi] == '*' {
                        pi += 1;
                    }
                    if pi < p.len() && p[pi] == '/' {
                        pi += 1;
                        if glob_rec(p, s, pi, si) {
                            return true;
                        }
                        for k in si..s.len() {
                            if s[k] == '/' && glob_rec(p, s, pi, k + 1) {
                                return true;
                            }
                        }
                        return false;
                    }
                    for k in si..=s.len() {
                        if glob_rec(p, s, pi, k) {
                            return true;
                        }
                    }
                    return false;
                }
                pi += 1;
                for k in si..=s.len() {
                    if glob_rec(p, s, pi, k) {
                        return true;
                    }
                    if k < s.len() && s[k] == '/' {
                        break;
                    }
                }
                return false;
            }
            '?' => {
                if si >= s.len() || s[si] == '/' {
                    return false;
                }
                pi += 1;
                si += 1;
            }
            '[' => {
                if si >= s.len() {
                    return false;
                }
                let Some((matched, next_pi)) = match_glob_class(p, pi + 1, s[si]) else {
                    return false;
                };
                if !matched {
                    return false;
                }
                pi = next_pi;
                si += 1;
            }
            c => {
                if si >= s.len() || s[si] != c {
                    return false;
                }
                pi += 1;
                si += 1;
            }
        }
    }
    si == s.len()
}

fn match_glob_class(p: &[char], mut i: usize, ch: char) -> Option<(bool, usize)> {
    let neg = i < p.len() && matches!(p[i], '!' | '^');
    if neg {
        i += 1;
    }
    let mut matched = false;
    while i < p.len() && p[i] != ']' {
        if i + 2 < p.len() && p[i + 1] == '-' && p[i + 2] != ']' {
            if ch >= p[i] && ch <= p[i + 2] {
                matched = true;
            }
            i += 3;
        } else {
            if ch == p[i] {
                matched = true;
            }
            i += 1;
        }
    }
    if i >= p.len() {
        return None;
    }
    Some((if neg { !matched } else { matched }, i + 1))
}
