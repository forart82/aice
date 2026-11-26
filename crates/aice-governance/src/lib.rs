pub mod agents;
pub mod agents_formats;
pub mod agents_inspect;
pub mod agents_render;
pub mod agents_yaml;
pub mod binary_probe;
pub mod config;
pub mod config_discovery;
pub mod heredoc_targets;
pub mod json;
mod json_parser;
pub mod ops;
pub mod path_guard;
pub mod rules_markdown;
pub mod rules_sync;
pub mod target_spec;
pub mod typestate;
mod typestate_targets;

pub use agents::{
    AgentActionResult, AgentSetupOptions, AgentStatusEntry, SupportedAgentId,
    format_agents_status_table, get_agents_status, remove_agents, setup_agents,
};
pub use binary_probe::{
    BinaryProbeResult, is_binary_extension, probe_binary, probe_bytes, probe_bytes_with_partial,
    probe_file,
};
pub use config::{
    ConfigPatch, ProjectStatusReport, load_config, load_config_checked, project_status,
    save_config, set_project_enabled, write_mcp_schema_files,
};
pub use config_discovery::{
    AiceConfig, AiceMode, find_project_root, strip_jsonc_comments, strip_jsonc_comments_checked,
};
pub use json::{JsonError, JsonValue, escape_json_str, parse_json};
pub use ops::{
    AdminAction, AdminOp, FindOp, NonAdminOp, OperationKind, OperationTargets, ReadOp, SearchOp,
    WriteOp, split_target_selector, split_target_selector_in_dir, strip_selector,
};
pub use path_guard::{AuthorizedPath, OutputSurface};
pub use rules_sync::{
    ALWAYS_ON_AICE_RULE_FILE, MANDATORY_AGENT_RULES_MARKDOWN, MAX_AGENTS_MD_BYTES,
    RulesSyncStatus, sync_agents_rules, sync_project_workspace_rules,
};
pub use target_spec::{
    has_non_drive_colon_slash, has_non_drive_colon_slash_str, has_regex_selector_part,
    is_valid_selector_tail,
};
pub use typestate::{
    AdminGoverned, GovernanceError, Governed, PipelineRequest, Raw, authorize, authorize_admin,
    resolve_aice_home,
};
