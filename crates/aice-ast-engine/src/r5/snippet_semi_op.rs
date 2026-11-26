use std::path::Path;

use aice_lang_registry::LanguageId;

use crate::r5::checks::ErrorSpan;
use crate::r5::snippet_cst::line_delim_detail;
use crate::r5::snippet_ctx_scan::prefix_unclosed_openers;
use crate::r5::snippet_lex::lexical_comment_start;
use crate::r5::snippet_rs_attr::is_rust_attr_opener;
use crate::r5::snippet_synth::strip_comments_strings;
use crate::ts_pool::ParserPool;

pub(crate) fn strip_code_trailing_comment(lang: LanguageId, line: &str) -> &str {
    let mut cut = line.len();
    while let Some(pos) = lexical_comment_start(lang, &line[..cut]) {
        if pos >= cut {
            break;
        }
        cut = pos;
        while cut > 0 && !line.is_char_boundary(cut) {
            cut -= 1;
        }
    }
    line[..cut].trim_end()
}

pub(crate) fn rust_brace_has_depth0_semi(ab: &str) -> bool {
    let clean = crate::r5::snippet_rs_angle::strip_rust_comments_strings(ab);
    let (mut pd, mut bd, mut cd) = (0usize, 0usize, 0usize);
    for &c in clean.as_bytes() {
        match c {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1, b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b';' if pd == 0 && bd == 0 && cd == 0 => return true,
            _ => {}
        }
    }
    false
}
pub(crate) fn is_ts_kw_shorthand_method(line: &str) -> bool {
    let mut t = line.trim_start();
    while let Some(m) = ["public", "private", "protected", "static", "readonly", "override", "async", "get", "set"]
        .into_iter().find(|&k| t.strip_prefix(k).is_some_and(|r| r.starts_with(char::is_whitespace)))
    { t = t[m.len()..].trim_start(); }
    t = t.trim_start_matches(['*', ' ', '\t']);
    let kw = t.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').next().unwrap_or("");
    matches!(kw, "return" | "await" | "yield" | "throw") && t[kw.len()..].trim_start().starts_with(['(', '<'])
}
fn rust_semi_inner_scan(inner: &str) -> (bool, bool) {
    let b = inner.trim().as_bytes();
    let (mut pd, mut bd, mut cd, mut ad, mut i, mut saw_semi, mut bad_brack) = (0usize, 0usize, 0usize, 0usize, 0usize, false, false);
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1, b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'<' if pd == 0 && bd == 0 && cd == 0 => { if matches!(b.get(i + 1), Some(b'=' | b'<')) { i += 2; continue; } ad += 1; }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => { if ad == 0 { bad_brack = true; } else { ad -= 1; } }
            b',' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => bad_brack = true,
            b';' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => saw_semi = true,
            _ => {}
        }
        i += 1;
    }
    let bal = !bad_brack && pd == 0 && bd == 0 && cd == 0 && ad == 0;
    let broken = bal && (saw_semi || matches!(b.last().copied(), Some(b'+' | b'-' | b'*' | b'/' | b'%' | b'&' | b'|' | b'^' | b'=' | b'!' | b'.' | b',' | b':' | b';' | b'<')));
    (bal, broken)
}

fn rust_semi_brack_is_broken(inner: &str) -> bool {
    inner.trim().is_empty() || rust_semi_inner_scan(inner).1
}

