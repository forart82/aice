use aice_batch_read::search::execute_search;
use aice_governance::{Governed, SearchOp};
use aice_telemetry::TelemetryOpKind;

use crate::state::{Executed, PipelineError, PipelineResult, SealRichMeta};

pub(crate) fn run(
    governed: &Governed,
    op: &SearchOp,
) -> Result<PipelineResult<Executed>, PipelineError> {
    let pack = execute_search(governed, op).map_err(PipelineError::Execution)?;
    let multi_files = pack.multi_files;

    Ok(PipelineResult::seal_rich(
        governed,
        TelemetryOpKind::Context,
        "<directory>".to_string(),
        pack.raw_baseline,
        pack.emitted_output,
        pack.exit_code,
        true,
        true,
        SealRichMeta {
            stderr_payload: pack.stderr_output,
            is_search_mode: true,
            multi_files,
            language: pack.language.or_else(|| Some("Multi".to_string())),
            wasted_input_tokens: pack.wasted_input_tokens,
            ..SealRichMeta::default()
        },
    ))
}
