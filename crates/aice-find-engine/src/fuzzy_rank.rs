use crate::fuzzy_score::{
    extract_basename_and_stem, levenshtein_fallback, normalize_sep, score_pair,
    score_trailing_segments,
};

#[derive(Debug, Clone, PartialEq)]
pub struct FuzzyMatch {
    pub target: String,
    pub score: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FuzzyResolveOpts {
    pub auto_min_score: f64,
    pub auto_margin: f64,
    pub suggest_min_score: f64,
    pub max_suggestions: usize,
}

impl Default for FuzzyResolveOpts {
    fn default() -> Self {
        Self {
            auto_min_score: 0.78,
            auto_margin: 0.15,
            suggest_min_score: 0.25,
            max_suggestions: 5,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum FuzzyResolution {
    Exact(String),
    AutoResolved { target: String, score: f64 },
    Ambiguous(Vec<FuzzyMatch>),
    NotFound,
}

pub fn score_candidate(query: &str, candidate: &str) -> f64 {
    if query.is_empty() || candidate.is_empty() {
        return 0.0;
    }
    let q_norm = normalize_sep(query);
    let c_norm = normalize_sep(candidate);
    if c_norm == q_norm {
        return 1.0;
    }
    if c_norm.to_lowercase() == q_norm.to_lowercase() {
        return 0.98;
    }

    let is_qualified = q_norm.contains('/');
    if !is_qualified {
        let (base, stem) = extract_basename_and_stem(&c_norm);
        let base_score = score_pair(&q_norm, base).max(score_pair(&q_norm, stem) * 0.99);
        let full_score = score_pair(&q_norm, &c_norm);
        if base_score == 0.0 && full_score == 0.0 {
            return 0.0;
        }
        let combined = (0.70 * base_score + 0.30 * full_score).max(base_score * 0.95);
        return if combined < 0.25 { 0.0 } else { combined.min(0.97) };
    }

    let full_score = score_pair(&q_norm, &c_norm);
    let (seg_score, same_or_deeper) = score_trailing_segments(&q_norm, &c_norm);
    let combined = if same_or_deeper {
        (0.45 * full_score + 0.55 * seg_score).max(full_score * 0.90)
    } else {
        0.45 * full_score + 0.55 * seg_score
    };
    if combined < 0.25 { 0.0 } else { combined.min(0.97) }
}

pub fn rank_candidates(query: &str, candidates: &[String]) -> Vec<FuzzyMatch> {
    let mut scored: Vec<FuzzyMatch> = candidates
        .iter()
        .map(|c| FuzzyMatch {
            target: c.clone(),
            score: score_candidate(query, c),
        })
        .collect();
    scored.sort_by(|a, b| b.score.total_cmp(&a.score).then_with(|| a.target.cmp(&b.target)));
    scored
}

pub fn resolve_target(
    query: &str,
    candidates: &[String],
    opts: &FuzzyResolveOpts,
) -> FuzzyResolution {
    if query.trim().is_empty() || candidates.is_empty() {
        return FuzzyResolution::NotFound;
    }
    let mut ranked = rank_candidates(query, candidates);
    ranked.dedup_by(|a, b| a.target == b.target);
    let Some(top) = ranked.first() else {
        return FuzzyResolution::NotFound;
    };
    if top.score >= 1.0 - 1e-9 {
        let exact_case_ties: Vec<FuzzyMatch> = ranked
            .iter()
            .filter(|m| m.score >= 1.0 - 1e-9)
            .take(opts.max_suggestions)
            .cloned()
            .collect();
        if exact_case_ties.len() <= 1 {
            return FuzzyResolution::Exact(top.target.clone());
        }
        return FuzzyResolution::Ambiguous(exact_case_ties);
    }
    if top.score >= 0.98 {
        let exact_ties: Vec<FuzzyMatch> = ranked
            .iter()
            .filter(|m| m.score >= 0.98)
            .take(opts.max_suggestions)
            .cloned()
            .collect();
        if exact_ties.len() <= 1 {
            return FuzzyResolution::Exact(top.target.clone());
        }
        return FuzzyResolution::Ambiguous(exact_ties);
    }
    let second_score = ranked.get(1).map_or(0.0, |m| m.score);
    if top.score >= opts.auto_min_score
        && (ranked.len() == 1 || top.score - second_score >= opts.auto_margin)
    {
        return FuzzyResolution::AutoResolved {
            target: top.target.clone(),
            score: top.score,
        };
    }

    let mut suggestions: Vec<FuzzyMatch> = ranked
        .into_iter()
        .filter(|m| m.score >= opts.suggest_min_score)
        .take(opts.max_suggestions)
        .collect();

    if suggestions.is_empty() {
        suggestions = levenshtein_fallback(query, candidates, opts);
    }

    if suggestions.is_empty() {
        FuzzyResolution::NotFound
    } else {
        FuzzyResolution::Ambiguous(suggestions)
    }
}

pub fn format_did_you_mean(matches: &[FuzzyMatch], is_pattern: bool) -> String {
    if matches.is_empty() {
        return String::new();
    }
    let prefix = if is_pattern {
        "\nAvailable symbols: "
    } else {
        "\nDid you mean: "
    };
    let names: Vec<&str> = matches.iter().map(|m| m.target.as_str()).collect();
    format!("{prefix}{}", names.join(", "))
}
