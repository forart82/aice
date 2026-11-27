use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_span, node_text, with_ts_root};
use crate::decompile::expr_common::decompile_expr;
use crate::decompile::stmt_common::decompile_block;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::decompile::ts_helpers::{normalize_single_line, push_attrs_to_trivia};
use crate::ir::{AiceItem, AiceModule, ImportDecl, TranspileError, TranspileOpts, Trivia, Visibility};
use crate::ir_code::{ClassDecl, ConstDecl, FnBody, FnDecl, MethodDecl, Stmt};
use crate::ir_types::{AiceType, EnumDecl, EnumVariant, FieldDecl, FieldSigil, ParamDecl, TypeDecl, TypeKind, TypeParam, VariantPayload};

struct RsImpl { tname: String, trait_nm: Option<String>, tps: Vec<TypeParam>, attrs: Vec<String>, methods: Vec<MethodDecl> }

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    with_ts_root(tree, |root| {
        let mut m = AiceModule::new(LanguageId::Rust, "rust");
        let mut impls: Vec<RsImpl> = Vec::new();
        for ch in named_children(root) {
            if is_comment_kind(ch.kind()) { continue; }
            let mut tr = collect_trivia(ch, src, opts);
            let vis = rs_vis(ch, src);
            match ch.kind() {
                "use_declaration" => m.items.push(AiceItem::Import(ImportDecl {
                    vis, source: field_text(ch, "argument", src).unwrap_or("").trim().to_string(),
                    specifiers: Vec::new(), is_type_only: false, trivia: tr, span: node_span(ch),
                })),
                "struct_item" => m.items.push(AiceItem::Type(decompile_struct(ch, vis, src, opts, tr))),
                "enum_item" => m.items.push(AiceItem::Enum(decompile_enum(ch, vis, src, opts, tr))),
                "trait_item" => m.items.push(AiceItem::Type(decompile_trait(ch, vis, src, opts, tr))),
                "type_item" => {
                    let (type_params, attrs) = extract_rs_generics(ch, src);
                    push_attrs_to_trivia(&mut tr, attrs);
                    m.items.push(AiceItem::Type(TypeDecl {
                        vis, kind: TypeKind::Alias, name: field_text(ch, "name", src).unwrap_or("Alias").to_string(),
                        type_params, extends: Vec::new(), fields: Vec::new(), methods: Vec::new(),
                        alias_target: field_text(ch, "type", src).map(|t| map_type_str(t, LanguageId::Rust)),
                        trivia: tr, span: node_span(ch),
                    }));
                }
                "const_item" | "static_item" => {
                    let value = ch.child_by_field_name("value").map(|v| decompile_expr(v, src, LanguageId::Rust))
                        .unwrap_or(crate::ir_code::Expr::Literal(crate::ir_expr::LiteralVal::Nil));
                    m.items.push(AiceItem::Const(ConstDecl {
                        vis, name: field_text(ch, "name", src).unwrap_or("CONST").to_string(),
                        ty: field_text(ch, "type", src).map(|t| map_type_str(t, LanguageId::Rust)),
                        value, trivia: tr, span: node_span(ch),
                    }));
                }
                "function_item" => m.items.push(AiceItem::Fn(decompile_rs_fn(ch, vis, src, opts, tr))),
                "impl_item" => {
                    let tname = ch.child_by_field_name("type").and_then(|n| {
                        if n.kind() == "generic_type" { field_text(n, "type", src) } else { Some(node_text(n, src)) }
                    }).unwrap_or("Self").trim().to_string();
                    let trait_nm = field_text(ch, "trait", src).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
                    let (tps, attrs) = extract_rs_generics(ch, src);
                    let mut methods = Vec::new();
                    if let Some(body) = ch.child_by_field_name("body") {
                        for mc in named_children(body) {
                            if mc.kind() == "function_item" {
                                let f = decompile_rs_fn(mc, rs_vis(mc, src), src, opts, collect_trivia(mc, src, opts));
                                methods.push(rs_fn_to_method(f));
                            }
                        }
                    }
                    impls.push(RsImpl { tname, trait_nm, tps, attrs, methods });
                }
                _ => m.items.push(AiceItem::Directive { text: node_text(ch, src).trim().into(), trivia: tr, span: node_span(ch) }),
            }
        }
        attach_rs_impls(&mut m, impls);
        Ok(m)
    })
}

