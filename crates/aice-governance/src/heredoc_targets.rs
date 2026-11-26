use std::path::{Path, PathBuf};

use crate::binary_probe::{BinaryProbeResult, probe_bytes};
use crate::json::{JsonValue, parse_json};
use crate::target_spec::{push_unique_path, split_target_selector};

fn strip_flag_with_arg<'a>(s: &'a str, flag: &str) -> Option<&'a str> {
    let idx = s.to_ascii_lowercase().rfind(flag)?;
    let (before, after) = (&s[..idx], &s[idx + flag.len()..]);
    if !before.ends_with(|c: char| c.is_ascii_whitespace())
        || !(after.is_empty() || after.starts_with('=') || after.starts_with(|c: char| c.is_ascii_whitespace()))
    { return None; }
    let r = after.strip_prefix('=').unwrap_or(after).trim_start();
    let ok = r.is_empty() || (r.starts_with('"') && r[1..].ends_with('"')) || (r.starts_with('\'') && r[1..].ends_with('\'')) || !r.contains(char::is_whitespace);
    ok.then(|| before.trim_end())
}

fn strip_clone_suffix(s: &str) -> Option<&str> {
    let lower = s.to_ascii_lowercase();
    for m in ["(clone", "@clone"] {
        if let Some(idx) = lower.rfind(m) && s[..idx].ends_with(|c: char| c.is_ascii_whitespace()) {
            let a = s[idx + m.len()..].trim();
            let ok = if m == "(clone" { a.ends_with(')') && !a[..a.len() - 1].contains(['\n', '\r']) }
                else { (a.starts_with('(') && a.ends_with(')')) || (!a.is_empty() && !a.contains(char::is_whitespace)) };
            if ok { return Some(s[..idx].trim_end()); }
        }
    }
    None
}

fn strip_heredoc_modifiers(raw: &str) -> &str {
    let mut cur = raw.trim();
    loop {
        let (prev, lower) = (cur, cur.to_ascii_lowercase());
        for sfx in ["--delete", "(delete)", ":delete", "-d", "@replace-docs", "@strip-docs", "@drop-docs"] {
            if lower.ends_with(sfx) && cur.len() > sfx.len() {
                let pfx = &cur[..cur.len() - sfx.len()];
                if matches!(sfx, "(delete)" | ":delete") || pfx.ends_with(|c: char| c.is_ascii_whitespace()) { cur = pfx.trim_end(); break; }
            }
        }
        if cur == prev && let Some(s) = strip_clone_suffix(cur) { cur = s; }
        if cur == prev { for f in ["--insert-after", "--insert-before"] { if let Some(s) = strip_flag_with_arg(cur, f) { cur = s; break; } } }
        if cur == prev { break; }
    }
    cur
}

fn parse_heredoc_header_line(trimmed: &str) -> Option<&str> {
    let header = strip_heredoc_modifiers(trimmed);
    if header.is_empty() || header.bytes().all(|b| b == b'=') { return None; }
    let eq_l = header.bytes().take_while(|&b| b == b'=').count();
    let eq_r = header.bytes().rev().take_while(|&b| b == b'=').count();
    if eq_l >= 3 && eq_r >= 3 && header.len() > eq_l + eq_r {
        let inner = header[eq_l..header.len() - eq_r].trim_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}');
        if !inner.is_empty() && !inner.bytes().all(|b| b == b'=') {
            let target = strip_heredoc_modifiers(inner);
            if !target.is_empty() { return Some(target); }
        }
    }
    None
}

fn is_relative_selector(target: &str) -> bool { target.starts_with(':') || target.starts_with('#') }
fn is_clean_relative(target: &str) -> bool {
    is_relative_selector(target) && !has_non_drive_colon_slash_str(target) && !target.contains("..")
}
pub fn is_text_or_md_ext(ext: &str) -> bool { matches!(ext, "md" | "markdown" | "txt") }

pub fn is_md_or_txt_section_target(target: &str) -> bool {
    let is_q = (target.starts_with('"') && target.ends_with('"') && target.len() >= 2)
        || (target.starts_with('\'') && target.ends_with('\'') && target.len() >= 2);
    let unq = target.trim_matches('"').trim_matches('\'').trim();
    if unq.is_empty() || (!is_q && target.contains(char::is_whitespace)) { return false; }
    if target.starts_with(':') || target.starts_with('#') {
        return !target.contains(char::is_whitespace) && target.len() > 1;
    }
    let (fp, sel) = split_target_selector(unq);
    if fp.is_empty() { return false; }
    let has_alpha_ext = Path::new(fp).extension().and_then(|e| e.to_str())
        .is_some_and(|e| e.bytes().any(|b| b.is_ascii_alphabetic()));
    fp.contains('/') || fp.contains('\\') || has_alpha_ext || sel.is_some()
}

