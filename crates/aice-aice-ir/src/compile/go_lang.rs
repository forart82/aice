use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::compile::expr_emit::{ExprEmitCtx, emit_expr};
use crate::compile::stmt_common::emit_brace_stmts;
use crate::compile::type_map::emit_type;
use crate::ir::{AiceItem, AiceModule, TranspileError, Trivia, TriviaKind, Visibility};
use crate::ir_code::{ClassDecl, Expr, FnBody, FnDecl, RecordEntry};
use crate::ir_types::{ParamDecl, TypeDecl, TypeKind, TypeParam};

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
            AiceItem::Const(cd) => {
                ec.emit_trivia(&cd.trivia, CommentStyle::Slash);
                let ty = cd.ty.as_ref().map(|t| format!(" {}", emit_type(t, LanguageId::Go))).unwrap_or_default();
                ec.line(&format!("const {}{ty} = {}", cd.name, emit_expr(&cd.value, LanguageId::Go, &ectx)));
            }
            AiceItem::Var(vd) => {
                ec.emit_trivia(&vd.trivia, CommentStyle::Slash);
                let ty = vd.ty.as_ref().map(|t| format!(" {}", emit_type(t, LanguageId::Go))).unwrap_or_default();
                match &vd.value {
                    Some(v) => ec.line(&format!("var {}{ty} = {}", vd.name, emit_expr(v, LanguageId::Go, &ectx))),
                    None => ec.line(&format!("var {}{}", vd.name, if ty.is_empty() { " any".into() } else { ty })),
                }
            }
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

fn emit_go_type(ec: &mut EmitCtx, td: &TypeDecl) {
    ec.blank();
    ec.emit_trivia(&td.trivia, CommentStyle::Slash);
    let tps = emit_go_type_params(&td.type_params);
    if td.kind == TypeKind::Interface {
        ec.line(&format!("type {}{tps} interface {{", td.name));
        ec.push();
        for f in &td.fields {
            if f.name.is_empty() {
                if let Some(ref ty) = f.ty { ec.line(&emit_type(ty, LanguageId::Go)); }
            } else if f.ty.is_none() {
                ec.line(&f.name);
            }
        }
        for m in &td.methods {
            let ps = emit_go_params(&m.params);
            let rt = m.return_type.as_ref().map(|t| emit_type(t, LanguageId::Go)).filter(|s| !s.is_empty()).map(|s| format!(" {s}")).unwrap_or_default();
            ec.line(&format!("{}({ps}){rt}", m.name));
        }
        ec.pop();
        ec.line("}");
        return;
    }
    ec.line(&format!("type {}{tps} struct {{", td.name));
    ec.push();
    for f in &td.fields {
        let t = f.ty.as_ref().map(|x| emit_type(x, LanguageId::Go)).unwrap_or_else(|| "any".into());
        let tag = extract_go_tag(&f.trivia).map(|tg| format!(" {tg}")).unwrap_or_default();
        ec.line(&format!("{} {t}{tag}", f.name));
    }
    ec.pop();
    ec.line("}");
}

fn emit_go_struct(ec: &mut EmitCtx, cd: &ClassDecl, ectx: &ExprEmitCtx) {
    let tps = emit_go_type_params(&cd.type_params);
    if !cd.props.is_empty() || cd.vis != Visibility::Default {
        ec.blank();
        ec.emit_trivia(&cd.trivia, CommentStyle::Slash);
        if cd.props.is_empty() {
            ec.line(&format!("type {}{tps} struct {{}}", cd.name));
        } else {
            ec.line(&format!("type {}{tps} struct {{", cd.name));
            ec.push();
            for p in &cd.props {
                let t = p.ty.as_ref().map(|x| emit_type(x, LanguageId::Go)).unwrap_or_else(|| "any".into());
                let tag = extract_go_tag(&p.trivia).map(|tg| format!(" {tg}")).unwrap_or_default();
                ec.line(&format!("{} {t}{tag}", p.name));
            }
            ec.pop();
            ec.line("}");
        }
    }
    let recv_args = if cd.type_params.is_empty() {
        String::new()
    } else {
        let ns: Vec<&str> = cd.type_params.iter().map(|tp| tp.name.as_str()).collect();
        format!("[{}]", ns.join(", "))
    };
    for m in &cd.methods {
        ec.blank();
        ec.emit_trivia(&m.trivia, CommentStyle::Slash);
        let ps = emit_go_params(&m.params);
        let rt = m.return_type.as_ref().map(|t| emit_type(t, LanguageId::Go)).filter(|s| !s.is_empty()).map(|s| format!(" {s}")).unwrap_or_default();
        ec.line(&format!("func (r *{}{recv_args}) {}({ps}){rt} {{", cd.name, m.name));
        ec.push();
        emit_go_body(ec, &m.body, ectx);
        ec.pop();
        ec.line("}");
    }
}

