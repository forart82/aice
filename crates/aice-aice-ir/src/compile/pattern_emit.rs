use aice_lang_registry::LanguageId;

use crate::compile::type_map::emit_type;
use crate::ir_code::{Expr, LiteralVal, MatchCase, Pattern, UnaryOp};
use crate::ir_types::{AiceType, PrimitiveType};

pub(crate) fn pat_has_wildcard(root: &Pattern) -> bool {
    let mut stack = vec![root];
    while let Some(p) = stack.pop() {
        match p {
            Pattern::Wildcard => return true,
            Pattern::Or(ps) => {
                for sub in ps { stack.push(sub); }
            }
            _ => {}
        }
    }
    false
}

pub(crate) fn emit_type_check_expr(subj: &str, ty: &AiceType, lang: LanguageId) -> String {
    let t = emit_type(ty, lang);
    match lang {
        LanguageId::Python => {
            let py_t = match ty {
                AiceType::Array(_) => "list".to_string(),
                AiceType::Tuple(_) => "tuple".to_string(),
                AiceType::Named { path, .. } => path.join("."),
                _ => t.split('<').next().unwrap_or(&t).trim().to_string(),
            };
            format!("isinstance({subj}, {py_t})")
        }
        LanguageId::Ruby => match ty {
            AiceType::Primitive(PrimitiveType::Int) => format!("{subj}.is_a?(Integer)"),
            AiceType::Primitive(PrimitiveType::Num | PrimitiveType::Float) => format!("{subj}.is_a?(Float)"),
            AiceType::Primitive(PrimitiveType::Str) => format!("{subj}.is_a?(String)"),
            AiceType::Primitive(PrimitiveType::Bool) => format!("({subj}.is_a?(TrueClass) || {subj}.is_a?(FalseClass))"),
            AiceType::Primitive(PrimitiveType::Any | PrimitiveType::Unknown) => format!("{subj}.is_a?(Object)"),
            AiceType::Array(_) => format!("{subj}.is_a?(Array)"),
            AiceType::Named { path, .. } => format!("{subj}.is_a?({})", path.join("::")),
            _ => {
                let base = t.split('<').next().unwrap_or(&t).trim();
                format!("{subj}.is_a?({base})")
            }
        },
        LanguageId::Kotlin | LanguageId::Dart | LanguageId::CSharp => format!("{subj} is {t}"),
        LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript => match ty {
            AiceType::Primitive(PrimitiveType::Num | PrimitiveType::Int | PrimitiveType::Float) => {
                format!("typeof {subj} === \"number\"")
            }
            AiceType::Primitive(PrimitiveType::Str) => format!("typeof {subj} === \"string\""),
            AiceType::Primitive(PrimitiveType::Bool) => format!("typeof {subj} === \"boolean\""),
            _ => format!("{subj} instanceof {t}"),
        },
        LanguageId::Java => match ty {
            AiceType::Primitive(PrimitiveType::Int) => format!("{subj} instanceof Integer"),
            AiceType::Primitive(PrimitiveType::Num | PrimitiveType::Float) => format!("{subj} instanceof Double"),
            AiceType::Primitive(PrimitiveType::Bool) => format!("{subj} instanceof Boolean"),
            AiceType::Primitive(PrimitiveType::Str) => format!("{subj} instanceof String"),
            _ => format!("{subj} instanceof {t}"),
        },
        LanguageId::Php => match ty {
            AiceType::Primitive(PrimitiveType::Int) => format!("is_int({subj})"),
            AiceType::Primitive(PrimitiveType::Num | PrimitiveType::Float) => format!("is_float({subj})"),
            AiceType::Primitive(PrimitiveType::Bool) => format!("is_bool({subj})"),
            AiceType::Primitive(PrimitiveType::Str) => format!("is_string({subj})"),
            _ => format!("{subj} instanceof {t}"),
        },
        _ => "true".into(),
    }
}

pub(crate) fn needs_if_lowering(target: &Expr, cases: &[MatchCase], lang: LanguageId) -> bool {
    let has_guard = cases.iter().any(|c| c.guard.is_some());
    let subjectless = matches!(target, Expr::Literal(LiteralVal::Bool(true))) && has_guard;
    match lang {
        LanguageId::Rust => subjectless || cases.iter().any(|c| pat_needs_if_rust(&c.pattern)),
        LanguageId::Kotlin => !subjectless && has_guard,
        LanguageId::Python => subjectless || cases.iter().any(|c| pat_has_range_or_type(&c.pattern)),
        LanguageId::Ruby => {
            subjectless || has_guard || cases.iter().any(|c| pat_has_neg_range_or_type(&c.pattern))
        }
        _ => subjectless || has_guard || cases.iter().any(|c| pat_has_range_or_type(&c.pattern)),
    }
}

fn pat_has_range_or_type(root: &Pattern) -> bool {
    let mut stack = vec![root];
    while let Some(p) = stack.pop() {
        match p {
            Pattern::Range { .. } | Pattern::TypeCheck { .. } => return true,
            Pattern::Or(ps) => stack.extend(ps.iter()),
            _ => {}
        }
    }
    false
}

pub(crate) fn wrap_range_bound_str(e: &Expr, s: String) -> String {
    match e {
        Expr::Literal(_) | Expr::Ident(_) | Expr::Call { .. }
        | Expr::Member { .. } | Expr::Index { .. } | Expr::Array(_) => s,
        Expr::Unary { op: UnaryOp::Neg | UnaryOp::Pos, is_postfix: false, operand }
            if matches!(operand.as_ref(), Expr::Literal(LiteralVal::Int(_) | LiteralVal::Float(_)) | Expr::Ident(_)) => s,
        _ => format!("({s})"),
    }
}

fn is_rust_range_lit(e: &Expr) -> bool {
    match e {
        Expr::Literal(LiteralVal::Int(_) | LiteralVal::Float(_)) => true,
        Expr::Unary { op: UnaryOp::Neg, is_postfix: false, operand } => {
            matches!(operand.as_ref(), Expr::Literal(LiteralVal::Int(_) | LiteralVal::Float(_)))
        }
        _ => false,
    }
}

fn pat_needs_if_rust(root: &Pattern) -> bool {
    let mut stack = vec![root];
    while let Some(p) = stack.pop() {
        match p {
            Pattern::Range { negated: true, .. } | Pattern::TypeCheck { .. } => return true,
            Pattern::Range { start, end, .. } => {
                if !is_rust_range_lit(start) || !is_rust_range_lit(end) { return true; }
            }
            Pattern::Or(ps) => stack.extend(ps.iter()),
            _ => {}
        }
    }
    false
}

fn pat_has_neg_range_or_type(root: &Pattern) -> bool {
    let mut stack = vec![root];
    while let Some(p) = stack.pop() {
        match p {
            Pattern::Range { negated: true, .. } | Pattern::TypeCheck { .. } => return true,
            Pattern::Or(ps) => stack.extend(ps.iter()),
            _ => {}
        }
    }
    false
}
