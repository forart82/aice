use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use aice_governance::find_project_root;

use crate::economics::{
    RepeatReadTracker, calc_pct, compute_project_systemic_economics, compute_rule_break_even_metrics,
};
use crate::env::{
    canonicalize_or_normalize, is_explicit_project_path_query, resolve_gains_path_with,
    resolve_project_filter_target, std_env,
};
use crate::error_log::load_non_benign_errors_by_project;
use crate::gain_buckets::{
    accumulate_lang, accumulate_op, build_project_detail, finalize_lang, finalize_op,
    get_errors_for_project, summarize_project,
};
pub use crate::gain_types::{
    FileGainBucket, FullGainReport, GainQuery, GainReport, LanguageBucket, OperationBucket,
    ProjectDetailReport, ProjectGainSummary,
};
use crate::ledger::load_telemetry_events;
use crate::record::TelemetryEvent;

pub fn summarize_ledger() -> GainReport {
    let full = build_gain_report(&GainQuery::default());
    GainReport {
        telemetry_path: full.telemetry_path,
        total_operations: full.total_operations,
        native_chars: full.native_chars,
        aice_chars: full.aice_chars,
        native_cl100k: full.native_cl100k,
        aice_cl100k: full.aice_cl100k,
        saved_cl100k: full.saved_cl100k,
        native_o200k: full.native_o200k,
        aice_o200k: full.aice_o200k,
        saved_o200k: full.saved_o200k,
        end_to_end_verdict: full.economics.end_to_end_verdict,
    }
}

pub fn matches_project_filter(ev: &TelemetryEvent, filter: &str, cwd: &Path) -> bool {
    let trimmed = filter.trim();
    if trimmed.is_empty() {
        return true;
    }
    let ev_raw = Path::new(&ev.project_root);
    let ev_canon = (!ev.project_root.is_empty()).then(|| canonicalize_or_normalize(ev_raw));
    if trimmed == "." {
        let target_root = resolve_project_filter_target(Some("."), cwd);
        return ev_raw == find_project_root(cwd)
            || ev_raw == target_root
            || ev_canon.as_deref() == Some(target_root.as_path());
    }
    if !is_explicit_project_path_query(trimmed) {
        let base = ev_raw
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        return ev.project_name.eq_ignore_ascii_case(trimmed) || base.eq_ignore_ascii_case(trimmed);
    }
    let cand = if Path::new(trimmed).is_absolute() {
        PathBuf::from(trimmed)
    } else {
        cwd.join(trimmed)
    };
    let cand_norm = canonicalize_or_normalize(&cand);
    let cand_root = resolve_project_filter_target(Some(trimmed), cwd);
    ev_raw == cand
        || ev_raw == find_project_root(&cand)
        || ev_raw == cand_norm
        || ev_raw == cand_root
        || ev_canon.as_deref() == Some(cand_norm.as_path())
        || ev_canon.as_deref() == Some(cand_root.as_path())
}

