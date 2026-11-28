pub const MAX_AGENTS_MD_BYTES: usize = 22_000;
pub const AICE_VERSION_STR: &str = env!("CARGO_PKG_VERSION");

pub const MANDATORY_AGENT_RULES_MARKDOWN: &str = concat!(
    "<!-- AICE:START v",
    env!("CARGO_PKG_VERSION"),
    " -->\n",
    "## AICE (v",
    env!("CARGO_PKG_VERSION"),
    ")\n",
    "- Gate: ONLY if `aice.config.json` has `\"enabled\": true`; blocker: `aice disable` / `aice enable`.\n",
    "### Batch Read & Splice\n",
    "- ONLY aice read/search/find (aice_read) & aice splice/aice write (aice_splice); no shell writes or `sed`/`grep`/`cat`/`find`.\n",
    "- Read: `aice read f1:sym f2:L1-L50`, quote 'f:/a|b/', `aice search <pat> [dir]`, `aice find -d 2`.\n",
    "- No paging: NEVER walk `:L1-L150` -> `:L151-L300` across turns; batch 2-4 targets (`<8KB`) per call (`f:sym1 f:sym2` or `aice search <pat> f`); for 5+ targets run parallel `aice_read`/`aice read` calls in 1 turn so output stays inline (no `output.txt` paging).\n",
    "- Splice: `aice splice --stdin << 'EOF'` (=== f:sym ===, === f:L1-L20 ===, --delete, === f ===), multi-line `<<< === >>>` (no 1L).\n",
    "- Briefs: \"Use AICE (aice read / aice splice) for all file exploration and edits.\"\n",
    "<!-- AICE:END -->"
);

pub const ALWAYS_ON_AICE_RULE_FILE: &str = concat!(
    "---\n",
    "trigger: always_on\n",
    "description: AICE Mandatory AST Creation, Exploration & Surgical Splicing Rules (v",
    env!("CARGO_PKG_VERSION"),
    ")\n",
    "---\n\n",
    "<!-- AICE:START v",
    env!("CARGO_PKG_VERSION"),
    " -->\n",
    "## AICE (v",
    env!("CARGO_PKG_VERSION"),
    ")\n",
    "- Gate: ONLY if `aice.config.json` has `\"enabled\": true`; blocker: `aice disable` / `aice enable`.\n",
    "### Batch Read & Splice\n",
    "- ONLY aice read/search/find (aice_read) & aice splice/aice write (aice_splice); no shell writes or `sed`/`grep`/`cat`/`find`.\n",
    "- Read: `aice read f1:sym f2:L1-L50`, quote 'f:/a|b/', `aice search <pat> [dir]`, `aice find -d 2`.\n",
    "- No paging: NEVER walk `:L1-L150` -> `:L151-L300` across turns; batch 2-4 targets (`<8KB`) per call (`f:sym1 f:sym2` or `aice search <pat> f`); for 5+ targets run parallel `aice_read`/`aice read` calls in 1 turn so output stays inline (no `output.txt` paging).\n",
    "- Splice: `aice splice --stdin << 'EOF'` (=== f:sym ===, === f:L1-L20 ===, --delete, === f ===), multi-line `<<< === >>>` (no 1L).\n",
    "- Briefs: \"Use AICE (aice read / aice splice) for all file exploration and edits.\"\n",
    "<!-- AICE:END -->\n"
);

fn parse_fence_open(line: &str) -> Option<(char, usize, &str)> {
    let trimmed = line.trim_start_matches([' ', '\t']);
    if line.len() - trimmed.len() > 3 {
        return None;
    }
    let ch = trimmed.chars().next()?;
    if ch != '`' && ch != '~' {
        return None;
    }
    let count = trimmed.chars().take_while(|&c| c == ch).count();
    if count >= 3 { Some((ch, count, &trimmed[count..])) } else { None }
}

fn is_aice_start_line(line: &str) -> bool {
    let t = line.trim();
    if t.starts_with("<!--") && t.ends_with("-->") {
        let inner = t[4..t.len() - 3].trim();
        return inner == "AICE:START" || inner.starts_with("AICE:START v");
    }
    let lower = t.to_ascii_lowercase();
    lower.starts_with("## aice") && (lower.contains("- mandatory") || lower.contains("cheat-card"))
}

fn is_aice_end_line(line: &str) -> bool {
    let t = line.trim();
    t.starts_with("<!--") && t.ends_with("-->") && t[4..t.len() - 3].trim() == "AICE:END"
}

