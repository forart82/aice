use aice_batch_write::{TOKENS_SAVED_PLACEHOLDER, execute_batch_write, format_splice_json};
use aice_governance::{Governed, OperationTargets, WriteOp};
use aice_lang_registry::detect_language;
use aice_telemetry::{TelemetryOpKind, count_cl100k};

use crate::lang_meta::{rel_path_label, telemetry_lang_name};
use crate::state::{Executed, PipelineError, PipelineResult, SealRichMeta};

pub(crate) fn run(
    governed: &Governed,
    op: &WriteOp,
) -> Result<PipelineResult<Executed>, PipelineError> {
    crate::write_guard::validate_write_op_selectors(governed.cwd(), op)
        .map_err(PipelineError::Execution)?;
    let mut effective_op = op.clone();
    if effective_op.code.is_none()
        && effective_op.body.is_none()
        && effective_op.template.is_none()
        && let Some(from) = &effective_op.from_file
    {
        let abs = if from.is_absolute() {
            from.clone()
        } else {
            governed.cwd().join(from)
        };
        if let Some(auth) = governed
            .authorized_paths()
            .iter()
            .find(|ap| ap.requested == abs || ap.canonical == abs)
        {
            let content = std::fs::read_to_string(&auth.canonical).map_err(|e| {
                PipelineError::Execution(format!("failed to read --from {}: {e}", from.display()))
            })?;
            effective_op.code = Some(content);
        }
    }

    let report = execute_batch_write(governed, &effective_op).map_err(PipelineError::Execution)?;
    if report.exit_code != 0 && effective_op.path.is_none() && effective_op.target_paths().is_empty()
    {
        return Err(PipelineError::Execution(report.emitted_output));
    }
    let kind = if op.create {
        TelemetryOpKind::Create
    } else {
        TelemetryOpKind::Splice
    };

    let root = governed.project_root();
    let file_label = if report.multi_files.len() > 1 {
        "<batch-splice>".to_string()
    } else if let Some(first) = report.multi_files.first() {
        first.clone()
    } else {
        op.path
            .as_ref()
            .map(|p| {
                let abs = if p.is_absolute() { p.clone() } else { governed.cwd().join(p) };
                rel_path_label(root, &abs)
            })
            .unwrap_or_else(|| report.file_label.clone())
    };

    let language = if report.multi_files.len() > 1 {
        Some("Multi".to_string())
    } else if let Some(lang) = report.primary_lang {
        Some(telemetry_lang_name(lang).to_string())
    } else {
        op.path
            .as_ref()
            .map(|p| {
                let sample = effective_op
                    .code
                    .as_deref()
                    .or(effective_op.body.as_deref())
                    .or(effective_op.template.as_deref())
                    .unwrap_or(&report.raw_baseline);
                telemetry_lang_name(detect_language(p, sample)).to_string()
            })
            .or_else(|| Some("Multi".to_string()))
    };

    let trivia_tokens = if report.preserved_trivia_text.is_empty() {
        0
    } else {
        count_cl100k(&report.preserved_trivia_text)
    };
    let base_tok = count_cl100k(&report.raw_baseline) as isize;
    let realistic_base_tok = report
        .realistic_native_payload
        .as_deref()
        .map(|p| (count_cl100k(p) as isize).min(base_tok))
        .unwrap_or(base_tok);
    let mut meta = SealRichMeta {
        language,
        multi_files: report.multi_files,
        realistic_native_payload: report.realistic_native_payload,
        preserved_trivia_tokens: trivia_tokens,
        ..SealRichMeta::default()
    };

    let stdout_payload = if report.exit_code != 0 {
        let diag = if report.emitted_output.ends_with('\n') {
            report.emitted_output
        } else {
            format!("{}\n", report.emitted_output)
        };
        meta.stderr_payload = format!("❌ Error splicing {file_label}: {diag}");
        let payloads = effective_op.inline_payloads();
        if !payloads.is_empty() {
            meta.wasted_input_tokens = Some(count_cl100k(&payloads.join("\n")));
        }
        String::new()
    } else if let Some(info) = report.json_info {
        let info_trivia = if info.preserved_trivia_text.is_empty() {
            0
        } else {
            count_cl100k(&info.preserved_trivia_text)
        };
        let mut saved = 0isize;
        let mut realistic_saved = realistic_base_tok - base_tok;
        let mut rendered = format_splice_json(&info, saved, info_trivia, realistic_saved);
        for _ in 0..6 {
            let out_tok = count_cl100k(&rendered) as isize;
            let next_saved = base_tok - out_tok;
            let next_realistic = realistic_base_tok - out_tok;
            if next_saved == saved && next_realistic == realistic_saved {
                break;
            }
            saved = next_saved;
            realistic_saved = next_realistic;
            rendered = format_splice_json(&info, saved, info_trivia, realistic_saved);
        }
        rendered
    } else if report.banner_needs_tokens {
        let mut saved = 0isize;
        let mut rendered = report.emitted_output.replace(TOKENS_SAVED_PLACEHOLDER, "0");
        for _ in 0..6 {
            let out_tok = count_cl100k(&rendered) as isize;
            let next_saved = base_tok - out_tok;
            if next_saved == saved {
                break;
            }
            saved = next_saved;
            rendered = report
                .emitted_output
                .replace(TOKENS_SAVED_PLACEHOLDER, &saved.to_string());
        }
        rendered
    } else {
        report.emitted_output
    };

    let record_ledger = if report.exit_code != 0 && report.is_batch_rollback {
        false
    } else {
        !op.dry_run
    };

    Ok(PipelineResult::seal_rich(
        governed,
        kind,
        file_label,
        report.raw_baseline,
        stdout_payload,
        report.exit_code,
        record_ledger,
        true,
        meta,
    ))
}
