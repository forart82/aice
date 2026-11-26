use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::compile::expr_emit::{ExprEmitCtx, emit_expr};
use crate::compile::stmt_common::emit_brace_stmts;
use crate::compile::type_map::emit_type;
use crate::ir::{AiceItem, AiceModule, ImportDecl, TranspileError, Visibility};
use crate::ir_code::{AccessorKind, ClassDecl, FnBody, FnDecl, MethodDecl};
use crate::ir_domain::{ComponentDecl, LayoutNode};
use crate::ir_types::{EnumDecl, ParamDecl, TypeDecl, TypeKind, TypeParam};

pub fn compile(module: &AiceModule, target: LanguageId) -> Result<String, TranspileError> {
    if module.items.is_empty() && !module.raw_fallback.is_empty() {
        return Ok(module.raw_fallback.clone());
    }
    let is_js = target == LanguageId::JavaScript;
    let ectx = ExprEmitCtx::from_module(module);
    let mut ec = EmitCtx::new("  ");
    ec.emit_trivia(&module.module_trivia, CommentStyle::Slash);

    for item in &module.items {
        match item {
            AiceItem::Import(imp) => emit_import(&mut ec, imp, is_js),
            AiceItem::Type(td) => if !is_js { emit_type_decl(&mut ec, td, target); },
            AiceItem::Enum(ed) => if !is_js { emit_enum_decl(&mut ec, ed, target, &ectx); },
            AiceItem::Class(cd) => emit_class_decl(&mut ec, cd, target, &ectx),
            AiceItem::Fn(fd) => emit_fn_decl(&mut ec, fd, target, &ectx),
            AiceItem::Const(cd) => {
                ec.emit_trivia(&cd.trivia, CommentStyle::Slash);
                let exp = if cd.vis == Visibility::Public { "export " } else { "" };
                let ty = if !is_js { cd.ty.as_ref().map(|t| format!(": {}", emit_type(t, target))).unwrap_or_default() } else { String::new() };
                ec.line(&format!("{exp}const {}{ty} = {};", cd.name, emit_expr(&cd.value, target, &ectx)));
            }
            AiceItem::Var(vd) => {
                ec.emit_trivia(&vd.trivia, CommentStyle::Slash);
                let exp = if vd.vis == Visibility::Public { "export " } else { "" };
                let kw = if vd.is_mut { "let" } else { "const" };
                let ty = if !is_js { vd.ty.as_ref().map(|t| format!(": {}", emit_type(t, target))).unwrap_or_default() } else { String::new() };
                ec.line(&format!("{exp}{kw} {}{ty} = {};", vd.name, emit_expr(&vd.value, target, &ectx)));
            }
            AiceItem::Component(comp) => emit_component(&mut ec, comp, target, &ectx),
            AiceItem::Directive { text, trivia, .. } => {
                ec.emit_trivia(trivia, CommentStyle::Slash);
                ec.line(text);
            }
            _ => {}
        }
    }
    Ok(ec.out)
}

fn emit_import(ec: &mut EmitCtx, imp: &ImportDecl, is_js: bool) {
    ec.emit_trivia(&imp.trivia, CommentStyle::Slash);
    if imp.specifiers.is_empty() {
        ec.line(&format!("import \"{}\";", imp.source));
        return;
    }
    if imp.specifiers.len() == 1 && imp.specifiers[0].is_wildcard {
        let a = imp.specifiers[0].alias.as_deref().unwrap_or("ns");
        ec.line(&format!("import * as {a} from \"{}\";", imp.source));
        return;
    }
    let defs: Vec<_> = imp.specifiers.iter().filter(|s| s.is_default).collect();
    let named: Vec<String> = imp.specifiers.iter().filter(|s| !s.is_default && !(is_js && s.is_type)).map(|s| {
        let tp = if s.is_type && !is_js { "type " } else { "" };
        match &s.alias { Some(a) => format!("{tp}{} as {a}", s.name), None => format!("{tp}{}", s.name) }
    }).collect();
    if is_js && imp.is_type_only && defs.is_empty() && named.is_empty() { return; }
    let mut parts = Vec::new();
    if let Some(d) = defs.first() { parts.push(d.alias.clone().unwrap_or_else(|| d.name.clone())); }
    if !named.is_empty() { parts.push(format!("{{ {} }}", named.join(", "))); }
    ec.line(&format!("import {} from \"{}\";", parts.join(", "), imp.source));
}

