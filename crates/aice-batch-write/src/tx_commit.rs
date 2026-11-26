use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use aice_ast_engine::DefaultSyntaxFirewall;
use aice_governance::{Governed, WriteOp};
use aice_lang_registry::{FirewallVerdict, LanguageId, SyntaxFirewall, detect_language};

use crate::aice_lower::decompile_to_aice;
use crate::diagnostics::format_firewall_diagnostics;
use crate::diff::{format_splice_json, render_dry_run_diff};
use crate::span_patch::apply_item_to_vfs;
use crate::tx_order::build_execution_order;
use crate::tx_rollback::{RollbackEntry, rollback_disk};
use crate::types::{
    BatchSpliceItem, BatchWriteReport, EditSummary, JsonBatchEdit, JsonSpliceInfo, VirtualFile,
    detect_eol,
};

pub const TOKENS_SAVED_PLACEHOLDER: &str = "__AICE_TOKENS_SAVED__";
static TMP_SEQ: AtomicU64 = AtomicU64::new(1);

fn rel_label(root: &Path, abs: &Path) -> String {
    abs.strip_prefix(root)
        .unwrap_or(abs)
        .to_string_lossy()
        .replace('\\', "/")
}

pub(crate) fn resolve_authorized<'a>(
    governed: &'a Governed,
    item_path: &Path,
) -> Result<&'a aice_governance::AuthorizedPath, String> {
    let abs = if item_path.is_absolute() {
        item_path.to_path_buf()
    } else {
        governed.cwd().join(item_path)
    };
    governed
        .authorized_paths()
        .iter()
        .find(|ap| ap.requested == abs || ap.canonical == abs)
        .ok_or_else(|| format!("governance rejected unauthorized write target: {}", item_path.display()))
}

fn load_vfs(
    governed: &Governed,
    items: &[BatchSpliceItem],
) -> Result<BTreeMap<PathBuf, VirtualFile>, String> {
    let mut vfs: BTreeMap<PathBuf, VirtualFile> = BTreeMap::new();
    for item in items {
        let ap = resolve_authorized(governed, &item.file_path)?;
        if ap.is_binary {
            return Err(format!("Refusing to write or splice binary file \"{}\"", ap.canonical.display()));
        }
        if vfs.contains_key(&ap.canonical) {
            continue;
        }
        let existed = ap.canonical.exists();
        let orig = if existed {
            let bytes = fs::read(&ap.canonical)
                .map_err(|e| format!("Failed reading {}: {e}", ap.canonical.display()))?;
            if bytes.contains(&0) {
                return Err(format!(
                    "Refusing to write or splice binary file \"{}\" (contains NUL byte)",
                    ap.canonical.display()
                ));
            }
            Some(
                String::from_utf8(bytes)
                    .map_err(|_| format!("Refusing to splice non-UTF-8 file \"{}\"", ap.canonical.display()))?,
            )
        } else {
            None
        };
        let current = orig.clone().unwrap_or_default();
        let eol = detect_eol(&current);
        vfs.insert(
            ap.canonical.clone(),
            VirtualFile {
                canonical: ap.canonical.clone(),
                display: item.requested_display.clone(),
                rel_label: rel_label(governed.project_root(), &ap.canonical),
                original_disk: orig,
                current,
                existed_on_disk: existed,
                eol,
                replaced_baselines: Vec::new(),
                preserved_trivia: Vec::new(),
            },
        );
    }
    Ok(vfs)
}

fn ensure_parent_dirs(parent: &Path, created_dirs: &mut Vec<PathBuf>) -> Result<(), String> {
    if parent.as_os_str().is_empty() || parent.exists() {
        return Ok(());
    }
    let mut missing = Vec::new();
    let mut cur = parent.to_path_buf();
    while !cur.exists() {
        missing.push(cur.clone());
        let Some(p) = cur.parent() else { break; };
        cur = p.to_path_buf();
    }
    for dir in missing.into_iter().rev() {
        if !dir.exists() {
            fs::create_dir(&dir)
                .map_err(|e| format!("Failed creating directory {}: {e}", dir.display()))?;
            created_dirs.push(dir);
        }
    }
    Ok(())
}

