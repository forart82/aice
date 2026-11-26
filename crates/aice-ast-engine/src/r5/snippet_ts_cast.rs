use aice_lang_registry::LanguageId;

use crate::r5::snippet_container::{PrefixContainer, classify_prefix_container_with_openers};
use crate::r5::snippet_hdr::trim_after_last_sep;
use crate::r5::snippet_synth::strip_comments_strings;
use crate::r5::snippet_ts_gen_chk::{has_depth0_assign_or_type_colon, is_ts_asi_frame_reset, is_ts_for_of_hdr};
use crate::r5::snippet_ts_gen_ctx::{TsGenMemberCtx, stmt_starts_var_decl};
use crate::r5::snippet_ts_type::tail_after_depth0_comma;

pub(crate) fn is_attached_generic_callee(seg: &str, lt_pos: usize, member_ctx: TsGenMemberCtx) -> bool {
    let b = seg.as_bytes();
    if lt_pos == 0 { return false; }
    if !b[lt_pos - 1].is_ascii_alphanumeric() && !matches!(b[lt_pos - 1], b'_' | b'$') {
        let pre = seg[..lt_pos].trim_end();
        if pre.ends_with(')') {
            let member_ok = member_ctx == TsGenMemberCtx::None || crate::r5::snippet_ts_brace::has_ts_member_val_prefix(
                crate::r5::snippet_ts_gen_ctx::isolate_asi_tail_before_lt(pre, true, member_ctx), member_ctx,
            );
            return member_ok && has_matching_non_ctrl_paren(pre);
        }
        return (pre.ends_with(']') && crate::r5::snippet_ts_brace::is_ts_member_bracket_callee_ok(pre, member_ctx))
            || (pre.ends_with('>') && has_matching_open_angle_at_end(pre));
    }
    let prev_w = seg[..lt_pos].rsplit(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
    if prev_w.is_empty() || prev_w.as_bytes()[0].is_ascii_digit() { return false; }
    let before = seg[..lt_pos - prev_w.len()].trim_end();
    if (before.ends_with('.') && !before.ends_with("..")) || before.ends_with('#') { return true; }
    if member_ctx == TsGenMemberCtx::None && matches!(
        prev_w,
        "as" | "satisfies" | "implements" | "default" | "keyof" | "infer" | "case" | "new"
            | "if" | "while" | "try" | "finally" | "do" | "switch" | "catch" | "for" | "with"
    ) { return false; }
    if matches!(
        prev_w,
        "return" | "throw" | "yield" | "await" | "typeof" | "void" | "delete"
            | "else" | "export" | "extends" | "import" | "in" | "instanceof" | "of"
    ) {
        return member_ctx != TsGenMemberCtx::None && is_member_kw_name(before);
    }
    true
}

pub(crate) fn has_matching_non_ctrl_paren(bt: &str) -> bool {
    let b = bt.as_bytes();
    if b.last() != Some(&b')') { return false; }
    let (mut i, mut pd, mut bd, mut cd) = (b.len() - 1, 0usize, 0usize, 0usize);
    let is_id = |c: char| c.is_ascii_alphanumeric() || matches!(c, '_' | '$');
    loop {
        match b[i] {
            b']' => bd += 1, b'[' => { if bd == 0 { return false; } bd -= 1; }
            b'}' => cd += 1, b'{' => { if cd == 0 { return false; } cd -= 1; }
            b')' if bd == 0 && cd == 0 => pd += 1,
            b'(' if bd == 0 && cd == 0 => {
                pd -= 1;
                if pd == 0 {
                    let pre = bt[..i].trim_end();
                    let pre_star = pre.strip_suffix('*').map(str::trim_end);
                    let pre_chk = pre_star.unwrap_or(pre);
                    let kw = pre_chk.rsplit(|c: char| !is_id(c)).next().unwrap_or("");
                    let bkw = pre_chk[..pre_chk.len() - kw.len()].trim_end();
                    if pre_star.is_none() && ((bkw.ends_with('.') && !bkw.ends_with("..")) || bkw.ends_with('#')) { return true; }
                    if pre_star.is_some() {
                        return !(kw == "function" && !((bkw.ends_with('.') && !bkw.ends_with("..")) || bkw.ends_with('#')));
                    }
                    if matches!(kw, "if" | "while" | "for" | "with" | "catch" | "switch" | "function") { return false; }
                    let bkw_chk = bkw.strip_suffix('*').map_or(bkw, str::trim_end);
                    let pw = bkw_chk.rsplit(|c: char| !is_id(c)).next().unwrap_or("");
                    let bpw = bkw_chk[..bkw_chk.len() - pw.len()].trim_end();
                    if !((bpw.ends_with('.') && !bpw.ends_with("..")) || bpw.ends_with('#'))
                        && ((kw == "await" && pw == "for") || (!kw.is_empty() && pw == "function"))
                    { return false; }
                    return true;
                }
            }
            _ => {}
        }
        if i == 0 { break; }
        i -= 1;
    }
    false
}

pub(crate) fn has_matching_open_bracket_at_end(bt: &str) -> bool {
    let b = bt.as_bytes();
    if b.last() != Some(&b']') { return false; }
    let (mut i, mut bd, mut pd, mut cd) = (b.len() - 1, 0usize, 0usize, 0usize);
    loop {
        match b[i] {
            b')' => pd += 1, b'(' => { if pd == 0 { return false; } pd -= 1; }
            b'}' => cd += 1, b'{' => { if cd == 0 { return false; } cd -= 1; }
            b']' if pd == 0 && cd == 0 => bd += 1,
            b'[' if pd == 0 && cd == 0 => { bd -= 1; if bd == 0 { return true; } }
            _ => {}
        }
        if i == 0 { break; } i -= 1;
    }
    false
}
fn is_member_kw_name(bt: &str) -> bool {
    let last_line = crate::r5::snippet_ts_hdr::strip_leading_ts_decorators(bt.rsplit('\n').next().unwrap_or("").trim()).trim();
    if !last_line.is_empty() {
        return last_line.strip_suffix('*').unwrap_or(last_line).split_whitespace().all(|w| matches!(w,
            "public" | "private" | "protected" | "static" | "readonly" | "abstract" | "override" | "async" | "declare" | "get" | "set"
        ));
    }
    let prev = bt.trim_end();
    if prev.is_empty() { return true; }
    if prev.ends_with([':', '=', '(', '[', '|', '&', '?', '<', '>', '+', '-', '*', '/', '%', '!', '~']) || prev.ends_with("=>") { return false; }
    let lw = prev.rsplit(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
    let blw = prev[..prev.len() - lw.len()].trim_end();
    if (blw.ends_with('.') && !blw.ends_with("..")) || blw.ends_with('#') { return true; }
    !matches!(lw, "extends" | "implements" | "typeof" | "keyof" | "infer" | "new" | "await" | "yield" | "return" | "throw" | "void" | "delete" | "in" | "instanceof" | "of" | "as" | "satisfies" | "is" | "case" | "else")
}
fn has_matching_open_angle_at_end(bt: &str) -> bool {
    let b = bt.as_bytes();
    if b.last() != Some(&b'>') || bt.ends_with("=>") || bt.ends_with("->") { return false; }
    let (mut i, mut ad, mut pd, mut bd, mut cd) = (b.len() - 1, 0isize, 0usize, 0usize, 0usize);
    loop {
        match b[i] {
            b')' => pd += 1, b'(' => { if pd == 0 { return false; } pd -= 1; }
            b']' => bd += 1, b'[' => { if bd == 0 { return false; } bd -= 1; }
            b'}' => cd += 1, b'{' => { if cd == 0 { return false; } cd -= 1; }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'=' | b'-')) => ad += 1,
            b'<' if pd == 0 && bd == 0 && cd == 0 => { ad -= 1; if ad == 0 { return is_attached_generic_callee(bt, i, TsGenMemberCtx::None); } }
            _ => {}
        }
        if i == 0 { break; } i -= 1;
    }
    false
}

