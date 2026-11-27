use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::compile::expr_emit::{ExprEmitCtx, emit_expr};
use crate::compile::kotlin_dart::{dart_dec_arg, dart_has_attr, dart_has_dec, emit_dart_enum, emit_dart_type, emit_dart_type_params};
use crate::compile::stmt_common::emit_brace_stmts;
use crate::ir::{AiceItem, AiceModule, TranspileError};
use crate::ir_code::{AccessorKind, ClassDecl, Expr, FnBody, FnDecl, MethodDecl, PropDecl};
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
            AiceItem::Enum(ed) => emit_dart_enum(&mut ec, ed),
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
    let tps = emit_dart_type_params(&cd.type_params);
    let with_cl = dart_dec_arg(cd, "with").map(|w| format!(" with {w}")).unwrap_or_default();
    let mut imps: Vec<String> = cd.implements.iter().map(|s| s.replace("::", ".")).collect();
    if let Some(raw_i) = dart_dec_arg(cd, "implements") { imps.push(raw_i.to_string()); }
    let imp_cl = if imps.is_empty() { String::new() } else { format!(" implements {}", imps.join(", ")) };

    if dart_has_dec(cd, "enum") {
        ec.line(&format!("enum {}{tps}{with_cl}{imp_cl} {{", cd.name));
        ec.push();
        let variants: Vec<&PropDecl> = cd.props.iter().filter(|p| dart_has_attr(&p.trivia, "variant")).collect();
        let fields: Vec<&PropDecl> = cd.props.iter().filter(|p| !dart_has_attr(&p.trivia, "variant")).collect();
        let has_body = !fields.is_empty() || !cd.methods.is_empty();
        for (idx, v) in variants.iter().enumerate() {
            let entry = match &v.init {
                Some(Expr::Call { args, .. }) => {
                    let a: Vec<String> = args.iter().map(|e| emit_expr(e, LanguageId::Dart, ectx)).collect();
                    format!("{}({})", v.name, a.join(", "))
                }
                Some(e) => format!("{}({})", v.name, emit_expr(e, LanguageId::Dart, ectx)),
                None => v.name.clone(),
            };
            let sep = if idx + 1 == variants.len() { if has_body { ";" } else { "" } } else { "," };
            ec.line(&format!("{entry}{sep}"));
        }
        emit_dart_props(ec, &fields, ectx);
        for m in &cd.methods { emit_dart_method(ec, m, &cd.name, &cd.props, false, ectx); }
        ec.pop();
        ec.line("}");
        return;
    }

    if let Some(target) = dart_dec_arg(cd, "extension") {
        let nm = if cd.name == "_" { String::new() } else { format!(" {}", cd.name) };
        ec.line(&format!("extension{nm}{tps} on {target} {{"));
    } else if dart_has_dec(cd, "mixin") {
        let on_cl = dart_dec_arg(cd, "on").map(|o| format!(" on {o}")).unwrap_or_default();
        ec.line(&format!("mixin {}{tps}{on_cl}{imp_cl} {{", cd.name));
    } else {
        let abs = if cd.is_abstract { "abstract " } else { "" };
        let ext = cd.extends.as_ref().map(|e| format!(" extends {}", e.replace("::", ".")))
            .or_else(|| dart_dec_arg(cd, "extends").map(|e| format!(" extends {e}")))
            .unwrap_or_default();
        ec.line(&format!("{abs}class {}{tps}{ext}{with_cl}{imp_cl} {{", cd.name));
    }
    ec.push();
    let all_props: Vec<&PropDecl> = cd.props.iter().collect();
    emit_dart_props(ec, &all_props, ectx);
    for m in &cd.methods { emit_dart_method(ec, m, &cd.name, &cd.props, cd.is_abstract, ectx); }
    ec.pop();
    ec.line("}");
}

fn emit_dart_props(ec: &mut EmitCtx, props: &[&PropDecl], ectx: &ExprEmitCtx) {
    for p in props {
        let st = if p.is_static { "static " } else { "" };
        let fin = if p.is_readonly { "final " } else { "" };
        let t = p.ty.as_ref().map(emit_dart_type).unwrap_or_else(|| "dynamic".into());
        let init = p.init.as_ref().map(|e| format!(" = {}", emit_expr(e, LanguageId::Dart, ectx))).unwrap_or_default();
        ec.line(&format!("{st}{fin}{t} {}{init};", p.name));
    }
}

fn emit_dart_method(ec: &mut EmitCtx, m: &MethodDecl, cls_name: &str, props: &[PropDecl], cls_abs: bool, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&m.trivia, CommentStyle::Slash);
    let is_ctor = m.accessor == AccessorKind::Constructor;
    let ps = emit_dart_params(&m.params, is_ctor, props, ectx);
    let st = if m.is_static { "static " } else { "" };
    let mtps = emit_dart_type_params(&m.type_params);
    if is_ctor {
        let cst = if m.is_const { "const " } else { "" };
        if matches!(m.body, FnBody::SignatureOnly) {
            ec.line(&format!("{cst}{cls_name}({ps});"));
            return;
        }
        ec.line(&format!("{cst}{cls_name}({ps}) {{"));
    } else {
        let rt = m.return_type.as_ref().map(emit_dart_type).unwrap_or_else(|| "void".into());
        let sig = match m.accessor {
            AccessorKind::Get => format!("{st}{rt} get {}", m.name),
            AccessorKind::Set => format!("{st}set {}({ps})", m.name),
            _ => format!("{st}{rt} {}{mtps}({ps})", m.name),
        };
        if cls_abs && matches!(m.body, FnBody::SignatureOnly) {
            ec.line(&format!("{sig};"));
            return;
        }
        if let FnBody::Expr(e) = &m.body && rt == "void" {
            ec.line(&format!("{sig} => {};", emit_expr(e, LanguageId::Dart, ectx)));
            return;
        }
        ec.line(&format!("{sig} {{"));
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
    let rt = f.return_type.as_ref().map(emit_dart_type).unwrap_or_else(|| "void".into());
    let tps = emit_dart_type_params(&f.type_params);
    let ps = emit_dart_params(&f.params, false, &[], ectx);
    if let FnBody::Expr(e) = &f.body && rt == "void" {
        ec.line(&format!("{rt} {}{tps}({ps}) => {};", f.name, emit_expr(e, LanguageId::Dart, ectx)));
        return;
    }
    ec.line(&format!("{rt} {}{tps}({ps}) {{", f.name));
    ec.push();
    match &f.body {
        FnBody::SignatureOnly => {}
        FnBody::Expr(e) => ec.line(&format!("return {};", emit_expr(e, LanguageId::Dart, ectx))),
        FnBody::Block(stmts) => emit_brace_stmts(stmts, LanguageId::Dart, ec, ectx, false),
    }
    ec.pop();
    ec.line("}");
}

fn emit_dart_params(params: &[ParamDecl], is_ctor: bool, props: &[PropDecl], ectx: &ExprEmitCtx) -> String {
    let mut req_pos = Vec::new();
    let mut opt_pos = Vec::new();
    let mut named = Vec::new();
    for p in params {
        let base = if is_ctor && p.ty.is_none() && (p.is_readonly || props.iter().any(|pr| pr.name == p.name)) {
            format!("this.{}", p.name)
        } else if p.name.starts_with("this.") {
            p.name.clone()
        } else if let Some(ref ty) = p.ty {
            format!("{} {}", emit_dart_type(ty), p.name)
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
