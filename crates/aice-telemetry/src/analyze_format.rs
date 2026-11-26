use std::fmt::Write as _;

use crate::analyze::ProjectAnalyzeReport;

pub fn format_analyze_report(r: &ProjectAnalyzeReport) -> String {
    let mut out = String::new();
    let _ = writeln!(
        out,
        "=== AICE Project Analyze: {} ({}) ===",
        r.project_name, r.project_root
    );
    let _ = writeln!(
        out,
        "Workspace: {} files, {} lines, {} bytes | Config: enabled={}",
        r.workspace_stats.file_count,
        r.workspace_stats.total_lines,
        r.workspace_stats.total_bytes,
        r.enabled
    );
    let _ = writeln!(
        out,
        "BPE Calls: {} (read={}, write={}) | cl100k saved={} ({:.1}%) | o200k saved={} ({:.1}%)",
        r.total_calls,
        r.read_calls,
        r.write_calls,
        r.saved_cl100k,
        r.cl100k_savings_pct,
        r.saved_o200k,
        r.o200k_savings_pct
    );
    let e = &r.end_to_end_economics;
    let _ = writeln!(
        out,
        "End-to-End: payloadSaved={} | tax={} | net={} | cwNet={} | verdict={}",
        e.realistic_payload_saved_tokens,
        e.total_systemic_tax_tokens,
        e.net_end_to_end_tokens,
        e.cost_weighted_net_tokens,
        e.verdict
    );
    let _ = writeln!(
        out,
        "Sessions: {} | Telemetry errors: {} | Transcript errors: {}",
        r.sessions.len(),
        r.telemetry_errors.len(),
        r.transcript_errors.len()
    );
    if !r.top_causes.is_empty() {
        let _ = writeln!(out, "Top Friction Causes:");
        for c in r.top_causes.iter().take(5) {
            let _ = writeln!(out, "  - {} ({}x): {}", c.cause, c.count, c.sample);
        }
    }
    out
}
