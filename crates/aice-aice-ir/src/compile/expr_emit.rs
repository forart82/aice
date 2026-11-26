use std::collections::HashSet;

use aice_lang_registry::LanguageId;

use crate::ir::{AiceItem, AiceModule};
use crate::ir_code::{AssignOp, BinaryOp, Expr, LiteralVal};

pub(crate) struct ExprEmitCtx {
    pub class_names: HashSet<String>,
}

impl ExprEmitCtx {
    pub fn from_module(m: &AiceModule) -> Self {
        let mut class_names = HashSet::new();
        for it in &m.items {
            match it {
                AiceItem::Class(c) => { class_names.insert(c.name.clone()); }
                AiceItem::Import(imp) => {
                    for sp in &imp.specifiers {
                        if sp.name.chars().next().is_some_and(char::is_uppercase) {
                            class_names.insert(sp.alias.clone().unwrap_or_else(|| sp.name.clone()));
                        }
                    }
                }
                _ => {}
            }
        }
        Self { class_names }
    }
}

pub(crate) fn emit_expr(e: &Expr, lang: LanguageId, ctx: &ExprEmitCtx) -> String {
    crate::compile::iter_emit::run_expr(e, lang, ctx)
}

pub(crate) fn emit_ident(s: &str, lang: LanguageId) -> String {
    match (s, lang) {
        ("this", LanguageId::Python | LanguageId::Rust | LanguageId::Ruby) => "self".into(),
        ("this", LanguageId::Php) => "$this".into(),
        ("self", LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript | LanguageId::Java | LanguageId::CSharp | LanguageId::Dart) => "this".into(),
        _ if lang == LanguageId::Php && !s.starts_with('$') && !s.contains("::") && s.chars().next().is_some_and(|c| c.is_ascii_lowercase()) => {
            format!("${s}")
        }
        _ => s.to_string(),
    }
}

pub(crate) fn emit_lit(l: &LiteralVal, lang: LanguageId) -> String {
    match l {
        LiteralVal::Int(s) | LiteralVal::Float(s) | LiteralVal::Regex(s) => s.clone(),
        LiteralVal::HexColor(s) => format!("\"{s}\""),
        LiteralVal::Bool(b) => match (b, lang) {
            (true, LanguageId::Python) => "True".into(),
            (false, LanguageId::Python) => "False".into(),
            (true, _) => "true".into(),
            (false, _) => "false".into(),
        },
        LiteralVal::Nil => match lang {
            LanguageId::Python => "None".into(),
            LanguageId::Rust => "None".into(),
            LanguageId::Go | LanguageId::Ruby => "nil".into(),
            LanguageId::Cpp => "nullptr".into(),
            LanguageId::C => "NULL".into(),
            _ => "null".into(),
        },
        LiteralVal::Str { value, .. } => format!("\"{}\"", crate::printer_expr::escape_str(value)),
    }
}

pub(crate) fn is_str_like(e: &Expr) -> bool {
    matches!(e, Expr::Literal(LiteralVal::Str { .. }) | Expr::Template { .. })
}

pub(crate) fn bin_op_native(op: BinaryOp) -> &'static str {
    match op {
        BinaryOp::Add | BinaryOp::Concat => "+", BinaryOp::Sub => "-", BinaryOp::Mul => "*",
        BinaryOp::Div => "/", BinaryOp::FloorDiv => "/", BinaryOp::Mod => "%", BinaryOp::Pow => "**",
        BinaryOp::Eq => "==", BinaryOp::NotEq => "!=",
        BinaryOp::Lt => "<", BinaryOp::LtEq => "<=", BinaryOp::Gt => ">", BinaryOp::GtEq => ">=",
        BinaryOp::Spaceship => "<=>",
        BinaryOp::And => "&&", BinaryOp::Or => "||",
        BinaryOp::Coalesce => "??", BinaryOp::Elvis => "?:",
        BinaryOp::BitAnd => "&", BinaryOp::BitClear => "&^", BinaryOp::BitOr => "|", BinaryOp::BitXor => "^",
        BinaryOp::Shl => "<<", BinaryOp::Shr => ">>", BinaryOp::Ushr => ">>>",
        BinaryOp::In => "in", BinaryOp::NotIn => "not in",
        BinaryOp::Is => "is", BinaryOp::IsNot => "is not",
        BinaryOp::Instanceof => "instanceof", BinaryOp::As => "as",
    }
}

pub(crate) fn assign_native(op: AssignOp, lang: LanguageId) -> &'static str {
    match op {
        AssignOp::Assign => "=", AssignOp::AddAssign => "+=", AssignOp::SubAssign => "-=",
        AssignOp::MulAssign => "*=", AssignOp::DivAssign => "/=",
        AssignOp::FloorDivAssign => if lang == LanguageId::Dart { "~/=" } else { "//=" },
        AssignOp::TruncDivAssign => if lang == LanguageId::Python { "//=" } else { "~/=" },
        AssignOp::ModAssign => "%=", AssignOp::PowAssign => "**=",
        AssignOp::BitAndAssign => "&=", AssignOp::BitClearAssign => "&^=",
        AssignOp::BitOrAssign => "|=", AssignOp::BitXorAssign => "^=",
        AssignOp::ShlAssign => "<<=", AssignOp::ShrAssign => ">>=", AssignOp::UshrAssign => ">>>=",
        AssignOp::CoalesceAssign => "??=", AssignOp::AndAssign => "&&=", AssignOp::OrAssign => "||=",
        AssignOp::ConcatAssign => if lang == LanguageId::Php { ".=" } else { "+=" },
    }
}

pub(crate) fn format_in_op(op: BinaryOp, l: &str, r: &str, lang: LanguageId) -> String {
    let neg = op == BinaryOp::NotIn;
    match (lang, neg) {
        (LanguageId::Python, false) => format!("{l} in {r}"),
        (LanguageId::Python, true) => format!("{l} not in {r}"),
        (LanguageId::Kotlin, false) => format!("{l} in {r}"),
        (LanguageId::Kotlin, true) => format!("{l} !in {r}"),
        (LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript, false) => format!("{l} in {r}"),
        (LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript, true) => format!("!({l} in {r})"),
        (LanguageId::Ruby, false) => format!("{r}.include?({l})"),
        (LanguageId::Ruby, true) => format!("!{r}.include?({l})"),
        (LanguageId::Php, false) => format!("in_array({l}, {r})"),
        (LanguageId::Php, true) => format!("!in_array({l}, {r})"),
        (LanguageId::Rust, false) => format!("{r}.contains(&{l})"),
        (LanguageId::Rust, true) => format!("!{r}.contains(&{l})"),
        (LanguageId::CSharp, false) => format!("{r}.Contains({l})"),
        (LanguageId::CSharp, true) => format!("!{r}.Contains({l})"),
        (LanguageId::Java | LanguageId::Dart, false) => format!("{r}.contains({l})"),
        (LanguageId::Java | LanguageId::Dart, true) => format!("!{r}.contains({l})"),
        (_, false) => format!("contains({r}, {l})"),
        (_, true) => format!("!contains({r}, {l})"),
    }
}
