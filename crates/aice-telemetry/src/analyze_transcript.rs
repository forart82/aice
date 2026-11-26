use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use aice_governance::{JsonValue, parse_json};

use crate::env::std_env;
use crate::error_log::classify_friction_cause;

const MAX_TRANSCRIPT_FILES: usize = 512;
const MAX_TRANSCRIPT_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_TRANSCRIPT_LINE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranscriptErrorSample {
    pub conversation_id: String,
    pub step: usize,
    pub snippet: String,
    pub cause: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnalyzedSessionSummary {
    pub conversation_id: String,
    pub source: &'static str,
    pub workspace: String,
    pub total_steps: usize,
    pub llm_turns: usize,
    pub tool_calls_total: usize,
    pub aice_subcommands: BTreeMap<String, usize>,
    pub native_file_bypasses: BTreeMap<String, usize>,
    pub errors: Vec<TranscriptErrorSample>,
    pub read_turns: usize,
    pub max_consecutive_read_streak: usize,
    pub extra_read_turns: usize,
}

pub fn discover_transcript_files(explicit_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(d) = explicit_dir {
        dirs.push(d.to_path_buf());
    } else if let Some(env_d) = std_env("AICE_TRANSCRIPTS_DIR") {
        dirs.push(PathBuf::from(env_d));
    } else if let Some(home) = std_env("HOME") {
        let h = PathBuf::from(home);
        dirs.push(h.join(".gemini/antigravity/conversations"));
        dirs.push(h.join(".claude/projects"));
        dirs.push(h.join(".codex/sessions"));
    }
    let mut files = Vec::new();
    for dir in dirs {
        if dir.is_dir() {
            collect_jsonl(&dir, 0, &mut files);
        }
    }
    files
}

fn collect_jsonl(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > 3 || out.len() >= MAX_TRANSCRIPT_FILES {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= MAX_TRANSCRIPT_FILES {
            break;
        }
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        let p = entry.path();
        if ft.is_dir() {
            collect_jsonl(&p, depth + 1, out);
        } else if (ft.is_file() || p.is_file())
            && p.extension().and_then(|e| e.to_str()) == Some("jsonl")
        {
            out.push(p);
        }
    }
}

fn bytes_contains(haystack: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty() && haystack.windows(needle.len()).any(|w| w == needle)
}

fn read_bounded_transcript(path: &Path) -> Option<Vec<u8>> {
    let file = std::fs::File::open(path).ok()?;
    let meta = file.metadata().ok()?;
    if meta.len() > MAX_TRANSCRIPT_FILE_BYTES {
        return None;
    }
    let mut raw = Vec::with_capacity(meta.len().min(64 * 1024) as usize);
    let mut limited = file.take(MAX_TRANSCRIPT_FILE_BYTES + 1);
    limited.read_to_end(&mut raw).ok()?;
    if raw.len() as u64 > MAX_TRANSCRIPT_FILE_BYTES {
        return None;
    }
    Some(raw)
}

fn normalize_path_str(raw: &str) -> String {
    let replaced = raw.trim().replace('\\', "/");
    let trimmed = replaced.trim_end_matches('/');
    if trimmed.is_empty() && replaced.starts_with('/') {
        "/".to_string()
    } else {
        trimmed.to_string()
    }
}

fn workspace_matches_root(ws: &str, norm_root: &str, project_root: &Path) -> bool {
    let norm_ws = normalize_path_str(ws);
    if norm_ws.is_empty() || norm_root.is_empty() {
        return false;
    }
    if norm_ws == norm_root {
        return true;
    }
    if norm_root == "/" {
        return norm_ws.starts_with('/');
    }
    if norm_ws.starts_with(norm_root)
        && norm_ws.as_bytes().get(norm_root.len()) == Some(&b'/')
    {
        return true;
    }
    Path::new(ws).starts_with(project_root)
}

pub fn parse_transcript_sessions(
    files: &[PathBuf],
    project_root: &Path,
) -> Vec<AnalyzedSessionSummary> {
    let root_str = project_root.display().to_string();
    let norm_root = normalize_path_str(&root_str);
    let prefilter = project_root
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|b| !b.is_empty() && b.is_ascii() && !b.contains(['"', '\\']));
    let mut sessions = Vec::new();
    for path in files {
        let Some(raw) = read_bounded_transcript(path) else {
            continue;
        };
        if let Some(needle) = prefilter
            && !bytes_contains(&raw, needle.as_bytes())
        {
            continue;
        }
        let conv_id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("session")
            .to_string();
        let mut s = AnalyzedSessionSummary {
            conversation_id: conv_id.clone(),
            source: "transcript",
            workspace: root_str.clone(),
            total_steps: 0,
            llm_turns: 0,
            tool_calls_total: 0,
            aice_subcommands: BTreeMap::new(),
            native_file_bypasses: BTreeMap::new(),
            errors: Vec::new(),
            read_turns: 0,
            max_consecutive_read_streak: 0,
            extra_read_turns: 0,
        };
        let mut matched_workspace = false;
        let mut cur_read_streak = 0usize;

        for line_bytes in raw.split(|&b| b == b'\n') {
            if line_bytes.len() > MAX_TRANSCRIPT_LINE_BYTES {
                continue;
            }
            let Ok(line) = std::str::from_utf8(line_bytes) else {
                continue;
            };
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(val) = parse_json(trimmed) else {
                continue;
            };
            let Some(obj) = val.as_object() else {
                continue;
            };
            s.total_steps += 1;
            if let Some(ws) = obj.get("workspace").or_else(|| obj.get("cwd")).and_then(JsonValue::as_str)
                && workspace_matches_root(ws, &norm_root, project_root)
            {
                matched_workspace = true;
            }
            if obj.get("role").and_then(JsonValue::as_str) == Some("assistant") {
                s.llm_turns += 1;
            }
            if let Some(tool) = obj.get("tool").or_else(|| obj.get("name")).and_then(JsonValue::as_str) {
                s.tool_calls_total += 1;
                if tool.starts_with("aice_") || tool.starts_with("aice ") {
                    *s.aice_subcommands.entry(tool.to_string()).or_insert(0) += 1;
                    if tool.contains("read") || tool.contains("search") || tool.contains("find") {
                        s.read_turns += 1;
                        cur_read_streak += 1;
                        if cur_read_streak > 1 {
                            s.extra_read_turns += 1;
                        }
                        s.max_consecutive_read_streak = s.max_consecutive_read_streak.max(cur_read_streak);
                    } else {
                        cur_read_streak = 0;
                    }
                } else if matches!(tool, "read_file" | "view_file" | "cat" | "grep" | "rg") {
                    *s.native_file_bypasses.entry(tool.to_string()).or_insert(0) += 1;
                    s.read_turns += 1;
                    cur_read_streak += 1;
                    s.max_consecutive_read_streak = s.max_consecutive_read_streak.max(cur_read_streak);
                } else {
                    cur_read_streak = 0;
                }
            }
            if let Some(err) = obj.get("error").and_then(JsonValue::as_str)
                && !err.trim().is_empty()
            {
                s.errors.push(TranscriptErrorSample {
                    conversation_id: conv_id.clone(),
                    step: s.total_steps,
                    snippet: err.chars().take(240).collect(),
                    cause: classify_friction_cause(err).to_string(),
                });
            }
        }
        if matched_workspace {
            sessions.push(s);
        }
    }
    sessions
}
