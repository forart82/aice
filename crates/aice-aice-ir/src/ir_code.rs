use crate::ir::{Span, Trivia, Visibility};
pub use crate::ir_expr::{
    AssignOp, BinaryOp, Expr, LiteralVal, MatchCase, MemberKind, Pattern, RecordEntry, UnaryOp,
};
use crate::ir_types::{AiceType, ParamDecl, TypeParam};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FnBody {
    Block(Vec<Stmt>),
    Expr(Expr),
    SignatureOnly,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FnDecl {
    pub vis: Visibility,
    pub is_async: bool,
    pub is_static: bool,
    pub decorators: Vec<String>,
    pub name: String,
    pub type_params: Vec<TypeParam>,
    pub params: Vec<ParamDecl>,
    pub return_type: Option<AiceType>,
    pub body: FnBody,
    pub trivia: Trivia,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PropDecl {
    pub name: String,
    pub aliases: Vec<String>,
    pub vis: Visibility,
    pub is_static: bool,
    pub is_readonly: bool,
    pub is_mut: bool,
    pub is_optional: bool,
    pub ty: Option<AiceType>,
    pub init: Option<Expr>,
    pub trivia: Trivia,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AccessorKind {
    #[default]
    Normal,
    Get,
    Set,
    Constructor,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MethodDecl {
    pub vis: Visibility,
    pub is_static: bool,
    pub is_async: bool,
    pub is_const: bool,
    pub accessor: AccessorKind,
    pub name: String,
    pub type_params: Vec<TypeParam>,
    pub params: Vec<ParamDecl>,
    pub return_type: Option<AiceType>,
    pub body: FnBody,
    pub trivia: Trivia,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClassDecl {
    pub vis: Visibility,
    pub is_abstract: bool,
    pub decorators: Vec<String>,
    pub name: String,
    pub type_params: Vec<TypeParam>,
    pub primary_ctor: Vec<ParamDecl>,
    pub extends: Option<String>,
    pub implements: Vec<String>,
    pub props: Vec<PropDecl>,
    pub methods: Vec<MethodDecl>,
    pub static_blocks: Vec<Vec<Stmt>>,
    pub trivia: Trivia,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConstDecl {
    pub vis: Visibility,
    pub name: String,
    pub ty: Option<AiceType>,
    pub value: Expr,
    pub trivia: Trivia,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VarDecl {
    pub vis: Visibility,
    pub is_mut: bool,
    pub name: String,
    pub ty: Option<AiceType>,
    pub value: Expr,
    pub trivia: Trivia,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatchClause {
    pub param: Option<String>,
    pub ty: Option<AiceType>,
    pub body: Vec<Stmt>,
    pub trivia: Trivia,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Stmt {
    Let {
        name: String,
        is_mut: bool,
        ty: Option<AiceType>,
        init: Expr,
        trivia: Trivia,
    },
    Destructure {
        names: Vec<String>,
        is_mut: bool,
        ty: Option<AiceType>,
        init: Expr,
        trivia: Trivia,
    },
    Assign {
        target: Expr,
        op: AssignOp,
        value: Expr,
        trivia: Trivia,
    },
    Return {
        value: Option<Expr>,
        trivia: Trivia,
    },
    Expr {
        expr: Expr,
        trivia: Trivia,
    },
    If {
        cond: Expr,
        then_body: Vec<Stmt>,
        elifs: Vec<(Expr, Vec<Stmt>)>,
        elif_trivias: Vec<Trivia>,
        else_body: Option<Vec<Stmt>>,
        else_trivia: Trivia,
        trivia: Trivia,
    },
    Match {
        target: Expr,
        cases: Vec<MatchCase>,
        trivia: Trivia,
    },
    For {
        binding: String,
        iter: Expr,
        body: Vec<Stmt>,
        trivia: Trivia,
    },
    While {
        cond: Expr,
        body: Vec<Stmt>,
        trivia: Trivia,
    },
    Loop {
        body: Vec<Stmt>,
        trivia: Trivia,
    },
    Try {
        try_body: Vec<Stmt>,
        catches: Vec<CatchClause>,
        finally_body: Option<Vec<Stmt>>,
        finally_trivia: Trivia,
        trivia: Trivia,
    },
    Throw {
        expr: Expr,
        trivia: Trivia,
    },
    Break {
        label: Option<String>,
        trivia: Trivia,
    },
    Continue {
        label: Option<String>,
        trivia: Trivia,
    },
    Pass,
    Comment(Trivia),
}
