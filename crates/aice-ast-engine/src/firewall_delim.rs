use aice_lang_registry::LanguageId;

use crate::firewall_span::Pinpoint;
use crate::r5::snippet_blk::find_blk_comment_close;
use crate::r5::snippet_cst::walk_cst_defects_cursor;
use crate::r5::snippet_lex::{has_hash_comments, has_slash_comments, is_code_lang, is_hash_comment_at};
use crate::r5::snippet_lit::{JsLexState, StepQuote};

pub(crate) fn scan_unbalanced_delim(
    lang: LanguageId,
    src: &str,
    tree: Option<&tree_sitter::Tree>,
) -> Option<Pinpoint> {
    let mut masked = Vec::new();
    if let Some(t) = tree {
        let (mut e, mut m) = (0, 0);
        walk_cst_defects_cursor(t, 0, src.len(), &mut e, &mut m, &mut masked, None);
    }
    if is_code_lang(lang) {
        return scan_code_delims(lang, src, &masked);
    }
    if matches!(
        lang,
        LanguageId::Json
            | LanguageId::Css
            | LanguageId::Toml
            | LanguageId::Yaml
            | LanguageId::Prisma
            | LanguageId::GraphQl
            | LanguageId::Cypher
            | LanguageId::AnsiSql
            | LanguageId::PostgreSql
            | LanguageId::MySql
            | LanguageId::Sqlite
            | LanguageId::TSql
    ) {
        return scan_structured_delims(lang, src, &masked);
    }
    None
}

