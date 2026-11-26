use std::collections::BTreeSet;

pub fn trigrams(input: &str) -> BTreeSet<[char; 3]> {
    let chars: Vec<char> = input.to_lowercase().chars().collect();
    let mut set = BTreeSet::new();
    for win in chars.windows(3) {
        set.insert([win[0], win[1], win[2]]);
    }
    set
}

pub fn trigram_similarity(a: &str, b: &str) -> f64 {
    let ta = trigrams(a);
    let tb = trigrams(b);
    if ta.is_empty() || tb.is_empty() {
        return 0.0;
    }
    let inter = ta.intersection(&tb).count() as f64;
    let union = ta.union(&tb).count() as f64;
    inter / union
}

pub fn padded_trigram_similarity(a: &str, b: &str) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let ta = padded_trigrams(a);
    let tb = padded_trigrams(b);
    if ta.is_empty() || tb.is_empty() {
        return 0.0;
    }
    let inter = ta.intersection(&tb).count() as f64;
    let union = ta.union(&tb).count() as f64;
    inter / union
}

fn padded_trigrams(input: &str) -> BTreeSet<[char; 3]> {
    let mut chars = Vec::with_capacity(input.len() + 3);
    chars.push('\0');
    chars.push('\0');
    chars.extend(input.to_lowercase().chars());
    chars.push('\0');
    let mut set = BTreeSet::new();
    for win in chars.windows(3) {
        set.insert([win[0], win[1], win[2]]);
    }
    set
}

pub fn levenshtein_distance(a: &str, b: &str) -> usize {
    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();
    if a_chars.is_empty() {
        return b_chars.len();
    }
    if b_chars.is_empty() {
        return a_chars.len();
    }
    let (short, long) = if a_chars.len() <= b_chars.len() {
        (&a_chars[..], &b_chars[..])
    } else {
        (&b_chars[..], &a_chars[..])
    };
    let m = short.len();
    let mut prev: Vec<usize> = (0..=m).collect();
    let mut curr = vec![0usize; m + 1];
    for &lc in long {
        curr[0] = prev[0] + 1;
        for j in 0..m {
            let cost = usize::from(lc != short[j]);
            curr[j + 1] = (prev[j + 1] + 1).min(curr[j] + 1).min(prev[j] + cost);
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    prev[m]
}

pub fn edit_distance_with_substring_bonus(query_lower: &str, cand_lower: &str) -> usize {
    let mut dist = levenshtein_distance(query_lower, cand_lower);
    if !query_lower.is_empty()
        && (cand_lower.contains(query_lower)
            || (cand_lower.chars().count() >= 3 && query_lower.contains(cand_lower)))
    {
        dist = dist.min(1);
    }
    dist
}

pub fn levenshtein_similarity(query: &str, candidate: &str) -> f64 {
    if query.is_empty() || candidate.is_empty() {
        return 0.0;
    }
    let q = query.to_lowercase();
    let c = candidate.to_lowercase();
    if q == c {
        return 1.0;
    }
    let max_len = q.chars().count().max(c.chars().count()).max(1);
    let dist = edit_distance_with_substring_bonus(&q, &c);
    (1.0 - (dist as f64 / max_len as f64)).clamp(0.0, 1.0)
}

pub fn extract_boundary_initials(s: &str) -> String {
    let mut out = String::new();
    let mut prev: Option<char> = None;
    for ch in s.chars() {
        if ch.is_alphanumeric() {
            let is_boundary = match prev {
                None => true,
                Some(p) if is_sep_char(p) => true,
                Some(p) if ch.is_uppercase() && (p.is_lowercase() || p.is_ascii_digit()) => true,
                _ => false,
            };
            if is_boundary {
                for lc in ch.to_lowercase() {
                    out.push(lc);
                }
            }
        }
        prev = Some(ch);
    }
    out
}

pub fn subsequence_boundary_score(query: &str, candidate: &str) -> f64 {
    let q_chars: Vec<char> = query.to_lowercase().chars().collect();
    if q_chars.is_empty() || candidate.is_empty() {
        return 0.0;
    }
    let cand_orig: Vec<char> = candidate.chars().collect();
    let cand_low: Vec<char> = cand_orig.iter().flat_map(|c| c.to_lowercase()).collect();
    let boundaries = compute_boundaries(&cand_orig);

    if cand_low.len() != cand_orig.len() {
        return fallback_subseq(&q_chars, &cand_low);
    }

    let mut qi = 0usize;
    let mut first_idx = None;
    let mut last_idx = 0usize;
    let mut prev_match: Option<usize> = None;
    let mut weight_sum = 0.0f64;

    for (ci, &cc) in cand_low.iter().enumerate() {
        if qi >= q_chars.len() {
            break;
        }
        if cc == q_chars[qi] {
            if first_idx.is_none() {
                first_idx = Some(ci);
            }
            last_idx = ci;
            let w = if boundaries[ci] {
                1.0
            } else if prev_match.is_some_and(|p| p + 1 == ci) {
                0.9
            } else {
                0.35
            };
            weight_sum += w;
            prev_match = Some(ci);
            qi += 1;
        }
    }

    if qi < q_chars.len() {
        return 0.0;
    }

    let q_len = q_chars.len() as f64;
    let span = (last_idx - first_idx.unwrap_or(0) + 1) as f64;
    let quality = weight_sum / q_len;
    let density = q_len / span.max(q_len);
    let mut score = (0.65 * quality + 0.35 * density).clamp(0.0, 1.0);

    let q_alnum: String = q_chars.iter().filter(|c| c.is_alphanumeric()).collect();
    let initials = extract_boundary_initials(candidate);
    if q_alnum.chars().count() >= 2 {
        if initials == q_alnum {
            score = score.max(0.88);
        } else if initials.starts_with(&q_alnum) {
            score = score.max(0.75);
        }
    }
    score
}

fn is_sep_char(ch: char) -> bool {
    matches!(ch, '_' | '-' | '/' | '\\' | '.' | ':')
}

fn compute_boundaries(chars: &[char]) -> Vec<bool> {
    let mut out = Vec::with_capacity(chars.len());
    let mut prev: Option<char> = None;
    for &ch in chars {
        let b = match prev {
            None => true,
            Some(p) if is_sep_char(p) => true,
            Some(p) if ch.is_uppercase() && (p.is_lowercase() || p.is_ascii_digit()) => true,
            _ => false,
        };
        out.push(b);
        prev = Some(ch);
    }
    out
}

fn fallback_subseq(q_chars: &[char], cand_low: &[char]) -> f64 {
    let mut qi = 0usize;
    for &cc in cand_low {
        if qi < q_chars.len() && cc == q_chars[qi] {
            qi += 1;
        }
    }
    if qi == q_chars.len() { 0.5 } else { 0.0 }
}
