use std::path::{Path, PathBuf};

use crate::bpe::{count_both, count_cl100k, count_lines};
use crate::env::{detect_caller_agent, std_env};
use crate::ledger::{
    append_event, is_telemetry_suppressed, resolve_gains_path_with,
    should_exclude_from_global_ledger_with,
};
pub use crate::record::TelemetryOpKind;
use crate::record::{TelemetryEvent, detect_language_name};
use crate::time_hash::{current_epoch_ms, epoch_ms_to_iso, sha256_hex};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TelemetrySummary {
    pub native_chars: usize,
    pub aice_chars: usize,
    pub native_cl100k: usize,
    pub aice_cl100k: usize,
    pub native_o200k: usize,
    pub aice_o200k: usize,
    pub saved_cl100k: isize,
    pub saved_o200k: isize,
    pub ledger_path: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TelemetryRichSummary {
    pub summary: TelemetrySummary,
    pub native_lines: usize,
    pub aice_lines: usize,
    pub saved_lines: isize,
    pub realistic_native_cl100k: usize,
    pub realistic_saved_cl100k: isize,
    pub content_hash: String,
}

pub struct TelemetryMeterInput<'a> {
    pub project_root: &'a Path,
    pub file_label: &'a str,
    pub op_kind: TelemetryOpKind,
    pub surface_label: &'a str,
    pub raw_baseline: &'a str,
    pub emitted_payload: &'a str,
    pub record_ledger: bool,
    pub should_meter_bpe: bool,
}

pub struct TelemetryRichInput<'a> {
    pub project_root: &'a Path,
    pub file_label: &'a str,
    pub op_kind: TelemetryOpKind,
    pub surface_label: &'a str,
    pub raw_baseline: &'a str,
    pub emitted_payload: &'a str,
    pub realistic_native_payload: Option<&'a str>,
    pub multi_files: &'a [String],
    pub language: Option<&'a str>,
    pub agent: Option<&'a str>,
    pub is_search_mode: bool,
    pub preserved_trivia_tokens: usize,
    pub wasted_input_tokens: Option<usize>,
    pub explicit_telemetry_path: Option<&'a Path>,
    pub record_ledger: bool,
    pub should_meter_bpe: bool,
}

pub fn meter_payload(input: &TelemetryMeterInput<'_>) -> TelemetrySummary {
    meter_rich_payload(&TelemetryRichInput {
        project_root: input.project_root,
        file_label: input.file_label,
        op_kind: input.op_kind,
        surface_label: input.surface_label,
        raw_baseline: input.raw_baseline,
        emitted_payload: input.emitted_payload,
        realistic_native_payload: None,
        multi_files: &[],
        language: None,
        agent: None,
        is_search_mode: false,
        preserved_trivia_tokens: 0,
        wasted_input_tokens: None,
        explicit_telemetry_path: None,
        record_ledger: input.record_ledger,
        should_meter_bpe: input.should_meter_bpe,
    })
    .summary
}

pub fn meter_rich_payload(input: &TelemetryRichInput<'_>) -> TelemetryRichSummary {
    meter_rich_payload_with(input, &std_env)
}

