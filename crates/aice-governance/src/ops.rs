use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OperationKind {
    Read,
    Search,
    Find,
    Write,
    Admin,
}

mod sealed {
    pub trait Sealed {}
}

pub use crate::target_spec::{split_target_selector, strip_selector};
use crate::heredoc_targets::{
    extract_heredoc_targets, extract_json_targets, extract_raw_heredoc_targets,
    extract_raw_json_targets, starts_with_heredoc_header_for,
};
use crate::target_spec::{push_path_buf, push_raw_target, push_unique_path};

pub trait OperationTargets {
    fn kind(&self) -> OperationKind;
    fn target_paths(&self) -> Vec<PathBuf>;
    fn raw_targets(&self) -> &[String] {
        &[]
    }
    fn raw_target_strings(&self) -> Vec<String> {
        self.raw_targets().to_vec()
    }
    fn inline_payloads(&self) -> Vec<&str> {
        Vec::new()
    }
    fn json_manifest_payloads(&self) -> Vec<&str> {
        Vec::new()
    }
}

pub trait NonAdminOp: OperationTargets + sealed::Sealed {}
#[derive(Debug, Clone)]
pub struct ReadOp {
    pub targets: Vec<String>,
    pub target_paths: Vec<PathBuf>,
    pub outline: bool,
    pub outline_target: bool,
    pub full: bool,
    pub depth: Option<usize>,
    pub symbol: Option<String>,
    pub search: Option<String>,
    pub context_lines: Option<usize>,
    pub files_only: bool,
    pub compact: bool,
    pub include_types: bool,
    pub include_deps: bool,
    pub include_callers: bool,
    pub max_tokens: Option<usize>,
    pub json: bool,
    pub stats: bool,
}

impl OperationTargets for ReadOp {
    fn kind(&self) -> OperationKind {
        OperationKind::Read
    }
    fn target_paths(&self) -> Vec<PathBuf> {
        let mut out = Vec::with_capacity(self.targets.len() + self.target_paths.len());
        for t in &self.targets {
            push_raw_target(&mut out, t);
        }
        for p in &self.target_paths {
            push_path_buf(&mut out, p);
        }
        out
    }
    fn raw_targets(&self) -> &[String] {
        &self.targets
    }
}

impl sealed::Sealed for ReadOp {}
impl NonAdminOp for ReadOp {}

#[derive(Debug, Clone)]
pub struct SearchOp {
    pub pattern: String,
    pub targets: Vec<String>,
    pub target_paths: Vec<PathBuf>,
    pub context_lines: Option<usize>,
    pub line_numbers: bool,
    pub symbol: Option<String>,
    pub files_with_matches: bool,
    pub full: bool,
    pub max_tokens: Option<usize>,
    pub json: bool,
    pub stats: bool,
}

impl OperationTargets for SearchOp {
    fn kind(&self) -> OperationKind {
        OperationKind::Search
    }
    fn target_paths(&self) -> Vec<PathBuf> {
        let mut out = Vec::with_capacity(self.targets.len() + self.target_paths.len());
        for t in &self.targets {
            push_raw_target(&mut out, t);
        }
        for p in &self.target_paths {
            push_path_buf(&mut out, p);
        }
        out
    }
    fn raw_targets(&self) -> &[String] {
        &self.targets
    }
}

impl sealed::Sealed for SearchOp {}
impl NonAdminOp for SearchOp {}

#[derive(Debug, Clone)]
pub struct FindOp {
    pub pattern: Option<String>,
    pub targets: Vec<String>,
    pub target_paths: Vec<PathBuf>,
    pub depth: Option<usize>,
    pub search: Option<String>,
    pub full: bool,
    pub max_tokens: Option<usize>,
    pub json: bool,
}

impl OperationTargets for FindOp {
    fn kind(&self) -> OperationKind {
        OperationKind::Find
    }
    fn target_paths(&self) -> Vec<PathBuf> {
        let mut out = Vec::with_capacity(self.targets.len() + self.target_paths.len() + 1);
        for t in &self.targets {
            push_unique_path(&mut out, PathBuf::from(t));
        }
        for p in &self.target_paths {
            push_path_buf(&mut out, p);
        }
        if out.is_empty() {
            out.push(PathBuf::from("."));
        }
        out
    }
    fn raw_targets(&self) -> &[String] {
        &self.targets
    }
}

