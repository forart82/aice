use std::path::Path;

use crate::dep_resolve::{WorkspaceIndex, parent_dir, probe_contained};

pub(crate) fn resolve_rust(
    from_norm: &str,
    from_dir: &str,
    spec: &str,
    idx: &WorkspaceIndex,
    root: &Path,
) -> Vec<String> {
    if let Some(m) = spec.strip_prefix("mod:") {
        let fstem = from_norm.strip_suffix(".rs").unwrap_or(from_norm);
        for cand in [format!("{m}.rs"), format!("{m}/mod.rs")] {
            if let Some(p) = probe_contained(from_dir, &cand, idx, root) {
                return vec![p];
            }
            if let Some(p) = probe_contained(fstem, &cand, idx, root) {
                return vec![p];
            }
        }
        return Vec::new();
    }
    let mut out = Vec::new();
    for item in expand_rust_braces(spec) {
        resolve_rust_item(from_norm, from_dir, &item, idx, root, &mut out);
    }
    out
}

pub(crate) fn resolve_rust_scoped_ref(
    from_norm: &str,
    from_dir: &str,
    spec: &str,
    idx: &WorkspaceIndex,
    root: &Path,
) -> Vec<String> {
    let mut out = Vec::new();
    resolve_rust_item(from_norm, from_dir, spec, idx, root, &mut out);
    out
}

fn resolve_rust_item(
    from_norm: &str,
    from_dir: &str,
    item: &str,
    idx: &WorkspaceIndex,
    root: &Path,
    out: &mut Vec<String>,
) {
    let raw = item
        .split(" as ")
        .next()
        .unwrap_or(item)
        .trim()
        .trim_start_matches("::")
        .trim_end_matches("::*");
    let clean = raw.strip_suffix("::self").unwrap_or(raw).trim();
    if clean.is_empty() {
        return;
    }

    if let Some(rest) = clean.strip_prefix("crate::") {
        let bases = crate_src_roots_for(from_norm, from_dir);
        let segs: Vec<&str> = rest.split("::").filter(|s| !s.is_empty()).collect();
        probe_rust_segs(&bases, &segs, true, idx, root, out);
        return;
    }
    if clean.starts_with("super::") {
        let mut rest = clean;
        let mut ups = 0usize;
        while let Some(r) = rest.strip_prefix("super::") {
            ups += 1;
            rest = r;
        }
        let is_mod_rs = from_norm == "mod.rs" || from_norm.ends_with("/mod.rs");
        let mut cur = from_dir;
        for _ in 0..ups {
            cur = parent_dir(cur);
        }
        let mut bases = vec![cur.to_string()];
        if !is_mod_rs {
            let mut alt = from_dir;
            for _ in 1..ups {
                alt = parent_dir(alt);
            }
            if alt != cur {
                bases.insert(0, alt.to_string());
            }
        }
        let segs: Vec<&str> = rest.split("::").filter(|s| !s.is_empty()).collect();
        probe_rust_segs(&bases, &segs, false, idx, root, out);
        return;
    }
    if let Some(rest) = clean.strip_prefix("self::") {
        let fstem = from_norm.strip_suffix(".rs").unwrap_or(from_norm);
        let mut bases = vec![from_dir.to_string()];
        if fstem != from_dir {
            bases.push(fstem.to_string());
        }
        let segs: Vec<&str> = rest.split("::").filter(|s| !s.is_empty()).collect();
        probe_rust_segs(&bases, &segs, false, idx, root, out);
        return;
    }

    let (crate_name, rest) = clean.split_once("::").unwrap_or((clean, ""));
    if let Some(crate_srcs) = idx.rust_crates.get(crate_name) {
        let segs: Vec<&str> = rest.split("::").filter(|s| !s.is_empty()).collect();
        for crate_src in crate_srcs {
            if let Some(p) = probe_submodules(crate_src, &segs, idx, root)
                .or_else(|| probe_contained(crate_src, "lib.rs", idx, root))
            {
                push_unique(out, p);
                break;
            }
        }
    }
}

fn crate_src_roots_for(from_norm: &str, from_dir: &str) -> Vec<String> {
    if let Some(pos) = from_norm.find("/src/") {
        let crate_src = &from_norm[..pos + 4];
        if from_norm[pos + 5..].starts_with("bin/") {
            return vec![from_dir.to_string(), crate_src.to_string()];
        }
        return vec![crate_src.to_string()];
    }
    if from_norm.starts_with("src/") {
        return vec!["src".to_string(), String::new()];
    }
    vec![from_dir.to_string(), "src".to_string(), String::new()]
}

fn probe_rust_segs(
    bases: &[String],
    segs: &[&str],
    allow_lib_fallback: bool,
    idx: &WorkspaceIndex,
    root: &Path,
    out: &mut Vec<String>,
) {
    for b in bases {
        if let Some(p) = probe_submodules(b, segs, idx, root) {
            push_unique(out, p);
            return;
        }
    }
    if allow_lib_fallback && segs.len() <= 1 {
        for b in bases {
            if let Some(p) = probe_contained(b, "lib.rs", idx, root) {
                push_unique(out, p);
                return;
            }
        }
    }
}

fn probe_submodules(
    base: &str,
    segs: &[&str],
    idx: &WorkspaceIndex,
    root: &Path,
) -> Option<String> {
    for take in (1..=segs.len()).rev() {
        let sub = segs[..take].join("/");
        if let Some(p) = probe_contained(base, &format!("{sub}.rs"), idx, root)
            .or_else(|| probe_contained(base, &format!("{sub}/mod.rs"), idx, root))
        {
            return Some(p);
        }
    }
    None
}

fn push_unique(out: &mut Vec<String>, p: String) {
    if !out.contains(&p) {
        out.push(p);
    }
}

fn expand_rust_braces(spec: &str) -> Vec<String> {
    let Some(open) = spec.find('{') else {
        return vec![spec.to_string()];
    };
    let Some(close) = find_matching_brace(spec, open) else {
        return vec![spec.to_string()];
    };
    let prefix = spec[..open].trim();
    let tail = spec[close + 1..].trim();
    let mut out = Vec::new();
    for part in split_top_level_commas(&spec[open + 1..close]) {
        let p = part.trim();
        if p.is_empty() {
            continue;
        }
        let joined = format!("{prefix}{p}{tail}");
        if joined.contains('{') {
            out.extend(expand_rust_braces(&joined));
        } else {
            out.push(joined);
        }
    }
    out
}

fn find_matching_brace(s: &str, open: usize) -> Option<usize> {
    let mut depth = 0usize;
    for (off, ch) in s[open..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(open + off);
                }
            }
            _ => {}
        }
    }
    None
}

fn split_top_level_commas(s: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let (mut depth, mut start) = (0usize, 0usize);
    for (idx, ch) in s.char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => {
                parts.push(&s[start..idx]);
                start = idx + 1;
            }
            _ => {}
        }
    }
    if start <= s.len() {
        parts.push(&s[start..]);
    }
    parts
}
