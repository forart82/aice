use std::collections::HashSet;
use std::path::Path;

use aice_ast_engine::DefaultSyntaxFirewall;
use aice_lang_registry::{FirewallVerdict, LanguageId, SyntaxFirewall};

use crate::hunk::HunkBlock;
use crate::types::{join_lines_keep, split_lines_keep};

#[derive(Clone, Copy)]
pub struct EnclosingContext<'a> {
    pub full_before: &'a str,
    pub full_after: &'a str,
    pub orig_disk: Option<&'a str>,
}

impl<'a> EnclosingContext<'a> {
    pub fn full_file(orig_disk: Option<&'a str>) -> Self {
        Self { full_before: "", full_after: "", orig_disk }
    }
}

struct HunkEnv<'a> {
    path: &'a Path,
    lang: LanguageId,
    eol: &'a str,
    offset: usize,
    ctx: &'a EnclosingContext<'a>,
    has_bom: bool,
}

pub fn slice_enclosing(
    lines: &[String],
    start: usize,
    end: usize,
    trailing_nl: bool,
    eol: &str,
) -> (String, String, String) {
    let scope = lines[start - 1..end].join(eol);
    let full_before = if start > 1 {
        format!("{}{eol}", lines[..start - 1].join(eol))
    } else {
        String::new()
    };
    let mut full_after = if end < lines.len() {
        format!("{eol}{}", lines[end..].join(eol))
    } else {
        String::new()
    };
    if trailing_nl {
        full_after.push_str(eol);
    }
    (scope, full_before, full_after)
}

fn trim_blank_edges(lines: &[String]) -> Vec<String> {
    let mut s = 0;
    while s < lines.len() && lines[s].trim().is_empty() { s += 1; }
    let mut e = lines.len();
    while e > s && lines[e - 1].trim().is_empty() { e -= 1; }
    lines[s..e].to_vec()
}

fn leading_ws(line: &str) -> &str {
    let idx = line.bytes().take_while(|b| *b == b' ' || *b == b'\t').count();
    &line[..idx]
}

fn min_indent<'a>(lines: impl IntoIterator<Item = &'a str>) -> &'a str {
    let mut best: Option<&'a str> = None;
    for l in lines {
        if !l.trim().is_empty() {
            let ws = leading_ws(l);
            if best.is_none_or(|b| ws.len() < b.len()) { best = Some(ws); }
        }
    }
    best.unwrap_or("")
}

fn adapt_repl_indent(repl: &[String], scope_slice: &[String], search_lines: &[String], exact: bool) -> Vec<String> {
    let scope_base = min_indent(scope_slice.iter().map(String::as_str));
    let search_base = min_indent(search_lines.iter().map(String::as_str));
    if exact || scope_base == search_base {
        return repl.to_vec();
    }
    let strip_len = min_indent(repl.iter().map(String::as_str)).len();
    repl.iter().map(|l| {
        if l.trim().is_empty() { String::new() }
        else {
            let tail = l.get(strip_len.min(leading_ws(l).len())..).unwrap_or(l.trim_start());
            format!("{scope_base}{tail}")
        }
    }).collect()
}

fn collapse_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn replace_span(lines: &[String], start: usize, end: usize, repl: Vec<String>) -> Vec<String> {
    let mut out = Vec::with_capacity(lines.len() - (end - start) + repl.len());
    out.extend_from_slice(&lines[..start]);
    out.extend(repl);
    out.extend_from_slice(&lines[end..]);
    out
}

fn format_ambiguous(matches: &[(usize, usize)], lines: &[String], offset: usize) -> String {
    let mut out = format!("Ambiguous hunk matched {} locations:\n", matches.len());
    for (idx, (s, e)) in matches.iter().take(4).enumerate() {
        let preview = lines[*s..(*e).min(*s + 3)].join("\n");
        out.push_str(&format!("Match #{} [L{}-L{}]:\n{}\n", idx + 1, s + offset, e + offset - 1, preview));
    }
    out
}

