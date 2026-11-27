use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_span, node_text};
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::decompile::ts_helpers::{normalize_single_line, push_attrs_to_trivia};
use crate::ir::{AiceItem, AiceModule, TranspileOpts, Trivia, Visibility};
use crate::ir_code::{Expr, FnBody, Pattern, RecordEntry, Stmt};
use crate::ir_types::{AiceType, FieldDecl, FieldSigil, TypeDecl, TypeKind, TypeParam, VariantPayload};

pub(crate) fn decompile_struct(
    node: Node<'_>, vis: Visibility, src: &str, opts: &TranspileOpts,
    mut tr: Trivia, type_params: Vec<TypeParam>, attrs: Vec<String>,
) -> TypeDecl {
    let name = field_text(node, "name", src).unwrap_or("Struct").to_string();
    push_attrs_to_trivia(&mut tr, attrs);
    let fields = match node.child_by_field_name("body") {
        Some(b) if b.kind() == "ordered_field_declaration_list" => {
            push_attrs_to_trivia(&mut tr, vec!["@tuple".into()]);
            extract_rs_tuple_fields(b, src, opts)
        }
        Some(b) => extract_rs_fields(b, src, opts, true),
        None => { push_attrs_to_trivia(&mut tr, vec!["@unit".into()]); Vec::new() }
    };
    TypeDecl {
        vis, kind: TypeKind::Struct, name, type_params, extends: Vec::new(),
        fields, methods: Vec::new(), alias_target: None, trivia: tr, span: node_span(node),
    }
}

pub(crate) fn extract_rs_fields(body: Node<'_>, src: &str, opts: &TranspileOpts, is_struct: bool) -> Vec<FieldDecl> {
    let (mut fields, mut pending_attrs) = (Vec::new(), Vec::new());
    for ch in named_children(body) {
        if is_comment_kind(ch.kind()) { continue; }
        if ch.kind() == "attribute_item" {
            pending_attrs.push(normalize_single_line(node_text(ch, src)));
        } else if ch.kind() == "field_declaration" {
            let mut ftr = collect_trivia(ch, src, opts);
            push_attrs_to_trivia(&mut ftr, std::mem::take(&mut pending_attrs));
            fields.push(FieldDecl {
                name: field_text(ch, "name", src).unwrap_or("f").to_string(),
                vis: if is_struct { rs_vis(ch, src) } else { Visibility::Default },
                is_readonly: is_struct, is_optional: false, sigil: FieldSigil::None,
                ty: field_text(ch, "type", src).map(|t| map_type_str(t, LanguageId::Rust)),
                default: None, trivia: ftr,
            });
        } else { pending_attrs.clear(); }
    }
    fields
}

fn extract_rs_tuple_fields(body: Node<'_>, src: &str, opts: &TranspileOpts) -> Vec<FieldDecl> {
    let (mut fields, mut pending_attrs, mut pending_vis, mut idx) = (Vec::new(), Vec::new(), Visibility::Private, 0usize);
    for ch in named_children(body) {
        if is_comment_kind(ch.kind()) { continue; }
        match ch.kind() {
            "attribute_item" => pending_attrs.push(normalize_single_line(node_text(ch, src))),
            "visibility_modifier" => pending_vis = rs_vis_text(node_text(ch, src)),
            _ => {
                let mut ftr = collect_trivia(ch, src, opts);
                push_attrs_to_trivia(&mut ftr, std::mem::take(&mut pending_attrs));
                fields.push(FieldDecl {
                    name: idx.to_string(), vis: std::mem::replace(&mut pending_vis, Visibility::Private),
                    is_readonly: true, is_optional: false, sigil: FieldSigil::None,
                    ty: Some(map_type_str(node_text(ch, src), LanguageId::Rust)), default: None, trivia: ftr,
                });
                idx += 1;
            }
        }
    }
    fields
}

pub(crate) fn rs_vis_text(raw: &str) -> Visibility {
    match raw.trim() { "pub" => Visibility::Public, "pub(super)" => Visibility::Protected, _ => Visibility::Package }
}

pub(crate) fn rs_vis(node: Node<'_>, src: &str) -> Visibility {
    child_by_kind(node, "visibility_modifier").map_or(Visibility::Private, |vm| rs_vis_text(node_text(vm, src)))
}

pub(crate) fn rs_esc(s: &str) -> String { s.replace('\\', "\\\\").replace('"', "\\\"") }