fn attach_rs_impls(m: &mut AiceModule, impls: Vec<RsImpl>) {
    for RsImpl { tname, trait_nm, tps, attrs, methods } in impls {
        if trait_nm.is_none()
            && let Some(idx) = m.items.iter().position(|it| matches!(it, AiceItem::Type(t) if t.name == tname && t.kind == TypeKind::Struct))
        {
            if let AiceItem::Type(td) = m.items.remove(idx) {
                let props = td.fields.into_iter().map(|f| crate::ir_code::PropDecl {
                    name: f.name, aliases: Vec::new(), vis: f.vis, is_static: false, is_readonly: true,
                    is_mut: false, is_optional: f.is_optional, ty: f.ty, init: f.default, trivia: f.trivia,
                }).collect();
                let type_params = if td.type_params.is_empty() { tps } else { td.type_params };
                m.items.insert(idx, AiceItem::Class(ClassDecl {
                    vis: td.vis, is_abstract: false, decorators: Vec::new(), name: td.name, type_params,
                    primary_ctor: Vec::new(), extends: None, implements: Vec::new(), props, methods,
                    static_blocks: Vec::new(), trivia: td.trivia, span: td.span,
                }));
            }
        } else if trait_nm.is_none()
            && let Some(AiceItem::Class(cd)) = m.items.iter_mut().find(|it| matches!(it, AiceItem::Class(c) if c.name == tname && c.implements.is_empty()))
        {
            cd.methods.extend(methods);
        } else {
            let mut decs: Vec<String> = attrs.into_iter().map(|a| a.trim_start_matches('@').to_string()).collect();
            let mut implements = Vec::new();
            if let Some(tn) = trait_nm {
                if tn.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == ':') { implements.push(tn); }
                else { decs.push(format!("impl(\"{}\")", rs_esc(&tn))); }
            }
            m.items.push(AiceItem::Class(ClassDecl {
                vis: Visibility::Default, is_abstract: false, decorators: decs, name: tname, type_params: tps,
                primary_ctor: Vec::new(), extends: None, implements, props: Vec::new(), methods,
                static_blocks: Vec::new(), trivia: Trivia::default(), span: Default::default(),
            }));
        }
    }
}

fn rs_fn_to_method(f: FnDecl) -> MethodDecl {
    MethodDecl {
        vis: f.vis, is_static: false, is_async: f.is_async, is_const: false, accessor: Default::default(),
        name: f.name, type_params: f.type_params, params: f.params, return_type: f.return_type,
        body: f.body, trivia: f.trivia, span: f.span,
    }
}

fn decompile_struct(node: Node<'_>, vis: Visibility, src: &str, opts: &TranspileOpts, mut tr: Trivia) -> TypeDecl {
    let name = field_text(node, "name", src).unwrap_or("Struct").to_string();
    let (type_params, attrs) = extract_rs_generics(node, src);
    push_attrs_to_trivia(&mut tr, attrs);
    let fields = node.child_by_field_name("body").map(|b| extract_rs_fields(b, src, opts, true)).unwrap_or_default();
    TypeDecl {
        vis, kind: TypeKind::Struct, name, type_params, extends: Vec::new(),
        fields, methods: Vec::new(), alias_target: None, trivia: tr, span: node_span(node),
    }
}