fn emit_type_decl(ec: &mut EmitCtx, td: &TypeDecl, target: LanguageId) {
    ec.blank();
    ec.emit_trivia(&td.trivia, CommentStyle::Slash);
    let exp = if td.vis == Visibility::Public { "export " } else { "" };
    let tps = emit_ts_type_params(&td.type_params, target);
    if td.kind == TypeKind::Alias {
        let rhs = td.alias_target.as_ref().map(|t| emit_type(t, target)).unwrap_or_else(|| "unknown".into());
        ec.line(&format!("{exp}type {}{tps} = {rhs};", td.name));
        return;
    }
    ec.line(&format!("{exp}interface {}{tps} {{", td.name));
    ec.push();
    for f in &td.fields {
        let opt = if f.is_optional { "?" } else { "" };
        let ro = if f.is_readonly { "readonly " } else { "" };
        let t = f.ty.as_ref().map(|x| emit_type(x, target)).unwrap_or_else(|| "any".into());
        ec.line(&format!("{ro}{}{opt}: {t};", f.name));
    }
    for m in &td.methods {
        let mtps = emit_ts_type_params(&m.type_params, target);
        let ps = emit_ts_params(&m.params, target, false);
        let rt = m.return_type.as_ref().map(|t| format!(": {}", emit_type(t, target))).unwrap_or_default();
        ec.line(&format!("{}{mtps}({ps}){rt};", m.name));
    }
    ec.pop();
    ec.line("}");
}

fn emit_enum_decl(ec: &mut EmitCtx, ed: &EnumDecl, target: LanguageId, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&ed.trivia, CommentStyle::Slash);
    let exp = if ed.vis == Visibility::Public { "export " } else { "" };
    ec.line(&format!("{exp}enum {} {{", ed.name));
    ec.push();
    for v in &ed.variants {
        match &v.discriminant {
            Some(d) => ec.line(&format!("{} = {},", v.name, emit_expr(d, target, ectx))),
            None => ec.line(&format!("{},", v.name)),
        }
    }
    ec.pop();
    ec.line("}");
}

fn emit_class_decl(ec: &mut EmitCtx, cd: &ClassDecl, target: LanguageId, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&cd.trivia, CommentStyle::Slash);
    let is_js = target == LanguageId::JavaScript;
    let exp = if cd.vis == Visibility::Public { "export " } else { "" };
    let abs = if cd.is_abstract && !is_js { "abstract " } else { "" };
    let tps = if is_js { String::new() } else { emit_ts_type_params(&cd.type_params, target) };
    let ext = cd.extends.as_ref().map(|e| format!(" extends {e}")).unwrap_or_default();
    let imp = if cd.implements.is_empty() || is_js { String::new() } else { format!(" implements {}", cd.implements.join(", ")) };
    ec.line(&format!("{exp}{abs}class {}{tps}{ext}{imp} {{", cd.name));
    ec.push();
    for p in &cd.props {
        ec.emit_trivia(&p.trivia, CommentStyle::Slash);
        let pv = if is_js { "" } else { ts_vis(p.vis) };
        let st = if p.is_static { "static " } else { "" };
        let ro = if p.is_readonly && !is_js { "readonly " } else { "" };
        let ty = if !is_js { p.ty.as_ref().map(|t| format!(": {}", emit_type(t, target))).unwrap_or_default() } else { String::new() };
        let init = p.init.as_ref().map(|e| format!(" = {}", emit_expr(e, target, ectx))).unwrap_or_default();
        ec.line(&format!("{pv}{st}{ro}{}{ty}{init};", p.name));
    }
    if !cd.primary_ctor.is_empty() {
        let ps = emit_ts_params(&cd.primary_ctor, target, !is_js);
        ec.line(&format!("constructor({ps}) {{}}"));
    }
    for m in &cd.methods { emit_method(ec, m, target, ectx); }
    ec.pop();
    ec.line("}");
}

fn emit_method(ec: &mut EmitCtx, m: &MethodDecl, target: LanguageId, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&m.trivia, CommentStyle::Slash);
    let is_js = target == LanguageId::JavaScript;
    let vis = if is_js || m.accessor == AccessorKind::Constructor { "" } else { ts_vis(m.vis) };
    let st = if m.is_static { "static " } else { "" };
    let asy = if m.is_async { "async " } else { "" };
    let mtps = if !is_js && m.accessor != AccessorKind::Constructor { emit_ts_type_params(&m.type_params, target) } else { String::new() };
    let ps = emit_ts_params(&m.params, target, !is_js);
    let rt = if !is_js && m.accessor != AccessorKind::Constructor {
        m.return_type.as_ref().map(|t| format!(": {}", emit_type(t, target))).unwrap_or_default()
    } else { String::new() };
    ec.line(&format!("{vis}{st}{asy}{}{mtps}({ps}){rt} {{", m.name));
    ec.push();
    emit_fn_body(ec, &m.body, target, ectx);
    ec.pop();
    ec.line("}");
}

fn emit_fn_decl(ec: &mut EmitCtx, f: &FnDecl, target: LanguageId, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&f.trivia, CommentStyle::Slash);
    let is_js = target == LanguageId::JavaScript;
    let exp = if f.vis == Visibility::Public { "export " } else { "" };
    let asy = if f.is_async { "async " } else { "" };
    let tps = if is_js { String::new() } else { emit_ts_type_params(&f.type_params, target) };
    let ps = emit_ts_params(&f.params, target, !is_js);
    let rt = if !is_js { f.return_type.as_ref().map(|t| format!(": {}", emit_type(t, target))).unwrap_or_default() } else { String::new() };
    ec.line(&format!("{exp}{asy}function {}{tps}({ps}){rt} {{", f.name));
    ec.push();
    emit_fn_body(ec, &f.body, target, ectx);
    ec.pop();
    ec.line("}");
}

