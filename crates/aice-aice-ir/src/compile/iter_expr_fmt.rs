use aice_lang_registry::LanguageId;

use crate::compile::type_map::emit_type;
use crate::ir_code::UnaryOp;
use crate::ir_types::{AiceType, ParamDecl};

pub(crate) fn unary_op_native(op: UnaryOp, lang: LanguageId) -> &'static str {
    match (op, lang) {
        (UnaryOp::Not, LanguageId::Python) => "not ",
        (UnaryOp::Not, _) => "!",
        (UnaryOp::Neg, _) => "-",
        (UnaryOp::Pos, _) => "+",
        (UnaryOp::BitNot, _) => "~",
        (UnaryOp::Inc, _) => "++",
        (UnaryOp::Dec, _) => "--",
        (UnaryOp::Spread, _) => "...",
        (UnaryOp::Ref, LanguageId::Rust | LanguageId::Go | LanguageId::Cpp | LanguageId::C | LanguageId::Php) => "&",
        (UnaryOp::RefMut, LanguageId::Rust) => "&mut ",
        (UnaryOp::RefMut, LanguageId::Go | LanguageId::Cpp | LanguageId::C) => "&",
        (UnaryOp::Deref, LanguageId::Rust | LanguageId::Go | LanguageId::Cpp | LanguageId::C) => "*",
        _ => "",
    }
}

pub(crate) fn format_template(quasis: &[String], exs: &[String], lang: LanguageId) -> String {
    let (head, tail, op) = match lang {
        LanguageId::Python => ("f\"", "\"", ""),
        LanguageId::Kotlin | LanguageId::Dart => ("\"", "\"", "$"),
        LanguageId::Ruby => ("\"", "\"", "#"),
        _ => ("`", "`", "$"),
    };
    let mut s = String::from(head);
    for (i, q) in quasis.iter().enumerate() {
        if matches!(lang, LanguageId::Python | LanguageId::Kotlin | LanguageId::Dart | LanguageId::Ruby) {
            s.push_str(&crate::printer_expr::escape_str(q));
        } else {
            s.push_str(q);
        }
        if let Some(ex) = exs.get(i) {
            s.push_str(&format!("{op}{{{ex}}}"));
        }
    }
    s.push_str(tail);
    s
}

pub(crate) fn format_closure_param(p: &ParamDecl, def: Option<&str>, lang: LanguageId) -> String {
    let d = def.map(|x| format!(" = {x}")).unwrap_or_default();
    let rest = if p.is_rest { "..." } else { "" };
    match lang {
        LanguageId::TypeScript | LanguageId::Tsx => {
            let opt = if p.is_optional && def.is_none() { "?" } else { "" };
            let ty = p.ty.as_ref().map(|t| format!(": {}", emit_type(t, lang))).unwrap_or_default();
            format!("{rest}{}{opt}{ty}{d}", p.name)
        }
        LanguageId::Rust | LanguageId::Kotlin => {
            let ty = p.ty.as_ref().map(|t| format!(": {}", emit_type(t, lang))).unwrap_or_default();
            format!("{}{ty}", p.name)
        }
        LanguageId::Go => {
            let ty = p.ty.as_ref().map(|t| format!(" {}", emit_type(t, lang))).unwrap_or_default();
            format!("{}{ty}", p.name)
        }
        LanguageId::Cpp => {
            let ty = p.ty.as_ref().map(|t| emit_type(t, lang)).unwrap_or_else(|| "auto".into());
            format!("{ty} {}{d}", p.name)
        }
        LanguageId::Php => {
            let ty = p.ty.as_ref().map(|t| format!("{} ", emit_type(t, lang))).unwrap_or_default();
            let nm = if p.name.starts_with('$') { p.name.clone() } else { format!("${}", p.name) };
            format!("{ty}{nm}{d}")
        }
        LanguageId::CSharp => {
            let ty = p.ty.as_ref().map(|t| format!("{} ", emit_type(t, lang))).unwrap_or_default();
            format!("{ty}{}{d}", p.name)
        }
        LanguageId::Dart => {
            let ty = p.ty.as_ref().map(|t| format!("{} ", emit_type(t, lang))).unwrap_or_default();
            format!("{ty}{}{d}", p.name)
        }
        _ => format!("{rest}{}{d}", p.name),
    }
}

