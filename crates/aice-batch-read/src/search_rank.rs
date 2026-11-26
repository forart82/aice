use std::path::PathBuf;

use aice_lang_registry::LanguageId;

use crate::regex_compile::CompiledPattern;

#[derive(Debug, Clone)]
pub struct SearchHit {
    pub rel_path: String,
    pub abs_path: PathBuf,
    pub lang: LanguageId,
    pub score: f64,
    pub matched_lines: Vec<usize>,
    pub windows: Vec<(usize, usize)>,
}

pub fn is_test_or_mock_path(rel: &str) -> bool {
    let low = rel.to_ascii_lowercase();
    low.contains(".spec.")
        || low.contains(".test.")
        || low.contains("_test.")
        || low.contains("_spec.")
        || low.starts_with("tests/")
        || low.contains("/tests/")
        || low.contains("/__tests__/")
        || low.contains("/mocks/")
        || low.contains("/fixtures/")
}

pub fn is_comment_line(trimmed: &str) -> bool {
    trimmed.starts_with("//")
        || trimmed.starts_with('#')
        || trimmed.starts_with("--")
        || trimmed.starts_with("/*")
        || trimmed.starts_with('*')
        || trimmed.starts_with("<!--")
        || trimmed.starts_with("{#")
}

pub fn is_identifier_query(raw: &str) -> bool {
    !raw.is_empty() && raw.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub fn score_file_matches(
    rel_path: &str,
    raw_query: &str,
    compiled: &CompiledPattern,
    lines: &[&str],
) -> Option<(f64, Vec<usize>)> {
    let ident_mode = is_identifier_query(raw_query);
    let is_test = is_test_or_mock_path(rel_path);
    let mut matched_lines = Vec::new();
    let mut best_tier_score = 0.0_f64;

    for (idx, line) in lines.iter().enumerate() {
        let Some(m) = compiled.find_in_line(line) else {
            continue;
        };
        if ident_mode && !is_whole_word_match(line, m.start_byte, m.end_byte) {
            let all = compiled.find_all_in_line(line);
            if !all
                .iter()
                .any(|hit| is_whole_word_match(line, hit.start_byte, hit.end_byte))
            {
                continue;
            }
        }
        let line_num = idx + 1;
        matched_lines.push(line_num);
        let tier_score = classify_line_score(line.trim(), raw_query, ident_mode, is_test);
        if tier_score > best_tier_score {
            best_tier_score = tier_score;
        }
    }

    if matched_lines.is_empty() {
        return None;
    }

    let mut total = best_tier_score;
    if ident_mode {
        let fname = rel_path.rsplit('/').next().unwrap_or(rel_path);
        let stem = fname.split('.').next().unwrap_or(fname);
        if stem.to_ascii_lowercase().contains(&raw_query.to_ascii_lowercase()) {
            total += if is_test { 20.0 } else { 1000.0 };
        }
    }
    let first_line = *matched_lines.first().unwrap_or(&1) as f64;
    total += 10.0 - (first_line / 100.0).min(9.9);
    Some((total, matched_lines))
}

fn is_whole_word_match(line: &str, start: usize, end: usize) -> bool {
    let before_ok = line[..start]
        .chars()
        .next_back()
        .is_none_or(|c| !c.is_alphanumeric() && c != '_');
    let after_ok = line[end..]
        .chars()
        .next()
        .is_none_or(|c| !c.is_alphanumeric() && c != '_');
    before_ok && after_ok
}

fn classify_line_score(trimmed: &str, raw_query: &str, ident_mode: bool, is_test: bool) -> f64 {
    if is_comment_line(trimmed) {
        return if is_test { 10.0 } else { 100.0 };
    }
    if ident_mode && is_exact_definition_line(trimmed, raw_query) {
        return if is_test { 80.0 } else { 650.0 };
    }
    if is_declaration_line(trimmed) {
        return if is_test { 50.0 } else { 500.0 };
    }
    if is_test { 30.0 } else { 300.0 }
}

fn is_exact_definition_line(trimmed: &str, ident: &str) -> bool {
    let prefixes = [
        "export class ",
        "class ",
        "abstract class ",
        "export interface ",
        "interface ",
        "export type ",
        "type ",
        "export enum ",
        "enum ",
        "export function ",
        "export async function ",
        "function ",
        "async function ",
        "pub fn ",
        "pub async fn ",
        "fn ",
        "pub struct ",
        "struct ",
        "pub trait ",
        "trait ",
        "pub enum ",
        "def ",
        "func ",
        "model ",
        "CREATE TABLE ",
        "create table ",
        "CREATE VIEW ",
        "create view ",
    ];
    for p in prefixes {
        if let Some(rest) = trimmed.strip_prefix(p) {
            let tok: String = rest
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            if tok == ident {
                return true;
            }
        }
    }
    false
}

fn is_declaration_line(trimmed: &str) -> bool {
    [
        "export ", "pub ", "class ", "struct ", "interface ", "trait ", "enum ", "fn ",
        "function ", "def ", "type ", "const ", "let ", "func ", "model ", "CREATE ",
        "create ", "public ", "private ", "protected ",
    ]
    .iter()
    .any(|kw| trimmed.starts_with(kw))
}

pub fn build_windows(matched_lines: &[usize], total_lines: usize, ctx: usize) -> Vec<(usize, usize)> {
    if matched_lines.is_empty() || total_lines == 0 {
        return Vec::new();
    }
    let clamped_ctx = ctx.min(total_lines);
    let mut windows: Vec<(usize, usize)> = Vec::new();
    for &ln in matched_lines {
        let s = ln.saturating_sub(clamped_ctx).max(1);
        let e = (ln + clamped_ctx).min(total_lines);
        if let Some(last) = windows.last_mut()
            && s <= last.1 + 1
        {
            last.1 = last.1.max(e);
        } else {
            windows.push((s, e));
        }
    }
    windows
}

pub fn build_rg_baseline(
    hits: &[SearchHit],
    sources: &[String],
    files_with_matches: bool,
) -> String {
    if hits.is_empty() {
        return String::new();
    }
    if files_with_matches {
        let mut out: Vec<&str> = hits.iter().map(|h| h.rel_path.as_str()).collect();
        out.sort();
        return format!("{}\n", out.join("\n"));
    }
    let mut out = Vec::new();
    for (hit, src) in hits.iter().zip(sources.iter()) {
        let lines: Vec<&str> = src.lines().collect();
        for (wi, &(ws, we)) in hit.windows.iter().enumerate() {
            if wi > 0 {
                out.push("--".to_string());
            }
            for ln in ws..=we {
                if let Some(txt) = lines.get(ln.saturating_sub(1)) {
                    let sep = if hit.matched_lines.contains(&ln) { ':' } else { '-' };
                    out.push(format!("{}{sep}{ln}{sep}{txt}", hit.rel_path));
                }
            }
        }
    }
    if out.is_empty() {
        String::new()
    } else {
        format!("{}\n", out.join("\n"))
    }
}
