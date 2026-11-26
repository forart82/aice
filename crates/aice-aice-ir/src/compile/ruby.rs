use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::compile::expr_emit::{ExprEmitCtx, emit_expr};
use crate::compile::iter_rb::emit_rb_line;
use crate::ir::{AiceItem, AiceModule, TranspileError, TriviaKind};
use crate::ir_code::{AccessorKind, ClassDecl, FnBody, FnDecl, MethodDecl, PropDecl, Stmt};
use crate::ir_types::ParamDecl;

pub fn compile(module: &AiceModule) -> Result<String, TranspileError> {
    if module.items.is_empty() && !module.raw_fallback.is_empty() {
        return Ok(module.raw_fallback.clone());
    }
    let ectx = ExprEmitCtx::from_module(module);
    let mut ec = EmitCtx::new("  ");
    ec.emit_trivia(&module.module_trivia, CommentStyle::Hash);
    let has_mod = !module.module_name.is_empty() && module.module_name != "module" && module.module_name != "ruby";
    if has_mod {
        let mut chars = module.module_name.chars();
        let mod_name = match chars.next() {
            Some(c) if c.is_ascii_lowercase() => format!("{}{}", c.to_ascii_uppercase(), chars.as_str()),
            _ => module.module_name.clone(),
        };
        ec.line(&format!("module {mod_name}"));
        ec.push();
    }
    for item in &module.items {
        match item {
            AiceItem::Import(imp) => ec.line(&format!("require '{}'", imp.source)),
            AiceItem::Class(cd) => emit_rb_class(&mut ec, cd, &ectx),
            AiceItem::Fn(fd) => emit_rb_fn(&mut ec, fd, &ectx),
            _ => {}
        }
    }
    if has_mod {
        ec.pop();
        ec.line("end");
    }
    Ok(ec.out)
}

fn rb_attr_macro(p: &PropDecl) -> &'static str {
    for c in &p.trivia.leading {
        if c.kind == TriviaKind::Attribute {
            match c.text.trim_start_matches('@') {
                "attr_writer" => return "attr_writer",
                "attr_reader" => return "attr_reader",
                "attr_accessor" => return "attr_accessor",
                _ => {}
            }
        }
    }
    if p.is_readonly { "attr_reader" } else { "attr_accessor" }
}

fn emit_rb_class(ec: &mut EmitCtx, cd: &ClassDecl, ectx: &ExprEmitCtx) {
    ec.emit_trivia(&cd.trivia, CommentStyle::Hash);
    let sup = cd.extends.as_ref().map(|e| format!(" < {e}")).unwrap_or_default();
    ec.line(&format!("class {}{sup}", cd.name));
    ec.push();
    let mut i = 0usize;
    while i < cd.props.len() {
        let p = &cd.props[i];
        let kind = rb_attr_macro(p);
        ec.emit_trivia(&p.trivia, CommentStyle::Hash);
        let mut syms = vec![format!(":{}", p.name)];
        let mut j = i + 1;
        while j < cd.props.len() {
            let nxt = &cd.props[j];
            let has_comment = nxt.trivia.leading.iter().any(|c| c.kind != TriviaKind::Attribute);
            if rb_attr_macro(nxt) == kind && !has_comment {
                syms.push(format!(":{}", nxt.name));
                j += 1;
            } else {
                break;
            }
        }
        ec.line(&format!("{kind} {}", syms.join(", ")));
        i = j;
    }
    for m in &cd.methods { emit_rb_method(ec, m, ectx); }
    ec.pop();
    ec.line("end");
}

fn emit_rb_method(ec: &mut EmitCtx, m: &MethodDecl, ectx: &ExprEmitCtx) {
    ec.emit_trivia(&m.trivia, CommentStyle::Hash);
    let ps = emit_rb_params(&m.params);
    let nm = if m.accessor == AccessorKind::Constructor || m.name == "constructor" {
        "initialize"
    } else {
        m.name.as_str()
    };
    ec.line(&format!("def {nm}{ps}"));
    ec.push();
    emit_rb_body(ec, &m.body, ectx);
    ec.pop();
    ec.line("end");
}

fn emit_rb_fn(ec: &mut EmitCtx, f: &FnDecl, ectx: &ExprEmitCtx) {
    ec.emit_trivia(&f.trivia, CommentStyle::Hash);
    let ps = emit_rb_params(&f.params);
    ec.line(&format!("def {}{ps}", f.name));
    ec.push();
    emit_rb_body(ec, &f.body, ectx);
    ec.pop();
    ec.line("end");
}

fn emit_rb_body(ec: &mut EmitCtx, body: &FnBody, ectx: &ExprEmitCtx) {
    match body {
        FnBody::SignatureOnly => {}
        FnBody::Expr(e) => emit_rb_line(ec, &emit_expr(e, LanguageId::Ruby, ectx)),
        FnBody::Block(stmts) => emit_rb_stmts(ec, stmts, ectx),
    }
}

pub(crate) fn emit_rb_stmts(ec: &mut EmitCtx, stmts: &[Stmt], ectx: &ExprEmitCtx) {
    crate::compile::iter_emit::run_rb_stmts(ec, stmts, ectx);
}

fn emit_rb_params(params: &[ParamDecl]) -> String {
    if params.is_empty() { String::new() }
    else { format!("({})", params.iter().map(|p| p.name.as_str()).collect::<Vec<_>>().join(", ")) }
}
