use aice_lang_registry::LanguageId;

use crate::r5::snippet_hdr::trim_after_last_sep;
use crate::r5::snippet_synth::strip_comments_strings;
use crate::r5::snippet_ts_gen_chk::{has_depth0_assign_or_type_colon, has_ts_type_signal, is_ts_asi_frame_reset, pre_lt_has_cmp_ctx, ts_anon_generic_ok, ts_generic_default_ok, ts_paren_type_ok};
use crate::r5::snippet_ts_gen_close::ts_refine_body_signals;
use crate::r5::snippet_ts_gen_ctx::{TsGenMemberCtx, has_assign_with_rhs_before_lt, is_single_lower_ident, isolate_asi_tail_before_lt, pre_lt_has_heritage_kw, stmt_starts_var_decl};
use crate::r5::snippet_ts_type::tail_after_depth0_comma;
use crate::r5::snippet_type_body::TB_IFACE;
use crate::r5::snippet_container::PrefixContainer;
pub(crate) use crate::r5::snippet_ts_cast::{
    is_attached_generic_callee, is_ts_angle_cast_prefix, is_ts_invalid_kw_lt_hdr, is_ts_invalid_kw_lt_hdr_ctx, is_ts_invalid_kw_lt_opener,
};

pub(crate) struct TsAmbigBraceHead { pub(crate) attached: bool, pub(crate) in_v: bool, pub(crate) single_l: bool, pub(crate) non_ambig_sig: bool, pub(crate) ambig_sig: bool, pub(crate) is_type_only: bool, pub(crate) ctrl_or_arrow: bool }

fn pre_lt_has_ctrl_or_arrow(pre_lt: &str) -> bool {
    let tail = isolate_asi_tail_before_lt(pre_lt, true, TsGenMemberCtx::None);
    let (b, mut i, mut pd, mut bd, mut cd, is_id) = (tail.as_bytes(), 0usize, 0usize, 0usize, 0usize, |c: u8| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$'));
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1), b'[' => bd += 1, b']' => bd = bd.saturating_sub(1), b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'=' if pd == 0 && bd == 0 && cd == 0 && b.get(i + 1) == Some(&b'>') => return true,
            c if pd == 0 && bd == 0 && cd == 0 && is_id(c) => {
                let st = i; while i < b.len() && is_id(b[i]) { i += 1; }
                if matches!(&tail[st..i], "return" | "throw" | "yield" | "await" | "case" | "if" | "while" | "else" | "for") { return true; }
                continue;
            }
            _ => {}
        }
        i += 1;
    }
    false
}

pub(crate) fn ts_ambig_brace_head(lang: LanguageId, raw_hdr: &str) -> Option<TsAmbigBraceHead> {
    if is_ts_invalid_kw_lt_hdr(lang, raw_hdr, TsGenMemberCtx::None) { return None; }
    scan_ts_ambig_brace_head_in(lang, raw_hdr, false, false).and_then(|(h, missing)| (!missing).then_some(h))
}

pub(crate) fn is_ts_var_decl_lt_without_assign(lang: LanguageId, raw_hdr: &str) -> bool {
    matches!(lang, LanguageId::TypeScript | LanguageId::Tsx)
        && (is_ts_invalid_kw_lt_hdr(lang, raw_hdr, TsGenMemberCtx::None)
            || scan_ts_ambig_brace_head_in(lang, raw_hdr, false, false).is_some_and(|(_, missing)| missing))
}

