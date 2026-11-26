use std::path::Path;

use aice_lang_registry::LanguageId;

use crate::dep_callers_other_ext::{split_as_ci, strip_kw_ci, strip_php_kind};
use crate::dep_resolve::{WorkspaceIndex, parent_dir, probe_contained};
use crate::dep_resolve_cs::resolve_csharp;
use crate::dep_resolve_jvm::resolve_jvm;
use crate::r5::php_lang::strip_php_comments;

pub(crate) fn resolve_import(
    from_idx: usize,
    lang: LanguageId,
    from_norm: &str,
    from_dir: &str,
    spec: &str,
    idx: &WorkspaceIndex,
    root: &Path,
) -> Vec<String> {
    match lang {
        LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript => {
            resolve_ts_js(from_dir, spec, idx, root).into_iter().collect()
        }
        LanguageId::Python => resolve_python(from_dir, spec, idx, root).into_iter().collect(),
        LanguageId::Rust => resolve_rust(from_norm, from_dir, spec, idx, root),
        LanguageId::Go => resolve_go(from_idx, spec, idx),
        LanguageId::Java | LanguageId::Kotlin => resolve_jvm(lang, spec, idx, root),
        LanguageId::CSharp => resolve_csharp(spec, idx, root),
        LanguageId::C | LanguageId::Cpp => {
            resolve_c_cpp(from_dir, spec, idx, root).into_iter().collect()
        }
        LanguageId::Php => resolve_php(from_dir, spec, idx, root),
        LanguageId::Ruby => resolve_ruby(from_dir, spec, idx, root).into_iter().collect(),
        LanguageId::Dart => resolve_dart(from_dir, spec, idx, root).into_iter().collect(),
        _ => resolve_web_or_markup(from_dir, spec, idx, root).into_iter().collect(),
    }
}

fn resolve_ts_js(from_dir: &str, raw: &str, idx: &WorkspaceIndex, root: &Path) -> Option<String> {
    let spec = raw.strip_prefix("@/").map(|r| format!("src/{r}"));
    let (base_dir, rel) = match &spec {
        Some(s) => ("", s.as_str()),
        None if raw.starts_with("./") || raw.starts_with("../") => (from_dir, raw),
        None if raw.starts_with('/') => ("", raw.trim_start_matches('/')),
        None => return None,
    };
    let stem = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]
        .iter()
        .find_map(|ext| rel.strip_suffix(ext))
        .unwrap_or(rel);
    if let Some(p) = probe_contained(base_dir, rel, idx, root) {
        return Some(p);
    }
    for ext in [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".d.ts"] {
        if let Some(p) = probe_contained(base_dir, &format!("{stem}{ext}"), idx, root) {
            return Some(p);
        }
    }
    for idx_name in [
        "index.ts", "index.tsx", "index.mts", "index.cts", "index.js", "index.jsx", "index.mjs", "index.cjs",
    ] {
        if let Some(p) = probe_contained(base_dir, &format!("{stem}/{idx_name}"), idx, root) {
            return Some(p);
        }
    }
    None
}

fn resolve_python(from_dir: &str, spec: &str, idx: &WorkspaceIndex, root: &Path) -> Option<String> {
    let dots = spec.bytes().take_while(|&b| b == b'.').count();
    let rest = spec[dots..].replace('.', "/");
    let mut dirs = Vec::new();
    if dots > 0 {
        let mut cur = from_dir;
        for _ in 1..dots {
            if cur.is_empty() {
                return None;
            }
            cur = parent_dir(cur);
        }
        dirs.push(cur);
    } else {
        dirs.extend(["", "src", from_dir]);
    }
    for dir in dirs {
        if rest.is_empty() {
            if let Some(p) = probe_contained(dir, "__init__.py", idx, root) {
                return Some(p);
            }
        } else {
            for cand in [format!("{rest}.py"), format!("{rest}/__init__.py")] {
                if let Some(p) = probe_contained(dir, &cand, idx, root) {
                    return Some(p);
                }
            }
        }
    }
    None
}

fn resolve_rust(
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
        let clean = item.split(" as ").next().unwrap_or(&item).trim().trim_end_matches("::*");
        let (base_dirs, rest) = if let Some(r) = clean.strip_prefix("crate::") {
            (vec!["src", ""], r)
        } else if let Some(r) = clean.strip_prefix("super::") {
            (vec![parent_dir(from_dir)], r)
        } else if let Some(r) = clean.strip_prefix("self::") {
            (vec![from_dir], r)
        } else {
            continue;
        };
        let segs: Vec<&str> = rest.split("::").filter(|s| !s.is_empty()).collect();
        for b in &base_dirs {
            for take in [segs.len(), segs.len().saturating_sub(1)] {
                if take == 0 {
                    continue;
                }
                let sub = segs[..take].join("/");
                if let Some(p) = probe_contained(b, &format!("{sub}.rs"), idx, root)
                    .or_else(|| probe_contained(b, &format!("{sub}/mod.rs"), idx, root))
                {
                    out.push(p);
                    break;
                }
            }
        }
    }
    out
}

