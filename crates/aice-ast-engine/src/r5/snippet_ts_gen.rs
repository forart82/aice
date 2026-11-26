use aice_lang_registry::LanguageId;
use crate::r5::snippet_synth::strip_comments_strings;
use crate::r5::snippet_ts_gen_ambig::is_attached_generic_callee;
pub(crate) use crate::r5::snippet_ts_brace::refine_ts_ambig_brace_ctx;
use crate::r5::snippet_ts_gen_chk::{
    all_depth0_params_valid, has_depth0_assign_or_type_colon, has_ts_type_signal,
    is_ts_asi_frame_reset, pre_lt_has_cmp_ctx, ts_anon_generic_ok, ts_generic_default_ok,
    ts_paren_type_ok,
};
use crate::r5::snippet_ts_gen_ctx::{
    TsGenMemberCtx, has_assign_with_rhs_before_lt, is_single_lower_ident,
    last_depth0_assign_pos, last_expr_rhs_slice, pre_lt_has_heritage_kw, stmt_starts_var_decl,
};
pub(crate) fn is_ts_unclosed_generic_type_ctx(seg: &str, member_ctx: TsGenMemberCtx, has_prior_comma: bool, in_var_decl_prefix: bool) -> bool {
    is_ts_unclosed_generic_type_ctx_in(seg, member_ctx, has_prior_comma, in_var_decl_prefix, false, false)
}
pub(crate) fn is_ts_unclosed_generic_type_ctx_in(seg: &str, member_ctx: TsGenMemberCtx, has_prior_comma: bool, in_var_decl_prefix: bool, in_expr_list: bool, in_val_paren: bool) -> bool {
    let b = seg.as_bytes();
    let (mut i, mut pd, mut bd, mut cd, mut stmt_cut, mut last_comma, mut had_cmp_or_arith) = (0usize, 0usize, 0usize, 0usize, 0usize, 0usize, false);
    let (mut has_cmp_comma, mut var_decl_active) = (false, in_var_decl_prefix || stmt_starts_var_decl(seg));
    let mut frames: Vec<(usize, usize, bool, bool, usize, bool, bool)> = Vec::new();
    let mut trailing_colon_ok = false;
    let is_id = |c: u8| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$');
    let gen_def_ok = |p: &str, att: bool| crate::r5::snippet_ts_gen_ctx::allows_generic_default_before_lt_in(p, att, member_ctx, false, in_val_paren)
        || (member_ctx == TsGenMemberCtx::None && !att && (ts_anon_generic_ok(p) || crate::r5::snippet_ts_gen_chk::prev_is_ctrl_hdr(p)));
    let is_cmp_head = |fs: &[(usize, usize, bool, bool, usize, bool, bool)], cur_i: usize, cut: usize, v_act: bool, cmp_sep: bool| {
        let in_v = v_act || stmt_starts_var_decl(&seg[..fs[0].0]);
        let p_lt = &seg[cut..fs[0].0];
        let p_end_paren = p_lt.trim_end().ends_with([')', ']']);
        let expr_like = is_single_lower_ident(p_lt) || p_end_paren;
        let allow_ident = !(cmp_sep && expr_like) && !(in_expr_list && expr_like);
        let allow_lit = allow_ident && !in_expr_list && !cmp_sep;
        let sig_ok = if p_end_paren && (cmp_sep || in_expr_list) { ts_paren_type_ok(&seg[fs[0].0 + 1..cur_i]) } else { has_ts_type_signal(&seg[fs[0].0 + 1..cur_i], fs[0].5, false, false) };
        !fs.is_empty()
            && ((in_v && !has_depth0_assign_or_type_colon(p_lt))
                || (in_v && !fs[0].2 && fs[0].5
                    && (expr_like || !seg[cur_i + 1..].trim().is_empty())
                    && has_assign_with_rhs_before_lt(p_lt)
                    && !has_ts_type_signal(&seg[fs[0].0 + 1..cur_i], true, allow_ident, allow_lit))
                || (!fs[0].2
                    && ((!fs[0].5 && !ts_anon_generic_ok(p_lt) && !is_ts_generic_decl_head_in(p_lt, member_ctx, false, in_val_paren)
                        && ((member_ctx == TsGenMemberCtx::None && !in_val_paren) || !gen_def_ok(p_lt, false)))
                        || (!sig_ok && expr_like && (cmp_sep || pre_lt_has_cmp_ctx(p_lt, in_v))))))
    };
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1, b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'\n' if pd == 0 && bd == 0 && cd == 0 && !frames.is_empty() => {
                if is_ts_asi_frame_reset(&seg[stmt_cut..i], &seg[i + 1..], member_ctx) {
                    frames.clear();
                    stmt_cut = i + 1;
                    last_comma = i + 1;
                    had_cmp_or_arith = false;
                    has_cmp_comma = false;
                    var_decl_active = stmt_starts_var_decl(&seg[i + 1..]);
                }
            }
            b';' if pd == 0 && bd == 0 && cd == 0 && !frames.is_empty() => return false,
            b'&' | b'|' if pd == 0 && bd == 0 && cd == 0 && !frames.is_empty() && b.get(i + 1) == Some(&b[i]) => {
                frames.clear(); had_cmp_or_arith = true; i += 2; continue;
            }
            b'!' if pd == 0 && bd == 0 && cd == 0 && !frames.is_empty() && b.get(i + 1) == Some(&b'=') => {
                frames.clear(); had_cmp_or_arith = true; i += 2; continue;
            }
            b'+' | b'*' | b'/' | b'%' if pd == 0 && bd == 0 && cd == 0 && !frames.is_empty() => {
                frames.clear(); had_cmp_or_arith = true; i += 1; continue;
            }
            b'-' if pd == 0 && bd == 0 && cd == 0 && !frames.is_empty() && b.get(i + 1) != Some(&b'>') => {
                let prev_nw = seg[..i].bytes().rfind(|c| !c.is_ascii_whitespace());
                if matches!(prev_nw, Some(c) if is_id(c) || matches!(c, b')' | b']' | b'>')) {
                    frames.clear(); had_cmp_or_arith = true; i += 1; continue;
                }
            }
            b'<' if pd == 0 && bd == 0 && cd == 0 => {
                if matches!(b.get(i + 1), Some(b'=' | b'<')) {
                    if !frames.is_empty() { frames.clear(); had_cmp_or_arith = true; }
                    i += 2;
                    continue;
                }
                if !frames.is_empty() && frames[0].6 && last_comma > frames[0].0
                    && seg[last_comma..i].trim_end().ends_with([')', ']'])
                {
                    frames.clear();
                    stmt_cut = last_comma;
                    had_cmp_or_arith = false;
                    if !var_decl_active { has_cmp_comma = true; }
                }
                let attached = is_attached_generic_callee(seg, i, member_ctx);
                frames.push((i, i + 1, false, false, 0, attached, false));
            }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => {
                if b.get(i + 1) == Some(&b'=') && frames.is_empty() { i += 2; continue; }
                frames.pop();
            }
            b',' if pd == 0 && bd == 0 && cd == 0 => {
                last_comma = i + 1;
                if frames.is_empty() {
                    stmt_cut = i + 1;
                    had_cmp_or_arith = false;
                    if !var_decl_active { has_cmp_comma = true; }
                } else if is_cmp_head(&frames, i, stmt_cut, var_decl_active, has_prior_comma || has_cmp_comma || had_cmp_or_arith) {
                    frames.clear();
                    stmt_cut = i + 1;
                    had_cmp_or_arith = false;
                    if !var_decl_active { has_cmp_comma = true; }
                } else if frames.len() == 1 {
                    frames[0].1 = i + 1; frames[0].2 = false; frames[0].3 = false; frames[0].4 = 0; frames[0].6 = true;
                }
            }
            b'e' if pd == 0 && bd == 0 && cd == 0 && !frames.is_empty()
                && b[i..].starts_with(b"extends") && (i == 0 || !is_id(b[i - 1])) && b.get(i + 7).is_none_or(|&c| !is_id(c)) =>
            {
                let is_top = frames.len() == 1;
                let top = frames.last_mut().unwrap();
                if is_top { top.2 = true; } top.3 = true; i += 7; continue;
            }
            b'=' if pd == 0 && bd == 0 && cd == 0 && !frames.is_empty() => {
                let (prev, next) = (i.checked_sub(1).and_then(|k| b.get(k)).copied(), b.get(i + 1).copied());
                if matches!(prev, Some(b'=' | b'!' | b'<' | b'>')) || next == Some(b'=') {
                    frames.clear();
                    had_cmp_or_arith = true;
                    if next == Some(b'=') { i += 2; continue; }
                    i += 1;
                    continue;
                }
                if next == Some(b'>') { i += 2; continue; }
                if frames.len() != 1 {
                    let top = *frames.last().unwrap();
                    let prev_lt = frames[frames.len() - 2].0;
                    let between = &seg[prev_lt + 1..top.0];
                    if let Some(sep) = between.rfind([',', '\n']) {
                        let sub_pre = &between[sep + 1..];
                        if ts_generic_default_ok(sub_pre, top.5, member_ctx)
                            && all_depth0_params_valid(&seg[top.0 + 1..i])
                        {
                            frames = vec![(top.0, top.1, true, false, top.4, top.5, false)];
                            i += 1;
                            continue;
                        }
                    }
                    if var_decl_active { frames.clear(); stmt_cut = last_comma; had_cmp_or_arith = false; i += 1; continue; }
                    return false;
                }
                let pre_lt = &seg[stmt_cut..frames[0].0];
                if !gen_def_ok(pre_lt, frames[0].5) { frames.clear(); stmt_cut = last_comma; had_cmp_or_arith = false; i += 1; continue; }
                if all_depth0_params_valid(&seg[frames[0].0 + 1..i]) { frames[0].2 = true; frames[0].3 = false; } else { return false; }
            }
            b'?' if pd == 0 && bd == 0 && cd == 0 && !frames.is_empty() => {
                let top = frames.last_mut().unwrap();
                if top.3 { top.3 = false; top.4 += 1; } else { frames.clear(); }
            }
            b':' if pd == 0 && bd == 0 && cd == 0 && !frames.is_empty() => {
                let top = frames.last_mut().unwrap();
                if top.4 > 0 { top.4 -= 1; if i + 1 == b.len() { trailing_colon_ok = true; } } else { frames.clear(); }
            }
            _ => {}
        }
        i += 1;
    }
    if frames.is_empty() { return false; }
    let pre_lt = &seg[stmt_cut..frames[0].0];
    let in_var_decl = var_decl_active || stmt_starts_var_decl(pre_lt);
    if in_var_decl && !has_depth0_assign_or_type_colon(pre_lt) { return false; }
    let (tail, top_q) = (seg.trim_end(), frames.last().unwrap().4);
    if frames[0].2 {
        return tail.strip_suffix("extends").is_some_and(|p| p.is_empty() || p.ends_with(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')))
            || (tail.ends_with('=') && !tail.ends_with("=="))
            || tail.ends_with(['<', ',', '&', '|', '(', '[']) || tail.ends_with("=>")
            || (tail.ends_with('?') && top_q > 0) || (tail.ends_with(':') && trailing_colon_ok);
    }
    if !frames[0].5 && !ts_anon_generic_ok(pre_lt) && ((member_ctx == TsGenMemberCtx::None && !in_val_paren) || !gen_def_ok(pre_lt, false)) { return false; }
    if !frames[0].5 && pre_lt.split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).rfind(|w| !w.is_empty()) == Some("default") { return false; }
    let expr_like = is_single_lower_ident(pre_lt) || pre_lt.trim_end().ends_with([')', ']']);
    let has_cmp_sep = has_prior_comma || has_cmp_comma || had_cmp_or_arith || pre_lt_has_cmp_ctx(pre_lt, in_var_decl);
    let allow_ident = frames[0].5 && !(expr_like && has_cmp_sep) && !(in_expr_list && expr_like);
    let allow_lit = allow_ident && !in_expr_list && !has_cmp_sep;
    if (frames.len() >= 2 || tail.ends_with(',') || tail.ends_with('<')) && is_ts_generic_decl_head_in(pre_lt, member_ctx, false, in_val_paren) { return false; }
    if tail.ends_with(',') {
        return (frames.len() >= 2 && !frames[0].6)
            || has_ts_type_signal(&seg[frames[0].0 + 1..], frames[0].5, allow_ident, allow_lit)
            || pre_lt_has_heritage_kw(pre_lt);
    }
    tail.ends_with(['<', '&', '|', '(', '[']) || tail.ends_with("=>") || (tail.ends_with('?') && top_q > 0) || (tail.ends_with(':') && trailing_colon_ok)
}