fn commit_vfs_atomically(vfs: &BTreeMap<PathBuf, VirtualFile>) -> Result<(), String> {
    let (mut created_dirs, mut backups, mut temps, mut staged) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for vf in vfs.values().filter(|v| v.has_changed()) {
        let parent = vf
            .canonical
            .parent()
            .ok_or_else(|| format!("Invalid parent for {}", vf.canonical.display()))?;
        if let Err(e) = ensure_parent_dirs(parent, &mut created_dirs) {
            rollback_disk(backups, created_dirs, temps);
            return Err(e);
        }
        let orig_bytes = vf.original_disk.as_ref().map(|s| s.as_bytes().to_vec());
        let orig_perms = if vf.existed_on_disk {
            fs::metadata(&vf.canonical).ok().map(|m| m.permissions())
        } else {
            None
        };
        backups.push(RollbackEntry { target: vf.canonical.clone(), orig_bytes, orig_perms });
        let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
        let tmp = parent.join(format!(".aice.tmp.{}.{seq}", std::process::id()));
        let mut f = match OpenOptions::new().write(true).create_new(true).open(&tmp) {
            Ok(f) => f,
            Err(e) => {
                rollback_disk(backups, created_dirs, temps);
                return Err(format!("Failed creating temp file {}: {e}", tmp.display()));
            }
        };
        temps.push(tmp.clone());
        if let Err(e) = f.write_all(vf.current.as_bytes()).and_then(|_| f.sync_all()) {
            rollback_disk(backups, created_dirs, temps);
            return Err(format!("Failed writing temp file {}: {e}", tmp.display()));
        }
        if let Some(perms) = backups.last().and_then(|b| b.orig_perms.as_ref()) {
            let _ = fs::set_permissions(&tmp, perms.clone());
        }
        staged.push((tmp, vf.canonical.clone()));
    }
    for (tmp, target) in staged {
        if let Err(e) = fs::rename(&tmp, &target) {
            rollback_disk(backups, created_dirs, temps);
            return Err(format!("Failed committing {}: {e}", target.display()));
        }
    }
    Ok(())
}

pub fn run_transaction(
    governed: &Governed,
    op: &WriteOp,
    items: &[BatchSpliceItem],
    label: String,
) -> BatchWriteReport {
    let pre_batch = items.len() > 1 || op.batch.is_some() || op.edits.is_some();
    let mut vfs = match load_vfs(governed, items) {
        Ok(v) => v,
        Err(e) => return err_report(e, label, pre_batch),
    };
    let is_batch = vfs.len() > 1 || pre_batch;
    let exec_order = match build_execution_order(governed, items) {
        Ok(ord) => ord,
        Err(e) => return err_report(e, label, is_batch),
    };
    let mut summary_slots: Vec<Option<EditSummary>> = vec![None; items.len()];
    for orig_idx in exec_order {
        let item = &items[orig_idx];
        let Ok(ap) = resolve_authorized(governed, &item.file_path) else {
            return err_report(format!("Unauthorized target {}", item.file_path.display()), label, is_batch);
        };
        let vf = vfs.get_mut(&ap.canonical).expect("loaded in vfs");
        match apply_item_to_vfs(vf, item) {
            Ok(s) => summary_slots[orig_idx] = Some(s),
            Err(e) => return err_report(e, label, is_batch),
        }
    }
    let summaries: Vec<EditSummary> = summary_slots.into_iter().flatten().collect();
    let fw = DefaultSyntaxFirewall;
    for vf in vfs.values().filter(|v| v.has_changed()) {
        let lang = detect_language(&vf.canonical, &vf.current);
        if let FirewallVerdict::Invalid { diagnostics } =
            fw.verify_incremental(vf.original_disk.as_deref(), &vf.current, &vf.canonical, lang)
        {
            return err_report(
                format_firewall_diagnostics(Path::new(&vf.display), lang, &vf.current, &diagnostics),
                label,
                is_batch,
            );
        }
        if lang == LanguageId::Python {
            let walrus_diags =
                crate::py_walrus::verify_py_walrus_delta(vf.original_disk.as_deref(), &vf.current);
            if !walrus_diags.is_empty() {
                return err_report(
                    format_firewall_diagnostics(Path::new(&vf.display), lang, &vf.current, &walrus_diags),
                    label,
                    is_batch,
                );
            }
        }
    }
    if !op.dry_run
        && let Err(e) = commit_vfs_atomically(&vfs)
    {
        return err_report(e, label, is_batch);
    }
    build_success_report(op, &vfs, &summaries, label)
}

