use crate::budget::{count_cl100k_exact, truncate_to_token_budget};

pub struct BudgetCandidate {
    pub rel_path: String,
    pub header: String,
    pub emitted: String,
    pub outline_text: String,
    pub is_expanded: bool,
    pub synthetic_module_line: Option<String>,
}

pub(crate) struct ActiveSlot {
    pub orig_idx: usize,
    pub current: String,
    pub full_tok: usize,
    pub tok: usize,
    pub outline: Option<(String, usize)>,
    pub compacted: bool,
    pub kept: bool,
}

impl ActiveSlot {
    pub(crate) fn new(orig_idx: usize, cand: &BudgetCandidate) -> Self {
        let current = cand.emitted.clone();
        let full_tok = count_cl100k_exact(&current);
        let outline = if cand.outline_text.is_empty() {
            None
        } else {
            let s = format!(
                "{}// [compacted to :outline to fit token budget]\n{}",
                cand.header, cand.outline_text
            );
            let ot = count_cl100k_exact(&s);
            (ot < full_tok).then_some((s, ot))
        };
        Self { orig_idx, current, full_tok, tok: full_tok, outline, compacted: false, kept: true }
    }
}

pub(crate) fn is_non_content_marker(cand: &BudgetCandidate, line: &str) -> bool {
    let t = line.trim();
    t.is_empty()
        || t.starts_with("// ... [truncated")
        || t == "// ..."
        || t.starts_with("// [compacted to :outline")
        || cand.synthetic_module_line.as_deref() == Some(t)
}

pub(crate) fn content_line_count(cand: &BudgetCandidate, text: &str) -> usize {
    text.lines()
        .skip(cand.header.lines().count())
        .filter(|l| !is_non_content_marker(cand, l))
        .count()
}

pub(crate) fn min_kept_lines(cand: &BudgetCandidate) -> usize {
    if cand.header.is_empty() {
        1
    } else {
        cand.header.lines().count() + 1
    }
}

pub(crate) fn has_target_identity(cand: &BudgetCandidate, text: &str) -> bool {
    if cand.header.is_empty() {
        return !text.is_empty() && text.contains(&cand.rel_path);
    }
    let hdr_line = cand.header.lines().next().unwrap_or("");
    !hdr_line.is_empty()
        && text.starts_with(cand.header.as_str())
        && content_line_count(cand, text) >= 1
}

pub(crate) fn minimal_target_tokens(cand: &BudgetCandidate) -> Option<usize> {
    let full_tok = count_cl100k_exact(&cand.emitted);
    if cand.header.is_empty() {
        return Some(full_tok);
    }
    let first_content = cand
        .emitted
        .lines()
        .skip(cand.header.lines().count())
        .find(|l| !is_non_content_marker(cand, l))?;
    let trunc_min = ["// ... [truncated]\n", "// ...\n"]
        .into_iter()
        .map(|tail| count_cl100k_exact(&format!("{}{first_content}\n{tail}", cand.header)))
        .min()?;
    Some(full_tok.min(trunc_min))
}

pub(crate) fn fit_minimal_target(cand: &BudgetCandidate, budget: usize) -> Option<String> {
    if cand.header.is_empty() {
        return (count_cl100k_exact(&cand.emitted) <= budget).then(|| cand.emitted.clone());
    }
    let first_content = cand
        .emitted
        .lines()
        .skip(cand.header.lines().count())
        .find(|l| !is_non_content_marker(cand, l))?;
    ["// ... [truncated]\n", "// ...\n"]
        .into_iter()
        .map(|tail| format!("{}{first_content}\n{tail}", cand.header))
        .find(|s| count_cl100k_exact(s) <= budget)
}

pub(crate) fn is_viable_candidate(cand: &BudgetCandidate, max_tokens: usize) -> bool {
    if !cand.header.is_empty() && content_line_count(cand, &cand.emitted) == 0 {
        return false;
    }
    if cand.emitted.lines().count() <= 4 && count_cl100k_exact(&cand.emitted) <= max_tokens {
        return true;
    }
    if !cand.header.is_empty() && count_cl100k_exact(&cand.header) >= max_tokens {
        return false;
    }
    fit_minimal_target(cand, max_tokens).is_some()
}

pub(crate) fn trim_candidate_to_quota(
    cand: &BudgetCandidate,
    current: &str,
    full_tok: usize,
    quota: usize,
) -> Option<(String, bool)> {
    let hint = if quota < 16 {
        "// ... [truncated]".to_string()
    } else {
        format!("// ... [truncated {}; {} tokens]", cand.rel_path, full_tok)
    };
    let (trimmed, was_trunc) = truncate_to_token_budget(current, quota, Some(&hint));
    if count_cl100k_exact(&trimmed) <= quota && has_target_identity(cand, &trimmed) {
        Some((trimmed, was_trunc))
    } else {
        fit_minimal_target(cand, quota).map(|min_fit| (min_fit, true))
    }
}

pub(crate) fn footer_reserve_for(
    omitted: usize,
    alive: usize,
    max_tokens: usize,
    min_alive_tok: usize,
) -> usize {
    if omitted == 0 {
        return 0;
    }
    let join_sep = alive.saturating_sub(1);
    let long_ft = count_cl100k_exact(&format!("// +{omitted} more target(s) omitted (budget)\n")) + 1;
    if max_tokens >= join_sep + long_ft + min_alive_tok {
        return long_ft;
    }
    let short_ft = count_cl100k_exact(&format!("// +{omitted} omitted\n")) + 1;
    if max_tokens >= join_sep + short_ft + min_alive_tok {
        return short_ft;
    }
    0
}

pub(crate) fn append_omitted_notice(joined: String, omitted: usize, max_tokens: usize) -> String {
    let long = if joined.is_empty() {
        format!("// +{omitted} target(s) omitted (budget)\n")
    } else {
        format!("// +{omitted} more target(s) omitted (budget)\n")
    };
    let short = format!("// +{omitted} omitted\n");
    let cands: [&str; 3] = if joined.is_empty() {
        [&long, &short, "// ...\n"]
    } else {
        [&long, &short, ""]
    };
    for cand in cands.into_iter().filter(|c| !c.is_empty()) {
        let with_footer = if joined.is_empty() {
            cand.to_string()
        } else if joined.ends_with('\n') {
            format!("{joined}{cand}")
        } else {
            format!("{joined}\n{cand}")
        };
        if count_cl100k_exact(&with_footer) <= max_tokens {
            return with_footer;
        }
    }
    joined
}
