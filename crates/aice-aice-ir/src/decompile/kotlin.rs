use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, named_children, node_span, node_text, with_ts_root};
use crate::decompile::expr_common::decompile_expr;
use crate::decompile::kotlin_dart::{
    extract_kt_type_params, kt_has_mod, kt_member_attrs, kt_param_has_kw, kt_return_type,
    kt_supertypes, kt_type_node,
};
use crate::decompile::stmt_common::decompile_block;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::decompile::ts_helpers::push_attrs_to_trivia;
use crate::ir::{AiceItem, AiceModule, ImportDecl, TranspileError, TranspileOpts, Trivia, Visibility};
use crate::ir_code::{ClassDecl, FnBody, FnDecl, MethodDecl, PropDecl};
use crate::ir_types::ParamDecl;

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    with_ts_root(tree, |root| {
        let mut m = AiceModule::new(LanguageId::Kotlin, "kotlin");
        for ch in named_children(root) {
            if is_comment_kind(ch.kind()) { continue; }
            let tr = collect_trivia(ch, src, opts);
            match ch.kind() {
                "package_header" => m.module_name = node_text(ch, src).trim().trim_start_matches("package ").trim().to_string(),
                "import" | "import_header" => push_kt_import(ch, src, tr, &mut m),
                "import_list" => {
                    for ich in named_children(ch) {
                        if matches!(ich.kind(), "import" | "import_header") {
                            push_kt_import(ich, src, collect_trivia(ich, src, opts), &mut m);
                        }
                    }
                }
                "class_declaration" | "object_declaration" => decompile_kt_class_into(ch, src, opts, tr, None, &mut m.items),
                "function_declaration" => m.items.push(AiceItem::Fn(decompile_kt_fn(ch, src, opts, tr))),
                _ => {
                    let txt = node_text(ch, src).trim();
                    if !txt.is_empty() {
                        m.items.push(AiceItem::Directive { text: txt.into(), trivia: tr, span: node_span(ch) });
                    }
                }
            }
        }
        Ok(m)
    })
}

fn push_kt_import(ch: Node<'_>, src: &str, tr: Trivia, m: &mut AiceModule) {
    let imp = node_text(ch, src).trim().trim_start_matches("import ").trim().to_string();
    m.items.push(AiceItem::Import(ImportDecl {
        vis: Visibility::Default, source: imp, specifiers: Vec::new(),
        is_type_only: false, trivia: tr, span: node_span(ch),
    }));
}

