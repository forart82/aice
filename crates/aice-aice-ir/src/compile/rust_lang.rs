use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::compile::expr_emit::{ExprEmitCtx, emit_expr};
use crate::compile::rust_helpers::{
    emit_rs_all_hash_attrs, emit_rs_impl_assoc, emit_rs_trait_assoc, format_rs_fn_quals,
    format_rs_generics, format_rs_tuple_field_ty, format_rs_type_args, is_rs_assoc_attr,
    is_rs_raw_directive, rs_attr_arg,
};
use crate::compile::stmt_common::emit_brace_stmts;
use crate::compile::type_map::emit_type;
use crate::ir::{AiceItem, AiceModule, TranspileError, Trivia, TriviaKind, Visibility};
use crate::ir_code::{AccessorKind, ClassDecl, FnBody, FnDecl, MethodDecl, PropDecl};
use crate::ir_types::{AiceType, EnumDecl, ParamDecl, TypeDecl, TypeKind, VariantPayload};

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
                ec.emit_trivia(&imp.trivia, CommentStyle::Slash);
                ec.line(&format!("{}use {};", rs_vis(imp.vis), imp.source));
            }
            AiceItem::Type(td) => emit_type_decl(&mut ec, td, &ectx),
            AiceItem::Enum(ed) => emit_enum(&mut ec, ed),
            AiceItem::Class(cd) => emit_struct_impl(&mut ec, cd, &ectx),
            AiceItem::Fn(fd) => emit_fn(&mut ec, fd, &ectx),
            AiceItem::Const(cd) => {
                let ty = cd.ty.as_ref().map(|t| emit_type(t, LanguageId::Rust)).unwrap_or_else(|| "i64".into());
                ec.line(&format!("{}const {}: {ty} = {};", rs_vis(cd.vis), cd.name, emit_expr(&cd.value, LanguageId::Rust, &ectx)));
            }
            AiceItem::Var(vd) => {
                let ty = vd.ty.as_ref().map(|t| emit_type(t, LanguageId::Rust)).unwrap_or_else(|| "i64".into());
                let mt = if vd.is_mut { "mut " } else { "" };
                match &vd.value {
                    Some(v) => ec.line(&format!("{}static {mt}{}: {ty} = {};", rs_vis(vd.vis), vd.name, emit_expr(v, LanguageId::Rust, &ectx))),
                    None => ec.line(&format!("{}static {mt}{}: {ty};", rs_vis(vd.vis), vd.name)),
                }
            }
            AiceItem::Directive { text, trivia, .. } => {
                ec.emit_trivia(trivia, CommentStyle::Slash);
                if is_rs_raw_directive(text) {
                    ec.emit_raw_block(text.trim());
                } else {
                    ec.line(&format!("// {text}"));
                }
            }
            _ => {}
        }
    }
    Ok(ec.out)
}

fn emit_type_decl(ec: &mut EmitCtx, td: &TypeDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&td.trivia, CommentStyle::Slash);
    emit_rs_all_hash_attrs(ec, &td.trivia, &[]);
    let (gp, wh) = format_rs_generics(&td.type_params, &td.trivia, &[]);
    if td.kind == TypeKind::Alias {
        let rhs = td.alias_target.as_ref().map(|t| emit_type(t, LanguageId::Rust)).unwrap_or_else(|| "()".into());
        ec.line(&format!("{}type {}{gp}{wh} = {rhs};", rs_vis(td.vis), td.name));
        return;
    }
    if td.kind == TypeKind::Struct && has_trivia_attr(&td.trivia, "tuple") {
        let fs: Vec<String> = td.fields.iter().map(|f| format_rs_tuple_field(f.vis, f.ty.as_ref(), &f.trivia)).collect();
        ec.line(&format!("{}struct {}{gp}({}){wh};", rs_vis(td.vis), td.name, fs.join(", ")));
        return;
    }
    if td.kind == TypeKind::Struct && has_trivia_attr(&td.trivia, "unit") {
        ec.line(&format!("{}struct {}{gp}{wh};", rs_vis(td.vis), td.name));
        return;
    }
    let kw = if td.kind == TypeKind::Trait { "trait" } else { "struct" };
    let ext = if td.kind == TypeKind::Trait && !td.extends.is_empty() { format!(": {}", td.extends.join(" + ")) } else { String::new() };
    ec.line(&format!("{}{kw} {}{gp}{ext}{wh} {{", rs_vis(td.vis), td.name));
    ec.push();
    for f in &td.fields {
        ec.emit_trivia(&f.trivia, CommentStyle::Slash);
        if td.kind == TypeKind::Trait || is_rs_assoc_attr(&f.trivia) {
            emit_rs_trait_assoc(ec, f);
        } else {
            emit_rs_all_hash_attrs(ec, &f.trivia, &[]);
            let t = format_rs_tuple_field_ty(f.ty.as_ref());
            ec.line(&format!("{}{}: {t},", rs_vis(f.vis), f.name));
        }
    }
    for m in &td.methods {
        emit_method(ec, m, ectx);
    }
    ec.pop();
    ec.line("}");
}