pub(crate) fn format_closure(
    is_async: bool,
    ps: &[String],
    ret: Option<&AiceType>,
    bk: u8,
    body: Option<&str>,
    lang: LanguageId,
) -> String {
    let asy = if is_async { "async " } else { "" };
    if lang == LanguageId::Python {
        return format!("lambda {}: {}", ps.join(", "), body.unwrap_or("None"));
    }
    if lang == LanguageId::Ruby {
        let p_s = ps.join(", ");
        return match bk {
            1 => format!("->({p_s}) {{ {} }}", body.unwrap()),
            2 => {
                let inner = body.unwrap().trim_end();
                if inner.is_empty() { format!("->({p_s}) {{}}") }
                else if !inner.contains('\n') { format!("->({p_s}) {{ {} }}", inner.trim()) }
                else { format!("->({p_s}) {{\n{inner}\n}}") }
            }
            _ => format!("->({p_s}) {{ nil }}"),
        };
    }
    let trimmed = body.map(|b| b.trim_end()).unwrap_or("");
    let rhs = match bk {
        1 => body.unwrap().to_string(),
        2 => {
            if lang == LanguageId::Kotlin {
                let p_hdr = if ps.is_empty() { String::new() } else { format!("{} -> ", ps.join(", ")) };
                let inner_k = if trimmed.is_empty() { String::new() } else { format!("\n{trimmed}\n") };
                return format!("{{ {p_hdr}{inner_k} }}");
            }
            if trimmed.is_empty() { "{}".into() }
            else if !trimmed.contains('\n') { format!("{{ {} }}", trimmed.trim()) }
            else { format!("{{\n{trimmed}\n}}") }
        }
        _ => "null".into(),
    };
    match lang {
        LanguageId::Rust => {
            let rt = ret.map(|t| format!(" -> {}", emit_type(t, lang))).unwrap_or_default();
            if rt.is_empty() || bk != 2 { format!("|{}| {rhs}", ps.join(", ")) }
            else { format!("|{}|{rt} {rhs}", ps.join(", ")) }
        }
        LanguageId::Php if bk == 1 => format!("fn({}) => {rhs}", ps.join(", ")),
        LanguageId::Php => format!("function({}) {rhs}", ps.join(", ")),
        LanguageId::Go => {
            let rt = ret.map(|t| format!(" {}", emit_type(t, lang))).unwrap_or_default();
            let b = if bk == 2 { rhs } else { format!("{{ return {rhs} }}") };
            format!("func({}){rt} {b}", ps.join(", "))
        }
        LanguageId::Java => format!("({}) -> {rhs}", ps.join(", ")),
        LanguageId::Kotlin => format!("{{ {}{rhs} }}", if ps.is_empty() { String::new() } else { format!("{} -> ", ps.join(", ")) }),
        LanguageId::Dart if bk == 2 => format!("({}) {rhs}", ps.join(", ")),
        LanguageId::Dart => format!("({}) => {rhs}", ps.join(", ")),
        LanguageId::Cpp => {
            let rt = ret.map(|t| format!(" -> {}", emit_type(t, lang))).unwrap_or_default();
            let b = if bk == 2 { rhs } else { format!("{{ return {rhs}; }}") };
            format!("[&]({}){rt} {b}", ps.join(", "))
        }
        _ => {
            let rt = if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx) {
                ret.map(|t| format!(": {}", emit_type(t, lang))).unwrap_or_default()
            } else { String::new() };
            format!("{asy}({}){rt} => {rhs}", ps.join(", "))
        }
    }
}
