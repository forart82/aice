use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::cst_util::{
    child_by_kind, field_text, named_children, node_span, node_text, strip_quotes, with_ts_root,
};
use crate::decompile::expr_common::decompile_expr;
use crate::decompile::stmt_common::decompile_block;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::decompile::ts_helpers::{
    extract_ts_class_heritage, extract_ts_decorators, format_ts_decorator_attr, is_ts_prop_optional,
    is_ts_readonly_prefix, push_attrs_to_trivia,
};
use crate::decompile::tsx_jsx::{extract_ts_params, extract_ts_type_params, map_ts_type_node, try_extract_jsx_component};
use crate::ir::{
    AiceItem, AiceModule, ImportDecl, ImportSpec, TranspileError, TranspileOpts, Trivia, Visibility,
};
use crate::ir_code::{AccessorKind, ClassDecl, ConstDecl, FnBody, FnDecl, MethodDecl, PropDecl, VarDecl};
use crate::ir_types::{EnumDecl, EnumVariant, FieldDecl, FieldSigil, TypeDecl, TypeKind, VariantPayload};

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    let lang = tree.language();
    with_ts_root(tree, |root| {
        let mut m = AiceModule::new(lang, lang.canonical_name());
        for ch in named_children(root) {
            if is_comment_kind(ch.kind()) { continue; }
            let tr = collect_trivia(ch, src, opts);
            decompile_top_item(ch, Visibility::Default, tr, src, lang, opts, &mut m);
        }
        Ok(m)
    })
}

fn decompile_top_item(
    mut node: Node<'_>,
    mut vis: Visibility,
    mut tr: Trivia,
    src: &str,
    lang: LanguageId,
    opts: &TranspileOpts,
    m: &mut AiceModule,
) {
    let mut decorators = Vec::new();
    while node.kind() == "export_statement" {
        decorators.extend(extract_ts_decorators(node, src));
        if let Some(decl) = node.child_by_field_name("declaration") {
            if tr.is_empty() { tr = collect_trivia(decl, src, opts); }
            vis = Visibility::Public;
            node = decl;
        } else {
            m.items.push(AiceItem::Directive { text: node_text(node, src).trim().into(), trivia: tr, span: node_span(node) });
            return;
        }
    }
    match node.kind() {
        "import_statement" => { m.items.push(AiceItem::Import(decompile_import(node, src, tr))); }
        "interface_declaration" => { m.items.push(AiceItem::Type(decompile_interface(node, vis, src, lang, tr))); }
        "type_alias_declaration" => {
            let name = field_text(node, "name", src).unwrap_or("Alias").to_string();
            let type_params = extract_ts_type_params(node, src, lang);
            let rhs = node.child_by_field_name("value").map(|v| map_ts_type_node(v, src, lang));
            m.items.push(AiceItem::Type(TypeDecl {
                vis, kind: TypeKind::Alias, name, type_params, extends: Vec::new(),
                fields: Vec::new(), methods: Vec::new(), alias_target: rhs, trivia: tr, span: node_span(node),
            }));
        }
        "enum_declaration" => { m.items.push(AiceItem::Enum(decompile_enum(node, vis, src, lang, tr))); }
        "class_declaration" | "abstract_class_declaration" => {
            m.items.push(AiceItem::Class(decompile_class(node, vis, decorators, src, lang, opts, tr)));
        }
        "function_declaration" => {
            let name = field_text(node, "name", src).unwrap_or("fn_anon").to_string();
            let type_params = extract_ts_type_params(node, src, lang);
            let params = node.child_by_field_name("parameters").map(|p| extract_ts_params(p, src, lang)).unwrap_or_default();
            if lang == LanguageId::Tsx
                && let Some(comp) = try_extract_jsx_component(node, vis, &name, type_params.clone(), params.clone(), src, lang, opts, tr.clone())
            {
                m.items.push(AiceItem::Component(comp));
                return;
            }
            let ret = node.child_by_field_name("return_type").map(|r| map_ts_type_node(r, src, lang));
            let body = node.child_by_field_name("body").map(|b| FnBody::Block(decompile_block(b, src, lang, opts))).unwrap_or(FnBody::SignatureOnly);
            m.items.push(AiceItem::Fn(FnDecl {
                vis, is_async: node_text(node, src).trim_start().starts_with("async "), is_static: false,
                decorators, name, type_params, params, return_type: ret, body, trivia: tr, span: node_span(node),
            }));
        }
        "lexical_declaration" | "variable_declaration" => {
            let raw = node_text(node, src);
            let is_const = raw.trim_start().starts_with("const ");
            for d in named_children(node) {
                if d.kind() == "variable_declarator" {
                    let name = field_text(d, "name", src).unwrap_or("x").to_string();
                    let ty = d.child_by_field_name("type").map(|t| map_ts_type_node(t, src, lang));
                    let value = d.child_by_field_name("value").map(|v| decompile_expr(v, src, lang))
                        .unwrap_or(crate::ir_code::Expr::Literal(crate::ir_expr::LiteralVal::Nil));
                    if is_const && ty.is_none() && vis == Visibility::Default {
                        m.items.push(AiceItem::Const(ConstDecl { vis, name, ty, value, trivia: tr.clone(), span: node_span(d) }));
                    } else {
                        m.items.push(AiceItem::Var(VarDecl { vis, is_mut: !is_const, name, ty, value, trivia: tr.clone(), span: node_span(d) }));
                    }
                }
            }
        }
        _ => {
            m.items.push(AiceItem::Directive { text: node_text(node, src).trim().into(), trivia: tr, span: node_span(node) });
        }
    }
}

