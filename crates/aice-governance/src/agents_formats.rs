use std::collections::BTreeMap;

use crate::config_discovery::strip_jsonc_comments;
use crate::json::{JsonValue, parse_json};
pub use crate::agents_yaml::{
    has_aider_yaml_str, has_goose_yaml_str, remove_aider_yaml_str, remove_goose_yaml_str,
    upsert_aider_yaml_str, upsert_goose_yaml_str,
};

pub fn upsert_json_mcp_str(
    existing: Option<&str>,
    also_set_mcp_key: bool,
    path_label: &str,
) -> Result<String, String> {
    let mut root = parse_json_object_or_empty(existing, path_label)?;

    let mut aice_entry = BTreeMap::new();
    aice_entry.insert("command".into(), JsonValue::String("aice".into()));
    aice_entry.insert("args".into(), JsonValue::Array(vec![JsonValue::String("mcp".into())]));
    let servers = match root.get_mut("mcpServers") {
        Some(JsonValue::Object(map)) => map,
        _ => {
            root.insert("mcpServers".into(), JsonValue::Object(BTreeMap::new()));
            root.get_mut("mcpServers").and_then(JsonValue::as_object_mut).unwrap()
        }
    };
    servers.insert("aice".into(), JsonValue::Object(aice_entry));

    if also_set_mcp_key {
        let mut opencode_entry = BTreeMap::new();
        opencode_entry.insert("type".into(), JsonValue::String("local".into()));
        opencode_entry.insert(
            "command".into(),
            JsonValue::Array(vec![JsonValue::String("aice".into()), JsonValue::String("mcp".into())]),
        );
        opencode_entry.insert("enabled".into(), JsonValue::Bool(true));
        let mcp = match root.get_mut("mcp") {
            Some(JsonValue::Object(map)) => map,
            _ => {
                root.insert("mcp".into(), JsonValue::Object(BTreeMap::new()));
                root.get_mut("mcp").and_then(JsonValue::as_object_mut).unwrap()
            }
        };
        mcp.insert("aice".into(), JsonValue::Object(opencode_entry));
    }

    Ok(format!("{}\n", JsonValue::Object(root).to_pretty_string()))
}

pub fn remove_json_mcp_str(existing: &str) -> Option<String> {
    let stripped = strip_jsonc_comments(existing).trim().to_string();
    if stripped.is_empty() {
        return None;
    }
    let mut root = parse_json(&stripped).ok()?.as_object().cloned()?;
    let mut modified = false;
    if let Some(JsonValue::Object(servers)) = root.get_mut("mcpServers")
        && servers.remove("aice").is_some()
    {
        modified = true;
    }
    if let Some(JsonValue::Object(mcp)) = root.get_mut("mcp")
        && mcp.remove("aice").is_some()
    {
        modified = true;
    }
    if modified {
        Some(format!("{}\n", JsonValue::Object(root).to_pretty_string()))
    } else {
        None
    }
}

pub fn has_json_mcp_str(existing: &str) -> bool {
    let stripped = strip_jsonc_comments(existing).trim().to_string();
    if stripped.is_empty() {
        return false;
    }
    let Ok(val) = parse_json(&stripped) else {
        return false;
    };
    let Some(root) = val.as_object() else {
        return false;
    };
    let in_servers = root
        .get("mcpServers")
        .and_then(JsonValue::as_object)
        .is_some_and(|m| m.contains_key("aice"));
    let in_mcp = root
        .get("mcp")
        .and_then(JsonValue::as_object)
        .is_some_and(|m| m.contains_key("aice"));
    in_servers || in_mcp
}

fn parse_json_object_or_empty(
    existing: Option<&str>,
    path_label: &str,
) -> Result<BTreeMap<String, JsonValue>, String> {
    let Some(raw) = existing else {
        return Ok(BTreeMap::new());
    };
    let stripped = strip_jsonc_comments(raw).trim().to_string();
    if stripped.is_empty() {
        return Ok(BTreeMap::new());
    }
    let val = parse_json(&stripped)
        .map_err(|e| format!("Cannot merge AICE MCP config into malformed JSON file {path_label}: {e}"))?;
    val.as_object()
        .cloned()
        .ok_or_else(|| format!("Cannot merge AICE MCP config into malformed JSON file {path_label}: root JSON value is not an object"))
}

fn is_toml_table_header(line: &str) -> bool {
    let t = line.trim();
    if t == "[\"mcp\"]" {
        return false;
    }
    let body = t.split('#').next().unwrap_or("").trim();
    (body.starts_with("[[") && body.ends_with("]]") && body.len() > 4)
        || (body.starts_with('[') && body.ends_with(']') && !body[1..body.len() - 1].contains('['))
}

fn is_aice_toml_header(line: &str) -> bool {
    let body = line.trim().split('#').next().unwrap_or("").trim();
    body == "[mcp_servers.aice]"
}

pub fn upsert_codex_toml_str(existing: Option<&str>) -> String {
    let section = ["[mcp_servers.aice]", "command = \"aice\"", "args = [\"mcp\"]"];
    let raw = existing.unwrap_or("");
    let mut out = Vec::new();
    let mut in_aice = false;
    let mut replaced = false;

    for line in raw.lines() {
        if is_aice_toml_header(line) {
            in_aice = true;
            if !replaced {
                out.extend(section);
                replaced = true;
            }
            continue;
        }
        if in_aice {
            if is_toml_table_header(line) {
                in_aice = false;
                if out.last().is_some_and(|l| !l.is_empty()) {
                    out.push("");
                }
                out.push(line);
            }
            continue;
        }
        out.push(line);
    }

    if replaced {
        return format!("{}\n", out.join("\n").trim_end());
    }
    let trimmed = raw.trim_end();
    let block = section.join("\n");
    if trimmed.is_empty() {
        format!("{block}\n")
    } else {
        format!("{trimmed}\n\n{block}\n")
    }
}

pub fn remove_codex_toml_str(existing: &str) -> Option<Option<String>> {
    let mut out = Vec::new();
    let mut in_aice = false;
    let mut found = false;
    for line in existing.lines() {
        if is_aice_toml_header(line) {
            in_aice = true;
            found = true;
            continue;
        }
        if in_aice {
            if is_toml_table_header(line) {
                in_aice = false;
                out.push(line);
            }
            continue;
        }
        out.push(line);
    }
    if !found {
        return None;
    }
    let joined = out.join("\n");
    let trimmed = joined.trim();
    if trimmed.is_empty() { Some(None) } else { Some(Some(format!("{trimmed}\n"))) }
}

pub fn has_codex_toml_str(existing: &str) -> bool {
    existing.lines().any(is_aice_toml_header)
}