fn kt_ident(node: Node<'_>, src: &str) -> Option<String> {
    field_text(node, "name", src)
        .or_else(|| child_by_kind(node, "type_identifier").map(|n| node_text(n, src)))
        .or_else(|| child_by_kind(node, "identifier").map(|n| node_text(n, src)))
        .or_else(|| child_by_kind(node, "simple_identifier").map(|n| node_text(n, src)))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn has_anon_kw(node: Node<'_>, kw: &str) -> bool {
    (0..node.child_count()).filter_map(|i| node.child(i)).any(|c| !c.is_named() && c.kind() == kw)
}

fn decompile_kt_class_into(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia, parent: Option<&str>, out: &mut Vec<AiceItem>) {
    let name = kt_ident(node, src).unwrap_or_else(|| "Class".into());
    let cur_path = parent.map(|p| format!("{p}.{name}")).unwrap_or_else(|| name.clone());
    let (mut decorators, is_abstract) = kt_class_decorators(node, src, parent);
    let is_data = decorators.iter().any(|d| d == "data");
    let type_params = extract_kt_type_params(node, src);
    let mut primary_ctor = Vec::new();
    if let Some(ctor) = child_by_kind(node, "primary_constructor") {
        let container = child_by_kind(ctor, "class_parameters").unwrap_or(ctor);
        for cp in named_children(container) {
            if cp.kind() == "class_parameter" {
                let pname = kt_ident(cp, src).unwrap_or_else(|| "p".into());
                let pvis = kt_param_vis(cp, src);
                let is_mut = kt_param_has_kw(cp, src, "var");
                let has_val = kt_param_has_kw(cp, src, "val");
                if kt_has_mod(cp, src, "override") { decorators.push(format!("ctor_override({pname})")); }
                if kt_has_mod(cp, src, "open") { decorators.push(format!("ctor_open({pname})")); }
                let is_readonly = has_val && !is_data
                    && !matches!(pvis, Visibility::Private | Visibility::Protected | Visibility::Package);
                primary_ctor.push(ParamDecl {
                    name: pname, vis: pvis, is_readonly, is_mut,
                    is_optional: false, is_rest: false, ty: kt_type_node(cp, src),
                    default: kt_default_expr(cp, src), trivia: Trivia::default(),
                });
            }
        }
    }
    let (extends, implements) = kt_supertypes(node, src);
    let (mut props, mut methods, mut nested_items, mut direct_nested) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    if let Some(body) = child_by_kind(node, "class_body") {
        for ch in named_children(body) {
            if is_comment_kind(ch.kind()) { continue; }
            let mtr = collect_trivia(ch, src, opts);
            match ch.kind() {
                "function_declaration" => methods.push(kt_fn_to_method(decompile_kt_fn(ch, src, opts, mtr), false)),
                "property_declaration" => {
                    if let Some(p) = decompile_kt_prop(ch, src, mtr, false, None) { props.push(p); }
                }
                "class_declaration" | "object_declaration" => {
                    let start = nested_items.len();
                    decompile_kt_class_into(ch, src, opts, mtr, Some(&cur_path), &mut nested_items);
                    if let Some(AiceItem::Class(nc)) = nested_items.get(start) {
                        direct_nested.push((nc.name.clone(), nc.vis));
                    }
                }
                "companion_object" => decompile_kt_companion(ch, src, opts, &cur_path, &mut props, &mut methods, &mut nested_items),
                _ => {}
            }
        }
    }
    if props.is_empty() && methods.is_empty() && !direct_nested.is_empty() {
        for (nname, nvis) in direct_nested {
            let mut ntr = Trivia::default();
            push_attrs_to_trivia(&mut ntr, vec!["@nested_type".into()]);
            props.push(PropDecl {
                name: nname, aliases: Vec::new(), vis: nvis, is_static: false,
                is_readonly: false, is_mut: false, is_optional: false, ty: None, init: None, trivia: ntr,
            });
        }
    }
    decorators.dedup();
    out.push(AiceItem::Class(ClassDecl {
        vis: kt_vis(node, src), is_abstract, decorators, name, type_params,
        primary_ctor, extends, implements, props, methods,
        static_blocks: Vec::new(), trivia: tr, span: node_span(node),
    }));
    out.extend(nested_items);
}

fn kt_class_decorators(node: Node<'_>, src: &str, parent: Option<&str>) -> (Vec<String>, bool) {
    let mut decs = Vec::new();
    let mut is_abstract = false;
    if let Some(p) = parent { decs.push(format!("nested({p})")); }
    if let Some(mods) = child_by_kind(node, "modifiers") {
        for m in named_children(mods) {
            match node_text(m, src).trim() {
                "abstract" => is_abstract = true,
                kw @ ("open" | "sealed" | "data" | "inner" | "enum" | "value" | "annotation") => decs.push(kw.into()),
                _ => {}
            }
        }
    }
    if node.kind() == "object_declaration" { decs.push("object".into()); }
    else if has_anon_kw(node, "interface") { decs.push("interface".into()); }
    (decs, is_abstract)
}

fn decompile_kt_companion(
    node: Node<'_>, src: &str, opts: &TranspileOpts, parent_path: &str,
    props: &mut Vec<PropDecl>, methods: &mut Vec<MethodDecl>, nested_out: &mut Vec<AiceItem>,
) {
    let tag = match kt_ident(node, src) {
        Some(n) => format!("@companion({n})"),
        None => "@companion".to_string(),
    };
    let Some(body) = child_by_kind(node, "class_body") else { return; };
    for ch in named_children(body) {
        if is_comment_kind(ch.kind()) { continue; }
        let mut mtr = collect_trivia(ch, src, opts);
        match ch.kind() {
            "property_declaration" => {
                if let Some(p) = decompile_kt_prop(ch, src, mtr, true, Some(&tag)) { props.push(p); }
            }
            "function_declaration" => {
                push_attrs_to_trivia(&mut mtr, vec![tag.clone()]);
                methods.push(kt_fn_to_method(decompile_kt_fn(ch, src, opts, mtr), true));
            }
            "class_declaration" | "object_declaration" => {
                decompile_kt_class_into(ch, src, opts, mtr, Some(parent_path), nested_out);
            }
            _ => {}
        }
    }
}

fn decompile_kt_prop(node: Node<'_>, src: &str, mut tr: Trivia, is_static: bool, extra_attr: Option<&str>) -> Option<PropDecl> {
    let vd = child_by_kind(node, "variable_declaration")?;
    let name = kt_ident(vd, src)?;
    let is_mut = has_anon_kw(node, "var");
    let mut attrs = Vec::new();
    if let Some(a) = extra_attr { attrs.push(a.to_string()); }
    attrs.extend(kt_member_attrs(node, src));
    push_attrs_to_trivia(&mut tr, attrs);
    let init = named_children(node).into_iter()
        .find(|c| c.start_byte() > vd.end_byte() && !is_comment_kind(c.kind()) && !matches!(c.kind(), "getter" | "setter"))
        .map(|e| kt_value_expr(e, src));
    Some(PropDecl {
        name, aliases: Vec::new(), vis: kt_vis(node, src), is_static,
        is_readonly: !is_mut, is_mut, is_optional: false, ty: kt_type_node(vd, src), init, trivia: tr,
    })
}

fn kt_fn_to_method(f: FnDecl, is_static: bool) -> MethodDecl {
    MethodDecl {
        vis: f.vis, is_static, is_async: f.is_async, is_const: false,
        accessor: Default::default(), name: f.name, type_params: f.type_params,
        params: f.params, return_type: f.return_type, body: f.body, trivia: f.trivia, span: f.span,
    }
}

fn decompile_kt_fn(node: Node<'_>, src: &str, opts: &TranspileOpts, mut tr: Trivia) -> FnDecl {
    let name = kt_ident(node, src).unwrap_or_else(|| "fn_anon".into());
    push_attrs_to_trivia(&mut tr, kt_member_attrs(node, src));
    let type_params = extract_kt_type_params(node, src);
    let mut params = Vec::new();
    if let Some(pl) = child_by_kind(node, "function_value_parameters") {
        let (n, mut i) = (pl.child_count(), 0);
        while i < n {
            let Some(raw_p) = pl.child(i) else { i += 1; continue };
            if !raw_p.is_named() { i += 1; continue; }
            let (p, mut default) = match raw_p.kind() {
                "function_value_parameter" => {
                    let inner = child_by_kind(raw_p, "parameter").unwrap_or(raw_p);
                    (inner, kt_default_expr(raw_p, src).or_else(|| kt_default_expr(inner, src)))
                }
                "parameter" => (raw_p, kt_default_expr(raw_p, src)),
                _ => { i += 1; continue }
            };
            if default.is_none()
                && let Some(eq_tok) = pl.child(i + 1)
                && (eq_tok.kind() == "=" || node_text(eq_tok, src).trim() == "=")
                && let Some((j, val_n)) = ((i + 2)..n).filter_map(|k| pl.child(k).filter(|c| c.is_named()).map(|c| (k, c))).next()
            {
                default = Some(kt_value_expr(val_n, src));
                i = j;
            }
            params.push(ParamDecl {
                name: kt_ident(p, src).unwrap_or_else(|| "p".into()),
                vis: Visibility::Default, is_readonly: false, is_mut: false,
                is_optional: false, is_rest: false, ty: kt_type_node(p, src), default, trivia: Trivia::default(),
            });
            i += 1;
        }
    }
    let body = child_by_kind(node, "function_body").map(|fb| {
        if let Some(b) = child_by_kind(fb, "block").or_else(|| child_by_kind(fb, "statements")) {
            FnBody::Block(decompile_block(b, src, LanguageId::Kotlin, opts))
        } else if fb.named_child_count() == 1 && let Some(ch) = named_children(fb).into_iter().next() {
            FnBody::Expr(decompile_expr(ch, src, LanguageId::Kotlin))
        } else {
            FnBody::Block(decompile_block(fb, src, LanguageId::Kotlin, opts))
        }
    }).unwrap_or(FnBody::SignatureOnly);
    FnDecl {
        vis: kt_vis(node, src), is_async: node_text(node, src).contains("suspend "), is_static: false,
        decorators: Vec::new(), name, type_params, params,
        return_type: kt_return_type(node, src), body, trivia: tr, span: node_span(node),
    }
}

fn kt_value_expr(node: Node<'_>, src: &str) -> crate::ir_code::Expr {
    let txt = node_text(node, src).trim();
    if matches!(node.kind(), "number_literal" | "long_literal" | "integer_literal" | "unsigned_literal")
        && let Some(stripped) = txt.strip_suffix(['L', 'l', 'u', 'U'])
        && stripped.replace('_', "").parse::<i64>().is_ok()
    {
        return crate::ir_code::Expr::Literal(crate::ir_expr::LiteralVal::Int(stripped.to_string()));
    }
    decompile_expr(node, src, LanguageId::Kotlin)
}

fn kt_default_expr(node: Node<'_>, src: &str) -> Option<crate::ir_code::Expr> {
    let mut seen_eq = false;
    for i in 0..node.child_count() {
        let Some(ch) = node.child(i) else { continue };
        if !seen_eq {
            if ch.kind() == "=" || node_text(ch, src).trim() == "=" { seen_eq = true; }
        } else if ch.is_named() {
            return Some(kt_value_expr(ch, src));
        }
    }
    None
}

fn kt_param_vis(node: Node<'_>, src: &str) -> Visibility {
    let Some(mods) = child_by_kind(node, "modifiers") else { return Visibility::Default; };
    let t = node_text(mods, src);
    if t.contains("private") { Visibility::Private }
    else if t.contains("protected") { Visibility::Protected }
    else if t.contains("internal") { Visibility::Package }
    else if t.contains("public") { Visibility::Public }
    else { Visibility::Default }
}

fn kt_vis(node: Node<'_>, src: &str) -> Visibility {
    match kt_param_vis(node, src) {
        Visibility::Default => Visibility::Public,
        v => v,
    }
}
