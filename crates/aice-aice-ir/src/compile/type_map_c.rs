use crate::compile::type_map_c_kw::validate_c_specifiers;

pub(crate) fn map_c_scalar(name: &str) -> Option<&'static str> {
    match name {
        "std::string" | "str" | "String" | "string" => Some("const char*"),
        "const std::string" | "const str" | "const String" | "const string" => {
            Some("const char*")
        }
        "i8" | "i16" | "i32" | "i64" | "i128" | "isize" => Some("int"),
        "const i8" | "const i16" | "const i32" | "const i64" | "const i128" | "const isize" => {
            Some("const int")
        }
        "u8" | "u16" | "u32" | "u64" | "u128" | "usize" => Some("unsigned int"),
        "const u8" | "const u16" | "const u32" | "const u64" | "const u128" | "const usize" => {
            Some("const unsigned int")
        }
        "f32" | "f64" => Some("double"),
        "const f32" | "const f64" => Some("const double"),
        "boolean" => Some("bool"),
        "const boolean" => Some("const bool"),
        "Unit" | "None" | "()" => Some("void"),
        _ => None,
    }
}

enum CWrap {
    Stars(usize),
    ConstStar,
    RefConstStar,
    SliceConst,
    ContainerConstStar,
}

pub(crate) fn emit_c_raw_type(init_raw: &str) -> String {
    let mut cur = init_raw;
    let mut wraps: Vec<CWrap> = Vec::new();
    let base = loop {
        let s = cur.trim();
        if s.is_empty() { break "void*".to_string(); }
        if let Some(mapped) = map_c_scalar(s) { break mapped.to_string(); }
        if has_top_level_compound(s) || matches!(s, "*const" | "*mut") { break "void*".to_string(); }
        if let Some(rest) = s.strip_prefix('&') {
            match step_c_ref(rest, &mut wraps) {
                Ok(next) => { cur = next; continue; }
                Err(done) => break done,
            }
        }
        if let Some(inner) = s.strip_suffix("&&").or_else(|| s.strip_suffix('&')) {
            let b = inner.trim();
            if matches!(b, "const std::string" | "std::string") {
                break if b.starts_with("const ") { "const char*" } else { "char*" }.to_string();
            }
            wraps.push(CWrap::Stars(1));
            cur = b;
            continue;
        }
        if let Some(inner) = s.strip_prefix("*const ") {
            wraps.push(CWrap::ConstStar);
            cur = inner;
            continue;
        }
        if let Some(inner) = s.strip_prefix("*mut ").or_else(|| s.strip_prefix('*')) {
            wraps.push(CWrap::Stars(1));
            cur = inner;
            continue;
        }
        if s.contains('(') {
            let ptr_count = s.chars().rev().take_while(|&c| c == '*').count();
            let core = s[..s.len() - ptr_count].trim_end();
            if core == "()" {
                let mut out = "void".to_string();
                out.extend(std::iter::repeat_n('*', ptr_count));
                break out;
            }
            break "void*".to_string();
        }
        let ptr_count = s.chars().rev().take_while(|&c| c == '*').count();
        if ptr_count > 0 {
            let core = s[..s.len() - ptr_count].trim_end();
            if core.is_empty() { break "void*".to_string(); }
            wraps.push(CWrap::Stars(ptr_count));
            cur = core;
            continue;
        }
        if let Some(inner) = s.strip_suffix("[]").or_else(|| s.strip_prefix("[]")) {
            wraps.push(CWrap::Stars(1));
            cur = inner;
            continue;
        }
        if let Some(inner) = strip_outer_brackets(s) {
            match step_c_bracket(inner, &mut wraps) {
                Ok(next) => { cur = next; continue; }
                Err(done) => break done,
            }
        }
        if let Some(lt) = s.find('<') && is_wrapped_balanced(&s[lt..], '<', '>') {
            let b = s[..lt].trim();
            let inner = s[lt + 1..s.len() - 1].trim();
            let base_no_const = b.strip_prefix("const ").unwrap_or(b);
            if is_c_ptr_container(base_no_const) {
                wraps.push(if b.starts_with("const ") { CWrap::ContainerConstStar } else { CWrap::Stars(1) });
                cur = first_top_level_comma(inner);
                continue;
            }
            if matches!(base_no_const, "Option" | "std::optional" | "Nullable") {
                cur = inner;
                continue;
            }
            cur = b;
            continue;
        }
        if let Some(lb) = s.find('[') && lb > 0 && is_wrapped_balanced(&s[lb..], '[', ']') {
            let b = s[..lb].trim();
            let inner = s[lb + 1..s.len() - 1].trim();
            if matches!(b, "list" | "List" | "Vec" | "Array") {
                wraps.push(CWrap::Stars(1));
                cur = first_top_level_comma(inner);
                continue;
            }
            cur = if b == "Option" { inner } else { b };
            continue;
        }
        break finalize_c_core(s);
    };
    let mut out = base;
    for w in wraps.into_iter().rev() {
        match w {
            CWrap::Stars(n) => out.extend(std::iter::repeat_n('*', n)),
            CWrap::ConstStar => {
                out = if out.starts_with("const ") { format!("{out}*") } else { format!("const {out}*") };
            }
            CWrap::RefConstStar => {
                out = if !out.starts_with("const ") { format!("const {out}*") } else { format!("{out}*") };
            }
            CWrap::SliceConst => {
                if !out.starts_with("const ") { out = format!("const {out}"); }
            }
            CWrap::ContainerConstStar => {
                out = if !out.starts_with("const ") { format!("const {out}*") } else { format!("{out}*") };
            }
        }
    }
    out
}

