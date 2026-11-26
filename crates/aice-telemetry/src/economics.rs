use std::collections::BTreeMap;

use crate::economics_reconcile::{
    classify_error_command, count_turns, empty_cmd_bucket, finalize_cmd_bucket, reconcile_failures,
};
pub use crate::economics_reconcile::{
    CommandHonestBucket, HEALTHY_SPLICE_ERR_PCT_MAX, PARALLEL_SLICE_GAP_MS, REPEAT_READ_WINDOW_MS,
    RepeatReadTracker, RuleBreakEvenMetrics, calc_pct, compute_rule_break_even_metrics,
    mcp_schema_budget_cl100k, rule_overhead_budget_cl100k,
};
use crate::error_log::TelemetryErrorEvent;
use crate::record::{CanonicalTelemetryCommand, TelemetryEvent};

#[derive(Debug, Clone, PartialEq)]
pub struct ProjectSystemicEconomics {
    pub by_command: Vec<CommandHonestBucket>,
    pub wrapper_tax_cl100k: usize,
    pub parallel_slice_calls: usize,
    pub sequential_pagination_turns: usize,
    pub failed_retry_turns: usize,
    pub estimated_turns: usize,
    pub mcp_estimated_turns: usize,
    pub gross_rule_replay_cl100k: usize,
    pub rule_replay_tax_cl100k: usize,
    pub mcp_schema_budget_cl100k: usize,
    pub mcp_schema_tax_cl100k: usize,
    pub pagination_replay_tax_cl100k: usize,
    pub pagination_cost_weighted_tax_cl100k: usize,
    pub wasted_retry_output_tokens_cl100k: usize,
    pub failed_retry_output_penalty_4x_cl100k: usize,
    pub retry_replay_tax_cl100k: usize,
    pub retry_cost_weighted_tax_cl100k: usize,
    pub total_systemic_tax_cl100k: usize,
    pub total_cost_weighted_tax_cl100k: usize,
    pub net_end_to_end_saved_cl100k: isize,
    pub cost_weighted_net_delta_cl100k: isize,
    pub splice_error_rate_pct: f64,
    pub single_file_read_calls: usize,
    pub single_file_read_loss_calls: usize,
    pub single_file_read_loss_pct: f64,
    pub end_to_end_verdict: &'static str,
    pub realistic_native_cl100k: usize,
    pub realistic_saved_cl100k: isize,
}