pub fn build_gain_report(query: &GainQuery) -> FullGainReport {
    let ledger_path = resolve_gains_path_with(query.telemetry_path.as_deref(), &std_env);
    let mut events = load_telemetry_events(&ledger_path, query.drop_ephemeral);
    if query.unique {
        let mut seen = BTreeSet::new();
        events.retain(|ev| ev.content_hash.is_empty() || seen.insert(ev.content_hash.clone()));
    }
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if let Some(filter) = query.project.as_deref().filter(|s| !s.trim().is_empty()) {
        events.retain(|ev| matches_project_filter(ev, filter, &cwd));
    }

    let errors_by_root = load_non_benign_errors_by_project(&ledger_path, query.drop_ephemeral);
    let mut proj_events: BTreeMap<String, Vec<TelemetryEvent>> = BTreeMap::new();
    for ev in &events {
        proj_events
            .entry(ev.project_root.clone())
            .or_default()
            .push(ev.clone());
    }

    let mut all_errors = Vec::new();
    let mut projects = Vec::new();
    for (root, pevs) in &proj_events {
        let pname = pevs.first().map(|e| e.project_name.as_str()).unwrap_or("root");
        let perrs = get_errors_for_project(&errors_by_root, root, pname);
        all_errors.extend(perrs.iter().cloned());
        projects.push(summarize_project(root, pname, pevs, &perrs));
    }
    projects.sort_by(|a, b| {
        b.economics
            .realistic_saved_cl100k
            .cmp(&a.economics.realistic_saved_cl100k)
    });

    let (mut read_ops, mut write_ops, mut overhead_ops, mut repeat_reads) = (0, 0, 0, 0);
    let (mut nat_c, mut aice_c, mut sav_c) = (0usize, 0usize, 0isize);
    let (mut nat_1, mut aice_1, mut sav_1) = (0usize, 0usize, 0isize);
    let (mut nat_2, mut aice_2, mut sav_2) = (0usize, 0usize, 0isize);
    let mut trivia_sum = 0usize;
    let mut op_map: BTreeMap<(String, String), OperationBucket> = BTreeMap::new();
    let mut lang_map: BTreeMap<String, LanguageBucket> = BTreeMap::new();
    let mut tracker = RepeatReadTracker::default();

    for ev in &events {
        if tracker.check_and_advance(ev) {
            repeat_reads += 1;
        }
        if ev.is_write {
            write_ops += 1;
        } else {
            read_ops += 1;
        }
        if ev.realistic_saved() <= 0 {
            overhead_ops += 1;
        }
        nat_c += ev.native_chars;
        aice_c += ev.aice_chars;
        sav_c += ev.saved_chars;
        nat_1 += ev.native_cl100k;
        aice_1 += ev.aice_cl100k;
        sav_1 += ev.saved_cl100k;
        nat_2 += ev.native_o200k;
        aice_2 += ev.aice_o200k;
        sav_2 += ev.saved_o200k;
        trivia_sum += ev.preserved_trivia_tokens;
        accumulate_op(&mut op_map, ev);
        accumulate_lang(&mut lang_map, ev);
    }

    let economics = compute_project_systemic_economics(&events, &all_errors);
    let rbe = compute_rule_break_even_metrics(economics.realistic_saved_cl100k);
    let mut by_operation: Vec<OperationBucket> = op_map.into_values().map(finalize_op).collect();
    by_operation.sort_by(|a, b| {
        b.realistic_saved_cl100k
            .cmp(&a.realistic_saved_cl100k)
            .then(b.calls.cmp(&a.calls))
    });
    let mut by_language: Vec<LanguageBucket> = lang_map.into_values().map(finalize_lang).collect();
    by_language.sort_by(|a, b| {
        b.realistic_saved_cl100k
            .cmp(&a.realistic_saved_cl100k)
            .then(b.calls.cmp(&a.calls))
    });

    let project_detail = query
        .project
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .and_then(|raw_filter| {
            if let Some(first) = projects.first() {
                let pevs = proj_events.get(&first.project_root)?;
                let perrs = get_errors_for_project(
                    &errors_by_root,
                    &first.project_root,
                    &first.project_name,
                );
                Some(build_project_detail(&first.project_root, pevs, &perrs))
            } else if is_explicit_project_path_query(raw_filter)
                || cwd.join(raw_filter.trim()).is_dir()
            {
                let resolved_root = resolve_project_filter_target(Some(raw_filter), &cwd);
                let root_str = resolved_root.display().to_string();
                let pname = resolved_root
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("root");
                let perrs = get_errors_for_project(&errors_by_root, &root_str, pname);
                Some(build_project_detail(&root_str, &[], &perrs))
            } else {
                None
            }
        });

    FullGainReport {
        telemetry_path: ledger_path,
        unique: query.unique,
        total_operations: events.len(),
        read_operations: read_ops,
        write_operations: write_ops,
        overhead_operations: overhead_ops,
        repeat_read_calls: repeat_reads,
        native_chars: nat_c,
        aice_chars: aice_c,
        saved_chars: sav_c,
        char_savings_pct: calc_pct(sav_c, nat_c),
        native_cl100k: nat_1,
        aice_cl100k: aice_1,
        saved_cl100k: sav_1,
        cl100k_savings_pct: calc_pct(sav_1, nat_1),
        native_o200k: nat_2,
        aice_o200k: aice_2,
        saved_o200k: sav_2,
        o200k_savings_pct: calc_pct(sav_2, nat_2),
        rule_budget_cl100k: rbe.rule_budget_cl100k,
        net_after_rule_budget_cl100k: rbe.net_after_rule_budget_cl100k,
        rule_break_even_multiple: rbe.rule_break_even_multiple,
        rule_break_even_reached: rbe.rule_break_even_reached,
        total_realistic_native_cl100k: economics.realistic_native_cl100k,
        total_realistic_saved_cl100k: economics.realistic_saved_cl100k,
        realistic_saved_cl100k_pct: calc_pct(
            economics.realistic_saved_cl100k,
            economics.realistic_native_cl100k,
        ),
        total_preserved_trivia_tokens: trivia_sum,
        economics,
        by_operation,
        by_language,
        projects,
        project_detail,
    }
}
