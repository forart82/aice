use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::cst_util::{field_text, map_type_str, named_children, node_span, node_text, with_ts_root};
use crate::decompile::expr_common::decompile_expr;
use crate::decompile::stmt_common::decompile_block;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::ir::{AiceItem, AiceModule, ImportDecl, ImportSpec, TranspileError, TranspileOpts, Trivia, Visibility};
use crate::ir_code::{ClassDecl, FnBody, FnDecl, MethodDecl, PropDecl, VarDecl};
use crate::ir_types::ParamDecl;

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    with_ts_root(tree, |root| {
        let mut m = AiceModule::new(LanguageId::Python, "python");
        for ch in named_children(root) {
            if is_comment_kind(ch.kind()) { continue; }
            let tr = collect_trivia(ch, src, opts);
            decompile_py_item(ch, Vec::new(), tr, src, opts, &mut m);
        }
        Ok(m)
    })
}

fn decompile_py_item(
    root: Node<'_>,
    init_decs: Vec<String>,
    init_tr: Trivia,
    src: &str,
    opts: &TranspileOpts,
    m: &mut AiceModule,
) {
    let mut stack = vec![(root, init_decs, init_tr)];
    while let Some((node, decorators, tr)) = stack.pop() {
        match node.kind() {
            "decorated_definition" => {
                let mut decs = decorators;
                let mut rest = Vec::new();
                for ch in named_children(node) {
                    if ch.kind() == "decorator" {
                        decs.push(node_text(ch, src).trim().trim_start_matches('@').to_string());
                    } else {
                        rest.push(ch);
                    }
                }
                for ch in rest.into_iter().rev() {
                    stack.push((ch, decs.clone(), tr.clone()));
                }
            }
        "import_statement" => {
            for ch in named_children(node) {
                m.items.push(AiceItem::Import(ImportDecl {
                    vis: Visibility::Default, source: node_text(ch, src).trim().into(),
                    specifiers: Vec::new(), is_type_only: false, trivia: tr.clone(), span: node_span(node),
                }));
            }
        }
        "import_from_statement" => {
            let source = field_text(node, "module_name", src).unwrap_or("").trim().to_string();
            let mut specs = Vec::new();
            for ch in named_children(node) {
                if ch.kind() == "dotted_name" && node.child_by_field_name("module_name").is_some_and(|m| m.id() != ch.id()) {
                    specs.push(ImportSpec { name: node_text(ch, src).trim().into(), alias: None, is_wildcard: false, is_default: false, is_type: false });
                } else if ch.kind() == "aliased_import" {
                    let nm = field_text(ch, "name", src).unwrap_or("").trim().to_string();
                    let al = field_text(ch, "alias", src).map(|s| s.trim().to_string());
                    specs.push(ImportSpec { name: nm, alias: al, is_wildcard: false, is_default: false, is_type: false });
                } else if ch.kind() == "wildcard_import" {
                    specs.push(ImportSpec { name: "*".into(), alias: None, is_wildcard: true, is_default: false, is_type: false });
                }
            }
            m.items.push(AiceItem::Import(ImportDecl {
                vis: Visibility::Default, source, specifiers: specs, is_type_only: false, trivia: tr, span: node_span(node),
            }));
        }
        "class_definition" => {
            let name = field_text(node, "name", src).unwrap_or("Class").to_string();
            let extends = node.child_by_field_name("superclasses").map(|s| node_text(s, src).trim_matches(|c| c == '(' || c == ')').trim().to_string()).filter(|s| !s.is_empty());
            let mut props = Vec::new();
            let mut methods = Vec::new();
            if let Some(body) = node.child_by_field_name("body") {
                for ch in named_children(body) {
                    if is_comment_kind(ch.kind()) { continue; }
                    let mtr = collect_trivia(ch, src, opts);
                    match ch.kind() {
                        "expression_statement" => {
                            if let Some(asn) = named_children(ch).into_iter().find(|c| c.kind() == "assignment") {
                                props.push(py_prop(asn, src, mtr));
                            }
                        }
                        "function_definition" => methods.push(py_method(ch, src, opts, mtr)),
                        _ => {}
                    }
                }
            }
            m.items.push(AiceItem::Class(ClassDecl {
                vis: py_vis(&name), is_abstract: false, decorators, name, type_params: Vec::new(),
                primary_ctor: Vec::new(), extends, implements: Vec::new(), props, methods,
                static_blocks: Vec::new(), trivia: tr, span: node_span(node),
            }));
        }
        "function_definition" => {
            let mut fd = py_fn(node, decorators, src, opts, tr);
            fd.vis = py_vis(&fd.name);
            m.items.push(AiceItem::Fn(fd));
        }
        "expression_statement" => {
            if let Some(asn) = named_children(node).into_iter().find(|c| c.kind() == "assignment") {
                let name = field_text(asn, "left", src).unwrap_or("x").to_string();
                let ty = field_text(asn, "type", src).map(|t| map_type_str(t, LanguageId::Python));
                let value = asn.child_by_field_name("right").map(|v| decompile_expr(v, src, LanguageId::Python))
                    .unwrap_or(crate::ir_code::Expr::Literal(crate::ir_expr::LiteralVal::Nil));
                m.items.push(AiceItem::Var(VarDecl { vis: py_vis(&name), is_mut: true, name, ty, value, trivia: tr, span: node_span(node) }));
            }
        }
        _ => {}
        }
    }
}

