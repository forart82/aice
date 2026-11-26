use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::agents_formats::{
    remove_aider_yaml_str, remove_codex_toml_str, remove_goose_yaml_str, remove_json_mcp_str,
    upsert_aider_yaml_str, upsert_codex_toml_str, upsert_goose_yaml_str, upsert_json_mcp_str,
};
pub use crate::agents_inspect::{detect_binary_in_path, get_agents_status};
use crate::agents_inspect::{read_if_file, resolve_agent_home};
pub use crate::agents_render::{
    AgentActionResult, AgentSetupOptions, AgentStatusEntry, SupportedAgentId,
    format_agents_status_table,
};
use crate::config::{remove_file_if_exists, write_file_atomic};
use crate::rules_sync::{
    remove_always_on_rule_file, remove_markdown_directive, upsert_always_on_rule_file,
    upsert_markdown_directive,
};

pub fn setup_agents(opts: &AgentSetupOptions) -> AgentActionResult {
    let home = resolve_agent_home(opts.home_dir.as_deref());
    let filter = opts.agent.as_deref().and_then(SupportedAgentId::parse);
    let mut errors: BTreeMap<SupportedAgentId, String> = BTreeMap::new();
    let should = |id: SupportedAgentId, checks: &[PathBuf], bins: &[&str]| -> bool {
        if let Some(f) = filter {
            return f == id;
        }
        if opts.all || !matches!(id, SupportedAgentId::Goose | SupportedAgentId::Cursor) {
            return true;
        }
        checks.iter().any(|p| p.exists()) || detect_binary_in_path(bins).is_some()
    };

    if should(SupportedAgentId::Claude, &[home.join(".claude"), home.join(".claude.json")], &["claude"]) {
        record_err(&mut errors, SupportedAgentId::Claude, write_json_mcp(&home.join(".claude.json"), false));
        let settings = home.join(".claude/settings.json");
        if settings.is_file() {
            record_err(&mut errors, SupportedAgentId::Claude, write_json_mcp(&settings, false));
        }
        sync_prompt(&mut errors, SupportedAgentId::Claude, &home.join(".claude/CLAUDE.md"), opts.global_rules);
    }
    if should(SupportedAgentId::Agy, &[home.join(".gemini")], &["agy", "gemini"]) {
        record_err(&mut errors, SupportedAgentId::Agy, write_json_mcp(&home.join(".gemini/settings.json"), false));
        record_err(&mut errors, SupportedAgentId::Agy, write_json_mcp(&home.join(".gemini/config/mcp_config.json"), false));
        let rule = home.join(".gemini/config/rules/aice.md");
        sync_prompt(&mut errors, SupportedAgentId::Agy, &home.join(".gemini/GEMINI.md"), opts.global_rules);
        if opts.global_rules {
            record_err(&mut errors, SupportedAgentId::Agy, upsert_always_on_rule_file(&rule));
        } else {
            remove_always_on_rule_file(&rule, true);
        }
    }
    if should(SupportedAgentId::Codex, &[home.join(".codex")], &["codex"]) {
        let toml_p = home.join(".codex/config.toml");
        let next = upsert_codex_toml_str(read_if_file(&toml_p).as_deref());
        record_err(&mut errors, SupportedAgentId::Codex, write_atomic_err(&toml_p, &next));
        sync_prompt(&mut errors, SupportedAgentId::Codex, &home.join(".codex/AGENTS.md"), opts.global_rules);
    }
    if should(SupportedAgentId::Opencode, &[home.join(".config/opencode")], &["opencode"]) {
        record_err(&mut errors, SupportedAgentId::Opencode, write_json_mcp(&home.join(".config/opencode/opencode.json"), true));
        sync_prompt(&mut errors, SupportedAgentId::Opencode, &home.join(".config/opencode/AGENTS.md"), opts.global_rules);
    }
    if should(SupportedAgentId::Aider, &[home.join(".aider"), home.join(".aider.conf.yml")], &["aider"]) {
        let conv = home.join(".aider/CONVENTIONS.md");
        sync_prompt(&mut errors, SupportedAgentId::Aider, &conv, opts.global_rules);
        let conf = home.join(".aider.conf.yml");
        let res = upsert_aider_yaml_str(read_if_file(&conf).as_deref(), &conv.display().to_string(), &conf.display().to_string())
            .and_then(|s| write_atomic_err(&conf, &s));
        record_err(&mut errors, SupportedAgentId::Aider, res);
    }
    if should(SupportedAgentId::Goose, &[home.join(".config/goose")], &["goose"]) {
        let conf = home.join(".config/goose/config.yaml");
        let res = upsert_goose_yaml_str(read_if_file(&conf).as_deref(), &conf.display().to_string())
            .and_then(|s| write_atomic_err(&conf, &s));
        record_err(&mut errors, SupportedAgentId::Goose, res);
    }
    if should(SupportedAgentId::Cursor, &[home.join(".cursor")], &["cursor"]) {
        record_err(&mut errors, SupportedAgentId::Cursor, write_json_mcp(&home.join(".cursor/mcp.json"), false));
    }

    let mut out = get_agents_status(opts);
    for e in &mut out.agents {
        if let Some(msg) = errors.remove(&e.id) {
            e.error = Some(msg);
        }
    }
    out
}

