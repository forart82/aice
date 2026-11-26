use aice_lang_registry::LanguageId;

use crate::r5::snippet_blk::find_blk_comment_close;
use crate::r5::snippet_container::{PrefixContainer, classify_prefix_container_with_openers};
use crate::r5::snippet_hdr::trim_after_last_sep;
use crate::r5::snippet_js_lex::{JsLexState, StepQuote};
use crate::r5::snippet_synth::strip_comments_strings;
use crate::r5::snippet_ts_cast::has_matching_open_bracket_at_end;
use crate::r5::snippet_ts_gen_ambig::ts_ambig_brace_head;
use crate::r5::snippet_ts_gen_chk::is_ts_asi_frame_reset;
use crate::r5::snippet_ts_gen_close::ts_refine_body_signals;
use crate::r5::snippet_ts_gen_ctx::{TsGenMemberCtx, is_valid_ts_ident, isolate_asi_tail_before_lt};
use crate::r5::snippet_ts_hdr::{is_balanced_computed_prop, peel_ts_method_modifiers, strip_leading_ts_decorators};
use crate::r5::snippet_ts_type::tail_after_depth0_comma;
use crate::r5::snippet_type_body::TB_IFACE;

fn is_empty_paren_after(lang: LanguageId, b: &[u8], mut j: usize) -> bool {
    let skip = |p: &mut usize| -> bool {
        while *p < b.len() {
            if b[*p].is_ascii_whitespace() { *p += 1; }
            else if b[*p..].starts_with(b"//") { while *p < b.len() && b[*p] != b'\n' { *p += 1; } }
            else if b[*p..].starts_with(b"/*") { let Some(a) = find_blk_comment_close(lang, b, *p + 2, 1).0 else { return false; }; *p = a; }
            else { break; }
        }
        true
    };
    skip(&mut j) && b.get(j) == Some(&b'(') && skip(&mut { j += 1; j }) && b.get(j) == Some(&b')')
}

fn quoted_key_before_colon(lang: LanguageId, s: &str, allow_case: bool) -> (u8, bool, bool) {
    let (b, mut i, mut js, mut prev_tok, mut last_tok) = (s.as_bytes(), 0usize, JsLexState::new(), 0u8, 0u8);
    let (mut pd, mut bd, mut cd, mut qd, mut pre_q_tok) = (0usize, 0usize, 0usize, 0usize, 0u8);
    let (mut tern_colon, mut is_opt_colon, mut in_case, mut saw_rp_colon) = (false, false, false, false);
    let is_id = |c: u8| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$');
    while i < b.len() {
        if b[i] == b'\n' { js.on_newline(lang); i += 1; continue; }
        let prev = i;
        match js.step_quote(lang, b, &mut i) {
            StepQuote::Consumed => { if !js.has_open_quote() { last_tok = if matches!(b[prev], b'`') { b'`' } else { b'"' }; } continue; }
            StepQuote::EnteredInterp => { last_tok = b'$'; continue; }
            StepQuote::NotInQuote => {}
        }
        if js.open_quote(lang, b, &mut i) { continue; }
        if let Some((end, _)) = js.match_special(lang, b, i) { last_tok = b'r'; i = end; continue; }
        if b[i..].starts_with(b"//") { while i < b.len() && b[i] != b'\n' { i += 1; } continue; }
        if b[i..].starts_with(b"/*") { let (Some(a), _) = find_blk_comment_close(lang, b, i + 2, 1) else { break; }; i = a; continue; }
        js.step_byte(lang, b, &mut i);
        if !js.has_open_quote() {
            if allow_case && pd == 0 && bd == 0 && cd == 0 && last_tok != b'.'
                && (prev == 0 || !is_id(b[prev - 1])) && b[prev..].starts_with(b"case")
                && b.get(prev + 4).is_none_or(|&c| !is_id(c)) && !is_empty_paren_after(lang, b, prev + 4) { in_case = true; }
            match b[prev] {
                b'(' => pd += 1, b')' => pd = pd.saturating_sub(1), b'[' => bd += 1, b']' => bd = bd.saturating_sub(1),
                b'{' => cd += 1, b'}' => { cd = cd.saturating_sub(1); if cd == 0 { in_case = false; } }
                b',' | b';' if pd == 0 && bd == 0 && cd == 0 => { qd = 0; is_opt_colon = false; saw_rp_colon = false; if b[prev] == b';' { in_case = false; } }
                b'?' if pd == 0 && bd == 0 && cd == 0 && !matches!(b.get(prev + 1), Some(b'.' | b'?')) && (prev == 0 || b[prev - 1] != b'?') => {
                    if qd == 0 { pre_q_tok = last_tok; } qd += 1;
                }
                b':' if pd == 0 && bd == 0 && cd == 0 && b.get(prev + 1) != Some(&b':') && (prev == 0 || b[prev - 1] != b':') => {
                    if qd > 0 && last_tok == b'?' {
                        qd -= 1; tern_colon = in_case; is_opt_colon = !in_case;
                        if !in_case { prev_tok = pre_q_tok; } else { in_case = false; }
                    } else if qd > 0 { qd -= 1; tern_colon = true; is_opt_colon = false; }
                    else { tern_colon = in_case; in_case = false; is_opt_colon = false; prev_tok = last_tok; if !tern_colon && last_tok == b')' { saw_rp_colon = true; } }
                }
                _ => {}
            }
            if !b[prev].is_ascii_whitespace() { last_tok = b[prev]; }
        }
    }
    (if last_tok == b':' && !tern_colon { prev_tok } else { 0 }, last_tok == b':' && is_opt_colon, saw_rp_colon)
}