pub(crate) fn has_ts_unclosed_lt_closed_without_gt(lang: LanguageId, prefix_joined: &str, openers: &[(u8, usize, usize)], cand_joined: &str) -> bool {
    if !matches!(lang, LanguageId::TypeScript | LanguageId::Tsx) { return false; }
    let Some(&(_, _, op_byte)) = openers.iter().rev().find(|&&(d, _, _)| d == b'{') else { return false; };
    let prev_op = openers.iter().rev().find(|&&(_, _, b)| b < op_byte).map_or(0, |&(_, _, b)| b + 1);
    let hdr = strip_comments_strings(lang, prefix_joined.get(prev_op..op_byte).unwrap_or(""), false);
    let (mut pd, mut bd, mut cd, mut ad, mut i, hb) = (0usize, 0usize, 0usize, 0usize, 0usize, hdr.as_bytes());
    while i < hb.len() {
        match hb[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1), b'[' => bd += 1, b']' => bd = bd.saturating_sub(1), b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'<' if pd == 0 && bd == 0 && cd == 0 => { if matches!(hb.get(i + 1), Some(b'=' | b'<')) { i += 2; continue; } ad += 1; }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(hb[i - 1], b'-' | b'=')) => ad = ad.saturating_sub(1),
            _ => {}
        }
        i += 1;
    }
    if ad == 0 { return false; }
    let (mut cd, mut saw) = (0isize, false);
    for &c in strip_comments_strings(lang, cand_joined, false).as_bytes() {
        match c { b'{' => cd += 1, b'}' => { cd -= 1; if cd < 0 && !saw { saw = true; cd = 0; } } b'>' if saw && cd == 0 => return false, b';' if saw && cd == 0 => return true, _ => {} }
    }
    false
}

