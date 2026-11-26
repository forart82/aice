use crate::dep_callers_lang::{extract_python_imports, extract_rust_imports, rust_use_body};
use crate::dep_callers_quote::{QuoteDepthTracker, mask_span};
use crate::dep_callers_scan::contains_word;

#[allow(clippy::too_many_arguments)]
pub(crate) fn scan_rust_use_stmts(
    imp_work: &[String],
    code_lines: &mut [String],
    target_stems: &[&str],
    imported: &mut Vec<String>,
    bindings: &mut Vec<(String, String)>,
    ns_aliases: &mut Vec<String>,
    unqual_star: &mut bool,
) {
    let (mut seg_start, mut stmt) = (None::<(usize, usize)>, String::new());
    let (mut use_braces, mut brackets) = (0usize, 0usize);
    let (mut in_dq, mut escaped) = (false, false);
    for (li, line) in imp_work.iter().enumerate() {
        if seg_start.is_some() {
            stmt.push('\n');
        }
        for (col, ch) in line.char_indices() {
            if in_dq {
                if seg_start.is_some() {
                    stmt.push(ch);
                }
                if escaped {
                    escaped = false;
                } else if ch == '\\' {
                    escaped = true;
                } else if ch == '"' {
                    in_dq = false;
                }
                continue;
            }
            if ch == '"' {
                in_dq = true;
                if seg_start.is_some() {
                    stmt.push(ch);
                }
                continue;
            }
            if brackets > 0 {
                if seg_start.is_some() {
                    stmt.push(ch);
                }
                if ch == '[' {
                    brackets += 1;
                } else if ch == ']' {
                    brackets -= 1;
                }
                continue;
            }
            if seg_start.is_none() {
                if ch == '[' {
                    seg_start = Some((li, col));
                    stmt.push(ch);
                    brackets = 1;
                } else if !ch.is_whitespace() && !matches!(ch, ';' | '{' | '}' | ']') {
                    seg_start = Some((li, col));
                    stmt.push(ch);
                }
                continue;
            }
            stmt.push(ch);
            match ch {
                '[' => brackets += 1,
                '{' => {
                    if use_braces > 0 || rust_use_body(&stmt).is_some() {
                        use_braces += 1;
                    } else {
                        seg_start = None;
                        stmt.clear();
                    }
                }
                '}' => {
                    if use_braces > 0 {
                        use_braces -= 1;
                    } else {
                        seg_start = None;
                        stmt.clear();
                    }
                }
                ';' => {
                    if use_braces == 0
                        && let Some((sl, sc)) = seg_start.take()
                        && let Some(body) = rust_use_body(&stmt)
                    {
                        mask_span(code_lines, sl, sc, li, col + 1);
                        if target_stems.iter().any(|st| contains_word(body, st)) {
                            extract_rust_imports(&stmt, imported, bindings, ns_aliases, unqual_star);
                        }
                    }
                    use_braces = 0;
                    seg_start = None;
                    stmt.clear();
                }
                _ => {}
            }
        }
        escaped = false;
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn scan_python_import_stmts(
    imp_work: &[String],
    code_lines: &mut [String],
    target_stems: &[&str],
    imported: &mut Vec<String>,
    bindings: &mut Vec<(String, String)>,
    ns_aliases: &mut Vec<String>,
    unqual_star: &mut bool,
) {
    let mut tr = QuoteDepthTracker::new();
    let (mut seg_start, mut stmt) = (None::<(usize, usize)>, String::new());
    for (li, line) in imp_work.iter().enumerate() {
        if seg_start.is_some() {
            stmt.push('\n');
        }
        let mut iter = line.char_indices().peekable();
        while let Some((col, ch)) = iter.next() {
            let next = iter.peek().map(|&(_, n)| n);
            tr.step(ch, next);
            if tr.at_top_level() {
                if seg_start.is_none() {
                    if !ch.is_whitespace() && ch != ';' {
                        seg_start = Some((li, col));
                        stmt.push(ch);
                    }
                } else {
                    stmt.push(ch);
                    if ch == ';' {
                        let (sl, sc) = seg_start.take().unwrap();
                        finish_py_stmt(
                            &stmt,
                            (sl, sc, li, col + 1),
                            code_lines,
                            target_stems,
                            imported,
                            bindings,
                            ns_aliases,
                            unqual_star,
                        );
                        stmt.clear();
                    }
                }
            } else if seg_start.is_some() {
                stmt.push(ch);
            }
        }
        tr.end_line();
        if tr.at_top_level()
            && !line.trim_end().ends_with('\\')
            && let Some((sl, sc)) = seg_start.take()
        {
            finish_py_stmt(
                &stmt,
                (sl, sc, li, line.len()),
                code_lines,
                target_stems,
                imported,
                bindings,
                ns_aliases,
                unqual_star,
            );
            stmt.clear();
        }
    }
}

fn is_py_import_stmt(t: &str) -> bool {
    t.strip_prefix("from")
        .is_some_and(|r| r.starts_with(|c: char| c.is_whitespace() || matches!(c, '\\' | '.')))
        || t.strip_prefix("import")
            .is_some_and(|r| r.starts_with(|c: char| c.is_whitespace() || c == '\\'))
}

#[allow(clippy::too_many_arguments)]
fn finish_py_stmt(
    stmt: &str,
    span: (usize, usize, usize, usize),
    code_lines: &mut [String],
    target_stems: &[&str],
    imported: &mut Vec<String>,
    bindings: &mut Vec<(String, String)>,
    ns_aliases: &mut Vec<String>,
    unqual_star: &mut bool,
) {
    let t = stmt.trim_start();
    if is_py_import_stmt(t) {
        mask_span(code_lines, span.0, span.1, span.2, span.3);
        if target_stems.iter().any(|st| contains_word(stmt, st)) {
            extract_python_imports(stmt, target_stems, imported, bindings, ns_aliases, unqual_star);
        }
    }
}

pub(crate) fn detect_rust_raw(b: &[u8], i: usize) -> Option<(usize, usize)> {
    if i > 0 && (b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'_') {
        return None;
    }
    let r_off = if b[i] == b'r' {
        1
    } else if matches!(b[i], b'b' | b'c') && b.get(i + 1) == Some(&b'r') {
        2
    } else {
        return None;
    };
    let mut hashes = 0usize;
    while b.get(i + r_off + hashes) == Some(&b'#') {
        hashes += 1;
    }
    (b.get(i + r_off + hashes) == Some(&b'"')).then_some((r_off + hashes + 1, hashes))
}

pub(crate) fn rust_char_lit_len(raw: &str, i: usize) -> Option<usize> {
    let b = raw.as_bytes();
    if b.get(i + 1) == Some(&b'\\') {
        let mut j = i + 2;
        if j < b.len() {
            j += raw[j..].chars().next().map_or(1, char::len_utf8);
        }
        let limit = b.len().min(i + 16);
        while j < limit {
            if b[j] == b'\'' {
                return Some(j + 1 - i);
            }
            if matches!(b[j], b' ' | b'\t' | b';') {
                return None;
            }
            j += raw[j..].chars().next().map_or(1, char::len_utf8);
        }
        return None;
    }
    let ch = raw[i + 1..].chars().next()?;
    let end = i + 1 + ch.len_utf8();
    (b.get(end) == Some(&b'\'')).then_some(end + 1 - i)
}

pub(crate) fn copy_single_quote(
    raw: &str,
    b: &[u8],
    mut i: usize,
    imp: &mut String,
    code: &mut String,
) -> usize {
    let q = b[i];
    imp.push(q as char);
    code.push(q as char);
    i += 1;
    while i < b.len() {
        if b[i] == b'\\' && i + 1 < b.len() {
            let nch = raw[i + 1..].chars().next().unwrap();
            imp.push('\\');
            imp.push(nch);
            for _ in 0..(1 + nch.len_utf8()) {
                code.push(' ');
            }
            i += 1 + nch.len_utf8();
            continue;
        }
        let ch = raw[i..].chars().next().unwrap();
        imp.push(ch);
        i += ch.len_utf8();
        if ch as u32 == q as u32 {
            code.push(q as char);
            break;
        }
        for _ in 0..ch.len_utf8() {
            code.push(' ');
        }
    }
    i
}
