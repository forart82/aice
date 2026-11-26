use aice_lang_registry::LanguageId;

use crate::r5::snippet_blk::find_blk_comment_close;
pub use crate::r5::snippet_blk::normalize_edit_slices_for_blk;
pub(crate) use crate::r5::snippet_js_lex::{JsLexState, StepQuote, is_js_like};
use crate::r5::snippet_lex::{has_hash_comments, has_slash_comments, is_hash_comment_at};

pub(crate) fn match_js_regex_body(b: &[u8], i: usize, no_rbrack_until: &mut usize) -> Option<usize> {
    if b[i] != b'/' || b.get(i + 1).is_some_and(|&c| c == b'/' || c == b'*') {
        return None;
    }
    let (mut j, mut in_class) = (i + 1, false);
    while j < b.len() {
        if matches!(b[j], b'\n' | b'\r') {
            *no_rbrack_until = (*no_rbrack_until).max(j);
            return None;
        }
        if b[j] == b'\\' {
            if j + 1 < b.len() && !matches!(b[j + 1], b'\n' | b'\r') {
                j += 2;
                continue;
            }
            *no_rbrack_until = (*no_rbrack_until).max(j);
            return None;
        }
        if b[j] == b'[' {
            if j < *no_rbrack_until {
                return None;
            }
            in_class = true;
        } else if b[j] == b']' {
            in_class = false;
        } else if b[j] == b'/' && !in_class {
            j += 1;
            while j < b.len() && b[j].is_ascii_alphabetic() {
                j += 1;
            }
            return Some(j);
        }
        j += 1;
    }
    *no_rbrack_until = (*no_rbrack_until).max(j);
    None
}

pub(crate) fn open_quote_start(lang: LanguageId, prefix: &str) -> Option<usize> {
    let b = prefix.as_bytes();
    let (slash, hash) = (has_slash_comments(lang), has_hash_comments(lang));
    let (mut js, mut i) = (JsLexState::new(), 0usize);
    while i < b.len() {
        if b[i] == b'\n' {
            js.on_newline(lang);
            i += 1;
            continue;
        }
        if js.step_quote(lang, b, &mut i) != StepQuote::NotInQuote {
            continue;
        }
        if let Some((end, closed)) = js.match_special(lang, b, i) {
            if !closed {
                return Some(i);
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
                break;
            };
            i = after;
            continue;
        }
        js.step_byte(lang, b, &mut i);
    }
    js.active_quote_start()
}

pub(crate) fn ends_with_js_regex(lang: LanguageId, s: &str) -> bool {
    if !is_js_like(lang) {
        return false;
    }
    let b = s.as_bytes();
    let (mut i, mut js) = (0usize, JsLexState::new());
    while i < b.len() {
        if b[i] == b'\n' {
            js.on_newline(lang);
            i += 1;
            continue;
        }
        if js.step_quote(lang, b, &mut i) != StepQuote::NotInQuote {
            continue;
        }
        if js.open_quote(lang, b, &mut i) {
            continue;
        }
        if b[i..].starts_with(b"//") {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if b[i..].starts_with(b"/*") {
            let (Some(end), _) = find_blk_comment_close(lang, b, i + 2, 1) else {
                return false;
            };
            i = end;
            continue;
        }
        if b[i] == b'/'
            && js.regex_allowed
            && let Some(end) = match_js_regex_body(b, i, &mut js.no_rbrack_until)
        {
            if end == b.len() {
                return true;
            }
            js.after_value();
            i = end;
            continue;
        }
        js.step_byte(lang, b, &mut i);
    }
    false
}

pub(crate) fn ends_with_jsx_tag(lang: LanguageId, s: &str) -> bool {
    if !matches!(lang, LanguageId::Tsx | LanguageId::JavaScript) || !s.ends_with('>') { return false; }
    let (b, mut i, mut js, mut pd, mut cd) = (s.as_bytes(), 0usize, JsLexState::new(), 0usize, 0usize);
    let (mut last_lt, mut operand, mut word_start) = (None::<(usize, bool, usize, usize)>, false, None::<usize>);
    let flush_word = |ws: &mut Option<usize>, op: &mut bool, end: usize| {
        if let Some(s_idx) = ws.take() {
            *op = !matches!(&b[s_idx..end], b"return" | b"yield" | b"await" | b"throw" | b"case" | b"else" | b"default" | b"export" | b"in" | b"instanceof" | b"typeof" | b"delete" | b"void" | b"new" | b"do");
        }
    };
    while i < b.len() {
        if b[i] == b'\n' { flush_word(&mut word_start, &mut operand, i); js.on_newline(lang); i += 1; continue; }
        match js.step_quote(lang, b, &mut i) {
            StepQuote::Consumed => { if !js.has_open_quote() { operand = true; } continue; }
            StepQuote::EnteredInterp => { operand = false; continue; }
            StepQuote::NotInQuote => {}
        }
        if js.open_quote(lang, b, &mut i) { flush_word(&mut word_start, &mut operand, i - 1); operand = false; continue; }
        if b[i..].starts_with(b"//") { flush_word(&mut word_start, &mut operand, i); while i < b.len() && b[i] != b'\n' { i += 1; } continue; }
        if b[i..].starts_with(b"/*") {
            flush_word(&mut word_start, &mut operand, i);
            let (Some(end), _) = find_blk_comment_close(lang, b, i + 2, 1) else { return false; };
            i = end; continue;
        }
        if b[i] == b'/' && js.regex_allowed && let Some(end) = match_js_regex_body(b, i, &mut js.no_rbrack_until) {
            flush_word(&mut word_start, &mut operand, i); js.after_value(); operand = true; i = end; continue;
        }
        if b[i].is_ascii_alphanumeric() || matches!(b[i], b'_' | b'$') {
            if word_start.is_none() { word_start = Some(i); }
            js.step_byte(lang, b, &mut i); continue;
        }
        flush_word(&mut word_start, &mut operand, i);
        match b[i] {
            b'<' => { last_lt = Some((i, operand, pd, cd)); operand = false; }
            b'>' => {
                if i > 0 && b[i - 1] == b'=' { operand = false; }
                else if i + 1 == b.len() {
                    let Some((lt, op_before, lpd, lcd)) = last_lt else { return false; };
                    if lpd != pd || lcd != cd { return false; }
                    if b.get(lt + 1) == Some(&b'/') {
                        let inner = b[lt + 2..i].trim_ascii();
                        return inner.is_empty() || (inner[0].is_ascii_alphabetic() || matches!(inner[0], b'_' | b'$'))
                            && inner.iter().all(|&c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$' | b'.' | b'-' | b':'));
                    }
                    return !op_before && (lt + 1 == i || b.get(lt + 1).is_some_and(|c| c.is_ascii_alphabetic() || matches!(c, b'_' | b'$')));
                } else if last_lt.is_some_and(|(_, _, lpd, lcd)| lpd == pd && lcd == cd) { last_lt = None; operand = false; }
            }
            b';' => { last_lt = None; operand = false; }
            b'(' => { pd += 1; operand = false; }
            b')' => { pd = pd.saturating_sub(1); operand = true; }
            b'{' => { cd += 1; operand = false; }
            b'}' => { cd = cd.saturating_sub(1); operand = true; }
            b']' => { operand = true; }
            c if !c.is_ascii_whitespace() => { operand = false; }
            _ => {}
        }
        js.step_byte(lang, b, &mut i);
    }
    false
}
