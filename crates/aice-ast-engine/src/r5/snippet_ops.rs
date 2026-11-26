use std::path::Path;

use aice_lang_registry::LanguageId;

use crate::r5::snippet_closed::closed_trailing_op_ok;
use crate::r5::snippet_container::PrefixContainer;
use crate::r5::snippet_cst::{CstDefectProfile, strip_trailing_comment};
use crate::r5::snippet_lex::{is_code_lang, lexical_comment_start};
use crate::r5::snippet_lit::{ends_with_js_regex, ends_with_jsx_tag};
use crate::r5::snippet_probe::has_inner_delim_error;
use crate::ts_pool::ParserPool;

const SYMBOLIC_OPS: &[&str] = &[
    "+", "-", "*", "/", "%", "&", "|", "^", "=", "<", ">", "==", "!=", "<=", ">=", "+=", "-=",
    "*=", "/=", "%=", "&=", "|=", "^=", "&&", "||", "<<", ">>", ">>>", "**", "//", "=>", "->",
    ":=", "<>", "..", "..=", "...", "..<", "??", "?:", "?..", "=~", "!~", "~/", "~/=", "@", "@=",
    "&^", "&^=", ".=", "===", "!==", "<<=", ">>=", ">>>=", "**=", "//=", "&&=", "||=", "??=",
    "<=>",
];

fn keyword_op_allowed(lang: LanguageId, kw: &str) -> bool {
    use LanguageId::*;
    match kw {
        "and" | "or" => matches!(lang, Python | Ruby | Php),
        "xor" => lang == Php,
        "in" => matches!(lang, Python | Kotlin | Dart | JavaScript | TypeScript | Tsx),
        "is" => matches!(lang, Python | Kotlin | Dart | CSharp),
        "as" => matches!(lang, Kotlin | Dart | CSharp),
        _ => false,
    }
}

fn has_kw_boundary(before: &str) -> bool {
    if before.ends_with("->") || before.ends_with("::") {
        return false;
    }
    before
        .chars()
        .next_back()
        .is_none_or(|c| !c.is_alphanumeric() && !matches!(c, '_' | '$' | '@' | '.'))
}

fn strip_kw_suffix<'a>(lang: LanguageId, s: &'a str, kw: &str) -> Option<&'a str> {
    if s.len() < kw.len() {
        return None;
    }
    let split = s.len() - kw.len();
    if !s.is_char_boundary(split) {
        return None;
    }
    let tail = &s[split..];
    let matched = if lang == LanguageId::Php && matches!(kw, "and" | "or" | "xor") {
        tail.eq_ignore_ascii_case(kw)
    } else {
        tail == kw
    };
    matched.then_some(&s[..split])
}

fn is_php_float_lit(before: &str) -> bool {
    let b = before.as_bytes();
    let mut k = b.len();
    while k > 0 && b[k - 1].is_ascii_digit() {
        k -= 1;
    }
    if k == b.len() {
        return false;
    }
    k == 0 || !(b[k - 1].is_ascii_alphanumeric() || matches!(b[k - 1], b'_' | b'$' | b'.'))
}

fn strip_trailing_lexical_comments(lang: LanguageId, mut s: &str) -> &str {
    loop {
        s = s.trim_end();
        let Some(pos) = lexical_comment_start(lang, s) else {
            return s;
        };
        if pos >= s.len() {
            return s;
        }
        s = &s[..pos];
    }
}

fn is_sym_op_byte(ch: u8, allow_bang: bool) -> bool {
    matches!(
        ch,
        b'+' | b'-' | b'*' | b'/' | b'%' | b'&' | b'|' | b'^' | b'=' | b'<' | b'>' | b'?'
            | b'.' | b':' | b'~' | b'@'
    ) || (allow_bang && ch == b'!')
}

pub(crate) fn trailing_binary_op(lang: LanguageId, s: &str) -> Option<(&'static str, &str)> {
    let s = s.trim_end();
    if lang == LanguageId::Python
        && let Some(before_not) = s.strip_suffix("not")
        && has_kw_boundary(before_not)
        && let Some(("is", before_is)) = trailing_binary_op(lang, before_not)
    {
        return Some(("is not", before_is));
    }
    if lang == LanguageId::Kotlin {
        for op in ["!in", "!is", "as?"] {
            if let Some(before) = s.strip_suffix(op) && has_kw_boundary(before) {
                return Some((op, before));
            }
        }
    }
    for &kw in &["and", "or", "xor", "in", "is", "as"] {
        if keyword_op_allowed(lang, kw)
            && let Some(before) = strip_kw_suffix(lang, s, kw)
            && has_kw_boundary(before)
        {
            if lang == LanguageId::Python
                && kw == "in"
                && let Some(before_not) = strip_kw_suffix(lang, before.trim_end(), "not")
                && has_kw_boundary(before_not)
            {
                return Some(("not in", before_not));
            }
            return Some((kw, before));
        }
    }
    let last = *s.as_bytes().last()?;
    if !is_sym_op_byte(last, false) {
        return None;
    }
    let b = s.as_bytes();
    let mut start = b.len();
    while start > 0 && is_sym_op_byte(b[start - 1], true) {
        start -= 1;
    }
    let op = &s[start..];
    let before = &s[..start];
    if op == "/" && ends_with_js_regex(lang, s) {
        return None;
    }
    if op == ">" && ends_with_jsx_tag(lang, s) {
        return None;
    }
    if op == "." && lang == LanguageId::Php && !is_php_float_lit(before) {
        return Some((".", before));
    }
    SYMBOLIC_OPS
        .iter()
        .copied()
        .find(|&cand| cand == op && !(cand == "..." && lang == LanguageId::Python))
        .map(|cand| (cand, before))
}

