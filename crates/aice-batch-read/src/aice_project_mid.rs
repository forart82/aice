use aice_lang_registry::LanguageId;

use crate::aice_project_util::slice_lines_range;

pub(crate) fn is_hash_comment_lang(lang: LanguageId) -> bool {
    matches!(
        lang,
        LanguageId::Python | LanguageId::Ruby | LanguageId::Bash | LanguageId::Yaml | LanguageId::Toml
    )
}

pub(crate) fn ends_with_unfilled_call(src: &str) -> bool {
    let t = src.trim_end();
    if !t.ends_with('(') {
        return false;
    }
    let before = t[..t.len() - 1].trim_end();
    let ident_start = before
        .rfind(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .map_or(0, |i| i + 1);
    let ident = &before[ident_start..];
    !ident.is_empty() && !matches!(ident, "if" | "for" | "while" | "match" | "switch" | "return")
}

pub(crate) fn preserves_call_args_text(raw: &str, aice: &str) -> bool {
    let bytes = raw.as_bytes();
    for i in 1..bytes.len() {
        if bytes[i] != b'(' {
            continue;
        }
        let mut s = i;
        while s > 0 && (bytes[s - 1].is_ascii_alphanumeric() || bytes[s - 1] == b'_') {
            s -= 1;
        }
        let ident = &raw[s..i];
        if !ident.is_empty()
            && !matches!(ident, "if" | "for" | "while" | "match" | "switch")
            && !raw[i + 1..].trim_start().starts_with(')')
            && aice.contains(&format!("{ident}()"))
        {
            return false;
        }
    }
    true
}

pub(crate) fn has_body_code_after_sig(lang: LanguageId, slice: &str, multi_line: bool) -> bool {
    if lang == LanguageId::Python {
        return has_python_body_after_def(slice);
    }
    if lang == LanguageId::Ruby {
        if !multi_line {
            return slice.split_once(';').is_some_and(|(_, r)| has_non_closer(r));
        }
        return slice.lines().skip(1).any(line_has_non_closer);
    }
    let Some(brace_pos) = find_top_level_open_brace(lang, slice) else {
        return false;
    };
    has_non_closer(&slice[brace_pos + 1..])
}

fn has_python_body_after_def(slice: &str) -> bool {
    let b = slice.as_bytes();
    let (mut i, mut depth, mut q, mut lc) = (0usize, 0isize, None::<u8>, false);
    while i < b.len() {
        if lc {
            if b[i] == b'\n' {
                lc = false;
            }
            i += 1;
        } else if let Some(qc) = q {
            if b[i] == b'\\' {
                i += 2;
            } else {
                if b[i] == qc {
                    q = None;
                }
                i += 1;
            }
        } else {
            match b[i] {
                b'#' => lc = true,
                b'"' | b'\'' => q = Some(b[i]),
                b'(' | b'[' | b'{' => depth += 1,
                b')' | b']' | b'}' => depth = (depth - 1).max(0),
                b':' if depth == 0 => {
                    let rest = &slice[i + 1..];
                    let after_eol = rest.split_once('\n').map_or("", |(_, tail)| tail);
                    let same_line = rest.split_once('\n').map_or(rest, |(h, _)| h);
                    let same_code = same_line.split('#').next().unwrap_or("").trim();
                    return !same_code.is_empty() || has_non_closer(after_eol);
                }
                _ => {}
            }
            i += 1;
        }
    }
    false
}

fn find_top_level_open_brace(lang: LanguageId, slice: &str) -> Option<usize> {
    let b = slice.as_bytes();
    let (mut i, mut par, mut brk) = (0usize, 0isize, 0isize);
    let (mut q, mut lc, mut bc) = (None::<u8>, false, false);
    while i < b.len() {
        if lc {
            if b[i] == b'\n' { lc = false; }
            i += 1;
        } else if bc {
            if b[i] == b'*' && b.get(i + 1) == Some(&b'/') { bc = false; i += 2; } else { i += 1; }
        } else if let Some(qc) = q {
            if b[i] == b'\\' { i += 2; } else { if b[i] == qc { q = None; } i += 1; }
        } else if b[i] == b'/' && b.get(i + 1) == Some(&b'/') {
            lc = true; i += 2;
        } else if b[i] == b'/' && b.get(i + 1) == Some(&b'*') {
            bc = true; i += 2;
        } else if lang == LanguageId::Rust
            && let Some(ni) = crate::intra_wrap::skip_rust_raw_string(b, i)
        {
            i = ni;
        } else if lang == LanguageId::Rust && b[i] == b'\'' {
            i = crate::intra_wrap::skip_rust_char_or_lifetime(slice, i);
        } else {
            match b[i] {
                b'"' | b'\'' | b'`' => q = Some(b[i]),
                b'(' => par += 1,
                b')' => par = (par - 1).max(0),
                b'[' => brk += 1,
                b']' => brk = (brk - 1).max(0),
                b'{' if par == 0 && brk == 0 => return Some(i),
                _ => {}
            }
            i += 1;
        }
    }
    None
}

fn line_has_non_closer(line: &str) -> bool {
    let t = line.trim();
    !t.is_empty() && !matches!(t, "}" | "};" | "}," | ")" | ");" | ")," | "]" | "];" | "]," | "end")
}

fn has_non_closer(s: &str) -> bool {
    s.lines().any(line_has_non_closer)
}

fn line_indent(line: &str) -> usize {
    line.bytes().take_while(|&b| b == b' ' || b == b'\t').count()
}

pub(crate) fn python_indent_bounds(src: &str) -> Option<(usize, usize)> {
    let mut first = None;
    let mut min_ind = usize::MAX;
    for line in src.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let ind = line_indent(line);
        if first.is_none() {
            first = Some(ind);
        }
        min_ind = min_ind.min(ind);
    }
    first.map(|f| (f, min_ind))
}