fn emit_go_fn(ec: &mut EmitCtx, f: &FnDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&f.trivia, CommentStyle::Slash);
    let tps = emit_go_type_params(&f.type_params);
    let ps = emit_go_params(&f.params);
    let rt = f.return_type.as_ref().map(|t| emit_type(t, LanguageId::Go)).filter(|s| !s.is_empty()).map(|s| format!(" {s}")).unwrap_or_default();
    ec.line(&format!("func {}{tps}({ps}){rt} {{", f.name));
    ec.push();
    emit_go_body(ec, &f.body, ectx);
    ec.pop();
    ec.line("}");
}

fn emit_go_type_params(tps: &[TypeParam]) -> String {
    if tps.is_empty() { return String::new(); }
    let parts: Vec<String> = tps.iter().map(|tp| {
        let constraint = if tp.bounds.is_empty() {
            "any".to_string()
        } else {
            tp.bounds.iter().map(|b| emit_type(b, LanguageId::Go)).collect::<Vec<_>>().join(" | ")
        };
        format!("{} {constraint}", tp.name)
    }).collect();
    format!("[{}]", parts.join(", "))
}

fn extract_go_tag(tr: &Trivia) -> Option<String> {
    tr.leading.iter().find_map(|c| {
        if c.kind != TriviaKind::Attribute { return None; }
        let inner = c.text.trim_start_matches('@').strip_prefix("tag(")?.strip_suffix(')')?.trim();
        if inner.starts_with('`') && inner.ends_with('`') {
            Some(inner.to_string())
        } else if let Some(unq) = inner.strip_prefix('"').and_then(|s| s.strip_suffix('"')) {
            let raw = unq.replace("\\\"", "\"").replace("\\\\", "\\");
            if raw.starts_with('`') && raw.ends_with('`') { Some(raw) } else { Some(format!("`{raw}`")) }
        } else {
            None
        }
    })
}

fn emit_go_body(ec: &mut EmitCtx, body: &FnBody, ectx: &ExprEmitCtx) {
    match body {
        FnBody::SignatureOnly => {}
        FnBody::Expr(Expr::Record(entries))
            if !entries.is_empty()
                && entries.iter().all(|e| matches!(e, RecordEntry::Field { key: None, .. })) =>
        {
            let vals: Vec<String> = entries
                .iter()
                .filter_map(|e| match e {
                    RecordEntry::Field { value, .. } => Some(emit_expr(value, LanguageId::Go, ectx)),
                    _ => None,
                })
                .collect();
            ec.line(&format!("return {}", vals.join(", ")));
        }
        FnBody::Expr(e) => ec.line(&format!("return {}", emit_expr(e, LanguageId::Go, ectx))),
        FnBody::Block(stmts) => emit_brace_stmts(stmts, LanguageId::Go, ec, ectx, false),
    }
}

fn emit_go_params(params: &[ParamDecl]) -> String {
    params.iter().map(|p| {
        let t = p.ty.as_ref().map(|x| emit_type(x, LanguageId::Go)).unwrap_or_else(|| "any".into());
        let dots = if p.is_rest { "..." } else { "" };
        format!("{} {dots}{t}", p.name)
    }).collect::<Vec<_>>().join(", ")
}
