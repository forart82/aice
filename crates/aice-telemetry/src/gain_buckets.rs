use std::collections::BTreeMap;
use std::path::Path;

use aice_governance::load_config;

use crate::economics::{RepeatReadTracker, calc_pct, compute_project_systemic_economics};
use crate::error_log::TelemetryErrorEvent;
use crate::gain_types::{
    FileGainBucket, LanguageBucket, OperationBucket, ProjectDetailReport, ProjectGainSummary,
};
use crate::record::TelemetryEvent;

pub(crate) fn summarize_project(
    root: &str,
    name: &str,
    events: &[TelemetryEvent],
    errors: &[TelemetryErrorEvent],
) -> ProjectGainSummary {
    let mut tracker = RepeatReadTracker::default();
    let (mut rc, mut wc, mut oc, mut rrc) = (0, 0, 0, 0);
    let (mut nc, mut ac, mut sc, mut n1, mut a1, mut s1, mut n2, mut a2, mut s2) =
        (0, 0, 0, 0, 0, 0, 0, 0, 0);
    for ev in events {
        if tracker.check_and_advance(ev) {
            rrc += 1;
        }
        if ev.is_write {
            wc += 1;
        } else {
            rc += 1;
        }
        if ev.realistic_saved() <= 0 {
            oc += 1;
        }
        nc += ev.native_chars;
        ac += ev.aice_chars;
        sc += ev.saved_chars;
        n1 += ev.native_cl100k;
        a1 += ev.aice_cl100k;
        s1 += ev.saved_cl100k;
        n2 += ev.native_o200k;
        a2 += ev.aice_o200k;
        s2 += ev.saved_o200k;
    }
    ProjectGainSummary {
        project_root: root.to_string(),
        project_name: name.to_string(),
        calls: events.len(),
        read_calls: rc,
        write_calls: wc,
        overhead_calls: oc,
        repeat_read_calls: rrc,
        native_chars: nc,
        aice_chars: ac,
        saved_chars: sc,
        native_cl100k: n1,
        aice_cl100k: a1,
        saved_cl100k: s1,
        savings_pct: calc_pct(s1, n1),
        native_o200k: n2,
        aice_o200k: a2,
        saved_o200k: s2,
        o200k_savings_pct: calc_pct(s2, n2),
        economics: compute_project_systemic_economics(events, errors),
    }
}

pub(crate) fn build_project_detail(
    root: &str,
    events: &[TelemetryEvent],
    errors: &[TelemetryErrorEvent],
) -> ProjectDetailReport {
    let name = Path::new(root)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("root")
        .to_string();
    let cfg = if Path::new(root).exists() {
        load_config(Path::new(root))
    } else {
        Default::default()
    };
    let mut op_map = BTreeMap::new();
    let mut file_map: BTreeMap<String, FileGainBucket> = BTreeMap::new();
    let mut tracker = RepeatReadTracker::default();
    for ev in events {
        let rep = tracker.check_and_advance(ev);
        accumulate_op(&mut op_map, ev);
        let fb = file_map.entry(ev.file_path.clone()).or_insert(FileGainBucket {
            file_path: ev.file_path.clone(),
            language: ev.language.clone(),
            calls: 0,
            repeat_read_calls: 0,
            native_cl100k: 0,
            aice_cl100k: 0,
            saved_cl100k: 0,
            savings_pct: 0.0,
            realistic_native_cl100k: 0,
            realistic_saved_cl100k: 0,
            realistic_savings_pct: 0.0,
            native_o200k: 0,
            aice_o200k: 0,
            saved_o200k: 0,
        });
        fb.calls += 1;
        if rep {
            fb.repeat_read_calls += 1;
        }
        fb.native_cl100k += ev.native_cl100k;
        fb.aice_cl100k += ev.aice_cl100k;
        fb.saved_cl100k += ev.saved_cl100k;
        fb.realistic_native_cl100k += ev.realistic_native();
        fb.realistic_saved_cl100k += ev.realistic_saved();
        fb.native_o200k += ev.native_o200k;
        fb.aice_o200k += ev.aice_o200k;
        fb.saved_o200k += ev.saved_o200k;
        fb.savings_pct = calc_pct(fb.saved_cl100k, fb.native_cl100k);
        fb.realistic_savings_pct =
            calc_pct(fb.realistic_saved_cl100k, fb.realistic_native_cl100k);
    }
    let mut by_operation: Vec<OperationBucket> = op_map.into_values().map(finalize_op).collect();
    by_operation.sort_by_key(|a| std::cmp::Reverse(a.realistic_saved_cl100k));
    let mut top_files: Vec<FileGainBucket> = file_map.into_values().collect();
    top_files.sort_by_key(|a| a.realistic_saved_cl100k);
    let recent_operations = events.iter().rev().take(15).cloned().collect();
    ProjectDetailReport {
        project_root: root.to_string(),
        project_name: name.clone(),
        enabled: cfg.enabled,
        summary: summarize_project(root, &name, events, errors),
        by_operation,
        top_files,
        recent_operations,
    }
}

