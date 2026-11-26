use aice_governance::{AdminAction, AdminGoverned, AdminOp};
use aice_telemetry::{
    AnalyzeOptions, GainQuery, analyze_project, analyze_report_to_json, build_gain_report,
    format_analyze_report, format_global_gain_dashboard, format_project_gain_detail,
    gain_report_to_json, project_detail_to_json, reset_result_to_json, reset_telemetry_history,
};

use crate::admin_flow::seal_simple;
use crate::state::{Executed, PipelineError, PipelineResult};

pub(crate) fn run_telemetry_admin(
    governed: &AdminGoverned,
    op: &AdminOp,
) -> Result<PipelineResult<Executed>, PipelineError> {
    match &op.action {
        AdminAction::Gain {
            project,
            unique,
            all,
            interactive: _,
            json,
            reset,
            yes,
        } => {
            if *reset {
                if !*yes {
                    return Ok(seal_simple(
                        governed,
                        String::new(),
                        "error: 'aice gain --reset' deletes telemetry history. Re-run with -y or --yes to confirm.\n".to_string(),
                        1,
                    ));
                }
                let res = reset_telemetry_history(None)
                    .map_err(|e| PipelineError::Execution(format!("failed to reset telemetry: {e}")))?;
                let out = if *json {
                    reset_result_to_json(&res)
                } else {
                    format!(
                        "✔ Telemetry history reset (gains_removed={}, errors_removed={})\n",
                        res.removed_gains, res.removed_errors
                    )
                };
                return Ok(seal_simple(governed, out, String::new(), 0));
            }

            let query = GainQuery {
                project: if *all { None } else { project.clone() },
                unique: *unique,
                telemetry_path: None,
                drop_ephemeral: false,
            };
            let report = build_gain_report(&query);
            let out = if *json {
                if !*all
                    && project.is_some()
                    && let Some(detail) = &report.project_detail
                {
                    project_detail_to_json(&report.telemetry_path, *unique, detail)
                } else {
                    gain_report_to_json(&report)
                }
            } else if let Some(detail) = &report.project_detail {
                format_project_gain_detail(detail)
            } else {
                format_global_gain_dashboard(&report)
            };
            Ok(seal_simple(governed, out, String::new(), 0))
        }
        AdminAction::Analyze {
            project,
            transcripts_dir,
            json,
        } => {
            let report = analyze_project(&AnalyzeOptions {
                project: project.clone(),
                telemetry_path: None,
                transcripts_dir: transcripts_dir.clone(),
            });
            let out = if *json {
                analyze_report_to_json(&report)
            } else {
                format_analyze_report(&report)
            };
            Ok(seal_simple(governed, out, String::new(), 0))
        }
        _ => Err(PipelineError::Execution(
            "invalid telemetry admin action".to_string(),
        )),
    }
}
