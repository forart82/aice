use std::cell::Cell;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use aice_governance::escape_json_str;

pub use crate::env::resolve_gains_path_with;
use crate::env::{
    is_ephemeral_path, is_ephemeral_workspace_with, resolve_errors_path_with, std_env,
};
use crate::record::TelemetryEvent;

const MAX_READ_BYTES: u64 = 20 * 1024 * 1024;

thread_local! {
    static SUPPRESSION_DEPTH: Cell<usize> = const { Cell::new(0) };
}

struct SuppressionGuard;
impl Drop for SuppressionGuard {
    fn drop(&mut self) {
        SUPPRESSION_DEPTH.with(|d| d.set(d.get().saturating_sub(1)));
    }
}

pub fn with_suppressed_telemetry<F, R>(f: F) -> R
where
    F: FnOnce() -> R,
{
    SUPPRESSION_DEPTH.with(|d| d.set(d.get() + 1));
    let _guard = SuppressionGuard;
    f()
}

pub fn is_telemetry_suppressed() -> bool {
    SUPPRESSION_DEPTH.with(|d| d.get() > 0)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompactTelemetryRecord {
    pub timestamp_ms: u64,
    pub project_root: String,
    pub file_path: String,
    pub operation: String,
    pub surface: String,
    pub native_chars: usize,
    pub aice_chars: usize,
    pub native_cl100k: usize,
    pub aice_cl100k: usize,
    pub native_o200k: usize,
    pub aice_o200k: usize,
}

impl CompactTelemetryRecord {
    pub fn to_json_line(&self) -> String {
        let mut out = String::from("{");
        out.push_str(&format!("\"t\":{},\"r\":", self.timestamp_ms));
        escape_json_str(&self.project_root, &mut out);
        out.push_str(",\"f\":");
        escape_json_str(&self.file_path, &mut out);
        out.push_str(",\"o\":");
        escape_json_str(&self.operation, &mut out);
        if self.surface != "cli" {
            out.push_str(",\"s\":");
            escape_json_str(&self.surface, &mut out);
        }
        out.push_str(&format!(
            ",\"nc\":{},\"ac\":{},\"n1\":{},\"a1\":{},\"n2\":{},\"a2\":{}}}",
            self.native_chars,
            self.aice_chars,
            self.native_cl100k,
            self.aice_cl100k,
            self.native_o200k,
            self.aice_o200k
        ));
        out
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompactionResult {
    pub telemetry_path: PathBuf,
    pub total_lines: usize,
    pub kept_rows: usize,
    pub dropped_ephemeral: usize,
    pub dropped_invalid: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResetResult {
    pub telemetry_path: PathBuf,
    pub errors_path: PathBuf,
    pub removed_gains: bool,
    pub removed_errors: bool,
}

pub fn resolve_gains_path() -> PathBuf {
    resolve_gains_path_with(None, &std_env)
}

pub fn should_exclude_from_global_ledger(project_root: &Path) -> bool {
    should_exclude_from_global_ledger_with(project_root, None, &std_env)
}

pub fn should_exclude_from_global_ledger_with(
    project_root: &Path,
    explicit_telemetry: Option<&Path>,
    env_fn: &dyn Fn(&str) -> Option<String>,
) -> bool {
    is_ephemeral_workspace_with(None, Some(project_root), None, explicit_telemetry, env_fn)
}

pub(crate) fn append_jsonl_line(path: &Path, mut json_line: String) -> std::io::Result<()> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent)?;
    }
    json_line.push('\n');
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    let locked = loop {
        match file.lock() {
            Ok(()) => break true,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) if e.kind() == std::io::ErrorKind::Unsupported => break false,
            Err(e) => return Err(e),
        }
    };
    let write_res = file.write_all(json_line.as_bytes());
    if locked {
        let _ = file.unlock();
    }
    write_res
}

pub fn append_record(record: &CompactTelemetryRecord) -> std::io::Result<PathBuf> {
    let path = resolve_gains_path();
    append_jsonl_line(&path, record.to_json_line())?;
    Ok(path)
}

pub fn append_event(path: &Path, event: &TelemetryEvent) -> std::io::Result<()> {
    append_jsonl_line(path, event.to_compact_json_line())
}

pub fn load_telemetry_events(ledger_path: &Path, drop_ephemeral: bool) -> Vec<TelemetryEvent> {
    let Ok(mut file) = File::open(ledger_path) else {
        return Vec::new();
    };
    let Ok(meta) = file.metadata() else {
        return Vec::new();
    };
    let len = meta.len();
    let truncated = len > MAX_READ_BYTES;
    if truncated && file.seek(SeekFrom::Start(len - MAX_READ_BYTES)).is_err() {
        return Vec::new();
    }
    let mut raw = Vec::new();
    if file.read_to_end(&mut raw).is_err() {
        return Vec::new();
    }
    let tail_bytes = if truncated {
        let Some(nl) = raw.iter().position(|&b| b == b'\n') else {
            return Vec::new();
        };
        &raw[nl + 1..]
    } else {
        raw.as_slice()
    };
    let mut events = Vec::new();
    for line_bytes in tail_bytes.split(|&b| b == b'\n') {
        let Ok(line) = std::str::from_utf8(line_bytes) else {
            continue;
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(ev) = TelemetryEvent::from_json_line(trimmed) {
            if drop_ephemeral && is_ephemeral_path(Path::new(&ev.project_root)) {
                continue;
            }
            events.push(ev);
        }
    }
    events
}

pub fn compact_telemetry_ledger(explicit_path: Option<&Path>) -> std::io::Result<CompactionResult> {
    let path = resolve_gains_path_with(explicit_path, &std_env);
    if !path.is_file() {
        return Ok(CompactionResult {
            telemetry_path: path,
            total_lines: 0,
            kept_rows: 0,
            dropped_ephemeral: 0,
            dropped_invalid: 0,
        });
    }
    let file = File::open(&path)?;
    let reader = BufReader::new(file);
    let tmp_path = path.with_extension(format!("jsonl.{}.tmp", std::process::id()));
    let mut out = File::create(&tmp_path)?;
    let (mut total_lines, mut kept_rows, mut dropped_ephemeral, mut dropped_invalid) = (0, 0, 0, 0);

    for line_res in reader.lines() {
        let line = line_res?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        total_lines += 1;
        match TelemetryEvent::from_json_line(trimmed) {
            Some(ev) if is_ephemeral_path(Path::new(&ev.project_root)) => dropped_ephemeral += 1,
            Some(ev) => {
                writeln!(out, "{}", ev.to_compact_json_line())?;
                kept_rows += 1;
            }
            None => dropped_invalid += 1,
        }
    }
    out.flush()?;
    drop(out);
    std::fs::rename(&tmp_path, &path)?;
    Ok(CompactionResult {
        telemetry_path: path,
        total_lines,
        kept_rows,
        dropped_ephemeral,
        dropped_invalid,
    })
}

pub fn reset_telemetry_history(explicit_path: Option<&Path>) -> std::io::Result<ResetResult> {
    let telemetry_path = resolve_gains_path_with(explicit_path, &std_env);
    let errors_path = resolve_errors_path_with(explicit_path, &std_env);
    let removed_gains = if telemetry_path.exists() {
        std::fs::remove_file(&telemetry_path)?;
        true
    } else {
        false
    };
    let removed_errors = if errors_path.exists() {
        std::fs::remove_file(&errors_path)?;
        true
    } else {
        false
    };
    Ok(ResetResult {
        telemetry_path,
        errors_path,
        removed_gains,
        removed_errors,
    })
}
