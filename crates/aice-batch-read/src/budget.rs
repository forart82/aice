use aice_governance::OutputSurface;
use aice_telemetry::{BpeCounts, count_both, count_cl100k, count_lines};

pub const DEFAULT_API_BYTE_BUDGET: usize = 28_672;
pub const DEFAULT_CLI_BYTE_BUDGET: usize = 9_216;
pub const DEFAULT_CLI_TOKEN_BUDGET: usize = 5_000;

pub fn effective_token_budget(_surface: OutputSurface, explicit_tokens: Option<usize>) -> usize {
    explicit_tokens.unwrap_or(DEFAULT_CLI_TOKEN_BUDGET)
}

pub fn effective_byte_budget(surface: OutputSurface, explicit_tokens: Option<usize>) -> usize {
    if let Some(tokens) = explicit_tokens {
        return tokens.saturating_mul(4);
    }
    match surface {
        OutputSurface::Cli | OutputSurface::Mcp => DEFAULT_CLI_BYTE_BUDGET,
    }
}

pub fn count_cl100k_exact(text: &str) -> usize {
    count_cl100k(text)
}

pub fn count_both_exact(text: &str) -> BpeCounts {
    count_both(text)
}

pub fn count_lines_exact(text: &str) -> usize {
    count_lines(text)
}

pub fn truncate_to_token_budget(
    text: &str,
    max_tokens: usize,
    overflow_hint: Option<&str>,
) -> (String, bool) {
    if text.is_empty() {
        return (text.to_string(), false);
    }
    if max_tokens == 0 {
        return (String::new(), true);
    }
    if count_cl100k(text) <= max_tokens {
        return (text.to_string(), false);
    }

    let lines: Vec<&str> = text.lines().collect();
    if lines.is_empty() {
        return (String::new(), true);
    }
    let primary_footer = overflow_hint
        .map(|h| format!("{h}\n"))
        .unwrap_or_else(|| "// ... [truncated to token budget]\n".to_string());
    let footer = pick_fitting_footer(&primary_footer, max_tokens);
    let footer_tokens = count_cl100k(&footer);
    let avail = max_tokens.saturating_sub(footer_tokens);

    let mut lo = 0usize;
    let mut hi = lines.len();
    while lo < hi {
        let mid = lo + (hi - lo).div_ceil(2);
        let candidate = join_lines(&lines[..mid]);
        if count_cl100k(&candidate) <= avail {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }

    let mut out = build_truncated_out(&lines[..lo], &footer);
    while lo > 0 && count_cl100k(&out) > max_tokens {
        lo -= 1;
        out = build_truncated_out(&lines[..lo], &footer);
    }
    (out, true)
}

fn pick_fitting_footer(primary: &str, max_tokens: usize) -> String {
    for cand in [primary, "// ... [truncated]\n", "// ...\n"] {
        if count_cl100k(cand) <= max_tokens {
            return cand.to_string();
        }
    }
    String::new()
}

fn build_truncated_out(kept: &[&str], footer: &str) -> String {
    let mut out = join_lines(kept);
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(footer);
    out
}

fn join_lines(lines: &[&str]) -> String {
    if lines.is_empty() {
        return String::new();
    }
    let mut s = lines.join("\n");
    s.push('\n');
    s
}

#[cfg(test)]
mod tests {
    use super::{count_cl100k_exact, truncate_to_token_budget};

    #[test]
    fn bpe_truncation_stays_within_budget() {
        let mut big = String::new();
        for i in 0..80 {
            big.push_str(&format!("pub fn item_{i}(val: usize) -> usize {{ val + {i} }}\n"));
        }
        let (out, truncated) = truncate_to_token_budget(&big, 60, Some("// +more"));
        assert!(truncated);
        assert!(out.contains("// +more"));
        assert!(count_cl100k_exact(&out) <= 60);
    }
}
