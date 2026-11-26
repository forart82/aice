use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use aice_ast_engine::EngineRegistry;
use aice_ast_engine::dep_graph::{
    CallerHit, FileDepInput, expand_dependency_closure, find_workspace_callers,
    order_files_topologically,
};
use aice_governance::binary_probe::DEFAULT_MAX_TEXT_FILE_BYTES;
use aice_governance::path_guard::is_path_contained;
use aice_governance::{Governed, ReadOp};
use aice_lang_registry::{AdapterLookup, LanguageId, detect_language};

use crate::coalesce::coalesce_targets_with_opts;
use crate::discovery::walk_project_root;
use crate::gitignore::to_rel_posix;
use crate::matcher::ResolvedTarget;
use crate::selector::{ParsedTargetSpec, TargetSelector};

#[derive(Debug, Default)]
pub struct TopoPack {
    pub ordered_targets: Vec<ResolvedTarget>,
    pub dep_paths: Vec<String>,
    pub caller_hits: Vec<CallerHit>,
}

pub fn build_topo_pack(
    governed: &Governed,
    targets: Vec<ResolvedTarget>,
    registry: &EngineRegistry,
    op: &ReadOp,
) -> TopoPack {
    if targets.is_empty() {
        return TopoPack::default();
    }
    let targets = coalesce_targets_with_opts(targets, registry, op.full);
    let needs_ws = op.include_deps || op.include_callers;
    if targets.len() <= 1 && !needs_ws {
        return TopoPack {
            ordered_targets: targets,
            dep_paths: Vec::new(),
            caller_hits: Vec::new(),
        };
    }

    let project_root = governed.project_root();
    let mut by_rel: HashMap<String, ResolvedTarget> = HashMap::with_capacity(targets.len());
    let mut seed_rels: Vec<String> = Vec::with_capacity(targets.len());
    for t in targets {
        seed_rels.push(t.rel_path.clone());
        by_rel.insert(t.rel_path.clone(), t);
    }

    if !needs_ws {
        let inputs = build_inputs_for_targets(&by_rel, registry);
        let order = order_files_topologically(&inputs, project_root);
        let ordered = reorder_map(&mut by_rel, &order);
        return TopoPack {
            ordered_targets: ordered,
            dep_paths: Vec::new(),
            caller_hits: Vec::new(),
        };
    }

    let ws_paths = collect_workspace_text_paths(governed);
    let mut ws_inputs = Vec::with_capacity(ws_paths.len());
    let mut abs_by_rel: HashMap<String, PathBuf> = HashMap::new();

    for (rel, abs) in ws_paths {
        abs_by_rel.insert(rel.clone(), abs.clone());
        if let Some(input) = build_dep_input(&rel, &abs, registry) {
            ws_inputs.push(input);
        }
    }
    for (rel, t) in &by_rel {
        if !abs_by_rel.contains_key(rel) && t.exists_non_dir_text() {
            abs_by_rel.insert(rel.clone(), t.canonical.clone());
            if let Some(input) = build_dep_input(rel, &t.canonical, registry) {
                ws_inputs.push(input);
            }
        }
    }

    let seed_set: HashSet<String> = seed_rels.iter().cloned().collect();
    let mut selected_set: HashSet<String> = seed_set.clone();
    let mut dep_paths = Vec::new();
    let mut caller_hits = Vec::new();

    if op.include_deps {
        let max_depth = op.depth.unwrap_or(2);
        let closure = expand_dependency_closure(&seed_rels, max_depth, &ws_inputs, project_root);
        for p in closure {
            if !seed_set.contains(&p) {
                dep_paths.push(p.clone());
            }
            selected_set.insert(p);
        }
    }

    if op.include_callers {
        for seed in &seed_rels {
            let sym_hint = by_rel.get(seed).and_then(primary_symbol_hint);
            let hits = find_workspace_callers(seed, sym_hint.as_deref(), &ws_inputs, project_root);
            for hit in hits {
                selected_set.insert(hit.caller_path.clone());
                caller_hits.push(hit);
            }
        }
    }

    let subset_inputs: Vec<FileDepInput> = ws_inputs
        .into_iter()
        .filter(|i| selected_set.contains(&i.path))
        .collect();
    let ordered_rels = order_files_topologically(&subset_inputs, project_root);

    let allowed = &governed.config().allowed_read_roots;
    for rel in &ordered_rels {
        if !by_rel.contains_key(rel)
            && let Some(abs) = abs_by_rel.get(rel)
            && is_path_contained(abs, project_root, allowed)
        {
            by_rel.insert(
                rel.clone(),
                ResolvedTarget {
                    spec: ParsedTargetSpec {
                        file_path: rel.clone(),
                        selectors: vec![TargetSelector::Full],
                    },
                    canonical: abs.clone(),
                    rel_path: rel.clone(),
                    is_dir: false,
                    is_binary: false,
                    fuzzy_note: None,
                    is_expanded: true,
                },
            );
        }
    }

    let ordered_targets = reorder_map(&mut by_rel, &ordered_rels);
    TopoPack {
        ordered_targets,
        dep_paths,
        caller_hits,
    }
}

