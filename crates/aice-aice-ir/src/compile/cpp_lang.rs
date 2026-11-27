use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::compile::expr_emit::{ExprEmitCtx, emit_expr};
use crate::compile::stmt_common::emit_brace_stmts;
use crate::compile::type_map::emit_type;
use crate::ir::{AiceItem, AiceModule, TranspileError, Trivia, TriviaKind, Visibility};
use crate::ir_code::{AccessorKind, ClassDecl, FnBody, FnDecl, MethodDecl};
use crate::ir_types::{EnumDecl, ParamDecl, TypeParam};

pub fn compile(module: &AiceModule) -> Result<String, TranspileError> {
    if module.items.is_empty() && !module.raw_fallback.is_empty() {
        return Ok(module.raw_fallback.clone());
    }
    let ectx = ExprEmitCtx::from_module(module);
    let mut ec = EmitCtx::new("    ");
    ec.emit_trivia(&module.module_trivia, CommentStyle::Slash);

    for item in &module.items {
        if let AiceItem::Import(imp) = item {
            let inc = if imp.source.starts_with('<') || imp.source.starts_with('"') {
                imp.source.clone()
            } else {
                format!("<{}>", imp.source)
            };
            ec.line(&format!("#include {inc}"));
        }
    }
    let has_ns = !module.module_name.is_empty() && module.module_name != "module" && module.module_name != "cpp";
    if has_ns {
        ec.blank();
        ec.line(&format!("namespace {} {{", module.module_name));
    }
    for item in &module.items {
        match item {
            AiceItem::Class(cd) => emit_cpp_class(&mut ec, cd, &ectx),
            AiceItem::Enum(ed) => emit_cpp_enum(&mut ec, ed, &ectx),
            AiceItem::Fn(fd) => emit_cpp_fn(&mut ec, fd, &ectx),
            AiceItem::Directive { text, trivia, .. } => {
                let t = text.trim();
                if t == "}" || (t.starts_with("namespace") && t.ends_with('{')) {
                    ec.blank();
                    ec.emit_trivia(trivia, CommentStyle::Slash);
                    ec.line(t);
                } else if (t.starts_with("enum ") || t.starts_with("using ") || t.starts_with("typedef ")
                    || t.starts_with("struct ") || t.starts_with("class ")) && !t.ends_with(';')
                {
                    ec.emit_trivia(trivia, CommentStyle::Slash);
                    ec.line(&format!("{t};"));
                } else {
                    ec.emit_trivia(trivia, CommentStyle::Slash);
                    ec.line(text);
                }
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

fn cpp_attr_arg<'a>(tr: &'a Trivia, prefix: &str) -> Option<&'a str> {
    tr.leading.iter().find_map(|c| {
        if c.kind != TriviaKind::Attribute { return None; }
        c.text.trim().trim_start_matches('@').strip_prefix(prefix)?.strip_prefix('(')?.strip_suffix(')')
    })
}

fn emit_cpp_enum(ec: &mut EmitCtx, ed: &EnumDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&ed.trivia, CommentStyle::Slash);
    let scope = if cpp_has_attr(&ed.trivia, "class") { "class " }
        else if cpp_has_attr(&ed.trivia, "struct") { "struct " }
        else { "" };
    let base = cpp_attr_arg(&ed.trivia, "base").map(|b| format!(" : {b}")).unwrap_or_default();
    let inline = ed.variants.len() <= 4 && ed.variants.iter().all(|v| v.trivia.is_empty());
    if inline {
        let items: Vec<String> = ed.variants.iter().map(|v| match &v.discriminant {
            Some(d) => format!("{} = {}", v.name, emit_expr(d, LanguageId::Cpp, ectx)),
            None => v.name.clone(),
        }).collect();
        ec.line(&format!("enum {scope}{}{base} {{ {} }};", ed.name, items.join(", ")));
        return;
    }
    ec.line(&format!("enum {scope}{}{base} {{", ed.name));
    ec.push();
    for (i, v) in ed.variants.iter().enumerate() {
        ec.emit_trivia(&v.trivia, CommentStyle::Slash);
        let comma = if i + 1 < ed.variants.len() { "," } else { "" };
        match &v.discriminant {
            Some(d) => ec.line(&format!("{} = {}{comma}", v.name, emit_expr(d, LanguageId::Cpp, ectx))),
            None => ec.line(&format!("{}{comma}", v.name)),
        }
    }
    ec.pop();
    ec.line("};");
}

fn cpp_has_attr(tr: &Trivia, name: &str) -> bool {
    tr.leading.iter().any(|c| c.kind == TriviaKind::Attribute && c.text.trim().trim_start_matches('@') == name)
}

fn emit_cpp_class(ec: &mut EmitCtx, cd: &ClassDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&cd.trivia, CommentStyle::Slash);
    emit_cpp_template_hdr(ec, &cd.type_params);
    let mut bases = Vec::new();
    if let Some(ref ext) = cd.extends { bases.push(format!("public {ext}")); }
    for imp in &cd.implements { bases.push(format!("public {imp}")); }
    let base_clause = if bases.is_empty() { String::new() } else { format!(" : {}", bases.join(", ")) };
    ec.line(&format!("class {}{base_clause} {{", cd.name));
    let mut cur_vis = Visibility::Private;
    let switch_vis = |ec: &mut EmitCtx, cur: &mut Visibility, target: Visibility| {
        if *cur != target {
            *cur = target;
            let lbl = match target {
                Visibility::Public => "public:",
                Visibility::Protected => "protected:",
                _ => "private:",
            };
            ec.line(lbl);
        }
    };
    for m in &cd.methods {
        let v = if m.vis == Visibility::Default { Visibility::Public } else { m.vis };
        switch_vis(ec, &mut cur_vis, v);
        ec.push();
        emit_cpp_method(ec, m, &cd.name, ectx);
        ec.pop();
    }
    for p in &cd.props {
        let v = if p.vis == Visibility::Default { Visibility::Private } else { p.vis };
        switch_vis(ec, &mut cur_vis, v);
        ec.push();
        let t = p.ty.as_ref().map(|x| emit_type(x, LanguageId::Cpp)).unwrap_or_else(|| "auto".into());
        match &p.init {
            Some(e) => {
                let val = emit_expr(e, LanguageId::Cpp, ectx);
                if val.starts_with('{') && val.ends_with('}') {
                    ec.line(&format!("{t} {}{val};", p.name));
                } else {
                    ec.line(&format!("{t} {} = {val};", p.name));
                }
            }
            None => ec.line(&format!("{t} {};", p.name)),
        }
        ec.pop();
    }
    ec.line("};");
}

