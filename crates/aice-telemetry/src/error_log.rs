use std::collections::BTreeMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

use aice_governance::{JsonValue, escape_json_str, find_project_root, parse_json};

use crate::env::{
    canonicalize_or_normalize, detect_caller_agent, is_ephemeral_path,
    is_ephemeral_workspace_with, is_explicit_project_path_query, resolve_errors_path_with,
    resolve_project_filter_target, std_env,
};
use crate::ledger::is_telemetry_suppressed;
use crate::time_hash::{current_epoch_ms, epoch_ms_to_iso, parse_iso_to_epoch_ms};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TelemetryErrorEvent {
    pub timestamp_ms: u64,
    pub project_root: String,
    pub project_name: String,
    pub file_path: String,
    pub operation: String,
    pub surface: String,
    pub agent: String,
    pub error_message: String,
    pub wasted_input_tokens: Option<usize>,
}

pub struct RecordTelemetryErrorInput<'a> {
    pub target_path: Option<&'a Path>,
    pub project_root: Option<&'a Path>,
    pub file_path: Option<&'a str>,
    pub operation: &'a str,
    pub surface: &'a str,
    pub agent: Option<&'a str>,
    pub error_message: &'a str,
    pub wasted_input_tokens: Option<usize>,
    pub explicit_telemetry_path: Option<&'a Path>,
}

impl TelemetryErrorEvent {
    pub fn to_json_line(&self) -> String {
        let mut out = String::from("{");
        out.push_str(&format!("\"timestamp\":{},\"projectRoot\":", self.timestamp_ms));
        escape_json_str(&self.project_root, &mut out);
        out.push_str(",\"projectName\":");
        escape_json_str(&self.project_name, &mut out);
        out.push_str(",\"filePath\":");
        escape_json_str(&self.file_path, &mut out);
        out.push_str(",\"operation\":");
        escape_json_str(&self.operation, &mut out);
        out.push_str(",\"surface\":");
        escape_json_str(&self.surface, &mut out);
        out.push_str(",\"agent\":");
        escape_json_str(&self.agent, &mut out);
        out.push_str(",\"errorMessage\":");
        let clipped: String = self.error_message.chars().take(1000).collect();
        escape_json_str(&clipped, &mut out);
        if let Some(wi) = self.wasted_input_tokens {
            out.push_str(&format!(",\"wastedInputTokens\":{wi}"));
        }
        out.push('}');
        out
    }

    pub fn timestamp_iso(&self) -> String {
        epoch_ms_to_iso(self.timestamp_ms)
    }

    pub fn from_json_line(line: &str) -> Option<Self> {
        let val = parse_json(line.trim()).ok()?;
        let map = val.as_object()?;
        let ts_ms = match map.get("timestamp").or_else(|| map.get("t")) {
            Some(JsonValue::Number(n)) if *n >= 0.0 => *n as u64,
            Some(JsonValue::String(s)) => parse_iso_to_epoch_ms(s).unwrap_or(0),
            _ => 0,
        };
        let operation = map.get("operation").and_then(JsonValue::as_str)?.to_string();
        let error_message = map.get("errorMessage").and_then(JsonValue::as_str)?.to_string();
        let project_root = map.get("projectRoot").and_then(JsonValue::as_str).unwrap_or("").to_string();
        let project_name = map
            .get("projectName")
            .and_then(JsonValue::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| {
                Path::new(&project_root)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("root")
                    .to_string()
            });
        Some(Self {
            timestamp_ms: ts_ms,
            project_root,
            project_name,
            file_path: map.get("filePath").and_then(JsonValue::as_str).unwrap_or("<stdin>").to_string(),
            operation,
            surface: map.get("surface").and_then(JsonValue::as_str).unwrap_or("cli").to_string(),
            agent: map.get("agent").and_then(JsonValue::as_str).unwrap_or("cli").to_string(),
            error_message,
            wasted_input_tokens: map.get("wastedInputTokens").and_then(JsonValue::as_u64).map(|v| v as usize),
        })
    }
}

pub fn resolve_errors_path() -> PathBuf {
    resolve_errors_path_with(None, &std_env)
}

pub fn append_error_event(event: &TelemetryErrorEvent) -> std::io::Result<PathBuf> {
    let path = resolve_errors_path();
    append_error_event_to(&path, event)?;
    Ok(path)
}

pub fn append_error_event_to(path: &Path, event: &TelemetryErrorEvent) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "{}", event.to_json_line())
}

pub fn record_error_event(input: &RecordTelemetryErrorInput<'_>) -> Option<TelemetryErrorEvent> {
    record_error_event_with(input, &std_env)
}

