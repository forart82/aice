use aice_aice_ir::DefaultAiceTranspiler;
use aice_ast_engine::EngineRegistry;
use aice_governance::escape_json_str;
use aice_lang_registry::LanguageId;

use crate::budget::{count_cl100k_exact, truncate_to_token_budget};
use crate::search::SearchParams;
use crate::search_aice::render_search_hit_aice;
use crate::search_rank::SearchHit;

pub(crate) struct SearchBundleOutcome {
    pub bundle: String,
    pub included_indices: Vec<usize>,
}

pub(crate) fn build_budgeted_bundle(
    hits: &[SearchHit],
    sources: &[String],
    registry: &EngineRegistry,
    transpiler: &DefaultAiceTranspiler,
    params: &SearchParams<'_>,
    max_tokens: usize,
) -> SearchBundleOutcome {
    if hits.is_empty() {
        return SearchBundleOutcome { bundle: String::new(), included_indices: Vec::new() };
    }
    if max_tokens == 0 {
        return SearchBundleOutcome {
            bundle: format!(
                "// +{} more matching files — next: aice search \"{}\" {}\n",
                hits.len(),
                params.pattern,
                hits[0].rel_path
            ),
            included_indices: Vec::new(),
        };
    }

    let mut bundle = String::new();
    let mut included_indices = Vec::new();
    let max_files = if params.full { hits.len() } else { hits.len().min(20) };
    for (idx, (hit, src)) in hits.iter().zip(sources.iter()).take(max_files).enumerate() {
        let chunk = render_search_hit_aice(
            hit,
            src,
            registry,
            transpiler,
            params.line_numbers,
            params.full,
        );
        if idx > 0 && count_cl100k_exact(&format!("{bundle}{chunk}")) > max_tokens {
            let rem = hits.len().saturating_sub(idx);
            let bundle = append_search_hint(bundle, rem, params.pattern, &hit.rel_path, max_tokens);
            return SearchBundleOutcome { bundle, included_indices };
        }
        if idx == 0 && count_cl100k_exact(&chunk) > max_tokens {
            let rem = hits.len().saturating_sub(1);
            let hint = (rem > 0)
                .then(|| pick_search_hint_line(rem, params.pattern, &hits[1].rel_path, max_tokens))
                .flatten();
            let (trimmed, _) = truncate_to_token_budget(&chunk, max_tokens, hint.as_deref());
            if has_search_hit_content(&hit.rel_path, hit.lang, &trimmed) {
                return SearchBundleOutcome { bundle: trimmed, included_indices: vec![0] };
            }
            let notice = pick_omitted_search_notice(hits.len(), params.pattern, &hit.rel_path, max_tokens);
            return SearchBundleOutcome { bundle: notice, included_indices: Vec::new() };
        }
        bundle.push_str(&chunk);
        included_indices.push(idx);
    }
    if hits.len() > max_files {
        let rem = hits.len() - max_files;
        let bundle = append_search_hint(
            bundle,
            rem,
            params.pattern,
            &hits[max_files].rel_path,
            max_tokens,
        );
        return SearchBundleOutcome { bundle, included_indices };
    }
    SearchBundleOutcome { bundle, included_indices }
}

fn is_slice_line_marker(t: &str) -> bool {
    t.strip_prefix("# L")
        .and_then(|rest| rest.split_once("-L"))
        .is_some_and(|(a, b)| {
            !a.is_empty()
                && !b.is_empty()
                && a.bytes().all(|c| c.is_ascii_digit())
                && b.bytes().all(|c| c.is_ascii_digit())
        })
}

fn has_search_hit_content(rel_path: &str, lang: LanguageId, text: &str) -> bool {
    let expected_hdr = format!("{rel_path}:");
    let mut lines = text.lines();
    let Some(first) = lines.next() else {
        return false;
    };
    if first.trim() != expected_hdr {
        return false;
    }
    let is_code_aice = lang != LanguageId::PlainText;
    lines.any(|l| {
        let t = l.trim();
        if t.is_empty() || t == ".." || t.starts_with("// ...") || t.starts_with("// +") {
            return false;
        }
        if is_code_aice && (l.starts_with("  module ") || l.starts_with("  lang ") || is_slice_line_marker(t)) {
            return false;
        }
        true
    })
}

