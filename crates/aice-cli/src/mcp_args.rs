use std::collections::BTreeMap;
use std::path::Path;

use aice_governance::{JsonValue, split_target_selector};

pub type RpcErr = (i64, String);

pub fn opt_str(map: &BTreeMap<String, JsonValue>, keys: &[&str]) -> Result<Option<String>, RpcErr> {
    for &k in keys {
        if let Some(v) = map.get(k) {
            return match v {
                JsonValue::String(s) => Ok(Some(s.clone())),
                JsonValue::Null => Ok(None),
                _ => Err((-32602, format!("Expected string for '{k}'"))),
            };
        }
    }
    Ok(None)
}

pub fn opt_bool(map: &BTreeMap<String, JsonValue>, keys: &[&str]) -> Result<Option<bool>, RpcErr> {
    for &k in keys {
        if let Some(v) = map.get(k) {
            return match v {
                JsonValue::Bool(b) => Ok(Some(*b)),
                JsonValue::Null => Ok(None),
                _ => Err((-32602, format!("Expected boolean for '{k}'"))),
            };
        }
    }
    Ok(None)
}

pub fn opt_usize(map: &BTreeMap<String, JsonValue>, keys: &[&str]) -> Result<Option<usize>, RpcErr> {
    for &k in keys {
        if let Some(v) = map.get(k) {
            return match v {
                JsonValue::Null => Ok(None),
                _ => {
                    let f = v
                        .as_f64()
                        .filter(|n| n.is_finite() && *n >= 0.0 && n.fract() == 0.0)
                        .ok_or_else(|| {
                            (-32602, format!("Expected non-negative integer for '{k}'"))
                        })?;
                    if f > usize::MAX as f64 {
                        return Err((-32602, format!("Integer overflow for '{k}'")));
                    }
                    let n = v
                        .as_u64()
                        .ok_or_else(|| (-32602, format!("Integer overflow for '{k}'")))?;
                    usize::try_from(n)
                        .map(Some)
                        .map_err(|_| (-32602, format!("Integer overflow for '{k}'")))
                }
            };
        }
    }
    Ok(None)
}

fn has_unquoted_nonregex_whitespace(s: &str) -> bool {
    let bytes = s.as_bytes();
    let (mut i, mut start) = (0, 0);
    let (mut quote, mut in_regex, mut in_class) = (None, false, false);
    while i < bytes.len() {
        let b = bytes[i];
        if let Some(q) = quote {
            if b == b'\\' {
                i += 2;
                continue;
            }
            if b == q {
                quote = None;
            }
        } else if in_regex {
            match b {
                b'\\' => {
                    i += 2;
                    continue;
                }
                b'[' if !in_class => in_class = true,
                b']' if in_class => in_class = false,
                b'/' if !in_class => in_regex = false,
                _ => {}
            }
        } else if b == b'\'' || b == b'"' {
            quote = Some(b);
        } else if b == b'/' && bytes[start..i].iter().all(|c| c.is_ascii_whitespace()) {
            in_regex = true;
        } else if b == b',' {
            start = i + 1;
        } else if b.is_ascii_whitespace() {
            return true;
        }
        i += 1;
    }
    false
}

pub fn split_read_target_string(raw: &str, cwd: &Path) -> Vec<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    if cwd.join(trimmed).exists() {
        return vec![trimmed.to_string()];
    }
    let (base, sel) = split_target_selector(trimmed);
    if !base.is_empty()
        && cwd.join(base).exists()
        && sel.is_none_or(|s| !has_unquoted_nonregex_whitespace(s))
    {
        return vec![trimmed.to_string()];
    }
    let mut parts = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut in_regex = false;
    let mut in_class = false;
    let chars: Vec<char> = trimmed.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if let Some(q) = quote {
            if ch == '\\' && i + 1 < chars.len() {
                cur.push(chars[i + 1]);
                i += 2;
                continue;
            }
            if ch == q {
                quote = None;
            } else {
                cur.push(ch);
            }
        } else if in_regex {
            cur.push(ch);
            if ch == '\\' && i + 1 < chars.len() {
                cur.push(chars[i + 1]);
                i += 2;
                continue;
            }
            if ch == '[' && !in_class {
                in_class = true;
            } else if ch == ']' && in_class {
                in_class = false;
            } else if ch == '/' && !in_class {
                in_regex = false;
            }
        } else if ch == '"' || ch == '\'' {
            quote = Some(ch);
        } else if ch == '/' && (cur.ends_with(':') || cur.ends_with('#') || cur.ends_with(',')) {
            in_regex = true;
            cur.push(ch);
        } else if ch.is_ascii_whitespace() {
            if !cur.is_empty() {
                parts.push(std::mem::take(&mut cur));
            }
        } else {
            cur.push(ch);
        }
        i += 1;
    }
    if !cur.is_empty() {
        parts.push(cur);
    }
    parts
}