pub fn record_error_event_with(
    input: &RecordTelemetryErrorInput<'_>,
    env_fn: &dyn Fn(&str) -> Option<String>,
) -> Option<TelemetryErrorEvent> {
    if is_telemetry_suppressed() {
        return None;
    }
    let root = input
        .project_root
        .map(Path::to_path_buf)
        .or_else(|| input.target_path.map(find_project_root))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    if is_ephemeral_workspace_with(None, Some(&root), input.target_path, input.explicit_telemetry_path, env_fn) {
        return None;
    }
    let project_name = root.file_name().and_then(|n| n.to_str()).unwrap_or("root").to_string();
    let file_path = input.file_path.map(str::to_string).unwrap_or_else(|| {
        input
            .target_path
            .and_then(|p| p.strip_prefix(&root).ok().or(Some(p)))
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "<stdin>".to_string())
    });
    let event = TelemetryErrorEvent {
        timestamp_ms: current_epoch_ms(),
        project_root: root.display().to_string(),
        project_name,
        file_path,
        operation: input.operation.to_string(),
        surface: input.surface.to_string(),
        agent: input.agent.map(str::to_string).unwrap_or_else(|| detect_caller_agent(input.surface)),
        error_message: input.error_message.chars().take(1000).collect(),
        wasted_input_tokens: input.wasted_input_tokens.filter(|&w| w > 0),
    };
    let path = resolve_errors_path_with(input.explicit_telemetry_path, env_fn);
    append_error_event_to(&path, &event).ok()?;
    Some(event)
}

pub fn load_telemetry_errors(
    project_filter: Option<&str>,
    explicit_telemetry_path: Option<&Path>,
) -> Vec<TelemetryErrorEvent> {
    let err_path = resolve_errors_path_with(explicit_telemetry_path, &std_env);
    let Ok(raw) = std::fs::read_to_string(&err_path) else {
        return Vec::new();
    };
    let trimmed_filter = project_filter.map(str::trim).filter(|s| !s.is_empty());
    let is_path = trimmed_filter.is_some_and(is_explicit_project_path_query);
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let target_root = trimmed_filter
        .filter(|_| is_path)
        .map(|f| resolve_project_filter_target(Some(f), &cwd));
    let cand_norm = trimmed_filter.filter(|_| is_path).map(|f| {
        let p = Path::new(f);
        let abs = if p.is_absolute() { p.to_path_buf() } else { cwd.join(p) };
        canonicalize_or_normalize(&abs)
    });
    let mut out = Vec::new();
    for line in raw.lines() {
        let Some(ev) = TelemetryErrorEvent::from_json_line(line) else {
            continue;
        };
        if let Some(f) = trimmed_filter {
            if is_path {
                let ev_raw = Path::new(&ev.project_root);
                let ev_canon = (!ev.project_root.is_empty()).then(|| canonicalize_or_normalize(ev_raw));
                let matches = ev_raw == Path::new(f)
                    || target_root.as_deref() == Some(ev_raw)
                    || cand_norm.as_deref() == Some(ev_raw)
                    || (ev_canon.is_some()
                        && (ev_canon.as_deref() == target_root.as_deref()
                            || ev_canon.as_deref() == cand_norm.as_deref()));
                if !matches {
                    continue;
                }
            } else if !ev.project_name.eq_ignore_ascii_case(f)
                && Path::new(&ev.project_root)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_none_or(|b| !b.eq_ignore_ascii_case(f))
            {
                continue;
            }
        }
        out.push(ev);
    }
    out
}

pub fn load_non_benign_errors_by_project(
    ledger_path: &Path,
    drop_ephemeral: bool,
) -> BTreeMap<String, Vec<TelemetryErrorEvent>> {
    let mut by_root: BTreeMap<String, Vec<TelemetryErrorEvent>> = BTreeMap::new();
    let mut candidates = Vec::new();
    if let Some(env_err) = std_env("AICE_TELEMETRY_ERRORS_PATH") {
        candidates.push(PathBuf::from(env_err));
    }
    if let Some(parent) = ledger_path.parent() {
        candidates.push(parent.join("errors.jsonl"));
    }
    let mut seen = Vec::new();
    for cand in candidates {
        if seen.contains(&cand) || !cand.is_file() {
            continue;
        }
        seen.push(cand.clone());
        let Ok(raw) = std::fs::read_to_string(&cand) else {
            continue;
        };
        for line in raw.lines() {
            let Some(ev) = TelemetryErrorEvent::from_json_line(line) else {
                continue;
            };
            let lower = ev.error_message.to_ascii_lowercase();
            if lower.contains("benign") || lower.contains("warning") || lower.contains("notice") {
                continue;
            }
            if drop_ephemeral && !ev.project_root.is_empty() && is_ephemeral_path(Path::new(&ev.project_root)) {
                continue;
            }
            let key = if ev.project_root.is_empty() { "<unknown>".to_string() } else { ev.project_root.clone() };
            by_root.entry(key).or_default().push(ev);
        }
    }
    by_root
}

pub fn classify_friction_cause(error_text: &str) -> &'static str {
    let lower = error_text.to_ascii_lowercase();
    if lower.contains("delimiter") || lower.contains("half-open") || lower.contains("ambiguous") {
        "Line-range delimiter / boundary rejection"
    } else if lower.contains("symbol") && lower.contains("not found") {
        "Symbol not found (or header hijack)"
    } else if lower.contains("unsupported target") || lower.contains("unsupported language") {
        "Unsupported file extension"
    } else if lower.contains("malformed") && lower.contains("header") {
        "Malformed splice stream header / block"
    } else if lower.contains("unknown option") || lower.contains("unknown command") {
        "CLI unknown option / subcommand"
    } else if lower.contains("json") || lower.contains("yaml") {
        "Dialect hunk / JSON-YAML parse error"
    } else if lower.contains("syntax") || lower.contains("indentation") || lower.contains("unterminated") {
        "Syntax / indentation validation error"
    } else if lower.contains("invalid line range") {
        "Invalid line range"
    } else {
        "AICE execution / tool error"
    }
}
