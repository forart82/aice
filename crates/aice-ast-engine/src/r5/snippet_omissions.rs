use std::path::Path;

use aice_lang_registry::LanguageId;

use crate::r5::snippet_closed::closed_line_completable_ok;
use crate::r5::snippet_cst::{cst_defect_profile, strip_trailing_comment};
use crate::r5::snippet_lex::{is_code_lang, split_top_level_stmt_segments};
use crate::r5::snippet_probe::has_inner_delim_error;
use crate::ts_pool::ParserPool;
pub fn is_valid_bash_compound_header(
    lang: LanguageId,
    line: &str,
    path: &Path,
    pool: &mut ParserPool,
) -> bool {
    if lang != LanguageId::Bash {
        return false;
    }
    let trimmed = strip_trailing_comment(lang, line, pool);
    if trimmed.ends_with("then") {
        let p = cst_defect_profile(lang, &format!("{line}\nfi"), path, pool);
        return p.min_errs == 0 && p.unclosed_quotes == 0;
    }
    if trimmed.ends_with("do") {
        let p = cst_defect_profile(lang, &format!("{line}\ndone"), path, pool);
        return p.min_errs == 0 && p.unclosed_quotes == 0;
    }
    false
}

pub fn is_valid_block_or_compound_header(
    lang: LanguageId,
    line: &str,
    path: &Path,
    pool: &mut ParserPool,
) -> bool {
    let code = strip_trailing_comment(lang, line, pool);
    if code.ends_with('{') {
        let p = cst_defect_profile(lang, &format!("{line}\n}}"), path, pool);
        return p.min_errs == 0 && p.unclosed_quotes == 0;
    }
    if lang == LanguageId::Python && code.ends_with(':') {
        let p = cst_defect_profile(lang, &format!("{line}\n    pass"), path, pool);
        return p.min_errs == 0 && p.unclosed_quotes == 0;
    }
    is_valid_bash_compound_header(lang, line, path, pool)
}

pub fn line_defect_units(
    lang: LanguageId,
    line: &str,
    path: &Path,
    pool: &mut ParserPool,
) -> usize {
    let prof = cst_defect_profile(lang, line, path, pool);
    if prof.min_errs == 0 && prof.unclosed_quotes == 0 {
        return 0;
    }
    if is_valid_block_or_compound_header(lang, line, path, pool) {
        return 0;
    }
    let segs = split_top_level_stmt_segments(lang, line);
    let seg_errs = if segs.len() >= 2 {
        segs.iter()
            .filter(|s| {
                let p = cst_defect_profile(lang, s, path, pool);
                p.min_errs > 0 || p.unclosed_quotes > 0
            })
            .count()
    } else {
        0
    };
    let inner_delim_err = usize::from(
        prof.unclosed_delims > 0
            && prof.unclosed_quotes == 0
            && has_inner_delim_error(lang, line, path, pool),
    );
    let closed_trailing_err = usize::from(
        prof.unclosed_delims == 0
            && prof.unclosed_quotes == 0
            && is_code_lang(lang)
            && !closed_line_completable_ok(lang, line, path, pool),
    );
    1usize
        .max(prof.cst_errors.saturating_add(prof.cst_missing))
        .max(seg_errs)
        .max(prof.unclosed_delims)
        + prof.unclosed_quotes
        + inner_delim_err
        + closed_trailing_err
}

pub(crate) fn resolve_clean_budget<'a>(
    lang: LanguageId,
    path: &Path,
    pool: &mut ParserPool,
    base: &[&'a str],
    cand: &[&'a str],
) -> (Vec<&'a str>, Vec<&'a str>, Option<usize>) {
    if base.len() <= 1 {
        let kb = base
            .first()
            .map(|l| line_defect_units(lang, l, path, pool))
            .unwrap_or(0);
        return (base.to_vec(), cand.to_vec(), Some(kb));
    }
    if let Some(kb) = weighted_omissions_to_fix(lang, path, pool, base, 4) {
        return (base.to_vec(), cand.to_vec(), Some(kb));
    }
    let (base_clean, cand_clean) = strip_independent_broken_lcs(lang, path, pool, base, cand);
    let kb = if base_clean.len() <= 1 {
        Some(
            base_clean
                .first()
                .map(|l| line_defect_units(lang, l, path, pool))
                .unwrap_or(0),
        )
    } else {
        weighted_omissions_to_fix(lang, path, pool, &base_clean, 4)
    };
    (base_clean, cand_clean, kb)
}

fn strip_independent_broken_lcs<'a>(
    lang: LanguageId,
    path: &Path,
    pool: &mut ParserPool,
    base: &[&'a str],
    cand: &[&'a str],
) -> (Vec<&'a str>, Vec<&'a str>) {
    let (n, m) = (base.len(), cand.len());
    if n == 0 || m == 0 || n > 256 || m > 256 {
        return (base.to_vec(), cand.to_vec());
    }
    let cols = m + 1;
    let mut dp = vec![0u16; (n + 1) * cols];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            dp[i * cols + j] = if base[i] == cand[j] {
                dp[(i + 1) * cols + (j + 1)] + 1
            } else {
                dp[(i + 1) * cols + j].max(dp[i * cols + (j + 1)])
            };
        }
    }
    let base_prof = cst_defect_profile(lang, &base.join("\n"), path, pool);
    let base_defects = base_prof.cst_errors + base_prof.cst_missing;
    let (mut drop_b, mut drop_c) = (vec![false; n], vec![false; m]);
    let (mut i, mut j) = (0usize, 0usize);
    while i < n && j < m {
        if base[i] == cand[j] {
            if !is_valid_block_or_compound_header(lang, base[i], path, pool)
                && cst_defect_profile(lang, base[i], path, pool).min_errs > 0
            {
                let mut rest = Vec::with_capacity(n - 1);
                rest.extend_from_slice(&base[..i]);
                rest.extend_from_slice(&base[i + 1..]);
                let rp = cst_defect_profile(lang, &rest.join("\n"), path, pool);
                if rp.cst_errors + rp.cst_missing < base_defects {
                    drop_b[i] = true;
                    drop_c[j] = true;
                }
            }
            i += 1;
            j += 1;
        } else if dp[(i + 1) * cols + j] >= dp[i * cols + (j + 1)] {
            i += 1;
        } else {
            j += 1;
        }
    }
    let b_clean = base.iter().enumerate().filter(|&(k, _)| !drop_b[k]).map(|(_, &s)| s).collect();
    let c_clean = cand.iter().enumerate().filter(|&(k, _)| !drop_c[k]).map(|(_, &s)| s).collect();
    (b_clean, c_clean)
}