pub(crate) fn is_semi_terminated_broken_opener(
    lang: LanguageId, joined: &str, op_delim: u8, op_byte: usize, op_line_text: &str,
) -> bool {
    if !matches!(op_delim, b'(' | b'[' | b'{') || !strip_code_trailing_comment(lang, op_line_text).ends_with(';') { return false; }
    let after_line = joined.get(op_byte + 1..).unwrap_or("").split('\n').next().unwrap_or("");
    let after_clean = strip_comments_strings(lang, after_line, false);
    let after_tr = after_clean.trim();
    if !after_tr.ends_with(';') { return false; }
    let before_semi = after_tr[..after_tr.len() - 1].trim();
    if op_delim == b'{' && !before_semi.is_empty() { return false; }
    let (mut bd, mut cd) = (0usize, 0usize);
    for &c in before_semi.as_bytes() {
        match c { b'[' => bd += 1, b']' => bd = bd.saturating_sub(1), b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1), _ => {} }
    }
    if cd > 0 { return false; }
    if lang == LanguageId::Rust && (op_delim == b'[' || bd > 0) {
        if is_rust_attr_opener(lang, joined, op_byte) { return false; }
        if op_delim == b'[' && !before_semi.is_empty() && !rust_semi_brack_is_broken(before_semi) { return false; }
        if op_delim == b'(' && bd > 0 && let Some(br) = before_semi.rfind('[') && !rust_semi_brack_is_broken(&before_semi[br + 1..]) { return false; }
    }
    let pre = joined.get(..op_byte).unwrap_or("").rsplit('\n').next().unwrap_or("");
    let pre_clean = strip_comments_strings(lang, pre, false);
    let pre_tr = pre_clean.trim_end();
    if pre_tr.ends_with(':') && !pre_tr.ends_with("::") { return false; }
    if op_delim == b'(' {
        let word = pre_tr.rsplit(|c: char| !c.is_ascii_alphanumeric() && c != '_').next().unwrap_or("");
        if matches!(word, "for" | "foreach") || (matches!(lang, LanguageId::C | LanguageId::Cpp) && matches!(word, "if" | "switch")) { return false; }
    }
    true
}

pub(crate) fn is_line_in_rust_unclosed_attr(lang: LanguageId, joined: &str, openers: &[(u8, usize, usize)], ln: usize) -> bool {
    if lang != LanguageId::Rust { return false; }
    let Some((pos, &(_, attr_ln, attr_byte))) = openers.iter().enumerate().rev()
        .find(|&(_, &(d, _, byte))| d == b'[' && is_rust_attr_opener(lang, joined, byte)) else { return false; };
    if ln < attr_ln || openers[pos + 1..].iter().any(|&(d, _, _)| d == b'{') { return false; }
    let slice: String = joined.lines().take(ln + 1).collect::<Vec<_>>().join("\n");
    let clean = crate::r5::snippet_rs_angle::strip_rust_comments_strings(slice.get(attr_byte..).unwrap_or(""));
    !clean.contains(';') && !clean.lines().skip(1).any(|l| matches!(
        l.trim_start().split(|c: char| !c.is_ascii_alphanumeric() && c != '_').next(),
        Some("let" | "fn" | "struct" | "enum" | "impl" | "trait" | "mod" | "const" | "static" | "type" | "pub")
    ))
}

fn is_rust_midfile_semi_brack(joined: &str, op_delim: u8, op_byte: usize, op_line_text: &str) -> bool {
    if op_delim != b'[' || is_rust_attr_opener(LanguageId::Rust, joined, op_byte) || !strip_code_trailing_comment(LanguageId::Rust, op_line_text).ends_with(';') {
        return false;
    }
    let after_line = joined.get(op_byte + 1..).unwrap_or("").split('\n').next().unwrap_or("");
    let after_clean = strip_comments_strings(LanguageId::Rust, after_line, false);
    let after_tr = after_clean.trim();
    after_tr.ends_with(';') && rust_semi_inner_scan(&after_tr[..after_tr.len() - 1]).0
}

pub(crate) fn suffix_has_unmatched_rbrack(lang: LanguageId, suffix_lines: &[&str], path: &Path, pool: &mut ParserPool) -> bool {
    !suffix_lines.is_empty() && line_delim_detail(lang, &suffix_lines.join("\n"), path, pool).1.contains(&b']')
}

pub(crate) fn find_semi_broken_opener_line(
    lang: LanguageId, pfx: &[&str], suf: &[&str], base_spans: &[ErrorSpan], path: &Path, pool: &mut ParserPool,
) -> Option<usize> {
    if pfx.is_empty() || suf.is_empty() { return None; }
    let joined = pfx.join("\n");
    let openers = prefix_unclosed_openers(lang, pfx, path, pool);
    let suf_rbrack = lang == LanguageId::Rust && suffix_has_unmatched_rbrack(lang, suf, path, pool);
    openers.into_iter().find_map(|(d, ln, byte)| {
        let broken = is_semi_terminated_broken_opener(lang, &joined, d, byte, pfx[ln])
            || (lang == LanguageId::Rust && !suf_rbrack && is_rust_midfile_semi_brack(&joined, d, byte, pfx[ln]));
        (broken && base_spans.iter().any(|b| b.end_line > ln)).then_some(ln + 1)
    })
}

