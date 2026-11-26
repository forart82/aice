use std::fmt;
use std::path::{Path, PathBuf};

use aice_governance::{AdminGoverned, Governed, OutputSurface};
use aice_telemetry::TelemetryOpKind;

#[derive(Debug)]
pub struct Executed {
    _sealed: (),
    project_root: PathBuf,
    surface: OutputSurface,
    op_kind: TelemetryOpKind,
    file_label: String,
    raw_baseline_payload: String,
    emitted_payload: String,
    stderr_payload: String,
    exit_code: i32,
    record_ledger: bool,
    should_meter_bpe: bool,
    is_search_mode: bool,
    realistic_native_payload: Option<String>,
    multi_files: Vec<String>,
    language: Option<String>,
    preserved_trivia_tokens: usize,
    wasted_input_tokens: Option<usize>,
}

impl Executed {
    pub(crate) fn project_root(&self) -> &Path { &self.project_root }
    pub(crate) fn surface(&self) -> OutputSurface { self.surface }
    pub(crate) fn op_kind(&self) -> TelemetryOpKind { self.op_kind }
    pub(crate) fn file_label(&self) -> &str { &self.file_label }
    pub(crate) fn raw_baseline_payload(&self) -> &str { &self.raw_baseline_payload }
    pub(crate) fn emitted_payload(&self) -> &str { &self.emitted_payload }
    pub(crate) fn stderr_payload(&self) -> &str { &self.stderr_payload }
    pub(crate) fn exit_code(&self) -> i32 { self.exit_code }
    pub(crate) fn record_ledger(&self) -> bool { self.record_ledger }
    pub(crate) fn should_meter_bpe(&self) -> bool { self.should_meter_bpe }
    pub(crate) fn is_search_mode(&self) -> bool { self.is_search_mode }
    pub(crate) fn realistic_native_payload(&self) -> Option<&str> {
        self.realistic_native_payload.as_deref()
    }
    pub(crate) fn multi_files(&self) -> &[String] { &self.multi_files }
    pub(crate) fn language(&self) -> Option<&str> { self.language.as_deref() }
    pub(crate) fn preserved_trivia_tokens(&self) -> usize { self.preserved_trivia_tokens }
    pub(crate) fn wasted_input_tokens(&self) -> Option<usize> { self.wasted_input_tokens }
    pub(crate) fn into_streams(self) -> (String, String) {
        (self.emitted_payload, self.stderr_payload)
    }
}

#[derive(Debug, Default)]
pub(crate) struct SealRichMeta {
    pub(crate) stderr_payload: String,
    pub(crate) is_search_mode: bool,
    pub(crate) realistic_native_payload: Option<String>,
    pub(crate) multi_files: Vec<String>,
    pub(crate) language: Option<String>,
    pub(crate) preserved_trivia_tokens: usize,
    pub(crate) wasted_input_tokens: Option<usize>,
}

#[derive(Debug)]
pub struct PipelineResult<S> {
    pub(crate) state: S,
}

impl PipelineResult<Executed> {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn seal_rich(
        governed: &Governed,
        op_kind: TelemetryOpKind,
        file_label: String,
        raw_baseline_payload: String,
        emitted_payload: String,
        exit_code: i32,
        record_ledger: bool,
        should_meter_bpe: bool,
        meta: SealRichMeta,
    ) -> Self {
        Self::seal_parts(
            governed.project_root().to_path_buf(),
            governed.surface(),
            op_kind,
            file_label,
            raw_baseline_payload,
            emitted_payload,
            exit_code,
            record_ledger,
            should_meter_bpe,
            meta,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn seal_admin_with_stderr(
        governed: &AdminGoverned,
        op_kind: TelemetryOpKind,
        file_label: String,
        raw_baseline_payload: String,
        emitted_payload: String,
        stderr_payload: String,
        exit_code: i32,
        record_ledger: bool,
        should_meter_bpe: bool,
    ) -> Self {
        Self::seal_parts(
            governed.project_root().to_path_buf(),
            governed.surface(),
            op_kind,
            file_label,
            raw_baseline_payload,
            emitted_payload,
            exit_code,
            record_ledger,
            should_meter_bpe,
            SealRichMeta {
                stderr_payload,
                ..SealRichMeta::default()
            },
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn seal_parts(
        project_root: PathBuf,
        surface: OutputSurface,
        op_kind: TelemetryOpKind,
        file_label: String,
        raw_baseline_payload: String,
        emitted_payload: String,
        exit_code: i32,
        record_ledger: bool,
        should_meter_bpe: bool,
        meta: SealRichMeta,
    ) -> Self {
        Self {
            state: Executed {
                _sealed: (),
                project_root,
                surface,
                op_kind,
                file_label,
                raw_baseline_payload,
                emitted_payload,
                stderr_payload: meta.stderr_payload,
                exit_code,
                record_ledger,
                should_meter_bpe,
                is_search_mode: meta.is_search_mode,
                realistic_native_payload: meta.realistic_native_payload,
                multi_files: meta.multi_files,
                language: meta.language,
                preserved_trivia_tokens: meta.preserved_trivia_tokens,
                wasted_input_tokens: meta.wasted_input_tokens,
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PipelineError {
    Execution(String),
}

impl fmt::Display for PipelineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Execution(msg) => write!(f, "Pipeline execution error: {msg}"),
        }
    }
}

impl std::error::Error for PipelineError {}