trait TargetTextExt {
    fn exists_non_dir_text(&self) -> bool;
}

impl TargetTextExt for ResolvedTarget {
    fn exists_non_dir_text(&self) -> bool {
        !self.is_dir && !self.is_binary && self.canonical.is_file()
    }
}

fn primary_symbol_hint(t: &ResolvedTarget) -> Option<String> {
    for sel in &t.spec.selectors {
        match sel {
            TargetSelector::Symbol(s) => return Some(s.name.clone()),
            TargetSelector::IntraBlock(b) => return Some(b.symbol.clone()),
            _ => {}
        }
    }
    None
}

fn build_inputs_for_targets(
    by_rel: &HashMap<String, ResolvedTarget>,
    registry: &EngineRegistry,
) -> Vec<FileDepInput> {
    let mut keys: Vec<&String> = by_rel.keys().collect();
    keys.sort();
    keys.into_iter()
        .filter_map(|rel| {
            let t = &by_rel[rel];
            if !t.exists_non_dir_text() {
                return None;
            }
            build_dep_input(rel, &t.canonical, registry)
        })
        .collect()
}

fn collect_workspace_text_paths(governed: &Governed) -> Vec<(String, PathBuf)> {
    let Some(walk) = walk_project_root(governed, false) else {
        return Vec::new();
    };
    let root = governed.project_root();
    walk.files
        .into_iter()
        .filter(|f| !f.is_binary && f.byte_size <= DEFAULT_MAX_TEXT_FILE_BYTES)
        .map(|f| (to_rel_posix(root, &f.path), f.path))
        .collect()
}

fn build_dep_input(
    rel: &str,
    abs: &PathBuf,
    registry: &EngineRegistry,
) -> Option<FileDepInput> {
    let meta = std::fs::metadata(abs).ok()?;
    if !meta.is_file() || meta.len() > DEFAULT_MAX_TEXT_FILE_BYTES {
        return None;
    }
    let src = std::fs::read_to_string(abs).ok()?;
    if src.as_bytes().contains(&0) {
        return None;
    }
    let lang = detect_language(abs, &src);
    if lang == LanguageId::PlainText {
        return Some(FileDepInput {
            path: rel.to_string(),
            lang,
            symbols: Vec::new(),
            edges: Vec::new(),
        });
    }
    let adapter = registry.adapter(lang)?;
    let tree = adapter.parse_cst(&src).ok()?;
    let symbols = adapter.extract_symbols(&tree, &src);
    let edges = adapter.extract_dependencies(&tree, &src);
    Some(FileDepInput {
        path: rel.to_string(),
        lang,
        symbols,
        edges,
    })
}

fn reorder_map(
    by_rel: &mut HashMap<String, ResolvedTarget>,
    order: &[String],
) -> Vec<ResolvedTarget> {
    let mut out = Vec::with_capacity(by_rel.len());
    for rel in order {
        if let Some(item) = by_rel.remove(rel) {
            out.push(item);
        }
    }
    let mut rem_keys: Vec<String> = by_rel.keys().cloned().collect();
    rem_keys.sort();
    for rel in rem_keys {
        if let Some(item) = by_rel.remove(&rel) {
            out.push(item);
        }
    }
    out
}
