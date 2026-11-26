use std::fmt::Write as _;

use crate::economics::CommandHonestBucket;
use crate::gain_report::{FullGainReport, ProjectDetailReport};

pub fn format_honest_command_table(rows: &[CommandHonestBucket]) -> String {
    let mut out = String::new();
    let _ = writeln!(
        out,
        "  {:<14} {:>6} {:>7} {:>7} {:>10} {:>10} {:>10}",
        "Command", "Calls", "Win%", "Err%", "Native", "AICE", "NetDelta"
    );
    let _ = writeln!(out, "  {}", "-".repeat(72));
    for r in rows {
        let sign = if r.net_delta_cl100k > 0 { "+" } else { "" };
        let _ = writeln!(
            out,
            "  {:<14} {:>6} {:>6.1}% {:>6.1}% {:>10} {:>10} {:>10}",
            r.command.as_str(),
            r.calls,
            r.win_pct,
            r.err_pct,
            r.realistic_native_cl100k,
            r.aice_cl100k,
            format!("{sign}{}", r.net_delta_cl100k),
        );
    }
    out
}

pub fn format_global_gain_dashboard(report: &FullGainReport) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "=== AICE Honest BPE Telemetry ({}) ===", report.telemetry_path.display());
    let _ = writeln!(
        out,
        "Operations: {} (read={}, write={}, overhead={}, repeatRead={})",
        report.total_operations,
        report.read_operations,
        report.write_operations,
        report.overhead_operations,
        report.repeat_read_calls
    );
    let _ = writeln!(
        out,
        "cl100k_base: native={} | aice={} | saved={} ({:.1}%)",
        report.native_cl100k, report.aice_cl100k, report.saved_cl100k, report.cl100k_savings_pct
    );
    let _ = writeln!(
        out,
        "o200k_base:  native={} | aice={} | saved={} ({:.1}%)",
        report.native_o200k, report.aice_o200k, report.saved_o200k, report.o200k_savings_pct
    );
    let _ = writeln!(
        out,
        "Systemic Net E2E: {} tokens | Cost-Weighted: {} | Verdict: {}",
        report.economics.net_end_to_end_saved_cl100k,
        report.economics.cost_weighted_net_delta_cl100k,
        report.economics.end_to_end_verdict
    );
    out.push_str(&format_honest_command_table(&report.economics.by_command));
    out
}

pub fn format_project_gain_detail(detail: &ProjectDetailReport) -> String {
    let mut out = String::new();
    let _ = writeln!(
        out,
        "=== AICE Project Telemetry: {} ({}) ===",
        detail.project_name, detail.project_root
    );
    let _ = writeln!(
        out,
        "Config: enabled={}",
        detail.enabled
    );
    let s = &detail.summary;
    let _ = writeln!(
        out,
        "Calls: {} (read={}, write={}, overhead={}, repeatRead={})",
        s.calls, s.read_calls, s.write_calls, s.overhead_calls, s.repeat_read_calls
    );
    let _ = writeln!(
        out,
        "cl100k_base: native={} | aice={} | saved={} ({:.1}%) | Verdict: {}",
        s.native_cl100k, s.aice_cl100k, s.saved_cl100k, s.savings_pct, s.economics.end_to_end_verdict
    );
    out.push_str(&format_honest_command_table(&s.economics.by_command));
    out
}