fn emit_fn_body(ec: &mut EmitCtx, body: &FnBody, target: LanguageId, ectx: &ExprEmitCtx) {
    match body {
        FnBody::SignatureOnly => {}
        FnBody::Expr(e) => ec.line(&format!("return {};", emit_expr(e, target, ectx))),
        FnBody::Block(stmts) => emit_brace_stmts(stmts, target, ec, ectx, false),
    }
}

fn emit_component(ec: &mut EmitCtx, comp: &ComponentDecl, target: LanguageId, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&comp.trivia, CommentStyle::Slash);
    let exp = if comp.vis == Visibility::Public { "export " } else { "" };
    let ps = emit_ts_params(&comp.params, target, target != LanguageId::JavaScript);
    ec.line(&format!("{exp}function {}({ps}) {{", comp.name));
    ec.push();
    ec.line("return (");
    ec.push();
    for node in &comp.layout { emit_jsx_node(ec, node, target, ectx); }
    ec.pop();
    ec.line(");");
    ec.pop();
    ec.line("}");
}

fn emit_jsx_node(ec: &mut EmitCtx, root: &LayoutNode, target: LanguageId, ectx: &ExprEmitCtx) {
    enum JOp<'a> { Node(&'a LayoutNode), Close(String) }
    let mut tasks = vec![JOp::Node(root)];
    while let Some(op) = tasks.pop() {
        match op {
            JOp::Close(tag) => { ec.pop(); ec.line(&format!("</{tag}>")); }
            JOp::Node(node) => {
                let LayoutNode::Element { tag, attrs, text, child_expr, children, .. } = node else { continue };
                if tag == "#text" {
                    if let Some(t) = text { ec.line(t); }
                    continue;
                }
                if tag == "#expr" {
                    if let Some(ex) = child_expr { ec.line(&format!("{{{}}}", emit_expr(ex, target, ectx))); }
                    continue;
                }
                let mut attr_s = String::new();
                for a in attrs {
                    match &a.value {
                        Some(crate::ir_code::Expr::Literal(crate::ir_code::LiteralVal::Str { value, .. })) => {
                            attr_s.push_str(&format!(" {}=\"{value}\"", a.name));
                        }
                        Some(ex) => attr_s.push_str(&format!(" {}={{{}}}", a.name, emit_expr(ex, target, ectx))),
                        None => attr_s.push_str(&format!(" {}", a.name)),
                    }
                }
                if let Some(t) = text { ec.line(&format!("<{tag}{attr_s}>{t}</{tag}>")); }
                else if let Some(ex) = child_expr { ec.line(&format!("<{tag}{attr_s}>{{{}}}</{tag}>", emit_expr(ex, target, ectx))); }
                else if children.is_empty() { ec.line(&format!("<{tag}{attr_s} />")); }
                else {
                    ec.line(&format!("<{tag}{attr_s}>"));
                    ec.push();
                    tasks.push(JOp::Close(tag.clone()));
                    for ch in children.iter().rev() { tasks.push(JOp::Node(ch)); }
                }
            }
        }
    }
}

fn emit_ts_params(params: &[ParamDecl], target: LanguageId, include_types: bool) -> String {
    params.iter().map(|p| {
        let mut s = if p.is_rest { "...".into() } else { String::new() };
        s.push_str(&p.name);
        if p.is_optional && include_types { s.push('?'); }
        if include_types && let Some(ref ty) = p.ty { s.push_str(&format!(": {}", emit_type(ty, target))); }
        if let Some(ref def) = p.default {
            s.push_str(&format!(" = {}", emit_expr(def, target, &ExprEmitCtx { class_names: Default::default() })));
        }
        s
    }).collect::<Vec<_>>().join(", ")
}

fn ts_vis(v: Visibility) -> &'static str {
    match v {
        Visibility::Public => "public ", Visibility::Private => "private ",
        Visibility::Protected => "protected ", _ => "",
    }
}

fn emit_ts_type_params(tps: &[TypeParam], target: LanguageId) -> String {
    if tps.is_empty() { return String::new(); }
    let items: Vec<String> = tps.iter().map(|tp| {
        let mut s = tp.name.clone();
        if !tp.bounds.is_empty() {
            let bs: Vec<String> = tp.bounds.iter().map(|b| emit_type(b, target)).collect();
            s.push_str(&format!(" extends {}", bs.join(" & ")));
        }
        if let Some(ref d) = tp.default { s.push_str(&format!(" = {}", emit_type(d, target))); }
        s
    }).collect();
    format!("<{}>", items.join(", "))
}
