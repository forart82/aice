use aice_lang_registry::LanguageId;

use crate::compile::csharp;
use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::compile::java_lang;
use crate::compile::type_map::emit_type;
use crate::ir::{AiceModule, TranspileError, Trivia, TriviaKind, Visibility};
use crate::ir_code::ClassDecl;
use crate::ir_types::{EnumDecl, ParamDecl, TypeParam};

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

pub(crate) fn emit_java_iface_ext(extends: &[String]) -> String {
    if extends.is_empty() {
        String::new()
    } else {
        let items: Vec<String> = extends.iter().map(|s| s.replace("::", ".")).collect();
        format!(" extends {}", items.join(", "))
    }
}

pub(crate) fn emit_java_class_hdr(cd: &ClassDecl, vis: &str, tps: &str, ctor: Option<&str>) -> String {
    let has_dec = |k: &str| cd.decorators.iter().any(|d| d.trim_start_matches('@') == k);
    let st = if has_dec("static") { "static " } else { "" };
    let imp = if cd.implements.is_empty() {
        String::new()
    } else {
        let items: Vec<String> = cd.implements.iter().map(|s| s.replace("::", ".")).collect();
        format!(" implements {}", items.join(", "))
    };
    if let Some(c) = ctor {
        format!("{vis}{st}record {}{tps}({c}){imp} {{", cd.name)
    } else {
        let abs = if cd.is_abstract { "abstract " } else { "" };
        let ext = cd.extends.as_ref().map(|e| format!(" extends {}", e.replace("::", "."))).unwrap_or_default();
        format!("{vis}{st}{abs}class {}{tps}{ext}{imp} {{", cd.name)
    }
}

pub(crate) fn emit_cs_bases(extends: Option<&str>, implements: &[String]) -> String {
    let mut bases = Vec::new();
    if let Some(e) = extends { bases.push(e.replace("::", ".")); }
    for imp in implements { bases.push(imp.replace("::", ".")); }
    if bases.is_empty() { String::new() } else { format!(" : {}", bases.join(", ")) }
}

pub(crate) fn j_vis(v: Visibility) -> &'static str {
    match v {
        Visibility::Public => "public ", Visibility::Private => "private ",
        Visibility::Protected => "protected ", _ => "",
    }
}

pub(crate) fn java_synth_class_name(mod_name: &str) -> String {
    let seg = mod_name.rsplit(['/', '.']).next().unwrap_or("").trim();
    if seg.is_empty() || seg == "module" || seg == "java" || !seg.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
        return "Module".into();
    }
    let mut chars = seg.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() => format!("{}{}", c.to_ascii_uppercase(), chars.as_str()),
        _ => "Module".into(),
    }
}

pub(crate) fn emit_java_decs(ec: &mut EmitCtx, decs: &[String]) {
    for d in decs {
        let s = d.trim().trim_start_matches('@');
        if !s.is_empty() && !matches!(s, "static" | "record" | "enum" | "variant_body") && parse_nested_tag(s).is_none() {
            ec.line(&format!("@{s}"));
        }
    }
}

pub(crate) fn emit_java_attrs(ec: &mut EmitCtx, tr: &Trivia) {
    for c in &tr.leading {
        if c.kind != TriviaKind::Attribute { continue; }
        let s = c.text.trim().trim_start_matches('@');
        if !s.is_empty() && !matches!(s, "abstract" | "variant") && parse_nested_tag(s).is_none() {
            ec.line(&format!("@{s}"));
        }
    }
}

pub(crate) fn emit_java_enum(ec: &mut EmitCtx, ed: &EnumDecl) {
    ec.blank();
    ec.emit_trivia(&ed.trivia, CommentStyle::Slash);
    emit_java_attrs(ec, &ed.trivia);
    ec.line(&format!("{}enum {} {{", j_vis(ed.vis), ed.name));
    ec.push();
    for v in &ed.variants { ec.line(&format!("{},", v.name)); }
    ec.pop();
    ec.line("}");
}

pub(crate) fn java_has_dec(cd: &ClassDecl, k: &str) -> bool {
    cd.decorators.iter().any(|d| d.trim_start_matches('@') == k)
}

pub(crate) fn emit_j_params(params: &[ParamDecl]) -> String {
    params.iter().map(|p| {
        let t = p.ty.as_ref().map(|x| emit_type(x, LanguageId::Java)).unwrap_or_else(|| "Object".into());
        format!("{t} {}", p.name)
    }).collect::<Vec<_>>().join(", ")
}
