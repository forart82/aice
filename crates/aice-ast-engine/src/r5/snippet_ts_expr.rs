use aice_lang_registry::LanguageId;

use crate::r5::snippet_blk::find_blk_comment_close;
use crate::r5::snippet_lit::{JsLexState, StepQuote};
use crate::r5::snippet_ts_hdr::{is_only_ts_modifiers, is_quoted_lit, peel_ts_method_modifiers, strip_leading_ts_decorators, strip_trailing_angles};
pub(crate) fn is_ts_fn_type_param_arrow(s: &str) -> bool {
    let Some(pre) = s.trim_end().strip_suffix("=>").map(str::trim_end) else { return false; };
    let b = pre.as_bytes();
    if b.last() != Some(&b')') { return false; }
    let (mut i, mut pd, mut bd, mut cd, mut lp) = (b.len() - 1, 0usize, 0usize, 0usize, None);
    loop {
        match b[i] {
            b')' => pd += 1,
            b'(' => {
                pd = pd.saturating_sub(1);
                if pd == 0 && bd == 0 && cd == 0 { lp = Some(i); break; }
            }
            b']' => bd += 1,
            b'[' => bd = bd.saturating_sub(1),
            b'}' => cd += 1,
            b'{' => cd = cd.saturating_sub(1),
            _ => {}
        }
        if i == 0 { break; }
        i -= 1;
    }
    let Some(lp_pos) = lp else { return false; };
    let inner = pre[lp_pos + 1..b.len() - 1].trim();
    if inner.is_empty() { return true; }
    let ib = inner.as_bytes();
    let (mut j, mut pd, mut bd, mut cd, mut ad, mut saw_ext) = (0usize, 0usize, 0usize, 0usize, 0usize, false);
    let is_id = |c: u8| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$');
    while j < ib.len() {
        match ib[j] {
            b'(' => pd += 1,
            b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1,
            b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1,
            b'}' => cd = cd.saturating_sub(1),
            b'<' if pd == 0 && bd == 0 && cd == 0 => {
                if ib.get(j + 1) == Some(&b'=') { j += 2; continue; }
                ad += 1;
            }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (j == 0 || !matches!(ib[j - 1], b'-' | b'=')) => {
                ad = ad.saturating_sub(1);
            }
            _ if pd == 0 && bd == 0 && cd == 0 && ad == 0 => match ib[j] {
                b'.' if ib[j..].starts_with(b"...") => return true,
                b'e' if ib[j..].starts_with(b"extends")
                    && (j == 0 || !is_id(ib[j - 1]))
                    && ib.get(j + 7).is_none_or(|&c| !is_id(c)) =>
                {
                    saw_ext = true;
                    j += 7;
                    continue;
                }
                b':' if !saw_ext => return true,
                b'?' if !saw_ext => {
                    let next = ib[j + 1..].iter().find(|&&c| !c.is_ascii_whitespace()).copied();
                    if matches!(next, None | Some(b':' | b',')) { return true; }
                }
                b',' => saw_ext = false,
                _ => {}
            },
            _ => {}
        }
        j += 1;
    }
    false
}