fn extract_rs_fields(body: Node<'_>, src: &str, opts: &TranspileOpts, is_struct: bool) -> Vec<FieldDecl> {
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

fn decompile_enum(node: Node<'_>, vis: Visibility, src: &str, opts: &TranspileOpts, mut tr: Trivia) -> EnumDecl {
    let name = field_text(node, "name", src).unwrap_or("Enum").to_string();
    let (type_params, attrs) = extract_rs_generics(node, src);
    push_attrs_to_trivia(&mut tr, attrs);
    let mut variants = Vec::new();
    if let Some(body) = node.child_by_field_name("body") {
        for ch in named_children(body) {
            if ch.kind() == "enum_variant" {
                let vn = field_text(ch, "name", src).unwrap_or("V").to_string();
                let payload = match ch.child_by_field_name("body") {
                    Some(b) if b.kind() == "field_declaration_list" => VariantPayload::Struct(extract_rs_fields(b, src, opts, false)),
                    Some(b) if b.kind() == "ordered_field_declaration_list" => {
                        VariantPayload::Tuple(named_children(b).into_iter().map(|t| map_type_str(node_text(t, src), LanguageId::Rust)).collect())
                    }
                    _ => VariantPayload::Unit,
                };
                variants.push(EnumVariant { name: vn, payload, discriminant: None, trivia: Trivia::default() });
            }
        }
    }
    EnumDecl { vis, name, type_params, variants, trivia: tr, span: node_span(node) }
}

fn decompile_trait(node: Node<'_>, vis: Visibility, src: &str, opts: &TranspileOpts, mut tr: Trivia) -> TypeDecl {
    let name = field_text(node, "name", src).unwrap_or("Trait").to_string();
    let (type_params, attrs) = extract_rs_generics(node, src);
    push_attrs_to_trivia(&mut tr, attrs);
    let extends = node.child_by_field_name("bounds").map(|bs| {
        named_children(bs).into_iter()
            .map(|b| node_text(b, src).trim().to_string())
            .filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == ':'))
            .collect()
    }).unwrap_or_default();
    let mut methods = Vec::new();
    if let Some(body) = node.child_by_field_name("body") {
        for ch in named_children(body) {
            if matches!(ch.kind(), "function_item" | "function_signature_item") {
                methods.push(rs_fn_to_method(decompile_rs_fn(ch, Visibility::Default, src, opts, Trivia::default())));
            }
        }
    }
    TypeDecl {
        vis, kind: TypeKind::Trait, name, type_params, extends,
        fields: Vec::new(), methods, alias_target: None, trivia: tr, span: node_span(node),
    }
}

fn decompile_rs_fn(node: Node<'_>, vis: Visibility, src: &str, opts: &TranspileOpts, tr: Trivia) -> FnDecl {
    let name = field_text(node, "name", src).unwrap_or("fn_anon").to_string();
    let is_async = node_text(node, src).trim_start().contains("async fn");
    let (type_params, attrs) = extract_rs_generics(node, src);
    let decorators = attrs.into_iter().map(|a| a.trim_start_matches('@').to_string()).collect();
    let mut params = Vec::new();
    if let Some(plist) = node.child_by_field_name("parameters") {
        for ch in named_children(plist) {
            match ch.kind() {
                "self_parameter" => {
                    let raw = node_text(ch, src).trim();
                    let (is_mut, name) = raw.strip_prefix("mut ").map_or((false, raw.to_string()), |r| (true, r.trim().to_string()));
                    params.push(ParamDecl { name, vis: Visibility::Default, is_readonly: false, is_mut, is_optional: false, is_rest: false, ty: None, default: None, trivia: Trivia::default() });
                }
                "parameter" => {
                    let raw = field_text(ch, "pattern", src).unwrap_or("p").trim();
                    let is_mut = child_by_kind(ch, "mutable_specifier").is_some() || raw.starts_with("mut ");
                    let name = raw.strip_prefix("mut ").unwrap_or(raw).trim().to_string();
                    let ty = field_text(ch, "type", src).map(|t| map_type_str(t, LanguageId::Rust));
                    params.push(ParamDecl { name, vis: Visibility::Default, is_readonly: false, is_mut, is_optional: false, is_rest: false, ty, default: None, trivia: Trivia::default() });
                }
                _ => {}
            }
        }
    }
    let return_type = field_text(node, "return_type", src).map(|t| map_type_str(t, LanguageId::Rust));
    let body = node.child_by_field_name("body").map(|b| {
        let mut stmts = decompile_block(b, src, LanguageId::Rust, opts);
        if matches!(stmts.last(), Some(Stmt::Expr { .. }))
            && let Some(mut last_st) = stmts.pop()
            && let Stmt::Expr { expr, trivia } = &mut last_st
        {
            let e = std::mem::replace(expr, crate::ir_code::Expr::Ident(String::new()));
            stmts.push(Stmt::Return { value: Some(e), trivia: std::mem::take(trivia) });
        }
        FnBody::Block(stmts)
    }).unwrap_or(FnBody::SignatureOnly);
    FnDecl {
        vis, is_async, is_static: false, decorators, name,
        type_params, params, return_type, body, trivia: tr, span: node_span(node),
    }
}

