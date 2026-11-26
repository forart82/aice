use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use aice_governance::path_guard::is_blocked_system_path;
use aice_governance::{JsonValue, find_project_root, load_config_checked};
pub use aice_pipeline::build_tools_list_result;

fn obj(entries: Vec<(&str, JsonValue)>) -> JsonValue {
    let mut map = BTreeMap::new();
    for (k, v) in entries {
        map.insert(k.to_string(), v);
    }
    JsonValue::Object(map)
}

fn jstr(s: &str) -> JsonValue {
    JsonValue::String(s.to_string())
}

pub fn build_initialize_result() -> JsonValue {
    obj(vec![
        ("protocolVersion", jstr("2024-11-05")),
        ("capabilities", obj(vec![("tools", obj(vec![]))])),
        (
            "serverInfo",
            obj(vec![
                ("name", jstr("aice-mcp")),
                ("version", jstr(env!("CARGO_PKG_VERSION"))),
            ]),
        ),
    ])
}

const BLOCKED_SYSTEM_ROOTS: &[&str] = &[
    "/etc", "/proc", "/sys", "/dev", "/root", "/boot", "/usr", "/bin", "/sbin", "/lib", "/lib64",
    "/run", "/var/log",
];

const AICE_MARKERS: [&str; 3] = [
    "aice.config.json",
    ".aicerc",
    ".aice-build",
];

const PROJECT_MARKERS: [&str; 6] = [
    "package.json",
    "composer.json",
    "Cargo.toml",
    "go.mod",
    "pyproject.toml",
    ".git",
];

pub fn resolve_workspace_root(
    params: Option<&JsonValue>,
    launch_cwd: &Path,
) -> Option<PathBuf> {
    let launch_root = find_project_root(launch_cwd);
    let Ok(cfg) = load_config_checked(&launch_root) else {
        return None;
    };
    if !cfg.enabled {
        return None;
    }
    let launch_root_canon = std::fs::canonicalize(&launch_root).ok()?;
    let contained_root = active_project_root_canon(&launch_root, &launch_root_canon);

    let map = params.and_then(JsonValue::as_object)?;
    let mut candidates = Vec::new();
    if let Some(s) = map.get("rootUri").and_then(JsonValue::as_str) {
        candidates.push(s);
    }
    if let Some(s) = map.get("rootPath").and_then(JsonValue::as_str) {
        candidates.push(s);
    }
    for key in ["workspaceFolders", "roots"] {
        if let Some(items) = map.get(key).and_then(JsonValue::as_array) {
            for item in items {
                if let Some(obj) = item.as_object() {
                    if let Some(s) = obj.get("uri").and_then(JsonValue::as_str) {
                        candidates.push(s);
                    } else if let Some(s) = obj.get("path").and_then(JsonValue::as_str) {
                        candidates.push(s);
                    }
                }
            }
        }
    }
    candidates
        .into_iter()
        .find_map(|raw| valid_root_candidate(raw, launch_cwd, contained_root.as_deref()))
}

fn active_project_root_canon(launch_root: &Path, launch_root_canon: &Path) -> Option<PathBuf> {
    if launch_root_canon == Path::new("/") {
        return None;
    }
    if AICE_MARKERS.iter().any(|m| launch_root.join(m).exists()) {
        return Some(launch_root_canon.to_path_buf());
    }
    let home_canon = std::env::var_os("HOME").and_then(|h| std::fs::canonicalize(h).ok());
    if home_canon.as_deref() == Some(launch_root_canon) {
        return None;
    }
    let tmp_canon = std::fs::canonicalize(std::env::temp_dir()).ok();
    if tmp_canon.as_deref() == Some(launch_root_canon)
        || matches!(launch_root_canon.to_str(), Some("/tmp" | "/var/tmp"))
    {
        return None;
    }
    if PROJECT_MARKERS.iter().any(|m| launch_root.join(m).exists()) {
        return Some(launch_root_canon.to_path_buf());
    }
    None
}

fn valid_root_candidate(
    raw: &str,
    launch_cwd: &Path,
    contained_root: Option<&Path>,
) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.contains('\0') {
        return None;
    }
    let path_str = if let Some(rest) = trimmed.strip_prefix("file://") {
        let local = rest.strip_prefix("localhost").unwrap_or(rest);
        if !local.starts_with('/') {
            return None;
        }
        percent_decode(local)?
    } else {
        trimmed.to_string()
    };
    let raw_path = PathBuf::from(path_str);
    let joined = if raw_path.is_absolute() {
        raw_path
    } else {
        launch_cwd.join(raw_path)
    };
    let canon = std::fs::canonicalize(&joined).ok()?;
    if !canon.is_dir() || is_blocked_system_root(&canon) {
        return None;
    }
    if let Some(root) = contained_root
        && !canon.starts_with(root)
    {
        return None;
    }
    Some(canon)
}

fn percent_decode(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2]))
        {
            let byte = (hi << 4) | lo;
            if byte == 0 {
                return None;
            }
            out.push(byte);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).ok()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn is_blocked_system_root(canon: &Path) -> bool {
    if canon == Path::new("/") || is_blocked_system_path(canon) {
        return true;
    }
    BLOCKED_SYSTEM_ROOTS
        .iter()
        .any(|prefix| canon.starts_with(prefix))
}