fn is_backtick_lit(s: &str) -> bool {
    let (b, mut i, mut js) = (s.as_bytes(), 0usize, JsLexState::new());
    if b.len() < 2 || b[0] != b'`' || !js.open_quote(LanguageId::TypeScript, b, &mut i) { return false; }
    while i < b.len() {
        if b[i] == b'\n' { js.on_newline(LanguageId::TypeScript); i += 1; continue; }
        if js.step_quote(LanguageId::TypeScript, b, &mut i) != StepQuote::NotInQuote { if !js.has_open_quote() { return i == b.len(); } continue; }
        if !js.open_quote(LanguageId::TypeScript, b, &mut i) { js.step_byte(LanguageId::TypeScript, b, &mut i); }
    }
    false
}
pub(crate) fn is_ts_quoted_method_hdr(raw_hdr: &str, class_mods: bool) -> bool { is_ts_quoted_method_hdr_kind(raw_hdr, class_mods, false) }
pub(crate) fn is_ts_backtick_method_hdr(raw_hdr: &str, class_mods: bool) -> bool { is_ts_quoted_method_hdr_kind(raw_hdr, class_mods, true) }
fn is_ts_quoted_method_hdr_kind(raw_hdr: &str, class_mods: bool, backtick: bool) -> bool {
    let matches_lit = |v: &str| if backtick { is_backtick_lit(v) } else { is_quoted_lit(v) };
    fn strip_opt_q(v: &str, bt: bool) -> &str { if bt { v.trim_end().strip_suffix('?').map_or(v, str::trim_end) } else { v } }
    let b = raw_hdr.as_bytes();
    let (mut i, mut js, mut pd, mut bd, mut cd, mut ad, mut last_seg, mut at_seg) =
        (0usize, JsLexState::new(), 0usize, 0usize, 0usize, 0usize, 0usize, None);
    let mut clean = String::with_capacity(raw_hdr.len());
    let align = |idx: &mut usize| while *idx < b.len() && !raw_hdr.is_char_boundary(*idx) { *idx += 1; };
    while i < b.len() {
        let prev = i;
        if b[i] == b'\n' {
            js.on_newline(LanguageId::TypeScript);
            clean.push('\n');
            if pd == 0 && bd == 0 && cd == 0 && ad == 0 && !js.has_open_quote() {
                let t = strip_leading_ts_decorators(clean[at_seg.unwrap_or(last_seg)..].trim());
                if !t.is_empty() && !is_only_ts_modifiers(t, class_mods)
                    && !matches_lit(strip_opt_q(strip_trailing_angles(peel_ts_method_modifiers(t, class_mods)), backtick))
                {
                    last_seg = clean.len();
                    at_seg = None;
                }
            }
            i += 1;
            continue;
        }
        match js.step_quote(LanguageId::TypeScript, b, &mut i) {
            StepQuote::Consumed => { align(&mut i); clean.push_str(&raw_hdr[prev..i]); continue; }
            StepQuote::EnteredInterp => { align(&mut i); clean.push_str(&raw_hdr[prev..i]); cd += 1; continue; }
            StepQuote::NotInQuote => {}
        }
        if let Some((mut end, _)) = js.match_special(LanguageId::TypeScript, b, i) {
            align(&mut end); clean.push_str(&raw_hdr[prev..end]); i = end; continue;
        }
        if js.open_quote(LanguageId::TypeScript, b, &mut i) {
            align(&mut i); clean.push_str(&raw_hdr[prev..i]); continue;
        }
        if b[i..].starts_with(b"//") {
            while i < b.len() && b[i] != b'\n' { i += 1; }
            clean.push(' ');
            continue;
        }
        if b[i..].starts_with(b"/*") {
            let (Some(after), _) = find_blk_comment_close(LanguageId::TypeScript, b, i + 2, 1) else { break; };
            clean.push(' ');
            i = after;
            continue;
        }
        match b[i] {
            b'(' => pd += 1,
            b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1,
            b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1,
            b'}' => {
                cd = cd.saturating_sub(1);
                if pd == 0 && bd == 0 && cd == 0 && ad == 0 && !js.has_open_quote() { last_seg = clean.len() + 1; at_seg = None; }
            }
            b',' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => { last_seg = clean.len() + 1; at_seg = None; }
            b';' if pd == 0 && bd == 0 && cd == 0 => { ad = 0; last_seg = clean.len() + 1; at_seg = None; }
            b'<' if pd == 0 && bd == 0 && cd == 0 && b.get(i + 1) != Some(&b'=') => {
                let t = strip_leading_ts_decorators(clean[at_seg.unwrap_or(last_seg)..].trim());
                if ad > 0 || matches_lit(strip_opt_q(peel_ts_method_modifiers(t, class_mods), backtick)) { ad += 1; }
            }
            b'>' if pd == 0 && bd == 0 && cd == 0 && ad > 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => {
                ad -= 1;
            }
            b'@' if pd == 0 && bd == 0 && cd == 0 && ad == 0 && at_seg.is_none()
                && clean[last_seg..].rsplit('\n').next().unwrap_or("").trim().is_empty() =>
            {
                at_seg = Some(clean.len());
            }
            _ => {}
        }
        js.step_byte(LanguageId::TypeScript, b, &mut i);
        align(&mut i);
        clean.push_str(&raw_hdr[prev..i]);
    }
    let seg = clean[at_seg.unwrap_or(last_seg)..].trim();
    let no_dec = strip_leading_ts_decorators(seg);
    matches_lit(strip_opt_q(peel_ts_method_modifiers(strip_trailing_angles(no_dec), class_mods), backtick))
}
fn strip_switch_or_if_prefix(s: &str) -> &str {
    let mut t = s.trim();
    loop {
        let first = t.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').find(|w| !w.is_empty());
        if matches!(first, Some("case" | "default")) {
            let b = t.as_bytes();
            let (mut pd, mut bd, mut cd, mut qd, mut found) = (0usize, 0usize, 0usize, 0usize, None);
            for (i, &c) in b.iter().enumerate() {
                match c {
                    b'(' => pd += 1,
                    b')' => pd = pd.saturating_sub(1),
                    b'[' => bd += 1,
                    b']' => bd = bd.saturating_sub(1),
                    b'{' => cd += 1,
                    b'}' => cd = cd.saturating_sub(1),
                    b'?' if pd == 0 && bd == 0 && cd == 0 => qd += 1,
                    b':' if pd == 0 && bd == 0 && cd == 0 => {
                        if qd > 0 { qd -= 1; } else { found = Some(i + 1); break; }
                    }
                    _ => {}
                }
            }
            if let Some(p) = found { t = t[p..].trim(); continue; }
        } else if first == Some("else")
            && t.starts_with("else")
            && t["else".len()..].chars().next().is_some_and(|c| !c.is_ascii_alphanumeric() && c != '_')
        {
            t = t["else".len()..].trim();
            continue;
        } else if let Some(kw @ ("if" | "while" | "for")) = first
            && t.starts_with(kw)
        {
            let rest = t[kw.len()..].trim_start();
            if rest.starts_with('(') {
                let (mut pd, mut bd, mut cd, mut close_p) = (0usize, 0usize, 0usize, None);
                for (i, &c) in rest.as_bytes().iter().enumerate() {
                    match c {
                        b'(' => pd += 1,
                        b')' => {
                            pd = pd.saturating_sub(1);
                            if pd == 0 && bd == 0 && cd == 0 { close_p = Some(i); break; }
                        }
                        b'[' => bd += 1,
                        b']' => bd = bd.saturating_sub(1),
                        b'{' => cd += 1,
                        b'}' => cd = cd.saturating_sub(1),
                        _ => {}
                    }
                }
                if let Some(p) = close_p { t = rest[p + 1..].trim_start(); continue; }
            }
        } else if let Some(id) = first
            && t.starts_with(id)
            && !matches!(id, "return" | "throw" | "yield" | "await" | "export")
        {
            let rest = t[id.len()..].trim_start();
            if rest.starts_with(':') && !rest.starts_with("::") {
                t = rest[1..].trim_start();
                continue;
            }
        }
        break;
    }
    t
}
pub(crate) fn is_js_expr_brace_hdr(hdr: &str, words: &[&str], in_plain_stmt_ctx: bool) -> bool {
    if !in_plain_stmt_ctx {
        return false;
    }
    let expr = strip_switch_or_if_prefix(hdr);
    let ew: Vec<&str> = expr.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').filter(|w| !w.is_empty()).collect();
    if !expr.ends_with(':')
        && (ew.last().is_some_and(|w| matches!(*w, "return" | "throw" | "yield" | "await"))
            || ew.ends_with(&["export", "default"])
            || (!hdr.ends_with(':') && (words.last().is_some_and(|w| matches!(*w, "return" | "throw" | "yield" | "await"))
                || words.ends_with(&["export", "default"]))))
    {
        return true;
    }
    let starts_expr_kw = matches!(ew.first().copied(), Some("return" | "throw" | "yield" | "await"))
        || ew.starts_with(&["export", "default"]);
    if !starts_expr_kw {
        return false;
    }
    let et = expr.trim_end();
    if et.ends_with(['?', ',']) || et.ends_with("||") || et.ends_with("&&") || et.ends_with("??") {
        return true;
    }
    if et.ends_with(':') {
        let (mut pd, mut bd, mut cd) = (0usize, 0usize, 0usize);
        for &c in et.as_bytes() {
            match c {
                b'(' => pd += 1,
                b')' => pd = pd.saturating_sub(1),
                b'[' => bd += 1,
                b']' => bd = bd.saturating_sub(1),
                b'{' => cd += 1,
                b'}' => cd = cd.saturating_sub(1),
                b'?' if pd == 0 && bd == 0 && cd == 0 => return true,
                _ => {}
            }
        }
    }
    false
}
