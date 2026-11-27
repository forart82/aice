use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::compile::expr_emit::{ExprEmitCtx, emit_expr};
use crate::compile::stmt_common::emit_brace_stmts;
use crate::compile::type_map::emit_type;
use crate::ir::{AiceItem, AiceModule, TranspileError, Trivia, TriviaKind, Visibility};
use crate::ir_code::{ClassDecl, FnBody, FnDecl, MethodDecl};
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
            AiceItem::Type(td) => emit_type_decl(&mut ec, td),
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
                ec.line(&format!("{}static {mt}{}: {ty} = {};", rs_vis(vd.vis), vd.name, emit_expr(&vd.value, LanguageId::Rust, &ectx)));
            }
            AiceItem::Directive { text, trivia, .. } => {
                ec.emit_trivia(trivia, CommentStyle::Slash);
                if text.starts_with("#[") || text.starts_with("#![") || is_rs_macro_item(text) {
                    ec.line(text);
                } else {
                    ec.line(&format!("// {text}"));
                }
            }
            _ => {}
        }
    }
    Ok(ec.out)
}

fn emit_type_decl(ec: &mut EmitCtx, td: &TypeDecl) {
    ec.blank();
    ec.emit_trivia(&td.trivia, CommentStyle::Slash);
    emit_rs_hash_attrs(ec, &td.trivia);
    if td.kind == TypeKind::Alias {
        let rhs = td.alias_target.as_ref().map(|t| emit_type(t, LanguageId::Rust)).unwrap_or_else(|| "()".into());
        ec.line(&format!("{}type {} = {rhs};", rs_vis(td.vis), td.name));
        return;
    }
    if td.kind == TypeKind::Struct && has_trivia_attr(&td.trivia, "tuple") {
        let fs: Vec<String> = td.fields.iter().map(|f| format_rs_tuple_field(f.vis, f.ty.as_ref(), &f.trivia)).collect();
        ec.line(&format!("{}struct {}({});", rs_vis(td.vis), td.name, fs.join(", ")));
        return;
    }
    if td.kind == TypeKind::Struct && has_trivia_attr(&td.trivia, "unit") {
        ec.line(&format!("{}struct {};", rs_vis(td.vis), td.name));
        return;
    }
    let kw = if td.kind == TypeKind::Trait { "trait" } else { "struct" };
    ec.line(&format!("{}{kw} {} {{", rs_vis(td.vis), td.name));
    ec.push();
    for f in &td.fields {
        ec.emit_trivia(&f.trivia, CommentStyle::Slash);
        ec.emit_attrs(&f.trivia);
        let t = f.ty.as_ref().map(|x| emit_type(x, LanguageId::Rust)).unwrap_or_else(|| "()".into());
        ec.line(&format!("{}{}: {t},", rs_vis(f.vis), f.name));
    }
    for m in &td.methods {
        let ps = emit_rs_params(&m.params);
        let rt = m.return_type.as_ref().map(|t| format!(" -> {}", emit_type(t, LanguageId::Rust))).unwrap_or_default();
        ec.line(&format!("fn {}({ps}){rt};", m.name));
    }
    ec.pop();
    ec.line("}");
}

fn emit_enum(ec: &mut EmitCtx, ed: &EnumDecl) {
    ec.blank();
    ec.emit_trivia(&ed.trivia, CommentStyle::Slash);
    emit_rs_hash_attrs(ec, &ed.trivia);
    ec.line(&format!("{}enum {} {{", rs_vis(ed.vis), ed.name));
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
    if !cd.props.is_empty() || cd.vis != Visibility::Default || is_tuple || is_unit || is_braced {
        ec.blank();
        ec.emit_trivia(&cd.trivia, CommentStyle::Slash);
        emit_rs_hash_attrs(ec, &cd.trivia);
        if is_tuple {
            let fs: Vec<String> = cd.props.iter().map(|p| format_rs_tuple_field(p.vis, p.ty.as_ref(), &p.trivia)).collect();
            ec.line(&format!("{}struct {}({});", rs_vis(cd.vis), cd.name, fs.join(", ")));
        } else if is_unit || (cd.props.is_empty() && !is_braced) {
            ec.line(&format!("{}struct {};", rs_vis(cd.vis), cd.name));
        } else if cd.props.is_empty() {
            ec.line(&format!("{}struct {} {{}}", rs_vis(cd.vis), cd.name));
        } else {
            ec.line(&format!("{}struct {} {{", rs_vis(cd.vis), cd.name));
            ec.push();
            for p in &cd.props {
                ec.emit_trivia(&p.trivia, CommentStyle::Slash);
                ec.emit_attrs(&p.trivia);
                let t = p.ty.as_ref().map(|x| emit_type(x, LanguageId::Rust)).unwrap_or_else(|| "()".into());
                ec.line(&format!("{}{}: {t},", rs_vis(p.vis), p.name));
            }
            ec.pop();
            ec.line("}");
        }
    }
    if !cd.methods.is_empty() {
        ec.blank();
        let tr = cd.implements.first().cloned().or_else(|| {
            cd.decorators.iter().find_map(|d| {
                d.strip_prefix("impl(\"").and_then(|s| s.strip_suffix("\")"))
                    .map(|s| s.replace("\\\"", "\"").replace("\\\\", "\\"))
            })
        });
        let hdr = match tr {
            Some(t) => format!("impl {t} for {} {{", cd.name),
            None => format!("impl {} {{", cd.name),
        };
        ec.line(&hdr);
        ec.push();
        for m in &cd.methods { emit_method(ec, m, ectx); }
        ec.pop();
        ec.line("}");
    }
}

fn emit_method(ec: &mut EmitCtx, m: &MethodDecl, ectx: &ExprEmitCtx) {
    ec.emit_trivia(&m.trivia, CommentStyle::Slash);
    let asy = if m.is_async { "async " } else { "" };
    let ps = emit_rs_params(&m.params);
    let rt = m.return_type.as_ref().map(|t| format!(" -> {}", emit_type(t, LanguageId::Rust))).unwrap_or_default();
    ec.line(&format!("{}{asy}fn {}({ps}){rt} {{", rs_vis(m.vis), m.name));
    ec.push();
    emit_rs_body(ec, &m.body, ectx);
    ec.pop();
    ec.line("}");
}

fn emit_fn(ec: &mut EmitCtx, f: &FnDecl, ectx: &ExprEmitCtx) {
    ec.blank();
    ec.emit_trivia(&f.trivia, CommentStyle::Slash);
    let asy = if f.is_async { "async " } else { "" };
    let ps = emit_rs_params(&f.params);
    let rt = f.return_type.as_ref().map(|t| format!(" -> {}", emit_type(t, LanguageId::Rust))).unwrap_or_default();
    ec.line(&format!("{}{asy}fn {}({ps}){rt} {{", rs_vis(f.vis), f.name));
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

fn is_rs_macro_item(text: &str) -> bool {
    let t = text.trim_start();
    if t.starts_with("macro_rules!") { return true; }
    let rest = t.trim_start_matches(|c: char| c.is_ascii_alphanumeric() || c == '_' || c == ':');
    rest.len() < t.len() && rest.strip_prefix('!').is_some_and(|r| matches!(r.trim_start().as_bytes().first(), Some(b'(' | b'[' | b'{')))
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

fn emit_rs_hash_attrs(ec: &mut EmitCtx, tr: &Trivia) {
    for c in &tr.leading {
        if c.kind == TriviaKind::Attribute && c.text.starts_with("#[") {
            ec.line(&c.text);
        }
    }
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
