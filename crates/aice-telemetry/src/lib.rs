pub mod analyze;
pub mod analyze_format;
pub mod analyze_transcript;
pub mod bpe;
pub mod economics;
pub mod economics_reconcile;
pub mod env;
pub mod error_log;
pub mod gain_buckets;
pub mod gain_format;
pub mod gain_json;
pub mod gain_report;
pub mod gain_types;
pub mod ledger;
pub mod meter;
pub mod record;
pub mod record_codec;
pub mod time_hash;

pub use analyze::{AnalyzeOptions, ProjectAnalyzeReport, analyze_project, analyze_report_to_json};
pub use analyze_format::format_analyze_report;
pub use bpe::{BpeCounts, count_both, count_cl100k, count_lines, count_o200k};
pub use error_log::{
    RecordTelemetryErrorInput, TelemetryErrorEvent, classify_friction_cause, load_telemetry_errors,
    record_error_event,
};
pub use gain_format::{
    format_global_gain_dashboard, format_honest_command_table, format_project_gain_detail,
};
pub use gain_json::{
    compact_result_to_json, gain_report_to_json, project_detail_to_json, reset_result_to_json,
};
pub use gain_report::{
    FullGainReport, GainQuery, GainReport, build_gain_report, summarize_ledger,
};
pub use ledger::{
    CompactionResult, ResetResult, compact_telemetry_ledger, load_telemetry_events,
    reset_telemetry_history, with_suppressed_telemetry,
};
pub use meter::{
    TelemetryMeterInput, TelemetryOpKind, TelemetryRichInput, TelemetryRichSummary,
    TelemetrySummary, meter_payload, meter_rich_payload, record_cli_failure_telemetry,
};
pub use record::{CanonicalTelemetryCommand, TelemetryEvent, detect_language_name};