fn scan_ts_ambig_brace_head_in(lang: LanguageId, raw_hdr: &str, in_expr_list: bool, allow_empty_ident: bool) -> Option<(TsAmbigBraceHead, bool)> {
    let clean_hdr = if raw_hdr.contains(['"', '\'', '`', '/']) {
        crate::r5::snippet_ts_cls::clean_ts_preserving_quoted_method_lt(raw_hdr, TsGenMemberCtx::None)
    } else { strip_comments_strings(lang, raw_hdr, true) };
    let asi = isolate_asi_tail_before_lt(trim_after_last_sep(&clean_hdr).trim(), true, TsGenMemberCtx::None);
    let in_var = stmt_starts_var_decl(asi);
    let seg = tail_after_depth0_comma(asi).trim();
    let has_prior_comma = seg.len() < asi.len() && !in_var;
    let (b, mut i, mut pd, mut bd, mut cd, mut stmt_cut, mut last_comma, mut var_decl, mut had_cmp_or_arith) =
        (seg.as_bytes(), 0usize, 0usize, 0usize, 0usize, 0usize, 0usize, in_var, false);
    let (mut has_cmp_comma, mut saw_comma) = (false, false);
    let mut lt_stack: Vec<(usize, bool, usize)> = Vec::new();
    let is_id = |c: u8| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$');
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1, b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'\n' if pd == 0 && bd == 0 && cd == 0 && !lt_stack.is_empty()
                && is_ts_asi_frame_reset(&seg[stmt_cut..i], &seg[i + 1..], TsGenMemberCtx::None) =>
            {
                lt_stack.clear(); stmt_cut = i + 1; last_comma = i + 1; had_cmp_or_arith = false;
                has_cmp_comma = false; saw_comma = false; var_decl = stmt_starts_var_decl(&seg[i + 1..]);
            }
            b'&' | b'|' if pd == 0 && bd == 0 && cd == 0 && !lt_stack.is_empty() && b.get(i + 1) == Some(&b[i]) => { lt_stack.clear(); had_cmp_or_arith = true; saw_comma = false; i += 2; continue; }
            b'!' if pd == 0 && bd == 0 && cd == 0 && !lt_stack.is_empty() && b.get(i + 1) == Some(&b'=') => { lt_stack.clear(); had_cmp_or_arith = true; saw_comma = false; i += 2; continue; }
            b'+' | b'*' | b'/' | b'%' if pd == 0 && bd == 0 && cd == 0 && !lt_stack.is_empty() => { lt_stack.clear(); had_cmp_or_arith = true; saw_comma = false; i += 1; continue; }
            b'-' if pd == 0 && bd == 0 && cd == 0 && !lt_stack.is_empty() && b.get(i + 1) != Some(&b'>')
                && seg[..i].bytes().rfind(|c| !c.is_ascii_whitespace()).is_some_and(|c| is_id(c) || matches!(c, b')' | b']' | b'>')) =>
            { lt_stack.clear(); had_cmp_or_arith = true; saw_comma = false; i += 1; continue; }
            b'e' if pd == 0 && bd == 0 && cd == 0 && !lt_stack.is_empty()
                && b[i..].starts_with(b"extends") && (i == 0 || !is_id(b[i - 1])) && b.get(i + 7).is_none_or(|&c| !is_id(c)) => {
                lt_stack.last_mut().unwrap().1 = true; i += 7; continue;
            }
            b'?' if pd == 0 && bd == 0 && cd == 0 && !lt_stack.is_empty() => {
                let top = lt_stack.last_mut().unwrap();
                if top.1 { top.1 = false; top.2 += 1; } else { lt_stack.clear(); had_cmp_or_arith = true; saw_comma = false; }
            }
            b':' if pd == 0 && bd == 0 && cd == 0 && !lt_stack.is_empty() => {
                let top = lt_stack.last_mut().unwrap();
                if top.2 > 0 { top.2 -= 1; } else { lt_stack.clear(); had_cmp_or_arith = true; saw_comma = false; }
            }
            b'=' if pd == 0 && bd == 0 && cd == 0 && !lt_stack.is_empty() => {
                let (prev, next) = (i.checked_sub(1).and_then(|k| b.get(k)).copied(), b.get(i + 1).copied());
                if matches!(prev, Some(b'=' | b'!' | b'<' | b'>')) || next == Some(b'=') {
                    lt_stack.clear(); had_cmp_or_arith = true; saw_comma = false; i += if next == Some(b'=') { 2 } else { 1 }; continue;
                }
                if next == Some(b'>') { i += 2; continue; }
                if lt_stack.len() != 1 {
                    let top = *lt_stack.last().unwrap();
                    let between = &seg[lt_stack[lt_stack.len() - 2].0 + 1..top.0];
                    if let Some(sep) = between.rfind([',', '\n'])
                        && ts_generic_default_ok(&between[sep + 1..], top.0 > 0 && is_id(b[top.0 - 1]), TsGenMemberCtx::None)
                    { lt_stack = vec![(top.0, false, top.2)]; } else { lt_stack.clear(); stmt_cut = last_comma; had_cmp_or_arith = false; saw_comma = false; }
                } else {
                    let lt0 = lt_stack[0].0;
                    if !ts_generic_default_ok(&seg[stmt_cut..lt0], lt0 > 0 && is_id(b[lt0 - 1]), TsGenMemberCtx::None) { lt_stack.clear(); stmt_cut = last_comma; had_cmp_or_arith = false; saw_comma = false; }
                }
            }
            b',' if pd == 0 && bd == 0 && cd == 0 && !seg[i + 1..].trim().is_empty() => {
                last_comma = i + 1;
                if lt_stack.is_empty() {
                    stmt_cut = i + 1; had_cmp_or_arith = false; saw_comma = false;
                    if !var_decl { has_cmp_comma = true; }
                } else {
                    let lt0 = lt_stack[0].0;
                    let p_lt = &seg[stmt_cut..lt0];
                    let has_sp = p_lt.len() > p_lt.trim_end().len();
                    let expr_like = is_single_lower_ident(p_lt) || p_lt.trim_end().ends_with([')', ']']);
                    let allow_ident = !(had_cmp_or_arith && is_single_lower_ident(p_lt)) && !(in_expr_list && expr_like && (!allow_empty_ident || has_sp));
                    let allow_lit = allow_ident && !in_expr_list;
                    if !var_decl && (has_prior_comma || has_cmp_comma || had_cmp_or_arith)
                        && p_lt.trim_end().ends_with([')', ']']) && !ts_paren_type_ok(&seg[lt0 + 1..i])
                    {
                        lt_stack.clear(); stmt_cut = i + 1; had_cmp_or_arith = false; saw_comma = false; has_cmp_comma = true;
                    } else if var_decl && (!has_depth0_assign_or_type_colon(p_lt)
                        || (has_assign_with_rhs_before_lt(p_lt) && !has_ts_type_signal(&seg[lt0 + 1..i], true, allow_ident, allow_lit)))
                    { lt_stack.clear(); stmt_cut = i + 1; had_cmp_or_arith = false; saw_comma = false; }
                    else if lt_stack.len() == 1 { saw_comma = true; }
                }
            }
            b'<' if pd == 0 && bd == 0 && cd == 0 => {
                if matches!(b.get(i + 1), Some(b'=' | b'<')) { if !lt_stack.is_empty() { lt_stack.clear(); had_cmp_or_arith = true; saw_comma = false; } i += 2; continue; }
                if !lt_stack.is_empty() && saw_comma && last_comma > lt_stack[0].0 && seg[last_comma..i].trim_end().ends_with([')', ']']) {
                    lt_stack.clear(); stmt_cut = last_comma; had_cmp_or_arith = false; saw_comma = false;
                    if !var_decl { has_cmp_comma = true; }
                }
                let att = is_attached_generic_callee(seg, i, TsGenMemberCtx::None);
                let pre = &seg[stmt_cut..i];
                let destr_lt = var_decl && lt_stack.is_empty() && pre.trim_end().ends_with([']', '}']) && !has_depth0_assign_or_type_colon(pre);
                let type_ok = crate::r5::snippet_ts_gen_ctx::ts_type_pos_tail(pre, TsGenMemberCtx::None)
                    .is_some_and(crate::r5::snippet_ts_gen_ctx::is_ts_type_param_head_tail);
                if !lt_stack.is_empty() || att || destr_lt || ts_anon_generic_ok(pre) || type_ok { lt_stack.push((i, false, 0)); }
            }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => { lt_stack.pop(); }
            _ => {}
        }
        i += 1;
    }
    let &(lt, _, _) = lt_stack.first()?;
    let pre_lt = &seg[stmt_cut..lt];
    let attached = is_attached_generic_callee(seg, lt, TsGenMemberCtx::None);
    let in_v = var_decl || stmt_starts_var_decl(pre_lt);
    let destr_lt = in_v && pre_lt.trim_end().ends_with([']', '}']) && !has_depth0_assign_or_type_colon(pre_lt);
    if !attached && !destr_lt && !ts_anon_generic_ok(pre_lt) { return None; }
    let seg_end = seg.trim_end();
    if !(seg_end.ends_with(',') || (seg_end.ends_with('|') && !seg_end.ends_with("||")) || (seg_end.ends_with('&') && !seg_end.ends_with("&&"))) { return None; }
    let missing_assign = in_v && !has_depth0_assign_or_type_colon(pre_lt);
    let after_lt_core = seg[lt + 1..].trim_end().trim_end_matches([',', '|', '&']);
    let has_sp = pre_lt.len() > pre_lt.trim_end().len();
    let expr_like = is_single_lower_ident(pre_lt) || pre_lt.trim_end().ends_with([')', ']']);
    let has_cmp_sep = has_prior_comma || has_cmp_comma || had_cmp_or_arith || pre_lt_has_cmp_ctx(pre_lt, in_v);
    let allow_ident = !(in_expr_list && expr_like && (!allow_empty_ident || has_sp || has_cmp_sep));
    let allow_lit = !in_expr_list && !has_cmp_sep;
    if seg_end.ends_with(',') && in_expr_list && !has_ts_type_signal(after_lt_core, attached, allow_ident, false) { return None; }
    if seg_end.ends_with(',') && (has_cmp_sep || (has_sp && !has_ts_type_signal(after_lt_core, attached, true, allow_lit)))
        && pre_lt.trim_end().ends_with([')', ']']) && !ts_paren_type_ok(after_lt_core)
    { return None; }
    let first_w = pre_lt.split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).find(|w| !w.is_empty() && !matches!(*w, "export" | "declare"));
    let is_type_only = (has_depth0_assign_or_type_colon(pre_lt) && !has_assign_with_rhs_before_lt(pre_lt))
        || pre_lt_has_heritage_kw(pre_lt) || matches!(first_w, Some("type" | "interface" | "class"));
    Some((TsAmbigBraceHead {
        attached, in_v, single_l: is_single_lower_ident(pre_lt),
        non_ambig_sig: has_ts_type_signal(after_lt_core, attached, false, false),
        ambig_sig: has_ts_type_signal(after_lt_core, attached, allow_ident, allow_lit),
        is_type_only,
        ctrl_or_arrow: in_expr_list || pre_lt.trim_end().ends_with([')', ']']) || pre_lt_has_ctrl_or_arrow(pre_lt),
    }, missing_assign))
}

