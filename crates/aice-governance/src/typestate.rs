use std::fmt;
use std::path::{Path, PathBuf};

use crate::binary_probe::{BinaryProbeResult, probe_file};
use crate::config::{AiceConfig, find_project_root, load_config_checked};
use crate::heredoc_targets::{has_non_drive_colon_slash, has_traversal_after_selector_delim};
use crate::ops::{AdminOp, NonAdminOp, OperationKind};
use crate::path_guard::{
    AuthorizedPath, OutputSurface, is_path_contained, path_contains_nul, resolve_contained_path,
};
use crate::typestate_targets::{probe_write_inline_payloads, resolve_from_cwd, validate_raw_target};

#[derive(Debug, Clone, Copy)]
pub struct Raw;

#[derive(Debug)]
pub struct Governed {
    _sealed: (),
    project_root: PathBuf,
    config: AiceConfig,
    authorized_paths: Vec<AuthorizedPath>,
    surface: OutputSurface,
    cwd: PathBuf,
    op_kind: OperationKind,
}

impl Governed {
    pub fn project_root(&self) -> &Path {
        &self.project_root
    }

    pub fn config(&self) -> &AiceConfig {
        &self.config
    }

    pub fn authorized_paths(&self) -> &[AuthorizedPath] {
        &self.authorized_paths
    }

    pub fn surface(&self) -> OutputSurface {
        self.surface
    }

    pub fn cwd(&self) -> &Path {
        &self.cwd
    }

    pub fn op_kind(&self) -> OperationKind {
        self.op_kind
    }
}

#[derive(Debug)]
pub struct AdminGoverned {
    _sealed: (),
    project_root: PathBuf,
    config: AiceConfig,
    surface: OutputSurface,
}

impl AdminGoverned {
    pub fn project_root(&self) -> &Path {
        &self.project_root
    }

    pub fn config(&self) -> &AiceConfig {
        &self.config
    }

    pub fn surface(&self) -> OutputSurface {
        self.surface
    }
}

#[derive(Debug)]
pub struct PipelineRequest<S, Op> {
    state: S,
    op: Op,
    cwd: PathBuf,
    surface: OutputSurface,
}

impl<S, Op> PipelineRequest<S, Op> {
    pub fn state(&self) -> &S {
        &self.state
    }

    pub fn op(&self) -> &Op {
        &self.op
    }

    pub fn cwd(&self) -> &Path {
        &self.cwd
    }

    pub fn surface(&self) -> OutputSurface {
        self.surface
    }

    pub fn into_parts(self) -> (S, Op, PathBuf, OutputSurface) {
        (self.state, self.op, self.cwd, self.surface)
    }
}

impl<Op> PipelineRequest<Raw, Op> {
    pub fn new(op: Op, cwd: PathBuf, surface: OutputSurface) -> Self {
        Self {
            state: Raw,
            op,
            cwd,
            surface,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GovernanceError {
    Disabled,
    PathOutsideAllowedRoots(PathBuf),
    BinaryWriteForbidden(PathBuf),
    InvalidSelector(String),
    Io(String),
}

impl fmt::Display for GovernanceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Disabled => write!(
                f,
                "AICE is disabled for this project via aice.config.json (\"enabled\": false). Use native tools or run 'aice enable'."
            ),
            Self::PathOutsideAllowedRoots(p) => {
                write!(f, "Path outside allowed project roots: {}", p.display())
            }
            Self::BinaryWriteForbidden(p) => {
                write!(f, "Refusing to write binary file: {}", p.display())
            }
            Self::InvalidSelector(msg) => write!(f, "{msg}"),
            Self::Io(msg) => write!(f, "Governance I/O error: {msg}"),
        }
    }
}

impl std::error::Error for GovernanceError {}

pub fn authorize<Op: NonAdminOp>(
    req: PipelineRequest<Raw, Op>,
) -> Result<PipelineRequest<Governed, Op>, GovernanceError> {
    let project_root = find_project_root(&req.cwd);
    let config = load_config_checked(&project_root).map_err(GovernanceError::Io)?;
    if !config.enabled {
        return Err(GovernanceError::Disabled);
    }
    let op_kind = req.op.kind();
    let allowed_roots: &[PathBuf] = if op_kind == OperationKind::Write {
        &[]
    } else {
        &config.allowed_read_roots
    };
    for raw in req.op.raw_target_strings() {
        validate_raw_target(&raw, &req.cwd, &project_root, allowed_roots, op_kind)?;
    }
    let targets = req.op.target_paths_in_dir(&req.cwd);
    let mut authorized_paths = Vec::with_capacity(targets.len());
    for target in &targets {
        if target.as_os_str().is_empty() {
            return Err(GovernanceError::PathOutsideAllowedRoots(target.clone()));
        }
        let abs = resolve_from_cwd(target, &req.cwd);
        if path_contains_nul(&abs) {
            return Err(GovernanceError::PathOutsideAllowedRoots(abs));
        }
        if (has_non_drive_colon_slash(target) && !abs.exists())
            || target.to_str().is_some_and(has_traversal_after_selector_delim)
        {
            return Err(GovernanceError::PathOutsideAllowedRoots(abs));
        }
        if !is_path_contained(&abs, &project_root, allowed_roots) {
            return Err(GovernanceError::PathOutsideAllowedRoots(abs));
        }
        let probe = probe_file(&abs);
        let is_binary = matches!(
            probe,
            BinaryProbeResult::BinaryExtension | BinaryProbeResult::NulByteOrInvalidUtf8
        );
        if !matches!(probe, BinaryProbeResult::Text) && op_kind == OperationKind::Write {
            return Err(GovernanceError::BinaryWriteForbidden(abs));
        }
        let canonical = resolve_contained_path(&abs, &project_root).unwrap_or_else(|| abs.clone());
        authorized_paths.push(AuthorizedPath {
            requested: abs,
            canonical,
            is_binary,
        });
    }
    if op_kind == OperationKind::Write {
        probe_write_inline_payloads(&req.op, &authorized_paths)?;
    }
    Ok(PipelineRequest {
        state: Governed {
            _sealed: (),
            project_root,
            config,
            authorized_paths,
            surface: req.surface,
            cwd: req.cwd.clone(),
            op_kind,
        },
        op: req.op,
        cwd: req.cwd,
        surface: req.surface,
    })
}

pub fn authorize_admin(
    req: PipelineRequest<Raw, AdminOp>,
) -> Result<PipelineRequest<AdminGoverned, AdminOp>, GovernanceError> {
    let project_root = find_project_root(&req.cwd);
    let config = load_config_checked(&project_root).unwrap_or_default();
    Ok(PipelineRequest {
        state: AdminGoverned {
            _sealed: (),
            project_root,
            config,
            surface: req.surface,
        },
        op: req.op,
        cwd: req.cwd,
        surface: req.surface,
    })
}

pub fn resolve_aice_home() -> PathBuf {
    if let Ok(home) = std::env::var("AICE_HOME")
        && !home.trim().is_empty()
    {
        return PathBuf::from(home);
    }
    if let Ok(home) = std::env::var("HOME")
        && !home.trim().is_empty()
    {
        return PathBuf::from(home).join(".aice");
    }
    PathBuf::from(".aice")
}