fn is_ts_angle_cast_non_id_tail(bt: &str) -> bool {
    bt.is_empty()
        || bt.ends_with(['=', '(', '[', ',', ':', ';', '?', '!', '~', '*', '+', '-', '/', '%', '&', '|', '^', '<'])
        || bt.ends_with("=>")
        || (bt.ends_with('>') && !has_matching_open_angle_at_end(bt))
}

fn is_tsx_non_id_lt_brace_hdr(lang: LanguageId, raw_hdr: &str) -> bool {
    if lang != LanguageId::Tsx { return false; }
    let clean = strip_comments_strings(lang, raw_hdr, true);
    let seg = tail_after_depth0_comma(trim_after_last_sep(&clean).trim()).trim();
    !seg.ends_with("<<") && seg.strip_suffix('<').map(str::trim_end).is_some_and(|bt| {
        is_ts_angle_cast_non_id_tail(bt) || (bt.ends_with(')') && !has_matching_non_ctrl_paren(bt))
    })
}

pub(crate) fn is_ts_invalid_kw_lt_hdr(lang: LanguageId, raw_hdr: &str, member_ctx: TsGenMemberCtx) -> bool {
    is_ts_invalid_kw_lt_hdr_in(lang, raw_hdr, member_ctx, true, member_ctx == TsGenMemberCtx::None, false, false)
}
pub(crate) fn is_ts_invalid_kw_lt_hdr_ctx(lang: LanguageId, raw_hdr: &str, member_ctx: TsGenMemberCtx, allow_stmt_label: bool, in_type_delim: bool, in_val_paren: bool) -> bool {
    is_ts_invalid_kw_lt_hdr_in(lang, raw_hdr, member_ctx, true, allow_stmt_label, in_type_delim, in_val_paren)
}
fn is_ts_invalid_kw_lt_hdr_in(lang: LanguageId, raw_hdr: &str, member_ctx: TsGenMemberCtx, allow_ts_cast: bool, allow_stmt_label: bool, in_type_delim: bool, in_val_paren: bool) -> bool {
    if !matches!(lang, LanguageId::TypeScript | LanguageId::Tsx) { return false; }
    let clean = if raw_hdr.contains(['"', '\'', '`', '/']) { crate::r5::snippet_ts_cls::clean_ts_preserving_quoted_method_lt(raw_hdr, member_ctx) }
    else { strip_comments_strings(lang, raw_hdr, true) };
    let seg = tail_after_depth0_comma(trim_after_last_sep(&clean).trim()).trim();
    let (b, mut i, mut pd, mut bd, mut cd, mut cut) = (seg.as_bytes(), 0usize, 0usize, 0usize, 0usize, 0usize);
    let (mut lt_stack, is_id) = (Vec::<(usize, u8, usize, usize, usize)>::new(), |c: u8| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$'));
    while i < b.len() {
        let cur = (pd, bd, cd);
        match b[i] {
            b'(' => pd += 1, b')' => { pd = pd.saturating_sub(1); lt_stack.retain(|f| f.2 <= pd); }
            b'[' => bd += 1, b']' => { bd = bd.saturating_sub(1); lt_stack.retain(|f| f.3 <= bd); }
            b'{' => cd += 1, b'}' => { cd = cd.saturating_sub(1); lt_stack.retain(|f| f.4 <= cd); }
            b'\n' if cur == (0, 0, 0) => {
                if is_ts_asi_frame_reset(&seg[cut..i], &seg[i + 1..], member_ctx) { lt_stack.clear(); cut = i + 1; }
            }
            b'<' => {
                if matches!(b.get(i + 1), Some(b'=' | b'<')) { lt_stack.retain(|f| (f.2, f.3, f.4) != cur); i += 2; continue; }
                lt_stack.push((i, 0, pd, bd, cd));
            }
            b'>' if (i == 0 || !matches!(b[i - 1], b'-' | b'=')) && lt_stack.last().is_some_and(|f| (f.2, f.3, f.4) == cur) => { lt_stack.pop(); }
            b'=' if lt_stack.last().is_some_and(|f| (f.2, f.3, f.4) == cur) => {
                if b.get(i + 1) == Some(&b'>') { i += 2; continue; }
                let (prev, next) = (i.checked_sub(1).and_then(|k| b.get(k)).copied(), b.get(i + 1).copied());
                if matches!(prev, Some(b'=' | b'!' | b'<' | b'>')) || next == Some(b'=') { lt_stack.retain(|f| (f.2, f.3, f.4) != cur); }
                else if let Some(top) = lt_stack.last_mut() { top.1 = 2; }
            }
            b'e' if b[i..].starts_with(b"extends") && (i == 0 || !is_id(b[i - 1])) && b.get(i + 7).is_none_or(|&c| !is_id(c))
                && lt_stack.last().is_some_and(|f| (f.2, f.3, f.4) == cur) => {
                let top = lt_stack.last_mut().unwrap(); if top.1 == 0 { top.1 = 1; } i += 7; continue;
            }
            b'?' if lt_stack.last().is_some_and(|f| (f.2, f.3, f.4) == cur) => { let top = lt_stack.last_mut().unwrap(); if top.1 == 1 { top.1 = 0; } }
            b',' if lt_stack.last().is_some_and(|f| (f.2, f.3, f.4) == cur) => { lt_stack.last_mut().unwrap().1 = 0; }
            _ => {}
        }
        i += 1;
    }
    (0..lt_stack.len()).rev().any(|lt_idx| {
        let (lt, def_k, _, _, _) = lt_stack[lt_idx];
        let has_def_ext = def_k != 0;
        let pre_lbl = if allow_stmt_label { crate::r5::snippet_ts_gen_ambig::strip_ts_stmt_labels(&seg[cut..lt]) } else { &seg[cut..lt] };
        let (pre_lt, after_lt, is_tsx) = (pre_lbl.trim_end(), seg[lt + 1..].trim(), lang == LanguageId::Tsx);
        let (has_comma_tail, has_d0_comma) = (after_lt.ends_with(','), after_lt.ends_with(',') && lt_idx + 1 == lt_stack.len());
        if lt_idx == 0 && let Some(bad) = crate::r5::snippet_ts_gen_ctx::is_invalid_ts_type_pos_lt(pre_lbl, member_ctx, in_type_delim, in_val_paren, has_def_ext, has_d0_comma, after_lt.is_empty()) { return bad; }
        if let Some(sp) = pre_lt.strip_suffix('*').map(str::trim_end) {
            let w = sp.rsplit(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
            let bw = sp[..sp.len() - w.len()].trim_end();
            if w == "function" && !(bw.ends_with('.') && !bw.ends_with("..")) && !bw.ends_with('#') { return !has_def_ext || has_comma_tail || after_lt.is_empty(); }
            return (is_tsx && !has_def_ext) || has_comma_tail || (!has_def_ext && !after_lt.is_empty());
        }
        if is_tsx && member_ctx == TsGenMemberCtx::None && !has_def_ext && (lt_idx + 1 < lt_stack.len() || has_comma_tail || after_lt.is_empty())
            && crate::r5::snippet_ts_gen_ctx::before_lt_allows_anon_generic(pre_lt) { return true; }
        if crate::r5::snippet_ts_brace::is_invalid_ts_member_lt_frame(seg, cut, &lt_stack, lt_idx, member_ctx) { return true; }
        if pre_lt.is_empty() || !is_id(*pre_lt.as_bytes().last().unwrap()) { return false; }
        let prev_w = pre_lt.rsplit(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
        let before = &pre_lt[..pre_lt.len() - prev_w.len()];
        let bt = before.trim_end();
        if (bt.ends_with('.') && !bt.ends_with("..")) || bt.ends_with('#') { return false; }
        let ts_cast_ok = !is_tsx && allow_ts_cast && after_lt.is_empty() && !(member_ctx.is_class_or_type() && bt.ends_with(':'));
        let member_ok = member_ctx != TsGenMemberCtx::None && lt_stack.len() == 1 && has_def_ext && !has_comma_tail && !after_lt.is_empty() && is_member_kw_name(bt);
        let ctor_ok = member_ok && !(member_ctx == TsGenMemberCtx::IfaceType && bt == "abstract");
        match prev_w {
            "implements" | "keyof" | "infer" | "if" | "while" | "try" | "finally" | "do" | "switch" | "catch" | "for" | "with" => !member_ok,
            "default" => !member_ok
                && !(ts_cast_ok && bt.split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).rfind(|w| !w.is_empty()) == Some("export"))
                && (!has_def_ext || has_comma_tail || bt.split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).rfind(|w| !w.is_empty()) != Some("export")),
            "as" | "satisfies" => if member_ok { false } else { !bt.is_empty() && !before.trim_end_matches([' ', '\t']).ends_with('\n') },
            "extends" => if member_ok { false } else { !has_def_ext || has_comma_tail || (lt_stack.len() == 1 && matches!(bt.split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).find(|w| !w.is_empty() && !matches!(*w, "export" | "declare" | "abstract" | "default")), Some("class" | "interface"))) },
            "export" | "declare" => !member_ok,
            "async" => !member_ok && matches!(bt.split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).rfind(|w| !w.is_empty()), Some("export" | "declare")),
            "new" => !(ctor_ok || (member_ctx.is_class_or_type() && bt.ends_with(':'))) || !has_def_ext || has_comma_tail || after_lt.is_empty(),
            "function" | "import" => !has_def_ext || has_comma_tail || after_lt.is_empty(),
            "return" | "throw" | "else" | "case" => !member_ok && !ts_cast_ok
                && !(prev_w == "return" && allow_ts_cast && after_lt.is_empty() && member_ctx != TsGenMemberCtx::None && !(member_ctx.is_class_or_type() && bt.ends_with(':')) && has_depth0_assign_or_type_colon(bt))
                && (!has_def_ext || has_comma_tail || member_ctx != TsGenMemberCtx::None || (!bt.is_empty() && !crate::r5::snippet_ts_gen_chk::prev_is_ctrl_hdr(bt) && !crate::r5::snippet_ts_gen_ambig::prev_is_do_stmt(bt))),
            "await" | "yield" | "typeof" | "delete" | "void" | "in" | "instanceof" => !member_ok && !ts_cast_ok
                && (!has_def_ext || has_comma_tail || (member_ctx.is_class_or_type() && bt.ends_with(':'))),
            "of" => !member_ok && !ts_cast_ok && (!has_def_ext || has_comma_tail) && (is_ts_for_of_hdr(bt) || (stmt_starts_var_decl(bt) && !has_depth0_assign_or_type_colon(bt))),
            _ => false,
        }
    })
}

