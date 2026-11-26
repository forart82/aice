use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputSurface {
    Cli,
    Mcp,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorizedPath {
    pub requested: PathBuf,
    pub canonical: PathBuf,
    pub is_binary: bool,
}

const BLOCKED_SYSTEM_PREFIXES: &[&str] = &["/etc", "/proc", "/sys", "/dev"];
const MAX_LINK_DEPTH: usize = 32;

#[derive(Clone)]
enum Step {
    Root,
    Prefix(OsString),
    Cur,
    Parent,
    Normal(OsString),
}

fn push_path_steps(path: &Path, stack: &mut Vec<Step>) {
    let mut steps = Vec::new();
    for comp in path.components() {
        match comp {
            Component::RootDir => steps.push(Step::Root),
            Component::Prefix(p) => steps.push(Step::Prefix(p.as_os_str().to_os_string())),
            Component::CurDir => steps.push(Step::Cur),
            Component::ParentDir => steps.push(Step::Parent),
            Component::Normal(s) => steps.push(Step::Normal(s.to_os_string())),
        }
    }
    for step in steps.into_iter().rev() {
        stack.push(step);
    }
}

pub fn is_blocked_system_path(resolved: &Path) -> bool {
    if resolved == Path::new("/") {
        return true;
    }
    for blocked in BLOCKED_SYSTEM_PREFIXES {
        if resolved.starts_with(blocked) {
            return true;
        }
    }
    if resolved.starts_with("/root") {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        if home.as_deref() != Some(Path::new("/root")) {
            return true;
        }
    }
    false
}

pub(crate) fn path_contains_nul(path: &Path) -> bool {
    path.as_os_str().as_encoded_bytes().contains(&0)
}

pub fn resolve_contained_path(candidate: &Path, project_root: &Path) -> Option<PathBuf> {
    if candidate.as_os_str().is_empty()
        || project_root.as_os_str().is_empty()
        || path_contains_nul(candidate)
        || path_contains_nul(project_root)
    {
        return None;
    }
    let base_root = if project_root.is_absolute() {
        project_root.to_path_buf()
    } else {
        std::env::current_dir().ok()?.join(project_root)
    };
    let abs = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        base_root.join(candidate)
    };
    canonicalize_with_links(&abs)
}

fn canonicalize_with_links(abs: &Path) -> Option<PathBuf> {
    let mut stack = Vec::new();
    push_path_steps(abs, &mut stack);
    if stack.is_empty() {
        return None;
    }

    let mut out = PathBuf::new();
    let mut link_depth = 0usize;

    while let Some(step) = stack.pop() {
        match step {
            Step::Root => out.push(Component::RootDir),
            Step::Prefix(p) => out.push(p),
            Step::Cur => {}
            Step::Parent => {
                if out.parent().is_none() || !out.pop() {
                    return None;
                }
            }
            Step::Normal(seg) => {
                out.push(&seg);
                if let Some(target) = crate::config::read_link_target(&out) {
                    link_depth += 1;
                    if link_depth > MAX_LINK_DEPTH {
                        return None;
                    }
                    out.pop();
                    if target.is_absolute() {
                        out.clear();
                    }
                    push_path_steps(&target, &mut stack);
                }
            }
        }
    }

    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

pub fn is_path_contained(candidate: &Path, project_root: &Path, allowed_roots: &[PathBuf]) -> bool {
    let Some(resolved) = resolve_contained_path(candidate, project_root) else {
        return false;
    };
    if is_blocked_system_path(&resolved) {
        return false;
    }
    let Some(root_canon) = resolve_contained_path(project_root, project_root) else {
        return false;
    };
    if resolved.starts_with(&root_canon) {
        return true;
    }
    allowed_roots.iter().any(|root| {
        let Some(canon) = resolve_contained_path(root, &root_canon) else {
            return false;
        };
        if is_blocked_system_path(&canon) {
            return false;
        }
        resolved.starts_with(&canon)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_nonexistent_parent_traversal_to_etc_and_outside_root() {
        let root = std::env::temp_dir();
        let escaped_etc = root.join("nonexistent_sub/../../../../../etc/evil");
        assert!(!is_path_contained(&escaped_etc, &root, &[]));

        let direct_etc = root.join("../../etc/evil");
        assert!(!is_path_contained(&direct_etc, &root, &[]));

        let relative_escape = Path::new("../outside_evil.txt");
        assert!(!is_path_contained(relative_escape, &root, &[]));

        let above_root = root.join("missing/../../../../../../../../tmp/x");
        assert!(!is_path_contained(&above_root, &root, &[]));

        let inside_new = root.join("new_dir/../crates/new_file.rs");
        assert!(is_path_contained(&inside_new, &root, &[]));
    }
}
