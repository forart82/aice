use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::compile::expr_emit::{ExprEmitCtx, emit_expr};
use crate::compile::type_map::emit_type;
use crate::ir::{AiceItem, AiceModule, TranspileError, Trivia, TriviaKind};
use crate::ir_code::{AccessorKind, ClassDecl, FnBody, FnDecl, MethodDecl, Stmt};
use crate::ir_types::ParamDecl;

pub fn compile(module: &AiceModule) -> Result<String, TranspileError> {
    if module.items.is_empty() && !module.raw_fallback.is_empty() {
        return Ok(module.raw_fallback.clone());
    }
    let ectx = ExprEmitCtx::from_module(module);
    let mut ec = EmitCtx::new("    ");
    ec.emit_trivia(&module.module_trivia, CommentStyle::Hash);

    for item in &module.items {
        match item {
            AiceItem::Import(imp) => {
                ec.emit_trivia(&imp.trivia, CommentStyle::Hash);
                if imp.specifiers.is_empty() { ec.line(&format!("import {}", imp.source)); }
                else {
                    let ss: Vec<String> = imp.specifiers.iter().map(|s| match &s.alias {
                        Some(a) => format!("{} as {a}", s.name), None => s.name.clone(),
                    }).collect();
                    ec.line(&format!("from {} import {}", imp.source, ss.join(", ")));
                }
            }
            AiceItem::Class(cd) => emit_class(&mut ec, cd, &ectx),
            AiceItem::Fn(fd) => emit_fn(&mut ec, fd, &ectx),
            AiceItem::Const(cd) => ec.line(&format!("{} = {}", cd.name, emit_expr(&cd.value, LanguageId::Python, &ectx))),
            AiceItem::Var(vd) => {
                let ty = vd.ty.as_ref().map(|t| format!(": {}", emit_type(t, LanguageId::Python))).unwrap_or_default();
                ec.line(&format!("{}{ty} = {}", vd.name, emit_expr(&vd.value, LanguageId::Python, &ectx)));
            }
            AiceItem::Directive { text, trivia, .. } => {
                ec.emit_trivia(trivia, CommentStyle::Hash);
                for line in text.lines() { ec.line(line); }
            }
            _ => {}
        }
    }
    Ok(ec.out)
}

fn emit_class(ec: &mut EmitCtx, cd: &ClassDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&cd.trivia, CommentStyle::Hash);
    for dec in &cd.decorators { ec.line(&format!("@{dec}")); }
    let bases = cd.extends.as_ref().map(|e| format!("({e})")).unwrap_or_default();
    ec.line(&format!("class {}{bases}:", cd.name));
    ec.push();
    if cd.props.is_empty() && cd.methods.is_empty() {
        ec.line("pass");
    } else {
        for p in &cd.props {
            ec.emit_trivia(&p.trivia, CommentStyle::Hash);
            let t = p.ty.as_ref().map(|x| format!(": {}", emit_type(x, LanguageId::Python))).unwrap_or_default();
            let init = p.init.as_ref().map(|e| format!(" = {}", emit_expr(e, LanguageId::Python, ectx))).unwrap_or_default();
            ec.line(&format!("{}{t}{init}", p.name));
        }
        for m in &cd.methods { emit_method(ec, m, ectx); }
    }
    ec.pop();
}

fn has_py_attr(tr: &Trivia, name: &str) -> bool {
    tr.leading.iter().any(|c| c.kind == TriviaKind::Attribute && c.text.trim() == name)
}

fn py_kwargs_tag(s: &str) -> Option<&str> {
    s.trim().trim_start_matches('@').strip_prefix("kwargs(")?.strip_suffix(')')
}

fn py_trivia_kwargs(tr: &Trivia) -> Option<&str> {
    tr.leading.iter().find_map(|c| (c.kind == TriviaKind::Attribute).then(|| py_kwargs_tag(&c.text)).flatten())
}

fn emit_method(ec: &mut EmitCtx, m: &MethodDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&m.trivia, CommentStyle::Hash);
    for c in &m.trivia.leading {
        if c.kind == TriviaKind::Attribute && py_kwargs_tag(&c.text).is_none() {
            ec.line(&c.text);
        }
    }
    if m.is_static && !has_py_attr(&m.trivia, "@staticmethod") { ec.line("@staticmethod"); }
    if m.accessor == AccessorKind::Get && !has_py_attr(&m.trivia, "@property") { ec.line("@property"); }
    let asy = if m.is_async { "async " } else { "" };
    let ps = emit_py_params(&m.params, py_trivia_kwargs(&m.trivia), ectx);
    let rt = m.return_type.as_ref().map(|t| format!(" -> {}", emit_type(t, LanguageId::Python))).unwrap_or_default();
    ec.line(&format!("{asy}def {}({ps}){rt}:", m.name));
    ec.push();
    emit_py_body(ec, &m.body, ectx);
    ec.pop();
}

fn emit_fn(ec: &mut EmitCtx, f: &FnDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&f.trivia, CommentStyle::Hash);
    let kw_param = f.decorators.iter().find_map(|d| py_kwargs_tag(d)).or_else(|| py_trivia_kwargs(&f.trivia));
    for dec in &f.decorators {
        if py_kwargs_tag(dec).is_none() { ec.line(&format!("@{dec}")); }
    }
    let asy = if f.is_async { "async " } else { "" };
    let ps = emit_py_params(&f.params, kw_param, ectx);
    let rt = f.return_type.as_ref().map(|t| format!(" -> {}", emit_type(t, LanguageId::Python))).unwrap_or_default();
    ec.line(&format!("{asy}def {}({ps}){rt}:", f.name));
    ec.push();
    emit_py_body(ec, &f.body, ectx);
    ec.pop();
}

fn emit_py_body(ec: &mut EmitCtx, body: &FnBody, ectx: &ExprEmitCtx) {
    match body {
        FnBody::SignatureOnly => ec.line("pass"),
        FnBody::Expr(e) => ec.line(&format!("return {}", emit_expr(e, LanguageId::Python, ectx))),
        FnBody::Block(stmts) if stmts.is_empty() => ec.line("pass"),
        FnBody::Block(stmts) => emit_py_stmts(ec, stmts, ectx),
    }
}

fn emit_py_stmts(ec: &mut EmitCtx, stmts: &[Stmt], ectx: &ExprEmitCtx) {
    crate::compile::iter_emit::run_py_stmts(ec, stmts, ectx);
}

fn emit_py_params(params: &[ParamDecl], kw_param: Option<&str>, ectx: &ExprEmitCtx) -> String {
    let mut seen_rest = false;
    params.iter().map(|p| {
        let mut s = if p.is_rest {
            let is_kw = kw_param == Some(p.name.as_str()) || seen_rest;
            if !is_kw { seen_rest = true; }
            if is_kw { format!("**{}", p.name) } else { format!("*{}", p.name) }
        } else {
            p.name.clone()
        };
        if let Some(ref ty) = p.ty { s.push_str(&format!(": {}", emit_type(ty, LanguageId::Python))); }
        if let Some(ref def) = p.default { s.push_str(&format!(" = {}", emit_expr(def, LanguageId::Python, ectx))); }
        s
    }).collect::<Vec<_>>().join(", ")
}
