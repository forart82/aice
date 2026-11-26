use std::fmt;

use aice_lang_registry::LanguageId;

pub use crate::ir_code::{
    AccessorKind, AssignOp, BinaryOp, CatchClause, ClassDecl, ConstDecl, Expr, FnBody, FnDecl,
    LiteralVal, MatchCase, MemberKind, MethodDecl, Pattern, PropDecl, RecordEntry, Stmt, UnaryOp,
    VarDecl,
};
pub use crate::ir_domain::{
    ComponentDecl, DataDecl, DataFormatKind, DataNode, DataScalar, DbColumn, DbMigrationDecl,
    DbQueryDecl, DbQueryKind, DbSchemaDecl, DocBlock, DocSection, GraphQlField, LayoutAttr,
    LayoutNode, PrismaField, ShellDecl, StyleDecl, StyleProp, TemplateCtrlKind, TokenSheetDecl,
};
pub use crate::ir_types::{
    AiceType, EnumDecl, EnumVariant, FieldDecl, FieldSigil, ParamDecl, PrimitiveType,
    RecordTypeField, TypeDecl, TypeKind, TypeParam, VariantPayload,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranspileOpts {
    pub compact: bool,
    pub include_types: bool,
    pub preserve_docs: bool,
}

impl Default for TranspileOpts {
    fn default() -> Self {
        Self {
            compact: true,
            include_types: true,
            preserve_docs: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Span {
    pub line: usize,
    pub column: usize,
    pub start_byte: usize,
    pub end_byte: usize,
}

impl Span {
    pub const fn empty() -> Self {
        Self {
            line: 0,
            column: 0,
            start_byte: 0,
            end_byte: 0,
        }
    }

    pub const fn new(line: usize, column: usize, start_byte: usize, end_byte: usize) -> Self {
        Self {
            line,
            column,
            start_byte,
            end_byte,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Visibility {
    #[default]
    Default,
    Public,
    Private,
    Protected,
    Package,
}

impl Visibility {
    pub fn aice_prefix(self) -> &'static str {
        match self {
            Self::Default => "",
            Self::Public => "pub ",
            Self::Private => "priv ",
            Self::Protected => "prot ",
            Self::Package => "pkg ",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TriviaKind {
    #[default]
    Line,
    Block,
    Docstring,
    License,
    Directive,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TriviaComment {
    pub kind: TriviaKind,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Trivia {
    pub leading: Vec<TriviaComment>,
    pub trailing: Option<String>,
    pub blank_lines_before: u16,
}

impl Trivia {
    pub fn is_empty(&self) -> bool {
        self.leading.is_empty() && self.trailing.is_none()
    }

    pub fn from_leading(lines: Vec<String>) -> Self {
        let leading = lines
            .into_iter()
            .map(|text| TriviaComment {
                kind: TriviaKind::Line,
                text,
            })
            .collect();
        Self {
            leading,
            trailing: None,
            blank_lines_before: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportSpec {
    pub name: String,
    pub alias: Option<String>,
    pub is_wildcard: bool,
    pub is_default: bool,
    pub is_type: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportDecl {
    pub vis: Visibility,
    pub source: String,
    pub specifiers: Vec<ImportSpec>,
    pub is_type_only: bool,
    pub trivia: Trivia,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AiceItem {
    Import(ImportDecl),
    Type(TypeDecl),
    Enum(EnumDecl),
    Class(ClassDecl),
    Fn(FnDecl),
    Const(ConstDecl),
    Var(VarDecl),
    Component(ComponentDecl),
    Style(StyleDecl),
    TokenSheet(TokenSheetDecl),
    Data(DataDecl),
    DbSchema(DbSchemaDecl),
    DbQuery(DbQueryDecl),
    DbMigration(DbMigrationDecl),
    Doc(DocSection),
    Shell(ShellDecl),
    Directive {
        text: String,
        trivia: Trivia,
        span: Span,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiceStmt {
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiceDecl {
    pub name: String,
    pub signature: String,
    pub body: Vec<AiceStmt>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiceModule {
    pub source_lang: LanguageId,
    pub module_name: String,
    pub module_trivia: Trivia,
    pub items: Vec<AiceItem>,
    pub trailing_trivia: Trivia,
    pub raw_fallback: String,
}

impl AiceModule {
    pub fn new(source_lang: LanguageId, module_name: impl Into<String>) -> Self {
        Self {
            source_lang,
            module_name: module_name.into(),
            module_trivia: Trivia::default(),
            items: Vec::new(),
            trailing_trivia: Trivia::default(),
            raw_fallback: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranspileError {
    pub message: String,
    pub span: Option<Span>,
}

impl TranspileError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            span: None,
        }
    }

    pub fn at(message: impl Into<String>, span: Span) -> Self {
        Self {
            message: message.into(),
            span: Some(span),
        }
    }
}

impl fmt::Display for TranspileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(sp) = self.span
            && sp.line > 0
        {
            return write!(
                f,
                "AICE transpile error at {}:{}: {}",
                sp.line, sp.column, self.message
            );
        }
        write!(f, "AICE transpile error: {}", self.message)
    }
}

impl std::error::Error for TranspileError {}
