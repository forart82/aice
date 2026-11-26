use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SymbolKind {
    Module,
    Struct,
    Class,
    Interface,
    Trait,
    Enum,
    Function,
    Method,
    Constant,
    Table,
    View,
    Trigger,
    Procedure,
    Query,
    Section,
    Block,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SymbolNode {
    pub name: String,
    pub qualified_name: String,
    pub kind: SymbolKind,
    pub start_line: usize,
    pub end_line: usize,
    pub start_byte: usize,
    pub end_byte: usize,
    pub signature: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntraBlockKind {
    Branch,
    Loop,
    ErrorHandler,
    Closure,
    Cte,
    Subquery,
    RuleBlock,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IntraBlockNode {
    pub kind: IntraBlockKind,
    pub label: String,
    pub start_line: usize,
    pub end_line: usize,
    pub start_byte: usize,
    pub end_byte: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DepKind {
    Import,
    TypeRef,
    Call,
    SchemaRef,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DepEdge {
    pub source: String,
    pub target: String,
    pub kind: DepKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SymbolSelector {
    pub name: String,
    pub ordinal: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IntraBlockSelector {
    pub symbol: String,
    pub pattern: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AstSlice {
    pub start_line: usize,
    pub end_line: usize,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutlineEntry {
    pub name: String,
    pub kind: SymbolKind,
    pub start_line: usize,
    pub end_line: usize,
    pub signature: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutlineView {
    pub entries: Vec<OutlineEntry>,
    pub total_lines: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FirewallDiagnostic {
    pub line: usize,
    pub column: usize,
    pub message: String,
    pub context: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FirewallVerdict {
    Valid,
    Invalid {
        diagnostics: Vec<FirewallDiagnostic>,
    },
}

impl FirewallVerdict {
    pub fn is_valid(&self) -> bool {
        matches!(self, Self::Valid)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    pub message: String,
    pub line: usize,
    pub column: usize,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Parse error at {}:{}: {}", self.line, self.column, self.message)
    }
}

impl std::error::Error for ParseError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SliceError {
    pub message: String,
}

impl fmt::Display for SliceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Slice error: {}", self.message)
    }
}

impl std::error::Error for SliceError {}