pub(crate) fn decompile_rs_trait_assoc(node: Node<'_>, src: &str, mut tr: Trivia) -> FieldDecl {
    let raw = normalize_single_line(node_text(node, src));
    let name = field_text(node, "name", src).unwrap_or("Out").trim().to_string();
    let has_complex = node.child_by_field_name("type_parameters").is_some()
        || child_by_kind(node, "where_clause").is_some() || raw.contains('=');
    let ty = if has_complex {
        push_attrs_to_trivia(&mut tr, vec![format!("@assoc_raw(\"{}\")", rs_esc(&raw))]);
        None
    } else {
        push_attrs_to_trivia(&mut tr, vec!["@assoc_type".into()]);
        node.child_by_field_name("bounds").map(|b| {
            map_type_str(normalize_single_line(node_text(b, src)).trim_start_matches(':').trim(), LanguageId::Rust)
        })
    };
    FieldDecl { name, vis: Visibility::Default, is_readonly: false, is_optional: false, sigil: FieldSigil::None, ty, default: None, trivia: tr }
}

pub(crate) fn decompile_rs_impl_assoc(node: Node<'_>, src: &str, mut tr: Trivia) -> crate::ir_code::PropDecl {
    let raw = normalize_single_line(node_text(node, src));
    let name = field_text(node, "name", src).unwrap_or("Out").trim().to_string();
    let has_complex = node.child_by_field_name("type_parameters").is_some() || child_by_kind(node, "where_clause").is_some();
    let ty = if has_complex {
        push_attrs_to_trivia(&mut tr, vec![format!("@assoc_raw(\"{}\")", rs_esc(&raw))]);
        None
    } else {
        push_attrs_to_trivia(&mut tr, vec!["@assoc_type".into()]);
        field_text(node, "type", src).map(|t| map_type_str(t, LanguageId::Rust))
    };
    crate::ir_code::PropDecl {
        name, aliases: Vec::new(), vis: Visibility::Default, is_static: false, is_readonly: false,
        is_mut: false, is_optional: false, ty, init: None, trivia: tr,
    }
}

pub(crate) fn rs_generic_attrs_match(tr: &Trivia, impl_attrs: &[String]) -> bool {
    let mut a: Vec<&str> = tr.leading.iter().filter(|c| c.kind == crate::ir::TriviaKind::Attribute)
        .map(|c| c.text.trim().trim_start_matches('@'))
        .filter(|s| s.starts_with("lifetimes(") || s.starts_with("where(")).collect();
    let mut b: Vec<&str> = impl_attrs.iter().map(|s| s.trim().trim_start_matches('@'))
        .filter(|s| s.starts_with("lifetimes(") || s.starts_with("where(")).collect();
    a.sort_unstable();
    b.sort_unstable();
    a == b
}

pub(crate) fn is_rs_non_tail_raw(s: &str) -> bool {
    let t = s.trim();
    t.ends_with(';')
        || ["let ", "fn ", "pub ", "const ", "static ", "struct ", "enum ", "type ", "use ", "impl ", "trait "]
            .iter().any(|p| t.starts_with(p))
}

pub(crate) fn extract_rs_fn_quals(node: Node<'_>, src: &str) -> (bool, Vec<String>) {
    let (mut is_async, mut quals) = (false, Vec::new());
    let fn_end = node.child_by_field_name("name").map(|n| n.start_byte()).unwrap_or(node.end_byte());
    let mut inspect = |c: Node<'_>| {
        let t = node_text(c, src).trim();
        if c.kind() == "extern_modifier" || (t.starts_with("extern") && t.len() > 6 && !t.as_bytes()[6].is_ascii_alphanumeric()) {
            let abi = t.strip_prefix("extern").unwrap_or("").trim().strip_prefix('"').and_then(|r| r.strip_suffix('"'));
            let attr = abi.filter(|a| !a.is_empty()).map_or_else(|| "extern".into(), |a| format!("extern(\"{}\")", rs_esc(a)));
            if !quals.iter().any(|q: &String| q == "extern" || q.starts_with("extern(")) { quals.push(attr); }
        } else if t == "async" { is_async = true; }
        else if matches!(t, "const" | "unsafe") && !quals.iter().any(|q| q == t) { quals.push(t.into()); }
        else if t == "extern" && !quals.iter().any(|q| q == "extern" || q.starts_with("extern(")) { quals.push("extern".into()); }
    };
    let mut cur = node.walk();
    for ch in node.children(&mut cur) {
        if ch.start_byte() >= fn_end { break; }
        if ch.kind() == "function_modifiers" {
            let mut mcur = ch.walk();
            for mc in ch.children(&mut mcur) { inspect(mc); }
        } else if ch.kind() != "visibility_modifier" && ch.kind() != "fn" { inspect(ch); }
    }
    (is_async, quals)
}

