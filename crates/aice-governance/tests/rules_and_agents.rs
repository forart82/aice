use std::path::PathBuf;

use aice_governance::{
    AgentSetupOptions, MAX_AGENTS_MD_BYTES, format_agents_status_table, get_agents_status,
    parse_json, remove_agents, rules_markdown::has_agents_md_include,
    rules_sync::{has_markdown_directive, sync_project_workspace_rules},
    setup_agents,
};

fn fresh_dir(name: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("aice_ra_{name}_{}_{nanos}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

#[test]
fn workspace_rules_sync_respects_fences_cap_and_purges_legacy_files() {
    let ws = fresh_dir("rules");

    // Existing CLAUDE.md including @AGENTS.md should NOT get duplicate directive
    std::fs::write(ws.join("CLAUDE.md"), "# Guide\n\nPlease follow @./AGENTS.md.\n").unwrap();
    assert!(has_agents_md_include("# Guide\nSee @./AGENTS.md.\n"));
    assert!(!has_agents_md_include("```md\n@AGENTS.md\n```\n"));

    // Legacy files to purge
    std::fs::write(ws.join("GEMINI.md"), "<!-- AICE:START -->\nold\n<!-- AICE:END -->\nKeep me\n").unwrap();
    std::fs::create_dir_all(ws.join(".codex")).unwrap();
    std::fs::write(ws.join(".codex/AGENTS.md"), "<!-- AICE:START -->\nold\n<!-- AICE:END -->\n").unwrap();
    std::fs::create_dir_all(ws.join(".agents/rules")).unwrap();
    std::fs::write(ws.join(".agents/rules/aice.md"), "old rule").unwrap();

    // AGENTS.md with fenced example + title
    std::fs::write(
        ws.join("AGENTS.md"),
        "# Project Rules\n\n```md\n<!-- AICE:START -->\nexample\n<!-- AICE:END -->\n```\n",
    )
    .unwrap();

    let status = sync_project_workspace_rules(&ws, true, false);
    assert!(status.updated);
    let agents_after = std::fs::read_to_string(ws.join("AGENTS.md")).unwrap();
    assert_eq!(agents_after.matches("<!-- AICE:START v0.9.53 -->").count(), 1);
    assert!(agents_after.contains("```md\n<!-- AICE:START -->\nexample\n<!-- AICE:END -->\n```"));
    assert!(!has_markdown_directive(&ws.join("CLAUDE.md")));
    assert!(!ws.join(".codex/AGENTS.md").exists());
    assert!(!ws.join(".agents/rules/aice.md").exists());
    assert_eq!(std::fs::read_to_string(ws.join("GEMINI.md")).unwrap().trim(), "Keep me");

    // 22KB cap enforcement unless force=true
    let big_body = format!("# Big\n\n{}\n", "x".repeat(MAX_AGENTS_MD_BYTES));
    std::fs::write(ws.join("AGENTS.md"), &big_body).unwrap();
    let skipped = sync_project_workspace_rules(&ws, true, false);
    assert!(!skipped.updated);
    assert!(skipped.skipped_reason.is_some());
    assert!(!has_markdown_directive(&ws.join("AGENTS.md")));

    let forced = sync_project_workspace_rules(&ws, true, true);
    assert!(forced.updated);
    assert!(has_markdown_directive(&ws.join("AGENTS.md")));

    let _ = std::fs::remove_dir_all(&ws);
}

#[test]
fn agents_setup_status_and_remove_across_all_seven_agents() {
    let home = fresh_dir("agents_home");

    // Pre-existing user configs to verify merge preservation
    std::fs::write(home.join(".claude.json"), "{\"theme\":\"dark\",\"mcpServers\":{\"other\":{\"command\":\"x\"}}}\n").unwrap();
    std::fs::create_dir_all(home.join(".codex")).unwrap();
    std::fs::write(home.join(".codex/config.toml"), "[user]\nmodel = \"o3\"\n").unwrap();
    std::fs::write(home.join(".aider.conf.yml"), "model: gpt-4o\nread:\n  - README.md\n").unwrap();
    std::fs::create_dir_all(home.join(".config/goose")).unwrap();
    std::fs::write(home.join(".config/goose/config.yaml"), "GOOSE_MODEL: sonnet\n").unwrap();

    let setup_res = setup_agents(&AgentSetupOptions {
        home_dir: Some(home.clone()),
        all: true,
        agent: None,
        global_rules: true,
    });
    assert_eq!(setup_res.agents.len(), 7);
    assert!(setup_res.agents.iter().all(|a| a.mcp_configured && a.error.is_none()));
    assert!(setup_res.all_rules_up_to_date);

    // JSON output & table formatting
    assert!(parse_json(&setup_res.to_json_string()).is_ok());
    let table = format_agents_status_table(&setup_res);
    assert!(table.contains("Claude Code"));
    assert!(table.contains("Cursor Agent"));

    // Verify existing user keys preserved
    let claude_raw = std::fs::read_to_string(home.join(".claude.json")).unwrap();
    assert!(claude_raw.contains("\"theme\": \"dark\"") && claude_raw.contains("\"other\""));
    let codex_raw = std::fs::read_to_string(home.join(".codex/config.toml")).unwrap();
    assert!(codex_raw.contains("[user]") && codex_raw.contains("[mcp_servers.aice]"));
    let aider_raw = std::fs::read_to_string(home.join(".aider.conf.yml")).unwrap();
    assert!(aider_raw.contains("README.md") && aider_raw.contains("CONVENTIONS.md"));
    let goose_raw = std::fs::read_to_string(home.join(".config/goose/config.yaml")).unwrap();
    assert!(goose_raw.contains("GOOSE_MODEL: sonnet") && goose_raw.contains("aice:"));

    // Gemini alias filter
    let gemini_only = get_agents_status(&AgentSetupOptions {
        home_dir: Some(home.clone()),
        all: false,
        agent: Some("gemini".into()),
        global_rules: false,
    });
    assert_eq!(gemini_only.agents.len(), 1);
    assert_eq!(gemini_only.agents[0].id.as_str(), "agy");

    // Clean removal preserves user settings
    let removed = remove_agents(&AgentSetupOptions {
        home_dir: Some(home.clone()),
        all: true,
        agent: None,
        global_rules: false,
    });
    assert!(removed.agents.iter().all(|a| !a.mcp_configured && !a.prompt_configured));
    let claude_after = std::fs::read_to_string(home.join(".claude.json")).unwrap();
    assert!(claude_after.contains("\"theme\": \"dark\"") && !claude_after.contains("\"aice\""));
    let codex_after = std::fs::read_to_string(home.join(".codex/config.toml")).unwrap();
    assert!(codex_after.contains("[user]") && !codex_after.contains("[mcp_servers.aice]"));

    let _ = std::fs::remove_dir_all(&home);
}
