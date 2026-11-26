#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HunkBlock {
    pub search: String,
    pub replace: String,
}

pub fn has_hunk_markers(payload: &str) -> bool {
    let mut saw_open = false;
    for raw in payload.split('\n') {
        let t = raw.strip_suffix('\r').unwrap_or(raw).trim();
        if t.len() >= 3 && t.bytes().all(|b| b == b'<') {
            saw_open = true;
        } else if saw_open && t.len() >= 3 && t.bytes().all(|b| b == b'=') {
            return true;
        }
    }
    false
}

pub fn strip_gutter_prefix(line: &str) -> &str {
    if let Some(pos) = line.find('│') {
        let prefix = line[..pos].trim();
        if !prefix.is_empty() && prefix.bytes().all(|b| b.is_ascii_digit()) {
            let rest = &line[pos + '│'.len_utf8()..];
            return rest.strip_prefix(' ').unwrap_or(rest);
        }
    }
    line
}

fn is_clamped_banner(line: &str) -> bool {
    let t = line.trim();
    t.starts_with("[Clamped L") && t.ends_with(']')
}

fn parse_line_colon_prefix(line: &str) -> Option<(&str, bool)> {
    let trimmed = line.trim_start();
    let after_l = trimmed.strip_prefix('L').unwrap_or(trimmed);
    let digit_len = after_l.bytes().take_while(|b| b.is_ascii_digit()).count();
    if digit_len == 0 {
        return None;
    }
    let after_num = &after_l[digit_len..];
    let after_colon = after_num.strip_prefix(':')?;
    if !after_colon.is_empty() && !after_colon.starts_with(' ') && !after_colon.starts_with('\t') {
        return None;
    }
    let body = after_colon.strip_prefix(' ').unwrap_or(after_colon);
    let val_trim = body.trim_start();
    let vt = val_trim.trim_end();
    let core = vt.trim_end_matches([',', '}', ']']).trim_end();
    let num = core.strip_prefix('-').unwrap_or(core);
    let looks_num_val = !core.is_empty()
        && num.bytes().any(|b| b.is_ascii_digit())
        && num.bytes().all(|b| b.is_ascii_digit() || b == b'.' || b == b'_');
    let looks_json = !trimmed.starts_with('L')
        && (val_trim.starts_with('"')
            || val_trim.starts_with('\'')
            || val_trim.starts_with('[')
            || val_trim.starts_with('{')
            || val_trim.starts_with("true")
            || val_trim.starts_with("false")
            || val_trim.starts_with("null")
            || looks_num_val
            || (vt.bytes().next().is_some_and(|b| b.is_ascii_digit())
                && vt.ends_with([',', '}'])));
    Some((body, looks_json))
}

pub fn strip_numbered_gutter_prefixes(text: &str) -> String {
    let raw_lines: Vec<&str> = text
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .filter(|l| !is_clamped_banner(l))
        .collect();
    let has_pipe_gutter = raw_lines.iter().any(|l| {
        !l.trim().is_empty() && strip_gutter_prefix(l) != *l
    });
    if has_pipe_gutter {
        return raw_lines
            .into_iter()
            .map(strip_gutter_prefix)
            .collect::<Vec<_>>()
            .join("\n");
    }
    let non_empty: Vec<&str> = raw_lines.iter().copied().filter(|l| !l.trim().is_empty()).collect();
    let all_colon_gutter = !non_empty.is_empty()
        && non_empty
            .iter()
            .all(|l| matches!(parse_line_colon_prefix(l), Some((_, false))));
    if all_colon_gutter {
        return raw_lines
            .into_iter()
            .map(|l| {
                if l.trim().is_empty() {
                    ""
                } else {
                    parse_line_colon_prefix(l).map(|(b, _)| b).unwrap_or(l)
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
    }
    raw_lines.join("\n")
}

fn is_marker(trimmed: &str, ch: u8) -> bool {
    trimmed.len() >= 3 && trimmed.bytes().all(|b| b == ch)
}

fn is_ignorable_outside_line(trimmed: &str) -> bool {
    trimmed.is_empty() || trimmed.starts_with("//") || trimmed.starts_with('#')
}

pub fn extract_hunk_blocks(payload: &str) -> Result<Vec<HunkBlock>, String> {
    let norm = payload.replace("\r\n", "\n");
    let lines: Vec<&str> = norm.split('\n').collect();
    let mut blocks = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        let trimmed = lines[i].trim();
        if is_ignorable_outside_line(trimmed) {
            i += 1;
            continue;
        }
        if is_marker(trimmed, b'<') {
            i += 1;
            let mut search_lines = Vec::new();
            let mut found_sep = false;
            while i < lines.len() {
                let t = lines[i].trim();
                if is_marker(t, b'=') {
                    found_sep = true;
                    i += 1;
                    break;
                }
                search_lines.push(lines[i]);
                i += 1;
            }
            if !found_sep {
                return Err("Malformed hunk: missing '===' separator inside <<< ... >>>".into());
            }
            let mut repl_lines = Vec::new();
            let mut found_end = false;
            while i < lines.len() {
                let t = lines[i].trim();
                if is_marker(t, b'>') {
                    found_end = true;
                    i += 1;
                    break;
                }
                repl_lines.push(lines[i]);
                i += 1;
            }
            if !found_end {
                return Err("Malformed hunk: missing closing '>>>' marker".into());
            }
            let search = strip_numbered_gutter_prefixes(&search_lines.join("\n"));
            if search.trim().is_empty() {
                return Err("Malformed hunk: empty search block inside <<< ... ===".into());
            }
            let replace = strip_numbered_gutter_prefixes(&repl_lines.join("\n"));
            blocks.push(HunkBlock { search, replace });
        } else if is_marker(trimmed, b'=') || is_marker(trimmed, b'>') {
            return Err(format!("Unexpected hunk marker '{trimmed}' outside <<< ... >>> block"));
        } else {
            return Err(format!(
                "Unexpected non-hunk line outside <<< ... >>> block: '{}'",
                trimmed.chars().take(60).collect::<String>()
            ));
        }
    }
    if blocks.is_empty() {
        return Err("No <<< ... === ... >>> hunk blocks found".into());
    }
    Ok(blocks)
}
