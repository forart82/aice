use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::compile::expr_emit::{ExprEmitCtx, emit_expr};
use crate::compile::stmt_common::emit_brace_stmts;
use crate::compile::type_map::emit_type;
use crate::ir::{AiceItem, AiceModule, TranspileError, Visibility};
use crate::ir_code::{AccessorKind, ClassDecl, FnBody, FnDecl, MethodDecl};
use crate::ir_types::{EnumDecl, ParamDecl, TypeDecl, TypeKind};

pub fn compile(module: &AiceModule) -> Result<String, TranspileError> {
    if module.items.is_empty() && !module.raw_fallback.is_empty() {
        return Ok(module.raw_fallback.clone());
    }
    let ectx = ExprEmitCtx::from_module(module);
    let mut ec = EmitCtx::new("    ");
    ec.emit_trivia(&module.module_trivia, CommentStyle::Slash);

    for item in &module.items {
        if let AiceItem::Import(imp) = item { ec.line(&format!("using {};", imp.source)); }
    }
    let has_ns = !module.module_name.is_empty() && module.module_name != "module" && module.module_name != "csharp";
    if has_ns {
        ec.blank();
        ec.line(&format!("namespace {} {{", module.module_name.replace('/', ".")));
    }
    for item in &module.items {
        match item {
            AiceItem::Class(cd) => emit_cs_class(&mut ec, cd, &ectx),
            AiceItem::Enum(ed) => emit_cs_enum(&mut ec, ed),
            AiceItem::Type(td) => emit_cs_type(&mut ec, td, &ectx),
            AiceItem::Fn(fd) => emit_cs_fn(&mut ec, fd, &ectx),
            AiceItem::Const(cd) => {
                let t = cd.ty.as_ref().map(|x| emit_type(x, LanguageId::CSharp)).unwrap_or_else(|| "var".into());
                ec.line(&format!("{}const {t} {} = {};", cs_vis(cd.vis), cd.name, emit_expr(&cd.value, LanguageId::CSharp, &ectx)));
            }
            AiceItem::Var(vd) => {
                let t = vd.ty.as_ref().map(|x| emit_type(x, LanguageId::CSharp)).unwrap_or_else(|| "var".into());
                ec.line(&format!("{}{t} {} = {};", cs_vis(vd.vis), vd.name, emit_expr(&vd.value, LanguageId::CSharp, &ectx)));
            }
            _ => {}
        }
    }
    if has_ns {
        ec.blank();
        ec.line("}");
    }
    Ok(ec.out)
}

fn emit_cs_enum(ec: &mut EmitCtx, ed: &EnumDecl) {
    ec.blank();
    ec.emit_trivia(&ed.trivia, CommentStyle::Slash);
    ec.line(&format!("{}enum {} {{", cs_vis(ed.vis), ed.name));
    ec.push();
    for v in &ed.variants { ec.line(&format!("{},", v.name)); }
    ec.pop();
    ec.line("}");
}

fn emit_cs_type(ec: &mut EmitCtx, td: &TypeDecl, _ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&td.trivia, CommentStyle::Slash);
    let kw = match td.kind {
        TypeKind::Interface => "interface",
        TypeKind::Trait => "interface",
        _ => "struct",
    };
    ec.line(&format!("{}{kw} {} {{", cs_vis(td.vis), td.name));
    ec.push();
    for f in &td.fields {
        let t = f.ty.as_ref().map(|x| emit_type(x, LanguageId::CSharp)).unwrap_or_else(|| "object".into());
        ec.line(&format!("{t} {} {{ get; set; }}", f.name));
    }
    for m in &td.methods {
        let ps = emit_cs_params(&m.params);
        let rt = m.return_type.as_ref().map(|t| emit_type(t, LanguageId::CSharp)).unwrap_or_else(|| "void".into());
        ec.line(&format!("{rt} {}({ps});", m.name));
    }
    ec.pop();
    ec.line("}");
}

