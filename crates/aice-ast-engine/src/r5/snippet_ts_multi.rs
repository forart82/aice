use aice_lang_registry::LanguageId;

use crate::r5::snippet_container::PrefixContainer;
use crate::r5::snippet_container_compat::unclosed_delim_positions_raw;
use crate::r5::snippet_hdr::trim_after_last_sep;
use crate::r5::snippet_synth::strip_comments_strings;
use crate::r5::snippet_ts_cls::{
    is_non_ctrl_words, is_ts_class_static_block, is_ts_iface_sig_hdr,
    is_ts_obj_method_body_hdr, ts_class_member_tail,
};
use crate::r5::snippet_ts_expr::is_ts_quoted_method_hdr;
use crate::r5::snippet_ts_gen_chk::has_depth0_non_method_op;
use crate::r5::snippet_ts_gen_ctx::TsGenMemberCtx;
use crate::r5::snippet_ts_hdr::{is_decorator_call_hdr, is_ts_obj_shorthand_method_hdr};
use crate::r5::snippet_ts_ret::unclosed_delim_positions;
use crate::r5::snippet_ts_type::{
    has_depth0_assign_outside_angles, has_obj_prop_colon_before_angle,
    is_ts_type_annotation_tail_with_raw, is_ts_type_bracket_hdr_in_ctx,
    tail_after_depth0_comma,
};
use crate::r5::snippet_type_body::{TB_IFACE, TB_PARAM};

#[derive(Clone, Copy, PartialEq, Eq)]
enum TsLevel {
    TsTypeParam,
    TsTypeBody,
    TsClassBody,
    TsTypeDelim,
    ValueParen,
    ValueBrace,
    ValueBracket,
    StmtBlock,
}

