use std::path::Path;

use aice_governance::{OutputSurface, find_project_root};
use aice_telemetry::{
    RecordTelemetryErrorInput, TelemetryOpKind, TelemetryRichInput, TelemetrySummary, count_cl100k,
    meter_rich_payload, record_cli_failure_telemetry, record_error_event,
};

use crate::state::{Executed, PipelineResult};

#[derive(Debug)]
pub struct MeteredOutput {
    _sealed: (),
    stdout_payload: String,
    stderr_payload: String,
    exit_code: i32,
    summary: TelemetrySummary,
}

impl MeteredOutput {
    pub fn payload(&self) -> &str {
        &self.stdout_payload
    }

    pub fn stderr_payload(&self) -> &str {
        &self.stderr_payload
    }

    pub fn exit_code(&self) -> i32 {
        self.exit_code
    }

    pub fn summary(&self) -> &TelemetrySummary {
        &self.summary
    }
}

pub fn meter_and_seal(res: PipelineResult<Executed>) -> MeteredOutput {
    meter_and_seal_to(res, None)
}

pub fn meter_and_seal_to(
    res: PipelineResult<Executed>,
    explicit_telemetry_path: Option<&Path>,
) -> MeteredOutput {
    let exec = res.state;
    let surface_label = match exec.surface() {
        OutputSurface::Cli => "cli",
        OutputSurface::Mcp => "mcp",
    };
    let exit_code = exec.exit_code();
    let summary = if exit_code != 0 && exec.record_ledger() {
        let err_msg = if exec.stderr_payload().is_empty() {
            exec.emitted_payload()
        } else {
            exec.stderr_payload()
        };
        record_error_event(&RecordTelemetryErrorInput {
            target_path: None,
            project_root: Some(exec.project_root()),
            file_path: Some(exec.file_label()),
            operation: exec.op_kind().as_str(),
            surface: surface_label,
            agent: None,
            error_message: err_msg,
            wasted_input_tokens: exec.wasted_input_tokens(),
            explicit_telemetry_path,
        });
        if exec.wasted_input_tokens().is_some() {
            meter_rich_payload(&TelemetryRichInput {
                project_root: exec.project_root(),
                file_label: "<cli-error>",
                op_kind: exec.op_kind(),
                surface_label,
                raw_baseline: "",
                emitted_payload: err_msg,
                realistic_native_payload: Some(""),
                multi_files: &[],
                language: Some("Multi"),
                agent: None,
                is_search_mode: false,
                preserved_trivia_tokens: 0,
                wasted_input_tokens: exec.wasted_input_tokens(),
                explicit_telemetry_path,
                record_ledger: true,
                should_meter_bpe: exec.should_meter_bpe(),
            })
            .summary
        } else {
            record_cli_failure_telemetry(
                exec.project_root(),
                exec.op_kind(),
                surface_label,
                err_msg,
                None,
                explicit_telemetry_path,
            )
            .summary
        }
    } else {
        meter_rich_payload(&TelemetryRichInput {
            project_root: exec.project_root(),
            file_label: exec.file_label(),
            op_kind: exec.op_kind(),
            surface_label,
            raw_baseline: exec.raw_baseline_payload(),
            emitted_payload: exec.emitted_payload(),
            realistic_native_payload: exec.realistic_native_payload(),
            multi_files: exec.multi_files(),
            language: exec.language(),
            agent: None,
            is_search_mode: exec.is_search_mode(),
            preserved_trivia_tokens: exec.preserved_trivia_tokens(),
            wasted_input_tokens: exec.wasted_input_tokens(),
            explicit_telemetry_path,
            record_ledger: exec.record_ledger(),
            should_meter_bpe: exec.should_meter_bpe(),
        })
        .summary
    };

    let (stdout_payload, stderr_payload) = exec.into_streams();
    MeteredOutput {
        _sealed: (),
        stdout_payload,
        stderr_payload,
        exit_code,
        summary,
    }
}

pub fn record_failure_for_cli(
    cwd: &Path,
    op_kind: TelemetryOpKind,
    surface: OutputSurface,
    file_label: &str,
    err_msg: &str,
    wasted_payload: Option<&str>,
    is_disabled: bool,
) {
    if is_disabled {
        return;
    }
    let root = find_project_root(cwd);
    let surface_label = match surface {
        OutputSurface::Cli => "cli",
        OutputSurface::Mcp => "mcp",
    };
    let wasted_tokens = wasted_payload.map(count_cl100k);
    record_error_event(&RecordTelemetryErrorInput {
        target_path: None,
        project_root: Some(&root),
        file_path: Some(file_label),
        operation: op_kind.as_str(),
        surface: surface_label,
        agent: None,
        error_message: err_msg,
        wasted_input_tokens: wasted_tokens,
        explicit_telemetry_path: None,
    });
    record_cli_failure_telemetry(&root, op_kind, surface_label, err_msg, wasted_payload, None);
}