fn format_no_match(search: &[String], lines: &[String], offset: usize) -> String {
    let mut msg = String::from("Hunk search block did not match target scope.\n");
    if lines.is_empty() { return msg; }
    let search_trimmed: Vec<&str> = search.iter().map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    let search_toks: HashSet<String> = search_trimmed.iter().flat_map(|l| {
        l.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').filter(|w| w.len() >= 2).map(str::to_string)
    }).collect();
    let mut best: Option<(i32, usize)> = None;
    for (i, line) in lines.iter().enumerate() {
        let lt = line.trim();
        let mut sc = if search_trimmed.contains(&lt) { 25 } else { 0 };
        if sc == 0 && !lt.is_empty() && search_trimmed.iter().any(|st| lt.contains(st) || st.contains(lt)) { sc += 8; }
        for tok in lt.split(|c: char| !c.is_ascii_alphanumeric() && c != '_') {
            if search_toks.contains(tok) { sc += 3; }
        }
        if best.is_none_or(|(b, _)| sc > b) { best = Some((sc, i)); }
    }
    let center = best.map(|(_, i)| i).unwrap_or(0);
    let win_s = center.saturating_sub(5);
    let win_e = (win_s + 16).min(lines.len());
    msg.push_str(&format!(
        "Closest disk context [L{}-L{}] (retry splice directly without re-reading):\n",
        win_s + offset, win_e + offset - 1
    ));
    for (idx, line) in lines.iter().enumerate().take(win_e).skip(win_s) {
        msg.push_str(&format!("{}│ {line}\n", idx + offset));
    }
    msg
}

