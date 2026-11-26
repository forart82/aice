use aice_lang_registry::LanguageId;
use crate::r5::snippet_lit::{JsLexState, StepQuote};

pub(crate) fn strip_trailing_angles(s: &str) -> &str {
    let t = s.trim_end();
    if !t.ends_with('>') || t.ends_with("=>") || t.ends_with("->") {
        return t;
    }
    let b = t.as_bytes();
    let (mut i, mut depth, mut pd, mut bd, mut cd) = (b.len() - 1, 0isize, 0usize, 0usize, 0usize);
    loop {
        match b[i] {
            b')' => pd += 1,
            b'(' => {
                if pd == 0 { return t; }
                pd -= 1;
            }
            b']' => bd += 1,
            b'[' => {
                if bd == 0 { return t; }
                bd -= 1;
            }
            b'}' => cd += 1,
            b'{' => {
                if cd == 0 { return t; }
                cd -= 1;
            }
            b';' if pd == 0 && bd == 0 && cd == 0 => return t,
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'=' | b'-')) => {
                depth += 1;
            }
            b'<' if pd == 0 && bd == 0 && cd == 0 => {
                depth -= 1;
                if depth == 0 {
                    return t[..i].trim_end();
                }
            }
            _ => {}
        }
        if i == 0 { break; }
        i -= 1;
    }
    t
}
pub(crate) fn skip_balanced_delim(b: &[u8], start: usize, open: u8, close: u8) -> Option<usize> {
    if b.get(start) != Some(&open) {
        return None;
    }
    let (mut i, mut js, mut d, mut pd, mut bd, mut cd) = (start, JsLexState::new(), 0usize, 0usize, 0usize, 0usize);
    while i < b.len() {
        if b[i] == b'\n' { js.on_newline(LanguageId::TypeScript); i += 1; continue; }
        match js.step_quote(LanguageId::TypeScript, b, &mut i) {
            StepQuote::Consumed => continue,
            StepQuote::EnteredInterp => {
                if open == b'{' && pd == 0 && bd == 0 && cd == 0 { d += 1; } else { cd += 1; }
                continue;
            }
            StepQuote::NotInQuote => {}
        }
        if let Some((end, _)) = js.match_special(LanguageId::TypeScript, b, i) { i = end; continue; }
        if js.open_quote(LanguageId::TypeScript, b, &mut i) { continue; }
        let c = b[i];
        if open != b'<' && c == b'<' { js.step_byte(LanguageId::TypeScript, b, &mut i); continue; }
        if c == open && pd == 0 && bd == 0 && cd == 0 {
            d += 1;
        } else if c == close && pd == 0 && bd == 0 && cd == 0 && (close != b'>' || i == 0 || !matches!(b[i - 1], b'-' | b'=')) {
            d -= 1;
            if d == 0 { return Some(i + 1); }
        } else {
            match c {
                b'(' => pd += 1,
                b')' => { if pd == 0 { return None; } pd -= 1; }
                b'[' => bd += 1,
                b']' => { if bd == 0 { return None; } bd -= 1; }
                b'{' => cd += 1,
                b'}' => { if cd == 0 { return None; } cd -= 1; }
                _ => {}
            }
        }
        js.step_byte(LanguageId::TypeScript, b, &mut i);
    }
    None
}

fn scan_decorator_callee_end(s: &str, stop_before_extra: bool) -> Option<usize> {
    let b = s.as_bytes();
    if b.is_empty() { return None; }
    let is_id_start = |c: u8| c.is_ascii_alphabetic() || matches!(c, b'_' | b'$');
    let is_id_cont = |c: u8| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$');
    let mut i = if b[0] == b'(' {
        skip_balanced_delim(b, 0, b'(', b')')?
    } else if is_id_start(b[0]) {
        let mut j = 1;
        while j < b.len() && is_id_cont(b[j]) { j += 1; }
        j
    } else {
        return None;
    };
    while i < b.len() {
        let mut saw_nl = false;
        let tok_end = i;
        while i < b.len() && b[i].is_ascii_whitespace() {
            if b[i] == b'\n' { saw_nl = true; }
            i += 1;
        }
        if i == b.len() { return Some(tok_end); }
        if b[i..].starts_with(b"?.") {
            i += 2;
            while i < b.len() && b[i].is_ascii_whitespace() { i += 1; }
            if b.get(i) == Some(&b'[') {
                i = skip_balanced_delim(b, i, b'[', b']')?;
            } else if b.get(i) == Some(&b'(') {
                i = skip_balanced_delim(b, i, b'(', b')')?;
            } else if b.get(i).is_some_and(|&c| is_id_start(c)) {
                i += 1;
                while i < b.len() && is_id_cont(b[i]) { i += 1; }
            } else {
                return None;
            }
        } else if b[i] == b'.' {
            i += 1;
            while i < b.len() && b[i].is_ascii_whitespace() { i += 1; }
            if b.get(i).is_some_and(|&c| is_id_start(c)) {
                i += 1;
                while i < b.len() && is_id_cont(b[i]) { i += 1; }
            } else {
                return None;
            }
        } else if stop_before_extra && i > tok_end && b[i] == b'[' {
            return Some(tok_end);
        } else if !saw_nl && b[i] == b'[' {
            i = skip_balanced_delim(b, i, b'[', b']')?;
        } else if !saw_nl && b[i] == b'(' {
            i = skip_balanced_delim(b, i, b'(', b')')?;
        } else if !saw_nl && b[i] == b'<' {
            i = skip_balanced_delim(b, i, b'<', b'>')?;
        } else if stop_before_extra && (i > tok_end || matches!(b[i], b'"' | b'\'')) {
            return Some(tok_end);
        } else {
            return None;
        }
    }
    Some(i)
}

