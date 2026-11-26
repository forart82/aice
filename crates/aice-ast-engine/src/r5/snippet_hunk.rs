use std::path::Path;

use aice_lang_registry::LanguageId;

use crate::r5::snippet_blk::find_blk_comment_close;
use crate::r5::snippet_closed::{
    closed_delim_ok, closed_non_op_completable_ok, closed_trailing_op_ok,
};
use crate::r5::snippet_container::PrefixContainer;
use crate::r5::snippet_container_compat::container_compatible_for;
use crate::r5::snippet_cst::{CstDefectProfile, line_delim_detail};
use crate::r5::snippet_diff::line_pair_adds_error;
use crate::r5::snippet_lex::{
    has_hash_comments, has_slash_comments, is_code_lang, is_hash_comment_at,
};
use crate::r5::snippet_lit::{JsLexState, StepQuote};
use crate::r5::snippet_omissions::line_defect_units;
use crate::r5::snippet_ops::{is_trailing_continuation_token, trailing_binary_op};
use crate::r5::snippet_probe::has_inner_delim_error;
use crate::r5::snippet_type_body::{
    bh_looks_like_container_body, bh_type_body_mask, is_type_body_compatible_for,
};
use crate::ts_pool::ParserPool;

fn hunk_trailing_comment_start(lang: LanguageId, s: &str) -> Option<usize> {
    let b = s.as_bytes();
    let (slash, hash) = (has_slash_comments(lang), has_hash_comments(lang));
    let (mut i, mut js) = (0usize, JsLexState::new());
    while i < b.len() {
        if b[i] == b'\n' {
            js.on_newline(lang);
            i += 1;
            continue;
        }
        if js.step_quote(lang, b, &mut i) != StepQuote::NotInQuote {
            continue;
        }
        if let Some((end, _)) = js.match_special(lang, b, i) {
            i = end;
            continue;
        }
        if js.open_quote(lang, b, &mut i) {
            continue;
        }
        if (slash && lang != LanguageId::Css && b[i..].starts_with(b"//"))
            || (hash && is_hash_comment_at(b, i))
        {
            let mut eol = i;
            while eol < b.len() && b[eol] != b'\n' {
                eol += 1;
            }
            if s[eol..].trim().is_empty() {
                return Some(i);
            }
            i = eol;
            continue;
        }
        if slash && b[i..].starts_with(b"/*") {
            let (Some(after), _) = find_blk_comment_close(lang, b, i + 2, 1) else {
                return Some(i);
            };
            if s[after..].trim().is_empty() {
                return Some(i);
            }
            i = after;
            continue;
        }
        js.step_byte(lang, b, &mut i);
    }
    None
}

pub(crate) fn strip_hunk_trailing_comment(lang: LanguageId, s: &str) -> &str {
    let mut cut = s.len();
    while let Some(pos) = hunk_trailing_comment_start(lang, &s[..cut]) {
        if pos >= cut {
            break;
        }
        cut = pos;
        while cut > 0 && !s.is_char_boundary(cut) {
            cut -= 1;
        }
    }
    s[..cut].trim_end()
}

fn bh_has_trailing_op(lang: LanguageId, bh: &[&str], path: &Path, pool: &mut ParserPool) -> bool {
    if bh.is_empty() {
        return false;
    }
    let joined = bh.join("\n");
    let code = strip_hunk_trailing_comment(lang, &joined);
    if trailing_binary_op(lang, code).is_some() {
        return closed_trailing_op_ok(lang, code, path, pool);
    }
    is_trailing_continuation_token(lang, code)
        && closed_non_op_completable_ok(lang, code, false, false, path, pool)
}

fn bh_has_open_delim(lang: LanguageId, bh: &[&str], path: &Path, pool: &mut ParserPool) -> bool {
    if bh.is_empty() {
        return false;
    }
    let joined = bh.join("\n");
    let code = strip_hunk_trailing_comment(lang, &joined);
    let (stack, unmatched) = line_delim_detail(lang, code, path, pool);
    !stack.is_empty() && unmatched.is_empty() && closed_delim_ok(lang, code, &stack, &unmatched, path, pool)
}

