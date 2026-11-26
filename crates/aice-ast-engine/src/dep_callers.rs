use std::collections::HashSet;
use std::path::Path;

use aice_lang_registry::{DepKind, LanguageId, SymbolKind};

use crate::dep_callers_scan::{TargetLookup, push_unique_sym, scan_caller_source};
use crate::dep_graph::{CallerHit, FileDepInput};
use crate::dep_resolve::{
    ResolveOutcome, WorkspaceIndex, lexical_norm, normalize_rel_path, resolve_dep_edges,
};

pub(crate) fn find_callers_impl(
    target_path: &str,
    target_symbol: Option<&str>,
    workspace: &[FileDepInput],
    project_root: &Path,
) -> Vec<CallerHit> {
    let ws = WorkspaceIndex::build(workspace, project_root);
    let norm_target = normalize_rel_path(target_path, project_root, ws.canon_root());
    let target_leaf = target_symbol.map(|s| s.rsplit(['.', ':']).next().unwrap_or(s));
    let file_stem = norm_target
        .rsplit('/')
        .next()
        .unwrap_or(&norm_target)
        .split('.')
        .next()
        .unwrap_or(&norm_target);
    let mut target_stems = vec![file_stem];
    if (matches!(file_stem, "index" | "mod" | "__init__") || norm_target.ends_with(".go"))
        && let Some(dir) = norm_target.rsplit('/').nth(1)
        && !dir.is_empty()
        && !target_stems.contains(&dir)
    {
        target_stems.push(dir);
    }
    let target_syms: HashSet<&str> = ws
        .known_files
        .get(&norm_target)
        .map(|&ti| workspace[ti].symbols.iter().map(|s| s.name.as_str()).collect())
        .unwrap_or_default();
    let target_type_syms: HashSet<&str> = ws
        .known_files
        .get(&norm_target)
        .map(|&ti| {
            let is_jvm = matches!(workspace[ti].lang, LanguageId::Java | LanguageId::Kotlin);
            workspace[ti]
                .symbols
                .iter()
                .filter(|s| {
                    matches!(
                        s.kind,
                        SymbolKind::Struct
                            | SymbolKind::Class
                            | SymbolKind::Interface
                            | SymbolKind::Trait
                            | SymbolKind::Enum
                    ) || (!is_jvm && s.kind == SymbolKind::Module)
                })
                .map(|s| s.name.as_str())
                .collect()
        })
        .unwrap_or_default();
    let target_mod_qnames: HashSet<String> = ws
        .known_files
        .get(&norm_target)
        .map(|&ti| collect_mod_qnames(&workspace[ti]))
        .unwrap_or_default();
    let targets = TargetLookup {
        stems: &target_stems,
        leaf: target_leaf,
        syms: &target_syms,
        type_syms: &target_type_syms,
        mod_qnames: &target_mod_qnames,
    };
    let parent_types_of_leaf: HashSet<&str> = match (target_leaf, ws.known_files.get(&norm_target)) {
        (Some(leaf), Some(&ti)) => workspace[ti]
            .symbols
            .iter()
            .filter(|s| s.name == leaf && s.qualified_name != s.name)
            .flat_map(|s| {
                s.qualified_name
                    .rsplit_once(['.', ':'])
                    .map(|(p, _)| p)
                    .unwrap_or("")
                    .split(['.', ':'])
                    .filter(|seg| !seg.is_empty() && target_type_syms.contains(seg))
            })
            .collect(),
        _ => HashSet::new(),
    };

    let mut hits = Vec::new();
    for (u, file) in workspace.iter().enumerate() {
        let norm_u = normalize_rel_path(&file.path, project_root, ws.canon_root());
        if norm_u == norm_target {
            continue;
        }
        let references_target = file.edges.iter().any(|edge| {
            resolve_dep_edges(u, file, edge, &ws, project_root)
                .into_iter()
                .any(|o| matches!(o, ResolveOutcome::WorkspaceFile(p) if p == norm_target))
        });
        if !references_target {
            continue;
        }
        let (imported_symbols, call_lines) = if let Some(src) =
            read_contained(project_root, ws.canon_root(), &norm_u)
        {
            scan_caller_source(&src, file.lang, &targets)
        } else {
            virtual_caller_info(file, target_leaf, &target_syms)
        };
        if let Some(leaf) = target_leaf {
            let matches_sym = if imported_symbols.iter().any(|s| s == leaf) {
                true
            } else if imported_symbols.iter().any(|s| s == "*")
                || imported_symbols.is_empty()
                || imported_symbols.iter().any(|s| parent_types_of_leaf.contains(s.as_str()))
            {
                !call_lines.is_empty()
            } else {
                false
            };
            if !matches_sym {
                continue;
            }
        }
        hits.push(CallerHit { caller_path: file.path.clone(), imported_symbols, call_lines });
    }
    hits.sort_by(|a, b| a.caller_path.cmp(&b.caller_path));
    hits
}

