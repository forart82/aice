use aice_lang_registry::LanguageId;

use crate::compile::csharp;
use crate::compile::java_lang;
use crate::compile::type_map::emit_type;
use crate::ir::{AiceModule, TranspileError, Trivia, TriviaKind};
use crate::ir_code::ClassDecl;
use crate::ir_types::TypeParam;

pub fn compile(module: &AiceModule, target: LanguageId) -> Result<String, TranspileError> {
    match target {
        LanguageId::CSharp => csharp::compile(module),
        _ => java_lang::compile(module),
    }
}

pub(crate) fn emit_java_type_params(tps: &[TypeParam]) -> String {
    if tps.is_empty() { return String::new(); }
    let items: Vec<String> = tps.iter().map(|tp| {
        if tp.bounds.is_empty() {
            tp.name.clone()
        } else {
            let bs: Vec<String> = tp.bounds.iter().map(|b| emit_type(b, LanguageId::Java)).collect();
            format!("{} extends {}", tp.name, bs.join(" & "))
        }
    }).collect();
    format!("<{}>", items.join(", "))
}

pub(crate) fn emit_cs_type_params(tps: &[TypeParam]) -> String {
    if tps.is_empty() { return String::new(); }
    let names: Vec<&str> = tps.iter().map(|tp| tp.name.as_str()).collect();
    format!("<{}>", names.join(", "))
}

pub(crate) fn emit_cs_where(tps: &[TypeParam]) -> String {
    let mut out = String::new();
    for tp in tps {
        if !tp.bounds.is_empty() {
            let bs: Vec<String> = tp.bounds.iter().map(|b| emit_type(b, LanguageId::CSharp)).collect();
            out.push_str(&format!(" where {} : {}", tp.name, bs.join(", ")));
        }
    }
    out
}

pub(crate) fn parse_nested_tag(s: &str) -> Option<&str> {
    s.trim().trim_start_matches('@').strip_prefix("nested(").and_then(|r| r.strip_suffix(')'))
}

pub(crate) fn java_nested_parent(cd: &ClassDecl) -> Option<&str> {
    cd.decorators.iter().find_map(|d| parse_nested_tag(d))
}

pub(crate) fn has_attr(tr: &Trivia, needle: &str) -> bool {
    tr.leading.iter().any(|c| c.kind == TriviaKind::Attribute && c.text.trim_start_matches('@') == needle)
}
