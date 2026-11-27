use aice_lang_registry::LanguageId;

use crate::compile::csharp_java::{emit_cs_bases, emit_cs_type_params, emit_cs_where, has_attr};
use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::compile::expr_emit::{ExprEmitCtx, emit_expr};
use crate::compile::stmt_common::emit_brace_stmts;
use crate::compile::type_map::emit_type;
use crate::ir::{AiceItem, AiceModule, TranspileError, Trivia, TriviaKind, Visibility};
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
            AiceItem::Enum(ed) => emit_cs_enum(&mut ec, ed, &ectx),
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

fn cs_attr_arg<'a>(tr: &'a Trivia, prefix: &str) -> Option<&'a str> {
    tr.leading.iter().find_map(|c| {
        if c.kind != TriviaKind::Attribute { return None; }
        c.text.trim_start_matches('@').strip_prefix(prefix)?.strip_prefix('(')?.strip_suffix(')')
    })
}

fn emit_cs_enum(ec: &mut EmitCtx, ed: &EnumDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&ed.trivia, CommentStyle::Slash);
    let base = cs_attr_arg(&ed.trivia, "base").map(|b| format!(" : {b}")).unwrap_or_default();
    ec.line(&format!("{}enum {}{base} {{", cs_vis(ed.vis), ed.name));
    ec.push();
    for v in &ed.variants {
        ec.emit_trivia(&v.trivia, CommentStyle::Slash);
        match &v.discriminant {
            Some(d) => ec.line(&format!("{} = {},", v.name, emit_expr(d, LanguageId::CSharp, ectx))),
            None => ec.line(&format!("{},", v.name)),
        }
    }
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
    let tps = emit_cs_type_params(&td.type_params);
    let bases = emit_cs_bases(None, &td.extends);
    let wh = emit_cs_where(&td.type_params);
    ec.line(&format!("{}{kw} {}{tps}{bases}{wh} {{", cs_vis(td.vis), td.name));
    ec.push();
    for f in &td.fields {
        let t = f.ty.as_ref().map(|x| emit_type(x, LanguageId::CSharp)).unwrap_or_else(|| "object".into());
        ec.line(&format!("{t} {} {{ get; set; }}", f.name));
    }
    for m in &td.methods {
        let ps = emit_cs_params(&m.params, _ectx);
        let mtps = emit_cs_type_params(&m.type_params);
        let mwh = emit_cs_where(&m.type_params);
        let rt = m.return_type.as_ref().map(|t| emit_type(t, LanguageId::CSharp)).unwrap_or_else(|| "void".into());
        ec.line(&format!("{rt} {}{mtps}({ps}){mwh};", m.name));
    }
    ec.pop();
    ec.line("}");
}

fn emit_cs_class(ec: &mut EmitCtx, cd: &ClassDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&cd.trivia, CommentStyle::Slash);
    let has_dec = |k: &str| cd.decorators.iter().any(|d| d.trim_start_matches('@') == k);
    let kw = if has_dec("record") { "record" }
    else if has_dec("struct") { "struct" }
    else { "class" };
    let st = if has_dec("static") { "static " } else { "" };
    let abs = if cd.is_abstract { "abstract " } else { "" };
    let tps = emit_cs_type_params(&cd.type_params);
    let bases = emit_cs_bases(cd.extends.as_deref(), &cd.implements);
    let wh = emit_cs_where(&cd.type_params);
    let ctor = if cd.primary_ctor.is_empty() { String::new() } else { format!("({})", emit_cs_params(&cd.primary_ctor, ectx)) };
    if kw == "record" && cd.props.is_empty() && cd.methods.is_empty() {
        ec.line(&format!("{}{st}{abs}{kw} {}{tps}{ctor}{bases}{wh};", cs_vis(cd.vis), cd.name));
        return;
    }
    ec.line(&format!("{}{st}{abs}{kw} {}{tps}{ctor}{bases}{wh} {{", cs_vis(cd.vis), cd.name));
    ec.push();
    for p in &cd.props {
        ec.emit_trivia(&p.trivia, CommentStyle::Slash);
        let st = if p.is_static { "static " } else { "" };
        let t = p.ty.as_ref().map(|x| emit_type(x, LanguageId::CSharp)).unwrap_or_else(|| "object".into());
        if has_attr(&p.trivia, "const") {
            let rhs = p.init.as_ref().map(|e| emit_expr(e, LanguageId::CSharp, ectx)).unwrap_or_else(|| "default".into());
            ec.line(&format!("{}const {t} {} = {rhs};", cs_vis(p.vis), p.name));
        } else if let Some(ref init) = p.init {
            let rhs = emit_expr(init, LanguageId::CSharp, ectx);
            if p.is_readonly {
                ec.line(&format!("{}{st}{t} {} => {rhs};", cs_vis(p.vis), p.name));
            } else {
                ec.line(&format!("{}{st}{t} {} {{ get; set; }} = {rhs};", cs_vis(p.vis), p.name));
            }
        } else {
            let acc = if p.is_readonly { "{ get; }" } else { "{ get; set; }" };
            ec.line(&format!("{}{st}{t} {} {acc}", cs_vis(p.vis), p.name));
        }
    }
    for m in &cd.methods { emit_cs_method(ec, m, &cd.name, cd.is_abstract, ectx); }
    ec.pop();
    ec.line("}");
}

