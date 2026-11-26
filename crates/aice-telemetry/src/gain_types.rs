use std::path::PathBuf;

use crate::economics::ProjectSystemicEconomics;
use crate::record::TelemetryEvent;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GainReport {
    pub telemetry_path: PathBuf,
    pub total_operations: usize,
    pub native_chars: usize,
    pub aice_chars: usize,
    pub native_cl100k: usize,
    pub aice_cl100k: usize,
    pub saved_cl100k: isize,
    pub native_o200k: usize,
    pub aice_o200k: usize,
    pub saved_o200k: isize,
    pub end_to_end_verdict: &'static str,
}

#[derive(Debug, Clone, Default)]
pub struct GainQuery {
    pub project: Option<String>,
    pub unique: bool,
    pub telemetry_path: Option<PathBuf>,
    pub drop_ephemeral: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct OperationBucket {
    pub operation: String,
    pub surface: String,
    pub calls: usize,
    pub native_chars: usize,
    pub aice_chars: usize,
    pub saved_chars: isize,
    pub native_cl100k: usize,
    pub aice_cl100k: usize,
    pub saved_cl100k: isize,
    pub savings_pct: f64,
    pub realistic_native_cl100k: usize,
    pub realistic_saved_cl100k: isize,
    pub realistic_savings_pct: f64,
    pub native_o200k: usize,
    pub aice_o200k: usize,
    pub saved_o200k: isize,
    pub o200k_savings_pct: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LanguageBucket {
    pub language: String,
    pub calls: usize,
    pub native_cl100k: usize,
    pub aice_cl100k: usize,
    pub saved_cl100k: isize,
    pub savings_pct: f64,
    pub realistic_native_cl100k: usize,
    pub realistic_saved_cl100k: isize,
    pub realistic_savings_pct: f64,
    pub native_o200k: usize,
    pub aice_o200k: usize,
    pub saved_o200k: isize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProjectGainSummary {
    pub project_root: String,
    pub project_name: String,
    pub calls: usize,
    pub read_calls: usize,
    pub write_calls: usize,
    pub overhead_calls: usize,
    pub repeat_read_calls: usize,
    pub native_chars: usize,
    pub aice_chars: usize,
    pub saved_chars: isize,
    pub native_cl100k: usize,
    pub aice_cl100k: usize,
    pub saved_cl100k: isize,
    pub savings_pct: f64,
    pub native_o200k: usize,
    pub aice_o200k: usize,
    pub saved_o200k: isize,
    pub o200k_savings_pct: f64,
    pub economics: ProjectSystemicEconomics,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FileGainBucket {
    pub file_path: String,
    pub language: String,
    pub calls: usize,
    pub repeat_read_calls: usize,
    pub native_cl100k: usize,
    pub aice_cl100k: usize,
    pub saved_cl100k: isize,
    pub savings_pct: f64,
    pub realistic_native_cl100k: usize,
    pub realistic_saved_cl100k: isize,
    pub realistic_savings_pct: f64,
    pub native_o200k: usize,
    pub aice_o200k: usize,
    pub saved_o200k: isize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProjectDetailReport {
    pub project_root: String,
    pub project_name: String,
    pub enabled: bool,
    pub summary: ProjectGainSummary,
    pub by_operation: Vec<OperationBucket>,
    pub top_files: Vec<FileGainBucket>,
    pub recent_operations: Vec<TelemetryEvent>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FullGainReport {
    pub telemetry_path: PathBuf,
    pub unique: bool,
    pub total_operations: usize,
    pub read_operations: usize,
    pub write_operations: usize,
    pub overhead_operations: usize,
    pub repeat_read_calls: usize,
    pub native_chars: usize,
    pub aice_chars: usize,
    pub saved_chars: isize,
    pub char_savings_pct: f64,
    pub native_cl100k: usize,
    pub aice_cl100k: usize,
    pub saved_cl100k: isize,
    pub cl100k_savings_pct: f64,
    pub native_o200k: usize,
    pub aice_o200k: usize,
    pub saved_o200k: isize,
    pub o200k_savings_pct: f64,
    pub rule_budget_cl100k: usize,
    pub net_after_rule_budget_cl100k: isize,
    pub rule_break_even_multiple: f64,
    pub rule_break_even_reached: bool,
    pub total_realistic_native_cl100k: usize,
    pub total_realistic_saved_cl100k: isize,
    pub realistic_saved_cl100k_pct: f64,
    pub total_preserved_trivia_tokens: usize,
    pub economics: ProjectSystemicEconomics,
    pub by_operation: Vec<OperationBucket>,
    pub by_language: Vec<LanguageBucket>,
    pub projects: Vec<ProjectGainSummary>,
    pub project_detail: Option<ProjectDetailReport>,
}
