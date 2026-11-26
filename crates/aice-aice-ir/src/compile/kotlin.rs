use std::collections::HashMap;

use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::compile::expr_emit::{ExprEmitCtx, emit_expr};
use crate::compile::stmt_common::emit_brace_stmts;
use crate::compile::type_map::emit_type;
use crate::ir::{AiceItem, AiceModule, TranspileError, Trivia, TriviaKind, Visibility};
use crate::ir_code::{ClassDecl, FnBody, FnDecl, MethodDecl, PropDecl};
use crate::ir_types::ParamDecl;

pub fn compile(module: &AiceModule) -> Result<String, TranspileError> {
    if module.items.is_empty() && !module.raw_fallback.is_empty() {
        return Ok(module.raw_fallback.clone());
    }
    let ectx = ExprEmitCtx::from_module(module);
    let mut ec = EmitCtx::new("    ");
    ec.emit_trivia(&module.module_trivia, CommentStyle::Slash);
    if !module.module_name.is_empty() && module.module_name != "module" && module.module_name != "kotlin" {
        ec.line(&format!("package {}", module.module_name.replace('/', ".")));
    }
    for item in &module.items {
        if let AiceItem::Import(imp) = item { ec.line(&format!("import {}", imp.source)); }
    }
    let mut nested_map: HashMap<String, Vec<&ClassDecl>> = HashMap::new();
    let mut top_names: Vec<String> = Vec::new();
    for item in &module.items {
        if let AiceItem::Class(cd) = item {
            if let Some(parent) = nested_parent(cd) {
                nested_map.entry(parent.to_string()).or_default().push(cd);
            } else {
                top_names.push(cd.name.clone());
            }
        }
    }
    for item in &module.items {
        match item {
            AiceItem::Class(cd) => {
                if let Some(parent) = nested_parent(cd) {
                    let root = parent.split('.').next().unwrap_or(parent);
                    if top_names.iter().any(|n| n == root) { continue; }
                }
                ec.blank();
                emit_kt_class(&mut ec, cd, &cd.name, &nested_map, &ectx);
            }
            AiceItem::Fn(fd) => emit_kt_fn(&mut ec, fd, &ectx),
            AiceItem::Directive { text, trivia, .. } => {
                ec.blank();
                ec.emit_trivia(trivia, CommentStyle::Slash);
                for line in text.lines() { ec.line(line); }
            }
            _ => {}
        }
    }
    Ok(ec.out)
}

fn nested_parent(cd: &ClassDecl) -> Option<&str> {
    cd.decorators.iter().find_map(|d| {
        let s = d.trim_start_matches('@');
        s.strip_prefix("nested(").and_then(|r| r.strip_suffix(')'))
    })
}

fn has_attr(tr: &Trivia, needle: &str) -> bool {
    tr.leading.iter().any(|c| c.kind == TriviaKind::Attribute && c.text.trim_start_matches('@') == needle)
}

fn companion_tag(tr: &Trivia) -> Option<Option<&str>> {
    tr.leading.iter().find_map(|c| {
        if c.kind != TriviaKind::Attribute { return None; }
        let s = c.text.trim_start_matches('@');
        if s == "companion" { Some(None) }
        else { s.strip_prefix("companion(").and_then(|r| r.strip_suffix(')')).map(Some) }
    })
}

fn emit_kt_class(ec: &mut EmitCtx, cd: &ClassDecl, path: &str, nested: &HashMap<String, Vec<&ClassDecl>>, ectx: &ExprEmitCtx) {
    ec.emit_trivia(&cd.trivia, CommentStyle::Slash);
    let has_dec = |k: &str| cd.decorators.iter().any(|d| d.trim_start_matches('@') == k);
    let mut hdr = String::new();
    hdr.push_str(kt_vis(cd.vis));
    if cd.is_abstract { hdr.push_str("abstract "); }
    for m in ["sealed", "data", "inner", "enum", "value", "annotation"] {
        if has_dec(m) { hdr.push_str(m); hdr.push(' '); }
    }
    if has_dec("object") { hdr.push_str("object "); }
    else if has_dec("interface") { hdr.push_str("interface "); }
    else { hdr.push_str("class "); }
    hdr.push_str(&cd.name);
    if !cd.primary_ctor.is_empty() {
        let ps: Vec<String> = cd.primary_ctor.iter().map(|p| {
            let v = kt_vis(p.vis);
            let kw = if p.is_mut { "var " } else { "val " };
            let t = p.ty.as_ref().map(|x| emit_type(x, LanguageId::Kotlin)).unwrap_or_else(|| "Any".into());
            let d = p.default.as_ref().map(|e| format!(" = {}", emit_kt_typed_expr(e, &t, ectx))).unwrap_or_default();
            format!("{v}{kw}{}: {t}{d}", p.name)
        }).collect();
        hdr.push_str(&format!("({})", ps.join(", ")));
    }
    let mut supers: Vec<String> = Vec::new();
    if let Some(ref ext) = cd.extends { supers.push(ext.replace("::", ".")); }
    for imp in &cd.implements { supers.push(imp.replace("::", ".")); }
    if !supers.is_empty() { hdr.push_str(&format!(" : {}", supers.join(", "))); }

    let own_props: Vec<&PropDecl> = cd.props.iter()
        .filter(|p| !has_attr(&p.trivia, "nested_type") && companion_tag(&p.trivia).is_none())
        .collect();
    let own_methods: Vec<&MethodDecl> = cd.methods.iter()
        .filter(|m| companion_tag(&m.trivia).is_none())
        .collect();
    let comp_props: Vec<&PropDecl> = cd.props.iter().filter(|p| companion_tag(&p.trivia).is_some()).collect();
    let comp_methods: Vec<&MethodDecl> = cd.methods.iter().filter(|m| companion_tag(&m.trivia).is_some()).collect();
    let kids = nested.get(path).map(Vec::as_slice).unwrap_or(&[]);

    let body_empty = own_props.is_empty() && own_methods.is_empty() && comp_props.is_empty()
        && comp_methods.is_empty() && kids.is_empty();
    if body_empty && (!cd.primary_ctor.is_empty() || has_dec("object")) {
        ec.line(&hdr);
        return;
    }
    ec.line(&format!("{hdr} {{"));
    ec.push();
    for p in own_props { emit_kt_prop(ec, p, ectx); }
    for m in own_methods { emit_kt_method(ec, m, ectx); }
    for kid in kids {
        let kid_path = format!("{path}.{}", kid.name);
        emit_kt_class(ec, kid, &kid_path, nested, ectx);
    }
    if !comp_props.is_empty() || !comp_methods.is_empty() {
        let cname = comp_props.iter().find_map(|p| companion_tag(&p.trivia).flatten())
            .or_else(|| comp_methods.iter().find_map(|m| companion_tag(&m.trivia).flatten()));
        match cname {
            Some(nm) => ec.line(&format!("companion object {nm} {{")),
            None => ec.line("companion object {"),
        }
        ec.push();
        for p in comp_props { emit_kt_prop(ec, p, ectx); }
        for m in comp_methods { emit_kt_method(ec, m, ectx); }
        ec.pop();
        ec.line("}");
    }
    ec.pop();
    ec.line("}");
}

