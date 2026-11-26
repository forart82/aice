use aice_lang_registry::LanguageId;

use crate::compile::dart;
use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::compile::kotlin;
use crate::compile::type_map::emit_type;
use crate::ir::{AiceModule, TranspileError, Trivia, TriviaKind};
use crate::ir_code::ClassDecl;
use crate::ir_types::{AiceType, EnumDecl, PrimitiveType, TypeParam};

pub fn compile(module: &AiceModule, target: LanguageId) -> Result<String, TranspileError> {
    match target {
        LanguageId::Kotlin => kotlin::compile(module),
        _ => dart::compile(module),
    }
}

pub(crate) fn emit_kt_type(ty: &AiceType) -> String {
    if let AiceType::Option(inner) = ty
        && matches!(inner.as_ref(), AiceType::Fn { .. })
    {
        return format!("({})?", emit_kt_type(inner));
    }
    emit_type(ty, LanguageId::Kotlin)
}

pub(crate) fn emit_kt_type_params(tps: &[TypeParam]) -> (String, String) {
    if tps.is_empty() { return (String::new(), String::new()); }
    let mut angle = Vec::new();
    let mut wheres = Vec::new();
    for tp in tps {
        match tp.bounds.as_slice() {
            [] => angle.push(tp.name.clone()),
            [b] => angle.push(format!("{} : {}", tp.name, emit_kt_type(b))),
            many => {
                angle.push(tp.name.clone());
                for b in many {
                    wheres.push(format!("{} : {}", tp.name, emit_kt_type(b)));
                }
            }
        }
    }
    let a = format!("<{}>", angle.join(", "));
    let w = if wheres.is_empty() { String::new() } else { format!(" where {}", wheres.join(", ")) };
    (a, w)
}

pub(crate) fn emit_dart_type(ty: &AiceType) -> String {
    if *ty == AiceType::Primitive(PrimitiveType::Num) {
        return "num".into();
    }
    emit_type(ty, LanguageId::Dart)
}

pub(crate) fn emit_dart_type_params(tps: &[TypeParam]) -> String {
    if tps.is_empty() { return String::new(); }
    let items: Vec<String> = tps.iter().map(|tp| {
        if let Some(b) = tp.bounds.first() {
            format!("{} extends {}", tp.name, emit_dart_type(b))
        } else {
            tp.name.clone()
        }
    }).collect();
    format!("<{}>", items.join(", "))
}

pub(crate) fn dart_has_dec(cd: &ClassDecl, k: &str) -> bool {
    cd.decorators.iter().any(|d| d.trim_start_matches('@') == k)
}

pub(crate) fn dart_dec_arg<'a>(cd: &'a ClassDecl, prefix: &str) -> Option<&'a str> {
    cd.decorators.iter().find_map(|d| {
        d.trim_start_matches('@')
            .strip_prefix(prefix)
            .and_then(|r| r.strip_prefix('('))
            .and_then(|r| r.strip_suffix(')'))
    })
}

pub(crate) fn dart_has_attr(tr: &Trivia, needle: &str) -> bool {
    tr.leading.iter().any(|c| c.kind == TriviaKind::Attribute && c.text.trim_start_matches('@') == needle)
}

pub(crate) fn emit_dart_enum(ec: &mut EmitCtx, ed: &EnumDecl) {
    ec.blank();
    ec.emit_trivia(&ed.trivia, CommentStyle::Slash);
    let tps = emit_dart_type_params(&ed.type_params);
    ec.line(&format!("enum {}{tps} {{", ed.name));
    ec.push();
    for (idx, v) in ed.variants.iter().enumerate() {
        ec.emit_trivia(&v.trivia, CommentStyle::Slash);
        let comma = if idx + 1 < ed.variants.len() { "," } else { "" };
        ec.line(&format!("{}{comma}", v.name));
    }
    ec.pop();
    ec.line("}");
}