fn scan_code_delims(lang: LanguageId, src: &str, masked: &[(usize, usize)]) -> Option<Pinpoint> {
    let (b, slash, hash) = (src.as_bytes(), has_slash_comments(lang), has_hash_comments(lang));
    let (mut m_idx, mut i) = (0usize, 0usize);
    let (mut stack, mut unmatched, mut js) = (Vec::<(u8, usize)>::new(), None::<(u8, usize)>, JsLexState::new());
    let (mut unclosed_q, mut unclosed_blk) = (None::<usize>, None::<usize>);
    while i < b.len() {
        if js.step_masked(lang, b, &mut m_idx, masked, &mut i) {
            continue;
        }
        if b[i] == b'\n' {
            let q_start = js.active_quote_start();
            if js.on_newline(lang)
                && let Some(qs) = q_start
            {
                unclosed_q.get_or_insert(qs);
            }
            i += 1;
            continue;
        }
        match js.step_quote(lang, b, &mut i) {
            StepQuote::Consumed => continue,
            StepQuote::EnteredInterp => {
                stack.push((b'{', i.saturating_sub(1)));
                continue;
            }
            StepQuote::NotInQuote => {}
        }
        if let Some((end, closed)) = js.match_special(lang, b, i) {
            if !closed {
                unclosed_q.get_or_insert(i);
            }
            i = end;
            continue;
        }
        if js.open_quote(lang, b, &mut i) {
            continue;
        }
        if (slash && lang != LanguageId::Css && b[i..].starts_with(b"//"))
            || (hash && is_hash_comment_at(b, i))
        {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if slash && b[i..].starts_with(b"/*") {
            let (Some(after), _) = find_blk_comment_close(lang, b, i + 2, 1) else {
                unclosed_blk.get_or_insert(i);
                break;
            };
            i = after;
            continue;
        }
        if matches!(b[i], b'(' | b'[' | b'{') {
            stack.push((b[i], i));
        } else if matches!(b[i], b')' | b']' | b'}') {
            let want = match b[i] { b')' => b'(', b']' => b'[', _ => b'{' };
            if let Some(pos) = stack.iter().rposition(|&(c, _)| c == want) {
                stack.remove(pos);
            } else if !(lang == LanguageId::Bash && b[i] == b')') {
                unmatched.get_or_insert((b[i], i));
            }
        }
        js.step_byte(lang, b, &mut i);
    }
    if let Some(qs) = js.active_quote_start() {
        unclosed_q.get_or_insert(qs);
    }
    finalize_delim_pinpoint(src, unmatched, &stack, unclosed_blk, unclosed_q)
}

fn scan_structured_delims(lang: LanguageId, src: &str, masked: &[(usize, usize)]) -> Option<Pinpoint> {
    let b = src.as_bytes();
    let use_parens = !matches!(lang, LanguageId::Yaml | LanguageId::Toml | LanguageId::Json);
    let has_hash = matches!(lang, LanguageId::Yaml | LanguageId::Toml | LanguageId::GraphQl);
    let has_dash = matches!(
        lang,
        LanguageId::AnsiSql | LanguageId::PostgreSql | LanguageId::MySql | LanguageId::Sqlite | LanguageId::TSql
    );
    let has_slash_line = matches!(lang, LanguageId::Prisma | LanguageId::Cypher);
    let has_blk = !matches!(lang, LanguageId::Yaml | LanguageId::Toml | LanguageId::Json | LanguageId::GraphQl);
    let has_sq = !matches!(lang, LanguageId::Json | LanguageId::GraphQl);
    let (mut m_idx, mut i, mut stack) = (0usize, 0usize, Vec::<(u8, usize)>::new());
    let (mut unmatched, mut unclosed_blk, mut unclosed_q) = (None, None, None);
    while i < b.len() {
        while m_idx < masked.len() && masked[m_idx].1 <= i {
            m_idx += 1;
        }
        if m_idx < masked.len() && i >= masked[m_idx].0 && i < masked[m_idx].1 {
            i = masked[m_idx].1;
            continue;
        }
        if (has_hash && is_hash_comment_at(b, i))
            || (has_dash && b[i..].starts_with(b"--"))
            || (has_slash_line && b[i..].starts_with(b"//"))
        {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if has_blk && b[i..].starts_with(b"/*") {
            match b[i + 2..].windows(2).position(|w| w == b"*/") {
                Some(rel) => {
                    i += 2 + rel + 2;
                    continue;
                }
                None => {
                    unclosed_blk.get_or_insert(i);
                    break;
                }
            }
        }
        let can_quote = lang != LanguageId::Yaml
            || i == 0
            || matches!(b[i - 1], b' ' | b'\t' | b'\n' | b':' | b',' | b'[' | b'{' | b'-');
        if can_quote && (b[i] == b'"' || (has_sq && b[i] == b'\'')) {
            let (q, qs) = (b[i], i);
            i += 1;
            let mut closed = false;
            while i < b.len() {
                if b[i] == b'\\' && !(lang == LanguageId::Toml && q == b'\'') && i + 1 < b.len() {
                    i += 2;
                    continue;
                }
                if b[i] == q {
                    closed = true;
                    i += 1;
                    break;
                }
                if b[i] == b'\n' && matches!(lang, LanguageId::Json | LanguageId::Toml | LanguageId::Yaml) {
                    break;
                }
                i += 1;
            }
            if !closed {
                unclosed_q.get_or_insert(qs);
            }
            continue;
        }
        if matches!(b[i], b'[' | b'{') || (use_parens && b[i] == b'(') {
            stack.push((b[i], i));
        } else if matches!(b[i], b']' | b'}') || (use_parens && b[i] == b')') {
            let want = match b[i] { b')' => b'(', b']' => b'[', _ => b'{' };
            if let Some(pos) = stack.iter().rposition(|&(c, _)| c == want) {
                stack.remove(pos);
            } else {
                unmatched.get_or_insert((b[i], i));
            }
        }
        i += 1;
    }
    finalize_delim_pinpoint(src, unmatched, &stack, unclosed_blk, unclosed_q)
}

fn finalize_delim_pinpoint(
    src: &str,
    unmatched: Option<(u8, usize)>,
    stack: &[(u8, usize)],
    unclosed_blk: Option<usize>,
    unclosed_q: Option<usize>,
) -> Option<Pinpoint> {
    let mut best: Option<(usize, String)> = None;
    let mut consider = |off: usize, msg: String| {
        if best.as_ref().is_none_or(|(b_off, _)| off >= *b_off) {
            best = Some((off, msg));
        }
    };
    if let Some((cl, off)) = unmatched {
        consider(off, format!("Unmatched closing delimiter '{}'", cl as char));
    }
    if let Some(&(op, off)) = stack.last() {
        let exp = match op { b'(' => ')', b'[' => ']', _ => '}' };
        consider(off, format!("Unclosed delimiter '{}' (expected '{exp}')", op as char));
    }
    if let Some(off) = unclosed_blk {
        consider(off, "Unterminated block comment '/*'".to_string());
    }
    if let Some(off) = unclosed_q {
        consider(off, "Unterminated string literal".to_string());
    }
    best.map(|(off, message)| {
        let (line, column) = byte_to_line_col(src, off);
        Pinpoint { line, column, message }
    })
}

fn byte_to_line_col(src: &str, byte_off: usize) -> (usize, usize) {
    let mut off = byte_off.min(src.len());
    while off > 0 && !src.is_char_boundary(off) {
        off -= 1;
    }
    let head = &src[..off];
    let line = head.bytes().filter(|&c| c == b'\n').count() + 1;
    let col = head.rfind('\n').map_or(off, |nl| off - nl - 1) + 1;
    (line, col)
}
