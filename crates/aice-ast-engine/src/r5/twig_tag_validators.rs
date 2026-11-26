pub fn valid_for_header(rest: &str) -> bool {
    let b = rest.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if (i == 0 || b[i - 1].is_ascii_whitespace())
            && b[i..].starts_with(b"in")
            && b.get(i + 2).is_some_and(|c| c.is_ascii_whitespace())
        {
            let vars = rest[..i].trim();
            let iter = rest[i + 2..].trim();
            return !vars.is_empty()
                && !iter.is_empty()
                && vars.split(',').all(|v| is_valid_twig_ident(v.trim()));
        }
        i += 1;
    }
    false
}

pub fn is_valid_twig_ident(s: &str) -> bool {
    let mut chars = s.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first.is_ascii_alphabetic() || first == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub fn find_top_level_assign(s: &str) -> Option<usize> {
    let (mut quote, mut depth, b, mut i) = (None, 0usize, s.as_bytes(), 0);
    while i < b.len() {
        if let Some(q) = quote {
            if b[i] == b'\\' {
                i += 2;
                continue;
            }
            if b[i] == q {
                quote = None;
            }
        } else {
            match b[i] {
                b'\'' | b'"' => quote = Some(b[i]),
                b'(' | b'[' | b'{' => depth += 1,
                b')' | b']' | b'}' => depth = depth.saturating_sub(1),
                b'=' if depth == 0
                    && b.get(i + 1) != Some(&b'=')
                    && (i == 0 || !matches!(b[i - 1], b'!' | b'<' | b'>' | b'=')) =>
                {
                    return Some(i);
                }
                _ => {}
            }
        }
        i += 1;
    }
    None
}

pub fn validate_macro_signature(rest: &str) -> Result<String, String> {
    let rest = rest.trim();
    let Some(open) = rest.find('(') else {
        return Err("Missing parameter list '(...)' in {% macro %}".to_string());
    };
    if !rest.ends_with(')') {
        return Err("Malformed parameter list in {% macro %}".to_string());
    }
    let name = rest[..open].trim();
    if !is_valid_twig_ident(name) {
        return Err("Invalid or missing macro name in {% macro %}".to_string());
    }
    let params = rest[open + 1..rest.len() - 1].trim();
    if !params.is_empty() {
        for raw_param in split_top_level_commas(params) {
            let p = raw_param.trim();
            if p.is_empty() {
                return Err("Empty parameter in {% macro %}".to_string());
            }
            if let Some(eq) = find_top_level_assign(p) {
                let pname = p[..eq].trim();
                let pdef = p[eq + 1..].trim();
                if !is_valid_twig_ident(pname) || pdef.is_empty() {
                    return Err("Malformed default parameter in {% macro %}".to_string());
                }
            } else if !is_valid_twig_ident(p) {
                return Err(format!("Invalid macro parameter '{p}' in {{% macro %}}"));
            }
        }
    }
    Ok(name.to_string())
}

fn split_top_level_commas(s: &str) -> Vec<&str> {
    let (mut quote, mut depth, b, mut i, mut start) = (None, 0usize, s.as_bytes(), 0, 0);
    let mut parts = Vec::new();
    while i < b.len() {
        if let Some(q) = quote {
            if b[i] == b'\\' {
                i += 2;
                continue;
            }
            if b[i] == q {
                quote = None;
            }
        } else {
            match b[i] {
                b'\'' | b'"' => quote = Some(b[i]),
                b'(' | b'[' | b'{' => depth += 1,
                b')' | b']' | b'}' => depth = depth.saturating_sub(1),
                b',' if depth == 0 => {
                    parts.push(&s[start..i]);
                    start = i + 1;
                }
                _ => {}
            }
        }
        i += 1;
    }
    parts.push(&s[start..]);
    parts
}
