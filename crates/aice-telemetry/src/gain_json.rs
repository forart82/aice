use std::fmt::Write as _;

use aice_governance::escape_json_str;

use crate::economics::{CommandHonestBucket, ProjectSystemicEconomics, calc_pct};
use crate::gain_report::{
    FullGainReport, LanguageBucket, OperationBucket, ProjectDetailReport, ProjectGainSummary,
};
use crate::ledger::{CompactionResult, ResetResult};

pub fn gain_report_to_json(report: &FullGainReport) -> String {
    let mut out = String::from("{\n  \"telemetryPath\": ");
    escape_json_str(&report.telemetry_path.display().to_string(), &mut out);
    let _ = writeln!(out, ",\n  \"unique\": {},", report.unique);
    let _ = writeln!(out, "  \"totalOperations\": {},", report.total_operations);
    let _ = writeln!(out, "  \"readOperations\": {},", report.read_operations);
    let _ = writeln!(out, "  \"writeOperations\": {},", report.write_operations);
    let _ = writeln!(out, "  \"overheadOperations\": {},", report.overhead_operations);
    let _ = writeln!(out, "  \"overheadCalls\": {},", report.overhead_operations);
    let _ = writeln!(out, "  \"repeatReadCalls\": {},", report.repeat_read_calls);
    let _ = writeln!(out, "  \"nativeChars\": {},", report.native_chars);
    let _ = writeln!(out, "  \"aiceChars\": {},", report.aice_chars);
    let _ = writeln!(out, "  \"savedChars\": {},", report.saved_chars);
    let _ = writeln!(out, "  \"charSavingsPct\": {},", fmt_num(report.char_savings_pct));
    let _ = writeln!(out, "  \"nativeCl100k\": {},", report.native_cl100k);
    let _ = writeln!(out, "  \"aiceCl100k\": {},", report.aice_cl100k);
    let _ = writeln!(out, "  \"savedCl100k\": {},", report.saved_cl100k);
    let _ = writeln!(out, "  \"cl100kSavingsPct\": {},", fmt_num(report.cl100k_savings_pct));
    let _ = writeln!(out, "  \"nativeO200k\": {},", report.native_o200k);
    let _ = writeln!(out, "  \"aiceO200k\": {},", report.aice_o200k);
    let _ = writeln!(out, "  \"savedO200k\": {},", report.saved_o200k);
    let _ = writeln!(out, "  \"o200kSavingsPct\": {},", fmt_num(report.o200k_savings_pct));
    let _ = writeln!(out, "  \"ruleBudgetCl100k\": {},", report.rule_budget_cl100k);
    let _ = writeln!(out, "  \"netAfterRuleBudgetCl100k\": {},", report.net_after_rule_budget_cl100k);
    let _ = writeln!(out, "  \"ruleBreakEvenMultiple\": {},", fmt_num(report.rule_break_even_multiple));
    let _ = writeln!(out, "  \"ruleBreakEvenReached\": {},", report.rule_break_even_reached);
    let _ = writeln!(out, "  \"totalRealisticNativeCl100k\": {},", report.total_realistic_native_cl100k);
    let _ = writeln!(out, "  \"totalRealisticSavedCl100k\": {},", report.total_realistic_saved_cl100k);
    let _ = writeln!(out, "  \"realisticSavedCl100kPct\": {},", fmt_num(report.realistic_saved_cl100k_pct));
    let _ = writeln!(out, "  \"totalPreservedTriviaTokens\": {},", report.total_preserved_trivia_tokens);
    write_econ_fields(&report.economics, "  ", &mut out);
    out.push_str(",\n  \"byCommand\": ");
    write_by_command(&report.economics.by_command, "  ", &mut out);
    out.push_str(",\n  \"byOperation\": ");
    write_by_operation(&report.by_operation, "  ", &mut out);
    out.push_str(",\n  \"byLanguage\": ");
    write_by_language(&report.by_language, "  ", &mut out);
    out.push_str(",\n  \"projects\": ");
    write_projects(&report.projects, "  ", &mut out);
    out.push_str("\n}\n");
    out
}