pub(crate) fn is_js_ret_colon_hdr(lang: LanguageId, raw_hdr: &str) -> bool {
    lang == LanguageId::JavaScript && quoted_key_before_colon(lang, raw_hdr, true).2
}

fn is_js_ret_colon_hdr_in(lang: LanguageId, parent: PrefixContainer, raw_hdr: &str) -> bool {
    lang == LanguageId::JavaScript && quoted_key_before_colon(lang, raw_hdr, parent == PrefixContainer::MatchOrSwitch).2
}

pub(crate) fn refine_ts_ambig_brace_ctx(
    lang: LanguageId, cur: PrefixContainer, raw_hdr: &str, body_tail: &str,
) -> PrefixContainer {
    if !crate::r5::snippet_js_lex::is_js_like(lang)
        || !matches!(cur, PrefixContainer::ValueBrace | PrefixContainer::StmtBlock | PrefixContainer::TypeBody(TB_IFACE))
    { return cur; }
    let (qk, is_opt, has_rp_colon) = quoted_key_before_colon(lang, raw_hdr, cur == PrefixContainer::StmtBlock);
    if lang == LanguageId::JavaScript {
        return if qk == b'`' || has_rp_colon || (cur == PrefixContainer::ValueBrace && is_opt) { PrefixContainer::StructLit } else { cur };
    }
    let head = ts_ambig_brace_head(lang, raw_hdr);
    if head.is_none() {
        if qk == b'`' || (cur == PrefixContainer::ValueBrace && is_opt) { return PrefixContainer::StructLit; }
        if cur != PrefixContainer::TypeBody(TB_IFACE) { return cur; }
        let ch = strip_comments_strings(lang, raw_hdr, true);
        let seg = tail_after_depth0_comma(trim_after_last_sep(&ch).trim()).trim();
        let valid_key = !seg.ends_with("?:") && seg.strip_suffix(':').is_some_and(|k| {
            let k = k.trim();
            (qk == b'"' && k.is_empty()) || is_valid_ts_ident(k) || is_balanced_computed_prop(k)
                || (k.as_bytes().first().is_some_and(u8::is_ascii_digit) && k.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'.')))
        });
        if !valid_key { return cur; }
    }
    let (force_val, has_iface, has_obj_expr, has_obj_paren_op, _) = ts_refine_body_signals(lang, body_tail);
    if force_val { return if cur == PrefixContainer::TypeBody(TB_IFACE) { PrefixContainer::ValueBrace } else { cur }; }
    let paren_obj = has_obj_paren_op && head.as_ref().is_none_or(|h| !h.non_ambig_sig && (!h.ambig_sig || (!h.in_v && h.single_l)));
    let is_type_only = head.as_ref().is_some_and(|h| h.is_type_only);
    if !is_type_only && cur == PrefixContainer::TypeBody(TB_IFACE) && (has_obj_expr || paren_obj) && !has_iface { return PrefixContainer::ValueBrace; }
    if head.is_some() && cur != PrefixContainer::TypeBody(TB_IFACE) && has_iface { return PrefixContainer::TypeBody(TB_IFACE); }
    cur
}

