use std::path::Path;

use aice_lang_registry::LanguageId;

use crate::r5::checks::collect_r5_error_spans;
use crate::r5::snippet_closed::closed_delim_ok;
use crate::r5::snippet_container::PrefixContainer;
use crate::r5::snippet_container_compat::container_compatible_for;
use crate::r5::snippet_cst::{cst_defect_profile, line_delim_detail, line_delim_state, strip_trailing_comment};
use crate::r5::snippet_hunk::{hunk_completable_ok_ctx, k_hunk_max_adds_error};
use crate::r5::snippet_omissions::line_has_intrinsic_corruption;
use crate::r5::snippet_type_body::{
    TB_PARAM, TB_TYPE_MASK, bh_looks_like_container_body, bh_looks_like_type_body,
    bh_type_body_mask, is_type_body_compatible_for,
};
use crate::r5::snippet_diff::{lcs_hunks, line_pair_adds_error, trim_stmt_seps};
use crate::r5::snippet_lex::{is_code_lang, snippet_wrappers};
use crate::r5::snippet_omissions::{
    line_defect_units, resolve_clean_budget, weighted_omissions_to_fix,
};
use crate::ts_pool::ParserPool;

pub fn min_snippet_errors(
    lang: LanguageId,
    slice: &str,
    path: &Path,
    pool: &mut ParserPool,
) -> usize {
    let mut best = collect_r5_error_spans(lang, slice, path, pool)
        .map(|s| s.len())
        .unwrap_or(1);
    if best == 0 {
        return 0;
    }
    for (_, wrapped) in snippet_wrappers(lang, slice) {
        let count = collect_r5_error_spans(lang, &wrapped, path, pool)
            .map(|s| s.len())
            .unwrap_or(1);
        best = best.min(count);
        if best == 0 {
            return 0;
        }
    }
    best
}

pub fn has_merged_edit_error(
    lang: LanguageId,
    path: &Path,
    pool: &mut ParserPool,
    base_slice_lines: &[&str],
    cand_slice_lines: &[&str],
    base_errs: usize,
) -> bool {
    has_merged_edit_error_ctx(lang, path, pool, base_slice_lines, cand_slice_lines, base_errs, (None, true))
}