fn fix_rs_str_ty(root: &mut AiceType) {
    let mut stack = vec![root];
    while let Some(ty) = stack.pop() {
        match ty {
            AiceType::Named { path, args } if path.len() == 1 && path[0] == "str" && args.is_empty() => *ty = AiceType::Raw("str".into()),
            AiceType::Array(x) | AiceType::Option(x) => stack.push(x),
            AiceType::Tuple(xs) | AiceType::Union(xs) | AiceType::Intersection(xs) | AiceType::Named { args: xs, .. } => stack.extend(xs.iter_mut()),
            AiceType::Record(fs) => stack.extend(fs.iter_mut().map(|f| &mut f.ty)),
            AiceType::Result { ok, err } => { stack.push(ok); stack.push(err); }
            AiceType::Fn { params, ret } => { stack.extend(params.iter_mut()); stack.push(ret); }
            AiceType::Primitive(_) | AiceType::Refinement { .. } | AiceType::Raw(_) => {}
        }
    }
}

fn fix_rs_tps(tps: &mut [TypeParam]) {
    for tp in tps {
        for b in &mut tp.bounds { fix_rs_str_ty(b); }
        if let Some(d) = &mut tp.default { fix_rs_str_ty(d); }
    }
}

enum RsW<'a> { St(&'a mut Stmt), Ex(&'a mut Expr), Bd(&'a mut FnBody), Pt(&'a mut Pattern) }

fn fix_rs_methods<'a>(ms: &'a mut [crate::ir_code::MethodDecl], w: &mut Vec<RsW<'a>>) {
    for md in ms {
        fix_rs_tps(&mut md.type_params);
        for p in &mut md.params { if let Some(t) = &mut p.ty { fix_rs_str_ty(t); } }
        if let Some(t) = &mut md.return_type { fix_rs_str_ty(t); }
        w.push(RsW::Bd(&mut md.body));
    }
}

fn fix_rs_opt_ty(ty: &mut Option<AiceType>) {
    if let Some(t) = ty { fix_rs_str_ty(t); }
}

fn fix_rs_walk(mut w: Vec<RsW<'_>>) {
    while let Some(cur) = w.pop() {
        match cur {
            RsW::Bd(FnBody::Block(ss)) => w.extend(ss.iter_mut().map(RsW::St)),
            RsW::Bd(FnBody::Expr(e)) => w.push(RsW::Ex(e)),
            RsW::Bd(FnBody::SignatureOnly) => {}
            RsW::St(s) => match s {
                Stmt::Let { ty, init, .. } => { fix_rs_opt_ty(ty); if let Some(e) = init { w.push(RsW::Ex(e)); } }
                Stmt::Destructure { ty, init, .. } => { fix_rs_opt_ty(ty); w.push(RsW::Ex(init)); }
                Stmt::Assign { target: a, value: b, .. } => { w.push(RsW::Ex(a)); w.push(RsW::Ex(b)); }
                Stmt::Return { value: Some(e), .. } | Stmt::Expr { expr: e, .. } => w.push(RsW::Ex(e)),
                Stmt::Throw { expr, cause, .. } => { w.push(RsW::Ex(expr)); if let Some(c) = cause { w.push(RsW::Ex(c)); } }
                Stmt::If { cond, then_body, elifs, else_body, .. } => {
                    w.push(RsW::Ex(cond)); w.extend(then_body.iter_mut().map(RsW::St));
                    for (ec, eb) in elifs { w.push(RsW::Ex(ec)); w.extend(eb.iter_mut().map(RsW::St)); }
                    if let Some(eb) = else_body { w.extend(eb.iter_mut().map(RsW::St)); }
                }
                Stmt::Match { target, cases, .. } => {
                    w.push(RsW::Ex(target));
                    for c in cases { w.push(RsW::Pt(&mut c.pattern)); if let Some(g) = &mut c.guard { w.push(RsW::Ex(g)); } w.push(RsW::Bd(&mut c.body)); }
                }
                Stmt::For { iter, body, .. } | Stmt::While { cond: iter, body, .. } => { w.push(RsW::Ex(iter)); w.extend(body.iter_mut().map(RsW::St)); }
                Stmt::Loop { body, .. } => w.extend(body.iter_mut().map(RsW::St)),
                Stmt::Try { try_body, catches, else_body, finally_body, .. } => {
                    w.extend(try_body.iter_mut().map(RsW::St));
                    for c in catches { fix_rs_opt_ty(&mut c.ty); w.extend(c.body.iter_mut().map(RsW::St)); }
                    if let Some(eb) = else_body { w.extend(eb.iter_mut().map(RsW::St)); }
                    if let Some(fb) = finally_body { w.extend(fb.iter_mut().map(RsW::St)); }
                }
                _ => {}
            },
            RsW::Ex(e) => match e {
                Expr::Closure { params, ret, body, .. } => {
                    for p in params { fix_rs_opt_ty(&mut p.ty); if let Some(d) = &mut p.default { w.push(RsW::Ex(d)); } }
                    fix_rs_opt_ty(ret);
                    w.push(RsW::Bd(body));
                }
                Expr::Match { target, cases } => {
                    w.push(RsW::Ex(target));
                    for c in cases { w.push(RsW::Pt(&mut c.pattern)); if let Some(g) = &mut c.guard { w.push(RsW::Ex(g)); } w.push(RsW::Bd(&mut c.body)); }
                }
                Expr::Template { exprs, .. } | Expr::Array(exprs) => w.extend(exprs.iter_mut().map(RsW::Ex)),
                Expr::Binary { left: a, right: b, .. } | Expr::Assign { target: a, value: b, .. } | Expr::Index { object: a, index: b, .. } => { w.push(RsW::Ex(a)); w.push(RsW::Ex(b)); }
                Expr::Unary { operand: o, .. } | Expr::PostfixTry(o) | Expr::Await(o) | Expr::Member { object: o, .. } => w.push(RsW::Ex(o)),
                Expr::Conditional { cond, then_expr, else_expr } => { w.push(RsW::Ex(cond)); w.push(RsW::Ex(then_expr)); w.push(RsW::Ex(else_expr)); }
                Expr::Call { callee, args, .. } => { w.push(RsW::Ex(callee)); w.extend(args.iter_mut().map(RsW::Ex)); }
                Expr::Record(es) => for r in es { match r { RecordEntry::Spread(x) | RecordEntry::Field { value: x, .. } => w.push(RsW::Ex(x)) } },
                Expr::Comprehension { body, value, clauses, .. } => {
                    w.push(RsW::Ex(body)); if let Some(v) = value { w.push(RsW::Ex(v)); }
                    for cl in clauses { w.push(RsW::Ex(&mut cl.iter)); w.extend(cl.filters.iter_mut().map(RsW::Ex)); }
                }
                Expr::Literal(_) | Expr::Ident(_) | Expr::Raw(_) => {}
            },
            RsW::Pt(p) => match p {
                Pattern::TypeCheck { ty, .. } => fix_rs_str_ty(ty),
                Pattern::Constructor { args, .. } | Pattern::Or(args) => w.extend(args.iter_mut().map(RsW::Pt)),
                Pattern::Range { start, end, .. } => { w.push(RsW::Ex(start)); w.push(RsW::Ex(end)); }
                _ => {}
            },
        }
    }
}

