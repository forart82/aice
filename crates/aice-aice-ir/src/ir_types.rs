use crate::ir::{Span, Trivia, Visibility};
use crate::ir_code::{Expr, MethodDecl};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrimitiveType {
    Str,
    Int,
    Float,
    Num,
    Bool,
    Byte,
    Char,
    Void,
    Nil,
    Any,
    Unknown,
}

impl PrimitiveType {
    pub fn aice_name(self) -> &'static str {
        match self {
            Self::Str => "str",
            Self::Int => "int",
            Self::Float => "float",
            Self::Num => "num",
            Self::Bool => "bool",
            Self::Byte => "byte",
            Self::Char => "char",
            Self::Void => "void",
            Self::Nil => "nil",
            Self::Any => "any",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordTypeField {
    pub name: String,
    pub optional: bool,
    pub ty: AiceType,
}

#[derive(Debug, PartialEq, Eq)]
pub enum AiceType {
    Primitive(PrimitiveType),
    Array(Box<AiceType>),
    Tuple(Vec<AiceType>),
    Record(Vec<RecordTypeField>),
    Result {
        ok: Box<AiceType>,
        err: Box<AiceType>,
    },
    Option(Box<AiceType>),
    Union(Vec<AiceType>),
    Intersection(Vec<AiceType>),
    Refinement {
        param: String,
        base: PrimitiveType,
        predicate: Box<Expr>,
    },
    Fn {
        params: Vec<AiceType>,
        ret: Box<AiceType>,
    },
    Named {
        path: Vec<String>,
        args: Vec<AiceType>,
    },
    Raw(String),
}

impl AiceType {
    pub fn named(name: impl Into<String>) -> Self {
        Self::Named {
            path: vec![name.into()],
            args: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeParam {
    pub name: String,
    pub bounds: Vec<AiceType>,
    pub default: Option<AiceType>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParamDecl {
    pub name: String,
    pub vis: Visibility,
    pub is_readonly: bool,
    pub is_mut: bool,
    pub is_optional: bool,
    pub is_rest: bool,
    pub ty: Option<AiceType>,
    pub default: Option<Expr>,
    pub trivia: Trivia,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FieldSigil {
    RequiredStr,
    RequiredInt,
    RequiredFloat,
    RequiredBool,
    Required,
    Optional,
    #[default]
    None,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldDecl {
    pub name: String,
    pub vis: Visibility,
    pub is_readonly: bool,
    pub is_optional: bool,
    pub sigil: FieldSigil,
    pub ty: Option<AiceType>,
    pub default: Option<Expr>,
    pub trivia: Trivia,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TypeKind {
    Struct,
    Interface,
    Trait,
    Alias,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeDecl {
    pub vis: Visibility,
    pub kind: TypeKind,
    pub name: String,
    pub type_params: Vec<TypeParam>,
    pub extends: Vec<String>,
    pub fields: Vec<FieldDecl>,
    pub methods: Vec<MethodDecl>,
    pub alias_target: Option<AiceType>,
    pub trivia: Trivia,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VariantPayload {
    Unit,
    Tuple(Vec<AiceType>),
    Struct(Vec<FieldDecl>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnumVariant {
    pub name: String,
    pub payload: VariantPayload,
    pub discriminant: Option<Expr>,
    pub trivia: Trivia,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnumDecl {
    pub vis: Visibility,
    pub name: String,
    pub type_params: Vec<TypeParam>,
    pub variants: Vec<EnumVariant>,
    pub trivia: Trivia,
    pub span: Span,
}