fn emit_enum(ec: &mut EmitCtx, ed: &EnumDecl) {
    ec.blank();
    ec.emit_trivia(&ed.trivia, CommentStyle::Slash);
    emit_rs_all_hash_attrs(ec, &ed.trivia, &[]);
    let (gp, wh) = format_rs_generics(&ed.type_params, &ed.trivia, &[]);
    ec.line(&format!("{}enum {}{gp}{wh} {{", rs_vis(ed.vis), ed.name));
    ec.push();
    for v in &ed.variants {
        match &v.payload {
            VariantPayload::Unit => ec.line(&format!("{},", v.name)),
            VariantPayload::Tuple(ts) => {
                let ps: Vec<String> = ts.iter().map(|t| emit_type(t, LanguageId::Rust)).collect();
                ec.line(&format!("{}({}),", v.name, ps.join(", ")));
            }
            VariantPayload::Struct(fs) => {
                let ps: Vec<String> = fs.iter().map(|f| {
                    let t = f.ty.as_ref().map(|x| emit_type(x, LanguageId::Rust)).unwrap_or_else(|| "()".into());
                    format!("{}: {t}", f.name)
                }).collect();
                ec.line(&format!("{} {{ {} }},", v.name, ps.join(", ")));
            }
        }
    }
    ec.pop();
    ec.line("}");
}

fn emit_struct_impl(ec: &mut EmitCtx, cd: &ClassDecl, ectx: &ExprEmitCtx) {
    let is_tuple = has_class_attr(cd, "tuple");
    let is_unit = has_class_attr(cd, "unit");
    let is_braced = has_class_attr(cd, "braced");
    let struct_props: Vec<&PropDecl> = cd.props.iter().filter(|p| !is_rs_assoc_attr(&p.trivia)).collect();
    let assoc_props: Vec<&PropDecl> = cd.props.iter().filter(|p| is_rs_assoc_attr(&p.trivia)).collect();
    let (gp, wh) = format_rs_generics(&cd.type_params, &cd.trivia, &cd.decorators);
    let emits_struct = !struct_props.is_empty() || cd.vis != Visibility::Default || is_tuple || is_unit || is_braced;
    if emits_struct {
        ec.blank();
        ec.emit_trivia(&cd.trivia, CommentStyle::Slash);
        emit_rs_all_hash_attrs(ec, &cd.trivia, &cd.decorators);
        if is_tuple {
            let fs: Vec<String> = struct_props.iter().map(|p| format_rs_tuple_field(p.vis, p.ty.as_ref(), &p.trivia)).collect();
            ec.line(&format!("{}struct {}{gp}({}){wh};", rs_vis(cd.vis), cd.name, fs.join(", ")));
        } else if is_unit || (struct_props.is_empty() && !is_braced) {
            ec.line(&format!("{}struct {}{gp}{wh};", rs_vis(cd.vis), cd.name));
        } else if struct_props.is_empty() {
            ec.line(&format!("{}struct {}{gp}{wh} {{}}", rs_vis(cd.vis), cd.name));
        } else {
            ec.line(&format!("{}struct {}{gp}{wh} {{", rs_vis(cd.vis), cd.name));
            ec.push();
            for p in &struct_props {
                ec.emit_trivia(&p.trivia, CommentStyle::Slash);
                emit_rs_all_hash_attrs(ec, &p.trivia, &[]);
                let t = format_rs_tuple_field_ty(p.ty.as_ref());
                ec.line(&format!("{}{}: {t},", rs_vis(p.vis), p.name));
            }
            ec.pop();
            ec.line("}");
        }
    }
    let tr = cd.implements.first().cloned().or_else(|| rs_attr_arg(&cd.trivia, &cd.decorators, "impl"));
    if !cd.methods.is_empty() || !assoc_props.is_empty() || (!emits_struct && tr.is_some()) {
        ec.blank();
        let target_args = rs_attr_arg(&cd.trivia, &cd.decorators, "self_args").unwrap_or_else(|| {
            if tr.is_none() { format_rs_type_args(&cd.type_params, &cd.trivia, &cd.decorators) } else { String::new() }
        });
        let hdr = match tr {
            Some(t) => format!("impl{gp} {t} for {}{target_args}{wh} {{", cd.name),
            None => format!("impl{gp} {}{target_args}{wh} {{", cd.name),
        };
        if cd.methods.is_empty() && assoc_props.is_empty() {
            ec.line(&format!("{hdr}}}"));
        } else {
            ec.line(&hdr);
            ec.push();
            for p in &assoc_props {
                ec.emit_trivia(&p.trivia, CommentStyle::Slash);
                emit_rs_impl_assoc(ec, p);
            }
            for m in &cd.methods { emit_method(ec, m, ectx); }
            ec.pop();
            ec.line("}");
        }
    }
}