pub(crate) fn has_ts_member_val_prefix(s: &str, member_ctx: TsGenMemberCtx) -> bool {
    if member_ctx == TsGenMemberCtx::ObjBrace && s.trim_start().starts_with("...") { return true; }
    let (b, mut i, mut pd, mut bd, mut cd, mut ad, mut saw_q) = (s.as_bytes(), 0usize, 0usize, 0usize, 0usize, 0usize, false);
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1, b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'<' if pd == 0 && bd == 0 && cd == 0 => { if matches!(b.get(i + 1), Some(b'=' | b'<')) { i += 2; continue; } ad += 1; }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => ad = ad.saturating_sub(1),
            b'?' if member_ctx == TsGenMemberCtx::ObjBrace && pd == 0 && bd == 0 && cd == 0 && ad == 0 && b.get(i + 1) != Some(&b'.') => saw_q = true,
            b':' if member_ctx == TsGenMemberCtx::ObjBrace && pd == 0 && bd == 0 && cd == 0 && ad == 0 && b.get(i + 1) != Some(&b':') && (i == 0 || b[i - 1] != b':') => { if saw_q { saw_q = false; } else { return true; } }
            b'=' if pd == 0 && bd == 0 && cd == 0 && ad == 0 && !matches!(i.checked_sub(1).and_then(|k| b.get(k)), Some(b'=' | b'!' | b'<' | b'>')) && !matches!(b.get(i + 1), Some(b'=' | b'>')) => return true,
            _ => {}
        }
        i += 1;
    }
    false
}
fn is_ts_member_computed_prop_tail(pre_asi: &str, member_ctx: TsGenMemberCtx) -> bool {
    is_balanced_computed_prop(peel_ts_method_modifiers(strip_leading_ts_decorators(pre_asi.trim_start()), member_ctx.is_class_or_type()))
}
pub(crate) fn is_ts_member_bracket_callee_ok(pre: &str, member_ctx: TsGenMemberCtx) -> bool {
    if member_ctx == TsGenMemberCtx::None { return has_matching_open_bracket_at_end(pre); }
    let pre_asi = isolate_asi_tail_before_lt(pre, true, member_ctx);
    if has_ts_member_val_prefix(pre_asi, member_ctx) { has_matching_open_bracket_at_end(pre) } else { is_ts_member_computed_prop_tail(pre_asi, member_ctx) }
}
pub(crate) fn starts_with_lt_after_ws_comments(b: &[u8], mut j: usize) -> bool {
    while j < b.len() {
        if b[j].is_ascii_whitespace() { j += 1; }
        else if b[j..].starts_with(b"//") { while j < b.len() && b[j] != b'\n' { j += 1; } }
        else if b[j..].starts_with(b"/*") { let Some(a) = find_blk_comment_close(LanguageId::TypeScript, b, j + 2, 1).0 else { return false; }; j = a; }
        else { return b[j] == b'<'; }
    }
    false
}
pub(crate) fn is_invalid_ts_member_lt_frame(seg: &str, cut: usize, lt_stack: &[(usize, u8, usize, usize, usize)], idx: usize, member_ctx: TsGenMemberCtx) -> bool {
    let (lt, def_k, _, _, _) = lt_stack[idx];
    let (has_def_ext, mut pre_lt, mut nested_def, mut from_comma) = (def_k != 0, seg[cut..lt].trim_end(), false, false);
    if idx > 0 {
        let (between, mut pd, mut bd, mut cd, mut comma) = (&seg[lt_stack[idx - 1].0 + 1..lt], 0usize, 0usize, 0usize, None);
        for (k, &c) in between.as_bytes().iter().enumerate() {
            match c { b'(' => pd += 1, b')' => pd = pd.saturating_sub(1), b'[' => bd += 1, b']' => bd = bd.saturating_sub(1), b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1), b',' if pd == 0 && bd == 0 && cd == 0 => comma = Some(k), _ => {} }
        }
        if let Some(k) = comma { pre_lt = between[k + 1..].trim_end(); from_comma = true; } else if lt_stack[idx - 1].1 != 0 { nested_def = true; }
    }
    if nested_def { return false; }
    if idx > 0 && from_comma && lt_stack[idx - 1].1 == 0 {
        let outer_pre = if idx == 1 { seg[cut..lt_stack[0].0].trim_end() } else {
            let b2 = &seg[lt_stack[idx - 2].0 + 1..lt_stack[idx - 1].0];
            b2.rfind(',').map_or(b2, |k| &b2[k + 1..]).trim_end()
        };
        if crate::r5::snippet_ts_gen::is_ts_generic_decl_head(outer_pre, member_ctx) { return true; }
    }
    if member_ctx != TsGenMemberCtx::None && pre_lt.ends_with([')', ']']) {
        let pre_asi = isolate_asi_tail_before_lt(pre_lt, true, member_ctx);
        if has_ts_member_val_prefix(pre_asi, member_ctx) { return false; }
        return pre_lt.ends_with(')') || !is_ts_member_computed_prop_tail(pre_asi, member_ctx) || !has_def_ext;
    }
    let after_lt = seg[lt + 1..].trim();
    ((idx + 1 == lt_stack.len() && (after_lt.ends_with(',') || after_lt.is_empty())) || idx + 1 < lt_stack.len())
        && !has_def_ext && crate::r5::snippet_ts_gen::is_ts_generic_decl_head(pre_lt, member_ctx)
}
pub(crate) fn is_js_member_lt_hdr(lang: LanguageId, p: PrefixContainer, raw_seg: &str) -> bool {
    if lang != LanguageId::JavaScript { return false; }
    let member_ctx = match p { PrefixContainer::TypeBody(TB_IFACE) => TsGenMemberCtx::IfaceType, PrefixContainer::ClassOrTraitBody | PrefixContainer::TypeBody(_) => TsGenMemberCtx::ClassOrType, PrefixContainer::ValueBrace => TsGenMemberCtx::ObjBrace, _ => return false };
    let clean = strip_comments_strings(lang, raw_seg, true);
    let tail = trim_after_last_sep(&clean).trim();
    let (b, mut i, mut pd, mut bd, mut cd, mut cut, mut first_lt) = (tail.as_bytes(), 0usize, 0usize, 0usize, 0usize, 0usize, None);
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1), b'[' => bd += 1, b']' => bd = bd.saturating_sub(1), b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'\n' if pd == 0 && bd == 0 && cd == 0 && is_ts_asi_frame_reset(&tail[cut..i], &tail[i + 1..], member_ctx) => { cut = i + 1; first_lt = None; }
            b',' if pd == 0 && bd == 0 && cd == 0 => { cut = i + 1; first_lt = None; }
            b'<' if pd == 0 && bd == 0 && cd == 0 => {
                if matches!(b.get(i + 1), Some(b'=' | b'<')) { i += 2; continue; }
                if first_lt.is_none() { first_lt = Some(i); }
            }
            _ => {}
        }
        i += 1;
    }
    first_lt.is_some_and(|lt| !has_ts_member_val_prefix(isolate_asi_tail_before_lt(tail[cut..lt].trim_end(), true, member_ctx), member_ctx))
}