pub(crate) fn normalize_root(raw: &str) -> String {
    let replaced = raw.trim().replace('\\', "/");
    let trimmed = replaced.trim_end_matches('/');
    if trimmed.is_empty() && replaced.starts_with('/') {
        "/".to_string()
    } else {
        trimmed.to_string()
    }
}

pub(crate) fn get_errors_for_project(
    map: &BTreeMap<String, Vec<TelemetryErrorEvent>>,
    root: &str,
    name: &str,
) -> Vec<TelemetryErrorEvent> {
    if let Some(exact) = map.get(root) {
        return exact.clone();
    }
    let norm_root = normalize_root(root);
    let mut matched = Vec::new();
    for (k, list) in map {
        if !norm_root.is_empty() && normalize_root(k) == norm_root {
            matched.extend(list.iter().cloned());
        }
    }
    if !matched.is_empty() {
        return matched;
    }
    for (k, list) in map {
        if !k.contains('/')
            && !k.contains('\\')
            && k != "<unknown>"
            && Path::new(k)
                .file_name()
                .and_then(|s| s.to_str())
                .is_some_and(|b| b.eq_ignore_ascii_case(name))
        {
            matched.extend(list.iter().cloned());
        }
    }
    matched
}

pub(crate) fn accumulate_op(
    map: &mut BTreeMap<(String, String), OperationBucket>,
    ev: &TelemetryEvent,
) {
    let b = map
        .entry((ev.operation.clone(), ev.surface.clone()))
        .or_insert(OperationBucket {
            operation: ev.operation.clone(),
            surface: ev.surface.clone(),
            calls: 0,
            native_chars: 0,
            aice_chars: 0,
            saved_chars: 0,
            native_cl100k: 0,
            aice_cl100k: 0,
            saved_cl100k: 0,
            savings_pct: 0.0,
            realistic_native_cl100k: 0,
            realistic_saved_cl100k: 0,
            realistic_savings_pct: 0.0,
            native_o200k: 0,
            aice_o200k: 0,
            saved_o200k: 0,
            o200k_savings_pct: 0.0,
        });
    b.calls += 1;
    b.native_chars += ev.native_chars;
    b.aice_chars += ev.aice_chars;
    b.saved_chars += ev.saved_chars;
    b.native_cl100k += ev.native_cl100k;
    b.aice_cl100k += ev.aice_cl100k;
    b.saved_cl100k += ev.saved_cl100k;
    b.realistic_native_cl100k += ev.realistic_native();
    b.realistic_saved_cl100k += ev.realistic_saved();
    b.native_o200k += ev.native_o200k;
    b.aice_o200k += ev.aice_o200k;
    b.saved_o200k += ev.saved_o200k;
}

pub(crate) fn finalize_op(mut b: OperationBucket) -> OperationBucket {
    b.savings_pct = calc_pct(b.saved_cl100k, b.native_cl100k);
    b.realistic_savings_pct = calc_pct(b.realistic_saved_cl100k, b.realistic_native_cl100k);
    b.o200k_savings_pct = calc_pct(b.saved_o200k, b.native_o200k);
    b
}

pub(crate) fn accumulate_lang(map: &mut BTreeMap<String, LanguageBucket>, ev: &TelemetryEvent) {
    let b = map.entry(ev.language.clone()).or_insert(LanguageBucket {
        language: ev.language.clone(),
        calls: 0,
        native_cl100k: 0,
        aice_cl100k: 0,
        saved_cl100k: 0,
        savings_pct: 0.0,
        realistic_native_cl100k: 0,
        realistic_saved_cl100k: 0,
        realistic_savings_pct: 0.0,
        native_o200k: 0,
        aice_o200k: 0,
        saved_o200k: 0,
    });
    b.calls += 1;
    b.native_cl100k += ev.native_cl100k;
    b.aice_cl100k += ev.aice_cl100k;
    b.saved_cl100k += ev.saved_cl100k;
    b.realistic_native_cl100k += ev.realistic_native();
    b.realistic_saved_cl100k += ev.realistic_saved();
    b.native_o200k += ev.native_o200k;
    b.aice_o200k += ev.aice_o200k;
    b.saved_o200k += ev.saved_o200k;
}

pub(crate) fn finalize_lang(mut b: LanguageBucket) -> LanguageBucket {
    b.savings_pct = calc_pct(b.saved_cl100k, b.native_cl100k);
    b.realistic_savings_pct = calc_pct(b.realistic_saved_cl100k, b.realistic_native_cl100k);
    b
}