fn is_non_aice_top_heading(line: &str) -> bool {
    let t = line.trim_start_matches([' ', '\t']);
    let is_h12 = t.starts_with("# ") || t.starts_with("#\t") || t.starts_with("## ") || t.starts_with("##\t");
    is_h12 && !t.to_ascii_lowercase().starts_with("## aice")
}

pub fn find_all_directive_spans_outside_fences(markdown: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut fence: Option<(char, usize)> = None;
    let mut active_start: Option<usize> = None;
    let mut pos = 0usize;
    let total = markdown.len();

    while pos <= total {
        let nl = markdown[pos..].find('\n').map(|o| pos + o);
        let line_end = nl.unwrap_or(total);
        let clean = markdown[pos..line_end].strip_suffix('\r').unwrap_or(&markdown[pos..line_end]);

        if let Some((ch, count, rest)) = parse_fence_open(clean) {
            match fence {
                None if ch == '~' || !rest.contains('`') => fence = Some((ch, count)),
                Some((fch, flen)) if ch == fch && count >= flen && rest.trim().is_empty() => fence = None,
                _ => {}
            }
        } else if fence.is_none() {
            if active_start.is_none() {
                if is_aice_start_line(clean) {
                    active_start = Some(pos);
                }
            } else if is_aice_end_line(clean) {
                spans.push((active_start.unwrap(), pos + clean.len()));
                active_start = None;
            } else if is_non_aice_top_heading(clean) {
                spans.push((active_start.unwrap(), pos));
                active_start = None;
            }
        }
        let Some(nl_pos) = nl else { break };
        pos = nl_pos + 1;
    }
    if let Some(start) = active_start {
        spans.push((start, total));
    }
    spans
}

pub fn strip_all_markdown_directives(markdown: &str) -> (String, bool) {
    let spans = find_all_directive_spans_outside_fences(markdown);
    if spans.is_empty() {
        return (markdown.trim().to_string(), false);
    }
    let mut segments = Vec::new();
    let mut last = 0usize;
    for (s, e) in spans {
        let seg = markdown[last..s].trim();
        if !seg.is_empty() {
            segments.push(seg);
        }
        last = e;
    }
    let tail = markdown[last..].trim();
    if !tail.is_empty() {
        segments.push(tail);
    }
    (segments.join("\n\n"), true)
}

pub fn strip_orphan_markers_outside_fences(markdown: &str) -> String {
    if !markdown.contains("AICE:START") && !markdown.contains("AICE:END") {
        return markdown.to_string();
    }
    let mut fence: Option<(char, usize)> = None;
    let mut kept = Vec::new();
    for line in markdown.lines() {
        if let Some((ch, count, rest)) = parse_fence_open(line) {
            match fence {
                None if ch == '~' || !rest.contains('`') => fence = Some((ch, count)),
                Some((fch, flen)) if ch == fch && count >= flen && rest.trim().is_empty() => fence = None,
                _ => {}
            }
            kept.push(line);
            continue;
        }
        if fence.is_none() && (is_aice_start_line(line) || is_aice_end_line(line)) {
            continue;
        }
        kept.push(line);
    }
    kept.join("\n").trim().to_string()
}

pub fn has_agents_md_include(markdown: &str) -> bool {
    let mut fence: Option<(char, usize)> = None;
    for line in markdown.lines() {
        if let Some((ch, count, rest)) = parse_fence_open(line) {
            match fence {
                None if ch == '~' || !rest.contains('`') => { fence = Some((ch, count)); continue; }
                Some((fch, flen)) if ch == fch && count >= flen && rest.trim().is_empty() => { fence = None; continue; }
                _ => {}
            }
        }
        if fence.is_some() {
            continue;
        }
        for pat in ["@AGENTS.md", "@./AGENTS.md"] {
            if let Some(idx) = line.find(pat) {
                let prev_ok = idx == 0 || matches!(line.as_bytes()[idx - 1], b' ' | b'\t' | b'(');
                let after = idx + pat.len();
                let next_ok = after == line.len()
                    || matches!(line.as_bytes()[after], b' ' | b'\t' | b')' | b'.' | b',' | b';' | b':');
                if prev_ok && next_ok {
                    return true;
                }
            }
        }
    }
    false
}

pub fn extract_version_from_markdown(text: &str) -> Option<String> {
    let (s, e) = *find_all_directive_spans_outside_fences(text).first()?;
    let slice = &text[s..e];
    if let Some(idx) = slice.find("AICE:START v") {
        let rest = &slice[idx + "AICE:START v".len()..];
        let ver: String = rest
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
            .collect();
        if !ver.is_empty() {
            return Some(ver);
        }
    }
    if slice.contains("AICE:START") {
        return Some("legacy".to_string());
    }
    None
}
