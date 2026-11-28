use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::csharp_java::{
    extract_java_annotations, extract_java_heritage, extract_java_iface_extends,
    extract_java_type_params, java_body_has_unhandled, java_has_mod,
};
use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_span, node_text, with_ts_root};
use crate::decompile::expr_common::decompile_expr;
use crate::decompile::stmt_common::decompile_block;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::decompile::ts_helpers::push_attrs_to_trivia;
use crate::ir::{AiceItem, AiceModule, ImportDecl, TranspileError, TranspileOpts, Trivia, Visibility};
use crate::ir_code::{AccessorKind, ClassDecl, Expr, FnBody, MethodDecl, PropDecl, Stmt};
use crate::ir_types::{EnumDecl, EnumVariant, ParamDecl, TypeDecl, TypeKind, VariantPayload};

#[derive(Default)]
struct JavaBodyMembers {
    props: Vec<PropDecl>,
    methods: Vec<MethodDecl>,
    static_blocks: Vec<Vec<Stmt>>,
}

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    with_ts_root(tree, |root| {
        let mut m = AiceModule::new(LanguageId::Java, "java");
        for ch in named_children(root) {
            if is_comment_kind(ch.kind()) { continue; }
            let tr = collect_trivia(ch, src, opts);
            match ch.kind() {
                "package_declaration" => {
                    let pkg = node_text(ch, src).trim().trim_start_matches("package ").trim_end_matches(';').trim().to_string();
                    m.module_name = pkg;
                }
                "import_declaration" => {
                    let imp = node_text(ch, src).trim().trim_start_matches("import ").trim_end_matches(';').trim().to_string();
                    m.items.push(AiceItem::Import(ImportDecl {
                        vis: Visibility::Default, source: imp, specifiers: Vec::new(),
                        is_type_only: false, trivia: tr, span: node_span(ch),
                    }));
                }
                "interface_declaration" | "class_declaration" | "record_declaration" | "enum_declaration" => {
                    decompile_java_type_item(ch, src, opts, tr, None, &mut m.items);
                }
                _ => crate::decompile::fallback::push_top_directive(&mut m, ch, src, tr),
            }
        }
        Ok(m)
    })
}

fn decompile_java_type_item(
    node: Node<'_>,
    src: &str,
    opts: &TranspileOpts,
    tr: Trivia,
    parent: Option<&str>,
    out: &mut Vec<AiceItem>,
) {
    match node.kind() {
        "interface_declaration" => {
            let (mut nested, mut itr) = (Vec::new(), tr);
            push_attrs_to_trivia(&mut itr, extract_java_annotations(node, src));
            let cd = decompile_java_class(node, src, opts, itr.clone(), parent, &mut nested);
            if let Some(p) = parent {
                out.push(AiceItem::Directive { text: format!("@nested({p})"), trivia: Trivia::default(), span: node_span(node) });
            }
            out.push(AiceItem::Type(TypeDecl {
                vis: cd.vis, kind: TypeKind::Interface, name: cd.name, type_params: cd.type_params,
                extends: extract_java_iface_extends(node, src), fields: Vec::new(), methods: cd.methods,
                alias_target: None, trivia: itr, span: cd.span,
            }));
            out.extend(nested);
        }
        "class_declaration" | "record_declaration" => {
            let mut nested = Vec::new();
            let cd = decompile_java_class(node, src, opts, tr, parent, &mut nested);
            out.push(AiceItem::Class(cd));
            out.extend(nested);
        }
        "enum_declaration" => {
            decompile_java_enum(node, src, opts, tr, parent, out);
        }
        _ => crate::decompile::fallback::push_top_directive_vec(out, node, src, tr),
    }
}

