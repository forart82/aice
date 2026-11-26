use std::path::{Path, PathBuf};

use aice_find_engine::{
    FuzzyResolution, FuzzyResolveOpts, SymbolResolution, format_did_you_mean,
    resolve_symbol_via_lookup, resolve_target,
};
use aice_governance::path_guard::{is_path_contained, resolve_contained_path};
use aice_governance::{
    AuthorizedPath, BinaryProbeResult, Governed, probe_file, split_target_selector_in_dir,
};
use aice_lang_registry::{AdapterLookup, LanguageId};

use crate::discovery::walk_project_root;
use crate::gitignore::to_rel_posix;
use crate::selector::{ParsedTargetSpec, TargetSelector};

#[derive(Debug, Clone)]
pub struct ResolvedTarget {
    pub spec: ParsedTargetSpec,
    pub canonical: PathBuf,
    pub rel_path: String,
    pub is_dir: bool,
    pub is_binary: bool,
    pub fuzzy_note: Option<String>,
    pub is_expanded: bool,
}

pub fn resolve_targets(specs: &[ParsedTargetSpec]) -> Vec<ParsedTargetSpec> {
    specs.to_vec()
}

pub fn resolve_targets_with_governance(
    governed: &Governed,
    specs: &[ParsedTargetSpec],
) -> (Vec<ResolvedTarget>, Vec<String>) {
    let project_root = governed.project_root();
    let allowed_roots = &governed.config().allowed_read_roots;
    let authorized = governed.authorized_paths();
    let cwd = governed.cwd();
    let mut resolved = Vec::new();
    let mut errors = Vec::new();
    let mut cached_candidates: Option<Vec<String>> = None;
    let mut cached_glob_walk: Option<Vec<PathBuf>> = None;

    for spec in specs {
        let Some(ap) = find_authorized_path(spec, authorized, cwd) else {
            errors.push(format!("Unauthorized target path: {}", spec.file_path));
            continue;
        };
        if let Ok(meta) = std::fs::metadata(&ap.canonical) {
            let rel = to_rel_posix(project_root, &ap.canonical);
            resolved.push(ResolvedTarget {
                spec: spec.clone(),
                canonical: ap.canonical.clone(),
                rel_path: rel,
                is_dir: meta.is_dir(),
                is_binary: ap.is_binary,
                fuzzy_note: None,
                is_expanded: false,
            });
            continue;
        }

        if crate::glob_expand::is_glob_pattern(&spec.file_path) {
            let matches = crate::glob_expand::expand_glob_target(
                governed,
                spec,
                ap,
                &mut cached_glob_walk,
            );
            if matches.is_empty() {
                errors.push(format!("No files matched glob: {}", spec.file_path));
            } else {
                resolved.extend(matches);
            }
            continue;
        }

        if ap.is_binary {
            let rel = to_rel_posix(project_root, &ap.requested);
            resolved.push(ResolvedTarget {
                spec: spec.clone(),
                canonical: ap.canonical.clone(),
                rel_path: rel,
                is_dir: false,
                is_binary: true,
                fuzzy_note: None,
                is_expanded: false,
            });
            continue;
        }

        let candidates = cached_candidates.get_or_insert_with(|| collect_candidates(governed));
        let query_rel = to_rel_posix(project_root, &ap.requested);
        let query_str = if query_rel.is_empty() {
            spec.file_path.as_str()
        } else {
            query_rel.as_str()
        };
        match resolve_target(query_str, candidates, &FuzzyResolveOpts::default()) {
            FuzzyResolution::Exact(m) | FuzzyResolution::AutoResolved { target: m, .. } => {
                if let Some(target_abs) = resolve_contained_path(Path::new(&m), project_root)
                    && is_path_contained(&target_abs, project_root, allowed_roots)
                    && std::fs::read_link(&target_abs).is_err()
                    && let Ok(meta) = std::fs::metadata(&target_abs)
                {
                    let is_bin = matches!(
                        probe_file(&target_abs),
                        BinaryProbeResult::BinaryExtension | BinaryProbeResult::NulByteOrInvalidUtf8
                    );
                    resolved.push(ResolvedTarget {
                        spec: spec.clone(),
                        canonical: target_abs,
                        rel_path: m.clone(),
                        is_dir: meta.is_dir(),
                        is_binary: is_bin,
                        fuzzy_note: Some(format!(
                            "// [fuzzy-resolved '{}' -> '{}']\n",
                            spec.file_path, m
                        )),
                        is_expanded: false,
                    });
                    continue;
                }
                errors.push(format!("File not found: {}", spec.file_path));
            }
            FuzzyResolution::Ambiguous(matches) => {
                errors.push(format!(
                    "File not found: {}.{}",
                    spec.file_path,
                    format_did_you_mean(&matches, false)
                ));
            }
            FuzzyResolution::NotFound => {
                errors.push(format!("File not found: {}", spec.file_path));
            }
        }
    }

    (resolved, errors)
}

fn find_authorized_path<'a>(
    spec: &ParsedTargetSpec,
    authorized: &'a [AuthorizedPath],
    cwd: &Path,
) -> Option<&'a AuthorizedPath> {
    let raw = Path::new(split_target_selector_in_dir(&spec.file_path, cwd).0);
    let resolved = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        cwd.join(raw)
    };
    authorized
        .iter()
        .find(|ap| ap.requested == resolved || ap.canonical == resolved)
}

fn collect_candidates(governed: &Governed) -> Vec<String> {
    let Some(walk) = walk_project_root(governed, false) else {
        return Vec::new();
    };
    let root = governed.project_root();
    let mut out: Vec<String> = walk
        .files
        .into_iter()
        .map(|f| to_rel_posix(root, &f.path))
        .collect();
    out.sort();
    out.dedup();
    out
}

pub fn resolve_symbol_fuzzy(
    lookup: &dyn AdapterLookup,
    lang: LanguageId,
    src: &str,
    sym_name: &str,
) -> SymbolResolution {
    resolve_symbol_via_lookup(lookup, lang, src, sym_name)
}

pub fn apply_cli_symbol_flag(specs: &mut [ParsedTargetSpec], sym_flag: Option<&str>) {
    let Some(sym) = sym_flag.map(str::trim).filter(|s| !s.is_empty()) else {
        return;
    };
    for spec in specs {
        if spec.selectors.len() == 1 && matches!(spec.selectors[0], TargetSelector::Full) {
            let parsed = crate::selector::parse_target_spec(&format!("dummy:{sym}"));
            if !parsed.selectors.is_empty() {
                spec.selectors = parsed.selectors;
            }
        }
    }
}
