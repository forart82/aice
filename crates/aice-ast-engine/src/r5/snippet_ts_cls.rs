use aice_lang_registry::LanguageId;
use crate::r5::{
    snippet_blk::find_blk_comment_close, snippet_hdr::trim_after_last_sep,
    snippet_hdr_ts::{is_ts_ret_obj_lbrace, raw_rbrace_keeps_method_lp}, snippet_lit::{JsLexState, StepQuote},
    snippet_ts_expr::{is_ts_backtick_method_hdr, is_ts_quoted_method_hdr}, snippet_ts_gen_ctx::{TsGenMemberCtx, is_valid_ts_ident},
    snippet_ts_hdr::{is_balanced_computed_prop, is_decorator_call_hdr, is_only_ts_modifiers, is_quoted_lit, is_ts_obj_shorthand_method_hdr, peel_ts_method_modifiers, strip_leading_ts_decorators, strip_trailing_angles},
    snippet_ts_type::{has_depth0_assign_outside_angles, tail_after_depth0_comma},
};
pub(crate) fn is_ts_class_static_block(seg: &str) -> bool { seg.trim_end().rsplit('\n').next().unwrap_or(seg).trim() == "static" }
pub(crate) fn is_non_ctrl_words(seg: &str) -> bool { !seg.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').any(|w| matches!(w, "if" | "for" | "while" | "switch" | "catch" | "return" | "throw" | "new" | "sizeof")) }

pub(crate) fn is_ts_iface_sig_hdr(seg: &str) -> bool {
    if has_depth0_assign_outside_angles(seg) { return false; }
    let t = strip_trailing_angles(seg).trim();
    matches!(t, "" | "new" | "abstract new") || (is_non_ctrl_words(seg) && !is_decorator_call_hdr(seg))
}

fn is_ts_private_ident(id: &str) -> bool { id.strip_prefix('#').is_some_and(is_valid_ts_ident) }

fn slice_raw_last_lines(raw: &str, tail_nl: usize) -> &str {
    let raw_t = raw.trim_end();
    let b = raw_t.as_bytes();
    let (mut i, mut js, mut code_line_count) = (0usize, JsLexState::new(), 1usize);
    let mut line_starts = vec![0usize];
    while i < b.len() {
        if b[i] == b'\n' { js.on_newline(LanguageId::TypeScript); i += 1; line_starts.push(i); continue; }
        if js.step_quote(LanguageId::TypeScript, b, &mut i) != StepQuote::NotInQuote { code_line_count = line_starts.len(); continue; }
        if let Some((end, _)) = js.match_special(LanguageId::TypeScript, b, i) { i = end; code_line_count = line_starts.len(); continue; }
        if js.open_quote(LanguageId::TypeScript, b, &mut i) { code_line_count = line_starts.len(); continue; }
        if b[i..].starts_with(b"//") { while i < b.len() && b[i] != b'\n' { i += 1; } continue; }
        if b[i..].starts_with(b"/*") {
            let (Some(after), _) = find_blk_comment_close(LanguageId::TypeScript, b, i + 2, 1) else { break; };
            for &ch in &b[i + 2..after] { if ch == b'\n' { js.on_newline(LanguageId::TypeScript); } }
            i = after; continue;
        }
        if !b[i].is_ascii_whitespace() { code_line_count = line_starts.len(); }
        js.step_byte(LanguageId::TypeScript, b, &mut i);
    }
    let idx = code_line_count.saturating_sub(1 + tail_nl);
    &raw[line_starts[idx]..]
}

pub(crate) fn ts_class_member_tail<'a>(seg: &'a str, raw_seg: &'a str) -> (&'a str, &'a str) {
    let b = seg.as_bytes();
    let (mut i, mut pd, mut bd, mut cd, mut ad) = (0usize, 0usize, 0usize, 0usize, 0usize);
    let (mut last_seg, mut at_seg, mut saw_assign, mut open_lb) = (0usize, None, false, None);
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1, b']' => bd = bd.saturating_sub(1),
            b'{' => { if pd == 0 && bd == 0 && cd == 0 && ad == 0 { open_lb = Some(i + 1); } cd += 1; }
            b'}' => {
                cd = cd.saturating_sub(1);
                if pd == 0 && bd == 0 && cd == 0 && ad == 0 {
                    let lb = open_lb; open_lb = None;
                    let next = b[i + 1..].iter().find(|&&c| !c.is_ascii_whitespace()).copied();
                    let keep = matches!(next, Some(b':' | b'?' | b'&' | b'|' | b'>'))
                        || (next.is_none() && lb.is_some_and(|p| p > last_seg && is_ts_ret_obj_lbrace(&seg[last_seg..p - 1])));
                    if !keep { saw_assign = false; last_seg = i + 1; at_seg = None; }
                }
            }
            b';' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => { saw_assign = false; last_seg = i + 1; at_seg = None; open_lb = None; }
            b'<' if pd == 0 && bd == 0 && cd == 0 && !saw_assign => {
                if matches!(b.get(i + 1), Some(b'=' | b'<')) { i += 2; continue; }
                ad += 1;
            }
            b'>' if pd == 0 && bd == 0 && cd == 0 && ad > 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => ad -= 1,
            b'=' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => {
                let prev = i.checked_sub(1).and_then(|k| b.get(k)).copied();
                let next = b.get(i + 1).copied();
                if !matches!(prev, Some(b'=' | b'!' | b'<' | b'>')) && !matches!(next, Some(b'=' | b'>')) {
                    saw_assign = true;
                }
            }
            b'@' if pd == 0 && bd == 0 && cd == 0 && ad == 0 && at_seg.is_none() => {
                if seg[last_seg..i].rsplit('\n').next().unwrap_or("").trim().is_empty() { at_seg = Some(i); }
            }
            b'\n' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => {
                let start = at_seg.unwrap_or(last_seg);
                let cur = seg[start..i].trim();
                let next_ch = seg[i + 1..].trim_start().as_bytes().first().copied();
                let cont_next = matches!(next_ch, Some(b':' | b'(' | b'<' | b'{' | b'?' | b'|' | b'&'))
                    || seg[i + 1..].trim_start().starts_with("=>");
                let no_dec = strip_leading_ts_decorators(cur).trim();
                let keep_cur = cur.is_empty()
                    || (!saw_assign && (no_dec.is_empty() || is_only_ts_modifiers(no_dec, true)
                        || cur.ends_with(['<', ',', ':', '?', '|', '&']) || cur.ends_with("=>") || cont_next));
                if !keep_cur { last_seg = i + 1; at_seg = None; saw_assign = false; open_lb = None; }
            }
            _ => {}
        }
        i += 1;
    }
    let start = at_seg.unwrap_or(last_seg);
    let tail_nl = seg[start..].trim_end().bytes().filter(|&c| c == b'\n').count();
    (&seg[start..], slice_raw_last_lines(raw_seg, tail_nl))
}

