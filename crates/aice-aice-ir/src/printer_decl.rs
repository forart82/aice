use crate::ir::{Trivia, Visibility};
use crate::ir_code::{AccessorKind, ClassDecl, FnBody, FnDecl, MethodDecl, PropDecl, Stmt};
use crate::ir_types::{EnumDecl, FieldDecl, FieldSigil, TypeDecl, TypeKind, TypeParam, VariantPayload};
use crate::printer::{PrintCtx, format_params};
use crate::printer_expr::{print_expr, print_type};
use crate::printer_stmt::print_block_stmts;

pub(crate) fn print_type_decl(c: &mut PrintCtx<'_>, td: &TypeDecl, d: usize) {
    c.emit_trivia(&td.trivia, d);
    let kw = match td.kind {
        TypeKind::Struct | TypeKind::Alias => "type",
        TypeKind::Interface => "interface",
        TypeKind::Trait => "trait",
    };
    let tps = format_type_params(&td.type_params);
    let ext = if td.extends.is_empty() { String::new() } else { format!(" extends {}", td.extends.join(", ")) };
    if td.kind == TypeKind::Alias {
        let rhs = td.alias_target.as_ref().map(print_type).unwrap_or_else(|| "any".into());
        c.line_tr(d, &format!("{}{kw} {}{}{ext} = {rhs}", td.vis.aice_prefix(), td.name, tps), &td.trivia);
        return;
    }
    let inline_ok = c.opts.compact && td.methods.is_empty() && !td.fields.is_empty() && td.fields.len() <= 3
        && td.fields.iter().all(|f| f.trivia.is_empty() && f.default.is_none());
    if inline_ok {
        let fs: Vec<String> = td.fields.iter().map(|f| format_field(c, f)).collect();
        c.line_tr(d, &format!("{}{kw} {}{}{ext}: {}", td.vis.aice_prefix(), td.name, tps, fs.join(", ")), &td.trivia);
        return;
    }
    c.line_tr(d, &format!("{}{kw} {}{}{ext}:", td.vis.aice_prefix(), td.name, tps), &td.trivia);
    for f in &td.fields {
        c.emit_trivia(&f.trivia, d + 1);
        c.line_tr(d + 1, &format_field(c, f), &f.trivia);
    }
    for m in &td.methods { print_method_decl(c, m, d + 1); }
    if td.fields.is_empty() && td.methods.is_empty() { c.line(d + 1, "pass"); }
}

fn format_field(c: &PrintCtx<'_>, f: &FieldDecl) -> String {
    let mut s = String::new();
    s.push_str(f.vis.aice_prefix());
    if f.is_readonly { s.push_str("readonly "); }
    s.push_str(&f.name);
    match f.sigil {
        FieldSigil::RequiredStr => s.push_str("!s"), FieldSigil::RequiredInt => s.push_str("!i"),
        FieldSigil::RequiredFloat => s.push_str("!f"), FieldSigil::RequiredBool => s.push_str("!b"),
        FieldSigil::Required => s.push('!'), FieldSigil::Optional => s.push('?'), FieldSigil::None => {}
    }
    if c.opts.include_types && let Some(ref ty) = f.ty {
        s.push_str(c.colon_sep());
        s.push_str(&print_type(ty));
    }
    if let Some(ref def) = f.default { s.push_str(" = "); s.push_str(&print_expr(def)); }
    s
}

pub(crate) fn print_enum_decl(c: &mut PrintCtx<'_>, ed: &EnumDecl, d: usize) {
    c.emit_trivia(&ed.trivia, d);
    c.line_tr(d, &format!("{}enum {}{}:", ed.vis.aice_prefix(), ed.name, format_type_params(&ed.type_params)), &ed.trivia);
    for v in &ed.variants {
        c.emit_trivia(&v.trivia, d + 1);
        let mut s = v.name.clone();
        match &v.payload {
            VariantPayload::Unit => {}
            VariantPayload::Tuple(ts) => {
                let ps: Vec<String> = ts.iter().map(print_type).collect();
                s.push_str(&format!("({})", ps.join(", ")));
            }
            VariantPayload::Struct(fs) => {
                let ps: Vec<String> = fs.iter().map(|f| format_field(c, f)).collect();
                s.push_str(&format!(" {{ {} }}", ps.join(", ")));
            }
        }
        if let Some(ref disc) = v.discriminant { s.push_str(&format!(" = {}", print_expr(disc))); }
        c.line_tr(d + 1, &s, &v.trivia);
    }
    if ed.variants.is_empty() { c.line(d + 1, "pass"); }
}

