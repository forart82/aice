use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::EmitCtx;
use crate::compile::expr_emit::ExprEmitCtx;
use crate::compile::type_map::emit_type;
use crate::ir_code::Stmt;
use crate::ir_types::AiceType;

pub(crate) fn emit_brace_stmts(
    stmts: &[Stmt],
    lang: LanguageId,
    ec: &mut EmitCtx,
    ectx: &ExprEmitCtx,
    tail_return_expr: bool,
) {
    crate::compile::iter_emit::run_brace_stmts(stmts, lang, ec, ectx, tail_return_expr);
}

pub(crate) fn format_brace_let(
    name: &str,
    is_mut: bool,
    ty: Option<&AiceType>,
    rhs: Option<&str>,
    lang: LanguageId,
    semi: &str,
) -> String {
    match (lang, rhs) {
        (LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript, Some(r)) => {
            let kw = if is_mut { "let" } else { "const" };
            let t = if lang != LanguageId::JavaScript { ty.map(|x| format!(": {}", emit_type(x, lang))).unwrap_or_default() } else { String::new() };
            format!("{kw} {name}{t} = {r}{semi}")
        }
        (LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript, None) => {
            let t = if lang != LanguageId::JavaScript { ty.map(|x| format!(": {}", emit_type(x, lang))).unwrap_or_default() } else { String::new() };
            format!("let {name}{t}{semi}")
        }
        (LanguageId::Rust, Some(r)) => format!(
            "{} {name}{} = {r};",
            if is_mut && !name.starts_with(['(', '[', '{']) { "let mut" } else { "let" },
            ty.map(|x| format!(": {}", emit_type(x, lang))).unwrap_or_default()
        ),
        (LanguageId::Rust, None) => format!(
            "{} {name}{};",
            if is_mut && !name.starts_with(['(', '[', '{']) { "let mut" } else { "let" },
            ty.map(|x| format!(": {}", emit_type(x, lang))).unwrap_or_default()
        ),
        (LanguageId::Go, Some(r)) => format!("{name} := {r}"),
        (LanguageId::Go, None) => format!("var {name} {}", ty.map(|x| emit_type(x, lang)).unwrap_or_else(|| "any".into())),
        (LanguageId::Kotlin, Some(r)) => format!("{} {name}{} = {r}", if is_mut { "var" } else { "val" }, ty.map(|x| format!(": {}", emit_type(x, lang))).unwrap_or_default()),
        (LanguageId::Kotlin, None) => format!("{} {name}{}", if is_mut { "var" } else { "val" }, ty.map(|x| format!(": {}", emit_type(x, lang))).unwrap_or_default()),
        (LanguageId::Php, r) => format!("{} = {};", if name.starts_with('$') { name.to_string() } else { format!("${name}") }, r.unwrap_or("null")),
        (LanguageId::Cpp, Some(r)) => format!("{} {name} = {r};", ty.map(|x| emit_type(x, lang)).unwrap_or_else(|| "auto".into())),
        (LanguageId::Cpp, None) => format!("{} {name};", ty.map(|x| emit_type(x, lang)).unwrap_or_else(|| "auto".into())),
        (_, Some(r)) => format!("{} {name} = {r};", ty.map(|x| emit_type(x, lang)).unwrap_or_else(|| "var".into())),
        (_, None) => format!("{} {name};", ty.map(|x| emit_type(x, lang)).unwrap_or_else(|| if lang == LanguageId::C { "int".into() } else { "var".into() })),
    }
}
