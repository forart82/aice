use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;

use aice_lang_registry::{DepEdge, LanguageFamily, LanguageId, SymbolKind, SymbolNode};

use crate::dep_callers::find_callers_impl;
use crate::dep_resolve::{ResolveOutcome, WorkspaceIndex, normalize_rel_path, resolve_dep_edges};
use crate::dep_tarjan::condense_and_topo_sort;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum DepNodeTier {
    SchemaOrType = 0,
    Definition = 1,
    CallerOrTest = 2,
}

#[derive(Debug, Clone)]
pub struct FileDepInput {
    pub path: String,
    pub lang: LanguageId,
    pub symbols: Vec<SymbolNode>,
    pub edges: Vec<DepEdge>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallerHit {
    pub caller_path: String,
    pub imported_symbols: Vec<String>,
    pub call_lines: Vec<usize>,
}

pub fn sort_by_dependency(items: Vec<String>, edges: &[DepEdge]) -> Vec<String> {
    let mut labels = Vec::new();
    let mut index_of: HashMap<String, usize> = HashMap::new();
    for item in items {
        if !index_of.contains_key(&item) {
            index_of.insert(item.clone(), labels.len());
            labels.push(item);
        }
    }
    let n = labels.len();
    let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n];
    let mut seen_edges: HashSet<(usize, usize)> = HashSet::new();
    for e in edges {
        if let (Some(&u), Some(&v)) = (index_of.get(&e.source), index_of.get(&e.target))
            && u != v
            && seen_edges.insert((v, u))
        {
            adj[v].push(u);
        }
    }
    let tiers = vec![DepNodeTier::Definition; n];
    let order = condense_and_topo_sort(n, &adj, &tiers, &labels);
    order.into_iter().map(|i| labels[i].clone()).collect()
}

pub fn order_files_topologically(files: &[FileDepInput], project_root: &Path) -> Vec<String> {
    let canon_root = std::fs::canonicalize(project_root).ok();
    let mut deduped: Vec<FileDepInput> = Vec::new();
    let mut norm_to_idx: HashMap<String, usize> = HashMap::new();
    for f in files {
        let norm = normalize_rel_path(&f.path, project_root, canon_root.as_deref());
        if let Some(&existing) = norm_to_idx.get(&norm) {
            deduped[existing].edges.extend(f.edges.iter().cloned());
        } else {
            norm_to_idx.insert(norm, deduped.len());
            deduped.push(f.clone());
        }
    }
    let n = deduped.len();
    let ws = WorkspaceIndex::build(&deduped, project_root);
    let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n];
    let mut seen_edges: HashSet<(usize, usize)> = HashSet::new();
    for (u, file) in deduped.iter().enumerate() {
        for edge in &file.edges {
            for outcome in resolve_dep_edges(u, file, edge, &ws, project_root) {
                if let ResolveOutcome::WorkspaceFile(tgt) = outcome
                    && let Some(&v) = norm_to_idx.get(&tgt)
                    && u != v
                    && seen_edges.insert((v, u))
                {
                    adj[v].push(u);
                }
            }
        }
    }
    let tiers: Vec<DepNodeTier> = deduped.iter().map(classify_tier).collect();
    let labels: Vec<String> = deduped.iter().map(|f| f.path.clone()).collect();
    let order = condense_and_topo_sort(n, &adj, &tiers, &labels);
    order.into_iter().map(|i| deduped[i].path.clone()).collect()
}

pub fn expand_dependency_closure(
    seeds: &[String],
    max_depth: usize,
    files: &[FileDepInput],
    project_root: &Path,
) -> Vec<String> {
    let ws = WorkspaceIndex::build(files, project_root);
    let mut visited = vec![false; files.len()];
    let mut queue = VecDeque::new();
    for s in seeds {
        let norm = normalize_rel_path(s, project_root, ws.canon_root());
        let found = ws
            .known_files
            .get(&norm)
            .copied()
            .or_else(|| files.iter().position(|f| f.path == *s));
        if let Some(idx) = found
            && !visited[idx]
        {
            visited[idx] = true;
            queue.push_back((idx, 0usize));
        }
    }
    while let Some((u, depth)) = queue.pop_front() {
        if depth >= max_depth {
            continue;
        }
        for edge in &files[u].edges {
            for outcome in resolve_dep_edges(u, &files[u], edge, &ws, project_root) {
                if let ResolveOutcome::WorkspaceFile(tgt) = outcome
                    && let Some(&v) = ws.known_files.get(&tgt)
                    && !visited[v]
                {
                    visited[v] = true;
                    queue.push_back((v, depth + 1));
                }
            }
        }
    }
    let subset: Vec<FileDepInput> =
        files.iter().enumerate().filter(|(i, _)| visited[*i]).map(|(_, f)| f.clone()).collect();
    order_files_topologically(&subset, project_root)
}

pub fn find_workspace_callers(
    target_path: &str,
    target_symbol: Option<&str>,
    workspace: &[FileDepInput],
    project_root: &Path,
) -> Vec<CallerHit> {
    find_callers_impl(target_path, target_symbol, workspace, project_root)
}

fn classify_tier(f: &FileDepInput) -> DepNodeTier {
    if matches!(f.lang.family(), LanguageFamily::Database | LanguageFamily::Query) {
        return DepNodeTier::SchemaOrType;
    }
    let low = f.path.replace('\\', "/").to_ascii_lowercase();
    let fname = low.rsplit('/').next().unwrap_or(&low);
    let stem = fname.split('.').next().unwrap_or(fname);
    if low.ends_with(".d.ts")
        || low.contains("/types/")
        || low.contains("/schemas/")
        || matches!(stem, "schema" | "types" | "models" | "interfaces")
        || (!f.symbols.is_empty()
            && f.symbols.iter().all(|s| {
                matches!(
                    s.kind,
                    SymbolKind::Struct
                        | SymbolKind::Interface
                        | SymbolKind::Trait
                        | SymbolKind::Enum
                        | SymbolKind::Table
                        | SymbolKind::View
                        | SymbolKind::Module
                )
            }))
    {
        return DepNodeTier::SchemaOrType;
    }
    if low.contains(".spec.")
        || low.contains(".test.")
        || low.contains("_test.")
        || low.contains("_spec.")
        || low.starts_with("tests/")
        || low.contains("/tests/")
        || low.contains("/__tests__/")
        || matches!(stem, "main" | "app" | "index" | "cli" | "entry" | "spec")
    {
        return DepNodeTier::CallerOrTest;
    }
    DepNodeTier::Definition
}