fn emit_cs_method(ec: &mut EmitCtx, m: &MethodDecl, cls_name: &str, cls_abs: bool, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&m.trivia, CommentStyle::Slash);
    let ps = emit_cs_params(&m.params, ectx);
    let st = if m.is_static { "static " } else { "" };
    let asy = if m.is_async { "async " } else { "" };
    let ovr = if has_attr(&m.trivia, "override") { "override " }
        else if has_attr(&m.trivia, "virtual") { "virtual " }
        else { "" };
    let is_ctor = m.accessor == AccessorKind::Constructor;
    let tps = if is_ctor { String::new() } else { emit_cs_type_params(&m.type_params) };
    let wh = if is_ctor { String::new() } else { emit_cs_where(&m.type_params) };
    let rt = m.return_type.as_ref().map(|t| emit_type(t, LanguageId::CSharp)).unwrap_or_else(|| "void".into());
    if !is_ctor && (has_attr(&m.trivia, "abstract") || (cls_abs && matches!(m.body, FnBody::SignatureOnly))) {
        ec.line(&format!("{}abstract {rt} {}{tps}({ps}){wh};", cs_vis(m.vis), m.name));
        return;
    }
    if let FnBody::Expr(e) = &m.body
        && (is_ctor || rt == "void")
    {
        let rhs = emit_expr(e, LanguageId::CSharp, ectx);
        if is_ctor {
            ec.line(&format!("{}{cls_name}({ps}) => {rhs};", cs_vis(m.vis)));
        } else {
            ec.line(&format!("{}{st}{ovr}{asy}void {}{tps}({ps}){wh} => {rhs};", cs_vis(m.vis), m.name));
        }
        return;
    }
    if is_ctor {
        ec.line(&format!("{}{cls_name}({ps}) {{", cs_vis(m.vis)));
    } else {
        ec.line(&format!("{}{st}{ovr}{asy}{rt} {}{tps}({ps}){wh} {{", cs_vis(m.vis), m.name));
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
    let ps = emit_cs_params(&f.params, ectx);
    let asy = if f.is_async { "async " } else { "" };
    let tps = emit_cs_type_params(&f.type_params);
    let wh = emit_cs_where(&f.type_params);
    let rt = f.return_type.as_ref().map(|t| emit_type(t, LanguageId::CSharp)).unwrap_or_else(|| "void".into());
    if let FnBody::Expr(e) = &f.body && rt == "void" {
        ec.line(&format!("{}{asy}void {}{tps}({ps}){wh} => {};", cs_vis(f.vis), f.name, emit_expr(e, LanguageId::CSharp, ectx)));
        return;
    }
    ec.line(&format!("{}{asy}{rt} {}{tps}({ps}){wh} {{", cs_vis(f.vis), f.name));
    ec.push();
    match &f.body {
        FnBody::SignatureOnly => {}
        FnBody::Expr(e) => ec.line(&format!("return {};", emit_expr(e, LanguageId::CSharp, ectx))),
        FnBody::Block(stmts) => emit_brace_stmts(stmts, LanguageId::CSharp, ec, ectx, false),
    }
    ec.pop();
    ec.line("}");
}

fn emit_cs_params(params: &[ParamDecl], ectx: &ExprEmitCtx) -> String {
    params.iter().map(|p| {
        let t = p.ty.as_ref().map(|x| emit_type(x, LanguageId::CSharp)).unwrap_or_else(|| "object".into());
        let d = p.default.as_ref().map(|e| format!(" = {}", emit_expr(e, LanguageId::CSharp, ectx))).unwrap_or_default();
        format!("{t} {}{d}", p.name)
    }).collect::<Vec<_>>().join(", ")
}

fn cs_vis(v: Visibility) -> &'static str {
    match v {
        Visibility::Public => "public ", Visibility::Private => "private ",
        Visibility::Protected => "protected ", Visibility::Package => "internal ",
        _ => "",
    }
}
