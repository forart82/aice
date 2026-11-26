use std::path::Path;

use crate::config::{remove_dir_if_empty, remove_file_if_exists, write_file_atomic};
pub use crate::rules_markdown::{
    AICE_VERSION_STR, ALWAYS_ON_AICE_RULE_FILE, MANDATORY_AGENT_RULES_MARKDOWN,
    MAX_AGENTS_MD_BYTES, extract_version_from_markdown, find_all_directive_spans_outside_fences,
    has_agents_md_include, strip_all_markdown_directives, strip_orphan_markers_outside_fences,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RulesSyncStatus {
    pub updated: bool,
    pub skipped_reason: Option<String>,
}

pub fn has_markdown_directive(path: &Path) -> bool {
    std::fs::read_to_string(path)
        .map(|s| !find_all_directive_spans_outside_fences(&s).is_empty())
        .unwrap_or(false)
}

pub fn extract_markdown_directive_version(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    extract_version_from_markdown(&text)
}

pub fn upsert_markdown_directive(
    md_path: &Path,
    block: Option<&str>,
    enforce_byte_cap: bool,
    force: bool,
) -> Result<RulesSyncStatus, String> {
    let directive = block.unwrap_or(MANDATORY_AGENT_RULES_MARKDOWN).trim();
    let existing = std::fs::read_to_string(md_path).unwrap_or_default();
    let (raw_stripped, _) = strip_all_markdown_directives(&existing);
    let stripped = strip_orphan_markers_outside_fences(&raw_stripped);
    let next_content = if stripped.is_empty() {
        format!("{directive}\n")
    } else if let Some(first_nl) = stripped.find('\n')
        && stripped[..first_nl].trim_start().starts_with("# ")
    {
        let heading = stripped[..first_nl].trim();
        let rest = stripped[first_nl + 1..].trim();
        if rest.is_empty() {
            format!("{heading}\n\n{directive}\n")
        } else {
            format!("{heading}\n\n{directive}\n\n{rest}\n")
        }
    } else if stripped.trim_start().starts_with("# ") && !stripped.contains('\n') {
        format!("{}\n\n{directive}\n", stripped.trim())
    } else {
        format!("{directive}\n\n{stripped}\n")
    };

    if enforce_byte_cap && next_content.len() > MAX_AGENTS_MD_BYTES && !force {
        return Ok(RulesSyncStatus {
            updated: false,
            skipped_reason: Some(format!(
                "AGENTS.md exceeds {MAX_AGENTS_MD_BYTES}B cap ({}B) without --force",
                next_content.len()
            )),
        });
    }
    write_file_atomic(md_path, &next_content)
        .map_err(|e| format!("Failed to write {}: {e}", md_path.display()))?;
    Ok(RulesSyncStatus { updated: true, skipped_reason: None })
}

pub fn remove_markdown_directive(md_path: &Path, remove_if_empty: bool) -> Result<bool, String> {
    if !md_path.is_file() {
        return Ok(false);
    }
    let existing = std::fs::read_to_string(md_path)
        .map_err(|e| format!("Failed to read {}: {e}", md_path.display()))?;
    let (stripped, had) = strip_all_markdown_directives(&existing);
    if !had {
        if remove_if_empty && existing.trim().is_empty() {
            let _ = remove_file_if_exists(md_path);
        }
        return Ok(false);
    }
    if stripped.is_empty() {
        if remove_if_empty {
            let _ = remove_file_if_exists(md_path);
        } else {
            write_file_atomic(md_path, "")
                .map_err(|e| format!("Failed to write {}: {e}", md_path.display()))?;
        }
    } else {
        write_file_atomic(md_path, &format!("{stripped}\n"))
            .map_err(|e| format!("Failed to write {}: {e}", md_path.display()))?;
    }
    Ok(true)
}

pub fn upsert_always_on_rule_file(path: &Path) -> Result<(), String> {
    write_file_atomic(path, ALWAYS_ON_AICE_RULE_FILE)
        .map_err(|e| format!("Failed to write {}: {e}", path.display()))
}

pub fn remove_always_on_rule_file(path: &Path, clean_empty_parents: bool) -> bool {
    let removed = remove_file_if_exists(path).unwrap_or(false);
    if removed && clean_empty_parents {
        let mut cur = path.parent();
        for _ in 0..2 {
            let Some(dir) = cur else { break };
            if !remove_dir_if_empty(dir) {
                break;
            }
            cur = dir.parent();
        }
    }
    removed
}

pub fn sync_agents_rules(project_root: &Path, force: bool) -> RulesSyncStatus {
    sync_project_workspace_rules(project_root, true, force)
}

pub fn sync_project_workspace_rules(
    project_root: &Path,
    enabled: bool,
    force: bool,
) -> RulesSyncStatus {
    for rel in [
        "GEMINI.md", ".GEMINI.md", "CODEX.md", ".CODEX.md",
        ".codex/AGENTS.md", ".codex/CODEX.md", ".codex/instructions.md",
    ] {
        let _ = remove_markdown_directive(&project_root.join(rel), true);
    }
    remove_dir_if_empty(&project_root.join(".codex"));
    for rel in [".agents/rules/aice.md", ".gemini/rules/aice.md", ".claude/rules/aice.md"] {
        remove_always_on_rule_file(&project_root.join(rel), true);
    }

    let agents_md = project_root.join("AGENTS.md");
    let claude_md = project_root.join("CLAUDE.md");
    let dot_claude_md = project_root.join(".claude/CLAUDE.md");

    if !enabled {
        let _ = remove_markdown_directive(&agents_md, true);
        let _ = remove_markdown_directive(&claude_md, true);
        let _ = remove_markdown_directive(&dot_claude_md, true);
        remove_dir_if_empty(&project_root.join(".claude"));
        return RulesSyncStatus { updated: true, skipped_reason: None };
    }

    let res = upsert_markdown_directive(&agents_md, None, true, force)
        .unwrap_or(RulesSyncStatus { updated: false, skipped_reason: Some("write error".into()) });
    for candidate in [&claude_md, &dot_claude_md] {
        if candidate.is_file() {
            if std::fs::read_to_string(candidate).is_ok_and(|c| has_agents_md_include(&c)) {
                let _ = remove_markdown_directive(candidate, true);
            } else {
                let _ = upsert_markdown_directive(candidate, None, false, force);
            }
        }
    }
    if claude_md.is_file() {
        let _ = remove_markdown_directive(&dot_claude_md, true);
        remove_dir_if_empty(&project_root.join(".claude"));
    }
    res
}
