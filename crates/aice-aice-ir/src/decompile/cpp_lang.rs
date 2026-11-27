use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::c_cpp::{
    build_c_return_type, extract_c_type_quals, find_c_fn_declarator, prepend_c_type_quals,
};
use crate::decompile::c_lang::{extract_cpp_enum, unwrap_c_declarator};
use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_span, node_text, with_ts_root};
use crate::decompile::stmt_common::decompile_block;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::decompile::ts_helpers::push_attrs_to_trivia;
use crate::ir::{AiceItem, AiceModule, ImportDecl, Span, TranspileError, TranspileOpts, Trivia, Visibility};
use crate::ir_code::{AccessorKind, ClassDecl, FnBody, FnDecl, MethodDecl, PropDecl};
use crate::ir_types::{ParamDecl, TypeParam};

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    with_ts_root(tree, |root| {
        let mut m = AiceModule::new(LanguageId::Cpp, "cpp");
        let top: Vec<Node<'_>> = named_children(root).into_iter().filter(|c| !is_comment_kind(c.kind())).collect();
        let non_inc: Vec<Node<'_>> = top.iter().copied().filter(|c| !c.kind().starts_with("preproc_")).collect();
        let hoist_ns = non_inc.len() == 1 && non_inc[0].kind() == "namespace_definition" && field_text(non_inc[0], "name", src).is_some();
        for ch in top {
            collect_cpp_items(ch, hoist_ns && ch.kind() == "namespace_definition", src, opts, &mut m);
        }
        Ok(m)
    })
}

