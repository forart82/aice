use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::compile::expr_emit::{ExprEmitCtx, emit_expr};
use crate::compile::stmt_common::emit_brace_stmts;
use crate::compile::type_map::emit_type;
use crate::ir::{AiceItem, AiceModule, TranspileError, Visibility};
use crate::ir_code::{ClassDecl, FnBody, FnDecl, MethodDecl};
use crate::ir_types::ParamDecl;

pub fn compile(module: &AiceModule) -> Result<String, TranspileError> {
    if module.items.is_empty() && !module.raw_fallback.is_empty() {
        return Ok(module.raw_fallback.clone());
    }
    let ectx = ExprEmitCtx::from_module(module);
    let mut ec = EmitCtx::new("    ");
    ec.line("<?php");
    ec.blank();
    ec.emit_trivia(&module.module_trivia, CommentStyle::Slash);
    let mut emitted_declare = false;
    for item in &module.items {
        if let AiceItem::Directive { text, trivia, .. } = item && is_php_declare_directive(text) {
            ec.emit_trivia(trivia, CommentStyle::Slash);
            for line in text.lines() { ec.line(line); }
            emitted_declare = true;
        }
    }
    if emitted_declare {
        ec.blank();
    }
    if !module.module_name.is_empty() && module.module_name != "module" && module.module_name != "php" {
        ec.line(&format!("namespace {};", module.module_name.replace('/', "\\")));
        ec.blank();
    }

    for item in &module.items {
        match item {
            AiceItem::Directive { text, .. } if is_php_declare_directive(text) => {}
            AiceItem::Directive { text, trivia, .. } => {
                ec.emit_trivia(trivia, CommentStyle::Slash);
                for line in text.lines() { ec.line(line); }
            }
            AiceItem::Import(imp) => ec.line(&format!("use {};", imp.source)),
            AiceItem::Class(cd) => emit_php_class(&mut ec, cd, &ectx),
            AiceItem::Fn(fd) => emit_php_fn(&mut ec, fd, &ectx),
            _ => {}
        }
    }
    Ok(ec.out)
}

fn is_php_declare_directive(text: &str) -> bool {
    let t = text.trim_start();
    t.strip_prefix("declare").is_some_and(|rest| rest.trim_start().starts_with('('))
}

fn emit_php_class(ec: &mut EmitCtx, cd: &ClassDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&cd.trivia, CommentStyle::Slash);
    for dec in &cd.decorators {
        if dec.starts_with("#[") { ec.line(dec); }
    }
    let is_trait = cd.decorators.iter().any(|d| d.trim_start_matches('@') == "trait");
    let is_interface = cd.decorators.iter().any(|d| d.trim_start_matches('@') == "interface");
    if is_trait {
        ec.line(&format!("trait {} {{", cd.name));
    } else if is_interface {
        let mut parents: Vec<&str> = Vec::new();
        if let Some(ref e) = cd.extends { parents.push(e.as_str()); }
        for i in &cd.implements { parents.push(i.as_str()); }
        let ext = if parents.is_empty() { String::new() } else { format!(" extends {}", parents.join(", ")) };
        ec.line(&format!("interface {}{ext} {{", cd.name));
    } else {
        let abs = if cd.is_abstract { "abstract " } else { "" };
        let ext = cd.extends.as_ref().map(|e| format!(" extends {e}")).unwrap_or_default();
        let imp = if cd.implements.is_empty() { String::new() } else { format!(" implements {}", cd.implements.join(", ")) };
        ec.line(&format!("{abs}class {}{ext}{imp} {{", cd.name));
    }
    ec.push();
    for dec in &cd.decorators {
        if let Some(traits) = dec.trim_start_matches('@').strip_prefix("use(").and_then(|s| s.strip_suffix(')')) {
            if traits.contains('{') {
                ec.line(&format!("use {traits}"));
            } else {
                ec.line(&format!("use {traits};"));
            }
        }
    }
    for p in &cd.props {
        ec.emit_trivia(&p.trivia, CommentStyle::Slash);
        ec.emit_attrs(&p.trivia);
        let st = if p.is_static { "static " } else { "" };
        let t = p.ty.as_ref().map(|x| format!("{} ", emit_type(x, LanguageId::Php))).unwrap_or_default();
        ec.line(&format!("{}{st}{t}${};", php_vis(p.vis), p.name));
    }
    let allow_abs = cd.is_abstract || is_trait;
    for m in &cd.methods { emit_php_method(ec, m, is_interface, allow_abs, ectx); }
    ec.pop();
    ec.line("}");
}

fn emit_php_method(ec: &mut EmitCtx, m: &MethodDecl, is_interface: bool, allow_abs: bool, ectx: &ExprEmitCtx) {
    ec.emit_trivia(&m.trivia, CommentStyle::Slash);
    ec.emit_attrs(&m.trivia);
    let ps = emit_php_params(&m.params, ectx);
    let rt = m.return_type.as_ref().map(|t| format!(": {}", emit_type(t, LanguageId::Php))).unwrap_or_default();
    let st = if m.is_static { "static " } else { "" };
    if matches!(m.body, FnBody::SignatureOnly) && (is_interface || allow_abs) {
        let abs = if is_interface { "" } else { "abstract " };
        ec.line(&format!("{abs}{}{st}function {}({ps}){rt};", php_vis(m.vis), m.name));
        return;
    }
    ec.line(&format!("{}{st}function {}({ps}){rt} {{", php_vis(m.vis), m.name));
    ec.push();
    match &m.body {
        FnBody::SignatureOnly => {}
        FnBody::Expr(e) => ec.line(&format!("return {};", emit_expr(e, LanguageId::Php, ectx))),
        FnBody::Block(stmts) => emit_brace_stmts(stmts, LanguageId::Php, ec, ectx, false),
    }
    ec.pop();
    ec.line("}");
}

fn emit_php_fn(ec: &mut EmitCtx, f: &FnDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&f.trivia, CommentStyle::Slash);
    for dec in &f.decorators {
        if dec.starts_with("#[") { ec.line(dec); }
    }
    let ps = emit_php_params(&f.params, ectx);
    let rt = f.return_type.as_ref().map(|t| format!(": {}", emit_type(t, LanguageId::Php))).unwrap_or_default();
    ec.line(&format!("function {}({ps}){rt} {{", f.name));
    ec.push();
    match &f.body {
        FnBody::SignatureOnly => {}
        FnBody::Expr(e) => ec.line(&format!("return {};", emit_expr(e, LanguageId::Php, ectx))),
        FnBody::Block(stmts) => emit_brace_stmts(stmts, LanguageId::Php, ec, ectx, false),
    }
    ec.pop();
    ec.line("}");
}

fn emit_php_params(params: &[ParamDecl], ectx: &ExprEmitCtx) -> String {
    params.iter().map(|p| {
        let nm = if p.name.starts_with('$') { p.name.clone() } else { format!("${}", p.name) };
        let mut s = match &p.ty {
            Some(t) => format!("{} {nm}", emit_type(t, LanguageId::Php)),
            None => nm,
        };
        if let Some(ref def) = p.default {
            s.push_str(&format!(" = {}", emit_expr(def, LanguageId::Php, ectx)));
        }
        s
    }).collect::<Vec<_>>().join(", ")
}

fn php_vis(v: Visibility) -> &'static str {
    match v {
        Visibility::Public => "public ", Visibility::Private => "private ",
        Visibility::Protected => "protected ", _ => "public ",
    }
}