pub(crate) fn mask_rust_midfile_semi_brack_prefix(
    pfx: &[&str], joined: &str, openers: &[(u8, usize, usize)], suf: &[&str], path: &Path, pool: &mut ParserPool,
) -> Option<Vec<String>> {
    if suf.is_empty() || suffix_has_unmatched_rbrack(LanguageId::Rust, suf, path, pool) { return None; }
    let mut masked = false;
    let mut out: Vec<String> = pfx.iter().map(|s| (*s).to_string()).collect();
    for &(d, ln, byte) in openers {
        if d == b'[' && !openers.iter().any(|&(_, ol, ob)| ol == ln && ob > byte) && is_rust_midfile_semi_brack(joined, d, byte, pfx[ln]) {
            if out[ln] != pfx[ln] { continue; }
            masked = true;
            if openers.iter().any(|&(_, ol, ob)| ol == ln && ob < byte) {
                let col = byte - joined[..byte].rfind('\n').map_or(0, |p| p + 1);
                let semi_end = strip_code_trailing_comment(LanguageId::Rust, pfx[ln]).len();
                let rep = if openers.iter().any(|&(od, ol, ob)| ol == ln && ob < byte && od != b'{') { "(0)" } else { "(0);" };
                if col < semi_end { out[ln] = format!("{}{rep}{}", &pfx[ln][..col], &pfx[ln][semi_end..]); }
            } else { out[ln] = "  // _aice_semi_brack".to_string(); }
        }
    }
    masked.then_some(out)
}

pub(crate) fn py_rb_ctrl_paren_ln(lang: LanguageId, pfx: &[&str], joined: &str, openers: &[(u8, usize, usize)]) -> Option<usize> {
    matches!(lang, LanguageId::Python | LanguageId::Ruby).then(|| openers.iter().rev().find_map(|&(d, ln, byte)| {
        (d == b'('
            && matches!(joined[..byte].trim_end().rsplit(|c: char| !c.is_ascii_alphanumeric() && c != '_').next(),
                Some("if" | "elif" | "elsif" | "while" | "unless" | "until"))
            && !pfx[ln + 1..].iter().any(|l| matches!(l.trim_start().split(|c: char| !c.is_ascii_alphanumeric() && c != '_').next(),
                Some("def" | "class" | "module"))))
            .then_some(ln)
    })).flatten()
}

pub(crate) fn is_py_lambda_colon(line: &str) -> bool {
    let Some(body) = strip_code_trailing_comment(LanguageId::Python, line).strip_suffix(':') else { return false; };
    let clean = strip_comments_strings(LanguageId::Python, body, false);
    let (b, mut pd, mut bd, mut cd) = (clean.as_bytes(), 0usize, 0usize, 0usize);
    let is_id = |c: u8| c.is_ascii_alphanumeric() || c == b'_' || c >= 0x80;
    let mut i = b.len();
    while i > 0 {
        i -= 1;
        match b[i] {
            b')' => pd += 1,
            b']' => bd += 1,
            b'}' => cd += 1,
            b'(' => if pd | bd | cd == 0 { return false; } else { pd -= 1; },
            b'[' => if pd | bd | cd == 0 { return false; } else { bd -= 1; },
            b'{' => if pd | bd | cd == 0 { return false; } else { cd -= 1; },
            b';' | b':' if pd | bd | cd == 0 => return false,
            _ if pd | bd | cd == 0 && is_id(b[i]) => {
                let end = i + 1;
                while i > 0 && is_id(b[i - 1]) { i -= 1; }
                if &b[i..end] == b"lambda" && (i == 0 || !is_id(b[i - 1])) && (end == b.len() || !is_id(b[end])) { return true; }
            }
            _ => {}
        }
    }
    false
}
