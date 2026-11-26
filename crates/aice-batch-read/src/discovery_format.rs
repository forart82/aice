use std::collections::BTreeMap;
use std::path::Path;

use aice_governance::escape_json_str;

use crate::budget::count_cl100k_exact;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveryEntry {
    pub rel_path: String,
    pub lines: usize,
    pub bytes: u64,
}

fn fmt_entry_item(name: &str, lines: usize, depth: Option<usize>) -> String {
    if depth.is_some() && lines <= 120 {
        name.to_string()
    } else {
        format!("{name} ({lines}L)")
    }
}

struct OutputGroup {
    prefix: String,
    items: Vec<String>,
}

fn render_groups(groups: &[OutputGroup], limit_items: usize) -> String {
    let mut rem_keep = limit_items;
    let mut lines = Vec::new();
    for g in groups {
        if rem_keep == 0 {
            break;
        }
        let take = rem_keep.min(g.items.len());
        lines.push(format!("{}{}", g.prefix, g.items[..take].join(", ")));
        rem_keep -= take;
    }
    if lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", lines.join("\n"))
    }
}

pub fn format_discovery_text(
    entries: &[DiscoveryEntry],
    boundary_dirs: &[String],
    depth: Option<usize>,
    max_tokens: usize,
) -> String {
    if entries.is_empty() && boundary_dirs.is_empty() {
        return String::new();
    }

    let mut groups: Vec<OutputGroup> = Vec::new();
    if entries.len() <= 3 && boundary_dirs.is_empty() {
        for e in entries {
            groups.push(OutputGroup {
                prefix: String::new(),
                items: vec![fmt_entry_item(&e.rel_path, e.lines, depth)],
            });
        }
    } else {
        let mut by_dir: BTreeMap<String, Vec<&DiscoveryEntry>> = BTreeMap::new();
        for e in entries {
            let dir = e
                .rel_path
                .rsplit_once('/')
                .map(|(d, _)| d.to_string())
                .unwrap_or_default();
            by_dir.entry(dir).or_default().push(e);
        }
        if let Some(root_files) = by_dir.remove("") {
            let joined = root_files
                .iter()
                .map(|e| fmt_entry_item(&e.rel_path, e.lines, depth))
                .collect();
            groups.push(OutputGroup {
                prefix: String::new(),
                items: joined,
            });
        }
        for (dir, items) in &by_dir {
            if items.len() > 1 {
                let names = items
                    .iter()
                    .map(|e| {
                        let base = e.rel_path.rsplit('/').next().unwrap_or(&e.rel_path);
                        fmt_entry_item(base, e.lines, depth)
                    })
                    .collect();
                groups.push(OutputGroup {
                    prefix: format!("{dir}/: "),
                    items: names,
                });
            } else if let Some(only) = items.first() {
                groups.push(OutputGroup {
                    prefix: String::new(),
                    items: vec![fmt_entry_item(&only.rel_path, only.lines, depth)],
                });
            }
        }
        for bd in boundary_dirs {
            let clean = bd.trim_end_matches('/');
            if !clean.is_empty() && !by_dir.contains_key(clean) {
                groups.push(OutputGroup {
                    prefix: String::new(),
                    items: vec![format!("{clean}/")],
                });
            }
        }
    }

    let total_items: usize = groups.iter().map(|g| g.items.len()).sum();
    let full = render_groups(&groups, total_items);
    if count_cl100k_exact(&full) <= max_tokens {
        return full;
    }
    if max_tokens == 0 {
        return String::new();
    }

    let mut lo = 0usize;
    let mut hi = total_items.saturating_sub(1);
    while lo < hi {
        let mid = lo + (hi - lo).div_ceil(2);
        let rem = total_items - mid;
        let hint = discovery_footer(rem, max_tokens);
        let body = render_groups(&groups, mid);
        let candidate = format!("{body}{hint}");
        if count_cl100k_exact(&candidate) <= max_tokens {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }

    let rem = total_items - lo;
    let body = render_groups(&groups, lo);
    if rem == 0 {
        body
    } else {
        let footer = discovery_footer(rem, max_tokens);
        let candidate = format!("{body}{footer}");
        if count_cl100k_exact(&candidate) <= max_tokens {
            candidate
        } else {
            discovery_footer(total_items, max_tokens)
        }
    }
}

fn discovery_footer(rem: usize, max_tokens: usize) -> String {
    if rem == 0 || max_tokens == 0 {
        return String::new();
    }
    let long = format!("// +{rem} more entries (use aice find <subdir> or --search <pat>)\n");
    let med = format!("// +{rem} more entries\n");
    let short = format!("// +{rem} more\n");
    for cand in [long.as_str(), med.as_str(), short.as_str(), "// ...\n"] {
        if count_cl100k_exact(cand) <= max_tokens {
            return cand.to_string();
        }
    }
    String::new()
}

pub fn format_discovery_json(project_root: &Path, entries: &[DiscoveryEntry]) -> String {
    let mut out = String::from("{\n  \"mode\": \"files\",\n  \"projectRoot\": ");
    escape_json_str(&project_root.display().to_string(), &mut out);
    out.push_str(",\n  \"count\": ");
    out.push_str(&entries.len().to_string());
    out.push_str(",\n  \"files\": [");
    if entries.is_empty() {
        out.push_str("]\n}\n");
        return out;
    }
    out.push('\n');
    for (idx, e) in entries.iter().enumerate() {
        if idx > 0 {
            out.push_str(",\n");
        }
        let size_kb = if e.bytes == 0 {
            "0".to_string()
        } else {
            let rounded = (((e.bytes as f64) / 1024.0) * 10.0).round() / 10.0;
            format!("{:.1}", rounded.max(0.1))
        };
        out.push_str("    {\n      \"path\": ");
        escape_json_str(&e.rel_path, &mut out);
        out.push_str(&format!(
            ",\n      \"lines\": {},\n      \"bytes\": {},\n      \"sizeKB\": {}\n    }}",
            e.lines, e.bytes, size_kb
        ));
    }
    out.push_str("\n  ]\n}\n");
    out
}

pub fn build_fd_baseline(entries: &[DiscoveryEntry], boundary_dirs: &[String]) -> String {
    let mut all: Vec<String> = Vec::with_capacity(entries.len() + boundary_dirs.len());
    for bd in boundary_dirs {
        let clean = bd.trim_end_matches('/');
        if !clean.is_empty() {
            all.push(format!("{clean}/"));
        }
    }
    for e in entries {
        all.push(e.rel_path.clone());
    }
    all.sort();
    all.dedup();
    if all.is_empty() {
        String::new()
    } else {
        format!("{}\n", all.join("\n"))
    }
}