fn bh_has_unmatched_closer_budget(
    lang: LanguageId,
    bh: &[&str],
    unmatched: &[u8],
    path: &Path,
    pool: &mut ParserPool,
) -> bool {
    if bh.is_empty() {
        return false;
    }
    let joined = bh.join("\n");
    let code = strip_hunk_trailing_comment(lang, &joined);
    let (b_stack, b_unmatched) = line_delim_detail(lang, code, path, pool);
    if !b_stack.is_empty() || b_unmatched.is_empty() {
        return false;
    }
    b")]}"
        .iter()
        .all(|c| {
            unmatched.iter().filter(|&&x| x == *c).count()
                <= b_unmatched.iter().filter(|&&x| x == *c).count()
        })
}
#[allow(clippy::too_many_arguments)]
pub(crate) fn hunk_completable_ok_ctx(
    lang: LanguageId,
    lines: &[&str],
    base_lines: Option<&[&str]>,
    path: &Path,
    pool: &mut ParserPool,
    prof: &CstDefectProfile,
    prefix_ctx: Option<PrefixContainer>,
    has_suffix: bool,
) -> bool {
    if lines.len() < 2 || prof.unclosed_quotes > 0 {
        return false;
    }
    if let Some(ctx) = prefix_ctx
        && ctx.is_scoped_non_stmt()
        && base_lines.is_some_and(|bh| container_compatible_for(lang, &bh.join("\n"), ctx, has_suffix, path, pool))
    {
        return container_compatible_for(lang, &lines.join("\n"), ctx, has_suffix, path, pool);
    }
    let use_tb = !matches!(
        prefix_ctx,
        Some(PrefixContainer::StmtBlock | PrefixContainer::MatchOrSwitch | PrefixContainer::TopLevel)
    );
    let bh_mask = if use_tb { base_lines.map_or(0, |bh| bh_type_body_mask(lang, bh, path, pool)) } else { 0 };
    let allow_type_body = bh_mask != 0;
    let allow_container = use_tb && base_lines.is_some_and(|bh| bh_looks_like_container_body(lang, bh, path, pool));
    if allow_type_body && !allow_container {
        let joined = lines.join("\n");
        let code = strip_hunk_trailing_comment(lang, &joined);
        return is_type_body_compatible_for(lang, code, bh_mask, path, pool);
    }
    if prof.min_errs == 0 {
        return true;
    }
    if !is_code_lang(lang) {
        return false;
    }
    let joined = lines.join("\n");
    let code = strip_hunk_trailing_comment(lang, &joined);
    if prof.unclosed_delims == 0 {
        if trailing_binary_op(lang, code).is_some() {
            return base_lines.is_some_and(|bh| bh_has_trailing_op(lang, bh, path, pool))
                && closed_trailing_op_ok(lang, code, path, pool);
        }
        if is_trailing_continuation_token(lang, code) {
            return base_lines.is_some_and(|bh| bh_has_trailing_op(lang, bh, path, pool))
                && closed_non_op_completable_ok(lang, code, false, false, path, pool);
        }
        return closed_non_op_completable_ok(lang, code, allow_type_body, allow_container, path, pool);
    }
    let (stack, unmatched) = line_delim_detail(lang, code, path, pool);
    if stack.is_empty() && !unmatched.is_empty() {
        return base_lines.is_some_and(|bh| bh_has_unmatched_closer_budget(lang, bh, &unmatched, path, pool))
            && !has_inner_delim_error(lang, code, path, pool);
    }
    !stack.is_empty()
        && unmatched.is_empty()
        && base_lines.is_some_and(|bh| bh_has_open_delim(lang, bh, path, pool))
        && closed_delim_ok(lang, code, &stack, &unmatched, path, pool)
}

pub(crate) fn k_hunk_max_adds_error(
    lang: LanguageId,
    path: &Path,
    pool: &mut ParserPool,
    bh: &[&str],
    ch: &[&str],
    b_prof: &CstDefectProfile,
    c_prof: &CstDefectProfile,
) -> bool {
    if c_prof.cst_errors + c_prof.cst_missing > b_prof.cst_errors + b_prof.cst_missing {
        return true;
    }
    if ch.len() <= bh.len() {
        let b_units: usize = bh.iter().map(|l| line_defect_units(lang, l, path, pool)).sum();
        let c_units: usize = ch.iter().map(|l| line_defect_units(lang, l, path, pool)).sum();
        if c_units > b_units {
            return true;
        }
    }
    if bh.len() == ch.len()
        && bh.iter().zip(ch.iter()).any(|(b, c)| b != c && line_pair_adds_error(lang, path, pool, b, c))
    {
        return true;
    }
    bh.len() != ch.len()
        && ch.iter().any(|c| bh.iter().all(|b| line_pair_adds_error(lang, path, pool, b, c)))
}