pub(crate) fn print_class_decl(c: &mut PrintCtx<'_>, cd: &ClassDecl, d: usize) {
    c.emit_trivia(&cd.trivia, d);
    for dec in &cd.decorators {
        if dec.starts_with("#[") || dec.starts_with('@') { c.line(d, dec); }
        else { c.line(d, &format!("@{dec}")); }
    }
    let abs = if cd.is_abstract { "abstract " } else { "" };
    let ctor = if cd.primary_ctor.is_empty() { String::new() } else { format!("({})", format_params(c, &cd.primary_ctor)) };
    let ext = cd.extends.as_ref().map(|e| format!(" extends {e}")).unwrap_or_default();
    let imp = if cd.implements.is_empty() { String::new() } else { format!(" implements {}", cd.implements.join(", ")) };
    let empty_body = cd.static_blocks.is_empty() && cd.props.is_empty() && cd.methods.is_empty();
    if empty_body && !cd.primary_ctor.is_empty() && c.opts.compact {
        c.line_tr(d, &format!("{}{abs}class {}{}{ctor}{ext}{imp}", cd.vis.aice_prefix(), cd.name, format_type_params(&cd.type_params)), &cd.trivia);
        return;
    }
    c.line_tr(d, &format!("{}{abs}class {}{}{ctor}{ext}{imp}:", cd.vis.aice_prefix(), cd.name, format_type_params(&cd.type_params)), &cd.trivia);
    for sb in &cd.static_blocks {
        c.line(d + 1, "static:");
        print_block_stmts(c, sb, d + 2);
    }
    for p in &cd.props { print_prop_decl(c, p, d + 1); }
    for m in &cd.methods { print_method_decl(c, m, d + 1); }
    if empty_body {
        c.line(d + 1, "pass");
    }
}

fn print_prop_decl(c: &mut PrintCtx<'_>, p: &PropDecl, d: usize) {
    c.emit_trivia(&p.trivia, d);
    let mut s = String::new();
    s.push_str(p.vis.aice_prefix());
    if p.is_static { s.push_str("static "); }
    if p.is_readonly { s.push_str("readonly "); }
    if p.is_mut { s.push_str("mut "); }
    s.push_str(&p.name);
    if p.is_optional { s.push('?'); }
    if c.opts.include_types && let Some(ref ty) = p.ty {
        s.push_str(c.colon_sep());
        s.push_str(&print_type(ty));
    }
    if let Some(ref init) = p.init { s.push_str(&format!(" = {}", print_expr(init))); }
    c.line_tr(d, &s, &p.trivia);
}

fn print_method_decl(c: &mut PrintCtx<'_>, m: &MethodDecl, d: usize) {
    c.emit_trivia(&m.trivia, d);
    let vis = if m.vis == Visibility::Default { "" } else { m.vis.aice_prefix() };
    let st = if m.is_static { "static " } else { "" };
    let asy = if m.is_async { "async " } else { "" };
    let kw = match m.accessor {
        AccessorKind::Normal => "fn ", AccessorKind::Get => "get ",
        AccessorKind::Set => "set ", AccessorKind::Constructor => "",
    };
    let cst = if m.is_const { " const" } else { "" };
    let ret = if c.opts.include_types {
        m.return_type.as_ref().map(|t| format!(" -> {}", print_type(t))).unwrap_or_default()
    } else { String::new() };
    let nm = if m.accessor == AccessorKind::Constructor { "constructor" } else { m.name.as_str() };
    let hdr = format!("{vis}{st}{asy}{kw}{}{}({}){cst}{ret}", nm, format_type_params(&m.type_params), format_params(c, &m.params));
    print_fn_body(c, &hdr, &m.body, &m.trivia, d);
}

pub(crate) fn print_fn_decl(c: &mut PrintCtx<'_>, f: &FnDecl, d: usize) {
    c.emit_trivia(&f.trivia, d);
    for dec in &f.decorators {
        if dec.starts_with("#[") || dec.starts_with('@') { c.line(d, dec); }
        else { c.line(d, &format!("@{dec}")); }
    }
    let asy = if f.is_async { "async " } else { "" };
    let ret = if c.opts.include_types {
        f.return_type.as_ref().map(|t| format!(" -> {}", print_type(t))).unwrap_or_default()
    } else { String::new() };
    let hdr = format!("{}{asy}fn {}{}({}){ret}", f.vis.aice_prefix(), f.name, format_type_params(&f.type_params), format_params(c, &f.params));
    print_fn_body(c, &hdr, &f.body, &f.trivia, d);
}

fn print_fn_body(c: &mut PrintCtx<'_>, hdr: &str, body: &FnBody, tr: &Trivia, d: usize) {
    match body {
        FnBody::SignatureOnly => c.line_tr(d, hdr, tr),
        FnBody::Expr(e) => c.line_tr(d, &format!("{hdr} = {}", print_expr(e)), tr),
        FnBody::Block(stmts) => {
            if c.opts.compact && stmts.len() == 1
                && let Stmt::Return { value: Some(e), trivia } = &stmts[0]
                && trivia.is_empty()
            {
                c.line_tr(d, &format!("{hdr} = {}", print_expr(e)), tr);
                return;
            }
            c.line_tr(d, &format!("{hdr}:"), tr);
            print_block_stmts(c, stmts, d + 1);
        }
    }
}

pub(crate) fn format_type_params(tps: &[TypeParam]) -> String {
    if tps.is_empty() { return String::new(); }
    let items: Vec<String> = tps.iter().map(|tp| {
        let mut s = tp.name.clone();
        if !tp.bounds.is_empty() {
            let bs: Vec<String> = tp.bounds.iter().map(print_type).collect();
            s.push_str(&format!(": {}", bs.join(" + ")));
        }
        if let Some(ref d) = tp.default { s.push_str(&format!(" = {}", print_type(d))); }
        s
    }).collect();
    format!("[{}]", items.join(", "))
}
