use aice_batch_read::execute_batch_read;
use aice_governance::{Governed, ReadOp};
use aice_lang_registry::detect_language;
use aice_telemetry::TelemetryOpKind;

use crate::lang_meta::{rel_path_label, telemetry_lang_name};
use crate::state::{Executed, PipelineError, PipelineResult, SealRichMeta};

pub(crate) fn run(
    governed: &Governed,
    op: &ReadOp,
) -> Result<PipelineResult<Executed>, PipelineError> {
    let pack = execute_batch_read(governed, op).map_err(PipelineError::Execution)?;
    let kind = if op.outline
        || (op.outline_target
            && !op.include_deps
            && !op.include_callers
            && pack.multi_files.len() <= 1)
    {
        TelemetryOpKind::Outline
    } else if op.files_only
        || op.search.is_some()
        || op.targets.len() > 1
        || pack.multi_files.len() > 1
        || pack.has_expanded_context
    {
        TelemetryOpKind::Context
    } else {
        TelemetryOpKind::Read
    };

    let root = governed.project_root();
    let auth = governed.authorized_paths();
    let multi_files = pack.multi_files;

    let file_label = if pack.is_files_mode {
        "<workspace-files>".to_string()
    } else if pack.is_search_mode {
        "<directory>".to_string()
    } else if multi_files.len() > 1 {
        "<multi-context>".to_string()
    } else if let Some(first) = multi_files.first() {
        first.clone()
    } else if pack.exit_code == 0 {
        "<budget-omitted>".to_string()
    } else if let Some(first) = auth.first() {
        rel_path_label(root, &first.requested)
    } else {
        rel_path_label(root, std::path::Path::new(&pack.file_label))
    };

    let language = pack.language.or_else(|| {
        if auth.len() == 1 && !auth[0].is_binary && auth[0].requested.is_file() {
            let lang = detect_language(&auth[0].requested, &pack.raw_baseline);
            Some(telemetry_lang_name(lang).to_string())
        } else {
            Some("Multi".to_string())
        }
    });

    Ok(PipelineResult::seal_rich(
        governed,
        kind,
        file_label,
        pack.raw_baseline,
        pack.emitted_output,
        pack.exit_code,
        true,
        true,
        SealRichMeta {
            stderr_payload: pack.stderr_output,
            is_search_mode: pack.is_search_mode,
            realistic_native_payload: pack.realistic_native_payload,
            multi_files,
            language,
            preserved_trivia_tokens: pack.preserved_trivia_tokens,
            wasted_input_tokens: pack.wasted_input_tokens,
        },
    ))
}