pub fn project_detail_to_json(telemetry_path: &std::path::Path, unique: bool, detail: &ProjectDetailReport) -> String {
    let mut out = String::from("{\n  \"unique\": ");
    let _ = writeln!(out, "{unique},");
    out.push_str("  \"telemetryPath\": ");
    escape_json_str(&telemetry_path.display().to_string(), &mut out);
    out.push_str(",\n  \"project\": {\n    \"projectRoot\": ");
    escape_json_str(&detail.project_root, &mut out);
    out.push_str(",\n    \"projectName\": ");
    escape_json_str(&detail.project_name, &mut out);
    let _ = writeln!(
        out,
        ",\n    \"configStatus\": {{\n      \"enabled\": {}\n    }},",
        detail.enabled
    );
    out.push_str("    \"summary\": ");
    write_project_summary(&detail.summary, "    ", &mut out);
    out.push_str(",\n    \"byCommand\": ");
    write_by_command(&detail.summary.economics.by_command, "    ", &mut out);
    out.push_str(",\n    \"byOperation\": ");
    write_by_operation(&detail.by_operation, "    ", &mut out);
    out.push_str("\n  }\n}\n");
    out
}

pub fn compact_result_to_json(res: &CompactionResult) -> String {
    let mut out = String::from("{\n  \"telemetryPath\": ");
    escape_json_str(&res.telemetry_path.display().to_string(), &mut out);
    let _ = write!(
        out,
        ",\n  \"totalLines\": {},\n  \"keptRows\": {},\n  \"droppedEphemeral\": {},\n  \"droppedInvalid\": {}\n}}\n",
        res.total_lines, res.kept_rows, res.dropped_ephemeral, res.dropped_invalid
    );
    out
}

pub fn reset_result_to_json(res: &ResetResult) -> String {
    let mut out = String::from("{\n  \"telemetryPath\": ");
    escape_json_str(&res.telemetry_path.display().to_string(), &mut out);
    out.push_str(",\n  \"errorsPath\": ");
    escape_json_str(&res.errors_path.display().to_string(), &mut out);
    let _ = write!(
        out,
        ",\n  \"removedGains\": {},\n  \"removedErrors\": {}\n}}\n",
        res.removed_gains, res.removed_errors
    );
    out
}

fn fmt_num(v: f64) -> String {
    if v.fract() == 0.0 { format!("{}", v as i64) } else { format!("{v}") }
}

fn write_econ_fields(e: &ProjectSystemicEconomics, indent: &str, out: &mut String) {
    let _ = writeln!(out, "{indent}\"wrapperTaxCl100k\": {},", e.wrapper_tax_cl100k);
    let _ = writeln!(out, "{indent}\"parallelSliceCalls\": {},", e.parallel_slice_calls);
    let _ = writeln!(out, "{indent}\"sequentialPaginationTurns\": {},", e.sequential_pagination_turns);
    let _ = writeln!(out, "{indent}\"failedRetryTurns\": {},", e.failed_retry_turns);
    let _ = writeln!(out, "{indent}\"estimatedTurns\": {},", e.estimated_turns);
    let _ = writeln!(out, "{indent}\"mcpEstimatedTurns\": {},", e.mcp_estimated_turns);
    let _ = writeln!(out, "{indent}\"grossRuleReplayCl100k\": {},", e.gross_rule_replay_cl100k);
    let _ = writeln!(out, "{indent}\"ruleReplayTaxCl100k\": {},", e.rule_replay_tax_cl100k);
    let _ = writeln!(out, "{indent}\"mcpSchemaBudgetCl100k\": {},", e.mcp_schema_budget_cl100k);
    let _ = writeln!(out, "{indent}\"mcpSchemaTaxCl100k\": {},", e.mcp_schema_tax_cl100k);
    let _ = writeln!(out, "{indent}\"paginationReplayTaxCl100k\": {},", e.pagination_replay_tax_cl100k);
    let _ = writeln!(out, "{indent}\"paginationCostWeightedTaxCl100k\": {},", e.pagination_cost_weighted_tax_cl100k);
    let _ = writeln!(out, "{indent}\"wastedRetryOutputTokensCl100k\": {},", e.wasted_retry_output_tokens_cl100k);
    let _ = writeln!(out, "{indent}\"failedRetryOutputPenalty4xCl100k\": {},", e.failed_retry_output_penalty_4x_cl100k);
    let _ = writeln!(out, "{indent}\"retryReplayTaxCl100k\": {},", e.retry_replay_tax_cl100k);
    let _ = writeln!(out, "{indent}\"retryCostWeightedTaxCl100k\": {},", e.retry_cost_weighted_tax_cl100k);
    let _ = writeln!(out, "{indent}\"totalSystemicTaxCl100k\": {},", e.total_systemic_tax_cl100k);
    let _ = writeln!(out, "{indent}\"totalCostWeightedTaxCl100k\": {},", e.total_cost_weighted_tax_cl100k);
    let _ = writeln!(out, "{indent}\"netEndToEndSavedCl100k\": {},", e.net_end_to_end_saved_cl100k);
    let _ = writeln!(out, "{indent}\"costWeightedNetDeltaCl100k\": {},", e.cost_weighted_net_delta_cl100k);
    let _ = writeln!(out, "{indent}\"spliceErrorRatePct\": {},", fmt_num(e.splice_error_rate_pct));
    let _ = writeln!(out, "{indent}\"singleFileReadCalls\": {},", e.single_file_read_calls);
    let _ = writeln!(out, "{indent}\"singleFileReadLossCalls\": {},", e.single_file_read_loss_calls);
    let _ = writeln!(out, "{indent}\"singleFileReadLossPct\": {},", fmt_num(e.single_file_read_loss_pct));
    out.push_str(&format!("{indent}\"endToEndVerdict\": "));
    escape_json_str(e.end_to_end_verdict, out);
}

