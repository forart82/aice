use std::path::Path;

use aice_lang_registry::{FirewallDiagnostic, FirewallVerdict, LanguageId, SyntaxFirewall};
use crate::r5::checks::{
    ErrorSpan, collect_r5_error_spans_with_tree, collect_r5_with_base_edit, format_context, spans_to_diagnostics,
};
use crate::r5::firewall_delta::EofDeltaCtx;
use crate::r5::snippet_cache::{PrefixCache, last_code_line_idx_with_tree};
use crate::r5::snippet_ctx_scan::prefix_innermost_unclosed_paren_with_openers;
use crate::r5::snippet_eof::{has_incomplete_continuation_tail, slice_adds_unmatched_closer_cached};
use crate::r5::snippet_lex::is_code_lang;
use crate::ts_pool::{ParserPool, with_parser_pool};

const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;
const BINARY_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "pdf", "zip", "gz", "tar", "7z", "rar",
    "xz", "zst", "exe", "dll", "so", "dylib", "a", "o", "bin", "wasm", "class", "pyc", "jar",
    "woff", "woff2", "ttf", "otf", "eot", "mp3", "mp4", "mov", "avi", "wav", "ogg", "sqlite", "db", "lockb",
];

#[derive(Debug, Default)]
pub struct DefaultSyntaxFirewall;

impl SyntaxFirewall for DefaultSyntaxFirewall {
    fn verify(&self, candidate_native: &str, path: &Path, lang: LanguageId) -> FirewallVerdict {
        self.verify_incremental(None, candidate_native, path, lang)
    }

    fn verify_incremental(
        &self, baseline_native: Option<&str>, candidate_native: &str, path: &Path, lang: LanguageId,
    ) -> FirewallVerdict {
        if let Some(diag) = check_binary_or_limit(candidate_native, path) {
            return FirewallVerdict::Invalid { diagnostics: vec![diag] };
        }
        with_parser_pool(|pool| {
            let Some(base) = baseline_native else {
                let (cand_spans, _) = collect_lang_spans_with_tree(lang, candidate_native, path, pool);
                return verdict_from_spans(candidate_native, cand_spans);
            };
            let (base_spans, base_tree) = collect_lang_spans_with_tree(lang, base, path, pool);
            let cand_spans = if base.len() >= 2048 && let Some(ref bt) = base_tree {
                collect_r5_with_base_edit(lang, base, candidate_native, bt, path, pool)
            } else {
                collect_lang_spans_with_tree(lang, candidate_native, path, pool).0
            };
            if base_spans.is_empty() {
                return verdict_from_spans(candidate_native, cand_spans);
            }
            verify_prebroken_delta(lang, path, pool, base, candidate_native, &base_spans, &cand_spans, base_tree.as_ref())
        })
    }
}

fn check_binary_or_limit(candidate_native: &str, path: &Path) -> Option<FirewallDiagnostic> {
    let mk = |message: String| FirewallDiagnostic { line: 1, column: 1, message, context: String::new() };
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        let lower = ext.to_ascii_lowercase();
        if BINARY_EXTENSIONS.contains(&lower.as_str()) {
            return Some(mk(format!("Refusing to verify binary file extension '.{lower}'")));
        }
    }
    if candidate_native.as_bytes().contains(&0) {
        return Some(mk("Refusing binary payload containing NUL bytes".to_string()));
    }
    if candidate_native.len() > MAX_TEXT_BYTES {
        return Some(mk(format!("Payload size {} bytes exceeds 2 MiB text limit", candidate_native.len())));
    }
    None
}

fn collect_lang_spans_with_tree(
    lang: LanguageId,
    src: &str,
    path: &Path,
    pool: &mut ParserPool,
) -> (Vec<ErrorSpan>, Option<tree_sitter::Tree>) {
    use LanguageId::*;
    match lang {
        PlainText | Aice => (Vec::new(), None),
        AnsiSql | PostgreSql | MySql | Sqlite | TSql | Prisma | GraphQl | Cypher
        | DbMigration => match crate::r6::verify_r6_firewall(lang, src, pool) {
            Ok(()) => (Vec::new(), None),
            Err(issues) => (
                issues.into_iter().map(|d| ErrorSpan {
                    line: d.line, column: d.column, end_line: d.line, message: d.message,
                }).collect(),
                None,
            ),
        },
        _ => match collect_r5_error_spans_with_tree(lang, src, path, pool) {
            Ok(res) => res,
            Err(span) => (vec![span], None),
        },
    }
}

fn verdict_from_spans(src: &str, spans: Vec<ErrorSpan>) -> FirewallVerdict {
    if spans.is_empty() {
        FirewallVerdict::Valid
    } else {
        FirewallVerdict::Invalid { diagnostics: spans_to_diagnostics(src, spans) }
    }
}

