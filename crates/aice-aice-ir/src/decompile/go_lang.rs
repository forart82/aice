use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::cst_util::{field_text, map_type_str, named_children, node_span, node_text, strip_quotes, with_ts_root};
use crate::decompile::expr_common::decompile_expr;
use crate::decompile::stmt_common::decompile_block;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::decompile::ts_helpers::push_attrs_to_trivia;
use crate::ir::{AiceItem, AiceModule, ImportDecl, TranspileError, TranspileOpts, Trivia, Visibility};
use crate::ir_code::{ClassDecl, ConstDecl, FnBody, FnDecl, MethodDecl, PropDecl};
use crate::ir_types::{FieldDecl, FieldSigil, ParamDecl, TypeDecl, TypeKind, TypeParam};

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    with_ts_root(tree, |root| {
        let mut m = AiceModule::new(LanguageId::Go, "main");
        let mut methods: Vec<(String, MethodDecl)> = Vec::new();
        for ch in named_children(root) {
            if is_comment_kind(ch.kind()) { continue; }
            let tr = collect_trivia(ch, src, opts);
            match ch.kind() {
                "package_clause" => {
                    if let Some(pkg) = named_children(ch).into_iter().next() {
                        m.module_name = node_text(pkg, src).trim().to_string();
                    }
                }
                "import_declaration" => {
                    for sp in collect_import_specs(ch) {
                        let path = field_text(sp, "path", src).map(strip_quotes).unwrap_or_else(|| strip_quotes(node_text(sp, src)));
                        m.items.push(AiceItem::Import(ImportDecl {
                            vis: Visibility::Default, source: path, specifiers: Vec::new(),
                            is_type_only: false, trivia: tr.clone(), span: node_span(sp),
                        }));
                    }
                }
                "type_declaration" => {
                    for spec in named_children(ch) {
                        if spec.kind() == "type_spec" {
                            m.items.push(decompile_type_spec(spec, src, opts, tr.clone()));
                        }
                    }
                }
                "const_declaration" => {
                    for spec in named_children(ch) {
                        if spec.kind() == "const_spec" {
                            let nm = field_text(spec, "name", src).unwrap_or("C").to_string();
                            let ty = field_text(spec, "type", src).map(|t| map_type_str(t, LanguageId::Go));
                            let val = spec.child_by_field_name("value").map(|v| decompile_expr(v, src, LanguageId::Go))
                                .unwrap_or(crate::ir_code::Expr::Literal(crate::ir_expr::LiteralVal::Nil));
                            m.items.push(AiceItem::Const(ConstDecl { vis: go_vis(&nm), name: nm, ty, value: val, trivia: tr.clone(), span: node_span(spec) }));
                        }
                    }
                }
                "function_declaration" => m.items.push(AiceItem::Fn(decompile_go_fn(ch, src, opts, tr))),
                "method_declaration" => {
                    let recv_ty = ch.child_by_field_name("receiver")
                        .and_then(|r| named_children(r).into_iter().find(|c| c.kind() == "parameter_declaration"))
                        .and_then(|pd| field_text(pd, "type", src))
                        .map(|t| t.trim().trim_start_matches('*').split('[').next().unwrap_or("Recv").trim().to_string())
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| "Recv".to_string());
                    let f = decompile_go_fn(ch, src, opts, tr);
                    methods.push((recv_ty, MethodDecl {
                        vis: f.vis, is_static: false, is_async: false, is_const: false,
                        accessor: Default::default(), name: f.name, type_params: f.type_params,
                        params: f.params, return_type: f.return_type, body: f.body, trivia: f.trivia, span: f.span,
                    }));
                }
                _ => {}
            }
        }
        for (recv_ty, md) in methods {
            if let Some(idx) = m.items.iter().position(|it| matches!(it, AiceItem::Type(t) if t.name == recv_ty)) {
                if let AiceItem::Type(td) = m.items.remove(idx) {
                    let props = td.fields.into_iter().map(|f| PropDecl {
                        name: f.name, aliases: Vec::new(), vis: f.vis, is_static: false, is_readonly: false,
                        is_mut: true, is_optional: false, ty: f.ty, init: None, trivia: f.trivia,
                    }).collect();
                    m.items.insert(idx, AiceItem::Class(ClassDecl {
                        vis: td.vis, is_abstract: false, decorators: Vec::new(), name: td.name,
                        type_params: td.type_params, primary_ctor: Vec::new(), extends: None, implements: Vec::new(),
                        props, methods: vec![md], static_blocks: Vec::new(), trivia: td.trivia, span: td.span,
                    }));
                }
            } else if let Some(AiceItem::Class(cd)) = m.items.iter_mut().find(|it| matches!(it, AiceItem::Class(c) if c.name == recv_ty)) {
                cd.methods.push(md);
            } else {
                m.items.push(AiceItem::Class(ClassDecl {
                    vis: Visibility::Default, is_abstract: false, decorators: Vec::new(), name: recv_ty,
                    type_params: Vec::new(), primary_ctor: Vec::new(), extends: None, implements: Vec::new(),
                    props: Vec::new(), methods: vec![md], static_blocks: Vec::new(), trivia: Trivia::default(), span: Default::default(),
                }));
            }
        }
        Ok(m)
    })
}

