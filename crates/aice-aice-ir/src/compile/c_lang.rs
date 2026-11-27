use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::compile::expr_emit::{ExprEmitCtx, emit_expr};
use crate::compile::stmt_common::emit_brace_stmts;
use crate::compile::type_map::emit_type;
use crate::ir::{AiceItem, AiceModule, TranspileError, Trivia, TriviaKind, Visibility};
use crate::ir_code::{FnBody, FnDecl};
use crate::ir_types::{EnumDecl, ParamDecl, TypeDecl};

pub fn compile(module: &AiceModule) -> Result<String, TranspileError> {
    if module.items.is_empty() && !module.raw_fallback.is_empty() {
        return Ok(module.raw_fallback.clone());
    }
    let ectx = ExprEmitCtx::from_module(module);
    let mut ec = EmitCtx::new("    ");
    ec.emit_trivia(&module.module_trivia, CommentStyle::Slash);

    for item in &module.items {
        match item {
            AiceItem::Import(imp) => {
                let inc = if imp.source.starts_with('<') || imp.source.starts_with('"') {
                    imp.source.clone()
                } else {
                    format!("<{}>", imp.source)
                };
                ec.line(&format!("#include {inc}"));
            }
            AiceItem::Type(td) => emit_c_struct(&mut ec, td),
            AiceItem::Enum(ed) => emit_c_enum(&mut ec, ed, &ectx),
            AiceItem::Fn(fd) => emit_c_fn(&mut ec, fd, &ectx),
            AiceItem::Directive { text, .. } => ec.line(text),
            _ => {}
        }
    }
    Ok(ec.out)
}

fn c_tag_attr(tr: &Trivia) -> Option<&str> {
    tr.leading.iter().find_map(|c| {
        if c.kind != TriviaKind::Attribute { return None; }
        c.text.trim_start_matches('@').strip_prefix("tag(")?.strip_suffix(')')
    })
}

fn emit_c_enum(ec: &mut EmitCtx, ed: &EnumDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&ed.trivia, CommentStyle::Slash);
    match c_tag_attr(&ed.trivia) {
        Some(tag) if !tag.is_empty() => ec.line(&format!("typedef enum {tag} {{")),
        _ => ec.line("typedef enum {"),
    }
    ec.push();
    if ed.variants.is_empty() {
        ec.line(&format!("{}_EMPTY = 0", ed.name));
    } else {
        for (i, v) in ed.variants.iter().enumerate() {
            ec.emit_trivia(&v.trivia, CommentStyle::Slash);
            let comma = if i + 1 < ed.variants.len() { "," } else { "" };
            match &v.discriminant {
                Some(d) => ec.line(&format!("{} = {}{comma}", v.name, emit_expr(d, LanguageId::C, ectx))),
                None => ec.line(&format!("{}{comma}", v.name)),
            }
        }
    }
    ec.pop();
    ec.line(&format!("}} {};", ed.name));
}

fn emit_c_struct(ec: &mut EmitCtx, td: &TypeDecl) {
    ec.blank();
    ec.emit_trivia(&td.trivia, CommentStyle::Slash);
    ec.line("typedef struct {");
    ec.push();
    for f in &td.fields {
        let raw_t = f.ty.as_ref().map(|x| emit_type(x, LanguageId::C)).unwrap_or_else(|| "int".into());
        let t = promote_c_void_type(raw_t);
        ec.line(&format!("{t} {};", f.name));
    }
    ec.pop();
    ec.line(&format!("}} {};", td.name));
}

fn emit_c_fn(ec: &mut EmitCtx, f: &FnDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&f.trivia, CommentStyle::Slash);
    let st = if f.vis == Visibility::Private { "static " } else { "" };
    let raw_rt = f.return_type.as_ref().map(|t| emit_type(t, LanguageId::C)).unwrap_or_else(|| "void".into());
    let rt = strip_c_return_void_restrict(raw_rt);
    let ps = emit_c_params(&f.params);
    ec.line(&format!("{st}{rt} {}({ps}) {{", f.name));
    ec.push();
    match &f.body {
        FnBody::SignatureOnly => {}
        FnBody::Expr(e) => ec.line(&format!("return {};", emit_expr(e, LanguageId::C, ectx))),
        FnBody::Block(stmts) => emit_brace_stmts(stmts, LanguageId::C, ec, ectx, false),
    }
    ec.pop();
    ec.line("}");
}

fn emit_c_params(params: &[ParamDecl]) -> String {
    if params.is_empty() { return "void".into(); }
    params.iter().map(|p| {
        let raw_t = p.ty.as_ref().map(|x| emit_type(x, LanguageId::C)).unwrap_or_else(|| "int".into());
        let t = promote_c_void_type(raw_t);
        format!("{t} {}", p.name)
    }).collect::<Vec<_>>().join(", ")
}

fn promote_c_void_type(t: String) -> String {
    if t == "void" {
        return "void*".into();
    }
    if t.split_whitespace().last() == Some("void") {
        let quals: Vec<&str> = t
            .split_whitespace()
            .filter(|w| matches!(*w, "const" | "volatile"))
            .collect();
        if quals.is_empty() {
            return "void*".into();
        }
        return format!("{} void*", quals.join(" "));
    }
    t
}

fn strip_c_return_void_restrict(t: String) -> String {
    if t.split_whitespace().last() == Some("void") {
        return t
            .split_whitespace()
            .filter(|w| *w != "restrict")
            .collect::<Vec<_>>()
            .join(" ");
    }
    t
}