fn raw_method_lparen_pos(raw_seg: &str) -> Option<usize> {
    let b = raw_seg.as_bytes();
    let (mut i, mut js, mut pd, mut bd, mut cd, mut ad) = (0usize, JsLexState::new(), 0usize, 0usize, 0usize, 0usize);
    let (mut first_lp, mut in_dec, mut saw_colon_or_eq, mut saw_ret_colon, mut last_code, mut prev_code) = (None, false, false, false, 0u8, 0u8);
    let dec_continues = |rest: &[u8]| {
        rest.iter().find(|&&c| !matches!(c, b' ' | b'\t')).is_some_and(|&c| matches!(c, b'(' | b'[' | b'<' | b'.' | b'?'))
    };
    while i < b.len() {
        if b[i] == b'\n' {
            if pd == 0 && bd == 0 && cd == 0 && ad == 0 {
                if in_dec && !b[i + 1..].iter().find(|&&c| !matches!(c, b' ' | b'\t')).is_some_and(|&c| c == b'.') { in_dec = false; }
                if saw_colon_or_eq {
                    let inc = last_code == 0 || matches!(last_code, b'=' | b':' | b',' | b'<' | b'|' | b'&' | b'?' | b'+' | b'-' | b'*' | b'/' | b'%' | b'(' | b'[' | b'.')
                        || (prev_code == b'=' && last_code == b'>');
                    let cont = matches!(raw_seg[i + 1..].trim_start().as_bytes().first(), Some(b'=' | b':' | b'|' | b'&' | b'?' | b'.' | b'[' | b'('));
                    if !inc && !cont { first_lp = None; saw_colon_or_eq = false; saw_ret_colon = false; last_code = 0; prev_code = 0; }
                }
            }
            js.on_newline(LanguageId::TypeScript); i += 1; continue;
        }
        match js.step_quote(LanguageId::TypeScript, b, &mut i) {
            StepQuote::Consumed | StepQuote::EnteredInterp => { prev_code = last_code; last_code = b'"'; continue; }
            StepQuote::NotInQuote => {}
        }
        if let Some((end, _)) = js.match_special(LanguageId::TypeScript, b, i) { prev_code = last_code; last_code = b'"'; i = end; continue; }
        if js.open_quote(LanguageId::TypeScript, b, &mut i) { prev_code = last_code; last_code = b'"'; continue; }
        if js.quote.is_none() && b[i..].starts_with(b"//") { while i < b.len() && b[i] != b'\n' { i += 1; } continue; }
        if js.quote.is_none() && b[i..].starts_with(b"/*") {
            let (Some(after), _) = find_blk_comment_close(LanguageId::TypeScript, b, i + 2, 1) else { break; };
            for &ch in &b[i + 2..after] { if ch == b'\n' { js.on_newline(LanguageId::TypeScript); } }
            i = after; continue;
        }
        if js.has_open_quote() { prev_code = last_code; last_code = b'"'; js.step_byte(LanguageId::TypeScript, b, &mut i); continue; }
        match b[i] {
            b'@' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => in_dec = true,
            b'(' => { if pd == 0 && bd == 0 && cd == 0 && ad == 0 && !in_dec && first_lp.is_none() { first_lp = Some(i); } pd += 1; }
            b')' => { pd = pd.saturating_sub(1); if in_dec && pd == 0 && bd == 0 && cd == 0 && ad == 0 && !dec_continues(&b[i + 1..]) { in_dec = false; } }
            b'[' => bd += 1, b']' => { bd = bd.saturating_sub(1); if in_dec && pd == 0 && bd == 0 && cd == 0 && ad == 0 && !dec_continues(&b[i + 1..]) { in_dec = false; } }
            b'{' => cd += 1, b'}' => { cd = cd.saturating_sub(1); if pd == 0 && bd == 0 && cd == 0 && ad == 0 && !js.has_open_quote() && !(first_lp.is_some() && saw_ret_colon && raw_rbrace_keeps_method_lp(raw_seg, i)) { first_lp = None; in_dec = false; saw_colon_or_eq = false; saw_ret_colon = false; last_code = 0; prev_code = 0; } }
            b'<' if pd == 0 && bd == 0 && cd == 0 && (!saw_colon_or_eq || in_dec) => { if matches!(b.get(i + 1), Some(b'=' | b'<')) { i += 2; continue; } ad += 1; }
            b'>' if pd == 0 && bd == 0 && cd == 0 && ad > 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => { ad -= 1; if in_dec && ad == 0 && !dec_continues(&b[i + 1..]) { in_dec = false; } }
            b':' if pd == 0 && bd == 0 && cd == 0 && ad == 0 && !in_dec => { if first_lp.is_none() { saw_colon_or_eq = true; } else if last_code == b')' { saw_ret_colon = true; } }
            b'=' if pd == 0 && bd == 0 && cd == 0 && ad == 0 && !in_dec && first_lp.is_none() => {
                let prev = i.checked_sub(1).and_then(|k| b.get(k)).copied();
                let next = b.get(i + 1).copied();
                if !matches!(prev, Some(b'=' | b'!' | b'<' | b'>')) && !matches!(next, Some(b'=' | b'>')) { saw_colon_or_eq = true; }
            }
            b';' if pd == 0 && bd == 0 && cd == 0 => { first_lp = None; in_dec = false; ad = 0; saw_colon_or_eq = false; saw_ret_colon = false; last_code = 0; prev_code = 0; }
            b',' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => { first_lp = None; in_dec = false; saw_colon_or_eq = false; saw_ret_colon = false; last_code = 0; prev_code = 0; }
            b' ' | b'\t' if in_dec && pd == 0 && bd == 0 && cd == 0 && ad == 0 && !dec_continues(&b[i + 1..]) => { in_dec = false; }
            _ => {}
        }
        if !b[i].is_ascii_whitespace() { prev_code = last_code; last_code = b[i]; }
        js.step_byte(LanguageId::TypeScript, b, &mut i);
    }
    first_lp
}

