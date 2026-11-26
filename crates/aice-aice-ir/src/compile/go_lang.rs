use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::compile::expr_emit::{ExprEmitCtx, emit_expr};
use crate::compile::stmt_common::emit_brace_stmts;
use crate::compile::type_map::emit_type;
use crate::ir::{AiceItem, AiceModule, TranspileError, Visibility};
use crate::ir_code::{ClassDecl, FnBody, FnDecl};
use crate::ir_types::{ParamDecl, TypeDecl, TypeKind};

pub fn compile(module: &AiceModule) -> Result<String, TranspileError> {
    if module.items.is_empty() && !module.raw_fallback.is_empty() {
        return Ok(module.raw_fallback.clone());
    }
    let ectx = ExprEmitCtx::from_module(module);
    let mut ec = EmitCtx::new("\t");
    ec.emit_trivia(&module.module_trivia, CommentStyle::Slash);
    let pkg = if module.module_name.is_empty() || module.module_name == "module" {
        "main"
    } else {
        module.module_name.as_str()
    };
    ec.line(&format!("package {pkg}"));

    let imports: Vec<&str> = module.items.iter().filter_map(|it| match it {
        AiceItem::Import(imp) => Some(imp.source.as_str()),
        _ => None,
    }).collect();
    if imports.len() == 1 {
        ec.blank();
        ec.line(&format!("import \"{}\"", imports[0]));
    } else if imports.len() > 1 {
        ec.blank();
        ec.line("import (");
        ec.push();
        for imp in imports { ec.line(&format!("\"{imp}\"")); }
        ec.pop();
        ec.line(")");
    }

    for item in &module.items {
        match item {
            AiceItem::Type(td) => emit_go_type(&mut ec, td),
            AiceItem::Class(cd) => emit_go_struct(&mut ec, cd, &ectx),
            AiceItem::Fn(fd) => emit_go_fn(&mut ec, fd, &ectx),
            AiceItem::Const(cd) => ec.line(&format!("const {} = {}", cd.name, emit_expr(&cd.value, LanguageId::Go, &ectx))),
            _ => {}
        }
    }
    Ok(ec.out)
}

fn emit_go_type(ec: &mut EmitCtx, td: &TypeDecl) {
    ec.blank();
    ec.emit_trivia(&td.trivia, CommentStyle::Slash);
    if td.kind == TypeKind::Interface {
        ec.line(&format!("type {} interface {{", td.name));
        ec.push();
        for m in &td.methods {
            let ps = emit_go_params(&m.params);
            let rt = m.return_type.as_ref().map(|t| emit_type(t, LanguageId::Go)).filter(|s| !s.is_empty()).map(|s| format!(" {s}")).unwrap_or_default();
            ec.line(&format!("{}({ps}){rt}", m.name));
        }
        ec.pop();
        ec.line("}");
        return;
    }
    ec.line(&format!("type {} struct {{", td.name));
    ec.push();
    for f in &td.fields {
        let t = f.ty.as_ref().map(|x| emit_type(x, LanguageId::Go)).unwrap_or_else(|| "any".into());
        ec.line(&format!("{} {t}", f.name));
    }
    ec.pop();
    ec.line("}");
}

fn emit_go_struct(ec: &mut EmitCtx, cd: &ClassDecl, ectx: &ExprEmitCtx) {
    if !cd.props.is_empty() || cd.vis != Visibility::Default {
        ec.blank();
        ec.emit_trivia(&cd.trivia, CommentStyle::Slash);
        if cd.props.is_empty() {
            ec.line(&format!("type {} struct {{}}", cd.name));
        } else {
            ec.line(&format!("type {} struct {{", cd.name));
            ec.push();
            for p in &cd.props {
                let t = p.ty.as_ref().map(|x| emit_type(x, LanguageId::Go)).unwrap_or_else(|| "any".into());
                ec.line(&format!("{} {t}", p.name));
            }
            ec.pop();
            ec.line("}");
        }
    }
    for m in &cd.methods {
        ec.blank();
        ec.emit_trivia(&m.trivia, CommentStyle::Slash);
        let ps = emit_go_params(&m.params);
        let rt = m.return_type.as_ref().map(|t| emit_type(t, LanguageId::Go)).filter(|s| !s.is_empty()).map(|s| format!(" {s}")).unwrap_or_default();
        ec.line(&format!("func (r *{}) {}({ps}){rt} {{", cd.name, m.name));
        ec.push();
        emit_go_body(ec, &m.body, ectx);
        ec.pop();
        ec.line("}");
    }
}

fn emit_go_fn(ec: &mut EmitCtx, f: &FnDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&f.trivia, CommentStyle::Slash);
    let ps = emit_go_params(&f.params);
    let rt = f.return_type.as_ref().map(|t| emit_type(t, LanguageId::Go)).filter(|s| !s.is_empty()).map(|s| format!(" {s}")).unwrap_or_default();
    ec.line(&format!("func {}({ps}){rt} {{", f.name));
    ec.push();
    emit_go_body(ec, &f.body, ectx);
    ec.pop();
    ec.line("}");
}

fn emit_go_body(ec: &mut EmitCtx, body: &FnBody, ectx: &ExprEmitCtx) {
    match body {
        FnBody::SignatureOnly => {}
        FnBody::Expr(e) => ec.line(&format!("return {}", emit_expr(e, LanguageId::Go, ectx))),
        FnBody::Block(stmts) => emit_brace_stmts(stmts, LanguageId::Go, ec, ectx, false),
    }
}

fn emit_go_params(params: &[ParamDecl]) -> String {
    params.iter().map(|p| {
        let t = p.ty.as_ref().map(|x| emit_type(x, LanguageId::Go)).unwrap_or_else(|| "any".into());
        format!("{} {t}", p.name)
    }).collect::<Vec<_>>().join(", ")
}
