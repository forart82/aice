use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub use crate::config_discovery::{
    AiceConfig, AiceMode, find_project_root, strip_jsonc_comments, strip_jsonc_comments_checked,
};
use crate::config_discovery::{discover_config_checked, parse_jsonc_object_file};
use crate::json::{JsonValue, escape_json_str};
use crate::rules_sync::{RulesSyncStatus, sync_project_workspace_rules};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ConfigPatch {
    pub enabled: Option<bool>,
    pub strip_legacy_keys: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectStatusReport {
    pub project_root: PathBuf,
    pub enabled: bool,
}

impl ProjectStatusReport {
    pub fn from_config(project_root: &Path, cfg: &AiceConfig) -> Self {
        Self {
            project_root: project_root.to_path_buf(),
            enabled: cfg.enabled,
        }
    }

    pub fn to_json_string(&self) -> String {
        let mut out = String::from("{\n  \"projectRoot\": ");
        escape_json_str(&self.project_root.display().to_string(), &mut out);
        out.push_str(&format!(",\n  \"enabled\": {}\n}}\n", self.enabled));
        out
    }

    pub fn format_status_text(&self) -> String {
        format!(
            "\n=== AICE Project Config: {} ===\n  AICE Status:    {}\n",
            self.project_root.display(),
            if self.enabled { "ENABLED" } else { "DISABLED (opt-out)" }
        )
    }
}

pub fn load_config(project_root: &Path) -> AiceConfig {
    discover_config_checked(project_root).unwrap_or_default()
}

pub fn load_config_checked(project_root: &Path) -> Result<AiceConfig, String> {
    discover_config_checked(project_root)
}

pub(crate) fn read_link_target(path: &Path) -> Option<PathBuf> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if meta.file_type().is_symlink() {
        std::fs::read_link(path).ok()
    } else {
        None
    }
}

pub(crate) fn write_file_atomic(file_path: &Path, content: &str) -> std::io::Result<()> {
    let mut target = if file_path.is_absolute() {
        file_path.to_path_buf()
    } else {
        std::env::current_dir()?.join(file_path)
    };
    if let Ok(meta) = std::fs::symlink_metadata(&target)
        && meta.file_type().is_symlink()
        && let Ok(real) = std::fs::canonicalize(&target)
    {
        target = real;
    }
    let dir = target.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(dir)?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("tmp");
    let tmp_path = dir.join(format!(".{name}.{}.{nanos}.tmp", std::process::id()));
    if let Err(err) = std::fs::write(&tmp_path, content) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(err);
    }
    if let Err(err) = std::fs::rename(&tmp_path, &target) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(err);
    }
    Ok(())
}

pub(crate) fn remove_file_if_exists(path: &Path) -> std::io::Result<bool> {
    if !path.exists() {
        return Ok(false);
    }
    std::fs::remove_file(path)?;
    Ok(true)
}

pub(crate) fn remove_dir_if_empty(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    let is_empty = std::fs::read_dir(dir)
        .map(|mut it| it.next().is_none())
        .unwrap_or(false);
    if is_empty {
        std::fs::remove_dir(dir).is_ok()
    } else {
        false
    }
}

pub fn save_config(project_root: &Path, patch: &ConfigPatch) -> Result<AiceConfig, String> {
    if !project_root.is_dir() {
        return Err(format!(
            "Target directory does not exist: {}",
            project_root.display()
        ));
    }
    let config_path = project_root.join("aice.config.json");
    let mut existing: BTreeMap<String, JsonValue> = if config_path.is_file() {
        parse_jsonc_object_file(&config_path, true)?
    } else {
        BTreeMap::new()
    };

    if let Some(enabled) = patch.enabled {
        existing.insert("enabled".to_string(), JsonValue::Bool(enabled));
    }

    if patch.strip_legacy_keys {
        for (k, def) in [
            ("mode", JsonValue::String("side-by-side".into())),
            ("sourceDir", JsonValue::String("src".into())),
            ("outDir", JsonValue::String(".aice-build".into())),
            ("targetLanguage", JsonValue::String("typescript".into())),
            ("isolated", JsonValue::Bool(false)),
            ("watermark", JsonValue::Bool(true)),
        ] {
            if existing.get(k) == Some(&def) {
                existing.remove(k);
            }
        }
    }

    let serialized = format!("{}\n", JsonValue::Object(existing).to_pretty_string());
    write_file_atomic(&config_path, &serialized)
        .map_err(|e| format!("Failed to write {}: {e}", config_path.display()))?;
    discover_config_checked(project_root)
}

fn validate_target_dir(dir: &Path) -> Result<PathBuf, String> {
    if dir.as_os_str().is_empty() || dir.as_os_str().as_encoded_bytes().contains(&0) {
        return Err(format!("Invalid target directory: {}", dir.display()));
    }
    let meta = std::fs::metadata(dir).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            format!("Target directory does not exist: {}", dir.display())
        } else {
            format!("Cannot access target directory {}: {e}", dir.display())
        }
    })?;
    if !meta.is_dir() {
        return Err(format!("Target path is not a directory: {}", dir.display()));
    }
    if std::fs::symlink_metadata(dir).is_ok_and(|m| m.file_type().is_symlink()) {
        return std::fs::canonicalize(dir)
            .map_err(|e| format!("Cannot resolve target directory {}: {e}", dir.display()));
    }
    Ok(dir.to_path_buf())
}

pub fn set_project_enabled(
    dir: &Path,
    enabled: bool,
    force: bool,
) -> Result<(ProjectStatusReport, RulesSyncStatus), String> {
    let valid_dir = validate_target_dir(dir)?;
    let root = find_project_root(&valid_dir);
    let _ = load_config_checked(&root)?;
    let cfg = save_config(
        &root,
        &ConfigPatch {
            enabled: Some(enabled),
            strip_legacy_keys: true,
        },
    )?;
    let sync = sync_project_workspace_rules(&root, enabled, force);
    Ok((ProjectStatusReport::from_config(&root, &cfg), sync))
}

pub fn project_status(dir: &Path) -> Result<ProjectStatusReport, String> {
    let valid_dir = validate_target_dir(dir)?;
    let root = find_project_root(&valid_dir);
    let cfg = load_config_checked(&root)?;
    Ok(ProjectStatusReport::from_config(&root, &cfg))
}

pub fn write_mcp_schema_files(dir: &Path, files: &[(&str, &str)]) -> Result<(), String> {
    if dir.as_os_str().is_empty() || dir.as_os_str().as_encoded_bytes().contains(&0) {
        return Err("schema output directory cannot be empty".to_string());
    }
    if dir.exists() && !dir.is_dir() {
        return Err(format!("schema output path is not a directory: {}", dir.display()));
    }
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if name.starts_with("aice_")
                && name.ends_with(".json")
                && !files.iter().any(|(keep, _)| *keep == name)
            {
                let _ = remove_file_if_exists(&path);
            }
        }
    }
    for (name, content) in files {
        let dest = dir.join(name);
        write_file_atomic(&dest, content)
            .map_err(|e| format!("Failed to write {}: {e}", dest.display()))?;
    }
    Ok(())
}