pub(crate) fn is_ts_invalid_kw_lt_opener(
    lang: LanguageId, joined: &str, openers: &[(u8, usize, usize)], op_idx: usize, hdr: &[&str],
) -> bool {
    let p = classify_prefix_container_with_openers(lang, joined, &openers[..op_idx]);
    let start = op_idx.checked_sub(1).map_or(0, |k| openers[k].2 + 1);
    let raw_seg = joined.get(start..openers[op_idx].2).unwrap_or("");
    let is_cls_type = matches!(p, PrefixContainer::ClassOrTraitBody | PrefixContainer::TypeBody(_));
    if crate::r5::snippet_ts_cls::is_ts_backtick_method_body_hdr(raw_seg, is_cls_type)
        || crate::r5::snippet_ts_brace::is_js_ret_colon_hdr(lang, raw_seg)
        || crate::r5::snippet_ts_brace::is_js_member_lt_hdr(lang, p, raw_seg)
        || ((is_cls_type || p == PrefixContainer::ValueBrace) && crate::r5::snippet_ts_cls::is_ts_invalid_op_method_hdr(raw_seg, is_cls_type))
        || is_tsx_non_id_lt_brace_hdr(lang, raw_seg)
    { return true; }
    let member_ctx = match p {
        PrefixContainer::TypeBody(crate::r5::snippet_type_body::TB_IFACE) => TsGenMemberCtx::IfaceType,
        PrefixContainer::TypeBody(_) | PrefixContainer::ClassOrTraitBody => TsGenMemberCtx::ClassOrType,
        PrefixContainer::ValueBrace => TsGenMemberCtx::ObjBrace, _ => TsGenMemberCtx::None,
    };
    let (op_byte, h_join) = (openers[op_idx].2, hdr.join("\n"));
    let after_op = joined.get(op_byte..).and_then(|s| s.split('\n').next()).map_or(0, str::len);
    let h_end = h_join.len().saturating_sub(after_op);
    let h_start = h_end.saturating_sub(op_byte.saturating_sub(start));
    let (in_type_delim, in_val_paren) = (matches!(p, PrefixContainer::TypeParen | PrefixContainer::TypeBracket), p == PrefixContainer::ValueParen);
    let allow_lbl = matches!(p, PrefixContainer::TopLevel | PrefixContainer::StmtBlock | PrefixContainer::MatchOrSwitch);
    if is_ts_invalid_kw_lt_hdr_in(lang, h_join.get(h_start..h_end).unwrap_or(raw_seg), member_ctx, !matches!(p, PrefixContainer::TypeBody(_)), allow_lbl, in_type_delim, in_val_paren) { return true; }
    if op_idx > 0 && openers[op_idx - 1].0 == b'(' {
        let prev_b = openers[..op_idx].iter().rposition(|&(d, _, _)| d == b'{').map_or(0, |k| openers[k].2 + 1);
        let pre_lp_clean = strip_comments_strings(lang, joined.get(prev_b..openers[op_idx - 1].2).unwrap_or(""), true);
        let pre_lp = pre_lp_clean.trim_end();
        let w = pre_lp.rsplit(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
        if w == "for" || (w == "await" && pre_lp.strip_suffix("await").is_some_and(|b| b.trim_end().rsplit(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next() == Some("for"))) {
            return is_ts_invalid_kw_lt_hdr_in(lang, joined.get(prev_b..op_byte).unwrap_or(""), member_ctx, true, allow_lbl, false, false);
        }
    }
    false
}

pub(crate) fn is_ts_angle_cast_prefix(lang: LanguageId, pre_lb: &str) -> bool {
    lang == LanguageId::TypeScript
        && strip_comments_strings(lang, pre_lb, true).trim_end().strip_suffix('<').map(str::trim_end).is_some_and(|bt| {
            is_ts_angle_cast_non_id_tail(bt) || bt.ends_with('>') || bt.rsplit(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next()
                .is_some_and(|w| matches!(w, "return" | "throw" | "yield" | "await" | "typeof" | "delete" | "void" | "in" | "instanceof" | "else" | "case" | "default" | "of"))
        })
}
