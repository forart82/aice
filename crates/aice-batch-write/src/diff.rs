use std::collections::BTreeMap;
use std::path::PathBuf;

use aice_governance::escape_json_str;

use crate::types::{JsonSpliceInfo, VirtualFile, split_lines_keep};

fn compute_lcs_ops<'a>(a: &'a [String], b: &'a [String]) -> Vec<(char, &'a str)> {
    let mut prefix = 0;
    while prefix < a.len() && prefix < b.len() && a[prefix] == b[prefix] {
        prefix += 1;
    }
    let mut suffix = 0;
    let max_suffix = (a.len() - prefix).min(b.len() - prefix);
    while suffix < max_suffix && a[a.len() - 1 - suffix] == b[b.len() - 1 - suffix] {
        suffix += 1;
    }
    let mid_a = &a[prefix..a.len() - suffix];
    let mid_b = &b[prefix..b.len() - suffix];
    let (n, m) = (mid_a.len(), mid_b.len());

    let mut ops = Vec::with_capacity(prefix + suffix + n + m);
    for l in &a[..prefix] {
        ops.push((' ', l.as_str()));
    }
    if n == 0 {
        for l in mid_b { ops.push(('+', l.as_str())); }
    } else if m == 0 {
        for l in mid_a { ops.push(('-', l.as_str())); }
    } else if n.saturating_mul(m) > 250_000 {
        for l in mid_a { ops.push(('-', l.as_str())); }
        for l in mid_b { ops.push(('+', l.as_str())); }
    } else {
        let mut dp = vec![vec![0u32; m + 1]; n + 1];
        for i in (0..n).rev() {
            for j in (0..m).rev() {
                dp[i][j] = if mid_a[i] == mid_b[j] {
                    dp[i + 1][j + 1] + 1
                } else {
                    dp[i + 1][j].max(dp[i][j + 1])
                };
            }
        }
        let (mut i, mut j) = (0, 0);
        while i < n && j < m {
            if mid_a[i] == mid_b[j] {
                ops.push((' ', mid_a[i].as_str()));
                i += 1;
                j += 1;
            } else if dp[i + 1][j] >= dp[i][j + 1] {
                ops.push(('-', mid_a[i].as_str()));
                i += 1;
            } else {
                ops.push(('+', mid_b[j].as_str()));
                j += 1;
            }
        }
        while i < n { ops.push(('-', mid_a[i].as_str())); i += 1; }
        while j < m { ops.push(('+', mid_b[j].as_str())); j += 1; }
    }
    for l in &a[a.len() - suffix..] {
        ops.push((' ', l.as_str()));
    }
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
            out.push_str(&format!("[Dry Run] Successfully spliced {}\n", vf.rel_label));
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
