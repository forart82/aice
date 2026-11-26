use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

use aice_lang_registry::{DepEdge, DepKind, LanguageFamily, LanguageId, SymbolKind};

use crate::dep_graph::FileDepInput;
use crate::dep_resolve_jvm::index_jvm_file;
use crate::dep_resolve_lang::resolve_import;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolveOutcome {
    WorkspaceFile(String),
    ExternalPackage,
    MissingLocal,
    SelfReference,
}

pub struct WorkspaceIndex {
    canon_root: Option<PathBuf>,
    pub(crate) known_files: HashMap<String, usize>,
    pub(crate) type_definers: HashMap<String, Vec<usize>>,
    schema_definers: HashMap<String, Vec<usize>>,
    pub(crate) module_definers: HashMap<String, Vec<usize>>,
    pub(crate) go_pkg_dirs: HashMap<String, Vec<usize>>,
    pub(crate) jvm_defs: HashMap<String, Vec<usize>>,
}

impl WorkspaceIndex {
    pub fn build(files: &[FileDepInput], project_root: &Path) -> Self {
        let canon_root = std::fs::canonicalize(project_root).ok();
        let mut known_files = HashMap::new();
        let mut type_definers: HashMap<String, Vec<usize>> = HashMap::new();
        let mut schema_definers: HashMap<String, Vec<usize>> = HashMap::new();
        let mut module_definers: HashMap<String, Vec<usize>> = HashMap::new();
        let mut go_pkg_dirs: HashMap<String, Vec<usize>> = HashMap::new();
        let mut jvm_defs: HashMap<String, Vec<usize>> = HashMap::new();

        for (idx, f) in files.iter().enumerate() {
            let norm = normalize_rel_path(&f.path, project_root, canon_root.as_deref());
            known_files.entry(norm.clone()).or_insert(idx);
            if f.lang == LanguageId::Go {
                go_pkg_dirs.entry(parent_dir(&norm).to_string()).or_default().push(idx);
            }
            index_jvm_file(f, idx, &mut jvm_defs);
            for sym in &f.symbols {
                match sym.kind {
                    SymbolKind::Struct
                    | SymbolKind::Class
                    | SymbolKind::Interface
                    | SymbolKind::Trait
                    | SymbolKind::Enum
                    | SymbolKind::Function
                        if sym.kind != SymbolKind::Function || f.lang == LanguageId::CSharp =>
                    {
                        type_definers.entry(sym.name.clone()).or_default().push(idx);
                        if sym.qualified_name != sym.name {
                            type_definers.entry(sym.qualified_name.clone()).or_default().push(idx);
                        }
                    }
                    SymbolKind::Module => {
                        module_definers.entry(sym.qualified_name.clone()).or_default().push(idx);
                        module_definers.entry(sym.name.clone()).or_default().push(idx);
                    }
                    _ => {}
                }
                if matches!(f.lang.family(), LanguageFamily::Database | LanguageFamily::Query) {
                    schema_definers.entry(sym.name.to_ascii_lowercase()).or_default().push(idx);
                    schema_definers
                        .entry(sym.qualified_name.to_ascii_lowercase())
                        .or_default()
                        .push(idx);
                }
            }
        }
        Self {
            canon_root,
            known_files,
            type_definers,
            schema_definers,
            module_definers,
            go_pkg_dirs,
            jvm_defs,
        }
    }

    pub(crate) fn canon_root(&self) -> Option<&Path> {
        self.canon_root.as_deref()
    }

    pub(crate) fn path_for_idx(&self, target: usize) -> Option<String> {
        self.known_files.iter().find_map(|(k, &v)| (v == target).then(|| k.clone()))
    }
}

pub fn normalize_rel_path(path: &str, project_root: &Path, canon_root: Option<&Path>) -> String {
    let p = Path::new(path);
    if p.is_absolute() {
        if let Ok(stripped) = p.strip_prefix(project_root) {
            return lexical_norm(stripped).unwrap_or_else(|| path.replace('\\', "/"));
        }
        if let Some(cr) = canon_root
            && let Ok(canon_p) = std::fs::canonicalize(p)
            && let Ok(stripped) = canon_p.strip_prefix(cr)
        {
            return lexical_norm(stripped).unwrap_or_else(|| path.replace('\\', "/"));
        }
        return match lexical_norm(p) {
            Some(rel) if rel.is_empty() => "/".to_string(),
            Some(rel) => format!("/{rel}"),
            None => path.replace('\\', "/"),
        };
    }
    lexical_norm(p).unwrap_or_else(|| path.replace('\\', "/"))
}

pub(crate) fn lexical_norm(path: &Path) -> Option<String> {
    let mut segs: Vec<String> = Vec::new();
    for comp in path.components() {
        match comp {
            Component::CurDir | Component::RootDir | Component::Prefix(_) => {}
            Component::ParentDir => {
                segs.pop()?;
            }
            Component::Normal(s) => segs.push(s.to_string_lossy().into_owned()),
        }
    }
    Some(segs.join("/"))
}

