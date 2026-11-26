use crate::ir::{Span, Trivia, Visibility};
use crate::ir_code::{Expr, Stmt};
pub use crate::ir_domain_db::{
    DbColumn, DbMigrationDecl, DbQueryDecl, DbQueryKind, DbSchemaDecl, GraphQlField, PrismaField,
};
use crate::ir_types::{ParamDecl, TypeParam};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComponentDecl {
    pub vis: Visibility,
    pub name: String,
    pub type_params: Vec<TypeParam>,
    pub params: Vec<ParamDecl>,
    pub has_doctype: bool,
    pub body_stmts: Vec<Stmt>,
    pub layout: Vec<LayoutNode>,
    pub trivia: Trivia,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LayoutAttr {
    pub name: String,
    pub value: Option<Expr>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TemplateCtrlKind {
    Extends,
    Include,
    Use,
    Import,
    From,
    Block,
    If,
    For,
    Set,
    Macro,
    Apply,
    Filter,
    Embed,
    Verbatim,
    Do,
    Flush,
    ExprOut,
    RawTag,
}

#[derive(Debug, PartialEq, Eq)]
pub enum LayoutNode {
    Element {
        tag: String,
        attrs: Vec<LayoutAttr>,
        text: Option<String>,
        child_expr: Option<Expr>,
        children: Vec<LayoutNode>,
        trivia: Trivia,
    },
    TemplateCtrl {
        kind: TemplateCtrlKind,
        arg: String,
        children: Vec<LayoutNode>,
        branches: Vec<(String, Vec<LayoutNode>)>,
        trivia: Trivia,
    },
    Comment(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StyleProp {
    pub name: String,
    pub value: Option<String>,
    pub trivia: Trivia,
}

#[derive(Debug, PartialEq, Eq)]
pub struct StyleDecl {
    pub selector: String,
    pub props: Vec<StyleProp>,
    pub children: Vec<StyleDecl>,
    pub trivia: Trivia,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenSheetDecl {
    pub namespace: String,
    pub unit: Option<String>,
    pub entries: Vec<(String, String)>,
    pub trivia: Trivia,
    pub span: Span,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DataFormatKind {
    Json,
    Yaml,
    Toml,
    Xml,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DataScalar {
    Str(String),
    Int(String),
    Float(String),
    Bool(bool),
    Null,
    Raw(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataDecl {
    pub format: DataFormatKind,
    pub prolog: Vec<String>,
    pub root: Vec<DataNode>,
    pub trivia: Trivia,
    pub span: Span,
}

#[derive(Debug, PartialEq, Eq)]
pub enum DataNode {
    Scalar {
        key: Option<String>,
        val: DataScalar,
        anchor: Option<String>,
        tag: Option<String>,
        trivia: Trivia,
    },
    Seq {
        key: Option<String>,
        items: Vec<DataNode>,
        anchor: Option<String>,
        trivia: Trivia,
    },
    Map {
        key: Option<String>,
        entries: Vec<DataNode>,
        anchor: Option<String>,
        trivia: Trivia,
    },
    TableSection {
        path: String,
        is_array_table: bool,
        entries: Vec<DataNode>,
        trivia: Trivia,
    },
    XmlElem {
        tag: String,
        attrs: Vec<(String, String)>,
        text: Option<String>,
        children: Vec<DataNode>,
        trivia: Trivia,
    },
    DtdDecl {
        kind: String,
        name: String,
        spec: String,
        trivia: Trivia,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DocBlock {
    Paragraph(String),
    ListItem {
        ordered: bool,
        checked: Option<bool>,
        text: String,
    },
    CodeFence {
        lang: String,
        code: String,
    },
    Table {
        headers: Vec<String>,
        rows: Vec<Vec<String>>,
    },
    Quote(String),
    ThematicBreak,
    LinkRef {
        label: String,
        dest: String,
    },
    Frontmatter {
        marker: String,
        body: String,
    },
}

#[derive(Debug, PartialEq, Eq)]
pub struct DocSection {
    pub level: u8,
    pub heading: String,
    pub blocks: Vec<DocBlock>,
    pub children: Vec<DocSection>,
    pub trivia: Trivia,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellDecl {
    Shebang(String),
    SetFlags(String),
    Var {
        name: String,
        value: String,
        exported: bool,
        readonly: bool,
        trivia: Trivia,
    },
    Fn {
        name: String,
        body_lines: Vec<String>,
        trivia: Trivia,
    },
    Cmd {
        text: String,
        trivia: Trivia,
    },
}
