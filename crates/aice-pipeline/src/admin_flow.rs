use aice_governance::{
    AdminAction, AdminGoverned, AdminOp, AgentSetupOptions, SupportedAgentId,
    format_agents_status_table, get_agents_status, project_status, remove_agents,
    set_project_enabled, setup_agents, write_mcp_schema_files,
};
use aice_telemetry::TelemetryOpKind;

use crate::admin_telemetry;
use crate::state::{Executed, PipelineError, PipelineResult};

pub(crate) fn run(
    governed: &AdminGoverned,
    op: &AdminOp,
) -> Result<PipelineResult<Executed>, PipelineError> {
    match &op.action {
        AdminAction::Version => Ok(seal_simple(
            governed,
            format!("{}\n", env!("CARGO_PKG_VERSION")),
            String::new(),
            0,
        )),
        AdminAction::Help => Ok(seal_simple(
            governed,
            crate::help_text::render_help(),
            String::new(),
            0,
        )),
        AdminAction::HelpTopic(cmd) => Ok(seal_simple(
            governed,
            crate::help_text::render_subcommand_help(cmd),
            String::new(),
            0,
        )),
        AdminAction::Enable { dir, force, json } => {
            let (report, sync) =
                set_project_enabled(dir, true, *force).map_err(PipelineError::Execution)?;
            let out = if *json {
                report.to_json_string()
            } else {
                "✔ AICE ENABLED (\"enabled\": true) in aice.config.json\n".to_string()
            };
            let err = sync
                .skipped_reason
                .map(|r| format!("warning: {r}\n"))
                .unwrap_or_default();
            Ok(seal_simple(governed, out, err, 0))
        }
        AdminAction::Disable { dir, json } => {
            let (report, _) =
                set_project_enabled(dir, false, false).map_err(PipelineError::Execution)?;
            let out = if *json {
                report.to_json_string()
            } else {
                "✔ AICE DISABLED (\"enabled\": false) in aice.config.json\n".to_string()
            };
            Ok(seal_simple(governed, out, String::new(), 0))
        }
        AdminAction::Config {
            dir,
            enable,
            disable,
            force,
            json,
        } => run_config(governed, dir, *enable, *disable, *force, *json),
        AdminAction::Agents {
            action,
            agent,
            all,
            global_rules,
            json,
        } => run_agents(governed, action, agent.as_deref(), *all, *global_rules, *json),
        AdminAction::Gain { .. } | AdminAction::Analyze { .. } => {
            admin_telemetry::run_telemetry_admin(governed, op)
        }
        AdminAction::Mcp { generate_schemas } => match generate_schemas {
            Some(dir) => {
                let files = crate::mcp_schemas::render_mcp_schema_files();
                let refs: Vec<(&str, &str)> =
                    files.iter().map(|(n, c)| (*n, c.as_str())).collect();
                write_mcp_schema_files(dir, &refs).map_err(PipelineError::Execution)?;
                let out = format!(
                    "✔ Generated 2 MCP tool schema files and instructions.md in {}\n",
                    dir.display()
                );
                Ok(seal_simple(governed, out, String::new(), 0))
            }
            None => Ok(seal_simple(
                governed,
                "mcp: stdio server (tools: aice_read, aice_splice)\n".to_string(),
                String::new(),
                0,
            )),
        },
        AdminAction::Benchmark { json, markdown } => {
            crate::benchmark_flow::run_benchmark(governed, *json, *markdown)
        }
    }
}

fn run_config(
    governed: &AdminGoverned,
    dir: &std::path::Path,
    enable: bool,
    disable: bool,
    force: bool,
    json: bool,
) -> Result<PipelineResult<Executed>, PipelineError> {
    if enable && disable {
        return Err(PipelineError::Execution(
            "Cannot combine --enable and --disable".to_string(),
        ));
    }
    let mut err = String::new();
    let report = if enable {
        let (rep, sync) =
            set_project_enabled(dir, true, force).map_err(PipelineError::Execution)?;
        if let Some(reason) = sync.skipped_reason {
            err = format!("warning: {reason}\n");
        }
        rep
    } else if disable {
        set_project_enabled(dir, false, false)
            .map_err(PipelineError::Execution)?
            .0
    } else {
        project_status(dir).map_err(PipelineError::Execution)?
    };
    let out = if json {
        report.to_json_string()
    } else {
        report.format_status_text()
    };
    Ok(seal_simple(governed, out, err, 0))
}

fn run_agents(
    governed: &AdminGoverned,
    action: &str,
    agent: Option<&str>,
    all: bool,
    global_rules: bool,
    json: bool,
) -> Result<PipelineResult<Executed>, PipelineError> {
    if let Some(name) = agent
        && SupportedAgentId::parse(name).is_none()
    {
        return Err(PipelineError::Execution(format!(
            "unknown agent '{name}'. Supported: claude, agy, gemini, codex, opencode, aider, goose, cursor"
        )));
    }
    let opts = AgentSetupOptions {
        home_dir: None,
        all,
        agent: agent.map(str::to_string),
        global_rules,
    };
    let res = match action.trim().to_ascii_lowercase().as_str() {
        "status" | "list" => get_agents_status(&opts),
        "setup" | "install" => setup_agents(&opts),
        "remove" | "uninstall" => remove_agents(&opts),
        other => {
            return Err(PipelineError::Execution(format!(
                "unknown agents action '{other}'. Expected: status, setup, remove"
            )));
        }
    };
    let out = if json {
        res.to_json_string()
    } else {
        format!("{}\n", format_agents_status_table(&res))
    };
    Ok(seal_simple(governed, out, String::new(), 0))
}

pub(crate) fn seal_simple(
    governed: &AdminGoverned,
    stdout_payload: String,
    stderr_payload: String,
    exit_code: i32,
) -> PipelineResult<Executed> {
    PipelineResult::seal_admin_with_stderr(
        governed,
        TelemetryOpKind::Admin,
        "<admin>".to_string(),
        String::new(),
        stdout_payload,
        stderr_payload,
        exit_code,
        false,
        false,
    )
}