fn read_contained(root: &Path, canon_root: Option<&Path>, rel: &str) -> Option<String> {
    if rel.starts_with('/') || Path::new(rel).is_absolute() {
        return None;
    }
    let lex = lexical_norm(Path::new(rel))?;
    let cand = root.join(lex);
    if !cand.is_file() {
        return None;
    }
    if let Some(cr) = canon_root {
        let canon = std::fs::canonicalize(&cand).ok()?;
        if !canon.starts_with(cr) {
            return None;
        }
    }
    std::fs::read_to_string(&cand).ok()
}

fn virtual_caller_info(
    file: &FileDepInput,
    target_leaf: Option<&str>,
    target_syms: &HashSet<&str>,
) -> (Vec<String>, Vec<usize>) {
    let (mut imported, mut lines) = (Vec::new(), Vec::new());
    for edge in &file.edges {
        if matches!(edge.kind, DepKind::Call | DepKind::TypeRef) {
            let leaf = edge.target.rsplit(['.', ':']).next().unwrap_or(&edge.target);
            if target_leaf.map_or_else(|| target_syms.contains(leaf), |tl| tl == leaf) {
                push_unique_sym(&mut imported, leaf);
                if let Some(sym) = file
                    .symbols
                    .iter()
                    .find(|s| s.qualified_name == edge.source || s.name == edge.source)
                    && !lines.contains(&sym.start_line)
                {
                    lines.push(sym.start_line);
                }
            }
        }
    }
    lines.sort_unstable();
    (imported, lines)
}

fn collect_mod_qnames(file: &FileDepInput) -> HashSet<String> {
    if file.lang != LanguageId::Cpp {
        return file
            .symbols
            .iter()
            .filter(|s| s.kind == SymbolKind::Module)
            .map(|s| s.qualified_name.clone())
            .collect();
    }
    let mut inline_ns = HashSet::new();
    for s in file.symbols.iter().filter(|s| s.kind == SymbolKind::Module) {
        let Some(sig) = s.signature.as_deref() else { continue };
        let sig_t = sig.trim();
        if sig_t.starts_with("inline") && sig_t[6..].trim_start().starts_with("namespace") {
            inline_ns.insert(s.qualified_name.clone());
        } else if let Some(rest) = sig_t.strip_prefix("namespace")
            && rest.starts_with(char::is_whitespace)
        {
            let hdr = rest.split(['{', ';']).next().unwrap_or("").trim();
            let raw_segs: Vec<&str> = hdr.split("::").map(str::trim).collect();
            let q_segs: Vec<&str> = s.qualified_name.split("::").collect();
            if raw_segs.len() <= q_segs.len() {
                let base = q_segs.len() - raw_segs.len();
                for (idx, seg) in raw_segs.iter().enumerate() {
                    if seg.strip_prefix("inline").is_some_and(|r| r.starts_with(char::is_whitespace)) {
                        inline_ns.insert(q_segs[..=base + idx].join("::"));
                    }
                }
            }
        }
    }
    let mut out = HashSet::new();
    for s in file.symbols.iter().filter(|s| s.kind == SymbolKind::Module) {
        out.insert(s.qualified_name.clone());
        if !inline_ns.is_empty() {
            let segs: Vec<&str> = s.qualified_name.split("::").collect();
            let mut elided = Vec::with_capacity(segs.len());
            for i in 0..segs.len() {
                if !inline_ns.contains(&segs[..=i].join("::")) {
                    elided.push(segs[i]);
                }
            }
            if !elided.is_empty() {
                out.insert(elided.join("::"));
            }
        }
    }
    out
}