fn write_by_command(rows: &[CommandHonestBucket], indent: &str, out: &mut String) {
    out.push('[');
    for (i, r) in rows.iter().enumerate() {
        if i > 0 { out.push(','); }
        out.push_str(&format!("\n{indent}  {{\n{indent}    \"command\": "));
        escape_json_str(r.command.as_str(), out);
        let _ = write!(
            out,
            ",\n{indent}    \"calls\": {},\n{indent}    \"winCalls\": {},\n{indent}    \"lossCalls\": {},\n{indent}    \"winPct\": {},\n{indent}    \"errorCalls\": {},\n{indent}    \"errPct\": {},\n{indent}    \"realisticNativeCl100k\": {},\n{indent}    \"aiceCl100k\": {},\n{indent}    \"netDeltaCl100k\": {},\n{indent}    \"deltaPct\": {},\n{indent}    \"rawNativeRefCl100k\": {}\n{indent}  }}",
            r.calls, r.win_calls, r.loss_calls, fmt_num(r.win_pct), r.error_calls, fmt_num(r.err_pct),
            r.realistic_native_cl100k, r.aice_cl100k, r.net_delta_cl100k, fmt_num(r.delta_pct), r.raw_native_ref_cl100k
        );
    }
    if !rows.is_empty() { out.push('\n'); out.push_str(indent); }
    out.push(']');
}

fn write_by_operation(rows: &[OperationBucket], indent: &str, out: &mut String) {
    out.push('[');
    for (i, r) in rows.iter().enumerate() {
        if i > 0 { out.push(','); }
        out.push_str(&format!("\n{indent}  {{\n{indent}    \"operation\": "));
        escape_json_str(&r.operation, out);
        out.push_str(&format!(",\n{indent}    \"surface\": "));
        escape_json_str(&r.surface, out);
        let _ = write!(
            out,
            ",\n{indent}    \"calls\": {},\n{indent}    \"nativeChars\": {},\n{indent}    \"aiceChars\": {},\n{indent}    \"savedChars\": {},\n{indent}    \"nativeCl100k\": {},\n{indent}    \"aiceCl100k\": {},\n{indent}    \"savedCl100k\": {},\n{indent}    \"savingsPct\": {},\n{indent}    \"realisticNativeCl100k\": {},\n{indent}    \"realisticSavedCl100k\": {},\n{indent}    \"realisticSavingsPct\": {},\n{indent}    \"nativeO200k\": {},\n{indent}    \"aiceO200k\": {},\n{indent}    \"savedO200k\": {},\n{indent}    \"o200kSavingsPct\": {}\n{indent}  }}",
            r.calls, r.native_chars, r.aice_chars, r.saved_chars, r.native_cl100k, r.aice_cl100k,
            r.saved_cl100k, fmt_num(r.savings_pct), r.realistic_native_cl100k, r.realistic_saved_cl100k,
            fmt_num(r.realistic_savings_pct), r.native_o200k, r.aice_o200k, r.saved_o200k, fmt_num(r.o200k_savings_pct)
        );
    }
    if !rows.is_empty() { out.push('\n'); out.push_str(indent); }
    out.push(']');
}