fn is_standalone_py_header(trimmed: &str) -> bool {
    let code = trimmed.split('#').next().unwrap_or("").trim_end();
    if !code.ends_with(':') {
        return false;
    }
    [
        "for ", "async for ", "if ", "while ", "with ", "async with ", "try:", "match ",
    ]
    .iter()
    .any(|pfx| code.starts_with(pfx))
}

pub(crate) fn reconstruct_python_mid_block(
    full_src: &str,
    starts: &[usize],
    fn_start: usize,
    win_start: usize,
    mid_src: &str,
) -> Option<String> {
    let (first_ind, min_ind) = python_indent_bounds(mid_src)?;
    if first_ind <= min_ind || win_start <= fn_start {
        return None;
    }
    let fn_line = slice_lines_range(full_src, starts, fn_start, fn_start);
    let fn_ind = line_indent(fn_line);
    if min_ind <= fn_ind {
        return None;
    }
    let mut need_ind = first_ind;
    let mut ancestors: Vec<String> = Vec::new();
    for ln in (fn_start + 1..win_start).rev() {
        let raw_line = slice_lines_range(full_src, starts, ln, ln).trim_end_matches(['\r', '\n']);
        let t = raw_line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let ind = line_indent(raw_line);
        if ind >= need_ind {
            continue;
        }
        if ind <= fn_ind || !is_standalone_py_header(t) {
            return None;
        }
        ancestors.push(raw_line.to_string());
        need_ind = ind;
        if need_ind <= min_ind {
            break;
        }
    }
    if ancestors.is_empty() || need_ind > min_ind {
        return None;
    }
    ancestors.reverse();
    let mut out = ancestors.join("\n");
    out.push('\n');
    out.push_str(mid_src);
    Some(out)
}

pub(crate) fn has_unclosed_paren_or_bracket(lang: LanguageId, src: &str) -> bool {
    let b = src.as_bytes();
    let (mut i, mut par, mut brk) = (0usize, 0isize, 0isize);
    let (mut q, mut lc, mut bc) = (None::<u8>, false, false);
    while i < b.len() {
        if lc {
            if b[i] == b'\n' { lc = false; }
            i += 1;
        } else if bc {
            if b[i] == b'*' && b.get(i + 1) == Some(&b'/') { bc = false; i += 2; } else { i += 1; }
        } else if let Some(qc) = q {
            if b[i] == b'\\' { i += 2; } else { if b[i] == qc { q = None; } i += 1; }
        } else if b[i] == b'/' && b.get(i + 1) == Some(&b'/') {
            lc = true; i += 2;
        } else if b[i] == b'/' && b.get(i + 1) == Some(&b'*') {
            bc = true; i += 2;
        } else if is_hash_comment_lang(lang) && b[i] == b'#' {
            lc = true; i += 1;
        } else if lang == LanguageId::Rust
            && let Some(ni) = crate::intra_wrap::skip_rust_raw_string(b, i)
        {
            i = ni;
        } else if lang == LanguageId::Rust && b[i] == b'\'' {
            i = crate::intra_wrap::skip_rust_char_or_lifetime(src, i);
        } else {
            match b[i] {
                b'"' | b'\'' | b'`' => q = Some(b[i]),
                b'(' => par += 1,
                b')' => par -= 1,
                b'[' => brk += 1,
                b']' => brk -= 1,
                _ => {}
            }
            i += 1;
        }
    }
    par > 0 || brk > 0
}
