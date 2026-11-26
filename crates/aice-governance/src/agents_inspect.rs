use std::path::{Path, PathBuf};

use crate::agents_formats::{
    has_aider_yaml_str, has_codex_toml_str, has_goose_yaml_str, has_json_mcp_str,
};
use crate::agents_render::{
    AgentActionResult, AgentSetupOptions, AgentStatusEntry, SupportedAgentId,
};
use crate::rules_sync::{
    AICE_VERSION_STR, extract_markdown_directive_version, has_markdown_directive,
};

pub(crate) fn resolve_agent_home(override_home: Option<&Path>) -> PathBuf {
    if let Some(h) = override_home {
        return h.to_path_buf();
    }
    if let Ok(h) = std::env::var("AICE_AGENT_HOME")
        && !h.trim().is_empty()
    {
        return PathBuf::from(h);
    }
    if let Ok(h) = std::env::var("HOME")
        && !h.trim().is_empty()
    {
        return PathBuf::from(h);
    }
    PathBuf::from(".")
}

pub(crate) fn read_if_file(p: &Path) -> Option<String> {
    p.is_file().then(|| std::fs::read_to_string(p).ok()).flatten()
}

pub fn detect_binary_in_path(names: &[&str]) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for name in names {
            let cand = dir.join(name);
            if cand.is_file() && is_executable(&cand) {
                return Some(cand);
            }
        }
    }
    None
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|m| (m.permissions().mode() & 0o111) != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

pub fn get_agents_status(opts: &AgentSetupOptions) -> AgentActionResult {
    let home = resolve_agent_home(opts.home_dir.as_deref());
    let filter = opts.agent.as_deref().and_then(SupportedAgentId::parse);
    let mut entries = Vec::new();
    for id in SupportedAgentId::all() {
        if filter.is_some_and(|f| f != id) {
            continue;
        }
        entries.push(inspect_single_agent(&home, id));
    }
    let any_outdated = entries
        .iter()
        .any(|e| e.prompt_path.is_some() && e.prompt_configured && e.rules_up_to_date == Some(false));
    let all_up_to_date = !any_outdated;
    AgentActionResult {
        home_dir: home,
        version: AICE_VERSION_STR.to_string(),
        all_rules_up_to_date: all_up_to_date,
        update_recommendation: if all_up_to_date {
            None
        } else {
            Some(format!("Run 'aice agents setup' to refresh agent rules to v{AICE_VERSION_STR}"))
        },
        agents: entries,
    }
}

fn inspect_single_agent(home: &Path, id: SupportedAgentId) -> AgentStatusEntry {
    let (bins, mcp_path, prompt_path, mcp_ok, prompt_ok) = match id {
        SupportedAgentId::Claude => {
            let mcp = home.join(".claude.json");
            let prompt = home.join(".claude/CLAUDE.md");
            let ok = read_if_file(&mcp).is_some_and(|s| has_json_mcp_str(&s));
            let pok = has_markdown_directive(&prompt);
            (&["claude"][..], mcp, Some(prompt), ok, pok)
        }
        SupportedAgentId::Agy => {
            let s1 = home.join(".gemini/settings.json");
            let s2 = home.join(".gemini/config/mcp_config.json");
            let r = home.join(".gemini/config/rules/aice.md");
            let prompt = home.join(".gemini/GEMINI.md");
            let ok = read_if_file(&s1).is_some_and(|s| has_json_mcp_str(&s))
                && read_if_file(&s2).is_some_and(|s| has_json_mcp_str(&s));
            let pok = has_markdown_directive(&prompt) && has_markdown_directive(&r);
            (&["agy", "gemini"][..], s2, Some(prompt), ok, pok)
        }
        SupportedAgentId::Codex => {
            let mcp = home.join(".codex/config.toml");
            let prompt = home.join(".codex/AGENTS.md");
            let ok = read_if_file(&mcp).is_some_and(|s| has_codex_toml_str(&s));
            let pok = has_markdown_directive(&prompt);
            (&["codex"][..], mcp, Some(prompt), ok, pok)
        }
        SupportedAgentId::Opencode => {
            let mcp = home.join(".config/opencode/opencode.json");
            let prompt = home.join(".config/opencode/AGENTS.md");
            let ok = read_if_file(&mcp).is_some_and(|s| has_json_mcp_str(&s));
            let pok = has_markdown_directive(&prompt);
            (&["opencode"][..], mcp, Some(prompt), ok, pok)
        }
        SupportedAgentId::Aider => {
            let mcp = home.join(".aider.conf.yml");
            let prompt = home.join(".aider/CONVENTIONS.md");
            let conv = prompt.display().to_string();
            let ok = read_if_file(&mcp).is_some_and(|s| has_aider_yaml_str(&s, &conv));
            let pok = has_markdown_directive(&prompt);
            (&["aider"][..], mcp, Some(prompt), ok, pok)
        }
        SupportedAgentId::Goose => {
            let mcp = home.join(".config/goose/config.yaml");
            let ok = read_if_file(&mcp).is_some_and(|s| has_goose_yaml_str(&s));
            (&["goose"][..], mcp, None, ok, false)
        }
        SupportedAgentId::Cursor => {
            let mcp = home.join(".cursor/mcp.json");
            let ok = read_if_file(&mcp).is_some_and(|s| has_json_mcp_str(&s));
            (&["cursor"][..], mcp, None, ok, false)
        }
    };
    let bin_path = detect_binary_in_path(bins);
    let (rules_version, rules_up_to_date) = if prompt_ok {
        let ver = prompt_path.as_deref().and_then(extract_markdown_directive_version);
        let upto = ver.as_deref() == Some(AICE_VERSION_STR);
        (ver, Some(upto))
    } else {
        (None, None)
    };
    AgentStatusEntry {
        id,
        display_name: id.display_name().to_string(),
        binary_detected: bin_path.is_some(),
        binary_path: bin_path,
        mcp_configured: mcp_ok,
        mcp_config_path: mcp_path,
        prompt_configured: prompt_ok,
        prompt_path,
        rules_version,
        rules_up_to_date,
        error: None,
    }
}
