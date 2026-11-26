use std::collections::HashSet;
use std::path::{Path, PathBuf};

use aice_find_engine::WalkOutput;
use aice_governance::Governed;

use crate::glob::glob_matches;

#[derive(Debug, Clone)]
struct GitIgnoreRule {
    base_rel: String,
    negated: bool,
    dir_only: bool,
    anchored: bool,
    has_slash: bool,
    pattern: String,
}

#[derive(Debug, Clone, Default)]
pub struct GitIgnoreSet {
    root: PathBuf,
    rules: Vec<GitIgnoreRule>,
}

impl GitIgnoreSet {
    pub fn from_root(project_root: &Path) -> Self {
        let mut set = Self {
            root: project_root.to_path_buf(),
            rules: Vec::new(),
        };
        let git_exclude = project_root.join(".git/info/exclude");
        if git_exclude.is_file() {
            set.load_file(&git_exclude, "");
        }
        set.scan_dir(project_root, "", 0);
        set
    }

    fn scan_dir(&mut self, dir: &Path, rel_dir: &str, depth: usize) {
        if depth > 12 {
            return;
        }
        let gi_path = dir.join(".gitignore");
        if gi_path.is_file() {
            self.load_file(&gi_path, rel_dir);
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        let mut subdirs = Vec::new();
        for entry in entries.flatten() {
            let name = entry.file_name();
            let ns = name.to_string_lossy();
            if matches!(ns.as_ref(), ".git" | "node_modules" | "target" | ".agents") {
                continue;
            }
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if ft.is_dir() && std::fs::read_link(entry.path()).is_err() {
                subdirs.push((entry.path(), ns.into_owned()));
            }
        }
        subdirs.sort_by(|a, b| a.1.cmp(&b.1));
        for (sub_path, name) in subdirs {
            if self.is_ignored(&sub_path, true) {
                continue;
            }
            let child_rel = if rel_dir.is_empty() {
                name
            } else {
                format!("{rel_dir}/{name}")
            };
            self.scan_dir(&sub_path, &child_rel, depth + 1);
        }
    }

    fn load_file(&mut self, path: &Path, base_rel: &str) {
        let Ok(raw) = std::fs::read_to_string(path) else {
            return;
        };
        for line in raw.lines() {
            let trimmed = line.trim_end_matches(['\r', ' ']);
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            let (negated, rest) = if let Some(r) = trimmed.strip_prefix('!') {
                (true, r)
            } else if let Some(r) = trimmed.strip_prefix("\\#").or_else(|| trimmed.strip_prefix("\\!")) {
                (false, r)
            } else {
                (false, trimmed)
            };
            if rest.is_empty() {
                continue;
            }
            let dir_only = rest.ends_with('/');
            let no_trail = rest.trim_end_matches('/');
            let anchored = no_trail.starts_with('/');
            let pat = no_trail.trim_start_matches('/');
            if pat.is_empty() {
                continue;
            }
            let has_slash = pat.contains('/');
            self.rules.push(GitIgnoreRule {
                base_rel: base_rel.to_string(),
                negated,
                dir_only,
                anchored,
                has_slash,
                pattern: pat.to_string(),
            });
        }
    }

    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }

    pub fn is_ignored(&self, path: &Path, is_dir: bool) -> bool {
        if self.rules.is_empty() {
            return false;
        }
        let rel = to_rel_posix(&self.root, path);
        let parts: Vec<&str> = rel.split('/').filter(|s| !s.is_empty()).collect();
        if parts.is_empty() {
            return false;
        }
        // Git semantics: once any parent directory is ignored, negation cannot re-include descendants.
        let mut prefix = String::new();
        for seg in &parts[..parts.len() - 1] {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(seg);
            if self.eval_single_path(&prefix, true) {
                return true;
            }
        }
        self.eval_single_path(&parts.join("/"), is_dir)
    }

    fn eval_single_path(&self, rel: &str, is_dir: bool) -> bool {
        let mut ignored = false;
        for rule in &self.rules {
            if let Some(sub) = rel_under_base(rel, &rule.base_rel)
                && rule_matches_single(rule, sub, is_dir)
            {
                ignored = !rule.negated;
            }
        }
        ignored
    }
}

fn rel_under_base<'a>(rel: &'a str, base: &str) -> Option<&'a str> {
    if base.is_empty() {
        return Some(rel);
    }
    rel.strip_prefix(base)?.strip_prefix('/')
}

fn rule_matches_single(rule: &GitIgnoreRule, sub_rel: &str, is_dir: bool) -> bool {
    if sub_rel.is_empty() || (rule.dir_only && !is_dir) {
        return false;
    }
    if !rule.anchored && !rule.has_slash {
        let base_name = sub_rel.rsplit('/').next().unwrap_or(sub_rel);
        return glob_matches(&rule.pattern, base_name);
    }
    glob_matches(&rule.pattern, sub_rel)
}

pub fn to_rel_posix(root: &Path, path: &Path) -> String {
    let canon_root = std::fs::canonicalize(root).ok();
    let rel = path
        .strip_prefix(root)
        .ok()
        .or_else(|| canon_root.as_deref().and_then(|cr| path.strip_prefix(cr).ok()))
        .unwrap_or(path);
    rel.to_string_lossy().replace('\\', "/").trim_start_matches("./").to_string()
}

pub fn filter_walk_output(
    governed: &Governed,
    out: &mut WalkOutput,
    explicit_targets: &[String],
) {
    let gi = GitIgnoreSet::from_root(governed.project_root());
    if gi.is_empty() {
        return;
    }
    let explicit: HashSet<String> = explicit_targets
        .iter()
        .map(|t| t.replace('\\', "/").trim_start_matches("./").to_string())
        .collect();
    out.files.retain(|f| {
        let rel = to_rel_posix(governed.project_root(), &f.path);
        explicit.contains(&rel) || !gi.is_ignored(&f.path, false)
    });
    out.boundary_dirs.retain(|d| {
        let rel = to_rel_posix(governed.project_root(), d);
        explicit.contains(&rel) || !gi.is_ignored(d, true)
    });
}
