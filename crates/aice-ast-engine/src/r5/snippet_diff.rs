use std::path::Path;
use aice_lang_registry::LanguageId;
use crate::r5::checks::collect_r5_error_spans;
use crate::r5::snippet_omissions::line_has_intrinsic_corruption;
use crate::r5::snippet_cst::{CstDefectProfile, comment_or_string_boundary, cst_defect_profile};
use crate::r5::snippet_lex::split_top_level_stmt_segments;
use crate::r5::snippet_lit::open_quote_start;
use crate::r5::snippet_omissions::{
    is_valid_bash_compound_header, is_valid_block_or_compound_header,
};
use crate::r5::snippet_ops::line_pair_trailing_op_adds_error;
use crate::r5::snippet_probe::{has_inner_delim_error, is_valid_arg_continuation_pair};
use crate::ts_pool::ParserPool;

pub fn lcs_hunks<'s, 'a>(
    base: &'s [&'a str],
    cand: &'s [&'a str],
) -> Vec<(&'s [&'a str], &'s [&'a str])> {
    let (n, m) = (base.len(), cand.len());
    if n == 0 || m == 0 || n > 256 || m > 256 {
        return vec![(base, cand)];
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
    let (mut i, mut j, mut prev_b, mut prev_c) = (0usize, 0usize, 0usize, 0usize);
    let mut hunks = Vec::new();
    while i < n && j < m {
        if base[i] == cand[j] {
            if i > prev_b || j > prev_c {
                hunks.push((&base[prev_b..i], &cand[prev_c..j]));
            }
            i += 1;
            j += 1;
            prev_b = i;
            prev_c = j;
        } else if dp[(i + 1) * cols + j] >= dp[i * cols + (j + 1)] {
            i += 1;
        } else {
            j += 1;
        }
    }
    if prev_b < n || prev_c < m {
        hunks.push((&base[prev_b..], &cand[prev_c..]));
    }
    hunks
}

pub fn line_pair_adds_error(
    lang: LanguageId,
    path: &Path,
    pool: &mut ParserPool,
    b_line: &str,
    c_line: &str,
) -> bool {
    let b_prof = cst_defect_profile(lang, b_line, path, pool);
    let c_prof = cst_defect_profile(lang, c_line, path, pool);
    if c_prof.min_errs == 0 && c_prof.unclosed_quotes == 0 {
        return false;
    }
    if is_valid_block_or_compound_header(lang, b_line, path, pool)
        && is_valid_block_or_compound_header(lang, c_line, path, pool)
    {
        return false;
    }
    if c_prof.unclosed_quotes > b_prof.unclosed_quotes {
        return true;
    }
    if b_prof.unclosed_quotes == 0
        && c_prof.unclosed_quotes == 0
        && is_valid_arg_continuation_pair(lang, b_line, c_line, path, pool)
    {
        return false;
    }
    if (c_prof.cst_errors + c_prof.cst_missing) > (b_prof.cst_errors + b_prof.cst_missing) {
        return true;
    }
    if line_pair_trailing_op_adds_error(lang, path, pool, b_line, c_line, &b_prof, &c_prof) {
        return true;
    }
    if line_has_intrinsic_corruption(lang, c_line, path, pool)
        && !line_has_intrinsic_corruption(lang, b_line, path, pool)
    {
        return true;
    }
    let c_segs = split_top_level_stmt_segments(lang, c_line);
    if c_segs.len() >= 2 && !is_valid_bash_compound_header(lang, c_line, path, pool) {
        let count_broken = |segs: &[&str], pool: &mut ParserPool| -> usize {
            segs.iter()
                .filter(|s| {
                    let p = cst_defect_profile(lang, s, path, pool);
                    p.min_errs > 0 || p.unclosed_quotes > 0
                })
                .count()
        };
        let c_seg_errs = count_broken(&c_segs, pool);
        let b_segs = split_top_level_stmt_segments(lang, b_line);
        let b_seg_errs =
            if b_segs.len() >= 2 && !is_valid_bash_compound_header(lang, b_line, path, pool) {
                count_broken(&b_segs, pool)
            } else {
                usize::from(b_prof.min_errs > 0 || b_prof.unclosed_quotes > 0)
            };
        if c_seg_errs > b_seg_errs {
            return true;
        }
    }
    if b_prof.unclosed_delims > 0
        && c_prof.unclosed_delims > 0
        && b_prof.unclosed_quotes == 0
        && c_prof.unclosed_quotes == 0
        && !has_inner_delim_error(lang, b_line, path, pool)
        && has_inner_delim_error(lang, c_line, path, pool)
    {
        return true;
    }

    let (b_mid, c_mid) = diff_line_mids(lang, pool, b_line, c_line);
    let b_mid_prof = expr_or_stmt_profile(lang, b_mid, path, pool);
    let c_mid_prof = expr_or_stmt_profile(lang, c_mid, path, pool);
    if c_mid_prof.min_errs > b_mid_prof.min_errs
        || c_mid_prof.unclosed_quotes > b_mid_prof.unclosed_quotes
    {
        return true;
    }
    b_mid_prof.unclosed_delims > 0
        && c_mid_prof.unclosed_delims > 0
        && b_mid_prof.unclosed_quotes == 0
        && c_mid_prof.unclosed_quotes == 0
        && !has_inner_delim_error(lang, b_mid, path, pool)
        && has_inner_delim_error(lang, c_mid, path, pool)
}

pub fn trim_stmt_seps(mut s: &str) -> &str {
    loop {
        let trimmed = s.trim();
        let next = trimmed
            .strip_prefix("&&")
            .or_else(|| trimmed.strip_prefix("||"))
            .or_else(|| trimmed.strip_prefix(';'))
            .or_else(|| trimmed.strip_suffix("&&"))
            .or_else(|| trimmed.strip_suffix("||"))
            .or_else(|| trimmed.strip_suffix(';'));
        if let Some(n) = next {
            s = n;
        } else {
            return trimmed;
        }
    }
}

fn diff_line_mids<'a>(
    lang: LanguageId,
    pool: &mut ParserPool,
    b_line: &'a str,
    c_line: &'a str,
) -> (&'a str, &'a str) {
    let min_b = b_line.len().min(c_line.len());
    let mut p = b_line
        .bytes()
        .zip(c_line.bytes())
        .take_while(|(a, b)| a == b)
        .count();
    while p > 0 && (!b_line.is_char_boundary(p) || !c_line.is_char_boundary(p)) {
        p -= 1;
    }
    if let Some(q_start) = open_quote_start(lang, &b_line[..p]) {
        p = q_start;
    }
    let (p_b, _) = comment_or_string_boundary(lang, b_line, p, 0, pool);
    let (p_c, _) = comment_or_string_boundary(lang, c_line, p, 0, pool);
    p = p_b.min(p_c);
    while p > 0 && (!b_line.is_char_boundary(p) || !c_line.is_char_boundary(p)) {
        p -= 1;
    }
    while p > 0 && cuts_ident(b_line, p) && cuts_ident(c_line, p) {
        p -= 1;
        while p > 0 && (!b_line.is_char_boundary(p) || !c_line.is_char_boundary(p)) {
            p -= 1;
        }
    }
    let b_rem = &b_line[p..];
    let c_rem = &c_line[p..];
    let max_s = b_rem
        .len()
        .min(c_rem.len())
        .min(min_b.saturating_sub(p) + b_rem.len());
    let mut s = b_rem
        .bytes()
        .rev()
        .zip(c_rem.bytes().rev())
        .take(max_s)
        .take_while(|(a, b)| a == b)
        .count();
    while s > 0
        && (!b_rem.is_char_boundary(b_rem.len() - s) || !c_rem.is_char_boundary(c_rem.len() - s))
    {
        s -= 1;
    }
    while s > 0 && (cuts_ident(b_rem, b_rem.len() - s) || cuts_ident(c_rem, c_rem.len() - s)) {
        s -= 1;
        while s > 0
            && (!b_rem.is_char_boundary(b_rem.len() - s)
                || !c_rem.is_char_boundary(c_rem.len() - s))
        {
            s -= 1;
        }
    }
    let (_, s_b) = comment_or_string_boundary(lang, b_line, p, s, pool);
    let (_, s_c) = comment_or_string_boundary(lang, c_line, p, s, pool);
    s = s_b.min(s_c).min(b_rem.len()).min(c_rem.len());
    while s > 0
        && (!b_rem.is_char_boundary(b_rem.len() - s) || !c_rem.is_char_boundary(c_rem.len() - s))
    {
        s -= 1;
    }
    let b_mid = trim_stmt_seps(&b_rem[..b_rem.len() - s]);
    let c_mid = trim_stmt_seps(&c_rem[..c_rem.len() - s]);
    (b_mid, c_mid)
}