#[allow(clippy::too_many_arguments)]
fn verify_prebroken_delta(
    lang: LanguageId,
    path: &Path,
    pool: &mut ParserPool,
    base: &str,
    cand: &str,
    base_spans: &[ErrorSpan],
    cand_spans: &[ErrorSpan],
    base_tree: Option<&tree_sitter::Tree>,
) -> FirewallVerdict {
    if cand_spans.is_empty() {
        return FirewallVerdict::Valid;
    }
    let base_lines: Vec<&str> = base.lines().collect();
    let cand_lines: Vec<&str> = cand.lines().collect();
    let min_len = base_lines.len().min(cand_lines.len());
    let prefix = base_lines
        .iter()
        .zip(cand_lines.iter())
        .take_while(|(a, b)| a == b)
        .count();
    let max_suffix = min_len - prefix;
    let suffix = base_lines
        .iter()
        .rev()
        .zip(cand_lines.iter().rev())
        .take(max_suffix)
        .take_while(|(a, b)| a == b)
        .count();
    let base_edit_start = prefix + 1;
    let base_edit_end = base_lines.len().saturating_sub(suffix);
    let cand_edit_start = prefix + 1;
    let cand_edit_end = cand_lines.len().saturating_sub(suffix);
    let line_delta = cand_lines.len() as isize - base_lines.len() as isize;
    let is_eof_append =
        suffix == 0 && base_edit_end < base_edit_start && cand_edit_end >= cand_edit_start;
    let last_code_idx = last_code_line_idx_with_tree(lang, &base_lines[..prefix], base, base_tree, pool);
    let prefix_ends_incomplete = last_code_idx
        .is_some_and(|i| has_incomplete_continuation_tail(lang, base_lines[i], path, pool));
    let mut delta_ctx = EofDeltaCtx::new(
        lang, &base_lines, &cand_lines, base_spans, is_eof_append, prefix, base_edit_start,
        base_edit_end, cand_edit_start, cand_edit_end, line_delta, last_code_idx,
        prefix_ends_incomplete, pool,
    );
    let edit_pair = (base_edit_end >= base_edit_start || cand_edit_end >= cand_edit_start).then(|| {
        let raw_base = if base_edit_end >= base_edit_start { &base_lines[(base_edit_start - 1)..base_edit_end] } else { &[][..] };
        let raw_cand = if cand_edit_end >= cand_edit_start { &cand_lines[(cand_edit_start - 1)..cand_edit_end] } else { &[][..] };
        (raw_base, raw_cand)
    });
    let raw_cand_slice = edit_pair.map_or(&[][..], |(_, rc)| rc);
    let (mut checked_edit_slice, mut need_edit_check) = (false, false);
    if cand_spans.len() > base_spans.len() {
        if !delta_ctx.allow_span_split(raw_cand_slice, cand_spans, path, pool) {
            return FirewallVerdict::Invalid {
                diagnostics: spans_to_diagnostics(cand, delta_ctx.select_delta_error_spans(cand_spans)),
            };
        }
        need_edit_check = true;
    }
    let base_in_edit = count_overlapping(base_spans, base_edit_start, base_edit_end);
    let cand_in_edit = delta_ctx.cand_in_edit_count(cand_spans);
    if (base_in_edit == 0 && cand_in_edit > 0) || cand_in_edit > base_in_edit {
        if delta_ctx.try_midfile_split(raw_cand_slice, cand_spans, path, pool) {
            need_edit_check = true;
        } else {
            return FirewallVerdict::Invalid {
                diagnostics: spans_to_diagnostics(cand, delta_ctx.select_delta_error_spans(cand_spans)),
            };
        }
    }
    let mut pfx_cache: Option<PrefixCache> = None;
    for sp in cand_spans {
        if sp.end_line <= prefix {
            if !delta_ctx.is_covered_prefix_span(sp, &mut need_edit_check) {
                if delta_ctx.try_midfile_split(raw_cand_slice, cand_spans, path, pool) {
                    need_edit_check = true;
                } else {
                    return invalid_span(cand, sp);
                }
            }
        } else if sp.line > cand_edit_end.max(prefix) && !delta_ctx.is_shifted_eof(sp) {
            let shifted_line = (sp.line as isize - line_delta).max(1) as usize;
            let shifted_end = (sp.end_line as isize - line_delta).max(1) as usize;
            if !base_spans.iter().any(|b| b.line == shifted_line && b.end_line == shifted_end && b.message == sp.message)
                && !delta_ctx.is_pure_del_suffix_span(sp)
                && !delta_ctx.try_midfile_split(raw_cand_slice, cand_spans, path, pool)
            {
                return invalid_span(cand, sp);
            }
            if is_code_lang(lang) || cand_edit_end < cand_edit_start { need_edit_check = true; }
        } else {
            let existed = delta_ctx.is_existing_span(sp) || delta_ctx.is_xml_bom_line1_span(sp);
            let in_edit = sp.line >= cand_edit_start && sp.end_line <= cand_edit_end;
            if (!existed || !checked_edit_slice) && let Some((raw_base, raw_cand)) = edit_pair {
                let pfx = &base_lines[..prefix];
                let cache = pfx_cache.get_or_insert_with(|| {
                    PrefixCache::new(lang, pfx, base, prefix == base_lines.len(), base_tree, path, pool)
                });
                if !existed
                    && !(in_edit && (cache.blk_depth > 0
                        || (suffix == 0 && !cache.openers.is_empty()
                            && matches!(sp.message.as_str(), "Missing syntax element: '}'" | "Missing syntax element: ')'" | "Missing syntax element: ']'"))))
                    && !delta_ctx.try_midfile_split(raw_cand_slice, cand_spans, path, pool)
                {
                    return invalid_span(cand, sp);
                }
                if !checked_edit_slice {
                    checked_edit_slice = true;
                    let er = delta_ctx.edit_slice_has_error_midfile(
                        path, pool, pfx, raw_base, raw_cand, &cand_lines[cand_edit_end..], last_code_idx, cache,
                    );
                    match er {
                        None => return if existed && sp.line < cand_edit_start {
                            invalid_diag(cand, cand_edit_start, 1, "Edited lines introduce syntax error inside existing error span")
                        } else {
                            invalid_span(cand, sp)
                        },
                        Some(true) => return invalid_diag(cand, cand_edit_start, 1, "Edited lines introduce syntax error inside existing error span"),
                        Some(false) => {}
                    }
                }
            } else if !existed {
                return invalid_span(cand, sp);
            }
        }
    }
    if !checked_edit_slice && let Some((raw_base, raw_cand)) = edit_pair {
        let pfx = &base_lines[..prefix];
        let cache = pfx_cache.get_or_insert_with(|| {
            PrefixCache::new(lang, pfx, base, prefix == base_lines.len(), base_tree, path, pool)
        });
        let unm = slice_adds_unmatched_closer_cached(lang, pfx, raw_base, raw_cand, cache, path, pool);
        let last_ln = last_code_idx.map(|i| i + 1);
        let tail_broken = (prefix_ends_incomplete
            && last_ln.is_some_and(|ln| base_spans.iter().any(|b| b.end_line <= prefix && b.line <= ln && ln <= b.end_line)))
            || prefix_innermost_unclosed_paren_with_openers(lang, pfx, last_code_idx, &cache.openers, pool).is_some_and(|(op_ln, has_comma)| {
                base_spans.iter().any(|b| {
                    b.end_line <= prefix
                        && b.line <= op_ln
                        && if has_comma { op_ln <= b.end_line } else { last_ln.is_some_and(|ln| ln <= b.end_line) }
                })
            });
        if (unm
            || need_edit_check
            || tail_broken
            || (raw_cand.is_empty() && !raw_base.is_empty())
            || delta_ctx.needs_scoped_edit_check(cache, raw_base, raw_cand, last_code_idx, path, pool)
            || (is_code_lang(lang) && is_eof_append))
            && delta_ctx.edit_slice_has_error_midfile(
                path, pool, pfx, raw_base, raw_cand, &cand_lines[cand_edit_end..], last_code_idx, cache,
            ) != Some(false)
        {
            let msg = if unm { "Edited lines introduce unmatched closing delimiter" } else { "Edited lines introduce syntax error inside existing error span" };
            return invalid_diag(cand, cand_edit_start, 1, msg);
        }
    }
    FirewallVerdict::Valid
}
fn invalid_diag(cand: &str, line: usize, column: usize, message: &str) -> FirewallVerdict {
    FirewallVerdict::Invalid {
        diagnostics: vec![FirewallDiagnostic { line, column, message: message.to_string(), context: format_context(cand, line) }],
    }
}
fn invalid_span(cand: &str, sp: &ErrorSpan) -> FirewallVerdict { invalid_diag(cand, sp.line, sp.column, &sp.message) }
fn overlaps_edit(sp: &ErrorSpan, edit_start: usize, edit_end: usize) -> bool {
    if edit_end < edit_start { sp.line <= edit_start && sp.end_line >= edit_start } else { sp.line <= edit_end && sp.end_line >= edit_start }
}
fn count_overlapping(spans: &[ErrorSpan], edit_start: usize, edit_end: usize) -> usize {
    spans.iter().filter(|sp| overlaps_edit(sp, edit_start, edit_end)).count()
}
