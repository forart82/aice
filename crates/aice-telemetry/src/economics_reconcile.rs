use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

use aice_governance::MANDATORY_AGENT_RULES_MARKDOWN;

use crate::bpe::count_cl100k;
use crate::error_log::TelemetryErrorEvent;
use crate::record::{CanonicalTelemetryCommand, TelemetryEvent};

pub const PARALLEL_SLICE_GAP_MS: u64 = 12_000;
pub const REPEAT_READ_WINDOW_MS: u64 = 90_000;
pub const HEALTHY_SPLICE_ERR_PCT_MAX: f64 = 5.0;

const CANONICAL_MCP_TOOLS_JSON: &str = r#"[{"name":"aice_read","description":"Read files, dirs, symbols, :L, search, or file list. MULTI-FILE STREAM ENGINE: NEVER call this tool multiple times in a file-by-file loop! Batch in path or paths.","inputSchema":{"type":"object","properties":{"path":{"type":"string"},"paths":{"type":"array","items":{"type":"string"}},"targets":{"type":"array","items":{"type":"string"}},"symbol":{"type":"string"},"search":{"type":"string"},"filesOnly":{"type":"boolean"},"contextLines":{"type":"number"},"outline":{"type":"boolean"},"full":{"type":"boolean"},"depth":{"type":"number"},"maxTokens":{"type":"number"},"includeDeps":{"type":"boolean"},"includeCallers":{"type":"boolean"},"compact":{"type":"boolean"},"types":{"type":"boolean"},"stats":{"type":"boolean"},"json":{"type":"boolean"}},"required":[]}},{"name":"aice_splice","description":"Create, overwrite, or splice files/symbols/:L/hunks (aice_write). MULTI-FILE STREAM ENGINE: NEVER call this tool multiple times in a file-by-file loop! Use === file:sym === in code.","inputSchema":{"type":"object","properties":{"filePath":{"type":"string"},"path":{"type":"string"},"symbol":{"type":"string"},"code":{"type":"string"},"delete":{"type":"boolean"},"create":{"type":"boolean"},"force":{"type":"boolean"},"overwrite":{"type":"boolean"},"insertAfter":{"type":"string"},"insertBefore":{"type":"string"},"preserveDocs":{"type":"boolean"},"dryRun":{"type":"boolean"},"edits":{"type":"array","items":{"type":"object"}},"batch":{"type":"array","items":{"type":"object"}}}}}]"#;

static RULE_BUDGET_CACHE: OnceLock<usize> = OnceLock::new();
static MCP_BUDGET_CACHE: OnceLock<usize> = OnceLock::new();

pub fn rule_overhead_budget_cl100k() -> usize {
    *RULE_BUDGET_CACHE.get_or_init(|| count_cl100k(MANDATORY_AGENT_RULES_MARKDOWN))
}

pub fn mcp_schema_budget_cl100k() -> usize {
    *MCP_BUDGET_CACHE.get_or_init(|| count_cl100k(CANONICAL_MCP_TOOLS_JSON))
}

pub fn calc_pct(saved: isize, native: usize) -> f64 {
    if native == 0 {
        return 0.0;
    }
    ((saved as f64 / native as f64) * 1000.0).round() / 10.0
}

#[derive(Debug, Clone, PartialEq)]
pub struct CommandHonestBucket {
    pub command: CanonicalTelemetryCommand,
    pub calls: usize,
    pub win_calls: usize,
    pub loss_calls: usize,
    pub win_pct: f64,
    pub error_calls: usize,
    pub err_pct: f64,
    pub realistic_native_cl100k: usize,
    pub aice_cl100k: usize,
    pub net_delta_cl100k: isize,
    pub delta_pct: f64,
    pub raw_native_ref_cl100k: usize,
}

pub struct RuleBreakEvenMetrics {
    pub rule_budget_cl100k: usize,
    pub net_after_rule_budget_cl100k: isize,
    pub rule_break_even_multiple: f64,
    pub rule_break_even_reached: bool,
}

pub fn compute_rule_break_even_metrics(saved_tokens_cl100k: isize) -> RuleBreakEvenMetrics {
    let budget = rule_overhead_budget_cl100k();
    let mult = if budget > 0 {
        ((saved_tokens_cl100k as f64 / budget as f64) * 100.0).round() / 100.0
    } else {
        0.0
    };
    RuleBreakEvenMetrics {
        rule_budget_cl100k: budget,
        net_after_rule_budget_cl100k: saved_tokens_cl100k - budget as isize,
        rule_break_even_multiple: mult,
        rule_break_even_reached: saved_tokens_cl100k >= budget as isize,
    }
}

#[derive(Default)]
pub struct RepeatReadTracker {
    last_by_project: BTreeMap<String, (bool, BTreeSet<String>, u64)>,
}

