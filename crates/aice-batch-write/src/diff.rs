use std::collections::BTreeMap;
use std::path::PathBuf;

use aice_governance::escape_json_str;

use crate::types::{JsonSpliceInfo, VirtualFile, split_lines_keep};

fn compute_lcs_ops<'a>(a: &'a [String], b: &'a [String]) -> Vec<(char, &'a str)> {
    let (n, m) = (a.len(), b.len());
    if n.saturating_mul(m) > 250_000 {
        let mut ops = Vec::with_capacity(n + m);
        for l in a { ops.push(('-', l.as_str())); }
        for l in b { ops.push(('+', l.as_str())); }
        return ops;
    }
    let mut dp = vec![vec![0u32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            dp[i][j] = if a[i] == b[j] {
                dp[i + 1][j + 1] + 1
            } else {
                dp[i + 1][j].max(dp[i][j + 1])
            };
        }
    }
    let (mut i, mut j) = (0, 0);
    let mut ops = Vec::new();
    while i < n && j < m {
        if a[i] == b[j] {
            ops.push((' ', a[i].as_str()));
            i += 1;
            j += 1;
        } else if dp[i + 1][j] >= dp[i][j + 1] {
            ops.push(('-', a[i].as_str()));
            i += 1;
        } else {
            ops.push(('+', b[j].as_str()));
            j += 1;
        }
    }
    while i < n { ops.push(('-', a[i].as_str())); i += 1; }
    while j < m { ops.push(('+', b[j].as_str())); j += 1; }
    ops
}

pub fn unified_diff(display_path: &str, old: &str, new: &str) -> String {
    let (a, _) = split_lines_keep(old);
    let (b, _) = split_lines_keep(new);
    let ops = compute_lcs_ops(&a, &b);
    let mut out = format!("--- a/{display_path}\n+++ b/{display_path}\n");
    let mut changed_idxs = Vec::new();
    for (idx, &(tag, _)) in ops.iter().enumerate() {
        if tag != ' ' { changed_idxs.push(idx); }
    }
    if changed_idxs.is_empty() {
        return out;
    }
    let mut groups: Vec<(usize, usize)> = Vec::new();
    for idx in changed_idxs {
        let s = idx.saturating_sub(3);
        let e = (idx + 4).min(ops.len());
        if let Some(last) = groups.last_mut() && s <= last.1 {
            last.1 = last.1.max(e);
        } else {
            groups.push((s, e));
        }
    }
    for (gs, ge) in groups {
        let (mut old_line, mut new_line) = (1usize, 1usize);
        for &(tag, _) in &ops[..gs] {
            if tag != '+' { old_line += 1; }
            if tag != '-' { new_line += 1; }
        }
        let old_cnt = ops[gs..ge].iter().filter(|(t, _)| *t != '+').count();
        let new_cnt = ops[gs..ge].iter().filter(|(t, _)| *t != '-').count();
        out.push_str(&format!("@@ -{old_line},{old_cnt} +{new_line},{new_cnt} @@\n"));
        for &(tag, line) in &ops[gs..ge] {
            out.push(tag);
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

pub fn render_dry_run_diff(vfs: &BTreeMap<PathBuf, VirtualFile>) -> String {
    let mut out = String::new();
    for vf in vfs.values() {
        if vf.has_changed() {
            let orig = vf.original_disk.as_deref().unwrap_or("");
            out.push_str(&unified_diff(&vf.canonical.display().to_string(), orig, &vf.current));
            out.push_str(&format!("[Dry Run] Successfully spliced {}\n{}\n", vf.rel_label, vf.current));
        }
    }
    if out.is_empty() {
        out.push_str("[Dry Run] No changes\n");
    }
    out
}

fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    escape_json_str(s, &mut out);
    out
}

pub fn format_splice_json(
    info: &JsonSpliceInfo,
    tokens_saved: isize,
    preserved_trivia_tokens: usize,
    realistic_tokens_saved: isize,
) -> String {
    let mut out = format!(
        concat!(
            "{{\n",
            "  \"success\": {},\n",
            "  \"filePath\": {},\n",
            "  \"symbol\": {},\n",
            "  \"startLine\": {},\n",
            "  \"endLine\": {},\n",
            "  \"originalSnippet\": {},\n",
            "  \"newSnippet\": {},\n",
            "  \"modifiedCode\": {},\n",
            "  \"newAiceSource\": {},\n",
            "  \"tokensSaved\": {},\n",
            "  \"preservedTriviaTokens\": {},\n",
            "  \"realisticTokensSaved\": {},\n",
            "  \"dryRun\": {}"
        ),
        info.success,
        esc(&info.file_path),
        esc(&info.symbol),
        info.start_line,
        info.end_line,
        esc(&info.original_snippet),
        esc(&info.new_snippet),
        esc(&info.modified_code),
        esc(&info.new_aice_source),
        tokens_saved,
        preserved_trivia_tokens,
        realistic_tokens_saved,
        info.dry_run
    );
    if !info.batch_edits.is_empty() || !info.modified_files.is_empty() {
        let files: Vec<String> = info.modified_files.iter().map(|f| esc(f)).collect();
        let results: Vec<String> = info
            .batch_edits
            .iter()
            .map(|e| {
                format!(
                    "{{\"filePath\": {}, \"symbol\": {}, \"startLine\": {}, \"endLine\": {}, \"originalSnippet\": {}, \"newSnippet\": {}}}",
                    esc(&e.file_path),
                    esc(&e.symbol),
                    e.start_line,
                    e.end_line,
                    esc(&e.original_snippet),
                    esc(&e.new_snippet)
                )
            })
            .collect();
        out.push_str(&format!(
            ",\n  \"modifiedFiles\": [{}],\n  \"totalFiles\": {},\n  \"totalEdits\": {},\n  \"results\": [{}]",
            files.join(", "),
            info.modified_files.len(),
            info.batch_edits.len(),
            results.join(", ")
        ));
    }
    out.push_str("\n}\n");
    out
}