pub(crate) fn has_merged_edit_error_ctx(
    lang: LanguageId,
    path: &Path,
    pool: &mut ParserPool,
    base_slice_lines: &[&str],
    cand_slice_lines: &[&str],
    _base_errs: usize,
    (prefix_ctx, has_suffix): (Option<PrefixContainer>, bool),
) -> bool {
    if let Some(ctx) = prefix_ctx
        && ctx.is_scoped_non_stmt()
        && container_compatible_for(lang, &base_slice_lines.join("\n"), ctx, has_suffix, path, pool)
    {
        return !container_compatible_for(lang, &cand_slice_lines.join("\n"), ctx, has_suffix, path, pool);
    }
    let use_tb = !matches!(prefix_ctx, Some(PrefixContainer::StmtBlock | PrefixContainer::MatchOrSwitch | PrefixContainer::TopLevel));
    if base_slice_lines.len() == 1 && cand_slice_lines.len() == 1 {
        if use_tb {
            let bh_mask = bh_type_body_mask(lang, base_slice_lines, path, pool);
            if (bh_mask & TB_TYPE_MASK) != 0 && !bh_looks_like_container_body(lang, base_slice_lines, path, pool)
                && !is_type_body_compatible_for(lang, cand_slice_lines[0], bh_mask, path, pool)
            {
                return true;
            }
            if bh_mask == TB_PARAM {
                if is_type_body_compatible_for(lang, cand_slice_lines[0], TB_PARAM, path, pool) {
                    return false;
                }
                if !bh_looks_like_container_body(lang, base_slice_lines, path, pool) {
                    return true;
                }
            }
        }
        return line_pair_adds_error(lang, path, pool, base_slice_lines[0], cand_slice_lines[0]);
    }
    let hunks = lcs_hunks(base_slice_lines, cand_slice_lines);
    let mut deferred_pure_insert = false;
    for (bh, ch) in &hunks {
        if ch.is_empty() { continue; }
        if bh.is_empty() {
            let ins_prof = cst_defect_profile(lang, &ch.join("\n"), path, pool);
            if ins_prof.unclosed_quotes > 0 { return true; }
            if ins_prof.min_errs > 0 || (use_tb && bh_looks_like_type_body(lang, base_slice_lines, path, pool)) {
                let full_ok = cand_slice_lines.len() >= 2 && {
                    let fp = cst_defect_profile(lang, &cand_slice_lines.join("\n"), path, pool);
                    hunk_completable_ok_ctx(lang, cand_slice_lines, Some(base_slice_lines), path, pool, &fp, prefix_ctx, has_suffix)
                };
                if !full_ok { if hunks.len() == 1 { return true; } deferred_pure_insert = true; }
            }
            continue;
        }
        if bh.len() == 1 && ch.len() == 1 {
            if use_tb {
                let bh_mask = bh_type_body_mask(lang, bh, path, pool);
                if (bh_mask & TB_TYPE_MASK) != 0 && !bh_looks_like_container_body(lang, bh, path, pool)
                    && !is_type_body_compatible_for(lang, ch[0], bh_mask, path, pool) { return true; }
                if bh_mask == TB_PARAM {
                    if is_type_body_compatible_for(lang, ch[0], TB_PARAM, path, pool) { continue; }
                    if !bh_looks_like_container_body(lang, bh, path, pool) { return true; }
                }
            }
            if line_pair_adds_error(lang, path, pool, bh[0], ch[0]) { return true; }
            continue;
        }
        let b_prof = cst_defect_profile(lang, &bh.join("\n"), path, pool);
        let c_prof = cst_defect_profile(lang, &ch.join("\n"), path, pool);
        if c_prof.unclosed_quotes > b_prof.unclosed_quotes { return true; }
        if lang == LanguageId::Python && ch.len() >= 2
            && ch.iter().filter(|l| !l.trim().is_empty()).all(|l| l.trim_end().ends_with(','))
            && !bh_looks_like_container_body(lang, bh, path, pool) { return true; }
        if ch.len() >= 2 && hunk_completable_ok_ctx(lang, ch, Some(bh), path, pool, &c_prof, prefix_ctx, has_suffix) {
            continue;
        }
        let bh_mask = if use_tb { bh_type_body_mask(lang, bh, path, pool) } else { 0 };
        if bh_mask == TB_PARAM && is_type_body_compatible_for(lang, &ch.join("\n"), TB_PARAM, path, pool) {
            continue;
        }
        if bh_mask != 0 && !bh_looks_like_container_body(lang, bh, path, pool)
            && !is_type_body_compatible_for(lang, &ch.join("\n"), bh_mask, path, pool)
        {
            return true;
        }
        if bh[0] != ch[0]
            && min_snippet_errors(lang, bh[0], path, pool) > 0
            && first_line_continuation_errs(lang, path, pool, bh[0], ch) > 0
        {
            return true;
        }
        let b_corrupt = bh
            .iter()
            .filter(|l| line_has_intrinsic_corruption(lang, l, path, pool))
            .count();
        let c_corrupt = ch
            .iter()
            .filter(|l| line_has_intrinsic_corruption(lang, l, path, pool))
            .count();
        if c_corrupt > b_corrupt {
            return true;
        }
        let k_hunk = if bh.len() == 1 {
            line_defect_units(lang, bh[0], path, pool)
        } else if b_prof.min_errs == 0 && b_prof.unclosed_quotes == 0 {
            0
        } else {
            weighted_omissions_to_fix(lang, path, pool, bh, 4).unwrap_or(usize::MAX)
        };
        if ch.len() == 1 {
            if line_defect_units(lang, ch[0], path, pool) > k_hunk {
                return true;
            }
            if k_hunk == usize::MAX
                && k_hunk_max_adds_error(lang, path, pool, bh, ch, &b_prof, &c_prof)
            {
                return true;
            }
        } else if k_hunk == 0 {
            if c_prof.min_errs > 0 || c_prof.unclosed_quotes > 0 {
                return true;
            }
        } else if k_hunk == usize::MAX {
            if k_hunk_max_adds_error(lang, path, pool, bh, ch, &b_prof, &c_prof) {
                return true;
            }
        } else if weighted_omissions_to_fix(lang, path, pool, ch, k_hunk).is_none() {
            return true;
        }
    }

    let (base_clean, cand_clean, kb) =
        resolve_clean_budget(lang, path, pool, base_slice_lines, cand_slice_lines);
    let (b_stk, b_unm) = line_delim_detail(lang, &base_clean.join("\n"), path, pool);
    let (c_stk, c_unm) = line_delim_detail(lang, &cand_clean.join("\n"), path, pool);
    if b_stk.is_empty()
        && !b_unm.is_empty()
        && c_stk.is_empty()
        && !c_unm.is_empty()
        && cand_clean.len() >= 2
    {
        let clean_prof = cst_defect_profile(lang, &cand_clean.join("\n"), path, pool);
        if !hunk_completable_ok_ctx(lang, &cand_clean, Some(&base_clean), path, pool, &clean_prof, prefix_ctx, has_suffix) {
            return true;
        }
    }
    if let Some(kb) = kb {
        if cand_clean.len() >= 2 {
            let clean_prof = cst_defect_profile(lang, &cand_clean.join("\n"), path, pool);
            if !hunk_completable_ok_ctx(lang, &cand_clean, Some(&base_clean), path, pool, &clean_prof, prefix_ctx, has_suffix)
                && weighted_omissions_to_fix(lang, path, pool, &cand_clean, kb).is_none()
            {
                return true;
            }
        }
        if cand_clean.len() == 1 && line_defect_units(lang, cand_clean[0], path, pool) > kb {
            return true;
        }
    } else if deferred_pure_insert {
        return true;
    }
    false
}

