use crate::r5::snippet_hdr::{depth0_assign_pos, trim_after_last_sep};
use crate::r5::snippet_ts_cls::clean_ts_preserving_quoted_method_lt;
use crate::r5::snippet_ts_gen::is_ts_unclosed_generic_type_ctx_in;
use crate::r5::snippet_ts_gen_ctx::{
    TsGenMemberCtx, isolate_asi_tail_before_lt, stmt_starts_var_decl,
};
use crate::r5::snippet_ts_ret::{is_ts_ret_type_colon, strip_switch_case_labels};

pub(crate) fn is_ts_type_alias_hdr(_hdr: &str, words: &[&str], has_assign: bool) -> bool {
    has_assign
        && !words.contains(&"function")
        && words
            .iter()
            .find(|&&w| !matches!(w, "export" | "declare"))
            .is_some_and(|&w| w == "type")
}

pub(crate) fn has_depth0_assign_outside_angles(s: &str) -> bool {
    let b = s.as_bytes();
    let (mut i, mut pd, mut bd, mut cd, mut ad) = (0usize, 0usize, 0usize, 0usize, 0usize);
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1), b'[' => bd += 1, b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'<' if pd == 0 && bd == 0 && cd == 0 => { if b.get(i + 1) == Some(&b'=') { i += 2; continue; } ad += 1; }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => ad = ad.saturating_sub(1),
            b'=' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => {
                let (prev, next) = (i.checked_sub(1).and_then(|k| b.get(k)).copied(), b.get(i + 1).copied());
                if !matches!(prev, Some(b'=' | b'!' | b'<' | b'>')) && !matches!(next, Some(b'=' | b'>')) { return true; }
            }
            _ => {}
        }
        i += 1;
    }
    false
}

pub(crate) fn tail_after_depth0_comma(s: &str) -> &str {
    let b = s.as_bytes();
    let (mut i, mut pd, mut bd, mut cd, mut ad, mut last) = (0usize, 0usize, 0usize, 0usize, 0usize, 0usize);
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1,
            b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1,
            b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1,
            b'}' => cd = cd.saturating_sub(1),
            b'<' if pd == 0 && bd == 0 && cd == 0 => {
                if b.get(i + 1) == Some(&b'=') { i += 2; continue; }
                ad += 1;
            }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => {
                ad = ad.saturating_sub(1);
            }
            b',' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => last = i + 1,
            _ => {}
        }
        i += 1;
    }
    &s[last..]
}

pub(crate) fn first_depth0_type_colon(seg: &str) -> Option<usize> {
    let b = seg.as_bytes();
    let (mut i, mut pd, mut bd, mut cd, mut ad) = (0usize, 0usize, 0usize, 0usize, 0usize);
    let mut saw_q = None;
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1,
            b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1,
            b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1,
            b'}' => cd = cd.saturating_sub(1),
            b'<' if pd == 0 && bd == 0 && cd == 0 => {
                if b.get(i + 1) == Some(&b'=') { i += 2; continue; }
                ad += 1;
            }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => {
                ad = ad.saturating_sub(1);
            }
            b'?' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => saw_q = Some(i),
            b':' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => {
                if b.get(i + 1) == Some(&b':') { i += 2; continue; }
                if let Some(q) = saw_q && !seg[q + 1..i].trim().is_empty() {
                    return None;
                }
                return Some(i);
            }
            _ => {}
        }
        i += 1;
    }
    None
}


pub(crate) fn is_ts_type_annotation_tail_in_ctx(
    hdr: &str,
    in_type_member_ctx: bool,
    allow_bare_colon: bool,
    in_val_paren: bool,
) -> bool {
    let ctx = if in_type_member_ctx { TsGenMemberCtx::ClassOrType } else { TsGenMemberCtx::None };
    is_ts_type_annotation_tail_with_raw(hdr, None, ctx, allow_bare_colon, in_val_paren)
}

pub(crate) fn is_ts_type_annotation_tail_with_raw(
    hdr: &str, raw_hdr: Option<&str>, member_ctx: TsGenMemberCtx, allow_bare_colon: bool, in_val_paren: bool,
) -> bool {
    is_ts_type_annotation_tail_impl(hdr, raw_hdr, member_ctx, allow_bare_colon, in_val_paren, in_val_paren)
}

pub(crate) fn is_ts_type_annotation_tail_in_list(
    hdr: &str, raw_hdr: Option<&str>, member_ctx: TsGenMemberCtx, allow_bare_colon: bool, in_val_paren: bool, in_expr_list: bool,
) -> bool {
    is_ts_type_annotation_tail_impl(hdr, raw_hdr, member_ctx, allow_bare_colon, in_val_paren, in_expr_list)
}

