use std::collections::{BTreeSet, HashMap};
use std::path::Path;

pub(crate) fn index_rust_crates(
    known_files: &HashMap<String, usize>,
    root: &Path,
) -> HashMap<String, Vec<String>> {
    let mut crates: HashMap<String, Vec<String>> = HashMap::new();
    let mut crate_dirs: BTreeSet<(String, String)> = BTreeSet::new();
    let mut has_root_src = false;

    for path in known_files.keys() {
        if !path.ends_with(".rs") {
            continue;
        }
        if let Some(pos) = path.find("/src/") {
            let crate_dir = path[..pos].to_string();
            let src_root = format!("{crate_dir}/src");
            if let Some(dir_name) = crate_dir.rsplit('/').next() {
                register_crate_name(&mut crates, dir_name, &src_root);
            }
            crate_dirs.insert((crate_dir, src_root));
        } else if path.starts_with("src/") {
            has_root_src = true;
        }
    }

    if has_root_src {
        crate_dirs.insert((String::new(), "src".to_string()));
        if known_files.contains_key("src/lib.rs")
            && let Some(root_name) = root.file_name().and_then(|s| s.to_str())
        {
            register_crate_name(&mut crates, root_name, "src");
        }
    }

    for (crate_dir, src_root) in crate_dirs {
        let manifest = if crate_dir.is_empty() {
            root.join("Cargo.toml")
        } else {
            root.join(&crate_dir).join("Cargo.toml")
        };
        if manifest.is_file()
            && let Ok(text) = std::fs::read_to_string(&manifest)
        {
            for name in parse_cargo_crate_names(&text) {
                register_crate_name(&mut crates, &name, &src_root);
            }
        }
    }
    crates
}

fn register_crate_name(map: &mut HashMap<String, Vec<String>>, raw: &str, src_root: &str) {
    let snake = raw.trim().replace('-', "_");
    if snake.is_empty() {
        return;
    }
    let entry = map.entry(snake).or_default();
    if !entry.iter().any(|existing| existing == src_root) {
        entry.push(src_root.to_string());
    }
}

fn parse_cargo_crate_names(toml: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut section = "";
    for line in toml.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix('[')
            && let Some(end) = rest.find(']')
        {
            section = rest[..end].trim();
            continue;
        }
        if !matches!(section, "package" | "lib") {
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=')
            && k.trim() == "name"
        {
            let val = strip_toml_comment(v).trim();
            if val.len() >= 2
                && ((val.starts_with('"') && val.ends_with('"'))
                    || (val.starts_with('\'') && val.ends_with('\'')))
            {
                let name = &val[1..val.len() - 1];
                if !name.is_empty() && !out.iter().any(|x| x == name) {
                    out.push(name.to_string());
                }
            }
        }
    }
    out
}

fn strip_toml_comment(s: &str) -> &str {
    let mut in_dq = false;
    let mut in_sq = false;
    let mut esc = false;
    for (i, ch) in s.char_indices() {
        if esc {
            esc = false;
            continue;
        }
        match ch {
            '\\' if in_dq => esc = true,
            '"' if !in_sq => in_dq = !in_dq,
            '\'' if !in_dq => in_sq = !in_sq,
            '#' if !in_dq && !in_sq => return &s[..i],
            _ => {}
        }
    }
    s
}