fn is_valid_decorator_callee(s: &str) -> bool { scan_decorator_callee_end(s, false).is_some() }

pub(crate) fn strip_leading_ts_decorators(s: &str) -> &str {
    let mut rem = s.trim_start();
    while let Some(after_at) = rem.strip_prefix('@') {
        let Some(end) = scan_decorator_callee_end(after_at, true) else { break; };
        rem = after_at[end..].trim_start();
    }
    rem
}
pub(crate) fn is_decorator_call_hdr(hdr: &str) -> bool {
    let (mut pd, mut bd, mut cd, mut last_at) = (0usize, 0usize, 0usize, None);
    for (i, &c) in hdr.as_bytes().iter().enumerate() {
        match c {
            b'(' => pd += 1,
            b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1,
            b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1,
            b'}' => cd = cd.saturating_sub(1),
            b'@' if pd == 0 && bd == 0 && cd == 0 => last_at = Some(i),
            _ => {}
        }
    }
    let Some(at) = last_at else { return false; };
    let after = hdr[at + 1..].trim();
    let no_gen = strip_trailing_angles(after);
    is_valid_decorator_callee(no_gen)
}
const TS_CLASS_MODS: &[&str] = &[
    "public", "private", "protected", "static", "override", "abstract", "readonly", "declare",
    "async", "get", "set",
];
const TS_OBJ_MODS: &[&str] = &["async", "get", "set"];

pub(crate) fn peel_ts_method_modifiers(s: &str, class_mods: bool) -> &str {
    let mut rem = s.trim();
    let mods = if class_mods { TS_CLASS_MODS } else { TS_OBJ_MODS };
    loop {
        if let Some(after_star) = rem.strip_prefix('*') {
            let rest = after_star.trim_start();
            if !rest.is_empty() { rem = rest; continue; }
        }
        let mut peeled = false;
        for &kw in mods {
            if !(class_mods && kw == "declare") && let Some(after) = rem.strip_prefix(kw)
                && after.chars().next().is_some_and(|c| c.is_ascii_whitespace() || (kw == "async" && c == '*'))
            {
                let rest = after.trim_start();
                if !rest.is_empty() { rem = rest; peeled = true; break; }
            }
        }
        if !peeled { break; }
    }
    rem
}

pub(crate) fn is_only_ts_modifiers(s: &str, class_mods: bool) -> bool {
    let mods = if class_mods { TS_CLASS_MODS } else { TS_OBJ_MODS };
    let t = s.trim();
    !t.is_empty() && t.split_whitespace().all(|w| w == "*" || mods.contains(&w))
}

pub(crate) fn is_quoted_lit(s: &str) -> bool {
    let rb = s.as_bytes();
    if rb.len() < 2 || !matches!(rb[0], b'"' | b'\'') { return false; }
    let (q, mut k, mut esc) = (rb[0], 1usize, false);
    while k < rb.len() {
        if esc { esc = false; }
        else if rb[k] == b'\\' { esc = true; }
        else if rb[k] == q { return k == rb.len() - 1; }
        k += 1;
    }
    false
}
pub(crate) fn is_balanced_computed_prop(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() < 3 || b[0] != b'[' || b[b.len() - 1] != b']' {
        return false;
    }
    let (mut bd, mut pd, mut cd) = (0usize, 0usize, 0usize);
    for (i, &c) in b.iter().enumerate() {
        match c {
            b'[' => bd += 1,
            b']' => {
                bd -= 1;
                if bd == 0 {
                    return i == b.len() - 1 && pd == 0 && cd == 0;
                }
            }
            b'(' => pd += 1,
            b')' => {
                if pd == 0 { return false; }
                pd -= 1;
            }
            b'{' => cd += 1,
            b'}' => {
                if cd == 0 { return false; }
                cd -= 1;
            }
            b',' if bd == 1 && pd == 0 && cd == 0 => return false,
            _ => {}
        }
    }
    false
}

fn is_valid_ts_method_ident(id: &str) -> bool {
    !id.is_empty()
        && ((id.bytes().all(|c| c.is_ascii_digit()))
            || (!id.as_bytes()[0].is_ascii_digit()
                && id.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$'))))
        && !matches!(
            id,
            "new" | "typeof" | "void" | "delete" | "await" | "yield" | "return"
                | "throw" | "if" | "for" | "while" | "switch" | "catch"
        )
}

pub(crate) fn is_ts_obj_shorthand_method_hdr(hdr: &str) -> bool {
    let no_gen = strip_trailing_angles(hdr);
    let (mut pd, mut bd, mut cd, mut last) = (0usize, 0usize, 0usize, 0usize);
    for (i, &c) in no_gen.as_bytes().iter().enumerate() {
        match c {
            b'(' => pd += 1,
            b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1,
            b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1,
            b'}' => cd = cd.saturating_sub(1),
            b',' if pd == 0 && bd == 0 && cd == 0 => last = i + 1,
            _ => {}
        }
    }
    let seg = no_gen[last..].trim();
    let rem = peel_ts_method_modifiers(seg, false);
    is_balanced_computed_prop(rem) || is_valid_ts_method_ident(rem)
}
