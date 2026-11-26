use std::path::Path;

use aice_lang_registry::LanguageId;
use crate::r5::checks::collect_r5_error_spans;
use crate::r5::snippet_blk::find_blk_comment_close;
use crate::r5::snippet_hdr::{has_depth0_arrow, has_depth0_assign};
use crate::r5::snippet_lit::{JsLexState, StepQuote};
use crate::r5::snippet_rs_angle::{
    cand_before_close_angle, cand_closes_rust_angle, has_depth0_single_colon,
    rust_next_code_line, strip_rust_comments_strings, unclosed_rust_angles_after,
};
use crate::r5::snippet_rs_hdr::{
    is_incomplete_rust_item, is_rust_type_item, line_starts_rust_field, line_starts_rust_item,
    line_starts_rust_variant, rust_fn_has_params_or_where,
};
use crate::r5::snippet_rs_tail::{
    ctx_has_fn_decl, rust_ctx_state, rust_enum_tail_ends_with_attr, rust_item_line_start_in,
    rust_scan_container_tail_flags,
};
use crate::ts_pool::ParserPool;

#[allow(clippy::too_many_arguments)]
pub(crate) fn rust_try_trailing_impl_item(
    full_hdr: &str, base_layers: usize, is_impl_trait: bool, in_attr: bool, prefix: &str,
    after_op: usize, cand_joined: &str, suffix_lines: &[&str], path: &Path, pool: &mut ParserPool,
) -> Option<bool> {
    if !is_impl_trait || in_attr { return None; }
    let ls = rust_item_line_start_in(prefix, after_op, prefix.len())?;
    let tail_item = &prefix[ls..];
    let st = rust_ctx_state(tail_item);
    if !st.0.is_empty() || st.1 > 0 {
        return rust_in_ctx_probe(full_hdr, base_layers, is_impl_trait, tail_item, cand_joined, suffix_lines, path, pool);
    }
    if !is_incomplete_rust_item(tail_item) { return None; }
    let (rem_stk, rem_bd, extra_r, comb_unm) = rust_ctx_state(&format!("{tail_item}\n{cand_joined}"));
    if comb_unm || extra_r > base_layers { return Some(false); }
    let ok = |s: &str, p: &mut ParserPool| collect_r5_error_spans(LanguageId::Rust, s, path, p).is_ok_and(|e| e.is_empty());
    let outer_r = "\n}".repeat(base_layers - extra_r);
    if suffix_lines.iter().any(|l| !strip_rust_comments_strings(l).trim().is_empty()) {
        let Some(close_suf) = rust_suffix_close_prefix(&format!("{tail_item}\n{cand_joined}"), suffix_lines, ctx_has_fn_decl(tail_item)) else {
            return Some(false);
        };
        return Some(ok(&format!("{full_hdr}\n{tail_item}\n{cand_joined}\n{close_suf}{outer_r}"), pool));
    }
    let stk_close: String = rem_stk.iter().rev().map(|&d| match d { b'(' => ')', b'[' => ']', _ => '>' }).collect();
    let inner_r = "\n}".repeat(rem_bd);
    let cand_clean = strip_rust_comments_strings(cand_joined);
    let cand_tr = cand_clean.trim_end();
    let mut sufs = vec![""];
    if rem_bd == 0 && !cand_tr.ends_with([';', '}']) {
        sufs.push(";");
        if ctx_has_fn_decl(tail_item) { sufs.push(" {}"); }
    }
    let phs: &[&str] = if cand_tr.ends_with(['+', ',']) { &["", " _T"] } else { &[""] };
    Some(phs.iter().any(|ph| sufs.iter().any(|suf| ok(&format!("{full_hdr}\n{tail_item}\n{cand_joined}{ph}{stk_close}{suf}{inner_r}{outer_r}"), pool))))
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn rust_fresh_cand_verdict(
    full_hdr: &str, base_layers: usize, is_impl_trait: bool, is_enum: bool,
    rem_tail: &str, cand_joined: &str, suffix_lines: &[&str], path: &Path, pool: &mut ParserPool,
) -> Option<bool> {
    let tail_clean = strip_rust_comments_strings(rem_tail);
    if tail_clean.trim_end().ends_with(',') { return None; }
    let (_, saw_eq, has_semi, has_eq) = rust_scan_container_tail_flags(rem_tail, is_enum);
    let enum_attr = is_enum && saw_eq && rust_enum_tail_ends_with_attr(rem_tail);
    if !has_semi && !has_eq && !enum_attr { return None; }
    let next_line = rust_next_code_line(cand_joined, 0)?;
    let fresh = line_starts_rust_item(next_line)
        || (!is_enum && line_starts_rust_field(next_line))
        || (is_enum && (has_semi || enum_attr) && line_starts_rust_variant(next_line, true));
    if !fresh { return None; }
    let (rem_stk, rem_bd, extra_r, comb_unm) = rust_ctx_state(cand_joined);
    if comb_unm { return None; }
    if extra_r > base_layers { return Some(false); }
    let ok = |s: &str, p: &mut ParserPool| collect_r5_error_spans(LanguageId::Rust, s, path, p).is_ok_and(|e| e.is_empty());
    let outer_r = "\n}".repeat(base_layers - extra_r);
    let has_fn = ctx_has_fn_decl(cand_joined);
    if suffix_lines.iter().any(|l| !strip_rust_comments_strings(l).trim().is_empty()) {
        let Some(close_suf) = rust_suffix_close_prefix(cand_joined, suffix_lines, has_fn) else { return Some(false); };
        return Some(ok(&format!("{full_hdr}\n{cand_joined}\n{close_suf}{outer_r}"), pool));
    }
    let mut closers = "\n}".repeat(rem_bd);
    for &d in rem_stk.iter().rev() { closers.push(match d { b'(' => ')', b'[' => ']', _ => '>' }); }
    let cand_clean = strip_rust_comments_strings(cand_joined);
    let cand_tr = cand_clean.trim_end();
    let mut phs = vec![""];
    if (!has_fn || rem_stk.contains(&b'<')) && cand_tr.ends_with(['<', ',', '+']) { phs.push(" _T"); }
    if rem_stk.last() == Some(&b'[') && cand_tr.ends_with(';') { phs.push(" 1"); }
    let sufs: [&str; 2] = if extra_r > 0 || rem_bd > 0 || cand_tr.ends_with(['}', ';']) { ["", ""] }
        else if is_impl_trait && has_fn { [" {}", ";"] } else { ["", ";"] };
    Some(phs.iter().any(|ph| sufs.iter().any(|suf| ok(&format!("{full_hdr}\n{cand_joined}\n{ph}{closers}{suf}{outer_r}"), pool))))
}

pub(crate) fn rust_suffix_close_prefix(ctx_tail: &str, suffix_lines: &[&str], has_fn_decl: bool) -> Option<String> {
    let mut stack = rust_ctx_state(ctx_tail).0;
    let suffix = suffix_lines.join("\n");
    let b = suffix.as_bytes();
    let (mut i, mut js) = (0usize, JsLexState::new());
    let (mut extra_bd, mut extra_pd, mut extra_brd, mut extra_ad) = (0usize, 0usize, 0usize, 0usize);
    let mut brack_semi: Vec<bool> = Vec::new();
    while i < b.len() {
        if b[i] == b'\n' { js.on_newline(LanguageId::Rust); i += 1; continue; }
        if js.step_quote(LanguageId::Rust, b, &mut i) != StepQuote::NotInQuote { continue; }
        if let Some((end, _)) = js.match_special(LanguageId::Rust, b, i) { i = end; continue; }
        if js.open_quote(LanguageId::Rust, b, &mut i) { continue; }
        if b[i..].starts_with(b"//") { while i < b.len() && b[i] != b'\n' { i += 1; } continue; }
        if b[i..].starts_with(b"/*") {
            let (Some(after), _) = find_blk_comment_close(LanguageId::Rust, b, i + 2, 1) else { return None; };
            i = after;
            continue;
        }
        let in_arr_len = brack_semi.iter().any(|&x| x);
        match b[i] {
            b'{' => extra_bd += 1,
            b'}' => {
                if extra_bd > 0 {
                    extra_bd -= 1;
                    if extra_bd == 0 && stack.is_empty() && extra_pd == 0 && extra_brd == 0 && extra_ad == 0 {
                        return Some(suffix[..i + 1].to_string());
                    }
                } else {
                    if !stack.is_empty() || extra_pd > 0 || extra_brd > 0 || extra_ad > 0 { return None; }
                    return Some(suffix[..i].to_string());
                }
            }
            b'(' if extra_bd == 0 => extra_pd += 1,
            b')' if extra_bd == 0 => {
                if extra_pd > 0 { extra_pd -= 1; }
                else if extra_brd == 0 && extra_ad == 0 && stack.last() == Some(&b'(') { stack.pop(); }
                else { return None; }
            }
            b'[' if extra_bd == 0 => { extra_brd += 1; brack_semi.push(false); }
            b']' if extra_bd == 0 => {
                if extra_brd > 0 { extra_brd -= 1; brack_semi.pop(); }
                else if extra_pd == 0 && extra_ad == 0 && stack.last() == Some(&b'[') { stack.pop(); }
                else { return None; }
            }
            b'<' if extra_bd == 0 && extra_pd == 0 && extra_brd == 0 && !in_arr_len => {
                if b.get(i + 1) == Some(&b'=') { i += 2; continue; }
                extra_ad += 1;
            }
            b'>' if extra_bd == 0 && extra_pd == 0 && extra_brd == 0 && !in_arr_len
                && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) =>
            {
                if extra_ad > 0 { extra_ad -= 1; }
                else if stack.last() == Some(&b'<') { stack.pop(); }
                else if !stack.is_empty() { return None; }
            }
            b';' if extra_bd == 0 => {
                if let Some(last) = brack_semi.last_mut() { *last = true; }
                if extra_pd == 0 && extra_brd == 0 && extra_ad == 0 {
                    if stack.is_empty() { return Some(suffix[..i + 1].to_string()); }
                    if stack.last() != Some(&b'[') { return None; }
                }
            }
            b',' if !has_fn_decl && extra_bd == 0 && extra_pd == 0 && extra_brd == 0 && extra_ad == 0 && stack.is_empty() => {
                return Some(suffix[..i + 1].to_string());
            }
            _ => {}
        }
        js.step_byte(LanguageId::Rust, b, &mut i);
    }
    if stack.is_empty() && extra_bd == 0 && extra_pd == 0 && extra_brd == 0 && extra_ad == 0 { Some(suffix) } else { None }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn rust_in_ctx_probe(
    full_hdr: &str,
    base_layers: usize,
    is_impl_trait: bool,
    ctx_tail: &str,
    cand_joined: &str,
    suffix_lines: &[&str],
    path: &Path,
    pool: &mut ParserPool,
) -> Option<bool> {
    let (ctx_stack, ctx_bd, _, ctx_unm) = rust_ctx_state(ctx_tail);
    if ctx_stack.is_empty() && ctx_bd == 0 {
        return None;
    }
    let has_fn_decl = ctx_has_fn_decl(ctx_tail);
    let ctx_clean = strip_rust_comments_strings(ctx_tail);
    let cand_clean = strip_rust_comments_strings(cand_joined);
    if !has_fn_decl && !is_rust_type_item(&ctx_clean) && ctx_stack.last() == Some(&b'<') {
        let lts = unclosed_rust_angles_after(&format!("{{{ctx_clean}"), 0);
        if let Some(&lt1) = lts.last() {
            let lt = lt1 - 1;
            let open_lts = ctx_stack.iter().rev().take_while(|&&d| d == b'<').count();
            let cand_pre_gt = cand_before_close_angle(&cand_clean, open_lts);
            if (has_depth0_single_colon(&ctx_clean[..lt]) || has_depth0_assign(&ctx_clean[..lt]))
                && (has_depth0_single_colon(&ctx_clean[lt + 1..]) || has_depth0_single_colon(cand_pre_gt))
            {
                return Some(false);
            }
        }
    }
    let combined = format!("{ctx_tail}\n{cand_joined}");
    let (rem_stack, rem_bd, extra_rbraces, comb_unm) = rust_ctx_state(&combined);
    if (!ctx_unm && comb_unm) || extra_rbraces > base_layers {
        return Some(false);
    }
    let cand_closes_any = rem_stack.len() < ctx_stack.len()
        || rem_bd < ctx_bd
        || extra_rbraces > 0
        || cand_closes_rust_angle(cand_joined);
    let ok_snippet = |s: &str, p: &mut ParserPool| {
        collect_r5_error_spans(LanguageId::Rust, s, path, p).is_ok_and(|e| e.is_empty())
    };
    let outer_r = "\n}".repeat(base_layers);
    if suffix_lines.iter().any(|l| !strip_rust_comments_strings(l).trim().is_empty()) {
        if extra_rbraces > 0 { return Some(false); }
        if !cand_closes_any {
            let Some(close_suf) = rust_suffix_close_prefix(ctx_tail, suffix_lines, has_fn_decl) else {
                return Some(false);
            };
            let ctx_incomplete = ctx_clean.trim_end().ends_with([
                '<', '>', '+', '-', '*', '/', '%', '&', '|', '^', '=', '(', '[', '.', ',', ':',
            ]);
            if !ctx_incomplete && !ok_snippet(&format!("{full_hdr}\n{ctx_tail}\n{close_suf}{outer_r}"), pool) {
                return Some(false);
            }
            return Some(ok_snippet(&format!("{full_hdr}\n{combined}\n{close_suf}{outer_r}"), pool));
        }
        if let Some(close_suf) = rust_suffix_close_prefix(&combined, suffix_lines, has_fn_decl) {
            return Some(ok_snippet(&format!("{full_hdr}\n{combined}\n{close_suf}{outer_r}"), pool));
        }
        if rem_stack.is_empty() && rem_bd == 0 && !has_fn_decl {
            return Some(ok_snippet(&format!("{full_hdr}\n{combined}{outer_r}"), pool));
        }
        return Some(false);
    }
    let mk_closers = |stk: &[u8], bd: usize| -> String {
        let mut s = "\n}".repeat(bd);
        for &d in stk.iter().rev() { s.push(match d { b'(' => ')', b'[' => ']', _ => '>' }); }
        s
    };
    let mk_suffixes = |stk: &[u8], clean: &str, bd: usize, extra_r: usize| -> [&str; 2] {
        if extra_r > 0 || bd > 0 || (is_impl_trait && has_fn_decl && clean.trim_end().ends_with(['}', ';'])) {
            ["", ""]
        } else if is_impl_trait && has_fn_decl {
            if stk.first() == Some(&b'<') && !has_depth0_arrow(clean) && !rust_fn_has_params_or_where(clean) {
                ["() {}", "();"]
            } else {
                [" {}", ";"]
            }
        } else {
            ["", ";"]
        }
    };
    if !cand_closes_any {
        let (closers, suffixes) = (mk_closers(&ctx_stack, ctx_bd), mk_suffixes(&ctx_stack, &ctx_clean, ctx_bd, 0));
        let allow_ph = !has_fn_decl || ctx_stack.contains(&b'<');
        let ctx_tr = ctx_clean.trim_end();
        let mut p_phs = vec![""];
        if allow_ph && (ctx_tr.ends_with('<') || ctx_tr.ends_with(',') || ctx_tr.ends_with('+')) { p_phs.push(" _T"); }
        if ctx_stack.last() == Some(&b'[') && ctx_tr.ends_with(';') { p_phs.push(" 1"); }
        if !has_fn_decl
            && ctx_stack.last() == Some(&b'(')
            && has_depth0_assign(&ctx_clean)
            && ctx_tr.ends_with(['+', '-', '*', '/', '%', '&', '|', '^', '=', '(', ','])
        {
            p_phs.push(" 1");
        }
        if !p_phs.iter().any(|ph| suffixes.iter().any(|suf| {
            ok_snippet(&format!("{full_hdr}\n{ctx_tail}\n{ph}{closers}{suf}{outer_r}"), pool)
        })) {
            return Some(false);
        }
    }
    let comb_clean = strip_rust_comments_strings(&combined);
    let rem_closers = mk_closers(&rem_stack, rem_bd);
    let cand_suffixes = mk_suffixes(&rem_stack, &comb_clean, rem_bd, extra_rbraces);
    let cand_outer_r = "\n}".repeat(base_layers - extra_rbraces);
    let cand_tr = cand_clean.trim_end();
    let mut c_phs = vec![""];
    if (!has_fn_decl || rem_stack.contains(&b'<')) && !rem_stack.is_empty() && cand_tr.ends_with(['<', ',', '+']) {
        c_phs.push(" _T");
    }
    if rem_stack.last() == Some(&b'[') && cand_tr.ends_with(';') { c_phs.push(" 1"); }
    Some(c_phs.iter().any(|ph| cand_suffixes.iter().any(|suf| {
        ok_snippet(&format!("{full_hdr}\n{combined}\n{ph}{rem_closers}{suf}{cand_outer_r}"), pool)
    })))
}