fn decompile_java_enum(
    node: Node<'_>,
    src: &str,
    opts: &TranspileOpts,
    tr: Trivia,
    parent: Option<&str>,
    out: &mut Vec<AiceItem>,
) {
    let name = field_text(node, "name", src).unwrap_or("Enum").to_string();
    let vis = java_vis(node, src);
    let cur_path = match parent { Some(p) => format!("{p}.{name}"), None => name.clone() };
    let mut consts = Vec::new();
    let mut members = JavaBodyMembers::default();
    let mut nested = Vec::new();
    if let Some(body) = node.child_by_field_name("body") {
        for c in named_children(body) {
            if c.kind() == "enum_constant" {
                let vn = field_text(c, "name", src).unwrap_or("V").to_string();
                let ctr = collect_trivia(c, src, opts);
                let args = c.child_by_field_name("arguments").or_else(|| child_by_kind(c, "argument_list")).map(|al| {
                    named_children(al).into_iter().filter(|a| !is_comment_kind(a.kind()))
                        .map(|a| decompile_expr(a, src, LanguageId::Java)).collect::<Vec<_>>()
                });
                let cbody = c.child_by_field_name("body").or_else(|| child_by_kind(c, "class_body"));
                consts.push((vn, args, cbody, ctr));
            } else if c.kind() == "enum_body_declarations" {
                decompile_java_body_members(c, &name, &cur_path, src, opts, &mut members, &mut nested);
            }
        }
    }
    let implements = extract_java_heritage(node, src).1;
    let is_rich = !implements.is_empty()
        || consts.iter().any(|(_, a, b, _)| a.is_some() || b.is_some())
        || !members.props.is_empty() || !members.methods.is_empty() || !members.static_blocks.is_empty();
    if is_rich {
        let mut decorators: Vec<String> = extract_java_annotations(node, src).into_iter().map(|a| a.trim_start_matches('@').to_string()).collect();
        if let Some(p) = parent { decorators.push(format!("nested({p})")); }
        decorators.push("enum".into());
        let (mut all_props, mut variant_bodies) = (Vec::with_capacity(consts.len() + members.props.len()), Vec::new());
        for (vn, args, cbody, mut ctr) in consts {
            push_attrs_to_trivia(&mut ctr, vec!["@variant".into()]);
            let mut init = args.map(|a| Expr::Call {
                callee: Box::new(Expr::Ident(name.clone())), args: a, is_new: false, is_optional: false, is_tagged: false,
            });
            if let Some(bn) = cbody {
                if java_body_has_unhandled(bn) {
                    let s = bn.parent().and_then(|p| p.child_by_field_name("arguments").or_else(|| child_by_kind(p, "argument_list")))
                        .map_or(bn.start_byte(), |a| a.start_byte());
                    init = Some(Expr::Raw(src[s..bn.end_byte()].trim().to_string()));
                } else {
                    let mut cm = JavaBodyMembers::default();
                    decompile_java_body_members(bn, &vn, &format!("{cur_path}.{vn}"), src, opts, &mut cm, &mut nested);
                    variant_bodies.push(AiceItem::Class(ClassDecl {
                        vis: Visibility::Default, is_abstract: false,
                        decorators: vec![format!("nested({cur_path})"), "variant_body".into()],
                        name: vn.clone(), type_params: Vec::new(), primary_ctor: Vec::new(),
                        extends: None, implements: Vec::new(), props: cm.props, methods: cm.methods,
                        static_blocks: cm.static_blocks, trivia: Trivia::default(), span: node_span(bn),
                    }));
                }
            }
            all_props.push(PropDecl {
                name: vn, aliases: Vec::new(), vis: Visibility::Default, is_static: false,
                is_readonly: false, is_mut: false, is_optional: false, ty: None, init, trivia: ctr,
            });
        }
        all_props.extend(members.props);
        out.push(AiceItem::Class(ClassDecl {
            vis, is_abstract: false, decorators, name, type_params: Vec::new(), primary_ctor: Vec::new(),
            extends: None, implements, props: all_props, methods: members.methods,
            static_blocks: members.static_blocks, trivia: tr, span: node_span(node),
        }));
        out.extend(variant_bodies);
    } else {
        let mut etr = tr;
        push_attrs_to_trivia(&mut etr, extract_java_annotations(node, src));
        if let Some(p) = parent {
            out.push(AiceItem::Directive { text: format!("@nested({p})"), trivia: Trivia::default(), span: node_span(node) });
        }
        let variants = consts.into_iter().map(|(vn, _, _, ctr)| EnumVariant {
            name: vn, payload: VariantPayload::Unit, discriminant: None, trivia: ctr,
        }).collect();
        out.push(AiceItem::Enum(EnumDecl { vis, name, type_params: Vec::new(), variants, trivia: etr, span: node_span(node) }));
    }
    out.extend(nested);
}