pub(crate) fn has_valid_trailing_binary_op(lang: LanguageId, trimmed: &str) -> bool {
    let Some((op, before)) = trailing_binary_op(lang, trimmed) else {
        return false;
    };
    let before_code = strip_trailing_lexical_comments(lang, before);
    if trailing_binary_op(lang, before_code).is_some() {
        return false;
    }
    if is_trailing_continuation_token(lang, before_code) {
        if before_code.ends_with('.') {
            return before_code.as_bytes()[..before_code.len() - 1]
                .last()
                .is_some_and(|b| b.is_ascii_digit());
        }
        return matches!(op, "+" | "-")
            || (before_code.ends_with(':')
                && op == "*"
                && matches!(lang, LanguageId::C | LanguageId::Cpp | LanguageId::Rust | LanguageId::Go));
    }
    if before_code.ends_with(['(', '[', '{', ',']) {
        return matches!(op, "+" | "-")
            || (op == "*" && matches!(lang, LanguageId::C | LanguageId::Cpp | LanguageId::Rust | LanguageId::Go))
            || (op == "..." && matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx | LanguageId::Php | LanguageId::Ruby));
    }
    true
}

pub(crate) fn push_go_bracket_probes(
    code: &str,
    trimmed: &str,
    closers: &str,
    has_trailing_op: bool,
    out: &mut Vec<String>,
) {
    let outer = &closers[1..];
    out.push(format!("{code}{closers}int"));
    out.push(format!("{code}{closers}int{{}}"));
    out.push(format!("{code}]int{{}}{outer}"));
    out.push(format!("{code}]any{{}}{outer}"));
    if trimmed.ends_with(['(', '[']) {
        out.push(format!("{code}_aice_{closers}int"));
        out.push(format!("{code}_aice_]int{{}}{outer}"));
    } else if (trimmed.ends_with(',')
        && !trimmed[..trimmed.len() - 1]
            .trim_end()
            .ends_with([',', '(', '[', '{']))
        || has_trailing_op
    {
        out.push(format!("{code} _aice_{closers}int"));
        out.push(format!("{code} _aice_{closers}int{{}}"));
        out.push(format!("{code} _aice_]int{{}}{outer}"));
        out.push(format!("{code} _aice_]any{{}}{outer}"));
    }
}

pub(crate) fn is_trailing_continuation_token(lang: LanguageId, trimmed: &str) -> bool {
    if trailing_binary_op(lang, trimmed).is_some() {
        return false;
    }
    trimmed.ends_with(['.', ':'])
        || (lang == LanguageId::Python
            && strip_kw_suffix(lang, trimmed, "not").is_some_and(has_kw_boundary))
}

pub(crate) fn is_colon_stmt_or_label_header(lang: LanguageId, code: &str, prefix_ctx: PrefixContainer) -> bool {
    use LanguageId::*;
    let t = code.trim();
    if !t.ends_with(':') || t.ends_with("::") {
        return false;
    }
    if lang == Bash {
        return true;
    }
    let kw = t.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').next().unwrap_or("");
    if lang == Python {
        return !matches!(prefix_ctx, PrefixContainer::ValueBrace | PrefixContainer::ValueBracket)
            || matches!(kw, "def" | "async" | "class" | "if" | "elif" | "else" | "for" | "while" | "with" | "try" | "except" | "finally" | "match" | "case");
    }
    if !matches!(lang, JavaScript | TypeScript | Tsx | C | Cpp | CSharp | Java | Go | Dart | Php) {
        return false;
    }
    if matches!(kw, "case" | "default")
        || (prefix_ctx == PrefixContainer::MatchOrSwitch && !t.contains(['=', '?']))
        || (lang == Php && matches!(kw, "if" | "elseif" | "else" | "for" | "foreach" | "while" | "switch" | "declare"))
    {
        return true;
    }
    let body = t[..t.len() - 1].trim_end();
    let is_id = !body.is_empty() && body.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'$'));
    (is_id && matches!(prefix_ctx, PrefixContainer::TopLevel | PrefixContainer::StmtBlock))
        || (matches!(lang, C | Cpp)
            && prefix_ctx == PrefixContainer::ClassOrTraitBody
            && matches!(body, "public" | "private" | "protected" | "signals" | "slots" | "public slots" | "private slots" | "protected slots"))
}

pub(crate) fn line_pair_trailing_op_adds_error(
    lang: LanguageId,
    path: &Path,
    pool: &mut ParserPool,
    b_line: &str,
    c_line: &str,
    b_prof: &CstDefectProfile,
    c_prof: &CstDefectProfile,
) -> bool {
    if !is_code_lang(lang) || b_prof.unclosed_quotes > 0 || c_prof.unclosed_quotes > 0 {
        return false;
    }
    let c_code = strip_trailing_comment(lang, c_line, pool);
    if c_prof.unclosed_delims == 0 && trailing_binary_op(lang, c_code).is_some() {
        let b_code = strip_trailing_comment(lang, b_line, pool);
        if !has_valid_trailing_binary_op(lang, c_code) {
            let b_bad = b_prof.unclosed_delims == 0
                && trailing_binary_op(lang, b_code).is_some()
                && !has_valid_trailing_binary_op(lang, b_code);
            if !b_bad {
                return true;
            }
        }
        if b_prof.unclosed_delims > 0 && !has_inner_delim_error(lang, b_line, path, pool) {
            return true;
        }
        if !closed_trailing_op_ok(lang, c_code, path, pool)
            && !(b_prof.unclosed_delims == 0
                && trailing_binary_op(lang, b_code).is_some()
                && !closed_trailing_op_ok(lang, b_code, path, pool))
        {
            return true;
        }
    }
    false
}