pub fn resolve_dep_edge(
    from_idx: usize,
    from: &FileDepInput,
    edge: &DepEdge,
    idx: &WorkspaceIndex,
    project_root: &Path,
) -> ResolveOutcome {
    let outcomes = resolve_dep_edges(from_idx, from, edge, idx, project_root);
    if let Some(found) = outcomes.iter().find(|o| matches!(o, ResolveOutcome::WorkspaceFile(_))) {
        return found.clone();
    }
    if outcomes.iter().any(|o| matches!(o, ResolveOutcome::SelfReference)) {
        return ResolveOutcome::SelfReference;
    }
    classify_miss(from.lang, edge)
}

pub(crate) fn resolve_dep_edges(
    from_idx: usize,
    from: &FileDepInput,
    edge: &DepEdge,
    idx: &WorkspaceIndex,
    project_root: &Path,
) -> Vec<ResolveOutcome> {
    let from_norm = normalize_rel_path(&from.path, project_root, idx.canon_root());
    let from_dir = parent_dir(&from_norm);
    let spec = edge.target.trim();
    if spec.is_empty() || spec.contains('\0') {
        return vec![ResolveOutcome::ExternalPackage];
    }
    let resolved_paths = match edge.kind {
        DepKind::SchemaRef => resolve_schema_ref(from_idx, from_dir, spec, idx, project_root),
        DepKind::TypeRef => resolve_type_ref(from_idx, from, spec, idx),
        DepKind::Import => {
            resolve_import(from_idx, from.lang, &from_norm, from_dir, spec, idx, project_root)
        }
        DepKind::Call => Vec::new(),
    };
    if resolved_paths.is_empty() {
        return vec![classify_miss(from.lang, edge)];
    }
    resolved_paths
        .into_iter()
        .map(|p| {
            if p == from_norm {
                ResolveOutcome::SelfReference
            } else {
                ResolveOutcome::WorkspaceFile(p)
            }
        })
        .collect()
}

fn is_remote_url(spec: &str) -> bool {
    spec.starts_with("http://") || spec.starts_with("https://")
}

fn classify_miss(lang: LanguageId, edge: &DepEdge) -> ResolveOutcome {
    let spec = edge.target.trim();
    let is_local_import = edge.kind == DepKind::Import
        && (spec.starts_with("./")
            || spec.starts_with("../")
            || spec.starts_with('/')
            || (lang == LanguageId::Python && spec.starts_with('.'))
            || (matches!(lang, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript)
                && spec.starts_with("@/")));
    let is_local_schema = edge.kind == DepKind::SchemaRef
        && !is_remote_url(spec)
        && (spec.contains('/') || spec.contains('.'));
    if is_local_import || is_local_schema {
        ResolveOutcome::MissingLocal
    } else {
        ResolveOutcome::ExternalPackage
    }
}

fn resolve_schema_ref(
    from_idx: usize,
    from_dir: &str,
    spec: &str,
    idx: &WorkspaceIndex,
    root: &Path,
) -> Vec<String> {
    if is_remote_url(spec) {
        return Vec::new();
    }
    if spec.contains('/') || spec.contains('.') {
        for base in [from_dir, ""] {
            if let Some(p) = probe_contained(base, spec, idx, root) {
                return vec![p];
            }
        }
    }
    let key = spec.to_ascii_lowercase();
    let short = key.rsplit('.').next().unwrap_or(&key);
    for lookup in [&key, short] {
        if let Some(list) = idx.schema_definers.get(lookup)
            && let Some(&ti) = list.iter().find(|&&i| i != from_idx)
            && let Some(path) = idx.path_for_idx(ti)
        {
            return vec![path];
        }
    }
    Vec::new()
}

fn resolve_type_ref(
    from_idx: usize,
    from: &FileDepInput,
    spec: &str,
    idx: &WorkspaceIndex,
) -> Vec<String> {
    let cross = matches!(from.lang, LanguageId::Prisma | LanguageId::GraphQl)
        || (!from.symbols.iter().any(|s| s.name == spec || s.qualified_name == spec)
            && from.edges.iter().all(|e| e.kind != DepKind::Import));
    if !cross {
        return Vec::new();
    }
    if let Some(list) = idx.type_definers.get(spec)
        && list.iter().filter(|&&i| i != from_idx).count() == 1
        && let Some(&ti) = list.iter().find(|&&i| i != from_idx)
        && let Some(path) = idx.path_for_idx(ti)
    {
        return vec![path];
    }
    Vec::new()
}

pub(crate) fn probe_contained(
    base_dir: &str,
    rel: &str,
    idx: &WorkspaceIndex,
    root: &Path,
) -> Option<String> {
    if rel.contains('\0') {
        return None;
    }
    let joined =
        if base_dir.is_empty() { PathBuf::from(rel) } else { Path::new(base_dir).join(rel) };
    let lex_rel = lexical_norm(&joined)?;
    if idx.known_files.contains_key(&lex_rel) {
        return Some(lex_rel);
    }
    if let Some(canon_root) = idx.canon_root() {
        let cand = root.join(&lex_rel);
        if cand.is_file()
            && let Ok(canon_cand) = std::fs::canonicalize(&cand)
            && let Ok(stripped) = canon_cand.strip_prefix(canon_root)
        {
            return Some(stripped.to_string_lossy().replace('\\', "/"));
        }
    }
    None
}

pub(crate) fn parent_dir(rel: &str) -> &str {
    rel.rsplit_once('/').map(|(d, _)| d).unwrap_or("")
}
