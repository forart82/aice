use std::path::{Path, PathBuf};

use aice_governance::{find_project_root, resolve_aice_home};

pub fn std_env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.trim().is_empty())
}

pub fn resolve_gains_path_with(
    explicit: Option<&Path>,
    env_fn: &dyn Fn(&str) -> Option<String>,
) -> PathBuf {
    if let Some(p) = explicit {
        if p.is_dir() || (p.extension().is_none() && p.to_string_lossy().ends_with('/')) {
            return p.join("gains.jsonl");
        }
        return p.to_path_buf();
    }
    if let Some(p) = env_fn("AICE_TELEMETRY_PATH") {
        return PathBuf::from(p);
    }
    if let Some(dir) = env_fn("AICE_TELEMETRY_DIR") {
        return PathBuf::from(dir).join("gains.jsonl");
    }
    if let Some(home) = env_fn("AICE_HOME") {
        return PathBuf::from(home).join("telemetry").join("gains.jsonl");
    }
    if let Some(home) = env_fn("HOME") {
        return PathBuf::from(home).join(".aice").join("telemetry").join("gains.jsonl");
    }
    resolve_aice_home().join("telemetry").join("gains.jsonl")
}

pub fn resolve_errors_path_with(
    explicit: Option<&Path>,
    env_fn: &dyn Fn(&str) -> Option<String>,
) -> PathBuf {
    if let Some(p) = env_fn("AICE_TELEMETRY_ERRORS_PATH") {
        return PathBuf::from(p);
    }
    let gains = resolve_gains_path_with(explicit, env_fn);
    gains
        .parent()
        .map(|d| d.join("errors.jsonl"))
        .unwrap_or_else(|| PathBuf::from("errors.jsonl"))
}

pub fn has_telemetry_override_with(
    explicit: Option<&Path>,
    env_fn: &dyn Fn(&str) -> Option<String>,
) -> bool {
    explicit.is_some()
        || env_fn("AICE_TELEMETRY_PATH").is_some()
        || env_fn("AICE_TELEMETRY_DIR").is_some()
        || env_fn("AICE_HOME").is_some()
}

pub fn is_ephemeral_path(path: &Path) -> bool {
    let norm = path.to_string_lossy().replace('\\', "/");
    let sys_tmp = std::env::temp_dir().to_string_lossy().replace('\\', "/");
    let sys_tmp_trim = sys_tmp.trim_end_matches('/');
    if norm == "/tmp"
        || norm.starts_with("/tmp/")
        || norm == "/private/tmp"
        || norm.starts_with("/private/tmp/")
        || norm == "/var/tmp"
        || norm.starts_with("/var/tmp/")
        || norm == "/private/var/tmp"
        || norm.starts_with("/private/var/tmp/")
        || (!sys_tmp_trim.is_empty()
            && (norm == sys_tmp_trim || norm.starts_with(&format!("{sys_tmp_trim}/"))))
    {
        return true;
    }
    let base = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
    base.starts_with("swarm-") || norm.contains("/swarm-")
}

pub fn is_ephemeral_workspace_with(
    cwd: Option<&Path>,
    project_root: Option<&Path>,
    target_path: Option<&Path>,
    explicit_telemetry: Option<&Path>,
    env_fn: &dyn Fn(&str) -> Option<String>,
) -> bool {
    if has_telemetry_override_with(explicit_telemetry, env_fn) {
        return false;
    }
    [cwd, project_root, target_path]
        .into_iter()
        .flatten()
        .any(is_ephemeral_path)
}

pub fn detect_caller_agent_with(surface: &str, env_fn: &dyn Fn(&str) -> Option<String>) -> String {
    if let Some(a) = env_fn("AICE_AGENT") {
        return a;
    }
    if env_fn("ANTIGRAVITY_CLI").is_some()
        || env_fn("ANTIGRAVITY_AGENT").is_some()
        || env_fn("AGY_SESSION").is_some()
    {
        return "antigravity".to_string();
    }
    if env_fn("CLAUDECODE").is_some()
        || env_fn("CLAUDE_CODE_ENTRYPOINT").is_some()
        || env_fn("CLAUDE_PROJECT_DIR").is_some()
    {
        return "claude-code".to_string();
    }
    if env_fn("CODEX_SANDBOX").is_some()
        || env_fn("CODEX_CLI").is_some()
        || env_fn("OPENAI_CODEX").is_some()
    {
        return "codex".to_string();
    }
    if env_fn("GEMINI_CLI").is_some() {
        return "gemini-cli".to_string();
    }
    if env_fn("OPENCODE").is_some() || env_fn("OPENCODE_CLI").is_some() {
        return "opencode".to_string();
    }
    if env_fn("AIDER").is_some() || env_fn("AIDER_MODEL").is_some() {
        return "aider".to_string();
    }
    if env_fn("GOOSE_PROVIDER").is_some() {
        return "goose".to_string();
    }
    if env_fn("CURSOR_TRACE_ID").is_some() || env_fn("CURSOR_SESSION").is_some() {
        return "cursor".to_string();
    }
    if surface == "mcp" { "mcp".to_string() } else { "cli".to_string() }
}

pub fn detect_caller_agent(surface: &str) -> String {
    detect_caller_agent_with(surface, &std_env)
}

pub fn is_explicit_project_path_query(filter: &str) -> bool {
    let t = filter.trim();
    t == "."
        || t == ".."
        || t.starts_with('/')
        || t.starts_with("./")
        || t.starts_with("../")
        || t.contains('/')
        || t.contains('\\')
}

pub fn normalize_lexical_path(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                if matches!(out.components().next_back(), Some(Component::Normal(_))) {
                    out.pop();
                } else if !out.has_root() {
                    out.push(comp);
                }
            }
            other => out.push(other),
        }
    }
    if out.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        out
    }
}

pub fn canonicalize_or_normalize(path: &Path) -> PathBuf {
    if path.exists()
        && let Ok(canon) = std::fs::canonicalize(path)
    {
        return canon;
    }
    normalize_lexical_path(path)
}

pub fn resolve_project_filter_target(filter: Option<&str>, cwd: &Path) -> PathBuf {
    let base_cwd = canonicalize_or_normalize(cwd);
    let Some(raw) = filter.map(str::trim).filter(|s| !s.is_empty()) else {
        return canonicalize_or_normalize(&find_project_root(&base_cwd));
    };
    if raw == "." {
        return canonicalize_or_normalize(&find_project_root(&base_cwd));
    }
    let cand = if Path::new(raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        cwd.join(raw)
    };
    let resolved = canonicalize_or_normalize(&cand);
    if resolved.exists() {
        let root = find_project_root(&resolved);
        return canonicalize_or_normalize(&root);
    }
    resolved
}