fn decompile_import(node: Node<'_>, src: &str, tr: Trivia) -> ImportDecl {
    let raw = node_text(node, src);
    let is_type_only = raw.contains("import type ");
    let source = field_text(node, "source", src).map(strip_quotes).unwrap_or_default();
    let mut specifiers = Vec::new();
    if let Some(clause) = child_by_kind(node, "import_clause") {
        for ch in named_children(clause) {
            match ch.kind() {
                "identifier" => specifiers.push(ImportSpec { name: node_text(ch, src).into(), alias: None, is_wildcard: false, is_default: true, is_type: false }),
                "namespace_import" => {
                    let al = named_children(ch).into_iter().last().map(|a| node_text(a, src).to_string());
                    specifiers.push(ImportSpec { name: "*".into(), alias: al, is_wildcard: true, is_default: false, is_type: false });
                }
                "named_imports" => {
                    for sp in named_children(ch) {
                        if sp.kind() == "import_specifier" {
                            let is_t = node_text(sp, src).trim_start().starts_with("type ");
                            let name = field_text(sp, "name", src).unwrap_or_else(|| node_text(sp, src)).trim().to_string();
                            let alias = field_text(sp, "alias", src).map(str::to_string);
                            specifiers.push(ImportSpec { name, alias, is_wildcard: false, is_default: false, is_type: is_t });
                        }
                    }
                }
                _ => {}
            }
        }
    }
    ImportDecl { vis: Visibility::Default, source, specifiers, is_type_only, trivia: tr, span: node_span(node) }
}

fn decompile_interface(node: Node<'_>, vis: Visibility, src: &str, lang: LanguageId, tr: Trivia) -> TypeDecl {
    let name = field_text(node, "name", src).unwrap_or("Iface").to_string();
    let type_params = extract_ts_type_params(node, src, lang);
    let mut fields = Vec::new();
    let mut methods = Vec::new();
    if let Some(body) = node.child_by_field_name("body").or_else(|| child_by_kind(node, "interface_body")) {
        for ch in named_children(body) {
            if ch.kind() == "property_signature" {
                let fnm = field_text(ch, "name", src).unwrap_or("p").to_string();
                let ty = ch.child_by_field_name("type").map(|t| map_ts_type_node(t, src, lang));
                let opt = is_ts_prop_optional(ch, src);
                fields.push(FieldDecl {
                    name: fnm, vis: Visibility::Default, is_readonly: is_ts_readonly_prefix(ch, "name", src),
                    is_optional: opt, sigil: if opt { FieldSigil::Optional } else { FieldSigil::None },
                    ty, default: None, trivia: Trivia::default(),
                });
            } else if ch.kind() == "method_signature" {
                let mnm = field_text(ch, "name", src).unwrap_or("m").to_string();
                let mtps = extract_ts_type_params(ch, src, lang);
                let params = ch.child_by_field_name("parameters").map(|p| extract_ts_params(p, src, lang)).unwrap_or_default();
                let ret = ch.child_by_field_name("return_type").map(|r| map_ts_type_node(r, src, lang));
                methods.push(MethodDecl {
                    vis: Visibility::Default, is_static: false, is_async: false, is_const: false,
                    accessor: AccessorKind::Normal, name: mnm, type_params: mtps, params,
                    return_type: ret, body: FnBody::SignatureOnly, trivia: Trivia::default(), span: node_span(ch),
                });
            }
        }
    }
    TypeDecl {
        vis, kind: TypeKind::Interface, name, type_params, extends: Vec::new(),
        fields, methods, alias_target: None, trivia: tr, span: node_span(node),
    }
}

fn decompile_enum(node: Node<'_>, vis: Visibility, src: &str, lang: LanguageId, tr: Trivia) -> EnumDecl {
    let name = field_text(node, "name", src).unwrap_or("Enum").to_string();
    let mut variants = Vec::new();
    if let Some(body) = node.child_by_field_name("body") {
        for ch in named_children(body) {
            if ch.kind() == "enum_assignment" {
                let vn = field_text(ch, "name", src).unwrap_or("V").to_string();
                let disc = ch.child_by_field_name("value").map(|v| decompile_expr(v, src, lang));
                variants.push(EnumVariant { name: vn, payload: VariantPayload::Unit, discriminant: disc, trivia: Trivia::default() });
            } else if ch.kind() == "property_identifier" {
                variants.push(EnumVariant { name: node_text(ch, src).into(), payload: VariantPayload::Unit, discriminant: None, trivia: Trivia::default() });
            }
        }
    }
    EnumDecl { vis, name, type_params: Vec::new(), variants, trivia: tr, span: node_span(node) }
}

