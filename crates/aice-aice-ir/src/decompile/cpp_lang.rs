use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::c_lang::unwrap_c_declarator;
use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_span, node_text, with_ts_root};
use crate::decompile::stmt_common::decompile_block;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::ir::{AiceItem, AiceModule, ImportDecl, TranspileError, TranspileOpts, Trivia, Visibility};
use crate::ir_code::{AccessorKind, ClassDecl, FnBody, FnDecl, MethodDecl, PropDecl};
use crate::ir_types::{ParamDecl, TypeParam};

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    with_ts_root(tree, |root| {
        let mut m = AiceModule::new(LanguageId::Cpp, "cpp");
        for ch in named_children(root) {
            if is_comment_kind(ch.kind()) { continue; }
            collect_cpp_items(ch, src, opts, &mut m);
        }
        Ok(m)
    })
}

fn collect_cpp_items(root: Node<'_>, src: &str, opts: &TranspileOpts, m: &mut AiceModule) {
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        let tr = collect_trivia(node, src, opts);
        match node.kind() {
            "preproc_include" => {
                let path = field_text(node, "path", src).unwrap_or("").trim().to_string();
                m.items.push(AiceItem::Import(ImportDecl {
                    vis: Visibility::Default, source: path, specifiers: Vec::new(),
                    is_type_only: false, trivia: tr, span: node_span(node),
                }));
            }
            "namespace_definition" => {
                if let Some(nm) = field_text(node, "name", src) {
                    m.module_name = nm.trim().to_string();
                }
                if let Some(body) = node.child_by_field_name("body") {
                    for ch in named_children(body).into_iter().rev() {
                        if !is_comment_kind(ch.kind()) { stack.push(ch); }
                    }
                }
            }
            "class_specifier" | "struct_specifier" => {
                m.items.push(AiceItem::Class(decompile_cpp_class(node, src, opts, tr)));
            }
            "function_definition" => m.items.push(AiceItem::Fn(decompile_cpp_fn(node, src, opts, tr))),
            "template_declaration" => {
                let tps = extract_cpp_type_params(node, src);
                for ch in named_children(node) {
                    match ch.kind() {
                        "class_specifier" | "struct_specifier" => {
                            let mut cd = decompile_cpp_class(ch, src, opts, tr.clone());
                            cd.type_params = tps.clone();
                            m.items.push(AiceItem::Class(cd));
                            break;
                        }
                        "function_definition" => {
                            let mut fd = decompile_cpp_fn(ch, src, opts, tr.clone());
                            fd.type_params = tps.clone();
                            m.items.push(AiceItem::Fn(fd));
                            break;
                        }
                        _ => {}
                    }
                }
            }
            _ => m.items.push(AiceItem::Directive { text: node_text(node, src).trim().into(), trivia: tr, span: node_span(node) }),
        }
    }
}