fn emit_method(ec: &mut EmitCtx, m: &MethodDecl, ectx: &ExprEmitCtx) {
    if m.accessor == AccessorKind::Raw {
        ec.emit_trivia(&m.trivia, CommentStyle::Slash);
        ec.emit_raw_block(&m.name);
        return;
    }
    ec.emit_trivia(&m.trivia, CommentStyle::Slash);
    emit_rs_all_hash_attrs(ec, &m.trivia, &[]);
    let quals = format_rs_fn_quals(&m.trivia, &[], m.is_async);
    let (gp, wh) = format_rs_generics(&m.type_params, &m.trivia, &[]);
    let ps = emit_rs_params(&m.params);
    let rt = m.return_type.as_ref().map(|t| format!(" -> {}", emit_type(t, LanguageId::Rust))).unwrap_or_default();
    if m.body == FnBody::SignatureOnly {
        ec.line(&format!("{}{quals}fn {}{gp}({ps}){rt}{wh};", rs_vis(m.vis), m.name));
        return;
    }
    ec.line(&format!("{}{quals}fn {}{gp}({ps}){rt}{wh} {{", rs_vis(m.vis), m.name));
    ec.push();
    emit_rs_body(ec, &m.body, ectx);
    ec.pop();
    ec.line("}");
}

fn emit_fn(ec: &mut EmitCtx, f: &FnDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&f.trivia, CommentStyle::Slash);
    emit_rs_all_hash_attrs(ec, &f.trivia, &f.decorators);
    let quals = format_rs_fn_quals(&f.trivia, &f.decorators, f.is_async);
    let (gp, wh) = format_rs_generics(&f.type_params, &f.trivia, &f.decorators);
    let ps = emit_rs_params(&f.params);
    let rt = f.return_type.as_ref().map(|t| format!(" -> {}", emit_type(t, LanguageId::Rust))).unwrap_or_default();
    ec.line(&format!("{}{quals}fn {}{gp}({ps}){rt}{wh} {{", rs_vis(f.vis), f.name));
    ec.push();
    emit_rs_body(ec, &f.body, ectx);
    ec.pop();
    ec.line("}");
}

fn emit_rs_body(ec: &mut EmitCtx, body: &FnBody, ectx: &ExprEmitCtx) {
    match body {
        FnBody::SignatureOnly => {}
        FnBody::Expr(e) => ec.line(&emit_expr(e, LanguageId::Rust, ectx)),
        FnBody::Block(stmts) => emit_brace_stmts(stmts, LanguageId::Rust, ec, ectx, true),
    }
}

fn emit_rs_params(params: &[ParamDecl]) -> String {
    params.iter().map(|p| {
        let mt = if p.is_mut && !p.name.starts_with("mut ") && !p.name.starts_with('&') { "mut " } else { "" };
        if p.name == "self" || p.name == "mut self" || p.name.starts_with('&') {
            format!("{mt}{}", p.name)
        } else {
            let t = p.ty.as_ref().map(|x| emit_type(x, LanguageId::Rust)).unwrap_or_else(|| "()".into());
            format!("{mt}{}: {t}", p.name)
        }
    }).collect::<Vec<_>>().join(", ")
}

fn has_trivia_attr(tr: &Trivia, name: &str) -> bool {
    tr.leading.iter().any(|c| {
        c.kind == TriviaKind::Attribute && (c.text == name || c.text.strip_prefix('@') == Some(name))
    })
}

fn has_class_attr(cd: &ClassDecl, name: &str) -> bool {
    has_trivia_attr(&cd.trivia, name)
        || cd.decorators.iter().any(|d| d == name || d.strip_prefix('@') == Some(name))
}

fn format_rs_tuple_field(vis: Visibility, ty: Option<&AiceType>, tr: &Trivia) -> String {
    let mut s = String::new();
    for c in &tr.leading {
        if c.kind == TriviaKind::Attribute && c.text.starts_with("#[") {
            s.push_str(&c.text);
            s.push(' ');
        }
    }
    s.push_str(rs_vis(vis));
    s.push_str(&ty.map(|x| emit_type(x, LanguageId::Rust)).unwrap_or_else(|| "()".into()));
    s
}

fn rs_vis(v: Visibility) -> &'static str {
    match v {
        Visibility::Public => "pub ", Visibility::Protected => "pub(super) ",
        Visibility::Package => "pub(crate) ", _ => "",
    }
}