fn decompile_class(node: Node<'_>, vis: Visibility, mut decorators: Vec<String>, src: &str, lang: LanguageId, opts: &TranspileOpts, tr: Trivia) -> ClassDecl {
    let is_abstract = node.kind() == "abstract_class_declaration" || node_text(node, src).trim_start().starts_with("abstract ");
    decorators.extend(extract_ts_decorators(node, src));
    let name = field_text(node, "name", src).unwrap_or("Class").to_string();
    let type_params = extract_ts_type_params(node, src, lang);
    let (extends, implements) = extract_ts_class_heritage(node, src);
    let mut props = Vec::new();
    let mut methods = Vec::new();
    if let Some(body) = node.child_by_field_name("body") {
        let mut pending_decs: Vec<String> = Vec::new();
        for ch in named_children(body) {
            if is_comment_kind(ch.kind()) { continue; }
            if ch.kind() == "decorator" {
                pending_decs.push(format_ts_decorator_attr(ch, src));
                continue;
            }
            let mut mtr = collect_trivia(ch, src, opts);
            let mvis = extract_ts_vis(ch, src);
            let hdr_end = ch.child_by_field_name("name")
                .or_else(|| ch.child_by_field_name("parameters"))
                .map(|n| n.start_byte())
                .unwrap_or(ch.start_byte());
            let hdr = &src[ch.start_byte()..hdr_end];
            match ch.kind() {
                "public_field_definition" | "field_definition" => {
                    push_attrs_to_trivia(&mut mtr, std::mem::take(&mut pending_decs));
                    let pname = field_text(ch, "name", src).or_else(|| field_text(ch, "property", src)).unwrap_or("field").to_string();
                    let ty = ch.child_by_field_name("type").map(|t| map_ts_type_node(t, src, lang));
                    let init = ch.child_by_field_name("value").map(|v| decompile_expr(v, src, lang));
                    props.push(PropDecl {
                        name: pname.trim_start_matches('#').to_string(), aliases: Vec::new(),
                        vis: if pname.starts_with('#') { Visibility::Private } else { mvis },
                        is_static: hdr.contains("static "), is_readonly: hdr.contains("readonly "),
                        is_mut: false, is_optional: is_ts_prop_optional(ch, src), ty, init, trivia: mtr,
                    });
                }
                "method_definition" | "abstract_method_signature" => {
                    push_attrs_to_trivia(&mut mtr, std::mem::take(&mut pending_decs));
                    let mname = field_text(ch, "name", src).unwrap_or("method").to_string();
                    let accessor = if mname == "constructor" { AccessorKind::Constructor } else { AccessorKind::Normal };
                    let mtps = extract_ts_type_params(ch, src, lang);
                    let params = ch.child_by_field_name("parameters").map(|p| extract_ts_params(p, src, lang)).unwrap_or_default();
                    let ret = ch.child_by_field_name("return_type").map(|r| map_ts_type_node(r, src, lang));
                    let mbody = ch.child_by_field_name("body").map(|b| FnBody::Block(decompile_block(b, src, lang, opts))).unwrap_or(FnBody::SignatureOnly);
                    methods.push(MethodDecl {
                        vis: mvis, is_static: hdr.contains("static "), is_async: hdr.contains("async "), is_const: false,
                        accessor, name: mname, type_params: mtps, params, return_type: ret,
                        body: mbody, trivia: mtr, span: node_span(ch),
                    });
                }
                _ => { pending_decs.clear(); }
            }
        }
    }
    ClassDecl {
        vis, is_abstract, decorators, name, type_params,
        primary_ctor: Vec::new(), extends, implements,
        props, methods, static_blocks: Vec::new(), trivia: tr, span: node_span(node),
    }
}

fn extract_ts_vis(node: Node<'_>, src: &str) -> Visibility {
    for ch in named_children(node) {
        if ch.kind() == "accessibility_modifier" {
            return match node_text(ch, src).trim() {
                "public" => Visibility::Public,
                "private" => Visibility::Private,
                "protected" => Visibility::Protected,
                _ => Visibility::Default,
            };
        }
    }
    let header_end = node
        .child_by_field_name("name")
        .or_else(|| node.child_by_field_name("property"))
        .or_else(|| node.child_by_field_name("parameters"))
        .or_else(|| node.child_by_field_name("body"))
        .map(|n| n.start_byte())
        .unwrap_or(node.start_byte());
    let hdr = &src[node.start_byte()..header_end];
    if hdr.split_whitespace().any(|w| w == "private") { Visibility::Private }
    else if hdr.split_whitespace().any(|w| w == "protected") { Visibility::Protected }
    else if hdr.split_whitespace().any(|w| w == "public") { Visibility::Public }
    else { Visibility::Default }
}