fn has_kw(seg: &str, kw: &str) -> bool {
    seg.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').any(|w| w == kw)
}
pub(crate) fn ts_multi_delim_cands(
    lang: LanguageId, raw: &str, clean: &str, delims: &[u8], indent: &str, pctx: PrefixContainer,
) -> Option<Vec<Vec<String>>> {
    let unclosed = unclosed_delim_positions(clean);
    if unclosed.len() != delims.len() || unclosed.is_empty() { return None; }
    let raw_unclosed = unclosed_delim_positions_raw(lang, raw);
    let same_raw = raw_unclosed.len() == unclosed.len();
    let is_ts = matches!(lang, LanguageId::TypeScript | LanguageId::Tsx);
    let parent_is_type_delim = matches!(pctx, PrefixContainer::TypeBracket | PrefixContainer::TypeParen);
    let parent_in_type_member = matches!(
        pctx, PrefixContainer::TypeBody(TB_IFACE | TB_PARAM) | PrefixContainer::ClassOrTraitBody
    );
    let parent_in_val_paren = pctx == PrefixContainer::ValueParen;
    let pre_first = trim_after_last_sep(&clean[..unclosed[0].1]).trim();
    let pre_first_raw = if same_raw { &raw[..raw_unclosed[0].1] } else { pre_first };
    let parent_member_ctx = match pctx {
        PrefixContainer::TypeBody(TB_IFACE) => TsGenMemberCtx::IfaceType,
        PrefixContainer::TypeBody(TB_PARAM) | PrefixContainer::ClassOrTraitBody => TsGenMemberCtx::ClassOrType,
        PrefixContainer::ValueBrace => TsGenMemberCtx::ObjBrace,
        _ => TsGenMemberCtx::None,
    };
    if is_ts && matches!(delims[0], b'[' | b'(')
        && ((parent_in_type_member
            && is_ts_type_annotation_tail_with_raw(pre_first, Some(pre_first_raw), parent_member_ctx, true, false))
            || is_ts_type_bracket_hdr_in_ctx(pre_first, parent_is_type_delim, parent_in_val_paren))
    {
        let mut lines = vec![format!("{indent}type _T = {}", delims[0] as char)];
        for &d in &delims[1..] { lines.push((d as char).to_string()); }
        return Some(vec![lines]);
    }
    let mut cur = match pctx {
        PrefixContainer::TypeBracket | PrefixContainer::TypeParen => TsLevel::TsTypeDelim,
        PrefixContainer::TypeBody(TB_IFACE) => TsLevel::TsTypeBody,
        PrefixContainer::TypeBody(TB_PARAM) => TsLevel::TsTypeParam,
        PrefixContainer::ClassOrTraitBody => TsLevel::TsClassBody,
        PrefixContainer::ValueParen => TsLevel::ValueParen,
        PrefixContainer::ValueBrace => TsLevel::ValueBrace,
        PrefixContainer::ValueBracket => TsLevel::ValueBracket,
        _ => TsLevel::StmtBlock,
    };
    let (mut levels, mut async_flags, mut static_blk_flags, mut ts_cands, mut has_missing_arrow) = (
        Vec::with_capacity(unclosed.len()),
        Vec::with_capacity(unclosed.len()),
        Vec::with_capacity(unclosed.len()),
        Vec::<Vec<String>>::new(),
        false,
    );
    for k in 0..unclosed.len() {
        let seg_raw = if k == 0 { &clean[..unclosed[0].1] } else { &clean[unclosed[k - 1].1 + 1..unclosed[k].1] };
        let raw_seg = if same_raw {
            if k == 0 { &raw[..raw_unclosed[0].1] } else { &raw[raw_unclosed[k - 1].1 + 1..raw_unclosed[k].1] }
        } else { seg_raw };
        let seg = trim_after_last_sep(seg_raw).trim();
        let (mem_seg, mem_raw) = if cur == TsLevel::TsClassBody {
            ts_class_member_tail(seg, raw_seg)
        } else {
            (seg, raw_seg)
        };
        let comma_tail = tail_after_depth0_comma(seg).trim();
        let in_type_delim = cur == TsLevel::TsTypeDelim;
        let in_type_member = matches!(cur, TsLevel::TsTypeParam | TsLevel::TsTypeBody | TsLevel::TsClassBody);
        let (in_val_paren, in_val_brace) = (cur == TsLevel::ValueParen, cur == TsLevel::ValueBrace);
        let member_ctx = match cur {
            TsLevel::TsTypeBody => TsGenMemberCtx::IfaceType,
            TsLevel::TsTypeParam | TsLevel::TsClassBody => TsGenMemberCtx::ClassOrType,
            TsLevel::ValueBrace => TsGenMemberCtx::ObjBrace,
            _ => TsGenMemberCtx::None,
        };
        let (tail_seg, tail_raw) = if cur == TsLevel::TsClassBody { (mem_seg, mem_raw) } else { (seg, raw_seg) };
        let is_type_tail = is_ts
            && is_ts_type_annotation_tail_with_raw(tail_seg, Some(tail_raw), member_ctx, true, in_val_paren);
        let is_bracket_type = in_type_delim
            || (is_type_tail && (in_type_member || in_val_paren || !has_obj_prop_colon_before_angle(seg)));
        let mut is_static_blk = false;
        let next = match delims[k] {
            b'[' => {
                if is_bracket_type {
                    if k >= 1 && is_type_tail {
                        let mut lines = vec![format!("{indent}type _T = [")];
                        for &d in &delims[k + 1..] { lines.push((d as char).to_string()); }
                        ts_cands.push(lines);
                    }
                    TsLevel::TsTypeDelim
                } else { TsLevel::ValueBracket }
            }
            b'(' => {
                if is_bracket_type {
                    if k >= 1 && is_type_tail {
                        let mut lines = vec![format!("{indent}type _T = (")];
                        for &d in &delims[k + 1..] { lines.push((d as char).to_string()); }
                        ts_cands.push(lines);
                    }
                    TsLevel::TsTypeDelim
                } else {
                    let quoted_m = is_ts_quoted_method_hdr(raw_seg, cur == TsLevel::TsClassBody);
                    let is_param = has_kw(comma_tail, "function")
                        || (cur == TsLevel::TsTypeBody && (is_ts_iface_sig_hdr(seg) || quoted_m))
                        || (cur == TsLevel::TsClassBody && (quoted_m || (!has_depth0_assign_outside_angles(mem_seg)
                            && is_non_ctrl_words(mem_seg) && !mem_seg.is_empty() && !is_decorator_call_hdr(mem_seg))))
                        || (cur == TsLevel::TsTypeParam && !has_depth0_assign_outside_angles(seg)
                            && is_non_ctrl_words(seg) && !seg.is_empty() && !is_decorator_call_hdr(seg))
                        || (in_val_brace && (is_ts_obj_shorthand_method_hdr(seg) || quoted_m));
                    if is_param { TsLevel::TsTypeParam } else { TsLevel::ValueParen }
                }
            }
            _ => {
                let is_brace_type = in_type_delim || is_type_tail || (is_ts && has_kw(comma_tail, "interface"))
                    || (cur == TsLevel::TsTypeBody && !has_depth0_assign_outside_angles(seg) && seg.ends_with("=>"));
                if is_brace_type {
                    if k >= 1 && is_type_tail {
                        let mut lines = vec![format!("{indent}interface _I {{")];
                        for &d in &delims[k + 1..] { lines.push((d as char).to_string()); }
                        ts_cands.push(lines);
                    }
                    TsLevel::TsTypeBody
                } else if !comma_tail.trim_end().ends_with(':') && has_kw(comma_tail, "class") {
                    TsLevel::TsClassBody
                } else if is_ts && (has_kw(comma_tail, "namespace") || has_kw(comma_tail, "module")) {
                    TsLevel::TsTypeBody
                } else if cur == TsLevel::TsClassBody && is_ts_class_static_block(mem_seg) {
                    is_static_blk = true;
                    TsLevel::StmtBlock
                } else if (!comma_tail.trim_end().ends_with(':') && has_kw(comma_tail, "function"))
                    || seg.ends_with("=>")
                    || (in_val_brace && is_ts_obj_method_body_hdr(seg, raw_seg, false))
                    || (cur == TsLevel::TsClassBody && is_ts_obj_method_body_hdr(mem_seg, mem_raw, true))
                {
                    TsLevel::StmtBlock
                } else if crate::r5::snippet_hdr_ts::is_ts_js_missing_arrow_fn_hdr(seg) {
                    has_missing_arrow = true;
                    TsLevel::StmtBlock
                } else if matches!(cur, TsLevel::ValueParen | TsLevel::ValueBrace | TsLevel::ValueBracket)
                    || (has_depth0_assign_outside_angles(comma_tail) && !(is_ts && has_kw(comma_tail, "type"))
                        && !crate::r5::snippet_ts_gen_ambig::is_ts_var_decl_lt_without_assign(lang, seg))
                {
                    TsLevel::ValueBrace
                } else { TsLevel::StmtBlock }
            }
        };
        async_flags.push(has_kw(comma_tail, "async"));
        static_blk_flags.push(is_static_blk);
        levels.push(next);
        cur = next;
    }
    if has_missing_arrow { return Some(Vec::new()); }
    if !ts_cands.is_empty() { ts_cands.reverse(); return Some(ts_cands); }
    let needs_runtime_rewrite = (0..delims.len().saturating_sub(1)).any(|i| levels[i] == TsLevel::ValueBrace)
        || (1..delims.len()).any(|i| delims[i] == b'{' && matches!(levels[i], TsLevel::StmtBlock | TsLevel::TsClassBody));
    if !needs_runtime_rewrite { return None; }
    let mut lines = Vec::with_capacity(delims.len());
    for (idx, &d) in delims.iter().enumerate() {
        let pad = if idx == 0 { indent } else { "" };
        let key = if idx > 0 && levels[idx - 1] == TsLevel::ValueBrace { "_a: " } else { "" };
        match d {
            b'(' => lines.push(if key.is_empty() { format!("{pad}_aice_(") } else { format!("{pad}{key}(") }),
            b'[' => lines.push(format!("{pad}{key}[")),
            _ if levels[idx] == TsLevel::TsClassBody => lines.push(format!("{pad}{key}class _C {{")),
            _ if levels[idx] == TsLevel::StmtBlock => {
                if idx > 0 && levels[idx - 1] == TsLevel::TsClassBody {
                    if static_blk_flags[idx] {
                        lines.push(format!("{pad}static {{"));
                    } else {
                        let kw = if async_flags[idx] { "async " } else { "" };
                        lines.push(format!("{pad}{kw}_aice_() {{"));
                    }
                } else {
                    let kw = if async_flags[idx] { "async function" } else { "function" };
                    lines.push(format!("{pad}{key}{kw} _aice_() {{"));
                }
            }
            _ if idx == 0 => lines.push(format!("{pad}const _v = {{")),
            _ => lines.push(format!("{pad}{key}{{")),
        }
    }
    Some(vec![lines])
}