pub(crate) fn is_ts_backtick_method_body_hdr(raw_seg: &str, class_mods: bool) -> bool { raw_seg.contains('`') && is_ts_method_body_hdr_kind("", raw_seg, class_mods, 1) }
pub(crate) fn is_ts_obj_method_body_hdr(seg: &str, raw_seg: &str, class_mods: bool) -> bool { is_ts_method_body_hdr_kind(seg, raw_seg, class_mods, 0) }
pub(crate) fn is_ts_invalid_op_method_hdr(raw_seg: &str, class_mods: bool) -> bool { is_ts_method_body_hdr_kind("", raw_seg, class_mods, 2) }
pub(crate) fn is_js_opt_method_hdr(raw_seg: &str, class_mods: bool) -> bool { is_ts_method_body_hdr_kind("", raw_seg, class_mods, 3) }
fn is_ts_method_body_hdr_kind(seg: &str, raw_seg: &str, class_mods: bool, mode: u8) -> bool {
    let backtick = mode == 1 || (mode >= 2 && raw_seg.contains('`'));
    let cleaned_q;
    let (eff_seg, raw_tail) = if mode >= 2 || backtick || raw_seg.contains(['"', '\'']) {
        cleaned_q = clean_ts_with_quoted_mode(raw_seg, if backtick { 2 } else { 0 });
        let trimmed = trim_after_last_sep(&cleaned_q).trim();
        if class_mods || backtick { ts_class_member_tail(trimmed, raw_seg) } else { (trimmed, raw_seg) }
    } else { (seg, raw_seg) };
    let tail = strip_leading_ts_decorators(tail_after_depth0_comma(eff_seg).trim()).trim();
    if has_depth0_assign_outside_angles(tail) { return false; }
    let b = tail.as_bytes();
    let (mut i, mut pd, mut bd, mut cd, mut ad, mut first_lp, mut match_rp) = (0usize, 0usize, 0usize, 0usize, 0usize, None, None);
    while i < b.len() {
        match b[i] {
            b'(' => { if pd == 0 && bd == 0 && cd == 0 && ad == 0 && first_lp.is_none() { first_lp = Some(i); } pd += 1; }
            b')' => { pd = pd.saturating_sub(1); if pd == 0 && bd == 0 && cd == 0 && ad == 0 && first_lp.is_some() && match_rp.is_none() { match_rp = Some(i); } }
            b'[' => bd += 1, b']' => bd = bd.saturating_sub(1), b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'<' if pd == 0 && bd == 0 && cd == 0 => { if b.get(i + 1) == Some(&b'=') { i += 2; continue; } ad += 1; }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => ad = ad.saturating_sub(1),
            b':' if pd == 0 && bd == 0 && cd == 0 && ad == 0 && first_lp.is_none() => return false,
            b'?' if pd == 0 && bd == 0 && cd == 0 && ad == 0 && first_lp.is_none() && !((backtick || mode >= 2) && tail[i + 1..].trim_start().starts_with(['(', '<'])) => return false,
            _ => {}
        }
        i += 1;
    }
    let (Some(lp), Some(rp)) = (first_lp, match_rp) else { return false; };
    let post = tail[rp + 1..].trim();
    let post_ok = post.is_empty()
        || (post.starts_with(':') && (backtick || mode >= 2 || !post[1..].trim().is_empty()))
        || (backtick && post == "=>");
    if !post_ok { return false; }
    let no_ang = strip_trailing_angles(tail[..lp].trim_end()).trim();
    let no_q = if backtick || mode >= 2 { no_ang.strip_suffix('?').map_or(no_ang, str::trim_end) } else { no_ang };
    let mut asi_no_q = no_q;
    if class_mods {
        while let Some((ln, rest)) = asi_no_q.split_once('\n') {
            let rt = rest.trim_start();
            let ws: Vec<&str> = ln.split_whitespace().collect();
            let is_mod = |w: &str| matches!(w, "public" | "private" | "protected" | "static" | "readonly" | "abstract" | "override");
            let is_asi_decl = ws == ["declare"] || ws == ["declare", "async"]
                || (ws.len() >= 2 && ws.last() == Some(&"declare") && ws[..ws.len() - 1].iter().all(|&w| is_mod(w)));
            let has_later_decl = rt.rsplit_once('\n').is_some_and(|(pre, _)| pre.lines().any(|l| l.split_whitespace().next() == Some("declare")));
            let is_mod_before_decl = has_later_decl && ws.len() == 1 && (ws[0] == "async" || is_mod(ws[0]));
            if !((is_asi_decl && !rt.starts_with('*')) || is_mod_before_decl) { break; }
            asi_no_q = rt;
        }
    }
    let head = peel_ts_method_modifiers(asi_no_q, class_mods);
    let h_bare = head.trim_start_matches(|c: char| c == '*' || c.is_whitespace());
    if mode == 3 {
        return no_q.len() != no_ang.len() && (h_bare == "`_`" || is_quoted_lit(h_bare)
            || is_valid_ts_ident(h_bare) || (!h_bare.is_empty() && h_bare.bytes().all(|c| c.is_ascii_digit()))
            || (class_mods && is_ts_private_ident(h_bare)) || is_balanced_computed_prop(h_bare));
    }
    if mode == 2 {
        if h_bare.is_empty() || h_bare == "`_`" || is_balanced_computed_prop(h_bare) || (no_q.len() != no_ang.len() && tail.starts_with("...")) { return false; }
        return h_bare.bytes().any(|c| matches!(c,
            b'+' | b'-' | b'*' | b'/' | b'%' | b'&' | b'|' | b'^' | b'~' | b'!' | b'=' | b'<' | b'>' | b'.' | b','
        )) || h_bare.contains(char::is_whitespace);
    }
    if backtick { return h_bare == "`_`" && raw_method_lparen_pos(raw_tail).is_some_and(|p| is_ts_backtick_method_hdr(&raw_tail[..p], class_mods)); }
    if h_bare.is_empty() || is_quoted_lit(h_bare) { return raw_method_lparen_pos(raw_seg).is_some_and(|p| is_ts_quoted_method_hdr(&raw_seg[..p], class_mods)); }
    (class_mods && is_ts_private_ident(head)) || is_ts_obj_shorthand_method_hdr(head)
}
pub(crate) fn clean_ts_preserving_quoted_method_lt(raw: &str, ctx: TsGenMemberCtx) -> String { clean_ts_with_quoted_mode(raw, match ctx { TsGenMemberCtx::ClassOrType | TsGenMemberCtx::IfaceType => 3, TsGenMemberCtx::ObjBrace => 1, TsGenMemberCtx::None => 4 }) }
fn clean_ts_with_quoted_mode(raw: &str, mode: u8) -> String {
    let b = raw.as_bytes();
    let (mut i, mut js, mut out, mut bt_start) = (0usize, JsLexState::new(), String::with_capacity(raw.len()), None::<usize>);
    while i < b.len() {
        if b[i] == b'\n' {
            if js.on_newline(LanguageId::TypeScript) && !js.has_open_quote() { bt_start = None; }
            out.push('\n'); i += 1; continue;
        }
        match js.step_quote(LanguageId::TypeScript, b, &mut i) {
            StepQuote::Consumed => {
                if mode == 2 && !js.has_open_quote() && let Some(pos) = bt_start.take() { out.replace_range(pos..pos + 1, "`_`"); }
                out.push_str(if matches!(mode, 1 | 3 | 4) && !js.has_open_quote() { "\"_\"" } else { " " }); continue;
            }
            StepQuote::EnteredInterp => { out.push_str(if matches!(mode, 2 | 4) { " " } else { "${" }); continue; }
            StepQuote::NotInQuote => {}
        }
        if mode == 2 && js.has_open_quote() {
            if js.quote.is_none() && b[i..].starts_with(b"//") { while i < b.len() && b[i] != b'\n' { i += 1; } }
            else if js.quote.is_none() && b[i..].starts_with(b"/*") {
                let (Some(after), _) = find_blk_comment_close(LanguageId::TypeScript, b, i + 2, 1) else { break; };
                for &ch in &b[i + 2..after] { if ch == b'\n' { js.on_newline(LanguageId::TypeScript); out.push('\n'); } }
                i = after;
            } else if let Some((end, _)) = js.match_special(LanguageId::TypeScript, b, i) { i = end; }
            else if !js.open_quote(LanguageId::TypeScript, b, &mut i) { js.step_byte(LanguageId::TypeScript, b, &mut i); }
            out.push(' '); continue;
        }
        if let Some((end, _)) = js.match_special(LanguageId::TypeScript, b, i) { out.push_str(if matches!(mode, 1 | 3 | 4) { " _r_ " } else { " " }); i = end; continue; }
        if matches!(b[i], b'"' | b'\'') && js.open_quote(LanguageId::TypeScript, b, &mut i) {
            while i < b.len() && b[i] != b'\n' && js.step_quote(LanguageId::TypeScript, b, &mut i) != StepQuote::NotInQuote {}
            if mode == 1 || mode == 3 {
                let (class_mods, after_lt, lp) = (mode == 3, crate::r5::snippet_ts_brace::starts_with_lt_after_ws_comments(b, i), out.rsplit('\n').next().unwrap_or("").trim());
                let dr = strip_leading_ts_decorators(lp).trim();
                let prev_ok = lp.is_empty() || lp.ends_with([';', '{', '}', ',']) || (dr.is_empty() && !lp.is_empty()) || is_only_ts_modifiers(dr, class_mods);
                out.push_str(if after_lt && prev_ok { "_q_" } else if !js.has_open_quote() { "\"_\"" } else { " " });
            } else { out.push_str(if mode == 4 && js.has_open_quote() { " " } else { "\"_\"" }); }
            continue;
        }
        let prev = i;
        if js.open_quote(LanguageId::TypeScript, b, &mut i) {
            if mode == 2 && bt_start.is_none() && b[prev] == b'`' { bt_start = Some(out.len()); }
            out.push(' '); continue;
        }
        if b[i..].starts_with(b"//") { while i < b.len() && b[i] != b'\n' { i += 1; } out.push(' '); continue; }
        if b[i..].starts_with(b"/*") {
            let (Some(after), _) = find_blk_comment_close(LanguageId::TypeScript, b, i + 2, 1) else { break; };
            for &ch in &b[i + 2..after] { if ch == b'\n' { js.on_newline(LanguageId::TypeScript); if mode != 0 { out.push('\n'); } } }
            out.push(' '); i = after; continue;
        }
        js.step_byte(LanguageId::TypeScript, b, &mut i); out.push_str(&raw[prev..i]);
    }
    out
}
