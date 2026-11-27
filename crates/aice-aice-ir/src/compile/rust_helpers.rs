use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::EmitCtx;
use crate::compile::type_map::emit_type;
use crate::ir::{Trivia, TriviaKind};
use crate::ir_code::PropDecl;
use crate::ir_types::{AiceType, FieldDecl, TypeParam};

fn parse_quoted_attr(text: &str, prefix: &str) -> Option<String> {
    let s = text.trim().trim_start_matches('@');
    let inner = s.strip_prefix(prefix)?.strip_prefix('(')?.strip_suffix(')')?.trim();
    if let Some(unq) = inner.strip_prefix('"').and_then(|r| r.strip_suffix('"')) {
        Some(unq.replace("\\\"", "\"").replace("\\\\", "\\"))
    } else {
        Some(inner.to_string())
    }
}

pub(crate) fn rs_attr_arg(tr: &Trivia, decs: &[String], prefix: &str) -> Option<String> {
    tr.leading
        .iter()
        .find_map(|c| (c.kind == TriviaKind::Attribute).then(|| parse_quoted_attr(&c.text, prefix)).flatten())
        .or_else(|| decs.iter().find_map(|d| parse_quoted_attr(d, prefix)))
}

fn is_rs_const_prim(s: &str) -> bool {
    matches!(
        s,
        "usize" | "isize" | "u8" | "u16" | "u32" | "u64" | "u128"
            | "i8" | "i16" | "i32" | "i64" | "i128" | "bool" | "char"
    )
}

pub(crate) fn format_rs_generics(tps: &[TypeParam], tr: &Trivia, decs: &[String]) -> (String, String) {
    let mut parts = Vec::new();
    if let Some(lts) = rs_attr_arg(tr, decs, "lifetimes") {
        for lt in lts.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            parts.push(lt.to_string());
        }
    }
    for tp in tps {
        let bs: Vec<String> = tp.bounds.iter().map(|b| emit_type(b, LanguageId::Rust)).collect();
        let def = tp.default.as_ref().map(|d| format!(" = {}", emit_type(d, LanguageId::Rust))).unwrap_or_default();
        if bs.len() == 1 && is_rs_const_prim(&bs[0]) {
            parts.push(format!("const {}: {}{def}", tp.name, bs[0]));
        } else if bs.is_empty() {
            parts.push(format!("{}{def}", tp.name));
        } else {
            parts.push(format!("{}: {}{def}", tp.name, bs.join(" + ")));
        }
    }
    let gp = if parts.is_empty() { String::new() } else { format!("<{}>", parts.join(", ")) };
    let wh = rs_attr_arg(tr, decs, "where")
        .filter(|w| !w.is_empty())
        .map(|w| format!(" where {w}"))
        .unwrap_or_default();
    (gp, wh)
}

pub(crate) fn format_rs_type_args(tps: &[TypeParam], tr: &Trivia, decs: &[String]) -> String {
    let mut parts = Vec::new();
    if let Some(lts) = rs_attr_arg(tr, decs, "lifetimes") {
        for lt in lts.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            let name = lt.split(':').next().unwrap_or(lt).trim();
            if !name.is_empty() {
                parts.push(name.to_string());
            }
        }
    }
    for tp in tps {
        parts.push(tp.name.clone());
    }
    if parts.is_empty() { String::new() } else { format!("<{}>", parts.join(", ")) }
}

pub(crate) fn is_rs_assoc_attr(tr: &Trivia) -> bool {
    tr.leading.iter().any(|c| {
        c.kind == TriviaKind::Attribute && {
            let t = c.text.trim().trim_start_matches('@');
            t == "assoc_type" || t.starts_with("assoc_raw(")
        }
    })
}

pub(crate) fn emit_rs_trait_assoc(ec: &mut EmitCtx, f: &FieldDecl) {
    if let Some(raw) = rs_attr_arg(&f.trivia, &[], "assoc_raw") {
        ec.line(&raw);
    } else if let Some(ref ty) = f.ty {
        ec.line(&format!("type {}: {};", f.name, emit_type(ty, LanguageId::Rust)));
    } else {
        ec.line(&format!("type {};", f.name));
    }
}