pub(crate) fn weighted_omissions_to_fix(
    lang: LanguageId,
    path: &Path,
    pool: &mut ParserPool,
    lines: &[&str],
    max_weight: usize,
) -> Option<usize> {
    if lines.len() < 2 || max_weight == 0 {
        return None;
    }
    let weights: Vec<usize> = lines
        .iter()
        .map(|l| line_defect_units(lang, l, path, pool))
        .collect();
    let suspects: Vec<usize> = (0..lines.len()).filter(|&i| weights[i] > 0).collect();
    let mut best: Option<usize> = None;
    for &idx in &suspects {
        if weights[idx] <= max_weight && omits_clean(lang, path, pool, lines, &[idx]) {
            best = Some(best.map_or(weights[idx], |b| b.min(weights[idx])));
        }
    }
    if best.is_none() && lines.len() <= 128 {
        for (idx, &w) in weights.iter().enumerate() {
            if !suspects.contains(&idx)
                && w <= max_weight
                && omits_clean(lang, path, pool, lines, &[idx])
            {
                return Some(w);
            }
        }
    }
    if best.is_some() {
        return best;
    }
    let pool_idx: Vec<usize> = if !suspects.is_empty() {
        suspects.clone()
    } else if lines.len() <= 16 {
        (0..lines.len()).collect()
    } else {
        return None;
    };
    let mut checks = 0usize;
    for a in 0..pool_idx.len() {
        for b in (a + 1)..pool_idx.len() {
            if checks >= 120 {
                break;
            }
            checks += 1;
            let w = weights[pool_idx[a]] + weights[pool_idx[b]];
            if w <= max_weight && omits_clean(lang, path, pool, lines, &[pool_idx[a], pool_idx[b]])
            {
                best = Some(best.map_or(w, |cur| cur.min(w)));
            }
        }
    }
    if best.is_some() || suspects.len() < 3 || suspects.len() > 10 {
        return best;
    }
    for a in 0..suspects.len() {
        for b in (a + 1)..suspects.len() {
            for c in (b + 1)..suspects.len() {
                let w = weights[suspects[a]] + weights[suspects[b]] + weights[suspects[c]];
                if w <= max_weight
                    && omits_clean(lang, path, pool, lines, &[suspects[a], suspects[b], suspects[c]])
                {
                    best = Some(best.map_or(w, |cur| cur.min(w)));
                }
            }
        }
    }
    best
}

fn omits_clean(
    lang: LanguageId,
    path: &Path,
    pool: &mut ParserPool,
    lines: &[&str],
    skip: &[usize],
) -> bool {
    let mut buf = String::new();
    for (idx, line) in lines.iter().enumerate() {
        if !skip.contains(&idx) {
            if !buf.is_empty() {
                buf.push('\n');
            }
            buf.push_str(line);
        }
    }
    if buf.is_empty() {
        return true;
    }
    let p = cst_defect_profile(lang, &buf, path, pool);
    p.min_errs == 0 && p.unclosed_quotes == 0
}

pub(crate) fn line_has_intrinsic_corruption(
    lang: LanguageId,
    line: &str,
    path: &Path,
    pool: &mut ParserPool,
) -> bool {
    if !is_code_lang(lang) {
        return false;
    }
    let prof = cst_defect_profile(lang, line, path, pool);
    if prof.unclosed_quotes > 0 {
        return false;
    }
    if prof.unclosed_delims > 0 {
        return has_inner_delim_error(lang, line, path, pool);
    }
    if prof.min_errs == 0 || is_valid_block_or_compound_header(lang, line, path, pool) {
        return false;
    }
    !closed_line_completable_ok(lang, line, path, pool)
}