fn split_lines_preservable(payload: &str) -> Vec<&str> {
    if !payload.contains('\n') && payload.contains('\r') { payload.split('\r').collect() }
    else { payload.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)).collect() }
}

pub fn parse_md_fence_open(trimmed: &str) -> Option<(u8, usize)> {
    let ch = *trimmed.as_bytes().first()?;
    if ch != b'`' && ch != b'~' { return None; }
    let count = trimmed.bytes().take_while(|&b| b == ch).count();
    (count >= 3 && !(ch == b'`' && trimmed[count..].contains('`'))).then_some((ch, count))
}

pub fn is_md_fence_close(trimmed: &str, ch: u8, min_len: usize) -> bool {
    let count = trimmed.bytes().take_while(|&b| b == ch).count();
    count >= min_len && trimmed[count..].trim().is_empty()
}

pub fn scan_triple_quote_line(line: &str, state: &mut Option<&'static str>, allow_single: bool) {
    let (b, mut i, mut in_sq) = (line.as_bytes(), 0, None);
    while i < b.len() {
        if let Some(delim) = *state {
            if b[i..].starts_with(delim.as_bytes()) { *state = None; i += 3; }
            else { i += if b[i] == b'\\' && i + 1 < b.len() { 2 } else { 1 }; }
        } else if let Some(q) = in_sq {
            if b[i] == b'\\' && i + 1 < b.len() { i += 2; continue; }
            if b[i] == q { in_sq = None; }
            i += 1;
        } else if b[i] == b'#' || (b[i] == b'/' && b.get(i + 1) == Some(&b'/')) { break; }
        else if b[i..].starts_with(b"\"\"\"") { *state = Some("\"\"\""); i += 3; }
        else if allow_single && b[i..].starts_with(b"'''") { *state = Some("'''"); i += 3; }
        else { if b[i] == b'"' || b[i] == b'\'' { in_sq = Some(b[i]); } i += 1; }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RustStrKind { Normal, Raw(usize) }
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CodeLexState { pub block_depth: usize, pub rs: Option<RustStrKind>, pub tpl: Vec<usize>, pub go_raw: bool, pub tq: bool }
impl CodeLexState {
    pub fn is_active(&self) -> bool { self.block_depth > 0 || self.rs.is_some() || !self.tpl.is_empty() || self.go_raw || self.tq }
}

fn supports_block_comment(ext: &str) -> bool {
    matches!(ext, "rs" | "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "c" | "h" | "cpp" | "cc" | "cxx"
        | "hpp" | "hh" | "go" | "java" | "cs" | "kt" | "kts" | "gradle" | "dart" | "php" | "css" | "scss" | "less"
        | "sql" | "psql" | "pgsql" | "mysql" | "sqlite" | "tsql" | "prisma" | "cypher")
}

pub fn scan_code_lex_line(line: &str, ext: &str, st: &mut CodeLexState) -> bool {
    let started = st.is_active();
    let (has_bc, has_tpl, has_tq, is_raw_tq, is_rs, is_go, is_sql) = (
        supports_block_comment(ext), matches!(ext, "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs"),
        matches!(ext, "java" | "cs" | "kt" | "kts" | "gradle"), matches!(ext, "cs" | "kt" | "kts"),
        ext == "rs", ext == "go", matches!(ext, "sql" | "psql" | "pgsql" | "mysql" | "sqlite" | "tsql"),
    );
    if !started && !has_bc && !has_tpl && !has_tq && !is_rs && !is_go { return false; }
    let (b, mut i) = (line.as_bytes(), 0);
    while i < b.len() {
        if st.block_depth > 0 {
            if is_rs && b[i..].starts_with(b"/*") { st.block_depth += 1; i += 2; }
            else if b[i..].starts_with(b"*/") { st.block_depth -= 1; i += 2; } else { i += 1; }
            continue;
        }
        if st.tq {
            if b[i..].starts_with(b"\"\"\"") { st.tq = false; i += 3; }
            else { i += if !is_raw_tq && b[i] == b'\\' && i + 1 < b.len() { 2 } else { 1 }; }
            continue;
        }
        if st.go_raw { if b[i] == b'`' { st.go_raw = false; } i += 1; continue; }
        if let Some(rk) = st.rs {
            match rk {
                RustStrKind::Raw(h) if b[i] == b'"' && i + 1 + h <= b.len() && b[i + 1..i + 1 + h].iter().all(|&c| c == b'#') => { st.rs = None; i += 1 + h; }
                RustStrKind::Normal if b[i] == b'\\' && i + 1 < b.len() => i += 2,
                RustStrKind::Normal if b[i] == b'"' => { st.rs = None; i += 1; }
                _ => i += 1,
            }
            continue;
        }
        if st.tpl.last() == Some(&0) {
            if b[i] == b'\\' && i + 1 < b.len() { i += 2; }
            else if b[i] == b'`' { st.tpl.pop(); i += 1; }
            else if b[i..].starts_with(b"${") { *st.tpl.last_mut().unwrap() = 1; i += 2; } else { i += 1; }
            continue;
        }
        if (!is_sql && b[i..].starts_with(b"//")) || (is_sql && b[i..].starts_with(b"--")) || (ext == "php" && b[i] == b'#') { break; }
        if has_bc && b[i..].starts_with(b"/*") { st.block_depth = 1; i += 2; continue; }
        if is_rs {
            if b[i] == b'\'' {
                if b.get(i + 1) == Some(&b'\\') && let Some(r) = line.get(i + 3..).and_then(|s| s.find('\'')) && r < 10 { i += 4 + r; }
                else if i + 2 < b.len() && b[i + 2] == b'\'' { i += 3; } else { i += 1; }
                continue;
            }
            let prev_ok = i == 0 || !(b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'_');
            let pfx = if prev_ok && b[i] == b'r' { 1 } else if prev_ok && matches!(b[i], b'b' | b'c') && b.get(i + 1) == Some(&b'r') { 2 } else { 0 };
            if pfx > 0 {
                let h = b[i + pfx..].iter().take_while(|&&c| c == b'#').count();
                if b.get(i + pfx + h) == Some(&b'"') { st.rs = Some(RustStrKind::Raw(h)); i += pfx + h + 1; continue; }
            }
            if b[i] == b'"' { st.rs = Some(RustStrKind::Normal); i += 1; continue; }
        } else {
            if has_tq && b[i..].starts_with(b"\"\"\"") { st.tq = true; i += 3; continue; }
            if b[i] == b'"' || b[i] == b'\'' {
                let q = b[i]; i += 1;
                while i < b.len() { if b[i] == b'\\' && i + 1 < b.len() { i += 2; continue; } i += 1; if b[i - 1] == q { break; } }
                continue;
            }
            if is_go && b[i] == b'`' { st.go_raw = true; i += 1; continue; }
            if has_tpl && b[i] == b'`' { st.tpl.push(0); i += 1; continue; }
            if let Some(d) = st.tpl.last_mut() && *d > 0 { if b[i] == b'{' { *d += 1; } else if b[i] == b'}' { *d -= 1; } }
        }
        i += 1;
    }
    started || st.is_active()
}

pub fn starts_with_heredoc_header(payload: &str) -> bool { starts_with_heredoc_header_for(payload, None) }

pub fn starts_with_heredoc_header_for(payload: &str, default_path: Option<&Path>) -> bool {
    let ext = default_path.map(path_ext).unwrap_or_default();
    split_lines_preservable(payload.trim_start_matches('\u{FEFF}')).into_iter()
        .map(|l| l.trim_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}'))
        .find(|t| !t.is_empty())
        .is_some_and(|t| parse_heredoc_header_line(t).is_some_and(|tgt| !is_text_or_md_ext(&ext) || is_md_or_txt_section_target(tgt)))
}

fn path_ext(p: &Path) -> String {
    let raw = p.to_str().map(|s| Path::new(split_target_selector(s).0)).unwrap_or(p);
    raw.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default()
}

fn for_each_heredoc_target(payload: &str, default_path: Option<&Path>, mut f: impl FnMut(&str)) {
    let lines = split_lines_preservable(payload.trim_start_matches('\u{FEFF}'));
    let has_unindented = lines.iter().any(|l| {
        let nb = l.trim_start_matches('\u{FEFF}');
        nb.starts_with('=') && parse_heredoc_header_line(nb.trim()).is_some()
    });
    let mut ext = default_path.map(path_ext).unwrap_or_default();
    let (mut in_preamble, mut sec_first, mut in_fence, mut in_hunk, mut in_tq, mut code_st) =
        (default_path.is_none(), default_path.is_some(), None, false, None, CodeLexState::default());
    for line in lines {
        let trimmed = line.trim_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}');
        if let Some((fch, flen)) = in_fence { if is_md_fence_close(trimmed, fch, flen) { in_fence = None; } continue; }
        if in_tq.is_none() && !code_st.is_active() {
            if in_hunk { if trimmed.len() >= 3 && trimmed.bytes().all(|b| b == b'>') { in_hunk = false; } continue; }
            if trimmed.len() >= 3 && trimmed.bytes().all(|b| b == b'<') { in_hunk = true; continue; }
        }
        if sec_first && !trimmed.is_empty() {
            sec_first = false;
            if ext.is_empty() && trimmed.starts_with("#!") && trimmed.to_ascii_lowercase().contains("python") { ext = "py".into(); }
        }
        if in_tq.is_some() || matches!(ext.as_str(), "py" | "pyi" | "pyw") {
            let started = in_tq.is_some();
            scan_triple_quote_line(line, &mut in_tq, true);
            if started || in_tq.is_some() { continue; }
        }
        if scan_code_lex_line(line, &ext, &mut code_st) { continue; }
        if trimmed.bytes().all(|b| b == b'=') { continue; }
        if matches!(ext.as_str(), "md" | "markdown") && let Some(fence) = parse_md_fence_open(trimmed) { in_fence = Some(fence); continue; }
        if has_unindented && !line.trim_start_matches('\u{FEFF}').starts_with('=') { continue; }
        if let Some(target) = parse_heredoc_header_line(trimmed) {
            if is_text_or_md_ext(&ext) && !in_preamble && !is_md_or_txt_section_target(target) { continue; }
            in_preamble = false; sec_first = true; in_fence = None; in_hunk = false; in_tq = None; code_st = CodeLexState::default();
            if !is_relative_selector(target) { ext = path_ext(Path::new(target)); }
            f(target);
        }
    }
}

pub(crate) fn extract_heredoc_targets(payload: &str, default_path: Option<&Path>, out: &mut Vec<PathBuf>) { for_each_heredoc_target(payload, default_path, |t| if !is_clean_relative(t) { push_unique_path(out, PathBuf::from(split_target_selector(t).0)); }); }
pub(crate) fn extract_raw_heredoc_targets(payload: &str, default_path: Option<&Path>, out: &mut Vec<String>) { for_each_heredoc_target(payload, default_path, |t| if !is_clean_relative(t) { let s = t.to_string(); if !out.contains(&s) { out.push(s); } }); }
pub(crate) fn extract_json_targets(payload: &str, out: &mut Vec<PathBuf>) { if let Some(val) = parse_json_payload(payload) { collect_json_target_strings(&val, &mut |t| push_unique_path(out, PathBuf::from(split_target_selector(t).0))); } }
pub(crate) fn extract_raw_json_targets(payload: &str, out: &mut Vec<String>) { if let Some(val) = parse_json_payload(payload) { collect_json_target_strings(&val, &mut |t| { let s = t.to_string(); if !out.contains(&s) { out.push(s); } }); } }
pub fn has_non_drive_colon_slash_str(raw: &str) -> bool {
    let b = raw.as_bytes();
    b.windows(2).enumerate().any(|(idx, w)| w[0] == b':' && (w[1] == b'/' || w[1] == b'\\') && !(idx == 1 && b[0].is_ascii_alphabetic()))
}
pub fn has_non_drive_colon_slash(target: &Path) -> bool { target.to_str().is_some_and(has_non_drive_colon_slash_str) }

pub(crate) fn has_traversal_after_selector_delim(raw: &str) -> bool {
    let b = raw.as_bytes();
    let off = if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':'
        && (b.len() == 2 || b[2] == b'\\' || (b[2] == b'/' && b[0].is_ascii_uppercase())) { 2 } else { 0 };
    raw[off..].find([':', '#']).is_some_and(|pos| off + pos > 0 && raw[off + pos + 1..].contains(".."))
}

fn parse_json_payload(payload: &str) -> Option<JsonValue> {
    let t = payload.trim_start_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}');
    (t.starts_with('[') || t.starts_with('{')).then(|| parse_json(t).ok()).flatten()
}
fn collect_json_target_strings(val: &JsonValue, f: &mut impl FnMut(&str)) {
    match val {
        JsonValue::Array(items) => items.iter().for_each(|i| collect_json_target_strings(i, f)),
        JsonValue::Object(map) => {
            for key in ["path", "file", "filePath", "file_path", "target"] {
                if let Some(JsonValue::String(s)) = map.get(key) { f(s); }
            }
            map.values().filter(|v| matches!(v, JsonValue::Array(_) | JsonValue::Object(_))).for_each(|v| collect_json_target_strings(v, f));
        }
        _ => {}
    }
}
pub(crate) fn has_binary_write_payload(payloads: &[&str], json_payloads: &[&str]) -> bool {
    payloads.iter().any(|p| !matches!(probe_bytes(p.as_bytes()), BinaryProbeResult::Text))
        || json_payloads.iter().any(|p| parse_json_payload(p).is_some_and(|v| value_has_binary_string(&v)))
}
fn value_has_binary_string(val: &JsonValue) -> bool {
    match val {
        JsonValue::String(s) => s.contains('\0') || !matches!(probe_bytes(s.as_bytes()), BinaryProbeResult::Text),
        JsonValue::Array(items) => items.iter().any(value_has_binary_string),
        JsonValue::Object(map) => map.iter().any(|(k, v)| k.contains('\0') || !matches!(probe_bytes(k.as_bytes()), BinaryProbeResult::Text) || value_has_binary_string(v)),
        _ => false,
    }
}
