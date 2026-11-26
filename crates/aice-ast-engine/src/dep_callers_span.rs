use aice_lang_registry::{LanguageFamily, LanguageId};

use crate::dep_callers_js_lex::JsRegexCtx;
use crate::dep_callers_quote::{MAX_IMPORT_SPAN_LINES, QuoteDepthTracker, StepKind};
use crate::dep_callers_strip::ScanState;

pub(crate) fn step_non_bash_state(
    raw: &str,
    i: usize,
    cfg: &StripCfg,
    state: &mut ScanState,
    tpl_stack: &mut Vec<usize>,
    js_ctx: &mut JsRegexCtx,
    (imp, code): (&mut String, &mut String),
) -> Option<usize> {
    let b = raw.as_bytes();
    let char_len = |idx: usize| raw[idx..].chars().next().map_or(1, char::len_utf8);
    match *state {
        ScanState::BlockComment => Some(if i + 1 < b.len() && b[i] == b'*' && b[i + 1] == b'/' {
            *state = ScanState::Code;
            imp.push(' ');
            code.push(' ');
            i + 2
        } else {
            i + char_len(i)
        }),
        ScanState::Triple { double } => {
            let delim = if double { "\"\"\"" } else { "'''" };
            Some(if b[i] == b'\\' && i + 1 < b.len() {
                i + 1 + char_len(i + 1)
            } else if raw[i..].starts_with(delim) {
                *state = ScanState::Code;
                i + 3
            } else {
                i + char_len(i)
            })
        }
        ScanState::Backtick => Some(if cfg.backtick_escape && b[i] == b'\\' && i + 1 < b.len() {
            i + 1 + char_len(i + 1)
        } else if cfg.backtick_tpl && i + 1 < b.len() && b[i] == b'$' && b[i + 1] == b'{' {
            tpl_stack.push(0);
            *state = ScanState::Code;
            if cfg.is_js { js_ctx.on_regex_allowed(); }
            imp.push_str("${");
            code.push_str("${");
            i + 2
        } else if b[i] == b'`' {
            *state = ScanState::Code;
            if cfg.is_js { js_ctx.on_expr_end(); }
            imp.push('`');
            code.push('`');
            i + 1
        } else {
            i + char_len(i)
        }),
        ScanState::RustRaw { hashes } => Some(
            if b[i] == b'"' && i + 1 + hashes <= b.len() && b[i + 1..i + 1 + hashes].iter().all(|&c| c == b'#') {
                *state = ScanState::Code;
                imp.push('"');
                code.push('"');
                i + 1 + hashes
            } else {
                i + char_len(i)
            },
        ),
        _ => None,
    }
}

pub(crate) struct StripCfg {
    pub(crate) lang: LanguageId,
    pub(crate) is_js: bool,
    pub(crate) is_tsx: bool,
    pub(crate) has_hash: bool,
    pub(crate) has_slash: bool,
    pub(crate) has_dash: bool,
    pub(crate) allow_sq: bool,
    pub(crate) allow_triple: bool,
    pub(crate) allow_backtick: bool,
    pub(crate) backtick_tpl: bool,
    pub(crate) backtick_escape: bool,
}

impl StripCfg {
    pub(crate) fn for_lang(lang: LanguageId) -> Self {
        use LanguageId as L;
        let is_js = matches!(lang, L::TypeScript | L::Tsx | L::JavaScript);
        Self {
            lang,
            is_js,
            is_tsx: lang == L::Tsx,
            has_hash: matches!(lang, L::Python | L::Ruby | L::Bash | L::Php | L::Yaml | L::Toml | L::GraphQl),
            has_slash: matches!(
                lang,
                L::TypeScript | L::Tsx | L::JavaScript | L::Rust | L::Go | L::C | L::Cpp
                    | L::CSharp | L::Java | L::Kotlin | L::Dart | L::Php | L::Css | L::Prisma
            ),
            has_dash: matches!(lang.family(), LanguageFamily::Database),
            allow_sq: lang != L::Rust,
            allow_triple: matches!(lang, L::Python | L::Dart),
            allow_backtick: is_js || lang == L::Go,
            backtick_tpl: is_js,
            backtick_escape: is_js,
        }
    }
}

pub(crate) fn mask_span(
    lines: &mut [String],
    start_line: usize,
    start_col: usize,
    end_line: usize,
    end_col: usize,
) {
    if start_line > end_line || end_line >= lines.len() {
        return;
    }
    for (li, line) in lines.iter_mut().enumerate().take(end_line + 1).skip(start_line) {
        let s = if li == start_line { start_col } else { 0 };
        let e = if li == end_line { end_col } else { line.len() };
        if s < e && e <= line.len() && line.is_char_boundary(s) && line.is_char_boundary(e) {
            let spaces = " ".repeat(e - s);
            line.replace_range(s..e, &spaces);
        }
    }
}

pub(crate) fn skip_ws_forward(
    lines: &[String],
    start_line: usize,
    start_col: usize,
    max_lines: usize,
) -> Option<(usize, usize, char)> {
    let limit = lines.len().min(start_line + max_lines + 1);
    for (li, line) in lines.iter().enumerate().take(limit).skip(start_line) {
        let s = if li == start_line { start_col } else { 0 };
        if s > line.len() || !line.is_char_boundary(s) {
            continue;
        }
        for (rel, ch) in line[s..].char_indices() {
            if !ch.is_whitespace() {
                return Some((li, s + rel, ch));
            }
        }
    }
    None
}

pub(crate) fn prev_non_ws_char(
    lines: &[String],
    start_line: usize,
    before_col: usize,
) -> Option<(usize, usize, char)> {
    let min_line = start_line.saturating_sub(MAX_IMPORT_SPAN_LINES);
    for li in (min_line..=start_line).rev() {
        let end = if li == start_line {
            before_col.min(lines[li].len())
        } else {
            lines[li].len()
        };
        if !lines[li].is_char_boundary(end) {
            continue;
        }
        for (col, ch) in lines[li][..end].char_indices().rev() {
            if !ch.is_whitespace() {
                return Some((li, col, ch));
            }
        }
    }
    None
}

pub(crate) fn find_matching_open_brace(
    lines: &[String],
    close_line: usize,
    close_col: usize,
) -> Option<(usize, usize)> {
    let min_line = close_line.saturating_sub(MAX_IMPORT_SPAN_LINES);
    let mut stack: Vec<(usize, usize)> = Vec::new();
    let mut tr = QuoteDepthTracker::new();
    for (li, line) in lines.iter().enumerate().take(close_line + 1).skip(min_line) {
        let mut iter = line.char_indices().peekable();
        while let Some((col, ch)) = iter.next() {
            if li == close_line && col > close_col {
                break;
            }
            let next = iter.peek().map(|&(_, n)| n);
            match tr.step(ch, next) {
                StepKind::EnterTemplate => {
                    iter.next();
                }
                StepKind::OpenBrace => stack.push((li, col)),
                StepKind::CloseBrace => {
                    if li == close_line && col == close_col {
                        return stack.pop();
                    }
                    stack.pop();
                }
                _ => {}
            }
        }
        tr.end_line();
    }
    None
}