fn step_c_ref<'a>(rest: &'a str, wraps: &mut Vec<CWrap>) -> Result<&'a str, String> {
    let mut r = rest.trim_start();
    if let Some(after_q) = r.strip_prefix('\'') {
        r = after_q.split_once(char::is_whitespace).map(|(_, tail)| tail.trim_start()).unwrap_or(r);
    }
    let is_mut = if let Some(m) = r.strip_prefix("mut ").or_else(|| r.strip_prefix("mut\t")) {
        r = m.trim_start();
        true
    } else {
        false
    };
    if matches!(r, "str" | "String" | "string" | "std::string") {
        return Err(if is_mut { "char*" } else { "const char*" }.to_string());
    }
    if let Some(slice_inner) = strip_outer_brackets(r) {
        if !is_mut { wraps.push(CWrap::SliceConst); }
        return step_c_bracket(slice_inner, wraps);
    }
    wraps.push(if is_mut { CWrap::Stars(1) } else { CWrap::RefConstStar });
    Ok(r)
}

fn step_c_bracket<'a>(inner: &'a str, wraps: &mut Vec<CWrap>) -> Result<&'a str, String> {
    let t = inner.trim();
    if t.is_empty() || find_top_level_char(t, ',').is_some() {
        return Err("void*".to_string());
    }
    let elem = match find_top_level_char(t, ';') {
        Some(idx) => t[..idx].trim(),
        None => t,
    };
    if elem.is_empty() { return Err("void*".to_string()); }
    wraps.push(CWrap::Stars(1));
    Ok(elem)
}

fn is_c_ptr_container(name: &str) -> bool {
    matches!(
        name,
        "Vec"
            | "std::vector"
            | "List"
            | "Array"
            | "Slice"
            | "Box"
            | "Rc"
            | "Arc"
            | "std::unique_ptr"
            | "std::shared_ptr"
    )
}

fn strip_outer_brackets(s: &str) -> Option<&str> {
    if is_wrapped_balanced(s, '[', ']') {
        Some(&s[1..s.len() - 1])
    } else {
        None
    }
}

fn is_wrapped_balanced(s: &str, open: char, close: char) -> bool {
    if !s.starts_with(open) || !s.ends_with(close) || s.len() < open.len_utf8() + close.len_utf8() {
        return false;
    }
    let mut depth = 0usize;
    for (i, ch) in s.char_indices() {
        if ch == open {
            depth += 1;
        } else if ch == close {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                return i + ch.len_utf8() == s.len();
            }
        }
    }
    false
}

fn find_top_level_char(s: &str, target: char) -> Option<usize> {
    let mut depth = 0usize;
    for (i, ch) in s.char_indices() {
        if depth == 0 && ch == target {
            return Some(i);
        }
        match ch {
            '<' | '(' | '[' | '{' => depth += 1,
            '>' | ')' | ']' | '}' => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    None
}

fn first_top_level_comma(s: &str) -> &str {
    match find_top_level_char(s, ',') {
        Some(idx) => s[..idx].trim(),
        None => s.trim(),
    }
}

fn has_top_level_compound(s: &str) -> bool {
    let mut depth = 0usize;
    for (i, ch) in s.char_indices() {
        if depth == 0 {
            if matches!(ch, ',' | '|' | '{') {
                return true;
            }
            if ch == '&'
                && i > 0
                && !s[i..].trim_matches(|c: char| c == '&' || c.is_whitespace()).is_empty()
            {
                return true;
            }
            let tail = &s[i..];
            if tail.starts_with("=>") || tail.starts_with("->") {
                return true;
            }
            if tail.starts_with("map[")
                && (i == 0 || !s[..i].ends_with(|c: char| c.is_ascii_alphanumeric() || c == '_'))
            {
                return true;
            }
        }
        match ch {
            '<' | '(' | '[' | '{' => depth += 1,
            '>' | ')' | ']' | '}' => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    false
}

fn finalize_c_core(s: &str) -> String {
    let normalized = s.replace("::", "_").replace(['.', '\\'], "_");
    let words: Vec<&str> = normalized.split_whitespace().collect();
    if words.is_empty() {
        return "void*".to_string();
    }
    let valid_words = words.iter().all(|w| {
        let mut chars = w.chars();
        chars.next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
            && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
    });
    if !valid_words || !validate_c_specifiers(&words) {
        return "void*".to_string();
    }
    if words.last() == Some(&"void") && words.contains(&"restrict") {
        return words.into_iter().filter(|w| *w != "restrict").collect::<Vec<_>>().join(" ");
    }
    words.join(" ")
}