fn cuts_ident(s: &str, idx: usize) -> bool {
    if idx == 0 || idx >= s.len() {
        return false;
    }
    let b = s.as_bytes();
    let is_id = |c: u8| c.is_ascii_alphanumeric() || c == b'_';
    is_id(b[idx - 1]) && is_id(b[idx])
}

fn expr_or_stmt_profile(
    lang: LanguageId,
    mid: &str,
    path: &Path,
    pool: &mut ParserPool,
) -> CstDefectProfile {
    if mid.is_empty() {
        return CstDefectProfile::default();
    }
    let mut best = cst_defect_profile(lang, mid, path, pool);
    if (best.min_errs == 0 && best.unclosed_quotes == 0) || mid.contains(';') || mid.contains('\n')
    {
        return best;
    }
    let expr_wrappers: Vec<String> = match lang {
        LanguageId::Rust => vec![format!("fn _aice_probe_() {{ let _v = ({mid}); }}")],
        LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript => {
            vec![format!("const _v = ({mid});")]
        }
        LanguageId::Python | LanguageId::Ruby => vec![format!("_v = ({mid})")],
        LanguageId::C | LanguageId::Cpp => vec![format!("void _aice_probe_() {{ ({mid}); }}")],
        LanguageId::CSharp | LanguageId::Java | LanguageId::Dart => {
            vec![format!("void _aice_probe_() {{ var _v = ({mid}); }}")]
        }
        LanguageId::Kotlin => vec![format!("val _v = ({mid})")],
        LanguageId::Go => vec![format!("package _aice\nvar _v = ({mid})")],
        LanguageId::Php => vec![format!("<?php $_v = ({mid});")],
        _ => Vec::new(),
    };
    for w in expr_wrappers {
        let errs = collect_r5_error_spans(lang, &w, path, pool)
            .map(|s| s.len())
            .unwrap_or(1);
        if errs < best.min_errs {
            best.min_errs = errs;
            if errs == 0 {
                best.unclosed_quotes = 0;
                return best;
            }
        }
    }
    best
}