pub fn remove_agents(opts: &AgentSetupOptions) -> AgentActionResult {
    let home = resolve_agent_home(opts.home_dir.as_deref());
    let filter = opts.agent.as_deref().and_then(SupportedAgentId::parse);
    let matches = |id: SupportedAgentId| filter.is_none_or(|f| f == id);

    if matches(SupportedAgentId::Claude) {
        strip_json_mcp(&home.join(".claude.json"));
        strip_json_mcp(&home.join(".claude/settings.json"));
        let _ = remove_markdown_directive(&home.join(".claude/CLAUDE.md"), true);
    }
    if matches(SupportedAgentId::Agy) {
        strip_json_mcp(&home.join(".gemini/settings.json"));
        strip_json_mcp(&home.join(".gemini/config/mcp_config.json"));
        let _ = remove_markdown_directive(&home.join(".gemini/GEMINI.md"), true);
        remove_always_on_rule_file(&home.join(".gemini/config/rules/aice.md"), true);
    }
    if matches(SupportedAgentId::Codex) {
        let p = home.join(".codex/config.toml");
        if let Some(raw) = read_if_file(&p) && let Some(next) = remove_codex_toml_str(&raw) {
            apply_opt_write(&p, next);
        }
        let _ = remove_markdown_directive(&home.join(".codex/AGENTS.md"), true);
    }
    if matches(SupportedAgentId::Opencode) {
        strip_json_mcp(&home.join(".config/opencode/opencode.json"));
        let _ = remove_markdown_directive(&home.join(".config/opencode/AGENTS.md"), true);
    }
    if matches(SupportedAgentId::Aider) {
        let conv = home.join(".aider/CONVENTIONS.md");
        let _ = remove_markdown_directive(&conv, true);
        let p = home.join(".aider.conf.yml");
        if let Some(raw) = read_if_file(&p) && let Some(next) = remove_aider_yaml_str(&raw, &conv.display().to_string()) {
            apply_opt_write(&p, next);
        }
    }
    if matches(SupportedAgentId::Goose) {
        let p = home.join(".config/goose/config.yaml");
        if let Some(raw) = read_if_file(&p) && let Some(next) = remove_goose_yaml_str(&raw) {
            let _ = write_file_atomic(&p, &next);
        }
    }
    if matches(SupportedAgentId::Cursor) {
        strip_json_mcp(&home.join(".cursor/mcp.json"));
    }
    get_agents_status(opts)
}

fn write_atomic_err(p: &Path, content: &str) -> Result<(), String> {
    write_file_atomic(p, content).map_err(|e| format!("Failed to write {}: {e}", p.display()))
}

fn write_json_mcp(p: &Path, also_mcp: bool) -> Result<(), String> {
    let existing = read_if_file(p);
    let next = upsert_json_mcp_str(existing.as_deref(), also_mcp, &p.display().to_string())?;
    write_atomic_err(p, &next)
}

fn strip_json_mcp(p: &Path) {
    if let Some(raw) = read_if_file(p) && let Some(next) = remove_json_mcp_str(&raw) {
        let _ = write_file_atomic(p, &next);
    }
}

fn apply_opt_write(p: &Path, next: Option<String>) {
    match next {
        None => { let _ = remove_file_if_exists(p); }
        Some(s) => { let _ = write_file_atomic(p, &s); }
    }
}

fn sync_prompt(errors: &mut BTreeMap<SupportedAgentId, String>, id: SupportedAgentId, p: &Path, enable: bool) {
    let res = if enable {
        upsert_markdown_directive(p, None, false, false).map(|_| ())
    } else {
        remove_markdown_directive(p, true).map(|_| ())
    };
    record_err(errors, id, res);
}

fn record_err(errors: &mut BTreeMap<SupportedAgentId, String>, id: SupportedAgentId, res: Result<(), String>) {
    if let Err(msg) = res {
        errors.entry(id).and_modify(|prev| { prev.push_str("; "); prev.push_str(&msg); }).or_insert(msg);
    }
}