fn apply_single_hunk(
    scope_lines: Vec<String>,
    trailing_nl: bool,
    hunk: &HunkBlock,
    env: &HunkEnv<'_>,
) -> Result<Vec<String>, String> {
    let (path, lang, eol, offset) = (env.path, env.lang, env.eol, env.offset);
    let clean_search = hunk.search.strip_prefix('\u{FEFF}').unwrap_or(&hunk.search);
    let (raw_search, _) = split_lines_keep(clean_search);
    let search = trim_blank_edges(&raw_search);
    if search.is_empty() {
        return Err("Empty hunk search block".into());
    }
    let (repl, _) = split_lines_keep(&hunk.replace);
    let m = search.len();
    if scope_lines.len() >= m {
        let mut hits = Vec::new();
        for i in 0..=scope_lines.len() - m {
            if scope_lines[i..i + m] == search[..] { hits.push((i, i + m)); }
        }
        if hits.len() > 1 { return Err(format_ambiguous(&hits, &scope_lines, offset)); }
        if let Some(&(s, e)) = hits.first() {
            let adapted = adapt_repl_indent(&repl, &scope_lines[s..e], &search, true);
            return Ok(replace_span(&scope_lines, s, e, adapted));
        }
    }
    if m == 1 {
        let needle = search[0].trim();
        let mut inline_hits = Vec::new();
        for (i, line) in scope_lines.iter().enumerate() {
            let mut start = leading_ws(line).len();
            while let Some(pos) = line[start..].find(needle) {
                let abs = start + pos;
                inline_hits.push((i, abs));
                start = abs + needle.len().max(1);
            }
        }
        if inline_hits.len() > 1 {
            let spans: Vec<(usize, usize)> = inline_hits.iter().map(|&(i, _)| (i, i + 1)).collect();
            return Err(format_ambiguous(&spans, &scope_lines, offset));
        }
        if let Some(&(i, pos)) = inline_hits.first() {
            let line = &scope_lines[i];
            let indent = leading_ws(line);
            let is_whole_line = pos == indent.len() && pos + needle.len() == line.trim_end().len();
            if !is_whole_line {
                let mut joined = repl.join(eol);
                if repl.len() > 1 {
                    joined = repl.iter().enumerate().map(|(k, l)| {
                        if k == 0 || l.trim().is_empty() { l.clone() } else { format!("{indent}{l}") }
                    }).collect::<Vec<_>>().join(eol);
                }
                let new_line = format!("{}{}{}", &line[..pos], joined, &line[pos + needle.len()..]);
                let (new_lines, _) = split_lines_keep(&new_line);
                return Ok(replace_span(&scope_lines, i, i + 1, new_lines));
            }
        }
    }
    if scope_lines.len() >= m {
        let s_base = min_indent(search.iter().map(String::as_str)).len();
        let s_norm: Vec<&str> = search.iter().map(|l| l.get(s_base.min(leading_ws(l).len())..).unwrap_or(l).trim_end()).collect();
        let mut hits = Vec::new();
        for i in 0..=scope_lines.len() - m {
            let c_base = min_indent(scope_lines[i..i + m].iter().map(String::as_str)).len();
            let ok = (0..m).all(|k| {
                let c = &scope_lines[i + k];
                (search[k].trim().is_empty() == c.trim().is_empty())
                    && c.get(c_base.min(leading_ws(c).len())..).unwrap_or(c).trim_end() == s_norm[k]
            });
            if ok { hits.push((i, i + m)); }
        }
        if hits.len() > 1 { return Err(format_ambiguous(&hits, &scope_lines, offset)); }
        if let Some(&(s, e)) = hits.first() {
            let adapted = adapt_repl_indent(&repl, &scope_lines[s..e], &search, false);
            return Ok(replace_span(&scope_lines, s, e, adapted));
        }
        let mut t4 = Vec::new();
        for i in 0..=scope_lines.len() - m {
            if (0..m).all(|k| scope_lines[i + k].trim() == search[k].trim()) { t4.push((i, i + m)); }
        }
        if t4.len() > 1 { return Err(format_ambiguous(&t4, &scope_lines, offset)); }
        if let Some(&(s, e)) = t4.first() {
            let adapted = adapt_repl_indent(&repl, &scope_lines[s..e], &search, false);
            return Ok(replace_span(&scope_lines, s, e, adapted));
        }
    }
    let s_nb: Vec<&str> = search.iter().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
    if s_nb.len() > 1 {
        let mut t5 = Vec::new();
        for i in 0..scope_lines.len() {
            if scope_lines[i].trim() != s_nb[0] { continue; }
            let (mut k, mut j) = (0, i);
            while j < scope_lines.len() && k < s_nb.len() {
                if scope_lines[j].trim().is_empty() { j += 1; continue; }
                if scope_lines[j].trim() != s_nb[k] { break; }
                k += 1; j += 1;
            }
            if k == s_nb.len() { t5.push((i, j)); }
        }
        if t5.len() > 1 { return Err(format_ambiguous(&t5, &scope_lines, offset)); }
        if let Some(&(s, e)) = t5.first() {
            let adapted = adapt_repl_indent(&repl, &scope_lines[s..e], &search, false);
            return Ok(replace_span(&scope_lines, s, e, adapted));
        }
    }
    if scope_lines.len() >= m {
        let s_col: Vec<String> = search.iter().map(|l| collapse_ws(l)).collect();
        let mut t6 = Vec::new();
        for i in 0..=scope_lines.len() - m {
            if (0..m).all(|k| collapse_ws(&scope_lines[i + k]) == s_col[k]) { t6.push((i, i + m)); }
        }
        if t6.len() > 1 { return Err(format_ambiguous(&t6, &scope_lines, offset)); }
        if let Some(&(s, e)) = t6.first() {
            let adapted = adapt_repl_indent(&repl, &scope_lines[s..e], &search, false);
            let next_lines = replace_span(&scope_lines, s, e, adapted);
            let candidate = join_lines_keep(&next_lines, trailing_nl, eol);
            let bom = if env.has_bom && env.ctx.full_before.is_empty() { "\u{FEFF}" } else { "" };
            let full_candidate = format!("{bom}{}{}{}", env.ctx.full_before, candidate, env.ctx.full_after);
            if matches!(
                DefaultSyntaxFirewall.verify_incremental(env.ctx.orig_disk, &full_candidate, path, lang),
                FirewallVerdict::Valid
            ) {
                return Ok(next_lines);
            }
        }
    }
    Err(format_no_match(&search, &scope_lines, offset))
}

pub fn apply_hunk_blocks(
    scope_src: &str,
    hunks: &[HunkBlock],
    path: &Path,
    lang: LanguageId,
    eol: &str,
    scope_line_offset: usize,
    ctx: &EnclosingContext<'_>,
) -> Result<String, String> {
    let has_bom = scope_src.starts_with('\u{FEFF}');
    let clean_scope = scope_src.strip_prefix('\u{FEFF}').unwrap_or(scope_src);
    let env = HunkEnv { path, lang, eol, offset: scope_line_offset, ctx, has_bom };
    let (mut lines, trailing_nl) = split_lines_keep(clean_scope);
    for h in hunks {
        lines = apply_single_hunk(lines, trailing_nl, h, &env)?;
    }
    let mut out = join_lines_keep(&lines, trailing_nl, eol);
    if has_bom && !out.is_empty() && !out.starts_with('\u{FEFF}') {
        out.insert(0, '\u{FEFF}');
    }
    Ok(out)
}