fn expand_rust_braces(spec: &str) -> Vec<String> {
    if let Some(open) = spec.find('{')
        && let Some(close) = spec.rfind('}')
        && close > open
    {
        let prefix = &spec[..open];
        return spec[open + 1..close]
            .split(',')
            .map(|p| format!("{prefix}{}", p.trim()))
            .collect();
    }
    vec![spec.to_string()]
}

fn resolve_go(from_idx: usize, spec: &str, idx: &WorkspaceIndex) -> Vec<String> {
    let mut out = Vec::new();
    for (dir, indices) in &idx.go_pkg_dirs {
        if !dir.is_empty() && (spec == dir || spec.ends_with(&format!("/{dir}"))) {
            for &i in indices {
                if i != from_idx
                    && let Some(p) = idx.path_for_idx(i)
                {
                    out.push(p);
                }
            }
        }
    }
    out
}

fn resolve_c_cpp(from_dir: &str, spec: &str, idx: &WorkspaceIndex, root: &Path) -> Option<String> {
    for b in [from_dir, "", "include", "src"] {
        if let Some(p) = probe_contained(b, spec, idx, root) {
            return Some(p);
        }
    }
    None
}

fn probe_php_paths(from_dir: &str, clean: &str, allow_parent: bool, idx: &WorkspaceIndex, root: &Path) -> Option<String> {
    for b in [from_dir, "", "src", "app"] {
        let hit = probe_contained(b, clean, idx, root)
            .or_else(|| probe_contained(b, &format!("{clean}.php"), idx, root))
            .or_else(|| allow_parent.then(|| clean.rsplit_once('/').and_then(|(p, _)| probe_contained(b, &format!("{p}.php"), idx, root))).flatten());
        if let Some(p) = hit { return Some(p); }
    }
    None
}

fn resolve_php(from_dir: &str, spec: &str, idx: &WorkspaceIndex, root: &Path) -> Vec<String> {
    let trimmed = spec.trim();
    let stripped;
    let mut s = "";
    if let Some(rest) = trimmed.strip_prefix("use:") {
        let rt = rest.trim();
        s = strip_kw_ci(rt, "use").unwrap_or(rt);
    } else {
        let direct = trimmed.trim_start_matches('\\').replace('\\', "/");
        if !direct.is_empty() && let Some(p) = probe_php_paths(from_dir, &direct, false, idx, root) {
            return vec![p];
        }
        stripped = strip_php_comments(trimmed);
        let st = stripped.trim();
        if !st.contains('/') && !st.contains('.')
            && (trimmed.contains('\\') || trimmed.contains("/*") || trimmed.contains("//"))
            && let Some(r) = strip_kw_ci(st, "use")
        {
            s = r;
        }
    }
    if s.is_empty() { return Vec::new(); }
    s = strip_php_kind(s);
    let (prefix, body) = match (s.find('{'), s.rfind('}')) {
        (Some(o), Some(c)) if o < c => (s[..o].trim(), &s[o + 1..c]),
        _ => ("", s),
    };
    let mut out = Vec::new();
    for item in body.split(',').map(|p| strip_php_kind(p.trim())).filter(|p| !p.is_empty()) {
        let full = format!("{prefix}{item}");
        let clean = split_as_ci(&full).0.split_whitespace().collect::<String>().trim_start_matches('\\').replace('\\', "/");
        if !clean.is_empty() && let Some(p) = probe_php_paths(from_dir, &clean, true, idx, root) && !out.contains(&p) {
            out.push(p);
        }
    }
    out
}

fn resolve_ruby(from_dir: &str, spec: &str, idx: &WorkspaceIndex, root: &Path) -> Option<String> {
    let c = if spec.ends_with(".rb") { spec.to_string() } else { format!("{spec}.rb") };
    for b in [from_dir, "", "lib"] {
        if let Some(p) = probe_contained(b, &c, idx, root) {
            return Some(p);
        }
    }
    None
}

fn resolve_dart(from_dir: &str, spec: &str, idx: &WorkspaceIndex, root: &Path) -> Option<String> {
    if spec.starts_with("dart:") {
        return None;
    }
    if let Some(rest) = spec.strip_prefix("package:")
        && let Some((_, rel)) = rest.split_once('/')
    {
        return probe_contained("lib", rel, idx, root);
    }
    probe_contained(from_dir, spec, idx, root)
}

fn resolve_web_or_markup(
    from_dir: &str,
    spec: &str,
    idx: &WorkspaceIndex,
    root: &Path,
) -> Option<String> {
    if ["http://", "https://", "//", "data:", "mailto:", "#"]
        .iter()
        .any(|p| spec.starts_with(p))
    {
        return None;
    }
    for b in [from_dir, "", "templates"] {
        if let Some(p) = probe_contained(b, spec, idx, root) {
            return Some(p);
        }
    }
    None
}