impl sealed::Sealed for FindOp {}
impl NonAdminOp for FindOp {}

#[derive(Debug, Clone)]
pub struct WriteOp {
    pub path: Option<PathBuf>,
    pub symbol: Option<String>,
    pub code: Option<String>,
    pub template: Option<String>,
    pub body: Option<String>,
    pub from_file: Option<PathBuf>,
    pub from_stdin: bool,
    pub delete: Option<String>,
    pub insert_after: Option<String>,
    pub insert_before: Option<String>,
    pub edits: Option<String>,
    pub batch: Option<String>,
    pub create: bool,
    pub overwrite: bool,
    pub force: bool,
    pub in_place: bool,
    pub dry_run: bool,
    pub diff: bool,
    pub json: bool,
    pub preserve_docs: bool,
    pub target_paths: Vec<PathBuf>,
}

impl OperationTargets for WriteOp {
    fn kind(&self) -> OperationKind {
        OperationKind::Write
    }
    fn target_paths(&self) -> Vec<PathBuf> {
        let mut out = Vec::with_capacity(self.target_paths.len() + 2);
        if let Some(p) = &self.path {
            push_path_buf(&mut out, p);
        }
        if let Some(p) = &self.from_file {
            push_path_buf(&mut out, p);
        }
        if let Some(batch) = &self.batch {
            extract_heredoc_targets(batch, self.path.as_deref(), &mut out);
            extract_json_targets(batch, &mut out);
        }
        if let Some(edits) = &self.edits {
            extract_json_targets(edits, &mut out);
        }
        if self.symbol.is_none()
            && let Some(code) = &self.code
            && (self.path.is_none() || starts_with_heredoc_header_for(code, self.path.as_deref()))
        {
            extract_heredoc_targets(code, self.path.as_deref(), &mut out);
        }
        for p in &self.target_paths {
            push_path_buf(&mut out, p);
        }
        out
    }
    fn raw_target_strings(&self) -> Vec<String> {
        let mut out = Vec::new();
        if let Some(batch) = &self.batch {
            extract_raw_heredoc_targets(batch, self.path.as_deref(), &mut out);
            extract_raw_json_targets(batch, &mut out);
        }
        if let Some(edits) = &self.edits {
            extract_raw_json_targets(edits, &mut out);
        }
        if self.symbol.is_none()
            && let Some(code) = &self.code
            && (self.path.is_none() || starts_with_heredoc_header_for(code, self.path.as_deref()))
        {
            extract_raw_heredoc_targets(code, self.path.as_deref(), &mut out);
        }
        out
    }
    fn inline_payloads(&self) -> Vec<&str> {
        [
            self.code.as_deref(),
            self.template.as_deref(),
            self.body.as_deref(),
            self.batch.as_deref(),
            self.edits.as_deref(),
        ]
        .into_iter()
        .flatten()
        .collect()
    }
    fn json_manifest_payloads(&self) -> Vec<&str> {
        [self.batch.as_deref(), self.edits.as_deref()]
            .into_iter()
            .flatten()
            .collect()
    }
}
impl sealed::Sealed for WriteOp {}
impl NonAdminOp for WriteOp {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdminAction {
    Version,
    Help,
    HelpTopic(String),
    Enable { dir: PathBuf, force: bool, json: bool },
    Disable { dir: PathBuf, json: bool },
    Config { dir: PathBuf, enable: bool, disable: bool, force: bool, json: bool },
    Agents { action: String, agent: Option<String>, all: bool, global_rules: bool, json: bool },
    Gain { project: Option<String>, unique: bool, all: bool, interactive: bool, json: bool, reset: bool, yes: bool },
    Analyze { project: Option<String>, transcripts_dir: Option<PathBuf>, json: bool },
    Mcp { generate_schemas: Option<PathBuf> },
    Benchmark { json: bool, markdown: bool },
}

#[derive(Debug, Clone)]
pub struct AdminOp {
    pub action: AdminAction,
}

impl OperationTargets for AdminOp {
    fn kind(&self) -> OperationKind {
        OperationKind::Admin
    }
    fn target_paths(&self) -> Vec<PathBuf> {
        Vec::new()
    }
}