fn extract_rs_generics(node: Node<'_>, src: &str) -> (Vec<TypeParam>, Vec<String>) {
    let (mut tps, mut lifetimes, mut extra_where) = (Vec::new(), Vec::new(), Vec::new());
    if let Some(tp_node) = node.child_by_field_name("type_parameters") {
        for ch in named_children(tp_node) {
            match ch.kind() {
                "lifetime_parameter" | "lifetime" => lifetimes.push(normalize_single_line(node_text(ch, src))),
                "const_parameter" => tps.push(TypeParam {
                    name: field_text(ch, "name", src).unwrap_or("N").trim().to_string(),
                    bounds: field_text(ch, "type", src).map(|t| vec![map_type_str(t, LanguageId::Rust)]).unwrap_or_default(),
                    default: field_text(ch, "value", src).map(|v| AiceType::Raw(v.trim().to_string())),
                }),
                "type_parameter" | "constrained_type_parameter" | "optional_type_parameter" | "type_identifier" => {
                    let name = field_text(ch, "name", src).or_else(|| field_text(ch, "left", src))
                        .unwrap_or_else(|| node_text(ch, src).split([':', '=']).next().unwrap_or("T")).trim().to_string();
                    let bounds = ch.child_by_field_name("bounds").map(|b| rs_collect_bounds(b, src)).unwrap_or_default();
                    let default = ch.child_by_field_name("default_type").or_else(|| ch.child_by_field_name("value")).map(|d| rs_bound_type(d, src));
                    if !name.is_empty() { tps.push(TypeParam { name, bounds, default }); }
                }
                _ => {}
            }
        }
    }
    if let Some(wc) = child_by_kind(node, "where_clause") {
        for wp in named_children(wc).into_iter().filter(|n| n.kind() == "where_predicate") {
            let left = field_text(wp, "left", src).unwrap_or("").trim();
            let bs = wp.child_by_field_name("bounds").map(|b| rs_collect_bounds(b, src)).unwrap_or_default();
            if !bs.is_empty() && let Some(tp) = tps.iter_mut().find(|tp| tp.name == left) { tp.bounds.extend(bs); }
            else { extra_where.push(normalize_single_line(node_text(wp, src))); }
        }
    }
    let mut attrs = Vec::new();
    if !lifetimes.is_empty() { attrs.push(format!("@lifetimes(\"{}\")", rs_esc(&lifetimes.join(", ")))); }
    if !extra_where.is_empty() { attrs.push(format!("@where(\"{}\")", rs_esc(&extra_where.join(", ")))); }
    (tps, attrs)
}

fn rs_collect_bounds(bounds_node: Node<'_>, src: &str) -> Vec<AiceType> {
    named_children(bounds_node).into_iter().map(|b| rs_bound_type(b, src)).collect()
}

fn rs_bound_type(b: Node<'_>, src: &str) -> AiceType {
    let raw = normalize_single_line(node_text(b, src));
    if b.kind() == "higher_ranked_trait_bound" || raw.starts_with("for<") || raw.starts_with("for ") {
        AiceType::Raw(raw)
    } else { map_type_str(&raw, LanguageId::Rust) }
}

fn rs_esc(s: &str) -> String { s.replace('\\', "\\\\").replace('"', "\\\"") }

fn rs_vis(node: Node<'_>, src: &str) -> Visibility {
    let Some(vm) = child_by_kind(node, "visibility_modifier") else { return Visibility::Private; };
    match node_text(vm, src).trim() {
        "pub" => Visibility::Public, "pub(super)" => Visibility::Protected, _ => Visibility::Package,
    }
}