pub(crate) fn fix_rs_bare_str_in_module(m: &mut AiceModule) {
    let mut w = Vec::new();
    for item in &mut m.items {
        match item {
            AiceItem::Type(td) => {
                fix_rs_tps(&mut td.type_params);
                fix_rs_opt_ty(&mut td.alias_target);
                for f in &mut td.fields { fix_rs_opt_ty(&mut f.ty); if let Some(d) = &mut f.default { w.push(RsW::Ex(d)); } }
                fix_rs_methods(&mut td.methods, &mut w);
            }
            AiceItem::Enum(ed) => {
                fix_rs_tps(&mut ed.type_params);
                for v in &mut ed.variants {
                    match &mut v.payload {
                        VariantPayload::Tuple(ts) => for t in ts { fix_rs_str_ty(t); },
                        VariantPayload::Struct(fs) => for f in fs { fix_rs_opt_ty(&mut f.ty); },
                        VariantPayload::Unit => {}
                    }
                }
            }
            AiceItem::Class(cd) => {
                fix_rs_tps(&mut cd.type_params);
                for p in &mut cd.props { fix_rs_opt_ty(&mut p.ty); if let Some(e) = &mut p.init { w.push(RsW::Ex(e)); } }
                fix_rs_methods(&mut cd.methods, &mut w);
            }
            AiceItem::Fn(fd) => {
                fix_rs_tps(&mut fd.type_params);
                for p in &mut fd.params { fix_rs_opt_ty(&mut p.ty); }
                fix_rs_opt_ty(&mut fd.return_type);
                w.push(RsW::Bd(&mut fd.body));
            }
            AiceItem::Const(cd) => { fix_rs_opt_ty(&mut cd.ty); w.push(RsW::Ex(&mut cd.value)); }
            AiceItem::Var(vd) => { fix_rs_opt_ty(&mut vd.ty); if let Some(e) = &mut vd.value { w.push(RsW::Ex(e)); } }
            _ => {}
        }
    }
    fix_rs_walk(w);
}