pub(crate) fn is_ts_ambig_generic_or_obj_brace(
    lang: LanguageId, joined: &str, openers: &[(u8, usize, usize)], prefix_ctx: PrefixContainer,
) -> bool {
    if !matches!(lang, LanguageId::TypeScript | LanguageId::Tsx) { return false; }
    let Some(&(b'{', _, op_byte)) = openers.last() else { return false; };
    let prev_op = openers.iter().rev().find(|&&(_, _, b)| b < op_byte).map_or(0, |&(_, _, b)| b + 1);
    let (raw_hdr, body_tail) = (joined.get(prev_op..op_byte).unwrap_or(""), joined.get(op_byte + 1..).unwrap_or(""));
    if is_ts_angle_cast_prefix(lang, raw_hdr) { return !ts_refine_body_signals(lang, body_tail).2; }
    if !matches!(prefix_ctx, PrefixContainer::ValueBrace | PrefixContainer::TypeBody(TB_IFACE)) { return false; }
    let op_idx = openers.len() - 1;
    let parent = if op_idx > 0 {
        crate::r5::snippet_container::classify_prefix_container_with_openers(lang, joined, &openers[..op_idx])
    } else { PrefixContainer::TopLevel };
    if matches!(parent, PrefixContainer::TypeBracket | PrefixContainer::TypeParen) { return false; }
    let in_expr_list = matches!(parent, PrefixContainer::ValueBracket | PrefixContainer::ValueParen);
    let body_empty = strip_comments_strings(lang, body_tail, true).lines().all(|l| l.trim().is_empty());
    let allow_lbl = matches!(parent, PrefixContainer::TopLevel | PrefixContainer::StmtBlock | PrefixContainer::MatchOrSwitch);
    let head = if is_ts_invalid_kw_lt_hdr_ctx(lang, raw_hdr, TsGenMemberCtx::None, allow_lbl, false, parent == PrefixContainer::ValueParen) { None }
        else { scan_ts_ambig_brace_head_in(lang, raw_hdr, in_expr_list, body_empty).and_then(|(h, m)| (!m).then_some(h)) };
    let Some(head) = head else { return false; };
    if !head.attached || head.is_type_only { return false; }
    let (force_val, has_iface, has_obj_expr, has_obj_paren_op, has_obj_lit) = ts_refine_body_signals(lang, body_tail);
    if force_val || has_iface || has_obj_expr || has_obj_paren_op { return false; }
    if body_empty { return prefix_ctx == PrefixContainer::ValueBrace || head.ctrl_or_arrow; }
    has_obj_lit && !(head.single_l && !head.ambig_sig)
}

