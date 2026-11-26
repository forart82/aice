use std::path::Path;

use aice_governance::{JsonValue, escape_json_str, parse_json};

use crate::record::{TelemetryEvent, detect_language_name};
use crate::time_hash::{epoch_ms_to_iso, parse_iso_to_epoch_ms};

impl TelemetryEvent {
    pub fn to_compact_json_line(&self) -> String {
        let mut out = format!("{{\"t\":{},\"r\":", self.timestamp_ms);
        escape_json_str(&self.project_root, &mut out);
        if !self.project_name.is_empty() {
            out.push_str(",\"p\":");
            escape_json_str(&self.project_name, &mut out);
        }
        out.push_str(",\"f\":");
        escape_json_str(&self.file_path, &mut out);
        if !self.multi_files.is_empty() {
            out.push_str(",\"mf\":[");
            for (i, mf) in self.multi_files.iter().take(16).enumerate() {
                if i > 0 {
                    out.push(',');
                }
                escape_json_str(mf, &mut out);
            }
            out.push(']');
        }
        if !self.language.is_empty() {
            out.push_str(",\"l\":");
            escape_json_str(&self.language, &mut out);
        }
        out.push_str(",\"o\":");
        escape_json_str(&self.operation, &mut out);
        if self.surface != "cli" {
            out.push_str(",\"s\":");
            escape_json_str(&self.surface, &mut out);
        }
        if !self.agent.is_empty() {
            out.push_str(",\"a\":");
            escape_json_str(&self.agent, &mut out);
        }
        if self.is_search_mode {
            out.push_str(",\"sm\":1");
        }
        out.push_str(&format!(
            ",\"nc\":{},\"ac\":{},\"n1\":{},\"a1\":{},\"n2\":{},\"a2\":{}",
            self.native_chars,
            self.aice_chars,
            self.native_cl100k,
            self.aice_cl100k,
            self.native_o200k,
            self.aice_o200k
        ));
        if let Some(rn) = self.realistic_native_cl100k {
            out.push_str(&format!(",\"rn\":{rn}"));
        }
        if let Some(rs) = self.realistic_saved_cl100k {
            out.push_str(&format!(",\"rs\":{rs}"));
        }
        if self.preserved_trivia_tokens > 0 {
            out.push_str(&format!(",\"pt\":{}", self.preserved_trivia_tokens));
        }
        if let Some(wi) = self.wasted_input_tokens {
            out.push_str(&format!(",\"wi\":{wi}"));
        }
        if !self.content_hash.is_empty() {
            out.push_str(",\"h\":");
            escape_json_str(&self.content_hash, &mut out);
        }
        out.push('}');
        out
    }

    pub fn from_json_line(line: &str) -> Option<Self> {
        let val = parse_json(line.trim()).ok()?;
        let map = val.as_object()?;
        let ts_ms = match map.get("t").or_else(|| map.get("timestamp")) {
            Some(JsonValue::Number(n)) if *n >= 0.0 => *n as u64,
            Some(JsonValue::String(s)) => parse_iso_to_epoch_ms(s)?,
            _ => return None,
        };
        let project_root = str_field(map, &["r", "projectRoot"])?.to_string();
        let file_path = str_field(map, &["f", "filePath"])?.to_string();
        let operation = str_field(map, &["o", "operation"])?.to_string();
        let project_name = str_field(map, &["p", "projectName"])
            .map(str::to_string)
            .unwrap_or_else(|| {
                Path::new(&project_root)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("root")
                    .to_string()
            });
        let surface = str_field(map, &["s", "surface"]).unwrap_or("cli").to_string();
        let agent = str_field(map, &["a", "agent"]).unwrap_or(&surface).to_string();
        let language = str_field(map, &["l", "language"])
            .map(str::to_string)
            .unwrap_or_else(|| detect_language_name(&file_path).to_string());
        let nc = usize_field(map, &["nc", "nativeChars"])?;
        let ac = usize_field(map, &["ac", "aiceChars"])?;
        let n1 = usize_field(map, &["n1", "nativeCl100k"])?;
        let a1 = usize_field(map, &["a1", "aiceCl100k"])?;
        let n2 = usize_field(map, &["n2", "nativeO200k"])?;
        let a2 = usize_field(map, &["a2", "aiceO200k"])?;
        let raw_rn = opt_usize_field(map, &["rn", "realisticNativeCl100k"]);
        let rn = raw_rn.map(|v| v.min(n1));
        let rs = if raw_rn.is_some_and(|v| v > n1) {
            rn.map(|r| r as isize - a1 as isize)
        } else {
            opt_isize_field(map, &["rs", "realisticSavedCl100k"])
                .map(|s| match rn {
                    Some(r) => s.min(r as isize - a1 as isize),
                    None => s.min(n1 as isize - a1 as isize),
                })
                .or_else(|| rn.map(|r| r as isize - a1 as isize))
        };
        let is_write = matches!(str_field(map, &["c", "category"]), Some("write"))
            || matches!(operation.as_str(), "splice" | "create" | "patch");
        let multi_files = map
            .get("mf")
            .or_else(|| map.get("multiFiles"))
            .and_then(JsonValue::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(JsonValue::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        let is_search_mode = matches!(map.get("sm"), Some(JsonValue::Number(n)) if *n > 0.0)
            || matches!(map.get("isSearchMode"), Some(JsonValue::Bool(true)));

        Some(Self {
            timestamp_ms: ts_ms,
            timestamp: epoch_ms_to_iso(ts_ms),
            project_root,
            project_name,
            file_path,
            multi_files,
            language,
            operation,
            surface,
            agent,
            is_write,
            is_search_mode,
            native_chars: nc,
            aice_chars: ac,
            saved_chars: nc as isize - ac as isize,
            native_cl100k: n1,
            aice_cl100k: a1,
            saved_cl100k: n1 as isize - a1 as isize,
            native_o200k: n2,
            aice_o200k: a2,
            saved_o200k: n2 as isize - a2 as isize,
            realistic_native_cl100k: rn,
            realistic_saved_cl100k: rs,
            preserved_trivia_tokens: opt_usize_field(map, &["pt", "preservedTriviaTokens"])
                .unwrap_or(0),
            structural_compression_pct: map.get("sc").and_then(JsonValue::as_f64),
            wasted_input_tokens: opt_usize_field(map, &["wi", "wastedInputTokens"]),
            content_hash: str_field(map, &["h", "contentHash"])
                .unwrap_or("")
                .to_string(),
        })
    }
}

fn str_field<'a>(
    map: &'a std::collections::BTreeMap<String, JsonValue>,
    keys: &[&str],
) -> Option<&'a str> {
    keys.iter().find_map(|k| map.get(*k).and_then(JsonValue::as_str))
}

fn usize_field(
    map: &std::collections::BTreeMap<String, JsonValue>,
    keys: &[&str],
) -> Option<usize> {
    keys.iter()
        .find_map(|k| map.get(*k).and_then(JsonValue::as_u64).map(|v| v as usize))
}

fn opt_usize_field(
    map: &std::collections::BTreeMap<String, JsonValue>,
    keys: &[&str],
) -> Option<usize> {
    usize_field(map, keys)
}

fn opt_isize_field(
    map: &std::collections::BTreeMap<String, JsonValue>,
    keys: &[&str],
) -> Option<isize> {
    keys.iter()
        .find_map(|k| map.get(*k).and_then(JsonValue::as_i64).map(|v| v as isize))
}