fn emit_kt_prop(ec: &mut EmitCtx, p: &PropDecl, ectx: &ExprEmitCtx) {
    ec.emit_trivia(&p.trivia, CommentStyle::Slash);
    let cst = if has_attr(&p.trivia, "const") { "const " } else { "" };
    let kw = if p.is_mut { "var " } else { "val " };
    let t_str = p.ty.as_ref().map(|x| emit_type(x, LanguageId::Kotlin));
    let t = t_str.as_deref().map(|s| format!(": {s}")).unwrap_or_default();
    let init = p.init.as_ref().map(|e| format!(" = {}", emit_kt_typed_expr(e, t_str.as_deref().unwrap_or(""), ectx))).unwrap_or_default();
    ec.line(&format!("{}{cst}{kw}{}{t}{init}", kt_vis(p.vis), p.name));
}

fn emit_kt_typed_expr(e: &crate::ir_code::Expr, ty: &str, ectx: &ExprEmitCtx) -> String {
    if ty == "Long" && let crate::ir_code::Expr::Literal(crate::ir_expr::LiteralVal::Int(n)) = e {
        return format!("{n}L");
    }
    emit_expr(e, LanguageId::Kotlin, ectx)
}

fn emit_kt_method(ec: &mut EmitCtx, m: &MethodDecl, ectx: &ExprEmitCtx) {
    ec.emit_trivia(&m.trivia, CommentStyle::Slash);
    let ps = emit_kt_params(&m.params, ectx);
    let rt = m.return_type.as_ref().map(|t| format!(": {}", emit_type(t, LanguageId::Kotlin))).unwrap_or_default();
    ec.line(&format!("{}fun {}({ps}){rt} {{", kt_vis(m.vis), m.name));
    ec.push();
    match &m.body {
        FnBody::SignatureOnly => {}
        FnBody::Expr(e) => ec.line(&format!("return {}", emit_expr(e, LanguageId::Kotlin, ectx))),
        FnBody::Block(stmts) => emit_brace_stmts(stmts, LanguageId::Kotlin, ec, ectx, false),
    }
    ec.pop();
    ec.line("}");
}

fn emit_kt_fn(ec: &mut EmitCtx, f: &FnDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&f.trivia, CommentStyle::Slash);
    let ps = emit_kt_params(&f.params, ectx);
    let rt = f.return_type.as_ref().map(|t| format!(": {}", emit_type(t, LanguageId::Kotlin))).unwrap_or_default();
    ec.line(&format!("{}fun {}({ps}){rt} {{", kt_vis(f.vis), f.name));
    ec.push();
    match &f.body {
        FnBody::SignatureOnly => {}
        FnBody::Expr(e) => ec.line(&format!("return {}", emit_expr(e, LanguageId::Kotlin, ectx))),
        FnBody::Block(stmts) => emit_brace_stmts(stmts, LanguageId::Kotlin, ec, ectx, false),
    }
    ec.pop();
    ec.line("}");
}

fn emit_kt_params(params: &[ParamDecl], ectx: &ExprEmitCtx) -> String {
    params.iter().map(|p| {
        let t = p.ty.as_ref().map(|x| emit_type(x, LanguageId::Kotlin)).unwrap_or_else(|| "Any".into());
        let d = p.default.as_ref().map(|e| format!(" = {}", emit_expr(e, LanguageId::Kotlin, ectx))).unwrap_or_default();
        format!("{}: {t}{d}", p.name)
    }).collect::<Vec<_>>().join(", ")
}

fn kt_vis(v: Visibility) -> &'static str {
    match v {
        Visibility::Private => "private ", Visibility::Protected => "protected ",
        Visibility::Package => "internal ", _ => "",
    }
}
