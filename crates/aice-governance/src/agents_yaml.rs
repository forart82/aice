fn validate_yaml_mapping_root(raw: &str, path_label: &str) -> Result<(), String> {
    if raw.trim().is_empty() {
        return Ok(());
    }
    for line in raw.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') || t == "---" || t == "..." {
            continue;
        }
        if t.starts_with('-') || t.starts_with('[') || !t.contains(':') {
            return Err(format!(
                "Cannot merge AICE config into malformed YAML file {path_label}: root YAML value must be a mapping"
            ));
        }
        return Ok(());
    }
    Ok(())
}

fn unquote_yaml_scalar(s: &str) -> &str {
    let t = s.trim();
    if t.len() >= 2 && ((t.starts_with('"') && t.ends_with('"')) || (t.starts_with('\'') && t.ends_with('\''))) {
        &t[1..t.len() - 1]
    } else {
        t
    }
}

pub fn has_aider_yaml_str(existing: &str, conventions_path: &str) -> bool {
    let mut in_read = false;
    for line in existing.lines() {
        let indent = line.len() - line.trim_start().len();
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        if indent == 0 {
            in_read = false;
            if let Some(rest) = t.strip_prefix("read:") {
                let val = rest.trim();
                if val.starts_with('[') && val.ends_with(']') {
                    return val[1..val.len() - 1]
                        .split(',')
                        .any(|item| unquote_yaml_scalar(item) == conventions_path);
                }
                if !val.is_empty() {
                    return unquote_yaml_scalar(val) == conventions_path;
                }
                in_read = true;
            }
        } else if in_read
            && let Some(item) = t.strip_prefix('-')
            && unquote_yaml_scalar(item) == conventions_path
        {
            return true;
        }
    }
    false
}

pub fn upsert_aider_yaml_str(
    existing: Option<&str>,
    conventions_path: &str,
    path_label: &str,
) -> Result<String, String> {
    let raw = existing.unwrap_or("");
    validate_yaml_mapping_root(raw, path_label)?;
    if has_aider_yaml_str(raw, conventions_path) {
        return Ok(raw.to_string());
    }
    let entry_line = format!("  - {conventions_path}");
    let lines: Vec<&str> = raw.lines().collect();
    let mut out = Vec::new();
    let mut i = 0;
    let mut inserted = false;
    while i < lines.len() {
        let line = lines[i];
        let indent = line.len() - line.trim_start().len();
        if indent == 0 && line.trim().starts_with("read:") && !inserted {
            let rest = line.trim().strip_prefix("read:").unwrap().trim();
            if rest.is_empty() {
                out.push(line.to_string());
                i += 1;
                while i < lines.len() && (lines[i].trim().is_empty() || lines[i].starts_with(' ') || lines[i].starts_with('\t')) {
                    out.push(lines[i].to_string());
                    i += 1;
                }
                out.push(entry_line.clone());
                inserted = true;
                continue;
            }
            out.push("read:".to_string());
            if rest.starts_with('[') && rest.ends_with(']') {
                for item in rest[1..rest.len() - 1].split(',') {
                    let u = unquote_yaml_scalar(item);
                    if !u.is_empty() {
                        out.push(format!("  - {u}"));
                    }
                }
            } else {
                out.push(format!("  - {}", unquote_yaml_scalar(rest)));
            }
            out.push(entry_line.clone());
            inserted = true;
            i += 1;
            continue;
        }
        out.push(line.to_string());
        i += 1;
    }
    if !inserted {
        out.push("read:".to_string());
        out.push(entry_line);
    }
    Ok(format!("{}\n", out.join("\n").trim_end()))
}

pub fn remove_aider_yaml_str(existing: &str, conventions_path: &str) -> Option<Option<String>> {
    if !has_aider_yaml_str(existing, conventions_path) {
        return None;
    }
    let lines: Vec<&str> = existing.lines().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let indent = line.len() - line.trim_start().len();
        if indent == 0 && let Some(rest) = line.trim().strip_prefix("read:") {
            let rest = rest.trim();
            let mut items = Vec::new();
            if rest.is_empty() {
                i += 1;
                while i < lines.len() && (lines[i].trim().is_empty() || lines[i].starts_with(' ') || lines[i].starts_with('\t')) {
                    if let Some(item) = lines[i].trim().strip_prefix('-') {
                        let u = unquote_yaml_scalar(item);
                        if u != conventions_path && !u.is_empty() {
                            items.push(u.to_string());
                        }
                    }
                    i += 1;
                }
            } else {
                if rest.starts_with('[') && rest.ends_with(']') {
                    for item in rest[1..rest.len() - 1].split(',') {
                        let u = unquote_yaml_scalar(item);
                        if u != conventions_path && !u.is_empty() {
                            items.push(u.to_string());
                        }
                    }
                } else if unquote_yaml_scalar(rest) != conventions_path {
                    items.push(unquote_yaml_scalar(rest).to_string());
                }
                i += 1;
            }
            if !items.is_empty() {
                out.push("read:".to_string());
                for item in items {
                    out.push(format!("  - {item}"));
                }
            }
            continue;
        }
        out.push(line.to_string());
        i += 1;
    }
    let rendered = out.join("\n");
    let trimmed = rendered.trim();
    if trimmed.is_empty() { Some(None) } else { Some(Some(format!("{trimmed}\n"))) }
}

pub fn has_goose_yaml_str(existing: &str) -> bool {
    let mut in_ext = false;
    for line in existing.lines() {
        let indent = line.len() - line.trim_start().len();
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        if indent == 0 {
            in_ext = t.starts_with("extensions:");
        } else if in_ext && indent == 2 && t.starts_with("aice:") {
            return true;
        }
    }
    false
}

pub fn upsert_goose_yaml_str(existing: Option<&str>, path_label: &str) -> Result<String, String> {
    let raw = existing.unwrap_or("");
    validate_yaml_mapping_root(raw, path_label)?;
    let block = [
        "  aice:",
        "    name: aice",
        "    cmd: aice",
        "    args:",
        "      - mcp",
        "    enabled: true",
        "    type: stdio",
    ];
    let stripped = remove_goose_yaml_str(raw).unwrap_or_else(|| raw.to_string());
    let mut out = Vec::new();
    let mut inserted = false;
    for line in stripped.lines() {
        out.push(line.to_string());
        if line.trim() == "extensions:" && !line.starts_with(' ') && !inserted {
            out.extend(block.iter().map(|s| (*s).to_string()));
            inserted = true;
        }
    }
    if !inserted {
        out.push("extensions:".to_string());
        out.extend(block.iter().map(|s| (*s).to_string()));
    }
    Ok(format!("{}\n", out.join("\n").trim_end()))
}

pub fn remove_goose_yaml_str(existing: &str) -> Option<String> {
    if !has_goose_yaml_str(existing) {
        return None;
    }
    let mut out = Vec::new();
    let mut in_ext = false;
    let mut in_aice = false;
    for line in existing.lines() {
        let indent = line.len() - line.trim_start().len();
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            if !in_aice {
                out.push(line);
            }
            continue;
        }
        if indent == 0 {
            in_aice = false;
            in_ext = t.starts_with("extensions:");
            out.push(line);
        } else if in_ext && indent <= 2 && t.starts_with("aice:") {
            in_aice = true;
        } else if in_aice && indent > 2 {
            continue;
        } else {
            in_aice = false;
            out.push(line);
        }
    }
    Some(format!("{}\n", out.join("\n").trim_end()))
}