fn emit_cpp_method(ec: &mut EmitCtx, m: &MethodDecl, cls_name: &str, ectx: &ExprEmitCtx) {
    ec.emit_trivia(&m.trivia, CommentStyle::Slash);
    emit_cpp_template_hdr(ec, &m.type_params);
    let ps = emit_cpp_params(&m.params);
    let is_virtual = cpp_has_attr(&m.trivia, "virtual");
    let is_pure = cpp_has_attr(&m.trivia, "pure");
    let is_override = cpp_has_attr(&m.trivia, "override");
    let is_final = cpp_has_attr(&m.trivia, "final");
    let st = if m.is_static { "static " } else { "" };
    let virt = if is_virtual || is_pure { "virtual " } else { "" };
    let ovr = if is_override { " override" } else { "" };
    let fin = if is_final { " final" } else { "" };
    let sig = if m.accessor == AccessorKind::Constructor {
        format!("explicit {cls_name}({ps})")
    } else if m.name.starts_with('~') {
        format!("{virt}{}({ps}){ovr}{fin}", m.name)
    } else {
        let rt = m.return_type.as_ref().map(|t| emit_type(t, LanguageId::Cpp)).unwrap_or_else(|| "void".into());
        let cst = if m.is_const { " const" } else { "" };
        format!("{st}{virt}{rt} {}({ps}){cst}{ovr}{fin}", m.name)
    };
    if m.body == FnBody::SignatureOnly {
        if is_pure {
            ec.line(&format!("{sig} = 0;"));
        } else {
            ec.line(&format!("{sig};"));
        }
        return;
    }
    ec.line(&format!("{sig} {{"));
    ec.push();
    match &m.body {
        FnBody::SignatureOnly => {}
        FnBody::Expr(e) => ec.line(&format!("return {};", emit_expr(e, LanguageId::Cpp, ectx))),
        FnBody::Block(stmts) => emit_brace_stmts(stmts, LanguageId::Cpp, ec, ectx, false),
    }
    ec.pop();
    ec.line("}");
}

fn emit_cpp_fn(ec: &mut EmitCtx, f: &FnDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&f.trivia, CommentStyle::Slash);
    emit_cpp_template_hdr(ec, &f.type_params);
    let rt = f.return_type.as_ref().map(|t| emit_type(t, LanguageId::Cpp)).unwrap_or_else(|| "void".into());
    let ps = emit_cpp_params(&f.params);
    ec.line(&format!("{rt} {}({ps}) {{", f.name));
    ec.push();
    match &f.body {
        FnBody::SignatureOnly => {}
        FnBody::Expr(e) => ec.line(&format!("return {};", emit_expr(e, LanguageId::Cpp, ectx))),
        FnBody::Block(stmts) => emit_brace_stmts(stmts, LanguageId::Cpp, ec, ectx, false),
    }
    ec.pop();
    ec.line("}");
}

fn emit_cpp_params(params: &[ParamDecl]) -> String {
    params.iter().map(|p| {
        let t = p.ty.as_ref().map(|x| emit_type(x, LanguageId::Cpp)).unwrap_or_else(|| "auto".into());
        format!("{t} {}", p.name)
    }).collect::<Vec<_>>().join(", ")
}

fn emit_cpp_template_hdr(ec: &mut EmitCtx, tps: &[TypeParam]) {
    if tps.is_empty() { return; }
    let ps: Vec<String> = tps.iter().map(|tp| format!("typename {}", tp.name)).collect();
    ec.line(&format!("template <{}>", ps.join(", ")));
}
