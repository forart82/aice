use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::json::{JsonValue, parse_json};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AiceMode {
    SideBySide,
    Isolated,
    Twinless,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AiceConfig {
    pub enabled: bool,
    pub mode: AiceMode,
    pub source_dir: String,
    pub out_dir: String,
    pub target_language: String,
    pub isolated: bool,
    pub watermark: bool,
    pub allowed_read_roots: Vec<PathBuf>,
    pub extra_fields: BTreeMap<String, JsonValue>,
}

impl Default for AiceConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            mode: AiceMode::SideBySide,
            source_dir: "src".to_string(),
            out_dir: ".aice-build".to_string(),
            target_language: "typescript".to_string(),
            isolated: false,
            watermark: true,
            allowed_read_roots: Vec::new(),
            extra_fields: BTreeMap::new(),
        }
    }
}

pub fn find_project_root(start: &Path) -> PathBuf {
    const MARKERS: [&str; 9] = [
        "aice.config.json", ".aicerc", ".aice-build",
        "package.json", "composer.json", "Cargo.toml", "go.mod", "pyproject.toml", ".git",
    ];
    let initial = if start.is_file() || (!start.exists() && start.extension().is_some()) {
        start.parent().unwrap_or(start).to_path_buf()
    } else {
        start.to_path_buf()
    };
    let cwd = std::env::current_dir().ok();
    let home_dir = std::env::var_os("HOME").map(PathBuf::from);
    let tmp_root = std::env::temp_dir();
    let started_in_cwd = cwd.as_ref().is_some_and(|c| initial.starts_with(c));
    let mut cur = initial.clone();

    loop {
        if cur != initial
            && (home_dir.as_ref().is_some_and(|h| *h == cur)
                || cur == Path::new("/tmp")
                || cur == Path::new("/var/tmp")
                || cur == tmp_root)
        {
            break;
        }
        if MARKERS.iter().any(|m| cur.join(m).exists()) {
            return cur;
        }
        if started_in_cwd && cwd.as_ref().is_some_and(|c| *c == cur) || !cur.pop() {
            break;
        }
    }
    if let Some(name) = initial.file_name().and_then(|n| n.to_str())
        && (name == "src" || name == "tests")
        && let Some(parent) = initial.parent()
        && parent.join("src").exists()
        && parent.join("tests").exists()
    {
        return parent.to_path_buf();
    }
    initial
}

pub fn discover_config_checked(project_root: &Path) -> Result<AiceConfig, String> {
    let raw_map = load_primary_map(project_root)?;
    let mut cfg = AiceConfig::default();
    if let Some(map) = raw_map {
        apply_config_map(&mut cfg, &map)?;
    } else if project_root.join(".aice-build").exists() {
        cfg.mode = AiceMode::Isolated;
        cfg.isolated = true;
    }
    Ok(cfg)
}

fn load_primary_map(project_root: &Path) -> Result<Option<BTreeMap<String, JsonValue>>, String> {
    for name in ["aice.config.json", ".aicerc"] {
        let path = project_root.join(name);
        if path.is_file() {
            return Ok(Some(parse_jsonc_object_file(&path, true)?));
        }
    }
    let pkg_path = project_root.join("package.json");
    if pkg_path.is_file() {
        let pkg = parse_jsonc_object_file(&pkg_path, false)?;
        if let Some(aice_val) = pkg.get("aice") {
            let Some(map) = aice_val.as_object() else {
                return Err(format!("Invalid \"aice\" field in {}: expected JSON object", pkg_path.display()));
            };
            return Ok(Some(map.clone()));
        }
    }
    Ok(None)
}

pub(crate) fn parse_jsonc_object_file(
    path: &Path,
    allow_comments: bool,
) -> Result<BTreeMap<String, JsonValue>, String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    let trimmed_bom = raw.trim_start_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}');
    let content = if allow_comments {
        strip_jsonc_comments_checked(trimmed_bom)
            .map_err(|e| format!("Failed to parse {}: {e}", path.display()))?
    } else {
        trimmed_bom.to_string()
    };
    let val = parse_json(&content)
        .map_err(|e| format!("Failed to parse {}: {e}", path.display()))?;
    val.as_object()
        .cloned()
        .ok_or_else(|| format!("Invalid {}: root JSON value must be an object", path.display()))
}

