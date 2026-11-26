use aice_lang_registry::LanguageId;

use crate::r5::snippet_blk::find_blk_comment_close;
use crate::r5::snippet_container::{PrefixContainer, classify_prefix_container_with_openers};
use crate::r5::snippet_ts_gen_chk::is_valid_ts_type_param_head;
use crate::r5::snippet_ts_hdr::{
    is_only_ts_modifiers, peel_ts_method_modifiers, strip_leading_ts_decorators, strip_trailing_angles,
};
fn find_matching_lparen(b: &[u8], rp: usize) -> Option<usize> {
    let (mut k, mut pd, mut bd, mut cd) = (rp, 1usize, 0usize, 0usize);
    while k > 0 { k -= 1; match b[k] {
        b')' => pd += 1, b'(' => { pd = pd.saturating_sub(1); if pd == 0 && bd == 0 && cd == 0 { return Some(k); } }
        b']' => bd += 1, b'[' => bd = bd.saturating_sub(1), b'}' => cd += 1, b'{' => cd = cd.saturating_sub(1), _ => {}
    } }
    None
}
fn step_delim_fwd(b: &[u8], i: &mut usize, pd: &mut usize, bd: &mut usize, cd: &mut usize, ad: &mut usize) {
    if b[*i] >= 0x80 { *i += 1; while *i < b.len() && (b[*i] & 0xC0) == 0x80 { *i += 1; } return; }
    match b[*i] {
        b'(' => *pd += 1, b')' => *pd = pd.saturating_sub(1), b'[' => *bd += 1, b']' => *bd = bd.saturating_sub(1),
        b'{' => *cd += 1, b'}' => *cd = cd.saturating_sub(1),
        b'<' if *pd == 0 && *bd == 0 && *cd == 0 => { if b.get(*i + 1) == Some(&b'=') { *i += 2; return; } *ad += 1; }
        b'>' if *pd == 0 && *bd == 0 && *cd == 0 && (*i == 0 || !matches!(b[*i - 1], b'-' | b'=')) => *ad = ad.saturating_sub(1),
        _ => {}
    }
    *i += 1;
}
fn match_close_fwd(b: &[u8]) -> Option<usize> {
    let (mut i, mut pd, mut bd, mut cd, mut ad) = (0usize, 0usize, 0usize, 0usize, 0usize);
    while i < b.len() { step_delim_fwd(b, &mut i, &mut pd, &mut bd, &mut cd, &mut ad); if pd == 0 && bd == 0 && cd == 0 && ad == 0 { return Some(i); } }
    None
}
pub(crate) fn is_ts_generic_arrow_lbrace(arg: &str) -> bool {
    let (mut unwrapped, is_id, mut cur) = (false, |c: u8| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$'), arg.trim_end());
    while cur.ends_with(')') {
        let Some(p) = find_matching_lparen(cur.as_bytes(), cur.len() - 1) else { return false; };
        unwrapped = true;
        let head = strip_trailing_angles(cur[..p].trim_end()).trim_end();
        if let Some(prev_arrow) = head.strip_suffix("=>") { cur = prev_arrow.trim_end(); continue; }
        cur = head; break;
    }
    if !unwrapped { return false; }
    let mut h = cur.trim();
    for kw in ["new", "abstract"] { if let Some(rest) = h.strip_suffix(kw) && rest.bytes().next_back().is_none_or(|c| !is_id(c)) { h = rest.trim_end(); } }
    if h.is_empty() || (h.ends_with(['&', '|']) && !h.ends_with("&&") && !h.ends_with("||")) { return true; }
    if h.ends_with(['?', ':']) { return h.split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).any(|w| w == "extends"); }
    if h.ends_with("extends") && h[..h.len() - 7].bytes().next_back().is_none_or(|c| !is_id(c)) {
        return !h[..h.len() - 7].contains('\n') || is_valid_ts_type_param_head(&h[..h.len() - 7]);
    }
    let hb = h.as_bytes();
    hb.last() == Some(&b'=') && !hb.len().checked_sub(2).is_some_and(|k| matches!(hb[k], b'=' | b'!' | b'<' | b'>')) && is_valid_ts_type_param_head(&h[..h.len() - 1])
}
pub(crate) fn is_ts_ret_obj_lbrace(pre: &str) -> bool {
    let b = pre.as_bytes();
    let (mut j, mut pd, mut bd, mut cd, mut ad, mut needed_q, mut rp) = (b.len(), 0usize, 0usize, 0usize, 0usize, 0usize, None);
    while j > 0 {
        j -= 1;
        match b[j] {
            b')' => pd += 1, b'(' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => return false, b'(' => pd -= 1,
            b']' => bd += 1, b'[' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => return false, b'[' => bd -= 1,
            b'}' => cd += 1, b'{' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => return false, b'{' => cd -= 1,
            b'>' if pd == 0 && bd == 0 && cd == 0 && (j == 0 || !matches!(b[j - 1], b'-' | b'=')) => ad += 1,
            b'<' if pd == 0 && bd == 0 && cd == 0 && !matches!(b.get(j + 1), Some(b'=' | b'<')) => { if ad == 0 { return false; } ad -= 1; }
            _ if pd == 0 && bd == 0 && cd == 0 && ad == 0 => match b[j] {
                b';' | b',' => return false,
                b'=' if !matches!(b.get(j + 1), Some(b'=' | b'>')) && (j == 0 || !matches!(b[j - 1], b'=' | b'!' | b'<' | b'>')) => return false,
                b'?' => { if needed_q == 0 { return false; } needed_q -= 1; }
                b':' if b.get(j + 1) != Some(&b':') && (j == 0 || b[j - 1] != b':') => {
                    let lhs = pre[..j].trim_end();
                    if needed_q == 0 && lhs.ends_with(')') { rp = Some(lhs.len() - 1); break; }
                    needed_q += 1;
                }
                _ => {}
            },
            _ => {}
        }
    }
    let Some(lp_pos) = rp.and_then(|rp_pos| find_matching_lparen(b, rp_pos)) else { return false; };
    let (mut m, mut pd, mut bd, mut cd, mut ad, mut cut) = (lp_pos, 0usize, 0usize, 0usize, 0usize, 0usize);
    while m > 0 {
        m -= 1;
        match b[m] {
            b')' => pd += 1, b'(' => pd = pd.saturating_sub(1), b']' => bd += 1, b'[' => bd = bd.saturating_sub(1),
            b'}' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => { cut = m + 1; break; } b'}' => cd += 1, b'{' => cd = cd.saturating_sub(1),
            b'>' if pd == 0 && bd == 0 && cd == 0 && (m == 0 || !matches!(b[m - 1], b'-' | b'=')) => ad += 1,
            b'<' if pd == 0 && bd == 0 && cd == 0 && !matches!(b.get(m + 1), Some(b'=' | b'<')) => ad = ad.saturating_sub(1),
            b';' | b',' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => { cut = m + 1; break; }
            b'?' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => return false,
            b'\n' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => {
                let prev = pre[..m].rsplit('\n').next().unwrap_or("").trim();
                let dec = strip_leading_ts_decorators(prev);
                let incomplete = prev.is_empty() || dec.is_empty() || is_only_ts_modifiers(dec, true)
                    || prev.ends_with(['=', '+', '-', '*', '/', '%', '&', '|', '^', '?', ':', ',', '(', '[', '<', '.'])
                    || prev.ends_with("=>") || crate::r5::snippet_ts_gen_ctx::ends_with_ts_cont_kw(prev, true);
                if !incomplete { cut = m + 1; break; }
            }
            _ => {}
        }
    }
    !matches!(pre[cut..lp_pos].trim().split(|c: char| !c.is_ascii_alphanumeric() && c != '_').find(|w| !w.is_empty()), Some("case" | "default"))
}
pub(crate) fn raw_rbrace_keeps_method_lp(raw_seg: &str, rbrace_pos: usize) -> bool {
    let (b, mut i) = (raw_seg.as_bytes(), rbrace_pos + 1);
    while i < b.len() {
        if b[i].is_ascii_whitespace() { i += 1; continue; }
        if b[i..].starts_with(b"//") { while i < b.len() && b[i] != b'\n' { i += 1; } continue; }
        if b[i..].starts_with(b"/*") { let (Some(a), _) = find_blk_comment_close(LanguageId::TypeScript, b, i + 2, 1) else { return false; }; i = a; continue; }
        return matches!(b[i], b'&' | b'|' | b'?' | b':');
    }
    true
}
fn peel_class_member(hdr: &str) -> &str {
    let t = crate::r5::snippet_ts_cls::ts_class_member_tail(hdr, hdr).0;
    let pre = hdr[..hdr.len() - t.len()].trim_end();
    if pre.ends_with(['=', ':', '?', '|', '&', '+', '-', '*', '/', '%', ',']) || pre.ends_with("=>") { hdr } else { t }
}
pub(crate) fn is_ts_js_missing_arrow_fn_hdr(hdr: &str) -> bool { is_ts_js_missing_arrow_fn_hdr_in_ctx(hdr, false, false) }
fn is_ts_js_missing_arrow_fn_hdr_in_ctx(hdr: &str, in_cls: bool, in_obj: bool) -> bool {
    let seg_tail = if in_cls || in_obj { peel_class_member(hdr) } else { hdr };
    let seg_raw = crate::r5::snippet_ts_type::tail_after_depth0_comma(seg_tail).trim();
    let seg = crate::r5::snippet_ts_gen_ctx::isolate_asi_tail_before_lt(seg_raw, true, crate::r5::snippet_ts_gen_ctx::TsGenMemberCtx::None).trim();
    if seg.is_empty() || seg.ends_with("=>") { return false; }
    let (b, mut i, mut pd, mut bd, mut cd, mut ad, mut qd) = (seg.as_bytes(), 0, 0, 0, 0, 0, 0usize);
    let (mut eq_pos, mut kw_pos, mut colon_pos, is_id) = (None, None, None, |c: u8| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$'));
    while i < b.len() {
        if pd == 0 && bd == 0 && cd == 0 && ad == 0 {
            if b[i] == b'=' && !matches!(i.checked_sub(1).and_then(|k| b.get(k)).copied(), Some(b'=' | b'!' | b'<' | b'>')) && !matches!(b.get(i + 1).copied(), Some(b'=' | b'>')) {
                eq_pos = Some(i);
            } else if b[i] == b'?' {
                if !b[i + 1..].iter().find(|c| !c.is_ascii_whitespace()).is_some_and(|&c| c == b':') { qd += 1; }
            } else if b[i] == b':' && b.get(i + 1) != Some(&b':') {
                if qd > 0 { qd -= 1; } else if colon_pos.is_none() {
                    let pre = seg[..i].trim_end();
                    let first_w = pre.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').find(|w| !w.is_empty());
                    if !pre.ends_with(')') && !matches!(first_w, Some("case" | "default")) { colon_pos = Some(i); }
                }
            } else if matches!(b[i], b'r' | b'y' | b'a' | b't' | b'e')
                && (i == 0 || !is_id(b[i - 1])) && !seg[..i].trim_end().ends_with('.') {
                for kw in ["return", "yield", "await", "throw"] {
                    let kl = kw.len();
                    let prev_for = kw == "await" && seg[..i].trim_end().rsplit(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next() == Some("for");
                    if !prev_for && b[i..].starts_with(kw.as_bytes())
                        && b.get(i + kl).is_some_and(|&c| c.is_ascii_whitespace() || matches!(c, b'(' | b'<') || (kw == "yield" && c == b'*'))
                    {
                        let (mut ke, mut no_m) = (i + kl, false);
                        if kw == "yield" { let mut j = ke; while j < b.len() && b[j].is_ascii_whitespace() { j += 1; } if b.get(j) == Some(&b'*') { ke = j + 1; no_m = true; } }
                        kw_pos = Some((i, ke, no_m)); break;
                    }
                }
                if b[i..].starts_with(b"export") && b.get(i + 6).is_some_and(u8::is_ascii_whitespace) {
                    let mut j = i + 6;
                    while j < b.len() && b[j].is_ascii_whitespace() { j += 1; }
                    if b[j..].starts_with(b"default") && b.get(j + 7).is_some_and(|c| c.is_ascii_whitespace() || matches!(c, b'(' | b'<')) { kw_pos = Some((i, j + 7, true)); }
                }
            }
        }
        step_delim_fwd(b, &mut i, &mut pd, &mut bd, &mut cd, &mut ad);
    }
    let best_ec = eq_pos.into_iter().chain(colon_pos).max().map(|p| p + 1);
    let (start, kw_info) = match (best_ec, kw_pos) {
        (Some(ec), Some((ks, ke, ed))) if ke > ec => (ke, Some((ks, ed))), (Some(ec), _) => (ec, None),
        (None, Some((ks, ke, ed))) => (ke, Some((ks, ed))), (None, None) => return false,
    };
    let mut fn_start = seg[start..].trim();
    if (in_cls || in_obj) && best_ec.is_none() && let Some((ks, false)) = kw_info {
        let pre_kw = strip_leading_ts_decorators(seg[..ks].trim()).trim();
        if (pre_kw.is_empty() || is_only_ts_modifiers(pre_kw, in_cls)) && fn_start.starts_with(['(', '<']) { return false; }
    }
    let mut saw_arrow = false;
    loop {
        if let Some(rest) = fn_start.strip_prefix("async") && rest.bytes().next().is_some_and(|c| c.is_ascii_whitespace() || matches!(c, b'(' | b'<')) {
            fn_start = rest.trim_start();
        }
        if fn_start.starts_with('<') && let Some(end) = match_close_fwd(fn_start.as_bytes()) { fn_start = fn_start[end..].trim_start(); }
        if !fn_start.starts_with('(') {
            let id_len = fn_start.bytes().take_while(|c| is_id(*c)).count();
            let id = &fn_start[..id_len];
            if !crate::r5::snippet_ts_gen_ctx::is_valid_ts_ident(id) || matches!(
                id, "new" | "typeof" | "void" | "delete" | "await" | "yield" | "return" | "throw" | "in" | "instanceof"
                    | "class" | "function" | "if" | "for" | "while" | "switch" | "catch" | "else" | "case" | "default"
                    | "extends" | "implements" | "as" | "satisfies" | "import" | "export"
            ) { return false; }
            let after_id = fn_start[id_len..].trim_start();
            if let Some(next_rhs) = after_id.strip_prefix("=>") { saw_arrow = true; fn_start = next_rhs.trim_start(); continue; }
            return saw_arrow && after_id.is_empty();
        }
        let Some(end) = match_close_fwd(fn_start.as_bytes()) else { return false; };
        let after_rp = fn_start[end..].trim_start();
        if after_rp.is_empty() { return true; }
        if let Some(next_rhs) = after_rp.strip_prefix("=>") { saw_arrow = true; fn_start = next_rhs.trim_start(); continue; }
        if !after_rp.starts_with(':') || after_rp.starts_with("::") { return false; }
        let (ab, mut j, mut pd, mut bd, mut cd, mut ad) = (after_rp.as_bytes(), 0, 0, 0, 0, 0);
        while j < ab.len() { step_delim_fwd(ab, &mut j, &mut pd, &mut bd, &mut cd, &mut ad); }
        let post = after_rp[1..].trim();
        return pd == 0 && bd == 0 && cd == 0 && ad == 0 && !post.is_empty()
            && !post.ends_with(['=', '?', ':', '|', '&', '<', ',', '(', '[']) && !post.ends_with("=>")
            && !crate::r5::snippet_ts_gen_ctx::ends_with_ts_cont_kw(post, true);
    }
}
fn js_clean_with_map(lang: LanguageId, s: &str) -> (String, Vec<usize>) {
    use crate::r5::snippet_lit::{JsLexState, StepQuote};
    let (b, mut i, mut js, mut out, mut map) = (s.as_bytes(), 0usize, JsLexState::new(), String::with_capacity(s.len()), Vec::with_capacity(s.len()));
    while i < b.len() {
        let p = i;
        if b[i] == b'\n' { js.on_newline(lang); out.push('\n'); map.push(p); i += 1; continue; }
        match js.step_quote(lang, b, &mut i) {
            StepQuote::Consumed => { out.push(' '); map.push(p); continue; }
            StepQuote::EnteredInterp => { out.push_str("${"); map.extend([p, p]); continue; }
            StepQuote::NotInQuote => {}
        }
        if js.open_quote(lang, b, &mut i) { out.push(' '); map.push(p); continue; }
        if let Some((end, _)) = js.match_special(lang, b, i) { out.push(' '); map.push(p); i = end; continue; }
        if b[i..].starts_with(b"//") { while i < b.len() && b[i] != b'\n' { i += 1; } out.push(' '); map.push(p); continue; }
        if b[i..].starts_with(b"/*") { let (Some(a), _) = find_blk_comment_close(lang, b, i + 2, 1) else { break; }; out.push(' '); map.push(p); i = a; continue; }
        js.step_byte(lang, b, &mut i);
        out.push_str(&s[p..i]); map.extend(p..i);
    }
    (out, map)
}
fn slice_inner_opener_hdr(lang: LanguageId, span: &str) -> String {
    let (clean, map) = js_clean_with_map(lang, span);
    let (b, mut pd, mut bd, mut cd, mut cut) = (clean.as_bytes(), 0usize, 0usize, 0usize, 0usize);
    for i in 0..b.len().saturating_sub(1) { match b[i] {
        b'(' => pd += 1, b')' => pd = pd.saturating_sub(1), b'[' => bd += 1, b']' => bd = bd.saturating_sub(1), b'{' => cd += 1,
        b'}' => { cd = cd.saturating_sub(1); if pd == 0 && bd == 0 && cd == 0 && !crate::r5::snippet_hdr::starts_with_js_cont(&clean[i + 1..]) { cut = i + 1; } }
        b';' if pd == 0 && bd == 0 && cd == 0 => cut = i + 1,
        b'\n' if pd == 0 && bd == 0 && cd == 0 => {
            let (prev, next) = (clean[cut..i].trim(), clean[i + 1..].trim_start());
            let p_cont = prev.ends_with(['=', '+', '-', '*', '/', '%', '&', '|', '^', '!', '?', ':', ',', '(', '[', '<', '.', '{'])
                || prev.ends_with("=>") || crate::r5::snippet_ts_gen_ctx::ends_with_ts_cont_kw(prev, true);
            let n_cont = next.starts_with(['{', '(', '[', '.', '?', ':', '|', '&']) || next.starts_with("=>")
                || crate::r5::snippet_hdr::starts_with_js_cont(next);
            if prev.is_empty() || (!p_cont && !n_cont) { cut = i + 1; }
        }
        _ => {}
    } }
    let off = clean[cut..].find(|c: char| !c.is_whitespace()).map_or(cut, |d| cut + d);
    map.get(off).and_then(|&rs| span.get(rs..)).unwrap_or(span).trim().to_string()
}
fn extract_ts_kw_method_hdr(lang: LanguageId, raw: &str, class_mods: bool) -> Option<String> {
    let (clean, map) = js_clean_with_map(lang, raw);
    let trimmed = crate::r5::snippet_hdr::trim_after_last_sep(&clean).trim();
    let t = if class_mods { peel_class_member(trimmed) } else { crate::r5::snippet_ts_type::tail_after_depth0_comma(peel_class_member(trimmed)).trim() };
    let seg = strip_leading_ts_decorators(t).trim();
    let after_mods = peel_ts_method_modifiers(seg, class_mods);
    let id_len = after_mods.bytes().take_while(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$')).count();
    if !matches!(&after_mods[..id_len], "new" | "typeof" | "void" | "delete" | "await" | "yield" | "return" | "throw" | "if" | "for" | "while" | "switch" | "catch") { return None; }
    let mut rest = after_mods[id_len..].trim_start();
    if rest.starts_with('<') { rest = rest[match_close_fwd(rest.as_bytes())?..].trim_start(); }
    if !rest.starts_with('(') { return None; }
    let post = rest[match_close_fwd(rest.as_bytes())?..].trim();
    let seg_off = seg.as_ptr() as usize - clean.as_ptr() as usize;
    let raw_seg = map.get(seg_off).and_then(|&rs| raw.get(rs..)).unwrap_or(seg);
    (post.is_empty() || (post.starts_with(':') && !post[1..].trim().is_empty())).then(|| format!("{raw_seg} {{"))
}
pub(crate) fn ts_kw_method_probe_ctx(lang: LanguageId, joined: &str, openers: &[(u8, usize, usize)]) -> Option<Vec<String>> {
    if !crate::r5::snippet_js_lex::is_js_like(lang) { return None; }
    for k in (0..openers.len()).rev() {
        if openers[k].0 != b'{' { continue; }
        let class_mods = match classify_prefix_container_with_openers(lang, joined, &openers[..k]) {
            PrefixContainer::ClassOrTraitBody => true, PrefixContainer::ValueBrace => false, _ => continue,
        };
        let start = k.checked_sub(1).map_or(0, |p| openers[p].2 + 1);
        if let Some(m_hdr) = extract_ts_kw_method_hdr(lang, joined.get(start..openers[k].2)?, class_mods) {
            let mut out = vec![if class_mods { "class _C {" } else { "const _v = {" }.to_string(), m_hdr];
            for j in (k + 1)..openers.len() { out.push(slice_inner_opener_hdr(lang, &joined[openers[j - 1].2 + 1..=openers[j].2])); }
            return Some(out);
        }
    }
    None
}
pub(crate) fn is_ts_unrecoverable_missing_arrow_group(lang: LanguageId, hdr: &[&str]) -> bool { is_ts_unrecoverable_missing_arrow_group_ctx(lang, hdr, None) }
pub(crate) fn is_ts_unrecoverable_missing_arrow_group_at(lang: LanguageId, joined: &str, openers: &[(u8, usize, usize)], op_idx: usize, hdr: &[&str]) -> bool {
    is_ts_unrecoverable_missing_arrow_group_ctx(lang, hdr, Some(classify_prefix_container_with_openers(lang, joined, &openers[..op_idx])))
}
fn is_ts_unrecoverable_missing_arrow_group_ctx(lang: LanguageId, hdr: &[&str], parent: Option<PrefixContainer>) -> bool {
    if !crate::r5::snippet_js_lex::is_js_like(lang) { return false; }
    let clean = crate::r5::snippet_synth::strip_comments_strings(lang, &hdr.join("\n"), true);
    let (in_cls, in_obj) = (parent == Some(PrefixContainer::ClassOrTraitBody), parent == Some(PrefixContainer::ValueBrace));
    crate::r5::snippet_ts_ret::unclosed_delim_positions(&clean).into_iter().any(|(d, pos)| {
        d == b'{' && is_ts_js_missing_arrow_fn_hdr_in_ctx(crate::r5::snippet_hdr::trim_after_last_sep(&clean[..pos]).trim(), in_cls, in_obj)
    })
}
