use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TelemetryOpKind {
    Read,
    Context,
    Outline,
    Splice,
    Create,
    Patch,
    Admin,
}

impl TelemetryOpKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Context => "context",
            Self::Outline => "outline",
            Self::Splice => "splice",
            Self::Create => "create",
            Self::Patch => "patch",
            Self::Admin => "admin",
        }
    }

    pub fn is_write(self) -> bool {
        matches!(self, Self::Splice | Self::Create | Self::Patch)
    }
}

impl std::str::FromStr for TelemetryOpKind {
    type Err = std::convert::Infallible;

    fn from_str(raw: &str) -> Result<Self, Self::Err> {
        Ok(match raw.trim().to_ascii_lowercase().as_str() {
            "read" => Self::Read,
            "context" => Self::Context,
            "outline" => Self::Outline,
            "splice" => Self::Splice,
            "create" => Self::Create,
            "patch" => Self::Patch,
            _ => Self::Admin,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum CanonicalTelemetryCommand {
    Read,
    Search,
    Find,
    Outline,
    SpliceWrite,
}

impl CanonicalTelemetryCommand {
    pub const ALL: [Self; 5] = [
        Self::Read,
        Self::Search,
        Self::Find,
        Self::Outline,
        Self::SpliceWrite,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Search => "search",
            Self::Find => "find",
            Self::Outline => "outline",
            Self::SpliceWrite => "splice/write",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TelemetryEvent {
    pub timestamp_ms: u64,
    pub timestamp: String,
    pub project_root: String,
    pub project_name: String,
    pub file_path: String,
    pub multi_files: Vec<String>,
    pub language: String,
    pub operation: String,
    pub surface: String,
    pub agent: String,
    pub is_write: bool,
    pub is_search_mode: bool,
    pub native_chars: usize,
    pub aice_chars: usize,
    pub saved_chars: isize,
    pub native_cl100k: usize,
    pub aice_cl100k: usize,
    pub saved_cl100k: isize,
    pub native_o200k: usize,
    pub aice_o200k: usize,
    pub saved_o200k: isize,
    pub realistic_native_cl100k: Option<usize>,
    pub realistic_saved_cl100k: Option<isize>,
    pub preserved_trivia_tokens: usize,
    pub structural_compression_pct: Option<f64>,
    pub wasted_input_tokens: Option<usize>,
    pub content_hash: String,
}

impl TelemetryEvent {
    pub fn is_cli_error(&self) -> bool {
        self.file_path == "<cli-error>"
    }

    pub fn realistic_native(&self) -> usize {
        if self.is_cli_error() {
            0
        } else {
            self.realistic_native_cl100k.unwrap_or(self.native_cl100k)
        }
    }

    pub fn realistic_saved(&self) -> isize {
        if self.is_cli_error() {
            -(self.aice_cl100k as isize)
        } else {
            self.realistic_saved_cl100k
                .unwrap_or_else(|| self.realistic_native() as isize - self.aice_cl100k as isize)
        }
    }

    pub fn classify_command(&self) -> CanonicalTelemetryCommand {
        if self.file_path == "<workspace-files>" {
            CanonicalTelemetryCommand::Find
        } else if self.is_search_mode {
            CanonicalTelemetryCommand::Search
        } else if self.is_write {
            CanonicalTelemetryCommand::SpliceWrite
        } else if self.operation == "outline" {
            CanonicalTelemetryCommand::Outline
        } else {
            CanonicalTelemetryCommand::Read
        }
    }
}

pub fn detect_language_name(file_path: &str) -> &'static str {
    if file_path.starts_with('<') {
        return "Multi";
    }
    let ext = Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    match ext.as_deref() {
        Some("ts" | "mts" | "cts") => "TypeScript",
        Some("tsx") => "TSX",
        Some("js" | "mjs" | "cjs") => "JavaScript",
        Some("jsx") => "JSX",
        Some("rs") => "Rust",
        Some("py" | "pyi") => "Python",
        Some("go") => "Go",
        Some("c" | "h") => "C",
        Some("cpp" | "cc" | "cxx" | "hpp" | "hh") => "C++",
        Some("cs") => "C#",
        Some("java") => "Java",
        Some("kt" | "kts") => "Kotlin",
        Some("dart") => "Dart",
        Some("php") => "PHP",
        Some("rb") => "Ruby",
        Some("sh" | "bash" | "zsh") => "Shell",
        Some("sql") => "SQL",
        Some("prisma") => "Prisma",
        Some("graphql" | "gql") => "GraphQL",
        Some("cypher" | "cql") => "Cypher",
        Some("json" | "jsonc") => "JSON",
        Some("yaml" | "yml") => "YAML",
        Some("toml") => "TOML",
        Some("md" | "mdx") => "Markdown",
        Some("html" | "htm") => "HTML",
        Some("css" | "scss") => "CSS",
        Some("xml" | "svg") => "XML",
        Some("twig") => "Twig",
        _ => "PlainText",
    }
}