pub(crate) fn ts_single_opener_cands(
    lang: LanguageId,
    raw_hdr: &str,
    clean: &str,
    words: &[&str],
    delim: u8,
    indent: &str,
    pctx: PrefixContainer,
) -> Vec<Vec<String>> {
    let parent_in_ts_type = matches!(
        pctx,
        PrefixContainer::TypeBracket | PrefixContainer::TypeParen
            | PrefixContainer::TypeBody(TB_IFACE | TB_PARAM) | PrefixContainer::ClassOrTraitBody
    );
    let parent_in_val_paren = pctx == PrefixContainer::ValueParen;
    if delim == b'(' {
        let unclosed_pos = unclosed_delim_positions(clean).last().map(|&(_, p)| p);
        if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx)
            && let Some(pos) = unclosed_pos
            && is_ts_type_bracket_hdr_in_ctx(
                clean[..pos].trim_end(),
                matches!(pctx, PrefixContainer::TypeBracket | PrefixContainer::TypeParen),
                parent_in_val_paren,
            )
        {
            return vec![vec![format!("{indent}type _T = (")]];
        }
        if words.contains(&"function") {
            return vec![vec![format!("{indent}function _aice_(")]];
        }
        let pre_paren = clean.trim_end().strip_suffix('(').unwrap_or(clean).trim_end();
        let raw_pre = raw_hdr.trim_end().strip_suffix('(').unwrap_or(raw_hdr).trim_end();
        if pctx == PrefixContainer::ClassOrTraitBody {
            let nl_clean = strip_comments_strings(lang, raw_pre, true);
            let (ms, mr) = ts_class_member_tail(trim_after_last_sep(&nl_clean).trim(), raw_pre);
            let quoted_m = is_ts_quoted_method_hdr(mr, true);
            let dec_call = is_decorator_call_hdr(ms) && !quoted_m;
            if (!quoted_m && (has_depth0_assign_outside_angles(ms) || has_depth0_non_method_op(ms))) || dec_call {
                return Vec::new();
            }
            return vec![vec![format!("{indent}_aice_(")]];
        }
        let quoted_m = is_ts_quoted_method_hdr(raw_pre, false);
        let dec_call = is_decorator_call_hdr(pre_paren) && !quoted_m;
        if (!quoted_m && (has_depth0_assign_outside_angles(pre_paren) || has_depth0_non_method_op(pre_paren))) || dec_call {
            return Vec::new();
        }
        return vec![vec![format!("{indent}_aice_(")]];
    }
    let unclosed_pos = unclosed_delim_positions(clean).last().map(|&(_, p)| p);
    if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx)
        && let Some(pos) = unclosed_pos
        && is_ts_type_bracket_hdr_in_ctx(clean[..pos].trim_end(), parent_in_ts_type, parent_in_val_paren)
    {
        return vec![vec![format!("{indent}type _T = [")]];
    }
    if has_depth0_assign_outside_angles(clean) {
        return Vec::new();
    }
    vec![vec![format!("{indent}[")]]
}