pub(crate) fn prev_is_do_stmt(bt: &str) -> bool {
    let lw = bt.rsplit(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
    let blw = bt[..bt.len() - lw.len()].trim_end();
    lw == "do" && !(blw.ends_with('.') && !blw.ends_with("..")) && !blw.ends_with('#')
}

fn peel_ts_ctrl_hdrs(mut s: &str) -> &str {
    let is_id = |c: u8| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$');
    loop {
        let t = s.trim_start();
        let w = t.split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
        if matches!(w, "else" | "do") && t.as_bytes().get(w.len()).is_some_and(|c| c.is_ascii_whitespace()) {
            s = &t[w.len()..]; continue;
        }
        let mut rest = if matches!(w, "if" | "while" | "for" | "with") { t[w.len()..].trim_start() } else { return t; };
        if w == "for" && let Some(r) = rest.strip_prefix("await") && r.as_bytes().first().is_none_or(|&c| !is_id(c)) {
            rest = r.trim_start();
        }
        if !rest.starts_with('(') { return t; }
        let (b, mut i, mut pd, mut bd, mut cd, mut closed) = (rest.as_bytes(), 0usize, 0usize, 0usize, 0usize, None);
        while i < b.len() {
            match b[i] {
                b'(' => pd += 1, b')' => { pd -= 1; if pd == 0 && bd == 0 && cd == 0 { closed = Some(i + 1); break; } }
                b'[' => bd += 1, b']' => bd = bd.saturating_sub(1),
                b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
                _ => {}
            }
            i += 1;
        }
        let Some(end) = closed else { return t; };
        s = &rest[end..];
    }
}

pub(crate) fn strip_ts_stmt_labels(mut s: &str) -> &str {
    loop {
        let t = crate::r5::snippet_ts_ret::strip_switch_case_labels(s);
        let after_ctrl = peel_ts_ctrl_hdrs(t);
        let Some(c) = after_ctrl.find(':') else { return t; };
        if after_ctrl.as_bytes().get(c + 1) == Some(&b':') { return t; }
        let lbl = after_ctrl[..c].trim();
        if !crate::r5::snippet_ts_gen_ctx::is_valid_ts_ident(lbl)
            || matches!(lbl, "return" | "throw" | "yield" | "await" | "typeof" | "void" | "delete"
                | "new" | "else" | "if" | "for" | "while" | "do" | "switch" | "try" | "catch"
                | "finally" | "const" | "let" | "var" | "class" | "function" | "export" | "import")
        { return t; }
        s = &after_ctrl[c + 1..];
    }
}

pub(crate) fn has_invalid_ts_multiline_asi_lt(tail: &str) -> bool {
    let (b, mut i, mut pd, mut bd, mut cd, mut cand, mut lt_d) = (tail.as_bytes(), 0usize, 0usize, 0usize, 0usize, None, 0usize);
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1, b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'\n' if pd == 0 && bd == 0 && cd == 0 => {
                let rest = &tail[i + 1..];
                let lt = i + 1 + (rest.len() - rest.trim_start_matches([' ', '\t']).len());
                if b.get(lt) == Some(&b'<') && !matches!(b.get(lt + 1), Some(b'<' | b'=')) { cand = Some((i, lt)); lt_d = 0; }
            }
            b'<' if pd == 0 && bd == 0 && cd == 0 && cand.is_some() => {
                if matches!(b.get(i + 1), Some(b'=' | b'<')) { i += 2; continue; }
                lt_d += 1;
            }
            b'>' if pd == 0 && bd == 0 && cd == 0 && cand.is_some() && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => {
                lt_d = lt_d.saturating_sub(1);
                if lt_d == 0 { cand = None; }
            }
            _ => {}
        }
        i += 1;
    }
    let Some((nl, lt_pos)) = cand else { return false; };
    let after_lt = &tail[lt_pos + 1..];
    if after_lt.trim().is_empty() || lt_d == 0 || ts_generic_default_ok(&tail[..nl], false, TsGenMemberCtx::None) { return false; }
    let gen_like = crate::r5::snippet_ts_gen::is_ts_unclosed_generic_type_ctx(&tail[lt_pos..], TsGenMemberCtx::None, false, false)
        || (after_lt.trim_end().ends_with(',') && !crate::r5::snippet_ts_gen_chk::has_depth0_non_method_op(after_lt));
    gen_like && (!stmt_starts_var_decl(&tail[..nl]) || !after_lt.contains(',')
        || crate::r5::snippet_ts_gen::is_ts_unclosed_generic_type_ctx(tail, TsGenMemberCtx::None, false, false))
}