fn decompile_cpp_class(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> ClassDecl {
    let name = field_text(node, "name", src).unwrap_or("Class").to_string();
    let mut cur_vis = if node.kind() == "class_specifier" { Visibility::Private } else { Visibility::Public };
    let mut props = Vec::new();
    let mut methods = Vec::new();
    if let Some(body) = node.child_by_field_name("body") {
        for ch in named_children(body) {
            if is_comment_kind(ch.kind()) { continue; }
            match ch.kind() {
                "access_specifier" => {
                    let s = node_text(ch, src);
                    cur_vis = if s.contains("public") { Visibility::Public }
                    else if s.contains("protected") { Visibility::Protected }
                    else { Visibility::Private };
                }
                "field_declaration" => {
                    let fnm = field_text(ch, "declarator", src).unwrap_or("f").trim().to_string();
                    let ty = field_text(ch, "type", src).map(|t| map_type_str(t, LanguageId::Cpp));
                    props.push(PropDecl {
                        name: fnm, aliases: Vec::new(), vis: cur_vis, is_static: false, is_readonly: false,
                        is_mut: true, is_optional: false, ty, init: None, trivia: collect_trivia(ch, src, opts),
                    });
                }
                "function_definition" => {
                    let f = decompile_cpp_fn(ch, src, opts, collect_trivia(ch, src, opts));
                    let accessor = if f.name == name { AccessorKind::Constructor } else { AccessorKind::Normal };
                    let is_const = node_text(ch, src).contains(") const");
                    methods.push(MethodDecl {
                        vis: cur_vis, is_static: false, is_async: false, is_const, accessor,
                        name: f.name, type_params: Vec::new(), params: f.params,
                        return_type: f.return_type, body: f.body, trivia: f.trivia, span: f.span,
                    });
                }
                "template_declaration" => {
                    let tps = extract_cpp_type_params(ch, src);
                    for sub in named_children(ch) {
                        if sub.kind() == "function_definition" {
                            let f = decompile_cpp_fn(sub, src, opts, collect_trivia(sub, src, opts));
                            let accessor = if f.name == name { AccessorKind::Constructor } else { AccessorKind::Normal };
                            let is_const = node_text(sub, src).contains(") const");
                            methods.push(MethodDecl {
                                vis: cur_vis, is_static: false, is_async: false, is_const, accessor,
                                name: f.name, type_params: tps.clone(), params: f.params,
                                return_type: f.return_type, body: f.body, trivia: f.trivia, span: f.span,
                            });
                        }
                    }
                }
                _ => {}
            }
        }
    }
    ClassDecl {
        vis: Visibility::Public, is_abstract: false, decorators: Vec::new(), name,
        type_params: Vec::new(), primary_ctor: Vec::new(), extends: None, implements: Vec::new(),
        props, methods, static_blocks: Vec::new(), trivia: tr, span: node_span(node),
    }
}

fn decompile_cpp_fn(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> FnDecl {
    let return_type = field_text(node, "type", src).map(|t| map_type_str(t, LanguageId::Cpp));
    let decl = node.child_by_field_name("declarator");
    let fn_decl = decl.and_then(|d| if d.kind() == "function_declarator" { Some(d) } else { child_by_kind(d, "function_declarator") });
    let name = fn_decl.and_then(|d| field_text(d, "declarator", src)).unwrap_or("fn_anon").trim().to_string();
    let mut params = Vec::new();
    if let Some(pl) = fn_decl.and_then(|d| d.child_by_field_name("parameters")) {
        for pd in named_children(pl) {
            if matches!(pd.kind(), "parameter_declaration" | "optional_parameter_declaration") {
                let raw_ty = field_text(pd, "type", src).unwrap_or("auto").trim();
                let (pnm, ptrs) = pd.child_by_field_name("declarator")
                    .map(|d| unwrap_c_declarator(d, src))
                    .unwrap_or_else(|| ("p".into(), String::new()));
                let pty = Some(map_type_str(&format!("{raw_ty}{ptrs}"), LanguageId::Cpp));
                let default = pd.child_by_field_name("default_value")
                    .map(|dv| crate::decompile::expr_common::decompile_expr(dv, src, LanguageId::Cpp));
                params.push(ParamDecl {
                    name: pnm, vis: Visibility::Default, is_readonly: false, is_mut: false,
                    is_optional: false, is_rest: false, ty: pty, default, trivia: Trivia::default(),
                });
            }
        }
    }
    let mut stmts = node.child_by_field_name("body").map(|b| decompile_block(b, src, LanguageId::Cpp, opts)).unwrap_or_default();
    if let Some(inits) = child_by_kind(node, "field_initializer_list") {
        let mut init_stmts = Vec::new();
        for fi in named_children(inits) {
            if fi.kind() == "field_initializer" {
                let kids = named_children(fi);
                if kids.len() >= 2 {
                    let lhs = crate::ir_code::Expr::Ident(node_text(kids[0], src).trim().into());
                    let rhs = crate::ir_code::Expr::Ident(node_text(kids[1], src).trim_matches(|c| c == '(' || c == ')').trim().into());
                    init_stmts.push(crate::ir_code::Stmt::Assign { target: lhs, op: crate::ir_code::AssignOp::Assign, value: rhs, trivia: Trivia::default() });
                }
            }
        }
        init_stmts.append(&mut stmts);
        stmts = init_stmts;
    }
    FnDecl {
        vis: Visibility::Public, is_async: false, is_static: false, decorators: Vec::new(), name,
        type_params: Vec::new(), params, return_type, body: FnBody::Block(stmts), trivia: tr, span: node_span(node),
    }
}

fn extract_cpp_type_params(node: Node<'_>, src: &str) -> Vec<TypeParam> {
    let mut out = Vec::new();
    let Some(pl) = node.child_by_field_name("parameters").or_else(|| child_by_kind(node, "template_parameter_list")) else {
        return out;
    };
    for ch in named_children(pl) {
        if matches!(ch.kind(), "type_parameter_declaration" | "parameter_declaration") {
            let nm = field_text(ch, "name", src)
                .or_else(|| named_children(ch).into_iter().last().map(|n| node_text(n, src)))
                .unwrap_or("T")
                .trim()
                .to_string();
            out.push(TypeParam { name: nm, bounds: Vec::new(), default: None });
        }
    }
    out
}