pub(crate) fn emit_rs_impl_assoc(ec: &mut EmitCtx, p: &PropDecl) {
    if let Some(raw) = rs_attr_arg(&p.trivia, &[], "assoc_raw") {
        ec.line(&raw);
    } else if let Some(ref ty) = p.ty {
        ec.line(&format!("type {} = {};", p.name, emit_type(ty, LanguageId::Rust)));
    }
}

pub(crate) fn emit_rs_all_hash_attrs(ec: &mut EmitCtx, tr: &Trivia, decs: &[String]) {
    let mut seen = Vec::new();
    for c in &tr.leading {
        if c.kind == TriviaKind::Attribute && c.text.starts_with("#[") {
            seen.push(c.text.as_str());
            ec.line(&c.text);
        }
    }
    for d in decs {
        if d.starts_with("#[") && !seen.contains(&d.as_str()) {
            ec.line(d);
        }
    }
}

pub(crate) fn format_rs_tuple_field_ty(ty: Option<&AiceType>) -> String {
    ty.map(|x| emit_type(x, LanguageId::Rust)).unwrap_or_else(|| "()".into())
}

pub(crate) fn has_rs_attr(tr: &Trivia, decs: &[String], name: &str) -> bool {
    tr.leading.iter().any(|c| {
        c.kind == TriviaKind::Attribute && c.text.trim().trim_start_matches('@') == name
    }) || decs.iter().any(|d| d.trim().trim_start_matches('@') == name)
}

pub(crate) fn format_rs_fn_quals(tr: &Trivia, decs: &[String], is_async: bool) -> String {
    let mut s = String::new();
    if has_rs_attr(tr, decs, "const") { s.push_str("const "); }
    if is_async { s.push_str("async "); }
    if has_rs_attr(tr, decs, "unsafe") { s.push_str("unsafe "); }
    if let Some(abi) = rs_attr_arg(tr, decs, "extern") {
        if abi.is_empty() { s.push_str("extern "); }
        else { s.push_str(&format!("extern \"{abi}\" ")); }
    } else if has_rs_attr(tr, decs, "extern") {
        s.push_str("extern ");
    }
    s
}

fn starts_with_rs_kw(s: &str, kw: &str) -> bool {
    s.strip_prefix(kw).is_some_and(|r| {
        r.is_empty() || !matches!(r.as_bytes()[0], b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_')
    })
}

fn is_rs_macro_item(text: &str) -> bool {
    let t = text.trim_start();
    if t.starts_with("macro_rules!") { return true; }
    let rest = t.trim_start_matches(|c: char| c.is_ascii_alphanumeric() || c == '_' || c == ':');
    rest.len() < t.len() && rest.strip_prefix('!').is_some_and(|r| matches!(r.trim_start().as_bytes().first(), Some(b'(' | b'[' | b'{')))
}

pub(crate) fn is_rs_raw_directive(text: &str) -> bool {
    let t = text.trim_start();
    if t.starts_with("#[") || t.starts_with("#![") || is_rs_macro_item(t) {
        return true;
    }
    let mut rest = t;
    if let Some(after_pub) = rest.strip_prefix("pub") {
        if let Some(after_ws) = after_pub.strip_prefix(char::is_whitespace) {
            rest = after_ws.trim_start();
        } else if let Some(after_lp) = after_pub.strip_prefix('(')
            && let Some(rp) = after_lp.find(')')
        {
            rest = after_lp[rp + 1..].trim_start();
        }
    }
    if let Some(after_unsafe) = rest.strip_prefix("unsafe")
        && after_unsafe.starts_with(char::is_whitespace)
    {
        rest = after_unsafe.trim_start();
    }
    starts_with_rs_kw(rest, "mod")
        || starts_with_rs_kw(rest, "extern")
        || starts_with_rs_kw(rest, "union")
        || starts_with_rs_kw(rest, "macro")
        || is_rs_macro_item(rest)
}