fn emit_cs_class(ec: &mut EmitCtx, cd: &ClassDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&cd.trivia, CommentStyle::Slash);
    let kw = if cd.decorators.iter().any(|d| d == "record") { "record" }
    else if cd.decorators.iter().any(|d| d == "struct") { "struct" }
    else { "class" };
    let ctor = if cd.primary_ctor.is_empty() { String::new() } else { format!("({})", emit_cs_params(&cd.primary_ctor)) };
    if kw == "record" && cd.props.is_empty() && cd.methods.is_empty() {
        ec.line(&format!("{}{kw} {}{ctor};", cs_vis(cd.vis), cd.name));
        return;
    }
    ec.line(&format!("{}{kw} {}{ctor} {{", cs_vis(cd.vis), cd.name));
    ec.push();
    for p in &cd.props {
        let t = p.ty.as_ref().map(|x| emit_type(x, LanguageId::CSharp)).unwrap_or_else(|| "object".into());
        if let Some(ref init) = p.init {
            let rhs = emit_expr(init, LanguageId::CSharp, ectx);
            if p.is_readonly {
                ec.line(&format!("{}{t} {} => {rhs};", cs_vis(p.vis), p.name));
            } else {
                ec.line(&format!("{}{t} {} {{ get; set; }} = {rhs};", cs_vis(p.vis), p.name));
            }
        } else {
            let acc = if p.is_readonly { "{ get; }" } else { "{ get; set; }" };
            ec.line(&format!("{}{t} {} {acc}", cs_vis(p.vis), p.name));
        }
    }
    for m in &cd.methods { emit_cs_method(ec, m, &cd.name, ectx); }
    ec.pop();
    ec.line("}");
}

fn emit_cs_method(ec: &mut EmitCtx, m: &MethodDecl, cls_name: &str, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&m.trivia, CommentStyle::Slash);
    let ps = emit_cs_params(&m.params);
    let st = if m.is_static { "static " } else { "" };
    let asy = if m.is_async { "async " } else { "" };
    let rt = m.return_type.as_ref().map(|t| emit_type(t, LanguageId::CSharp)).unwrap_or_else(|| "void".into());
    if let FnBody::Expr(e) = &m.body
        && (m.accessor == AccessorKind::Constructor || rt == "void")
    {
        let rhs = emit_expr(e, LanguageId::CSharp, ectx);
        if m.accessor == AccessorKind::Constructor {
            ec.line(&format!("{}{cls_name}({ps}) => {rhs};", cs_vis(m.vis)));
        } else {
            ec.line(&format!("{}{st}{asy}void {}({ps}) => {rhs};", cs_vis(m.vis), m.name));
        }
        return;
    }
    if m.accessor == AccessorKind::Constructor {
        ec.line(&format!("{}{cls_name}({ps}) {{", cs_vis(m.vis)));
    } else {
        ec.line(&format!("{}{st}{asy}{rt} {}({ps}) {{", cs_vis(m.vis), m.name));
    }
    ec.push();
    match &m.body {
        FnBody::SignatureOnly => {}
        FnBody::Expr(e) => ec.line(&format!("return {};", emit_expr(e, LanguageId::CSharp, ectx))),
        FnBody::Block(stmts) => emit_brace_stmts(stmts, LanguageId::CSharp, ec, ectx, false),
    }
    ec.pop();
    ec.line("}");
}

fn emit_cs_fn(ec: &mut EmitCtx, f: &FnDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&f.trivia, CommentStyle::Slash);
    let ps = emit_cs_params(&f.params);
    let asy = if f.is_async { "async " } else { "" };
    let rt = f.return_type.as_ref().map(|t| emit_type(t, LanguageId::CSharp)).unwrap_or_else(|| "void".into());
    if let FnBody::Expr(e) = &f.body && rt == "void" {
        ec.line(&format!("{}{asy}void {}({ps}) => {};", cs_vis(f.vis), f.name, emit_expr(e, LanguageId::CSharp, ectx)));
        return;
    }
    ec.line(&format!("{}{asy}{rt} {}({ps}) {{", cs_vis(f.vis), f.name));
    ec.push();
    match &f.body {
        FnBody::SignatureOnly => {}
        FnBody::Expr(e) => ec.line(&format!("return {};", emit_expr(e, LanguageId::CSharp, ectx))),
        FnBody::Block(stmts) => emit_brace_stmts(stmts, LanguageId::CSharp, ec, ectx, false),
    }
    ec.pop();
    ec.line("}");
}

fn emit_cs_params(params: &[ParamDecl]) -> String {
    params.iter().map(|p| {
        let t = p.ty.as_ref().map(|x| emit_type(x, LanguageId::CSharp)).unwrap_or_else(|| "object".into());
        format!("{t} {}", p.name)
    }).collect::<Vec<_>>().join(", ")
}

fn cs_vis(v: Visibility) -> &'static str {
    match v {
        Visibility::Public => "public ", Visibility::Private => "private ",
        Visibility::Protected => "protected ", Visibility::Package => "internal ",
        _ => "",
    }
}
