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
    ec.emit_trivia(&module.module_trivia, CommentStyle::Slash);
    if !module.module_name.is_empty() && module.module_name != "module" && module.module_name != "kotlin" {
        ec.line(&format!("package {}", module.module_name.replace('/', ".")));
    }
    for item in &module.items {
        if let AiceItem::Import(imp) = item { ec.line(&format!("import {}", imp.source)); }
    }
    for item in &module.items {
        match item {
            AiceItem::Class(cd) => emit_kt_class(&mut ec, cd, &ectx),
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

fn emit_kt_class(ec: &mut EmitCtx, cd: &ClassDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&cd.trivia, CommentStyle::Slash);
    let data = if cd.decorators.iter().any(|d| d == "data") { "data " } else { "" };
    let ctor = if cd.primary_ctor.is_empty() {
        String::new()
    } else {
        let ps: Vec<String> = cd.primary_ctor.iter().map(|p| {
            let v = kt_vis(p.vis);
            let kw = if p.is_readonly { "val " } else { "var " };
            let t = p.ty.as_ref().map(|x| emit_type(x, LanguageId::Kotlin)).unwrap_or_else(|| "Any".into());
            let d = p.default.as_ref().map(|e| format!(" = {}", emit_expr(e, LanguageId::Kotlin, ectx))).unwrap_or_default();
            format!("{v}{kw}{}: {t}{d}", p.name)
        }).collect();
        format!("({})", ps.join(", "))
    };
    if cd.methods.is_empty() && !ctor.is_empty() {
        ec.line(&format!("{data}class {}{ctor}", cd.name));
        return;
    }
    ec.line(&format!("{data}class {}{ctor} {{", cd.name));
    ec.push();
    for m in &cd.methods { emit_kt_method(ec, m, ectx); }
    ec.pop();
    ec.line("}");
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