fn is_ts_type_annotation_tail_impl(
    hdr: &str,
    raw_hdr: Option<&str>,
    member_ctx: TsGenMemberCtx,
    allow_bare_colon: bool,
    in_val_paren: bool,
    in_expr_list: bool,
) -> bool {
    if is_ts_ret_type_colon(hdr) {
        return true;
    }
    let preserved;
    let eff_hdr = if hdr.contains('<') && let Some(raw) = raw_hdr && raw.contains(['"', '\'', '`', '/']) {
        preserved = clean_ts_preserving_quoted_method_lt(raw, member_ctx);
        trim_after_last_sep(&preserved).trim()
    } else {
        hdr
    };
    let in_type_member_ctx = member_ctx.is_class_or_type();
    let asi_hdr = if member_ctx == TsGenMemberCtx::None {
        isolate_asi_tail_before_lt(eff_hdr, true, member_ctx)
    } else {
        eff_hdr
    };
    let in_var_decl_stmt = member_ctx == TsGenMemberCtx::None && stmt_starts_var_decl(asi_hdr);
    let raw_seg = tail_after_depth0_comma(asi_hdr);
    let seg = if member_ctx != TsGenMemberCtx::None { raw_seg } else if in_val_paren { strip_switch_case_labels(raw_seg) } else { crate::r5::snippet_ts_gen_ambig::strip_ts_stmt_labels(raw_seg) };
    let seg_words: Vec<&str> = seg
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .filter(|w| !w.is_empty())
        .collect();
    if is_ts_type_alias_hdr(seg, &seg_words, depth0_assign_pos(seg).is_some())
        || is_ts_unclosed_generic_type_ctx_in(
            seg,
            member_ctx,
            raw_seg.len() < asi_hdr.len() && !in_var_decl_stmt,
            in_var_decl_stmt,
            in_expr_list,
            in_val_paren,
        )
    {
        return true;
    }
    if has_depth0_assign_outside_angles(seg) {
        return false;
    }
    let has_decl_kw = seg_words
        .iter()
        .find(|&&w| !matches!(w, "export" | "declare"))
        .is_some_and(|&w| matches!(w, "let" | "const" | "var"));
    let Some(colon) = first_depth0_type_colon(seg) else {
        return false;
    };
    if seg[..colon].trim_end().ends_with(')') {
        return false;
    }
    let after = seg[colon + 1..].trim();
    if after.is_empty() {
        return has_decl_kw || ((in_type_member_ctx || in_val_paren) && allow_bare_colon);
    }
    if !(in_type_member_ctx || in_val_paren || has_decl_kw) {
        return false;
    }
    let b = after.as_bytes();
    let (mut i, mut pd, mut bd, mut cd) = (0usize, 0usize, 0usize, 0usize);
    let mut frames: Vec<(u8, bool, usize)> = vec![(0, false, 0)];
    let mut trailing_colon_ok = false;
    let is_id = |c: u8| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$');
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1,
            b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1,
            b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1,
            b'}' => cd = cd.saturating_sub(1),
            b'<' if pd == 0 && bd == 0 && cd == 0 => {
                if b.get(i + 1) == Some(&b'=') { i += 2; continue; }
                frames.push((b'<', false, 0));
            }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => {
                if frames.len() > 1 { frames.pop(); }
            }
            b'e' if pd == 0 && bd == 0 && cd == 0 && b[i..].starts_with(b"extends")
                && (i == 0 || !is_id(b[i - 1]))
                && b.get(i + 7).is_none_or(|&c| !is_id(c)) =>
            {
                frames.last_mut().unwrap().1 = true;
                i += 7;
                continue;
            }
            b'?' if pd == 0 && bd == 0 && cd == 0 => {
                let top = frames.last_mut().unwrap();
                if top.1 { top.1 = false; top.2 += 1; }
            }
            b':' if pd == 0 && bd == 0 && cd == 0 => {
                let top = frames.last_mut().unwrap();
                if top.2 > 0 {
                    top.2 -= 1;
                    if i + 1 == b.len() { trailing_colon_ok = true; }
                }
            }
            _ => {}
        }
        i += 1;
    }
    if frames.len() > 1 {
        return after.ends_with(['<', ',', '&', '|', '(', '[', ':', '?']) || after.ends_with("=>");
    }
    after.ends_with("=>")
        || after.ends_with(['&', '|'])
        || (after.ends_with('?') && frames[0].2 > 0)
        || (after.ends_with(':') && trailing_colon_ok)
}
pub(crate) fn has_obj_prop_colon_before_angle(hdr: &str) -> bool {
    let seg = tail_after_depth0_comma(hdr);
    if is_ts_ret_type_colon(hdr) || is_ts_ret_type_colon(seg) {
        return false;
    }
    let has_decl_kw = seg
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .filter(|w| !w.is_empty())
        .find(|&w| !matches!(w, "export" | "declare"))
        .is_some_and(|w| matches!(w, "let" | "const" | "var"));
    !has_decl_kw
        && first_depth0_type_colon(seg)
            .is_some_and(|c| !seg[..c].trim_end().ends_with(')') && seg[c + 1..].contains('<'))
}

pub(crate) fn is_ts_type_bracket_hdr_in_ctx(
    hdr: &str,
    parent_is_type: bool,
    in_val_paren: bool,
) -> bool {
    if parent_is_type {
        return true;
    }
    if (in_val_paren || !has_obj_prop_colon_before_angle(hdr))
        && is_ts_type_annotation_tail_in_ctx(hdr, false, true, in_val_paren)
    {
        return true;
    }
    let clean = hdr.trim_end();
    if clean.ends_with("readonly")
        && clean.strip_suffix("readonly").is_some_and(|pre| {
            pre.is_empty() || pre.ends_with(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        })
    {
        return is_ts_type_annotation_tail_in_ctx(
            clean.strip_suffix("readonly").unwrap_or("").trim_end(),
            false,
            true,
            in_val_paren,
        );
    }
    false
}