fn first_line_continuation_errs(
    lang: LanguageId,
    path: &Path,
    pool: &mut ParserPool,
    b0: &str,
    ch: &[&str],
) -> usize {
    let Some(tail) = ch[0].strip_prefix(b0) else {
        return 0;
    };
    let t = tail.trim_start();
    if !(t.starts_with(';') || t.starts_with("&&") || t.starts_with("||")) {
        return 0;
    }
    let clean_tail = trim_stmt_seps(tail);
    let mut lines = Vec::with_capacity(ch.len());
    if !clean_tail.is_empty() {
        lines.push(clean_tail);
    }
    lines.extend_from_slice(&ch[1..]);
    if lines.is_empty() {
        return 0;
    }
    min_snippet_errors(lang, &lines.join("\n"), path, pool)
}

pub(crate) fn is_valid_arg_continuation_pair(
    lang: LanguageId,
    b_line: &str,
    c_line: &str,
    path: &Path,
    pool: &mut ParserPool,
) -> bool {
    if !is_code_lang(lang) {
        return false;
    }
    let b_code = strip_trailing_comment(lang, b_line, pool);
    let c_code = strip_trailing_comment(lang, c_line, pool);
    if !c_code.ends_with(',')
        || c_code[..c_code.len() - 1]
            .trim_end()
            .ends_with([',', '(', '[', '{'])
        || !(b_code.ends_with(',')
            || b_code.ends_with('(')
            || b_code.ends_with('[')
            || b_code.ends_with('{'))
    {
        return false;
    }
    let (b_stack, b_unm) = line_delim_state(lang, b_code, path, pool);
    let (c_stack, c_unm) = line_delim_state(lang, c_code, path, pool);
    if b_unm != 0 || c_unm != 0 || b_stack != c_stack {
        return false;
    }
    closed_delim_ok(lang, b_code, &b_stack, &[], path, pool)
        && closed_delim_ok(lang, c_code, &c_stack, &[], path, pool)
}

pub(crate) fn has_inner_delim_error(
    lang: LanguageId,
    line: &str,
    path: &Path,
    pool: &mut ParserPool,
) -> bool {
    if !is_code_lang(lang) {
        return false;
    }
    let code = strip_trailing_comment(lang, line, pool);
    if code.is_empty() {
        return false;
    }
    let (stack, unmatched) = line_delim_detail(lang, code, path, pool);
    if stack.is_empty() && unmatched.is_empty() {
        return false;
    }
    !closed_delim_ok(lang, code, &stack, &unmatched, path, pool)
}

