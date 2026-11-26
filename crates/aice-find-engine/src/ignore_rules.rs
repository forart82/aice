use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use aice_governance::Governed;
use aice_governance::path_guard::resolve_contained_path;

use crate::ignore_paths::{
    add_target_with_prefixes, build_allowed_pairs, collect_out_dir_names,
    collect_special_file_names, compute_out_dirs, has_dot_components, lexical_normalize,
};
pub use crate::ignore_paths::has_leading_dot_token;

pub const DEFAULT_IGNORED_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "dist", "build", "out", "coverage", "vendor",
    ".aice-cache", ".aice-build", "__pycache__", ".agents", ".next", ".turbo",
];

pub const LOCKFILE_SKIP_NAMES: &[&str] = &[
    "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb",
    "Cargo.lock", "composer.lock", "Gemfile.lock", "poetry.lock", "uv.lock",
    "flake.lock", "Podfile.lock", "Package.resolved", "mix.lock", "pubspec.lock",
    "gradle.lockfile", "Pipfile.lock", "pdm.lock", "npm-shrinkwrap.json",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EntryCheck {
    Allow,
    Skip,
    NeedPath,
}

pub fn should_ignore_name(name: &str) -> bool {
    DEFAULT_IGNORED_DIRS.contains(&name)
}

pub fn is_lockfile_name(name: &str) -> bool {
    name.len() >= 7
        && matches!(name.as_bytes().last(), Some(b'k' | b'n' | b'l' | b'b' | b'd' | b'e'))
        && LOCKFILE_SKIP_NAMES.contains(&name)
}

#[derive(Debug, Clone)]
pub struct IgnorePolicy {
    pub include_hidden: bool,
    pub skip_lockfiles: bool,
    pub explicit_allowed_dirs: BTreeSet<String>,
    pub explicit_allowed_paths: BTreeSet<PathBuf>,
    pub explicit_lockfiles: BTreeSet<String>,
    pub explicit_target_paths: BTreeSet<PathBuf>,
    pub configured_out_dirs: Vec<PathBuf>,
    pub(crate) has_explicit_ignored_or_hidden_dir: bool,
    pub(crate) configured_out_dir_names: Vec<String>,
    pub(crate) explicit_special_file_names: Vec<String>,
}

impl IgnorePolicy {
    pub fn from_governed(
        governed: &Governed,
        query: Option<&str>,
        include_hidden_flag: bool,
        skip_lockfiles_flag: bool,
        explicit_targets: &[String],
    ) -> Self {
        let project_root = governed.project_root();
        let root_norm = lexical_normalize(project_root);
        let root_canon = resolve_contained_path(project_root, project_root)
            .unwrap_or_else(|| root_norm.clone());
        let cwd = governed.cwd();
        let allowed_pairs = build_allowed_pairs(project_root, &governed.config().allowed_read_roots);

        let mut explicit_allowed_dirs = BTreeSet::new();
        let mut explicit_allowed_paths = BTreeSet::new();
        let mut explicit_lockfiles = BTreeSet::new();
        let mut explicit_target_paths = BTreeSet::new();

        for raw in explicit_targets {
            let p = Path::new(raw);
            record_if_lockfile(p.file_name().and_then(|n| n.to_str()), &mut explicit_lockfiles);
            if let Some(resolved) = resolve_contained_path(p, cwd) {
                add_target_with_prefixes(
                    resolved, &root_norm, &root_canon, &allowed_pairs,
                    &mut explicit_allowed_dirs, &mut explicit_allowed_paths, &mut explicit_target_paths,
                );
            }
            let joined = if p.is_relative() { lexical_normalize(&cwd.join(p)) } else { lexical_normalize(p) };
            add_target_with_prefixes(
                joined, &root_norm, &root_canon, &allowed_pairs,
                &mut explicit_allowed_dirs, &mut explicit_allowed_paths, &mut explicit_target_paths,
            );
            if p.is_relative() && let Some(cwd_canon) = resolve_contained_path(cwd, project_root) {
                explicit_target_paths.insert(lexical_normalize(&cwd_canon.join(p)));
            }
        }
        if let Some(q) = query {
            for seg in q.split(['/', '\\', ',', '{', '}']) {
                record_if_lockfile(Some(seg.trim()), &mut explicit_lockfiles);
            }
        }
        for ap in governed.authorized_paths() {
            if ap.canonical == root_canon && ap.requested == cwd.join(".") {
                continue;
            }
            if !explicit_targets.is_empty() || ap.canonical != root_canon {
                record_if_lockfile(ap.canonical.file_name().and_then(|n| n.to_str()), &mut explicit_lockfiles);
                add_target_with_prefixes(
                    ap.requested.clone(), &root_norm, &root_canon, &allowed_pairs,
                    &mut explicit_allowed_dirs, &mut explicit_allowed_paths, &mut explicit_target_paths,
                );
                add_target_with_prefixes(
                    ap.canonical.clone(), &root_norm, &root_canon, &allowed_pairs,
                    &mut explicit_allowed_dirs, &mut explicit_allowed_paths, &mut explicit_target_paths,
                );
            }
        }

        let include_hidden = include_hidden_flag
            || query.is_some_and(has_leading_dot_token)
            || explicit_targets.iter().any(|t| has_leading_dot_token(t));
        let skip_lockfiles = skip_lockfiles_flag && explicit_lockfiles.is_empty();
        let configured_out_dirs = compute_out_dirs(governed, project_root, &root_canon);
        let has_explicit_ignored_or_hidden_dir = explicit_allowed_dirs
            .iter()
            .any(|d| DEFAULT_IGNORED_DIRS.contains(&d.as_str()) || d.starts_with('.'));
        let configured_out_dir_names = collect_out_dir_names(&configured_out_dirs);
        let explicit_special_file_names =
            collect_special_file_names(&explicit_target_paths, is_lockfile_name);

        Self {
            include_hidden,
            skip_lockfiles,
            explicit_allowed_dirs,
            explicit_allowed_paths,
            explicit_lockfiles,
            explicit_target_paths,
            configured_out_dirs,
            has_explicit_ignored_or_hidden_dir,
            configured_out_dir_names,
            explicit_special_file_names,
        }
    }

    #[inline]
    pub(crate) fn fast_check_dir(&self, dir_name: &str, root_in_nm: bool) -> EntryCheck {
        if dir_name == ".git" {
            return EntryCheck::Skip;
        }
        let is_hidden = !self.include_hidden && dir_name.starts_with('.');
        let is_ignored = should_ignore_name(dir_name)
            && !(root_in_nm && matches!(dir_name, "dist" | "build" | "out"));
        if is_hidden || is_ignored {
            return if self.has_explicit_ignored_or_hidden_dir
                && self.explicit_allowed_dirs.contains(dir_name)
            {
                EntryCheck::NeedPath
            } else {
                EntryCheck::Skip
            };
        }
        if self.configured_out_dir_names.iter().any(|n| n == dir_name) {
            return EntryCheck::NeedPath;
        }
        EntryCheck::Allow
    }

    #[inline]
    pub(crate) fn fast_check_file(&self, file_name: &str) -> EntryCheck {
        if file_name == ".git" {
            return EntryCheck::Skip;
        }
        let is_aice_meta = file_name == "aice.config.json" || file_name.ends_with(".trivia.json");
        let is_hidden = !self.include_hidden && file_name.starts_with('.');
        let is_lock = self.skip_lockfiles
            && is_lockfile_name(file_name)
            && !self.explicit_lockfiles.contains(file_name);
        if is_aice_meta || is_hidden || is_lock {
            return if self.explicit_special_file_names.iter().any(|n| n == file_name) {
                EntryCheck::NeedPath
            } else {
                EntryCheck::Skip
            };
        }
        EntryCheck::Allow
    }

    pub fn is_explicit_path(&self, path: &Path) -> bool {
        if self.explicit_target_paths.is_empty() {
            return false;
        }
        self.explicit_target_paths.contains(path)
            || (has_dot_components(path)
                && self.explicit_target_paths.contains(&lexical_normalize(path)))
    }

    fn is_dir_explicitly_allowed(&self, dir_path: &Path) -> bool {
        if self.explicit_allowed_paths.is_empty() {
            return false;
        }
        self.explicit_allowed_paths.contains(dir_path)
            || (has_dot_components(dir_path)
                && self.explicit_allowed_paths.contains(&lexical_normalize(dir_path)))
    }

    pub fn should_skip_dir(
        &self,
        dir_name: &str,
        dir_path: &Path,
        root_in_node_modules: bool,
    ) -> bool {
        if dir_name == ".git" {
            return true;
        }
        let explicitly_allowed = self.is_dir_explicitly_allowed(dir_path);
        if (dir_name == "node_modules" && !explicitly_allowed)
            || (DEFAULT_IGNORED_DIRS.contains(&dir_name)
                && !explicitly_allowed
                && !(root_in_node_modules && matches!(dir_name, "dist" | "build" | "out")))
            || (dir_name.starts_with('.') && !self.include_hidden && !explicitly_allowed)
        {
            return true;
        }
        if self.configured_out_dirs.is_empty() || explicitly_allowed {
            return false;
        }
        let matches_out = self.configured_out_dirs.iter().any(|out| out == dir_path)
            || (has_dot_components(dir_path) && {
                let dir_norm = lexical_normalize(dir_path);
                self.configured_out_dirs.iter().any(|out| out == &dir_norm)
            });
        matches_out && !self.is_explicit_path(dir_path)
    }

    pub fn should_skip_file(&self, file_name: &str, file_path: &Path) -> bool {
        if file_name == ".git" {
            return true;
        }
        let special = file_name == "aice.config.json"
            || file_name.ends_with(".trivia.json")
            || (file_name.starts_with('.') && !self.include_hidden)
            || (self.skip_lockfiles
                && is_lockfile_name(file_name)
                && !self.explicit_lockfiles.contains(file_name));
        special && !self.is_explicit_path(file_path)
    }
}

fn record_if_lockfile(name: Option<&str>, out: &mut BTreeSet<String>) {
    if let Some(n) = name && is_lockfile_name(n) {
        out.insert(n.to_string());
    }
}