fn apply_config_map(cfg: &mut AiceConfig, map: &BTreeMap<String, JsonValue>) -> Result<(), String> {
    if let Some(v) = map.get("enabled") {
        cfg.enabled = v.as_bool().ok_or("Invalid enabled: expected boolean")?;
    }
    if let Some(v) = map.get("mode") {
        cfg.mode = match v.as_str().ok_or("Invalid mode: expected string")? {
            "side-by-side" => AiceMode::SideBySide,
            "isolated" => AiceMode::Isolated,
            "twinless" => AiceMode::Twinless,
            other => return Err(format!("Invalid mode: '{other}'")),
        };
    }
    if let Some(v) = map.get("isolated") {
        cfg.isolated = v.as_bool().ok_or("Invalid isolated: expected boolean")?;
        if !map.contains_key("mode") {
            cfg.mode = if cfg.isolated { AiceMode::Isolated } else { AiceMode::SideBySide };
        }
    } else if map.contains_key("mode") {
        cfg.isolated = cfg.mode == AiceMode::Isolated;
    }
    if let Some(v) = map.get("sourceDir") {
        cfg.source_dir = v.as_str().ok_or("Invalid sourceDir: expected string")?.to_string();
    }
    if let Some(v) = map.get("outDir") {
        cfg.out_dir = v.as_str().ok_or("Invalid outDir: expected string")?.to_string();
    }
    if let Some(v) = map.get("targetLanguage") {
        cfg.target_language = v.as_str().ok_or("Invalid targetLanguage: expected string")?.to_string();
    }
    if let Some(v) = map.get("watermark") {
        cfg.watermark = v.as_bool().ok_or("Invalid watermark: expected boolean")?;
    }
    if let Some(v) = map.get("allowedReadRoots") {
        let arr = v.as_array().ok_or("Invalid allowedReadRoots: expected array")?;
        cfg.allowed_read_roots = arr
            .iter()
            .filter_map(JsonValue::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .collect();
    }
    for (k, v) in map {
        if !matches!(
            k.as_str(),
            "enabled" | "mode" | "sourceDir" | "outDir"
                | "targetLanguage" | "isolated" | "watermark" | "allowedReadRoots"
        ) {
            cfg.extra_fields.insert(k.clone(), v.clone());
        }
    }
    Ok(())
}

pub fn strip_jsonc_comments(input: &str) -> String {
    strip_jsonc_comments_inner(input, false).unwrap_or_default()
}

pub fn strip_jsonc_comments_checked(input: &str) -> Result<String, String> {
    strip_jsonc_comments_inner(input, true)
}

fn strip_jsonc_comments_inner(input: &str, fail_on_unclosed: bool) -> Result<String, String> {
    let input = input.trim_start_matches('\u{FEFF}');
    let mut out = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let (mut i, mut in_str) = (0, false);
    while i < chars.len() {
        if in_str {
            out.push(chars[i]);
            if chars[i] == '\\' && i + 1 < chars.len() {
                i += 1;
                out.push(chars[i]);
            } else if chars[i] == '"' {
                in_str = false;
            }
            i += 1;
            continue;
        }
        if chars[i] == '"' {
            in_str = true;
            out.push('"');
            i += 1;
        } else if chars[i] == '/' && chars.get(i + 1) == Some(&'/') {
            while i < chars.len() && chars[i] != '\n' && chars[i] != '\r' {
                i += 1;
            }
        } else if chars[i] == '/' && chars.get(i + 1) == Some(&'*') {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            if i + 1 < chars.len() {
                i += 2;
            } else if fail_on_unclosed {
                return Err("unterminated block comment".to_string());
            } else {
                break;
            }
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    Ok(out)
}