fn pick_omitted_search_notice(
    total: usize,
    pattern: &str,
    first_rel: &str,
    max_tokens: usize,
) -> String {
    let long = format!("// +{total} more matching files — next: aice search \"{pattern}\" {first_rel}\n");
    let short = format!("// +{total} more\n");
    for cand in [long, short, "// ...\n".to_string()] {
        if count_cl100k_exact(&cand) <= max_tokens {
            return cand;
        }
    }
    String::new()
}

pub(crate) fn budget_files_with_matches(
    pattern: &str,
    sorted_paths: &[String],
    explicit_max_tokens: Option<usize>,
    budget: usize,
    json: bool,
) -> (String, Vec<String>) {
    if json {
        let Some(_) = explicit_max_tokens else {
            return (format_search_json(pattern, sorted_paths, "", true), sorted_paths.to_vec());
        };
        let mut lo = 0usize;
        let mut hi = sorted_paths.len();
        while lo < hi {
            let mid = lo + (hi - lo).div_ceil(2);
            let cand = format_search_json(pattern, &sorted_paths[..mid], "", true);
            if count_cl100k_exact(&cand) <= budget {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        let kept = sorted_paths[..lo].to_vec();
        return (format_search_json(pattern, &kept, "", true), kept);
    }
    let joined = format!("{}\n", sorted_paths.join("\n"));
    if explicit_max_tokens.is_none() || count_cl100k_exact(&joined) <= budget {
        return (joined, sorted_paths.to_vec());
    }
    if budget == 0 {
        return (String::new(), Vec::new());
    }
    for k in (1..sorted_paths.len()).rev() {
        let prefix = format!("{}\n", sorted_paths[..k].join("\n"));
        for tail in ["// ... [truncated]\n", "// ...\n"] {
            let cand = format!("{prefix}{tail}");
            if count_cl100k_exact(&cand) <= budget {
                return (cand, sorted_paths[..k].to_vec());
            }
        }
    }
    let notice = if count_cl100k_exact("// ...\n") <= budget {
        "// ...\n".to_string()
    } else {
        String::new()
    };
    (notice, Vec::new())
}

fn pick_search_hint_line(rem: usize, pattern: &str, next_rel: &str, max_tokens: usize) -> Option<String> {
    let long = format!("// +{rem} more matching files — next: aice search \"{pattern}\" {next_rel}");
    let short = format!("// +{rem} more");
    for cand in [long, short] {
        if count_cl100k_exact(&format!("{cand}\n")) <= max_tokens {
            return Some(cand);
        }
    }
    None
}

fn append_search_hint(
    bundle: String,
    rem: usize,
    pattern: &str,
    next_rel: &str,
    max_tokens: usize,
) -> String {
    let long = format!("// +{rem} more matching files — next: aice search \"{pattern}\" {next_rel}\n");
    let short = format!("// +{rem} more\n");
    for cand in [long, short] {
        let with_hint = format!("{bundle}{cand}");
        if count_cl100k_exact(&with_hint) <= max_tokens {
            return with_hint;
        }
    }
    bundle
}

pub(crate) fn format_search_json(
    pattern: &str,
    files: &[String],
    formatted_bundle: &str,
    files_with_matches: bool,
) -> String {
    let mut out = String::from("{\n  \"mode\": \"search\",\n  \"pattern\": ");
    escape_json_str(pattern, &mut out);
    out.push_str(",\n  \"selector\": ");
    escape_json_str(&format!("/{pattern}/"), &mut out);
    out.push_str(&format!(",\n  \"count\": {}", files.len()));
    if files_with_matches {
        out.push_str(",\n  \"filesWithMatches\": true");
    }
    out.push_str(",\n  \"files\": [");
    for (i, f) in files.iter().enumerate() {
        if i > 0 {
            out.push_str(", ");
        }
        escape_json_str(f, &mut out);
    }
    out.push(']');
    if !files_with_matches {
        out.push_str(",\n  \"formattedBundle\": ");
        escape_json_str(formatted_bundle.trim_end_matches('\n'), &mut out);
    }
    out.push_str("\n}\n");
    out
}