pub(crate) fn ctx_needs_ts_generic_gt(lang: LanguageId, ctx_joined: &str) -> bool {
    if !matches!(lang, LanguageId::TypeScript | LanguageId::Tsx) { return false; }
    let clean = strip_comments_strings(lang, ctx_joined, false);
    let (b, mut i, mut pd, mut bd, mut cd, mut bs, mut lts) = (clean.as_bytes(), 0usize, 0usize, 0usize, 0usize, Vec::new(), Vec::new());
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1), b'[' => bd += 1, b']' => bd = bd.saturating_sub(1),
            b'{' => { bs.push(i + 1); cd += 1; } b'}' => { bs.pop(); cd = cd.saturating_sub(1); }
            b'<' => { if matches!(b.get(i + 1), Some(b'=' | b'<')) { i += 2; continue; } lts.push((pd, bd, cd, i)); }
            b'>' if i == 0 || !matches!(b[i - 1], b'-' | b'=') => if let Some(&(lp, lb, lc, _)) = lts.last() && lp == pd && lb == bd && lc == cd { lts.pop(); },
            _ => {}
        }
        i += 1;
    }
    lts.last().is_some_and(|&(_, _, lcd, lt_pos)| !(lcd >= 1 && bs.iter().rev().copied().find(|&s| s <= lt_pos).is_some_and(|st|
        clean[lt_pos + 1..].split('{').next().is_some_and(|s| s.trim().is_empty()) && crate::r5::snippet_ts_type::has_obj_prop_colon_before_angle(&clean[st..=lt_pos]))))
}
fn ts_decl_words_star(s: &str) -> Option<Vec<&str>> {
    let (b, mut i, mut toks) = (s.as_bytes(), 0usize, Vec::new());
    while i < b.len() {
        if b[i].is_ascii_whitespace() { i += 1; }
        else if b[i] == b'*' { toks.push("*"); i += 1; }
        else if b[i].is_ascii_alphanumeric() || matches!(b[i], b'_' | b'$') {
            let st = i;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || matches!(b[i], b'_' | b'$')) { i += 1; }
            toks.push(&s[st..i]);
        } else { return None; }
    }
    Some(toks)
}
pub(crate) fn is_ts_generic_decl_head(pre_lt: &str, member_ctx: TsGenMemberCtx) -> bool { is_ts_generic_decl_head_in(pre_lt, member_ctx, false, false) }
pub(crate) fn is_ts_generic_decl_head_in(pre_lt: &str, member_ctx: TsGenMemberCtx, in_type_delim: bool, in_val_paren: bool) -> bool {
    use crate::r5::{snippet_ts_brace::has_ts_member_val_prefix, snippet_ts_gen_ctx::{is_ts_type_param_head_tail, is_valid_ts_ident, is_valid_ts_num_member, isolate_asi_tail_before_lt, ts_type_pos_tail_in}, snippet_ts_hdr::{is_balanced_computed_prop, peel_ts_method_modifiers, strip_leading_ts_decorators}};
    let cur = if member_ctx == TsGenMemberCtx::ObjBrace { pre_lt } else { isolate_asi_tail_before_lt(pre_lt, true, member_ctx) };
    if let Some(t_tail) = ts_type_pos_tail_in(cur, member_ctx, in_type_delim, in_val_paren) { return is_ts_type_param_head_tail(t_tail); }
    if member_ctx != TsGenMemberCtx::None {
        if has_ts_member_val_prefix(cur, member_ctx) || (member_ctx.is_class_or_type() && has_depth0_assign_or_type_colon(cur)) { return false; }
        if member_ctx == TsGenMemberCtx::IfaceType && cur.trim().is_empty() { return true; }
        let body = peel_ts_method_modifiers(strip_leading_ts_decorators(cur.trim_start()).trim_start(), member_ctx.is_class_or_type());
        let bare = if member_ctx.is_class_or_type() { body.strip_prefix('#').unwrap_or(body) } else { body };
        return is_valid_ts_ident(bare) || is_balanced_computed_prop(body) || is_valid_ts_num_member(bare);
    }
    let (has_ep, rhs_ep) = last_expr_rhs_slice(cur, true);
    let lhs_first = cur.split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).find(|w| !w.is_empty() && !matches!(*w, "export" | "declare"));
    if has_ep && (rhs_ep.trim() == "async" || (lhs_first == Some("type") && rhs_ep.trim().is_empty())) { return true; }
    let rhs = if has_depth0_assign_or_type_colon(cur) {
        let Some(p) = last_depth0_assign_pos(cur) else { return false; };
        if has_depth0_assign_or_type_colon(&cur[p + 1..]) { return false; }
        let Some(toks) = ts_decl_words_star(cur[p + 1..].trim()) else { return false; };
        let mut idx = usize::from(toks.first() == Some(&"async"));
        if toks.get(idx) == Some(&"function") {
            idx += 1 + usize::from(toks.get(idx + 1) == Some(&"*"));
            return idx == toks.len() || (idx + 1 == toks.len() && is_valid_ts_ident(toks[idx]));
        }
        return idx == 0 && toks.first() == Some(&"class") && (toks.len() == 1 || (toks.len() == 2 && is_valid_ts_ident(toks[1])));
    } else { strip_leading_ts_decorators(cur.trim_start()).trim_start() };
    let Some(toks) = ts_decl_words_star(rhs) else { return false; };
    if toks.last() == Some(&"async") && toks[..toks.len() - 1].iter().all(|w| matches!(*w, "export" | "default" | "declare" | "return" | "throw" | "yield" | "await" | "else")) { return true; }
    let Some(dk) = toks.iter().position(|w| matches!(*w, "function" | "class" | "interface" | "type")) else { return false; };
    let mods_ok = toks[..dk].iter().all(|w| matches!(*w, "export" | "default" | "declare" | "abstract" | "async" | "*"));
    let r = &toks[dk + 1..];
    mods_ok && (r.is_empty() || (toks[dk] == "function" && r == ["*"]) || (r.len() == 1 && is_valid_ts_ident(r[0])) || (toks[dk] == "function" && r.len() == 2 && r[0] == "*" && is_valid_ts_ident(r[1])))
}