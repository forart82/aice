use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::compile::expr_emit::{ExprEmitCtx, emit_expr};
use crate::compile::stmt_common::emit_brace_stmts;
use crate::compile::type_map::emit_type;
use crate::ir::{AiceItem, AiceModule, TranspileError, Visibility};
use crate::ir_code::{AccessorKind, ClassDecl, FnBody, FnDecl, MethodDecl};
use crate::ir_types::{EnumDecl, ParamDecl, TypeDecl};

pub fn compile(module: &AiceModule) -> Result<String, TranspileError> {
    if module.items.is_empty() && !module.raw_fallback.is_empty() {
        return Ok(module.raw_fallback.clone());
    }
    let ectx = ExprEmitCtx::from_module(module);
    let mut ec = EmitCtx::new("    ");
    ec.emit_trivia(&module.module_trivia, CommentStyle::Slash);
    if !module.module_name.is_empty() && module.module_name != "module" && module.module_name != "java" {
        ec.line(&format!("package {};", module.module_name.replace('/', ".")));
    }
    for item in &module.items {
        if let AiceItem::Import(imp) = item { ec.line(&format!("import {};", imp.source)); }
    }
    let mut top_fns: Vec<&FnDecl> = Vec::new();
    for item in &module.items {
        match item {
            AiceItem::Class(cd) => emit_java_class(&mut ec, cd, &ectx),
            AiceItem::Enum(ed) => emit_java_enum(&mut ec, ed),
            AiceItem::Type(td) => emit_java_interface(&mut ec, td),
            AiceItem::Fn(fd) => top_fns.push(fd),
            _ => {}
        }
    }
    if !top_fns.is_empty() {
        let mut synth = java_synth_class_name(&module.module_name);
        if module.items.iter().any(|it| match it {
            AiceItem::Class(c) => c.name == synth,
            AiceItem::Enum(e) => e.name == synth,
            AiceItem::Type(t) => t.name == synth,
            _ => false,
        }) {
            synth.push_str("Module");
        }
        ec.blank();
        ec.line(&format!("public class {synth} {{"));
        ec.push();
        for f in top_fns { emit_java_static_fn(&mut ec, f, &ectx); }
        ec.pop();
        ec.line("}");
    }
    Ok(ec.out)
}

fn java_synth_class_name(mod_name: &str) -> String {
    let seg = mod_name.rsplit(['/', '.']).next().unwrap_or("").trim();
    if seg.is_empty() || seg == "module" || seg == "java" || !seg.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
        return "Module".into();
    }
    let mut chars = seg.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() => format!("{}{}", c.to_ascii_uppercase(), chars.as_str()),
        _ => "Module".into(),
    }
}

fn emit_java_static_fn(ec: &mut EmitCtx, f: &FnDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&f.trivia, CommentStyle::Slash);
    let ps = emit_j_params(&f.params);
    let rt = f.return_type.as_ref().map(|t| emit_type(t, LanguageId::Java)).unwrap_or_else(|| "void".into());
    let vis = if f.vis == Visibility::Default { "public " } else { j_vis(f.vis) };
    ec.line(&format!("{vis}static {rt} {}({ps}) {{", f.name));
    ec.push();
    match &f.body {
        FnBody::SignatureOnly => {}
        FnBody::Expr(e) => ec.line(&format!("return {};", emit_expr(e, LanguageId::Java, ectx))),
        FnBody::Block(stmts) => emit_brace_stmts(stmts, LanguageId::Java, ec, ectx, false),
    }
    ec.pop();
    ec.line("}");
}

fn emit_java_enum(ec: &mut EmitCtx, ed: &EnumDecl) {
    ec.blank();
    ec.emit_trivia(&ed.trivia, CommentStyle::Slash);
    ec.line(&format!("{}enum {} {{", j_vis(ed.vis), ed.name));
    ec.push();
    for v in &ed.variants { ec.line(&format!("{},", v.name)); }
    ec.pop();
    ec.line("}");
}

fn emit_java_interface(ec: &mut EmitCtx, td: &TypeDecl) {
    ec.blank();
    ec.emit_trivia(&td.trivia, CommentStyle::Slash);
    ec.line(&format!("{}interface {} {{", j_vis(td.vis), td.name));
    ec.push();
    for m in &td.methods {
        let ps = emit_j_params(&m.params);
        let rt = m.return_type.as_ref().map(|t| emit_type(t, LanguageId::Java)).unwrap_or_else(|| "void".into());
        ec.line(&format!("{rt} {}({ps});", m.name));
    }
    ec.pop();
    ec.line("}");
}

fn emit_java_class(ec: &mut EmitCtx, cd: &ClassDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&cd.trivia, CommentStyle::Slash);
    if cd.decorators.iter().any(|d| d == "record") {
        let ctor = emit_j_params(&cd.primary_ctor);
        ec.line(&format!("{}record {}({ctor}) {{", j_vis(cd.vis), cd.name));
    } else {
        ec.line(&format!("{}class {} {{", j_vis(cd.vis), cd.name));
    }
    ec.push();
    for p in &cd.props {
        let fin = if p.is_readonly { "final " } else { "" };
        let t = p.ty.as_ref().map(|x| emit_type(x, LanguageId::Java)).unwrap_or_else(|| "Object".into());
        ec.line(&format!("{}{fin}{t} {};", j_vis(p.vis), p.name));
    }
    for m in &cd.methods { emit_java_method(ec, m, &cd.name, ectx); }
    ec.pop();
    ec.line("}");
}

fn emit_java_method(ec: &mut EmitCtx, m: &MethodDecl, cls_name: &str, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&m.trivia, CommentStyle::Slash);
    let ps = emit_j_params(&m.params);
    if m.accessor == AccessorKind::Constructor {
        ec.line(&format!("{}{cls_name}({ps}) {{", j_vis(m.vis)));
    } else {
        let rt = m.return_type.as_ref().map(|t| emit_type(t, LanguageId::Java)).unwrap_or_else(|| "void".into());
        ec.line(&format!("{}{rt} {}({ps}) {{", j_vis(m.vis), m.name));
    }
    ec.push();
    match &m.body {
        FnBody::SignatureOnly => {}
        FnBody::Expr(e) => ec.line(&format!("return {};", emit_expr(e, LanguageId::Java, ectx))),
        FnBody::Block(stmts) => emit_brace_stmts(stmts, LanguageId::Java, ec, ectx, false),
    }
    ec.pop();
    ec.line("}");
}

fn emit_j_params(params: &[ParamDecl]) -> String {
    params.iter().map(|p| {
        let t = p.ty.as_ref().map(|x| emit_type(x, LanguageId::Java)).unwrap_or_else(|| "Object".into());
        format!("{t} {}", p.name)
    }).collect::<Vec<_>>().join(", ")
}

fn j_vis(v: Visibility) -> &'static str {
    match v {
        Visibility::Public => "public ", Visibility::Private => "private ",
        Visibility::Protected => "protected ", _ => "",
    }
}
