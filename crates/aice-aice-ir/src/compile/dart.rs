use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::compile::expr_emit::{ExprEmitCtx, emit_expr};
use crate::compile::stmt_common::emit_brace_stmts;
use crate::compile::type_map::emit_type;
use crate::ir::{AiceItem, AiceModule, TranspileError};
use crate::ir_code::{AccessorKind, ClassDecl, FnBody, FnDecl, MethodDecl};
use crate::ir_types::ParamDecl;

pub fn compile(module: &AiceModule) -> Result<String, TranspileError> {
    if module.items.is_empty() && !module.raw_fallback.is_empty() {
        return Ok(module.raw_fallback.clone());
    }
    let ectx = ExprEmitCtx::from_module(module);
    let mut ec = EmitCtx::new("  ");
    ec.emit_trivia(&module.module_trivia, CommentStyle::Slash);

    for item in &module.items {
        match item {
            AiceItem::Import(imp) => ec.line(&format!("import '{}';", imp.source)),
            AiceItem::Class(cd) => emit_dart_class(&mut ec, cd, &ectx),
            AiceItem::Fn(fd) => emit_dart_fn(&mut ec, fd, &ectx),
            _ => {}
        }
    }
    Ok(ec.out)
}

fn emit_dart_class(ec: &mut EmitCtx, cd: &ClassDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&cd.trivia, CommentStyle::Slash);
    ec.line(&format!("class {} {{", cd.name));
    ec.push();
    for p in &cd.props {
        let fin = if p.is_readonly { "final " } else { "" };
        let t = p.ty.as_ref().map(|x| emit_type(x, LanguageId::Dart)).unwrap_or_else(|| "dynamic".into());
        ec.line(&format!("{fin}{t} {};", p.name));
    }
    for m in &cd.methods { emit_dart_method(ec, m, &cd.name, &cd.props, ectx); }
    ec.pop();
    ec.line("}");
}

fn emit_dart_method(ec: &mut EmitCtx, m: &MethodDecl, cls_name: &str, props: &[crate::ir_code::PropDecl], ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&m.trivia, CommentStyle::Slash);
    let is_ctor = m.accessor == AccessorKind::Constructor;
    let ps = emit_dart_params(&m.params, is_ctor, props, ectx);
    if is_ctor {
        let cst = if m.is_const { "const " } else { "" };
        if matches!(m.body, FnBody::SignatureOnly) {
            ec.line(&format!("{cst}{cls_name}({ps});"));
            return;
        }
        ec.line(&format!("{cst}{cls_name}({ps}) {{"));
    } else {
        let rt = m.return_type.as_ref().map(|t| emit_type(t, LanguageId::Dart)).unwrap_or_else(|| "void".into());
        ec.line(&format!("{rt} {}({ps}) {{", m.name));
    }
    ec.push();
    match &m.body {
        FnBody::SignatureOnly => {}
        FnBody::Expr(e) => ec.line(&format!("return {};", emit_expr(e, LanguageId::Dart, ectx))),
        FnBody::Block(stmts) => emit_brace_stmts(stmts, LanguageId::Dart, ec, ectx, false),
    }
    ec.pop();
    ec.line("}");
}

fn emit_dart_fn(ec: &mut EmitCtx, f: &FnDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&f.trivia, CommentStyle::Slash);
    let rt = f.return_type.as_ref().map(|t| emit_type(t, LanguageId::Dart)).unwrap_or_else(|| "void".into());
    let ps = emit_dart_params(&f.params, false, &[], ectx);
    ec.line(&format!("{rt} {}({ps}) {{", f.name));
    ec.push();
    match &f.body {
        FnBody::SignatureOnly => {}
        FnBody::Expr(e) => ec.line(&format!("return {};", emit_expr(e, LanguageId::Dart, ectx))),
        FnBody::Block(stmts) => emit_brace_stmts(stmts, LanguageId::Dart, ec, ectx, false),
    }
    ec.pop();
    ec.line("}");
}

fn emit_dart_params(params: &[ParamDecl], is_ctor: bool, props: &[crate::ir_code::PropDecl], ectx: &ExprEmitCtx) -> String {
    let mut req_pos = Vec::new();
    let mut opt_pos = Vec::new();
    let mut named = Vec::new();
    for p in params {
        let base = if is_ctor && p.ty.is_none() && (p.is_readonly || props.iter().any(|pr| pr.name == p.name)) {
            format!("this.{}", p.name)
        } else if p.name.starts_with("this.") {
            p.name.clone()
        } else if let Some(ref ty) = p.ty {
            format!("{} {}", emit_type(ty, LanguageId::Dart), p.name)
        } else {
            p.name.clone()
        };
        let def = p.default.as_ref().map(|d| format!(" = {}", emit_expr(d, LanguageId::Dart, ectx))).unwrap_or_default();
        if p.is_optional {
            let req = if p.default.is_none() && !matches!(p.ty, Some(crate::ir_types::AiceType::Option(_))) {
                "required "
            } else { "" };
            named.push(format!("{req}{base}{def}"));
        } else if !def.is_empty() {
            opt_pos.push(format!("{base}{def}"));
        } else {
            req_pos.push(base);
        }
    }
    if !opt_pos.is_empty() { req_pos.push(format!("[{}]", opt_pos.join(", "))); }
    if !named.is_empty() { req_pos.push(format!("{{{}}}", named.join(", "))); }
    req_pos.join(", ")
}