#[allow(clippy::too_many_arguments)]
fn decompile_java_body_members(
    body: Node<'_>,
    cls_name: &str,
    cur_path: &str,
    src: &str,
    opts: &TranspileOpts,
    out: &mut JavaBodyMembers,
    nested_out: &mut Vec<AiceItem>,
) {
    for ch in named_children(body) {
        if is_comment_kind(ch.kind()) { continue; }
        let mtr = collect_trivia(ch, src, opts);
        let mvis = java_vis(ch, src);
        match ch.kind() {
            "static_initializer" => {
                let blk = child_by_kind(ch, "block")
                    .or_else(|| ch.child_by_field_name("body"))
                    .unwrap_or(ch);
                out.static_blocks.push(decompile_block(blk, src, LanguageId::Java, opts));
            }
            "field_declaration" => {
                let mut mtr = mtr;
                push_attrs_to_trivia(&mut mtr, extract_java_annotations(ch, src));
                let ty = field_text(ch, "type", src).map(|t| map_type_str(t, LanguageId::Java));
                let mod_txt = child_by_kind(ch, "modifiers").map(|m| node_text(m, src)).unwrap_or("");
                for d in named_children(ch) {
                    if d.kind() == "variable_declarator" {
                        let fnm = field_text(d, "name", src).unwrap_or("f").to_string();
                        let init = d.child_by_field_name("value").map(|v| decompile_expr(v, src, LanguageId::Java));
                        out.props.push(PropDecl {
                            name: fnm, aliases: Vec::new(), vis: mvis,
                            is_static: mod_txt.contains("static"), is_readonly: mod_txt.contains("final"),
                            is_mut: !mod_txt.contains("final"), is_optional: false, ty: ty.clone(), init, trivia: mtr.clone(),
                        });
                    }
                }
            }
            "method_declaration" | "constructor_declaration" => {
                let is_ctor = ch.kind() == "constructor_declaration";
                let mname = field_text(ch, "name", src).unwrap_or(cls_name).to_string();
                let type_params = extract_java_type_params(ch, src);
                let params = ch.child_by_field_name("parameters").map(|p| java_params(p, src)).unwrap_or_default();
                let ret = if is_ctor { None } else { field_text(ch, "type", src).map(|t| map_type_str(t, LanguageId::Java)) };
                let mbody = ch.child_by_field_name("body").map(|b| FnBody::Block(decompile_block(b, src, LanguageId::Java, opts))).unwrap_or(FnBody::SignatureOnly);
                let mut mtr = mtr;
                push_attrs_to_trivia(&mut mtr, extract_java_annotations(ch, src));
                if !is_ctor && java_has_mod(ch, src, "abstract") { push_attrs_to_trivia(&mut mtr, vec!["@abstract".into()]); }
                out.methods.push(MethodDecl {
                    vis: mvis, is_static: java_has_mod(ch, src, "static"), is_async: false, is_const: false,
                    accessor: if is_ctor { AccessorKind::Constructor } else { AccessorKind::Normal },
                    name: if is_ctor { "constructor".into() } else { mname },
                    type_params, params, return_type: ret, body: mbody, trivia: mtr, span: node_span(ch),
                });
            }
            "record_declaration" | "class_declaration" | "interface_declaration" | "enum_declaration" => {
                decompile_java_type_item(ch, src, opts, mtr, Some(cur_path), nested_out);
            }
            _ => crate::decompile::fallback::push_raw_member(&mut out.methods, ch, src, Visibility::Default, mtr),
        }
    }
}

fn decompile_java_class(
    node: Node<'_>,
    src: &str,
    opts: &TranspileOpts,
    tr: Trivia,
    parent: Option<&str>,
    nested_out: &mut Vec<AiceItem>,
) -> ClassDecl {
    let name = field_text(node, "name", src).unwrap_or("Class").to_string();
    let vis = java_vis(node, src);
    let type_params = extract_java_type_params(node, src);
    let cur_path = match parent { Some(p) => format!("{p}.{name}"), None => name.clone() };
    let mut members = JavaBodyMembers::default();
    if let Some(body) = node.child_by_field_name("body") {
        decompile_java_body_members(body, &name, &cur_path, src, opts, &mut members, nested_out);
    }
    let mut decorators: Vec<String> = extract_java_annotations(node, src).into_iter().map(|a| a.trim_start_matches('@').to_string()).collect();
    if let Some(p) = parent { decorators.push(format!("nested({p})")); }
    if parent.is_some() && java_has_mod(node, src, "static") { decorators.push("static".into()); }
    if node.kind() == "record_declaration" { decorators.push("record".into()); }
    let is_abstract = java_has_mod(node, src, "abstract");
    let (extends, implements) = extract_java_heritage(node, src);
    let primary_ctor = node.child_by_field_name("parameters")
        .or_else(|| child_by_kind(node, "formal_parameters"))
        .map(|p| java_params(p, src))
        .unwrap_or_default();
    ClassDecl {
        vis, is_abstract, decorators, name, type_params,
        primary_ctor, extends, implements,
        props: members.props, methods: members.methods, static_blocks: members.static_blocks,
        trivia: tr, span: node_span(node),
    }
}

fn java_params(pl: Node<'_>, src: &str) -> Vec<ParamDecl> {
    let mut out = Vec::new();
    for ch in named_children(pl) {
        if ch.kind() == "formal_parameter" {
            let name = field_text(ch, "name", src).unwrap_or("p").to_string();
            let ty = field_text(ch, "type", src).map(|t| map_type_str(t, LanguageId::Java));
            out.push(ParamDecl {
                name, vis: Visibility::Default, is_readonly: false, is_mut: false,
                is_optional: false, is_rest: false, ty, default: None, trivia: Trivia::default(),
            });
        }
    }
    out
}

fn java_vis(node: Node<'_>, src: &str) -> Visibility {
    let Some(mods) = child_by_kind(node, "modifiers") else { return Visibility::Package; };
    let txt = node_text(mods, src);
    if txt.contains("public") { Visibility::Public }
    else if txt.contains("private") { Visibility::Private }
    else if txt.contains("protected") { Visibility::Protected }
    else { Visibility::Package }
}
