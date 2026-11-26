use std::collections::HashMap;

use aice_lang_registry::LanguageId;

use crate::compile::csharp_java::{emit_java_type_params, has_attr, java_nested_parent, parse_nested_tag};
use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::compile::expr_emit::{ExprEmitCtx, emit_expr};
use crate::compile::stmt_common::emit_brace_stmts;
use crate::compile::type_map::emit_type;
use crate::ir::{AiceItem, AiceModule, TranspileError, Visibility};
use crate::ir_code::{AccessorKind, ClassDecl, Expr, FnBody, FnDecl, MethodDecl, PropDecl, Stmt};
use crate::ir_types::{EnumDecl, ParamDecl, TypeDecl};

enum JavaNested<'a> {
    Class(&'a ClassDecl),
    Enum(&'a EnumDecl),
    Type(&'a TypeDecl),
}

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
    let mut nested_map: HashMap<String, Vec<JavaNested<'_>>> = HashMap::new();
    let mut top_names: Vec<String> = Vec::new();
    let mut pending_parent: Option<&str> = None;
    for item in &module.items {
        match item {
            AiceItem::Directive { text, .. } => {
                pending_parent = parse_nested_tag(text);
            }
            AiceItem::Class(cd) => {
                if let Some(p) = java_nested_parent(cd).or(pending_parent.take()) {
                    nested_map.entry(p.to_string()).or_default().push(JavaNested::Class(cd));
                } else {
                    top_names.push(cd.name.clone());
                }
            }
            AiceItem::Enum(ed) => {
                if let Some(p) = pending_parent.take() {
                    nested_map.entry(p.to_string()).or_default().push(JavaNested::Enum(ed));
                } else {
                    top_names.push(ed.name.clone());
                }
            }
            AiceItem::Type(td) => {
                if let Some(p) = pending_parent.take() {
                    nested_map.entry(p.to_string()).or_default().push(JavaNested::Type(td));
                } else {
                    top_names.push(td.name.clone());
                }
            }
            _ => { pending_parent = None; }
        }
    }
    let has_root = |parent: &str| {
        let root = parent.split('.').next().unwrap_or(parent);
        top_names.iter().any(|n| n == root)
    };
    let mut top_fns: Vec<&FnDecl> = Vec::new();
    let mut pending_parent: Option<&str> = None;
    for item in &module.items {
        match item {
            AiceItem::Directive { text, .. } => {
                if parse_nested_tag(text).is_some() {
                    pending_parent = parse_nested_tag(text);
                } else {
                    pending_parent = None;
                }
            }
            AiceItem::Class(cd) => {
                if let Some(p) = java_nested_parent(cd).or(pending_parent.take())
                    && has_root(p)
                {
                    continue;
                }
                emit_java_class(&mut ec, cd, &cd.name, &nested_map, &ectx);
            }
            AiceItem::Enum(ed) => {
                if let Some(p) = pending_parent.take() && has_root(p) { continue; }
                emit_java_enum(&mut ec, ed);
            }
            AiceItem::Type(td) => {
                if let Some(p) = pending_parent.take() && has_root(p) { continue; }
                emit_java_interface(&mut ec, td);
            }
            AiceItem::Fn(fd) => { pending_parent = None; top_fns.push(fd); }
            _ => { pending_parent = None; }
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
    let tps = emit_java_type_params(&f.type_params);
    let tps_sp = if tps.is_empty() { String::new() } else { format!("{tps} ") };
    let rt = f.return_type.as_ref().map(|t| emit_type(t, LanguageId::Java)).unwrap_or_else(|| "void".into());
    let vis = if f.vis == Visibility::Default { "public " } else { j_vis(f.vis) };
    ec.line(&format!("{vis}static {tps_sp}{rt} {}({ps}) {{", f.name));
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
    let tps = emit_java_type_params(&td.type_params);
    ec.line(&format!("{}interface {}{tps} {{", j_vis(td.vis), td.name));
    ec.push();
    for m in &td.methods {
        let ps = emit_j_params(&m.params);
        let mtps = emit_java_type_params(&m.type_params);
        let mtps_sp = if mtps.is_empty() { String::new() } else { format!("{mtps} ") };
        let rt = m.return_type.as_ref().map(|t| emit_type(t, LanguageId::Java)).unwrap_or_else(|| "void".into());
        ec.line(&format!("{mtps_sp}{rt} {}({ps});", m.name));
    }
    ec.pop();
    ec.line("}");
}

fn emit_java_prop(ec: &mut EmitCtx, p: &PropDecl, ectx: &ExprEmitCtx) {
    ec.emit_trivia(&p.trivia, CommentStyle::Slash);
    let st = if p.is_static { "static " } else { "" };
    let fin = if p.is_readonly { "final " } else { "" };
    let t = p.ty.as_ref().map(|x| emit_type(x, LanguageId::Java)).unwrap_or_else(|| "Object".into());
    let init = p.init.as_ref().map(|e| format!(" = {}", emit_expr(e, LanguageId::Java, ectx))).unwrap_or_default();
    ec.line(&format!("{}{st}{fin}{t} {}{init};", j_vis(p.vis), p.name));
}

fn emit_java_static_blocks(ec: &mut EmitCtx, blocks: &[Vec<Stmt>], ectx: &ExprEmitCtx) {
    for sb in blocks {
        ec.blank();
        ec.line("static {");
        ec.push();
        emit_brace_stmts(sb, LanguageId::Java, ec, ectx, false);
        ec.pop();
        ec.line("}");
    }
}

fn emit_java_class(ec: &mut EmitCtx, cd: &ClassDecl, path: &str, nested: &HashMap<String, Vec<JavaNested<'_>>>, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&cd.trivia, CommentStyle::Slash);
    let has_dec = |k: &str| cd.decorators.iter().any(|d| d.trim_start_matches('@') == k);
    let kids = nested.get(path).map(Vec::as_slice).unwrap_or(&[]);
    if has_dec("enum") {
        let imp = if cd.implements.is_empty() { String::new() } else { format!(" implements {}", cd.implements.join(", ")) };
        ec.line(&format!("{}enum {}{imp} {{", j_vis(cd.vis), cd.name));
        ec.push();
        let variants: Vec<&PropDecl> = cd.props.iter().filter(|p| has_attr(&p.trivia, "variant")).collect();
        let fields: Vec<&PropDecl> = cd.props.iter().filter(|p| !has_attr(&p.trivia, "variant")).collect();
        let has_body = !fields.is_empty() || !cd.static_blocks.is_empty() || !cd.methods.is_empty() || !kids.is_empty();
        for (idx, v) in variants.iter().enumerate() {
            let entry = match &v.init {
                Some(Expr::Call { args, .. }) => {
                    let a: Vec<String> = args.iter().map(|e| emit_expr(e, LanguageId::Java, ectx)).collect();
                    format!("{}({})", v.name, a.join(", "))
                }
                Some(e) => format!("{}({})", v.name, emit_expr(e, LanguageId::Java, ectx)),
                None => v.name.clone(),
            };
            let sep = if idx + 1 == variants.len() && has_body { ";" } else { "," };
            ec.line(&format!("{entry}{sep}"));
        }
        for p in fields { emit_java_prop(ec, p, ectx); }
        emit_java_static_blocks(ec, &cd.static_blocks, ectx);
        for m in &cd.methods { emit_java_method(ec, m, &cd.name, ectx); }
        emit_java_nested_kids(ec, path, kids, nested, ectx);
        ec.pop();
        ec.line("}");
        return;
    }
    let tps = emit_java_type_params(&cd.type_params);
    if has_dec("record") {
        let ctor = emit_j_params(&cd.primary_ctor);
        ec.line(&format!("{}record {}{tps}({ctor}) {{", j_vis(cd.vis), cd.name));
    } else {
        ec.line(&format!("{}class {}{tps} {{", j_vis(cd.vis), cd.name));
    }
    ec.push();
    for p in &cd.props { emit_java_prop(ec, p, ectx); }
    emit_java_static_blocks(ec, &cd.static_blocks, ectx);
    for m in &cd.methods { emit_java_method(ec, m, &cd.name, ectx); }
    emit_java_nested_kids(ec, path, kids, nested, ectx);
    ec.pop();
    ec.line("}");
}

fn emit_java_nested_kids(
    ec: &mut EmitCtx,
    path: &str,
    kids: &[JavaNested<'_>],
    nested: &HashMap<String, Vec<JavaNested<'_>>>,
    ectx: &ExprEmitCtx,
) {
    for kid in kids {
        match kid {
            JavaNested::Class(c) => emit_java_class(ec, c, &format!("{path}.{}", c.name), nested, ectx),
            JavaNested::Enum(e) => emit_java_enum(ec, e),
            JavaNested::Type(t) => emit_java_interface(ec, t),
        }
    }
}

fn emit_java_method(ec: &mut EmitCtx, m: &MethodDecl, cls_name: &str, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&m.trivia, CommentStyle::Slash);
    let ps = emit_j_params(&m.params);
    let tps = emit_java_type_params(&m.type_params);
    let tps_sp = if tps.is_empty() { String::new() } else { format!("{tps} ") };
    if m.accessor == AccessorKind::Constructor {
        ec.line(&format!("{}{tps_sp}{cls_name}({ps}) {{", j_vis(m.vis)));
    } else {
        let st = if m.is_static { "static " } else { "" };
        let rt = m.return_type.as_ref().map(|t| emit_type(t, LanguageId::Java)).unwrap_or_else(|| "void".into());
        ec.line(&format!("{}{st}{tps_sp}{rt} {}({ps}) {{", j_vis(m.vis), m.name));
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
