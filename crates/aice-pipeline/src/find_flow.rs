use aice_batch_read::discovery::format_find_pack;
use aice_governance::{FindOp, Governed};
use aice_telemetry::TelemetryOpKind;

use crate::state::{Executed, PipelineError, PipelineResult, SealRichMeta};

pub(crate) fn run(
    governed: &Governed,
    op: &FindOp,
) -> Result<PipelineResult<Executed>, PipelineError> {
    let walk = crate::find_walk::walk_find_output(governed, op)?;
    let pack = format_find_pack(governed, walk, op);
    Ok(PipelineResult::seal_rich(
        governed,
        TelemetryOpKind::Context,
        pack.file_label,
        pack.raw_baseline,
        pack.emitted_output,
        pack.exit_code,
        true,
        true,
        SealRichMeta {
            stderr_payload: pack.stderr_output,
            language: pack.language,
            wasted_input_tokens: pack.wasted_input_tokens,
            ..SealRichMeta::default()
        },
    ))
}
