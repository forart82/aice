use crate::fuzzy_rank::{FuzzyMatch, FuzzyResolveOpts};
use crate::trigram::{
    edit_distance_with_substring_bonus, levenshtein_similarity, padded_trigram_similarity,
    subsequence_boundary_score, trigram_similarity,
};

pub(crate) fn score_pair(q: &str, cand: &str) -> f64 {
    if q.is_empty() || cand.is_empty() {
        return 0.0;
    }
    if cand == q {
        return 0.97;
    }
    let q_low = q.to_lowercase();
    let c_low = cand.to_lowercase();
    if c_low == q_low {
        return 0.96;
    }
    let q_len = q_low.chars().count().max(1) as f64;
    let c_len = c_low.chars().count().max(1) as f64;

    if c_low.starts_with(&q_low) {
        return (0.85 + 0.10 * (q_len / c_len)).min(0.95);
    }
    if c_low.contains(&q_low) {
        return (0.72 + 0.13 * (q_len / c_len)).min(0.85);
    }

    let tri = trigram_similarity(&q_low, &c_low);
    let ptri = padded_trigram_similarity(&q_low, &c_low);
    let lev = levenshtein_similarity(&q_low, &c_low);
    let sub = subsequence_boundary_score(q, cand);
    let dist = edit_distance_with_substring_bonus(&q_low, &c_low);
    let max_dist = (q_low.chars().count() / 2).max(3);

    if tri == 0.0 && sub == 0.0 && dist > max_dist {
        return 0.0;
    }

    let typo_score = 0.45 * ptri + 0.55 * lev;
    let blended = 0.35 * ptri + 0.40 * lev + 0.25 * sub;
    let acronym_boost = if sub >= 0.70 { 0.55 * sub } else { 0.0 };
    let raw = typo_score.max(blended).max(acronym_boost);
    if raw < 0.25 && sub < 0.5 && tri == 0.0 {
        0.0
    } else {
        raw.clamp(0.0, 0.94)
    }
}

pub(crate) fn normalize_sep(s: &str) -> String {
    s.replace('\\', "/").replace("::", "/")
}

pub(crate) fn extract_basename_and_stem(norm: &str) -> (&str, &str) {
    let base = norm.rsplit('/').next().unwrap_or(norm);
    let stem = base.rsplit_once('.').map_or(base, |(s, _)| {
        if s.is_empty() { base } else { s }
    });
    (base, stem)
}

pub(crate) fn score_trailing_segments(q_norm: &str, c_norm: &str) -> (f64, bool) {
    let q_segs: Vec<&str> = q_norm.split(['/', '.']).filter(|s| !s.is_empty()).collect();
    let c_segs: Vec<&str> = c_norm.split(['/', '.']).filter(|s| !s.is_empty()).collect();
    if q_segs.is_empty() || c_segs.is_empty() {
        return (0.0, false);
    }
    let k = q_segs.len().min(c_segs.len());
    let sum: f64 = q_segs[q_segs.len() - k..]
        .iter()
        .zip(&c_segs[c_segs.len() - k..])
        .map(|(qs, cs)| score_pair(qs, cs))
        .sum();
    (
        (sum / k as f64) * (k as f64 / q_segs.len() as f64),
        c_segs.len() >= q_segs.len(),
    )
}

pub(crate) fn levenshtein_fallback(
    query: &str,
    candidates: &[String],
    opts: &FuzzyResolveOpts,
) -> Vec<FuzzyMatch> {
    let q_low = query.to_lowercase();
    let q_len = q_low.chars().count();
    let max_dist = match q_len {
        0 | 1 => 0,
        2 | 3 => 1,
        _ => (q_len / 2).max(2),
    };
    if max_dist == 0 {
        return Vec::new();
    }
    let denom = (q_len.max(max_dist) + 1) as f64;
    let mut hits: Vec<(usize, f64, String)> = candidates
        .iter()
        .filter_map(|c| {
            let norm = normalize_sep(c);
            let (base, _) = extract_basename_and_stem(&norm);
            let norm_low = norm.to_lowercase();
            let base_low = base.to_lowercase();
            let d_full = edit_distance_with_substring_bonus(&q_low, &norm_low);
            let full_len = q_len.max(norm_low.chars().count());
            let d_base = edit_distance_with_substring_bonus(&q_low, &base_low);
            let base_len = q_len.max(base_low.chars().count());
            let (d, max_len) = if d_base <= d_full {
                (d_base, base_len)
            } else {
                (d_full, full_len)
            };
            if d > max_dist || d >= max_len {
                return None;
            }
            let score = (1.0 - (d as f64 / denom)).clamp(0.0, 0.90);
            (score >= opts.suggest_min_score).then(|| (d, score, c.clone()))
        })
        .collect();
    hits.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| b.1.total_cmp(&a.1))
            .then_with(|| a.2.cmp(&b.2))
    });
    hits.dedup_by(|a, b| a.2 == b.2);
    hits.into_iter()
        .take(opts.max_suggestions)
        .map(|(_, score, target)| FuzzyMatch { target, score })
        .collect()
}