impl RepeatReadTracker {
    pub fn check_and_advance(&mut self, ev: &TelemetryEvent) -> bool {
        let files: BTreeSet<String> = if !ev.file_path.starts_with('<') {
            std::iter::once(ev.file_path.clone()).collect()
        } else if ev.file_path == "<multi-context>" {
            ev.multi_files
                .iter()
                .filter(|f| !f.starts_with('<'))
                .cloned()
                .collect()
        } else {
            BTreeSet::new()
        };
        let is_read = !ev.is_write;
        let mut repeat = false;
        if is_read
            && !files.is_empty()
            && let Some((prev_read, prev_files, prev_ts)) = self.last_by_project.get(&ev.project_root)
            && *prev_read
            && ev.timestamp_ms >= *prev_ts
            && ev.timestamp_ms - *prev_ts < REPEAT_READ_WINDOW_MS
            && files.iter().any(|f| prev_files.contains(f))
        {
            repeat = true;
        }
        self.last_by_project
            .insert(ev.project_root.clone(), (is_read, files, ev.timestamp_ms));
        repeat
    }
}

pub(crate) struct ReconciledFailure {
    pub(crate) command: CanonicalTelemetryCommand,
    pub(crate) aice_tokens: usize,
    pub(crate) wasted_input: Option<usize>,
}

pub(crate) fn classify_error_command(err: &TelemetryErrorEvent) -> CanonicalTelemetryCommand {
    let lower = err.error_message.to_ascii_lowercase();
    if lower.contains("aice find") || lower.contains("aice tree") {
        CanonicalTelemetryCommand::Find
    } else if lower.contains("aice search")
        || lower.contains("aice grep")
        || lower.contains("--search")
    {
        CanonicalTelemetryCommand::Search
    } else if matches!(err.operation.as_str(), "splice" | "create" | "patch") {
        CanonicalTelemetryCommand::SpliceWrite
    } else if err.operation == "outline" {
        CanonicalTelemetryCommand::Outline
    } else {
        CanonicalTelemetryCommand::Read
    }
}

pub(crate) fn reconcile_failures<'a>(
    sorted: &[&TelemetryEvent],
    errs: &[&'a TelemetryErrorEvent],
) -> (Vec<ReconciledFailure>, Vec<&'a TelemetryErrorEvent>) {
    let mut used = vec![false; errs.len()];
    let mut failures = Vec::new();
    for ev in sorted.iter().filter(|e| e.is_cli_error()) {
        let mut matched = None;
        for (i, err) in errs.iter().enumerate() {
            if !used[i]
                && err.surface == "cli"
                && err.operation == ev.operation
                && (ev.timestamp_ms == 0
                    || err.timestamp_ms == 0
                    || ev.timestamp_ms.abs_diff(err.timestamp_ms) <= 5_000)
            {
                matched = Some(i);
                break;
            }
        }
        let mut wasted = ev.wasted_input_tokens;
        let mut cmd = ev.classify_command();
        if let Some(idx) = matched {
            used[idx] = true;
            if let Some(ew) = errs[idx].wasted_input_tokens
                && wasted.is_none_or(|w| ew > w)
            {
                wasted = Some(ew);
            }
            if cmd == CanonicalTelemetryCommand::Read {
                let inferred = classify_error_command(errs[idx]);
                if inferred != CanonicalTelemetryCommand::Read {
                    cmd = inferred;
                }
            }
        }
        failures.push(ReconciledFailure {
            command: cmd,
            aice_tokens: ev.aice_cl100k,
            wasted_input: wasted,
        });
    }
    let mut unmatched = Vec::new();
    for (i, err) in errs.iter().enumerate() {
        if !used[i] {
            unmatched.push(*err);
            failures.push(ReconciledFailure {
                command: classify_error_command(err),
                aice_tokens: 0,
                wasted_input: err.wasted_input_tokens,
            });
        }
    }
    (failures, unmatched)
}

pub(crate) fn empty_cmd_bucket(command: CanonicalTelemetryCommand) -> CommandHonestBucket {
    CommandHonestBucket {
        command,
        calls: 0,
        win_calls: 0,
        loss_calls: 0,
        win_pct: 0.0,
        error_calls: 0,
        err_pct: 0.0,
        realistic_native_cl100k: 0,
        aice_cl100k: 0,
        net_delta_cl100k: 0,
        delta_pct: 0.0,
        raw_native_ref_cl100k: 0,
    }
}

pub(crate) fn finalize_cmd_bucket(mut b: CommandHonestBucket) -> CommandHonestBucket {
    b.net_delta_cl100k = b.realistic_native_cl100k as isize - b.aice_cl100k as isize;
    b.delta_pct = calc_pct(b.net_delta_cl100k, b.realistic_native_cl100k);
    b.win_pct = calc_pct(b.win_calls as isize, b.calls);
    b.err_pct = calc_pct(b.error_calls as isize, b.calls);
    b
}

pub(crate) fn count_turns(ts: &mut [u64]) -> usize {
    if ts.is_empty() {
        return 0;
    }
    ts.sort_unstable();
    let mut turns = 1;
    for w in ts.windows(2) {
        if w[1] - w[0] >= PARALLEL_SLICE_GAP_MS {
            turns += 1;
        }
    }
    turns
}
