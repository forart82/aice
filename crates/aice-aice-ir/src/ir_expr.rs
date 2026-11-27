use crate::ir::Trivia;
use crate::ir_code::FnBody;
use crate::ir_types::{AiceType, ParamDecl};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchCase {
    pub pattern: Pattern,
    pub guard: Option<Expr>,
    pub body: FnBody,
    pub trivia: Trivia,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Pattern {
    Wildcard,
    Literal(LiteralVal),
    Ident(String),
    Constructor { name: String, args: Vec<Pattern> },
    Or(Vec<Pattern>),
    Range {
        start: Box<Expr>,
        end: Box<Expr>,
        inclusive: bool,
        negated: bool,
    },
    TypeCheck {
        ty: AiceType,
        negated: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemberKind {
    Dot,
    SafeNav,
    Scope,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecordEntry {
    Spread(Expr),
    Field { key: Option<String>, value: Expr },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompKind {
    List,
    Set,
    Dict,
    Generator,
}

#[derive(Debug, PartialEq, Eq)]
pub struct CompClause {
    pub is_async: bool,
    pub target: String,
    pub iter: Expr,
    pub filters: Vec<Expr>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Expr {
    Literal(LiteralVal),
    Template {
        quasis: Vec<String>,
        exprs: Vec<Expr>,
    },
    Ident(String),
    Raw(String),
    Binary {
        op: BinaryOp,
        left: Box<Expr>,
        right: Box<Expr>,
    },
    Unary {
        op: UnaryOp,
        is_postfix: bool,
        operand: Box<Expr>,
    },
    Conditional {
        cond: Box<Expr>,
        then_expr: Box<Expr>,
        else_expr: Box<Expr>,
    },
    PostfixTry(Box<Expr>),
    Call {
        callee: Box<Expr>,
        args: Vec<Expr>,
        is_optional: bool,
        is_tagged: bool,
        is_new: bool,
    },
    Member {
        object: Box<Expr>,
        property: String,
        kind: MemberKind,
    },
    Index {
        object: Box<Expr>,
        index: Box<Expr>,
        is_optional: bool,
    },
    Array(Vec<Expr>),
    Record(Vec<RecordEntry>),
    Closure {
        is_async: bool,
        params: Vec<ParamDecl>,
        ret: Option<AiceType>,
        body: Box<FnBody>,
    },
    Assign {
        target: Box<Expr>,
        op: AssignOp,
        value: Box<Expr>,
    },
    Await(Box<Expr>),
    Match {
        target: Box<Expr>,
        cases: Vec<MatchCase>,
    },
    Comprehension {
        kind: CompKind,
        body: Box<Expr>,
        value: Option<Box<Expr>>,
        clauses: Vec<CompClause>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LiteralVal {
    Int(String),
    Float(String),
    Bool(bool),
    Str { value: String, multiline: bool },
    Nil,
    HexColor(String),
    Regex(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinaryOp {
    Add,
    Concat,
    Sub,
    Mul,
    Div,
    FloorDiv,
    Mod,
    Pow,
    Eq,
    NotEq,
    Lt,
    LtEq,
    Gt,
    GtEq,
    Spaceship,
    And,
    Or,
    Coalesce,
    Elvis,
    BitAnd,
    BitClear,
    BitOr,
    BitXor,
    Shl,
    Shr,
    Ushr,
    In,
    NotIn,
    Is,
    IsNot,
    Instanceof,
    As,
    With,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnaryOp {
    Neg,
    Pos,
    Not,
    BitNot,
    Inc,
    Dec,
    Spread,
    Ref,
    RefMut,
    Deref,
    Typeof,
    Void,
    Delete,
    Yield,
    YieldStar,
    Generator,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssignOp {
    Assign,
    AddAssign,
    SubAssign,
    MulAssign,
    DivAssign,
    FloorDivAssign,
    TruncDivAssign,
    ModAssign,
    PowAssign,
    BitAndAssign,
    BitClearAssign,
    BitOrAssign,
    BitXorAssign,
    ShlAssign,
    ShrAssign,
    UshrAssign,
    CoalesceAssign,
    AndAssign,
    OrAssign,
    ConcatAssign,
}