pub fn compute_project_systemic_economics(
    events: &[TelemetryEvent],
    errors: &[TelemetryErrorEvent],
) -> ProjectSystemicEconomics {
    let mut sorted: Vec<&TelemetryEvent> = events.iter().collect();
    sorted.sort_by_key(|e| e.timestamp_ms);
    let mut sorted_errs: Vec<&TelemetryErrorEvent> = errors.iter().collect();
    sorted_errs.sort_by_key(|e| e.timestamp_ms);

    let (failures, unmatched) = reconcile_failures(&sorted, &sorted_errs);
    let mut buckets: BTreeMap<CanonicalTelemetryCommand, CommandHonestBucket> =
        CanonicalTelemetryCommand::ALL
            .into_iter()
            .map(|c| (c, empty_cmd_bucket(c)))
            .collect();

    let (mut wrapper_tax, mut parallel_calls, mut seq_pag_turns) = (0usize, 0usize, 0usize);
    let (mut real_nat_sum, mut real_saved_sum) = (0usize, 0isize);
    let (mut read_non_err_saved, mut write_non_err_saved) = (0isize, 0isize);
    let (mut single_reads, mut single_losses) = (0usize, 0usize);
    let mut last_read_by_file: BTreeMap<String, (u64, bool)> = BTreeMap::new();
    let mut last_read_ts: Option<u64> = None;
    let mut last_write_ts: Option<u64> = None;
    let mut prev_wrap: Option<(u64, String, bool)> = None;
    let mut mcp_ts = Vec::new();
    let mut all_ts = Vec::new();

    for ev in &sorted {
        all_ts.push(ev.timestamp_ms);
        let ev_write = !ev.is_cli_error() && ev.is_write;
        let same_batch = matches!(
            &prev_wrap,
            Some((pts, psurf, true))
                if ev_write && psurf == &ev.surface && ev.timestamp_ms >= *pts && ev.timestamp_ms - *pts < 50
        );
        if !same_batch {
            wrapper_tax += if ev.surface == "mcp" { 45 } else { 70 };
        }
        prev_wrap = Some((ev.timestamp_ms, ev.surface.clone(), ev_write));
        if ev.surface == "mcp" {
            mcp_ts.push(ev.timestamp_ms);
        }

        let rnat = ev.realistic_native();
        let rsav = ev.realistic_saved();
        real_nat_sum += rnat;
        real_saved_sum += rsav;

        let cmd = ev.classify_command();
        if let Some(b) = buckets.get_mut(&cmd) {
            b.calls += 1;
            b.realistic_native_cl100k += rnat;
            b.aice_cl100k += ev.aice_cl100k;
            b.raw_native_ref_cl100k += ev.native_cl100k;
            if ev.is_cli_error() {
                b.error_calls += 1;
            } else if ev.aice_cl100k <= rnat {
                b.win_calls += 1;
            } else {
                b.loss_calls += 1;
            }
        }
        if !ev.is_cli_error() {
            if ev.is_write {
                write_non_err_saved += rsav;
                last_write_ts = Some(ev.timestamp_ms);
            } else {
                read_non_err_saved += rsav;
                if !ev.file_path.starts_with('<') && ev.multi_files.len() <= 1 {
                    single_reads += 1;
                    if ev.aice_cl100k > rnat {
                        single_losses += 1;
                    }
                }
                if ev.operation != "outline" {
                    let targets: Vec<&str> = if ev.file_path == "<multi-context>" {
                        ev.multi_files.iter().map(String::as_str).collect()
                    } else {
                        vec![ev.file_path.as_str()]
                    };
                    let concrete: Vec<&str> = targets
                        .into_iter()
                        .filter(|f| !f.is_empty() && (!f.starts_with('<') || *f == "<stdin>"))
                        .collect();
                    if !concrete.is_empty() {
                        let is_auto_outline = !ev.is_search_mode
                            && rnat == ev.native_cl100k
                            && ev.native_cl100k >= 300
                            && ev.aice_cl100k.saturating_mul(100)
                                <= ev.native_cl100k.saturating_mul(40);
                        let is_targeted_slice = !ev.is_search_mode && rnat < ev.native_cl100k;
                        let same_turn = last_read_ts.is_some_and(|prev| {
                            ev.timestamp_ms >= prev && ev.timestamp_ms - prev < PARALLEL_SLICE_GAP_MS
                        });
                        let (mut par, mut pag) = (false, false);
                        for f in concrete {
                            if let Some(&(prev_ts, prev_outline)) = last_read_by_file.get(f)
                                && ev.timestamp_ms >= prev_ts
                            {
                                let d = ev.timestamp_ms - prev_ts;
                                if d < PARALLEL_SLICE_GAP_MS || same_turn {
                                    par = true;
                                } else if d <= 180_000
                                    && last_write_ts.is_none_or(|w| w < prev_ts)
                                    && !(prev_outline && is_targeted_slice)
                                {
                                    pag = true;
                                }
                            }
                            last_read_by_file
                                .insert(f.to_string(), (ev.timestamp_ms, is_auto_outline));
                        }
                        if same_turn && is_targeted_slice {
                            par = true;
                        }
                        if par {
                            parallel_calls += 1;
                        } else if pag {
                            seq_pag_turns += 1;
                        }
                        last_read_ts = Some(ev.timestamp_ms);
                    }
                }
            }
        }
    }

    for u in &unmatched {
        all_ts.push(u.timestamp_ms);
        wrapper_tax += if u.surface == "mcp" { 45 } else { 70 };
        if u.surface == "mcp" {
            mcp_ts.push(u.timestamp_ms);
        }
        if let Some(b) = buckets.get_mut(&classify_error_command(u)) {
            b.calls += 1;
            b.error_calls += 1;
            if let Some(wi) = u.wasted_input_tokens {
                b.aice_cl100k += wi;
                real_saved_sum -= wi as isize;
            }
        }
    }

    let by_command: Vec<CommandHonestBucket> = CanonicalTelemetryCommand::ALL
        .into_iter()
        .map(|c| finalize_cmd_bucket(buckets.remove(&c).unwrap()))
        .collect();
    let est_turns = count_turns(&mut all_ts);
    let mcp_turns = count_turns(&mut mcp_ts);
    let failed_turns = failures.len();
    let wasted_retry_out: usize = failures
        .iter()
        .map(|f| match f.wasted_input {
            Some(w) if w > 0 => w * 2,
            _ if f.command == CanonicalTelemetryCommand::SpliceWrite => (f.aice_tokens * 2).max(450),
            _ => f.aice_tokens.max(120),
        })
        .sum();
    let penalty_4x = wasted_retry_out * 4;
    let rule_budget = rule_overhead_budget_cl100k();
    let gross_rule = rule_budget * est_turns;
    let rule_tax = if est_turns == 0 {
        0
    } else {
        rule_budget + ((rule_budget as f64 * (est_turns - 1) as f64 * 0.1).round() as usize)
    };
    let mcp_budget = mcp_schema_budget_cl100k();
    let mcp_tax = if mcp_turns == 0 {
        0
    } else {
        mcp_budget + ((mcp_budget as f64 * (mcp_turns - 1) as f64 * 0.1).round() as usize)
    };
    let pag_tax = seq_pag_turns * 8_500;
    let pag_cw = seq_pag_turns * (850 + 80 * 4);
    let retry_tax = if failed_turns == 0 { 0 } else { failed_turns * 8_500 + wasted_retry_out };
    let retry_cw = if failed_turns == 0 { 0 } else { failed_turns * 850 + penalty_4x };
    let total_tax = wrapper_tax + rule_tax + mcp_tax + pag_tax + retry_tax;
    let total_cw_tax = wrapper_tax + rule_tax + mcp_tax + pag_cw + retry_cw;
    let net_e2e = real_saved_sum - total_tax as isize;
    let cw_net = (read_non_err_saved + write_non_err_saved * 4) - total_cw_tax as isize;
    let splice_b = by_command
        .iter()
        .find(|c| c.command == CanonicalTelemetryCommand::SpliceWrite);
    let splice_err_pct = splice_b.map(|b| b.err_pct).unwrap_or(0.0);
    let healthy_splice =
        splice_b.map(|b| b.calls).unwrap_or(0) == 0 || splice_err_pct <= HEALTHY_SPLICE_ERR_PCT_MAX;
    let verdict = if sorted.is_empty() && failed_turns == 0 {
        "NEUTRAL"
    } else if net_e2e > 0 && cw_net > 0 && healthy_splice {
        "TOKEN-REDUCING"
    } else if net_e2e == 0 && cw_net == 0 && failed_turns == 0 {
        "NEUTRAL"
    } else {
        "TOKEN-CONSUMING"
    };

    ProjectSystemicEconomics {
        by_command,
        wrapper_tax_cl100k: wrapper_tax,
        parallel_slice_calls: parallel_calls,
        sequential_pagination_turns: seq_pag_turns,
        failed_retry_turns: failed_turns,
        estimated_turns: est_turns,
        mcp_estimated_turns: mcp_turns,
        gross_rule_replay_cl100k: gross_rule,
        rule_replay_tax_cl100k: rule_tax,
        mcp_schema_budget_cl100k: mcp_budget,
        mcp_schema_tax_cl100k: mcp_tax,
        pagination_replay_tax_cl100k: pag_tax,
        pagination_cost_weighted_tax_cl100k: pag_cw,
        wasted_retry_output_tokens_cl100k: wasted_retry_out,
        failed_retry_output_penalty_4x_cl100k: penalty_4x,
        retry_replay_tax_cl100k: retry_tax,
        retry_cost_weighted_tax_cl100k: retry_cw,
        total_systemic_tax_cl100k: total_tax,
        total_cost_weighted_tax_cl100k: total_cw_tax,
        net_end_to_end_saved_cl100k: net_e2e,
        cost_weighted_net_delta_cl100k: cw_net,
        splice_error_rate_pct: splice_err_pct,
        single_file_read_calls: single_reads,
        single_file_read_loss_calls: single_losses,
        single_file_read_loss_pct: calc_pct(single_losses as isize, single_reads),
        end_to_end_verdict: verdict,
        realistic_native_cl100k: real_nat_sum,
        realistic_saved_cl100k: real_saved_sum,
    }
}
