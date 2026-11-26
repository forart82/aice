use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use aice_governance::{escape_json_str, load_config};

use crate::analyze_transcript::{
    AnalyzedSessionSummary, TranscriptErrorSample, discover_transcript_files,
    parse_transcript_sessions,
};
use crate::bpe::count_lines;
use crate::economics::calc_pct;
use crate::env::resolve_project_filter_target;
use crate::error_log::{TelemetryErrorEvent, classify_friction_cause, load_telemetry_errors};
use crate::gain_report::{GainQuery, build_gain_report};
use crate::record::detect_language_name;
use crate::time_hash::{current_epoch_ms, epoch_ms_to_iso};

#[derive(Debug, Clone, Default)]
pub struct AnalyzeOptions {
    pub project: Option<String>,
    pub telemetry_path: Option<PathBuf>,
    pub transcripts_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WorkspaceStats {
    pub exists: bool,
    pub file_count: usize,
    pub total_lines: usize,
    pub total_bytes: usize,
    pub languages: BTreeMap<String, usize>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FrictionCauseEntry {
    pub cause: String,
    pub count: usize,
    pub sample: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EndToEndEconomicsReport {
    pub realistic_payload_saved_tokens: isize,
    pub wrapper_tax_tokens: usize,
    pub rule_replay_tax_tokens: usize,
    pub mcp_schema_tax_tokens: usize,
    pub sequential_pagination_turns: usize,
    pub pagination_replay_tax_tokens: usize,
    pub failed_retry_turns: usize,
    pub wasted_retry_output_tokens: usize,
    pub failed_retry_output_penalty_4x_tokens: usize,
    pub retry_replay_tax_tokens: usize,
    pub total_systemic_tax_tokens: usize,
    pub net_end_to_end_tokens: isize,
    pub cost_weighted_net_tokens: isize,
    pub splice_error_rate_pct: f64,
    pub verdict: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProjectAnalyzeReport {
    pub captured_at: String,
    pub project_root: String,
    pub project_name: String,
    pub enabled: bool,
    pub workspace_stats: WorkspaceStats,
    pub total_calls: usize,
    pub read_calls: usize,
    pub write_calls: usize,
    pub native_cl100k: usize,
    pub aice_cl100k: usize,
    pub saved_cl100k: isize,
    pub cl100k_savings_pct: f64,
    pub native_o200k: usize,
    pub aice_o200k: usize,
    pub saved_o200k: isize,
    pub o200k_savings_pct: f64,
    pub telemetry_errors: Vec<TelemetryErrorEvent>,
    pub transcript_errors: Vec<TranscriptErrorSample>,
    pub top_causes: Vec<FrictionCauseEntry>,
    pub sessions: Vec<AnalyzedSessionSummary>,
    pub end_to_end_economics: EndToEndEconomicsReport,
}

pub fn inspect_workspace_files(project_root: &Path) -> WorkspaceStats {
    if !project_root.is_dir() {
        return WorkspaceStats::default();
    }
    let mut stats = WorkspaceStats { exists: true, ..Default::default() };
    walk_workspace(project_root, 0, &mut stats);
    stats
}

fn walk_workspace(dir: &Path, depth: usize, stats: &mut WorkspaceStats) {
    if depth > 8 || stats.file_count >= 5000 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if matches!(name.as_str(), ".git" | "node_modules" | "target" | ".aice-build" | ".aice-cache") {
            continue;
        }
        if p.is_dir() {
            walk_workspace(&p, depth + 1, stats);
        } else if p.is_file() {
            stats.file_count += 1;
            let meta_len = p.metadata().map(|m| m.len() as usize).unwrap_or(0);
            stats.total_bytes += meta_len;
            if meta_len <= 512 * 1024
                && let Ok(text) = std::fs::read_to_string(&p)
            {
                stats.total_lines += count_lines(&text);
            }
            let lang = detect_language_name(&name).to_string();
            *stats.languages.entry(lang).or_insert(0) += 1;
        }
    }
}

pub fn analyze_project(opts: &AnalyzeOptions) -> ProjectAnalyzeReport {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let project_root = resolve_project_filter_target(opts.project.as_deref(), &cwd);
    let project_name = project_root
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("root")
        .to_string();
    let cfg = if project_root.exists() { load_config(&project_root) } else { Default::default() };
    let workspace_stats = inspect_workspace_files(&project_root);

    let gain = build_gain_report(&GainQuery {
        project: Some(project_root.display().to_string()),
        unique: false,
        telemetry_path: opts.telemetry_path.clone(),
        drop_ephemeral: false,
    });
    let telemetry_errors = load_telemetry_errors(
        Some(&project_root.display().to_string()),
        opts.telemetry_path.as_deref(),
    );
    let transcript_files = discover_transcript_files(opts.transcripts_dir.as_deref());
    let sessions = parse_transcript_sessions(&transcript_files, &project_root);
    let transcript_errors: Vec<TranscriptErrorSample> =
        sessions.iter().flat_map(|s| s.errors.iter().cloned()).collect();

    let mut cause_map: BTreeMap<String, (usize, String)> = BTreeMap::new();
    for err in &telemetry_errors {
        let c = classify_friction_cause(&err.error_message).to_string();
        let entry = cause_map.entry(c).or_insert_with(|| (0, err.error_message.clone()));
        entry.0 += 1;
    }
    for terr in &transcript_errors {
        let entry = cause_map.entry(terr.cause.clone()).or_insert_with(|| (0, terr.snippet.clone()));
        entry.0 += 1;
    }
    let mut top_causes: Vec<FrictionCauseEntry> = cause_map
        .into_iter()
        .map(|(cause, (count, sample))| FrictionCauseEntry { cause, count, sample })
        .collect();
    top_causes.sort_by_key(|a| std::cmp::Reverse(a.count));

    let e = &gain.economics;
    let end_to_end_economics = EndToEndEconomicsReport {
        realistic_payload_saved_tokens: e.realistic_saved_cl100k,
        wrapper_tax_tokens: e.wrapper_tax_cl100k,
        rule_replay_tax_tokens: e.rule_replay_tax_cl100k,
        mcp_schema_tax_tokens: e.mcp_schema_tax_cl100k,
        sequential_pagination_turns: e.sequential_pagination_turns,
        pagination_replay_tax_tokens: e.pagination_replay_tax_cl100k,
        failed_retry_turns: e.failed_retry_turns,
        wasted_retry_output_tokens: e.wasted_retry_output_tokens_cl100k,
        failed_retry_output_penalty_4x_tokens: e.failed_retry_output_penalty_4x_cl100k,
        retry_replay_tax_tokens: e.retry_replay_tax_cl100k,
        total_systemic_tax_tokens: e.total_systemic_tax_cl100k,
        net_end_to_end_tokens: e.net_end_to_end_saved_cl100k,
        cost_weighted_net_tokens: e.cost_weighted_net_delta_cl100k,
        splice_error_rate_pct: e.splice_error_rate_pct,
        verdict: e.end_to_end_verdict,
    };

    ProjectAnalyzeReport {
        captured_at: epoch_ms_to_iso(current_epoch_ms()),
        project_root: project_root.display().to_string(),
        project_name,
        enabled: cfg.enabled,
        workspace_stats,
        total_calls: gain.total_operations,
        read_calls: gain.read_operations,
        write_calls: gain.write_operations,
        native_cl100k: gain.native_cl100k,
        aice_cl100k: gain.aice_cl100k,
        saved_cl100k: gain.saved_cl100k,
        cl100k_savings_pct: gain.cl100k_savings_pct,
        native_o200k: gain.native_o200k,
        aice_o200k: gain.aice_o200k,
        saved_o200k: gain.saved_o200k,
        o200k_savings_pct: gain.o200k_savings_pct,
        telemetry_errors,
        transcript_errors,
        top_causes,
        sessions,
        end_to_end_economics,
    }
}

pub fn analyze_report_to_json(r: &ProjectAnalyzeReport) -> String {
    let mut out = String::from("{\n  \"capturedAt\": ");
    escape_json_str(&r.captured_at, &mut out);
    out.push_str(",\n  \"projectRoot\": ");
    escape_json_str(&r.project_root, &mut out);
    out.push_str(",\n  \"projectName\": ");
    escape_json_str(&r.project_name, &mut out);
    let _ = writeln!(
        out,
        ",\n  \"configStatus\": {{\n    \"enabled\": {}\n  }},",
        r.enabled
    );
    let _ = writeln!(
        out,
        "  \"workspaceStats\": {{\n    \"exists\": {},\n    \"fileCount\": {},\n    \"totalLines\": {},\n    \"totalBytes\": {}\n  }},",
        r.workspace_stats.exists, r.workspace_stats.file_count, r.workspace_stats.total_lines, r.workspace_stats.total_bytes
    );
    let _ = writeln!(
        out,
        "  \"bpeSavings\": {{\n    \"totalCalls\": {},\n    \"readCalls\": {},\n    \"writeCalls\": {},\n    \"nativeCl100k\": {},\n    \"aiceCl100k\": {},\n    \"savedCl100k\": {},\n    \"cl100kSavingsPct\": {},\n    \"nativeO200k\": {},\n    \"aiceO200k\": {},\n    \"savedO200k\": {},\n    \"o200kSavingsPct\": {}\n  }},",
        r.total_calls, r.read_calls, r.write_calls, r.native_cl100k, r.aice_cl100k, r.saved_cl100k,
        calc_pct(r.saved_cl100k, r.native_cl100k), r.native_o200k, r.aice_o200k, r.saved_o200k,
        calc_pct(r.saved_o200k, r.native_o200k)
    );
    let e = &r.end_to_end_economics;
    let _ = writeln!(
        out,
        "  \"frictionAudit\": {{\n    \"totalErrors\": {},\n    \"telemetryErrorsCount\": {},\n    \"transcriptErrorsCount\": {}\n  }},",
        r.telemetry_errors.len() + r.transcript_errors.len(),
        r.telemetry_errors.len(),
        r.transcript_errors.len()
    );
    let _ = writeln!(out, "  \"sessionCount\": {},", r.sessions.len());
    out.push_str("  \"endToEndEconomics\": {\n");
    let _ = writeln!(out, "    \"realisticPayloadSavedTokens\": {},", e.realistic_payload_saved_tokens);
    let _ = writeln!(out, "    \"totalSystemicTaxTokens\": {},", e.total_systemic_tax_tokens);
    let _ = writeln!(out, "    \"netEndToEndTokens\": {},", e.net_end_to_end_tokens);
    let _ = writeln!(out, "    \"costWeightedNetTokens\": {},", e.cost_weighted_net_tokens);
    let _ = writeln!(out, "    \"spliceErrorRatePct\": {},", e.splice_error_rate_pct);
    out.push_str("    \"verdict\": ");
    escape_json_str(e.verdict, &mut out);
    out.push_str("\n  }\n}\n");
    out
}