fn py_prop(asn: Node<'_>, src: &str, tr: Trivia) -> PropDecl {
    let name = field_text(asn, "left", src).unwrap_or("field").trim().to_string();
    let ty = field_text(asn, "type", src).map(|t| map_type_str(t, LanguageId::Python));
    let init = asn.child_by_field_name("right").map(|v| decompile_expr(v, src, LanguageId::Python));
    PropDecl {
        vis: py_vis(&name), name, aliases: Vec::new(), is_static: false, is_readonly: false,
        is_mut: true, is_optional: false, ty, init, trivia: tr,
    }
}

fn py_fn(node: Node<'_>, decorators: Vec<String>, src: &str, opts: &TranspileOpts, tr: Trivia) -> FnDecl {
    let name = field_text(node, "name", src).unwrap_or("fn_anon").to_string();
    let is_async = node_text(node, src).trim_start().starts_with("async ");
    let params = node.child_by_field_name("parameters").map(|p| py_params(p, src)).unwrap_or_default();
    let return_type = field_text(node, "return_type", src).map(|t| map_type_str(t, LanguageId::Python));
    let body = node.child_by_field_name("body").map(|b| FnBody::Block(decompile_block(b, src, LanguageId::Python, opts))).unwrap_or(FnBody::SignatureOnly);
    FnDecl {
        vis: Visibility::Default, is_async, is_static: false, decorators, name,
        type_params: Vec::new(), params, return_type, body, trivia: tr, span: node_span(node),
    }
}

fn py_method(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> MethodDecl {
    let f = py_fn(node, Vec::new(), src, opts, tr);
    MethodDecl {
        vis: py_vis(&f.name), is_static: false, is_async: f.is_async, is_const: false,
        accessor: Default::default(), name: f.name, type_params: f.type_params,
        params: f.params, return_type: f.return_type, body: f.body, trivia: f.trivia, span: f.span,
    }
}

fn py_params(pnode: Node<'_>, src: &str) -> Vec<ParamDecl> {
    let mut out = Vec::new();
    for ch in named_children(pnode) {
        let raw = node_text(ch, src).trim();
        if raw.is_empty() { continue; }
        let name = match ch.kind() {
            "identifier" => raw.to_string(),
            "typed_parameter" => named_children(ch).first().map(|c| node_text(*c, src).trim().to_string()).unwrap_or_else(|| raw.into()),
            "default_parameter" | "typed_default_parameter" => field_text(ch, "name", src).unwrap_or("p").trim().to_string(),
            _ => raw.trim_start_matches('*').split([':', '=']).next().unwrap_or("p").trim().to_string(),
        };
        let ty = field_text(ch, "type", src).map(|t| map_type_str(t, LanguageId::Python));
        let default = ch.child_by_field_name("value").map(|v| decompile_expr(v, src, LanguageId::Python));
        out.push(ParamDecl {
            name, vis: Visibility::Default, is_readonly: false, is_mut: false,
            is_optional: false, is_rest: raw.starts_with('*'), ty, default, trivia: Trivia::default(),
        });
    }
    out
}

fn py_vis(name: &str) -> Visibility {
    if name.starts_with("__") && !name.ends_with("__") { Visibility::Private }
    else if name.starts_with('_') { Visibility::Protected }
    else { Visibility::Public }
}