fn collect_cpp_items(root: Node<'_>, hoist_root_ns: bool, src: &str, opts: &TranspileOpts, m: &mut AiceModule) {
    let mut stack: Vec<Option<(Node<'_>, bool)>> = vec![Some((root, hoist_root_ns))];
    while let Some(entry) = stack.pop() {
        let Some((node, hoist_ns)) = entry else {
            m.items.push(AiceItem::Directive { text: "}".into(), trivia: Trivia::default(), span: Span::empty() });
            continue;
        };
        let tr = collect_trivia(node, src, opts);
        match node.kind() {
            "preproc_include" => {
                let path = field_text(node, "path", src).unwrap_or("").trim().to_string();
                m.items.push(AiceItem::Import(ImportDecl { vis: Visibility::Default, source: path, specifiers: Vec::new(), is_type_only: false, trivia: tr, span: node_span(node) }));
            }
            "namespace_definition" => {
                let nm = field_text(node, "name", src).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
                if hoist_ns && let Some(name) = nm { m.module_name = name; } else {
                    let hdr = nm.map(|n| format!("namespace {n} {{")).unwrap_or_else(|| "namespace {".into());
                    m.items.push(AiceItem::Directive { text: hdr, trivia: tr, span: node_span(node) });
                    stack.push(None);
                }
                if let Some(body) = node.child_by_field_name("body") {
                    for ch in named_children(body).into_iter().rev() {
                        if !is_comment_kind(ch.kind()) { stack.push(Some((ch, false))); }
                    }
                }
            }
            "enum_specifier" if node.child_by_field_name("body").is_some() => m.items.push(AiceItem::Enum(extract_cpp_enum(node, src, tr))),
            "declaration" if child_by_kind(node, "enum_specifier").is_some_and(|e| e.child_by_field_name("body").is_some()) && node.child_by_field_name("declarator").is_none() => {
                m.items.push(AiceItem::Enum(extract_cpp_enum(child_by_kind(node, "enum_specifier").unwrap(), src, tr)));
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
    let (extends, implements) = extract_cpp_bases(node, src);
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
                "field_declaration" | "declaration" => {
                    if let Some((fn_decl, ret_quals)) = find_c_fn_declarator(ch, src) {
                        methods.push(decompile_cpp_method_proto(ch, &name, cur_vis, fn_decl, &ret_quals, Vec::new(), src, opts));
                    } else if ch.kind() == "field_declaration" {
                        let raw_ty = field_text(ch, "type", src).unwrap_or("auto").trim();
                        let quals = extract_c_type_quals(ch, src);
                        let (fnm, ptrs) = ch.child_by_field_name("declarator")
                            .map(|d| unwrap_c_declarator(d, src))
                            .unwrap_or_else(|| ("f".into(), String::new()));
                        let ty = Some(map_type_str(&prepend_c_type_quals(&quals, raw_ty, &ptrs), LanguageId::Cpp));
                        props.push(PropDecl {
                            name: fnm, aliases: Vec::new(), vis: cur_vis, is_static: false, is_readonly: false,
                            is_mut: true, is_optional: false, ty, init: None, trivia: collect_trivia(ch, src, opts),
                        });
                    }
                }
                "function_definition" => {
                    methods.push(decompile_cpp_method_def(ch, &name, cur_vis, Vec::new(), src, opts));
                }
                "template_declaration" => {
                    let tps = extract_cpp_type_params(ch, src);
                    for sub in named_children(ch) {
                        if sub.kind() == "function_definition" {
                            methods.push(decompile_cpp_method_def(sub, &name, cur_vis, tps.clone(), src, opts));
                        } else if matches!(sub.kind(), "field_declaration" | "declaration")
                            && let Some((fn_decl, ret_quals)) = find_c_fn_declarator(sub, src)
                        {
                            methods.push(decompile_cpp_method_proto(sub, &name, cur_vis, fn_decl, &ret_quals, tps.clone(), src, opts));
                        }
                    }
                }
                _ => {}
            }
        }
    }
    ClassDecl {
        vis: Visibility::Public, is_abstract: false, decorators: Vec::new(), name,
        type_params: Vec::new(), primary_ctor: Vec::new(), extends, implements,
        props, methods, static_blocks: Vec::new(), trivia: tr, span: node_span(node),
    }
}

fn extract_cpp_bases(node: Node<'_>, src: &str) -> (Option<String>, Vec<String>) {
    let Some(clause) = child_by_kind(node, "base_class_clause") else { return (None, Vec::new()); };
    let mut bases = Vec::new();
    for ch in named_children(clause) {
        if matches!(ch.kind(), "access_specifier" | "virtual") || is_comment_kind(ch.kind()) { continue; }
        let txt = node_text(ch, src).trim();
        if !txt.is_empty() && !matches!(txt, "public" | "protected" | "private" | "virtual") {
            bases.push(txt.to_string());
        }
    }
    if bases.is_empty() { (None, Vec::new()) } else { let first = bases.remove(0); (Some(first), bases) }
}

fn collect_cpp_method_attrs(node: Node<'_>, fn_decl: Option<Node<'_>>, is_proto: bool, src: &str) -> (Vec<String>, bool) {
    let mut attrs = Vec::new();
    let decl_start = node.child_by_field_name("declarator").map(|n| n.start_byte()).unwrap_or(node.end_byte());
    let mut is_virtual = false;
    let mut is_static = false;
    let mut cur = node.walk();
    for c in node.children(&mut cur) {
        if c.start_byte() >= decl_start { break; }
        let t = node_text(c, src).trim();
        if c.kind() == "virtual" || c.kind() == "virtual_function_specifier" || t == "virtual" { is_virtual = true; }
        if c.kind() == "storage_class_specifier" && t == "static" { is_static = true; }
    }
    if is_virtual { attrs.push("@virtual".into()); }
    if is_proto {
        let pure_via_field = node.child_by_field_name("default_value").is_some_and(|v| node_text(v, src).trim() == "0");
        let pure_via_tail = fn_decl.and_then(|fd| src.get(fd.end_byte()..node.end_byte())).is_some_and(|tail| {
            tail.trim().trim_end_matches(';').trim().strip_prefix('=').is_some_and(|rhs| rhs.trim() == "0")
        });
        if pure_via_field || pure_via_tail { attrs.push("@pure".into()); }
    }
    if let Some(fd) = fn_decl {
        let mut fcur = fd.walk();
        for c in fd.children(&mut fcur) {
            if c.kind() == "virtual_specifier" {
                match node_text(c, src).trim() {
                    "override" => attrs.push("@override".into()),
                    "final" => attrs.push("@final".into()),
                    _ => {}
                }
            }
        }
    }
    (attrs, is_static)
}

#[allow(clippy::too_many_arguments)]
fn decompile_cpp_method_proto(
    ch: Node<'_>, cls_name: &str, vis: Visibility, fn_decl: Node<'_>, ret_quals: &str,
    type_params: Vec<TypeParam>, src: &str, opts: &TranspileOpts,
) -> MethodDecl {
    let mut tr = collect_trivia(ch, src, opts);
    let (attrs, is_static) = collect_cpp_method_attrs(ch, Some(fn_decl), true, src);
    push_attrs_to_trivia(&mut tr, attrs);
    let mname = field_text(fn_decl, "declarator", src).unwrap_or("method").trim().to_string();
    let accessor = if mname == cls_name { AccessorKind::Constructor } else { AccessorKind::Normal };
    let params = fn_decl.child_by_field_name("parameters").map(|pl| extract_cpp_params(pl, src)).unwrap_or_default();
    let return_type = build_c_return_type(ch, ret_quals, src, LanguageId::Cpp);
    let is_const = node_text(fn_decl, src).contains(") const");
    MethodDecl {
        vis, is_static, is_async: false, is_const, accessor, name: mname,
        type_params, params, return_type, body: FnBody::SignatureOnly, trivia: tr, span: node_span(ch),
    }
}

fn decompile_cpp_method_def(
    ch: Node<'_>, cls_name: &str, vis: Visibility, type_params: Vec<TypeParam>, src: &str, opts: &TranspileOpts,
) -> MethodDecl {
    let mut f = decompile_cpp_fn(ch, src, opts, collect_trivia(ch, src, opts));
    let fn_decl = find_c_fn_declarator(ch, src).map(|(fd, _)| fd);
    let (attrs, is_static) = collect_cpp_method_attrs(ch, fn_decl, false, src);
    push_attrs_to_trivia(&mut f.trivia, attrs);
    let accessor = if f.name == cls_name { AccessorKind::Constructor } else { AccessorKind::Normal };
    let is_const = fn_decl.map(|fd| node_text(fd, src)).unwrap_or_else(|| node_text(ch, src)).contains(") const");
    MethodDecl {
        vis, is_static, is_async: false, is_const, accessor, name: f.name,
        type_params, params: f.params, return_type: f.return_type, body: f.body, trivia: f.trivia, span: f.span,
    }
}

fn extract_cpp_params(pl: Node<'_>, src: &str) -> Vec<ParamDecl> {
    let mut params = Vec::new();
    for pd in named_children(pl) {
        if matches!(pd.kind(), "parameter_declaration" | "optional_parameter_declaration") {
            let raw_ty = field_text(pd, "type", src).unwrap_or("auto").trim();
            let quals = extract_c_type_quals(pd, src);
            let (pnm, ptrs) = pd.child_by_field_name("declarator")
                .map(|d| unwrap_c_declarator(d, src))
                .unwrap_or_else(|| ("p".into(), String::new()));
            let full_ty = prepend_c_type_quals(&quals, raw_ty, &ptrs);
            let pty = Some(map_type_str(&full_ty, LanguageId::Cpp));
            let default = pd.child_by_field_name("default_value")
                .map(|dv| crate::decompile::expr_common::decompile_expr(dv, src, LanguageId::Cpp));
            params.push(ParamDecl {
                name: pnm, vis: Visibility::Default, is_readonly: false, is_mut: false,
                is_optional: false, is_rest: false, ty: pty, default, trivia: Trivia::default(),
            });
        }
    }
    params
}

fn decompile_cpp_fn(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> FnDecl {
    let found = find_c_fn_declarator(node, src);
    let ret_quals = found.as_ref().map(|(_, q)| q.as_str()).unwrap_or("");
    let return_type = build_c_return_type(node, ret_quals, src, LanguageId::Cpp);
    let fn_decl = found.map(|(fd, _)| fd).or_else(|| {
        node.child_by_field_name("declarator")
            .and_then(|d| if d.kind() == "function_declarator" { Some(d) } else { child_by_kind(d, "function_declarator") })
    });
    let name = fn_decl.and_then(|d| field_text(d, "declarator", src)).unwrap_or("fn_anon").trim().to_string();
    let params = fn_decl.and_then(|d| d.child_by_field_name("parameters")).map(|pl| extract_cpp_params(pl, src)).unwrap_or_default();
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