fn last_depth0_sep(s: &str, want: u8) -> Option<usize> {
    let (b, mut i, mut pd, mut bd, mut cd, mut ad, mut res) = (s.as_bytes(), 0usize, 0usize, 0usize, 0usize, 0usize, None);
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1), b'[' => bd += 1, b']' => bd = bd.saturating_sub(1), b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'<' if pd == 0 && bd == 0 && cd == 0 => { if matches!(b.get(i + 1), Some(b'=' | b'<')) { i += 2; continue; } ad += 1; }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => ad = ad.saturating_sub(1),
            b':' if want == b':' && pd == 0 && bd == 0 && cd == 0 && ad == 0 && b.get(i + 1) != Some(&b':') && (i == 0 || b[i - 1] != b':') => res = Some(i),
            b'=' if want == b'=' && pd == 0 && bd == 0 && cd == 0 && ad == 0 && !matches!(i.checked_sub(1).and_then(|k| b.get(k)), Some(b'=' | b'!' | b'<' | b'>')) && !matches!(b.get(i + 1), Some(b'=' | b'>')) => res = Some(i),
            _ => {}
        }
        i += 1;
    }
    res
}
fn bad_kw_lt_rhs(rhs: &str, is_val_rhs: bool, after_colon: bool, class_mods: bool) -> bool {
    let slice = if !is_val_rhs && after_colon {
        let (b, mut j, mut cut, mut ad, mut cd) = (rhs.as_bytes(), 0usize, 0usize, 0usize, 0usize);
        while j < b.len() {
            match b[j] {
                b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
                b'<' if cd == 0 => { if matches!(b.get(j + 1), Some(b'=' | b'<')) { j += 2; continue; } ad += 1; }
                b'>' if cd == 0 && (j == 0 || !matches!(b[j - 1], b'-' | b'=')) => ad = ad.saturating_sub(1),
                b'=' if cd == 0 && ad == 0 && b.get(j + 1) == Some(&b'>') => { cut = j + 2; j += 2; continue; }
                b'|' | b'&' | b'(' | b'[' | b',' | b'?' | b':' if cd == 0 && ad == 0 => cut = j + 1,
                _ => {}
            }
            j += 1;
        }
        &rhs[cut..]
    } else { rhs };
    let body = if is_val_rhs || after_colon { slice.trim_start() } else { peel_ts_method_modifiers(slice.trim_start(), class_mods) };
    let mut ws = body.split_whitespace();
    let Some(first) = ws.next() else { return false; };
    if is_val_rhs { return (matches!(first, "type" | "interface" | "declare") && ws.next().is_some()) || (first == "abstract" && ws.next() == Some("class")); }
    first == "function*" || (after_colon && matches!(first, "function" | "class" | "async"))
        || (!after_colon && matches!(first, "function" | "class") && ws.next().is_some())
        || (matches!(first, "type" | "interface" | "declare") && ws.next().is_some())
        || (first == "abstract" && ws.next() == Some("class"))
}
pub(crate) fn is_unrec_ts_op_or_js_ret_at(lang: LanguageId, joined: &str, openers: &[(u8, usize, usize)], op_idx: usize) -> bool {
    if !crate::r5::snippet_js_lex::is_js_like(lang) { return false; }
    let p = classify_prefix_container_with_openers(lang, joined, &openers[..op_idx]);
    let start = op_idx.checked_sub(1).map_or(0, |k| openers[k].2 + 1);
    let raw_seg = joined.get(start..openers[op_idx].2).unwrap_or("");
    if crate::r5::snippet_ts_gen_chk::is_js_invalid_iface_hdr_in(lang, &[raw_seg], p == PrefixContainer::ClassOrTraitBody) { return true; }
    if is_js_ret_colon_hdr_in(lang, p, raw_seg) || is_js_member_lt_hdr(lang, p, raw_seg) { return true; }
    let cls_or_type = matches!(p, PrefixContainer::ClassOrTraitBody | PrefixContainer::TypeBody(_));
    if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx) {
        let m_ctx = match p { PrefixContainer::TypeBody(TB_IFACE) => TsGenMemberCtx::IfaceType, PrefixContainer::ClassOrTraitBody | PrefixContainer::TypeBody(_) => TsGenMemberCtx::ClassOrType, PrefixContainer::ValueBrace => TsGenMemberCtx::ObjBrace, _ => TsGenMemberCtx::None };
        let ch = if raw_seg.contains(['"', '\'', '`', '/']) { crate::r5::snippet_ts_cls::clean_ts_preserving_quoted_method_lt(raw_seg, m_ctx) } else { strip_comments_strings(lang, raw_seg, true) };
        let tail = trim_after_last_sep(&ch).trim();
        if matches!(p, PrefixContainer::TopLevel | PrefixContainer::StmtBlock) && crate::r5::snippet_ts_gen_ambig::has_invalid_ts_multiline_asi_lt(tail) { return true; }
        if matches!(p, PrefixContainer::ClassOrTraitBody | PrefixContainer::TypeBody(TB_IFACE) | PrefixContainer::ValueBrace) {
            let t_tail = tail_after_depth0_comma(tail).trim();
            let ms = if p == PrefixContainer::ValueBrace { t_tail } else { crate::r5::snippet_ts_cls::ts_class_member_tail(t_tail, raw_seg).0 };
            if p != PrefixContainer::TypeBody(TB_IFACE) && ms.trim_start().starts_with('<')
                && crate::r5::snippet_ts_gen::is_ts_unclosed_generic_type_ctx(ms.trim_start(), TsGenMemberCtx::None, false, false) { return true; }
            let (mb, mut mi, mut pd, mut bd, mut cd, mut lts) = (ms.as_bytes(), 0usize, 0usize, 0usize, 0usize, Vec::new());
            while mi < mb.len() {
                match mb[mi] {
                    b'(' => pd += 1, b')' => pd = pd.saturating_sub(1), b'[' => bd += 1, b']' => bd = bd.saturating_sub(1), b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
                    b'<' if pd == 0 && bd == 0 && cd == 0 => { if matches!(mb.get(mi + 1), Some(b'=' | b'<')) { mi += 2; continue; } lts.push(mi); }
                    b'>' if pd == 0 && bd == 0 && cd == 0 && (mi == 0 || !matches!(mb[mi - 1], b'-' | b'=')) => { lts.pop(); }
                    _ => {}
                }
                mi += 1;
            }
            if let Some(&lt) = lts.first() {
                let pre_lt = &ms[..lt];
                if let Some(eq) = last_depth0_sep(pre_lt, b'=') { if bad_kw_lt_rhs(&pre_lt[eq + 1..], true, false, false) { return true; } }
                else if let Some(col) = last_depth0_sep(pre_lt, b':') { if bad_kw_lt_rhs(&pre_lt[col + 1..], p == PrefixContainer::ValueBrace, true, p != PrefixContainer::ValueBrace) { return true; } }
                else if bad_kw_lt_rhs(strip_leading_ts_decorators(pre_lt.trim_start()), false, false, p != PrefixContainer::ValueBrace) { return true; }
            }
        }
    }
    (cls_or_type || p == PrefixContainer::ValueBrace)
        && (crate::r5::snippet_ts_cls::is_ts_invalid_op_method_hdr(raw_seg, cls_or_type)
            || (lang == LanguageId::JavaScript && crate::r5::snippet_ts_cls::is_js_opt_method_hdr(raw_seg, cls_or_type)))
}

pub(crate) fn is_unrec_ts_op_or_js_ret_opener(lang: LanguageId, joined: &str, openers: &[(u8, usize, usize)], op_line: usize) -> bool {
    crate::r5::snippet_js_lex::is_js_like(lang)
        && openers.iter().enumerate().any(|(idx, &(d, l, _))| l == op_line && d == b'{' && is_unrec_ts_op_or_js_ret_at(lang, joined, openers, idx))
}