fn err_report(msg: String, label: String, is_batch_rollback: bool) -> BatchWriteReport {
    BatchWriteReport {
        raw_baseline: String::new(), emitted_output: msg, file_label: label, exit_code: 1,
        multi_files: Vec::new(), primary_lang: None, realistic_native_payload: None,
        preserved_trivia_text: String::new(), is_batch_rollback,
        banner_needs_tokens: false, json_info: None,
    }
}

fn build_success_report(
    op: &WriteOp,
    vfs: &BTreeMap<PathBuf, VirtualFile>,
    summaries: &[EditSummary],
    label: String,
) -> BatchWriteReport {
    let raw_baseline = vfs.values().flat_map(|v| v.replaced_baselines.iter().cloned()).collect::<Vec<_>>().join("\n");
    let preserved_trivia_text = vfs.values().flat_map(|v| v.preserved_trivia.iter().cloned()).collect::<Vec<_>>().join("\n");
    let multi_files: Vec<String> = vfs.values().map(|v| v.rel_label.clone()).collect();
    let primary_lang = (vfs.len() == 1).then(|| vfs.values().next().map(|v| detect_language(&v.canonical, &v.current))).flatten();
    let (mut json_info, mut banner_needs_tokens) = (None, false);
    let emitted_output = if op.json {
        let last = summaries.last().expect("edit");
        let vf = vfs.get(&last.file_canonical).expect("matching virtual file");
        let lang = detect_language(&vf.canonical, &vf.current);
        let is_multi = vfs.len() > 1 || summaries.len() > 1;
        let modified_files = if is_multi {
            vfs.values().filter(|v| v.has_changed()).map(|v| v.canonical.display().to_string()).collect()
        } else { Vec::new() };
        let batch_edits = if is_multi {
            summaries.iter().map(|s| JsonBatchEdit {
                file_path: s.file_canonical.display().to_string(),
                symbol: s.symbol_label.clone(),
                start_line: s.start_line,
                end_line: s.end_line,
                original_snippet: s.original_snippet.clone(),
                new_snippet: s.new_snippet.clone(),
            }).collect()
        } else { Vec::new() };
        let info = JsonSpliceInfo {
            success: true, file_path: vf.canonical.display().to_string(), symbol: last.symbol_label.clone(),
            start_line: last.start_line, end_line: last.end_line, original_snippet: last.original_snippet.clone(),
            new_snippet: last.new_snippet.clone(), modified_code: vf.current.clone(),
            new_aice_source: decompile_to_aice(&vf.current, lang), preserved_trivia_text: preserved_trivia_text.clone(),
            dry_run: op.dry_run, modified_files, batch_edits,
        };
        let preview = format_splice_json(&info, 0, 0, 0);
        json_info = Some(info);
        preview
    } else if op.diff {
        render_dry_run_diff(vfs)
    } else if summaries.len() == 1 && vfs.len() == 1 {
        banner_needs_tokens = true;
        let (s, pfx) = (&summaries[0], if op.dry_run { "[Dry Run] " } else { "" });
        format!("{pfx}✔ {} '{}' in {} ({TOKENS_SAVED_PLACEHOLDER} tokens saved)\n", s.verb, s.symbol_label, s.file_rel)
    } else {
        banner_needs_tokens = true;
        let tags: Vec<String> = summaries.iter().map(|s| format!("{}:{}", s.file_rel, s.symbol_label)).collect();
        let pfx = if op.dry_run { "[Dry Run] " } else { "" };
        format!("{pfx}✔ Batch spliced {} item(s) across {} file(s) ({TOKENS_SAVED_PLACEHOLDER} tokens saved) [{}]\n", summaries.len(), vfs.len(), tags.join(", "))
    };
    BatchWriteReport {
        raw_baseline, emitted_output, file_label: label, exit_code: 0, multi_files, primary_lang,
        realistic_native_payload: None, preserved_trivia_text,
        is_batch_rollback: false, banner_needs_tokens, json_info,
    }
}