fn collect_import_specs(node: Node<'_>) -> Vec<Node<'_>> {
    let mut out = Vec::new();
    for ch in named_children(node) {
        if ch.kind() == "import_spec" { out.push(ch); }
        else if ch.kind() == "import_spec_list" {
            for sp in named_children(ch) { if sp.kind() == "import_spec" { out.push(sp); } }
        }
    }
    out
}

fn extract_go_type_params(node: Node<'_>, src: &str) -> Vec<TypeParam> {
    let Some(tpl) = node.child_by_field_name("type_parameters") else { return Vec::new(); };
    let mut out = Vec::new();
    for tpd in named_children(tpl) {
        if tpd.kind() != "type_parameter_declaration" { continue; }
        let constraint = field_text(tpd, "type", src).map(|t| map_type_str(t, LanguageId::Go));
        let mut cur = tpd.walk();
        let names: Vec<String> = tpd
            .children_by_field_name("name", &mut cur)
            .map(|n| node_text(n, src).trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        for name in names {
            out.push(TypeParam { name, bounds: constraint.clone().into_iter().collect(), default: None });
        }
    }
    out
}

fn format_go_tag_attr(tag_raw: &str) -> String {
    let t = tag_raw.trim();
    if t.starts_with('`') && t.ends_with('`') && !t.contains("${") {
        format!("@tag({t})")
    } else {
        format!("@tag(\"{}\")", t.replace('\\', "\\\\").replace('"', "\\\""))
    }
}

fn decompile_type_spec(node: Node<'_>, src: &str, _opts: &TranspileOpts, tr: Trivia) -> AiceItem {
    let name = field_text(node, "name", src).unwrap_or("Type").to_string();
    let vis = go_vis(&name);
    let type_params = extract_go_type_params(node, src);
    let mut kind = TypeKind::Struct;
    let mut fields = Vec::new();
    let mut methods = Vec::new();
    if let Some(ty_node) = node.child_by_field_name("type") {
        if ty_node.kind() == "struct_type"
            && let Some(fl) = named_children(ty_node).into_iter().find(|c| c.kind() == "field_declaration_list")
        {
            for fd in named_children(fl) {
                if fd.kind() == "field_declaration" {
                    let fty = field_text(fd, "type", src).map(|t| map_type_str(t, LanguageId::Go));
                    let tag_attr = field_text(fd, "tag", src).map(format_go_tag_attr);
                    let mut cur = fd.walk();
                    let names: Vec<String> = fd
                        .children_by_field_name("name", &mut cur)
                        .map(|n| node_text(n, src).trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                    let names = if names.is_empty() { vec!["f".to_string()] } else { names };
                    for fnm in names {
                        let mut ftr = Trivia::default();
                        if let Some(ref ta) = tag_attr {
                            push_attrs_to_trivia(&mut ftr, vec![ta.clone()]);
                        }
                        fields.push(FieldDecl {
                            vis: go_vis(&fnm), name: fnm, is_readonly: false, is_optional: false,
                            sigil: FieldSigil::None, ty: fty.clone(), default: None, trivia: ftr,
                        });
                    }
                }
            }
        } else if ty_node.kind() == "interface_type" {
            kind = TypeKind::Interface;
            for me in named_children(ty_node) {
                if matches!(me.kind(), "method_elem" | "method_spec") {
                    let mnm = field_text(me, "name", src).unwrap_or("M").to_string();
                    let params = me.child_by_field_name("parameters")
                        .map(|pl| extract_go_params(pl, src))
                        .unwrap_or_default();
                    let ret = field_text(me, "result", src).map(|t| map_type_str(t, LanguageId::Go));
                    methods.push(MethodDecl {
                        vis: go_vis(&mnm), is_static: false, is_async: false, is_const: false,
                        accessor: Default::default(), name: mnm, type_params: Vec::new(), params,
                        return_type: ret, body: FnBody::SignatureOnly, trivia: Trivia::default(), span: node_span(me),
                    });
                } else if !is_comment_kind(me.kind()) {
                    let raw = node_text(me, src).trim();
                    if !raw.is_empty() {
                        fields.push(FieldDecl {
                            vis: Visibility::Default, name: String::new(), is_readonly: false,
                            is_optional: false, sigil: FieldSigil::None,
                            ty: Some(crate::ir_types::AiceType::Raw(raw.to_string())),
                            default: None, trivia: Trivia::default(),
                        });
                    }
                }
            }
        }
    }
    AiceItem::Type(TypeDecl {
        vis, kind, name, type_params, extends: Vec::new(),
        fields, methods, alias_target: None, trivia: tr, span: node_span(node),
    })
}

fn extract_go_params(pl: Node<'_>, src: &str) -> Vec<ParamDecl> {
    let mut params = Vec::new();
    for pd in named_children(pl) {
        if pd.kind() == "parameter_declaration" {
            let pty = field_text(pd, "type", src).map(|t| map_type_str(t, LanguageId::Go));
            let mut cur = pd.walk();
            let names: Vec<String> = pd
                .children_by_field_name("name", &mut cur)
                .map(|n| node_text(n, src).trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            let names = if names.is_empty() { vec!["p".to_string()] } else { names };
            for pnm in names {
                params.push(ParamDecl {
                    name: pnm, vis: Visibility::Default, is_readonly: false, is_mut: false,
                    is_optional: false, is_rest: false, ty: pty.clone(), default: None, trivia: Trivia::default(),
                });
            }
        } else if pd.kind() == "variadic_parameter_declaration" {
            let pnm = field_text(pd, "name", src)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "args".to_string());
            let pty = field_text(pd, "type", src).map(|t| map_type_str(t, LanguageId::Go));
            params.push(ParamDecl {
                name: pnm, vis: Visibility::Default, is_readonly: false, is_mut: false,
                is_optional: false, is_rest: true, ty: pty, default: None, trivia: Trivia::default(),
            });
        }
    }
    params
}

fn decompile_go_fn(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> FnDecl {
    let name = field_text(node, "name", src).unwrap_or("Fn").to_string();
    let type_params = extract_go_type_params(node, src);
    let params = node.child_by_field_name("parameters")
        .map(|pl| extract_go_params(pl, src))
        .unwrap_or_default();
    let return_type = field_text(node, "result", src).map(|t| map_type_str(t, LanguageId::Go));
    let body = node.child_by_field_name("body").map(|b| FnBody::Block(decompile_block(b, src, LanguageId::Go, opts))).unwrap_or(FnBody::SignatureOnly);
    FnDecl {
        vis: go_vis(&name), is_async: false, is_static: false, decorators: Vec::new(), name,
        type_params, params, return_type, body, trivia: tr, span: node_span(node),
    }
}

fn go_vis(name: &str) -> Visibility {
    if name.chars().next().is_some_and(|c| c.is_ascii_uppercase()) { Visibility::Public } else { Visibility::Package }
}
