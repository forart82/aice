use std::path::PathBuf;

use crate::json::escape_json_str;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum SupportedAgentId {
    Claude,
    Agy,
    Codex,
    Opencode,
    Aider,
    Goose,
    Cursor,
}

impl SupportedAgentId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Agy => "agy",
            Self::Codex => "codex",
            Self::Opencode => "opencode",
            Self::Aider => "aider",
            Self::Goose => "goose",
            Self::Cursor => "cursor",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::Claude => "Claude Code (claude)",
            Self::Agy => "Antigravity / Gemini CLI (agy/gemini)",
            Self::Codex => "OpenAI Codex CLI (codex)",
            Self::Opencode => "OpenCode (opencode)",
            Self::Aider => "Aider (aider)",
            Self::Goose => "Goose CLI (goose)",
            Self::Cursor => "Cursor Agent (cursor)",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "claude" => Some(Self::Claude),
            "agy" | "gemini" => Some(Self::Agy),
            "codex" => Some(Self::Codex),
            "opencode" => Some(Self::Opencode),
            "aider" => Some(Self::Aider),
            "goose" => Some(Self::Goose),
            "cursor" => Some(Self::Cursor),
            _ => None,
        }
    }

    pub fn all() -> [Self; 7] {
        [
            Self::Claude,
            Self::Agy,
            Self::Codex,
            Self::Opencode,
            Self::Aider,
            Self::Goose,
            Self::Cursor,
        ]
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentStatusEntry {
    pub id: SupportedAgentId,
    pub display_name: String,
    pub binary_detected: bool,
    pub binary_path: Option<PathBuf>,
    pub mcp_configured: bool,
    pub mcp_config_path: PathBuf,
    pub prompt_configured: bool,
    pub prompt_path: Option<PathBuf>,
    pub rules_version: Option<String>,
    pub rules_up_to_date: Option<bool>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct AgentSetupOptions {
    pub home_dir: Option<PathBuf>,
    pub all: bool,
    pub agent: Option<String>,
    pub global_rules: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentActionResult {
    pub home_dir: PathBuf,
    pub version: String,
    pub all_rules_up_to_date: bool,
    pub update_recommendation: Option<String>,
    pub agents: Vec<AgentStatusEntry>,
}

impl AgentActionResult {
    pub fn to_json_string(&self) -> String {
        let mut out = String::from("{\n  \"homeDir\": ");
        escape_json_str(&self.home_dir.display().to_string(), &mut out);
        out.push_str(",\n  \"version\": ");
        escape_json_str(&self.version, &mut out);
        out.push_str(&format!(",\n  \"allRulesUpToDate\": {}", self.all_rules_up_to_date));
        if let Some(rec) = &self.update_recommendation {
            out.push_str(",\n  \"updateRecommendation\": ");
            escape_json_str(rec, &mut out);
        }
        out.push_str(",\n  \"agents\": [");
        for (i, a) in self.agents.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            append_agent_json(a, &mut out);
        }
        out.push_str("\n  ]\n}\n");
        out
    }
}

fn append_agent_json(a: &AgentStatusEntry, out: &mut String) {
    out.push_str("\n    {\n      \"id\": ");
    escape_json_str(a.id.as_str(), out);
    out.push_str(",\n      \"displayName\": ");
    escape_json_str(&a.display_name, out);
    out.push_str(&format!(",\n      \"binaryDetected\": {}", a.binary_detected));
    if let Some(bp) = &a.binary_path {
        out.push_str(",\n      \"binaryPath\": ");
        escape_json_str(&bp.display().to_string(), out);
    }
    out.push_str(&format!(",\n      \"mcpConfigured\": {}", a.mcp_configured));
    out.push_str(",\n      \"mcpConfigPath\": ");
    escape_json_str(&a.mcp_config_path.display().to_string(), out);
    out.push_str(&format!(",\n      \"promptConfigured\": {}", a.prompt_configured));
    if let Some(pp) = &a.prompt_path {
        out.push_str(",\n      \"promptPath\": ");
        escape_json_str(&pp.display().to_string(), out);
    }
    if let Some(rv) = &a.rules_version {
        out.push_str(",\n      \"rulesVersion\": ");
        escape_json_str(rv, out);
    }
    if let Some(upto) = a.rules_up_to_date {
        out.push_str(&format!(",\n      \"rulesUpToDate\": {upto}"));
    }
    if let Some(err) = &a.error {
        out.push_str(",\n      \"error\": ");
        escape_json_str(err, out);
    }
    out.push_str("\n    }");
}

pub fn format_agents_status_table(res: &AgentActionResult) -> String {
    let mut lines = vec![
        "================================================================================".to_string(),
        format!("AICE v{} GLOBAL CLI AGENT INTEGRATION STATUS (Home: {})", res.version, res.home_dir.display()),
        "================================================================================".to_string(),
        format!("  {:<36} {:<10} {:<14} System Prompt", "Agent", "Binary", "MCP Config"),
        "--------------------------------------------------------------------------------".to_string(),
    ];
    for a in &res.agents {
        let bin = if a.binary_detected { "FOUND" } else { "not in PATH" };
        let mcp = if a.mcp_configured { "CONFIGURED" } else { "not set" };
        let prompt = if a.prompt_path.is_some() {
            if a.prompt_configured {
                if a.rules_up_to_date == Some(false) {
                    format!("OUTDATED (v{} -> v{})", a.rules_version.as_deref().unwrap_or("old"), res.version)
                } else {
                    format!("CONFIGURED (v{})", a.rules_version.as_deref().unwrap_or(&res.version))
                }
            } else {
                "not set (project-scoped)".to_string()
            }
        } else {
            "N/A (MCP)".to_string()
        };
        lines.push(format!("  {:<36} {:<10} {:<14} {prompt}", a.display_name, bin, mcp));
        if let Some(err) = &a.error {
            lines.push(format!("    ! Warning: {err}"));
        }
    }
    lines.push("--------------------------------------------------------------------------------".to_string());
    lines.join("\n")
}