pub fn meter_rich_payload_with(
    input: &TelemetryRichInput<'_>,
    env_fn: &dyn Fn(&str) -> Option<String>,
) -> TelemetryRichSummary {
    let suppressed = is_telemetry_suppressed();
    let excluded = should_exclude_from_global_ledger_with(
        input.project_root,
        input.explicit_telemetry_path,
        env_fn,
    );
    let should_count_bpe = input.should_meter_bpe && !suppressed && !excluded;
    let (native_bpe, aice_bpe, realistic_native_cl100k) = if should_count_bpe {
        let nb = count_both(input.raw_baseline);
        let ab = count_both(input.emitted_payload);
        let rn = input
            .realistic_native_payload
            .map(|p| count_cl100k(p).min(nb.cl100k))
            .unwrap_or(nb.cl100k);
        (nb, ab, rn)
    } else {
        Default::default()
    };

    let native_lines = count_lines(input.raw_baseline);
    let aice_lines = count_lines(input.emitted_payload);
    let saved_lines = native_lines as isize - aice_lines as isize;
    let saved_cl100k = native_bpe.cl100k as isize - aice_bpe.cl100k as isize;
    let saved_o200k = native_bpe.o200k as isize - aice_bpe.o200k as isize;
    let realistic_saved_cl100k = realistic_native_cl100k as isize - aice_bpe.cl100k as isize;
    let content_hash = sha256_hex(input.raw_baseline.as_bytes());

    let mut ledger_path = None;
    if input.record_ledger && !suppressed && !excluded {
        let ts_ms = current_epoch_ms();
        let proj_str = input.project_root.display().to_string();
        let proj_name = input
            .project_root
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("root")
            .to_string();
        let file_label: String = input.file_label.chars().take(120).collect();
        let language = input
            .language
            .unwrap_or_else(|| detect_language_name(&file_label))
            .to_string();
        let agent = input
            .agent
            .map(str::to_string)
            .unwrap_or_else(|| detect_caller_agent(input.surface_label));
        let event = TelemetryEvent {
            timestamp_ms: ts_ms,
            timestamp: epoch_ms_to_iso(ts_ms),
            project_root: proj_str,
            project_name: proj_name,
            file_path: file_label,
            multi_files: input.multi_files.iter().take(16).cloned().collect(),
            language,
            operation: input.op_kind.as_str().to_string(),
            surface: input.surface_label.to_string(),
            agent,
            is_write: input.op_kind.is_write(),
            is_search_mode: input.is_search_mode,
            native_chars: input.raw_baseline.len(),
            aice_chars: input.emitted_payload.len(),
            saved_chars: input.raw_baseline.len() as isize - input.emitted_payload.len() as isize,
            native_cl100k: native_bpe.cl100k,
            aice_cl100k: aice_bpe.cl100k,
            saved_cl100k,
            native_o200k: native_bpe.o200k,
            aice_o200k: aice_bpe.o200k,
            saved_o200k,
            realistic_native_cl100k: Some(realistic_native_cl100k),
            realistic_saved_cl100k: Some(realistic_saved_cl100k),
            preserved_trivia_tokens: input.preserved_trivia_tokens,
            structural_compression_pct: None,
            wasted_input_tokens: input.wasted_input_tokens,
            content_hash: content_hash.clone(),
        };
        let target = resolve_gains_path_with(input.explicit_telemetry_path, env_fn);
        if append_event(&target, &event).is_ok() {
            ledger_path = Some(target);
        }
    }

    TelemetryRichSummary {
        summary: TelemetrySummary {
            native_chars: input.raw_baseline.len(),
            aice_chars: input.emitted_payload.len(),
            native_cl100k: native_bpe.cl100k,
            aice_cl100k: aice_bpe.cl100k,
            native_o200k: native_bpe.o200k,
            aice_o200k: aice_bpe.o200k,
            saved_cl100k,
            saved_o200k,
            ledger_path,
        },
        native_lines,
        aice_lines,
        saved_lines,
        realistic_native_cl100k,
        realistic_saved_cl100k,
        content_hash,
    }
}

pub fn record_cli_failure_telemetry(
    project_root: &Path,
    op_kind: TelemetryOpKind,
    surface_label: &str,
    error_message: &str,
    wasted_payload: Option<&str>,
    explicit_telemetry_path: Option<&Path>,
) -> TelemetryRichSummary {
    let skip_bpe = is_telemetry_suppressed()
        || should_exclude_from_global_ledger_with(project_root, explicit_telemetry_path, &std_env);
    let wasted_tokens = if skip_bpe {
        None
    } else {
        wasted_payload.map(count_cl100k)
    };
    meter_rich_payload(&TelemetryRichInput {
        project_root,
        file_label: "<cli-error>",
        op_kind,
        surface_label,
        raw_baseline: "",
        emitted_payload: error_message,
        realistic_native_payload: Some(""),
        multi_files: &[],
        language: Some("Multi"),
        agent: None,
        is_search_mode: false,
        preserved_trivia_tokens: 0,
        wasted_input_tokens: wasted_tokens,
        explicit_telemetry_path,
        record_ledger: true,
        should_meter_bpe: true,
    })
}