fn write_by_language(rows: &[LanguageBucket], indent: &str, out: &mut String) {
    out.push('[');
    for (i, r) in rows.iter().enumerate() {
        if i > 0 { out.push(','); }
        out.push_str(&format!("\n{indent}  {{\n{indent}    \"language\": "));
        escape_json_str(&r.language, out);
        let _ = write!(
            out,
            ",\n{indent}    \"calls\": {},\n{indent}    \"nativeCl100k\": {},\n{indent}    \"aiceCl100k\": {},\n{indent}    \"savedCl100k\": {},\n{indent}    \"savingsPct\": {},\n{indent}    \"realisticNativeCl100k\": {},\n{indent}    \"realisticSavedCl100k\": {},\n{indent}    \"realisticSavingsPct\": {},\n{indent}    \"nativeO200k\": {},\n{indent}    \"aiceO200k\": {},\n{indent}    \"savedO200k\": {}\n{indent}  }}",
            r.calls, r.native_cl100k, r.aice_cl100k, r.saved_cl100k, fmt_num(r.savings_pct),
            r.realistic_native_cl100k, r.realistic_saved_cl100k, fmt_num(r.realistic_savings_pct),
            r.native_o200k, r.aice_o200k, r.saved_o200k
        );
    }
    if !rows.is_empty() { out.push('\n'); out.push_str(indent); }
    out.push(']');
}

fn write_projects(rows: &[ProjectGainSummary], indent: &str, out: &mut String) {
    out.push('[');
    for (i, p) in rows.iter().enumerate() {
        if i > 0 { out.push(','); }
        out.push('\n');
        out.push_str(indent);
        out.push_str("  ");
        write_project_summary(p, &format!("{indent}  "), out);
    }
    if !rows.is_empty() { out.push('\n'); out.push_str(indent); }
    out.push(']');
}

fn write_project_summary(p: &ProjectGainSummary, indent: &str, out: &mut String) {
    let sub = format!("{indent}  ");
    out.push_str("{\n");
    out.push_str(&format!("{sub}\"projectRoot\": "));
    escape_json_str(&p.project_root, out);
    out.push_str(&format!(",\n{sub}\"projectName\": "));
    escape_json_str(&p.project_name, out);
    let _ = writeln!(
        out,
        ",\n{sub}\"calls\": {},\n{sub}\"readCalls\": {},\n{sub}\"writeCalls\": {},\n{sub}\"overheadCalls\": {},\n{sub}\"repeatReadCalls\": {},\n{sub}\"nativeChars\": {},\n{sub}\"aiceChars\": {},\n{sub}\"savedChars\": {},\n{sub}\"nativeCl100k\": {},\n{sub}\"aiceCl100k\": {},\n{sub}\"savedCl100k\": {},\n{sub}\"savingsPct\": {},\n{sub}\"nativeO200k\": {},\n{sub}\"aiceO200k\": {},\n{sub}\"savedO200k\": {},\n{sub}\"o200kSavingsPct\": {},",
        p.calls, p.read_calls, p.write_calls, p.overhead_calls, p.repeat_read_calls,
        p.native_chars, p.aice_chars, p.saved_chars, p.native_cl100k, p.aice_cl100k, p.saved_cl100k,
        fmt_num(p.savings_pct), p.native_o200k, p.aice_o200k, p.saved_o200k, fmt_num(p.o200k_savings_pct)
    );
    write_econ_fields(&p.economics, &sub, out);
    let _ = write!(
        out,
        ",\n{sub}\"realisticNativeCl100k\": {},\n{sub}\"realisticSavedCl100k\": {},\n{sub}\"realisticSavingsPct\": {}\n{indent}}}",
        p.economics.realistic_native_cl100k, p.economics.realistic_saved_cl100k,
        fmt_num(calc_pct(p.economics.realistic_saved_cl100k, p.economics.realistic_native_cl100k))
    );
}
