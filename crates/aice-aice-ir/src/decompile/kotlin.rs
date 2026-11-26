use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_span, node_text, with_ts_root};
use crate::decompile::stmt_common::decompile_block;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::ir::{AiceItem, AiceModule, ImportDecl, TranspileError, TranspileOpts, Trivia, Visibility};
use crate::ir_code::{ClassDecl, FnBody, FnDecl, MethodDecl};
use crate::ir_types::ParamDecl;

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    with_ts_root(tree, |root| {
        let mut m = AiceModule::new(LanguageId::Kotlin, "kotlin");
        for ch in named_children(root) {
            if is_comment_kind(ch.kind()) { continue; }
            let tr = collect_trivia(ch, src, opts);
            match ch.kind() {
                "package_header" => {
                    let pkg = node_text(ch, src).trim().trim_start_matches("package ").trim().to_string();
                    m.module_name = pkg;
                }
                "import" | "import_header" => {
                    let imp = node_text(ch, src).trim().trim_start_matches("import ").trim().to_string();
                    m.items.push(AiceItem::Import(ImportDecl {
                        vis: Visibility::Default, source: imp, specifiers: Vec::new(),
                        is_type_only: false, trivia: tr, span: node_span(ch),
                    }));
                }
                "import_list" => {
                    for ich in named_children(ch) {
                        if matches!(ich.kind(), "import" | "import_header") {
                            let itr = collect_trivia(ich, src, opts);
                            let imp = node_text(ich, src).trim().trim_start_matches("import ").trim().to_string();
                            m.items.push(AiceItem::Import(ImportDecl {
                                vis: Visibility::Default, source: imp, specifiers: Vec::new(),
                                is_type_only: false, trivia: itr, span: node_span(ich),
                            }));
                        }
                    }
                }
                "class_declaration" | "object_declaration" => {
                    m.items.push(AiceItem::Class(decompile_kt_class(ch, src, opts, tr)));
                }
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

fn decompile_kt_class(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> ClassDecl {
    let name = field_text(node, "name", src)
        .or_else(|| child_by_kind(node, "type_identifier").map(|n| node_text(n, src)))
        .or_else(|| child_by_kind(node, "simple_identifier").map(|n| node_text(n, src)))
        .unwrap_or("Class")
        .trim()
        .to_string();
    let raw = node_text(node, src);
    let mut decorators = Vec::new();
    if raw.trim_start().starts_with("data ") { decorators.push("data".into()); }
    let mut primary_ctor = Vec::new();
    let props = Vec::new();
    if let Some(ctor) = child_by_kind(node, "primary_constructor") {
        let param_container = child_by_kind(ctor, "class_parameters").unwrap_or(ctor);
        for cp in named_children(param_container) {
            if cp.kind() == "class_parameter" {
                let c_raw = node_text(cp, src);
                let pvis = kt_param_vis(cp, src);
                let is_mut = c_raw.contains("var ");
                let pnm = child_by_kind(cp, "identifier")
                    .or_else(|| child_by_kind(cp, "simple_identifier"))
                    .map(|n| node_text(n, src).trim().to_string())
                    .unwrap_or_else(|| "p".into());
                let ty = child_by_kind(cp, "type")
                    .or_else(|| child_by_kind(cp, "user_type"))
                    .or_else(|| child_by_kind(cp, "nullable_type"))
                    .map(|t| map_type_str(node_text(t, src), LanguageId::Kotlin));
                let default = kt_default_expr(cp, src);
                primary_ctor.push(ParamDecl {
                    name: pnm, vis: pvis, is_readonly: false, is_mut,
                    is_optional: false, is_rest: false, ty, default, trivia: Trivia::default(),
                });
            }
        }
    }
    let mut methods = Vec::new();
    if let Some(body) = child_by_kind(node, "class_body") {
        for ch in named_children(body) {
            if ch.kind() == "function_declaration" {
                let mtr = collect_trivia(ch, src, opts);
                let f = decompile_kt_fn(ch, src, opts, mtr);
                methods.push(MethodDecl {
                    vis: f.vis, is_static: false, is_async: f.is_async, is_const: false,
                    accessor: Default::default(), name: f.name, type_params: Vec::new(),
                    params: f.params, return_type: f.return_type, body: f.body, trivia: f.trivia, span: f.span,
                });
            }
        }
    }
    ClassDecl {
        vis: kt_vis(node, src), is_abstract: false, decorators, name, type_params: Vec::new(),
        primary_ctor, extends: None, implements: Vec::new(), props, methods,
        static_blocks: Vec::new(), trivia: tr, span: node_span(node),
    }
}

fn decompile_kt_fn(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> FnDecl {
    let name = field_text(node, "name", src)
        .or_else(|| child_by_kind(node, "identifier").map(|n| node_text(n, src)))
        .or_else(|| child_by_kind(node, "simple_identifier").map(|n| node_text(n, src)))
        .unwrap_or("fn_anon")
        .trim()
        .to_string();
    let mut params = Vec::new();
    if let Some(pl) = child_by_kind(node, "function_value_parameters") {
        let n = pl.child_count();
        let mut i = 0;
        while i < n {
            let Some(raw_p) = pl.child(i) else { i += 1; continue };
            if !raw_p.is_named() { i += 1; continue; }
            let (p, mut default) = if raw_p.kind() == "function_value_parameter" {
                let inner = child_by_kind(raw_p, "parameter").unwrap_or(raw_p);
                let def = kt_default_expr(raw_p, src).or_else(|| kt_default_expr(inner, src));
                (inner, def)
            } else if raw_p.kind() == "parameter" {
                (raw_p, kt_default_expr(raw_p, src))
            } else {
                i += 1;
                continue;
            };
            if default.is_none()
                && let Some(eq_tok) = pl.child(i + 1)
                && (eq_tok.kind() == "=" || node_text(eq_tok, src).trim() == "=")
            {
                let mut j = i + 2;
                while j < n {
                    if let Some(val_n) = pl.child(j) && val_n.is_named() {
                        default = Some(crate::decompile::expr_common::decompile_expr(val_n, src, LanguageId::Kotlin));
                        i = j;
                        break;
                    }
                    j += 1;
                }
            }
            let pnm = child_by_kind(p, "identifier")
                .or_else(|| child_by_kind(p, "simple_identifier"))
                .map(|n| node_text(n, src).trim().to_string())
                .unwrap_or_else(|| "p".into());
            let ty = child_by_kind(p, "type")
                .or_else(|| child_by_kind(p, "user_type"))
                .or_else(|| child_by_kind(p, "nullable_type"))
                .map(|t| map_type_str(node_text(t, src), LanguageId::Kotlin));
            params.push(ParamDecl {
                name: pnm, vis: Visibility::Default, is_readonly: false, is_mut: false,
                is_optional: false, is_rest: false, ty, default, trivia: Trivia::default(),
            });
            i += 1;
        }
    }
    let return_type = child_by_kind(node, "type")
        .or_else(|| child_by_kind(node, "user_type"))
        .map(|t| map_type_str(node_text(t, src), LanguageId::Kotlin));
    let body = child_by_kind(node, "function_body")
        .map(|fb| {
            if let Some(b) = child_by_kind(fb, "block").or_else(|| child_by_kind(fb, "statements")) {
                FnBody::Block(decompile_block(b, src, LanguageId::Kotlin, opts))
            } else if fb.named_child_count() == 1
                && let Some(ch) = named_children(fb).into_iter().next()
            {
                FnBody::Expr(crate::decompile::expr_common::decompile_expr(ch, src, LanguageId::Kotlin))
            } else {
                FnBody::Block(decompile_block(fb, src, LanguageId::Kotlin, opts))
            }
        })
        .unwrap_or(FnBody::SignatureOnly);
    FnDecl {
        vis: kt_vis(node, src), is_async: node_text(node, src).contains("suspend "), is_static: false,
        decorators: Vec::new(), name, type_params: Vec::new(), params, return_type, body, trivia: tr, span: node_span(node),
    }
}

fn kt_default_expr(node: Node<'_>, src: &str) -> Option<crate::ir_code::Expr> {
    let mut seen_eq = false;
    for i in 0..node.child_count() {
        let Some(ch) = node.child(i) else { continue };
        if !seen_eq {
            if ch.kind() == "=" || node_text(ch, src).trim() == "=" { seen_eq = true; }
        } else if ch.is_named() {
            return Some(crate::decompile::expr_common::decompile_expr(ch, src, LanguageId::Kotlin));
        }
    }
    None
}

fn kt_param_vis(node: Node<'_>, src: &str) -> Visibility {
    if let Some(mods) = child_by_kind(node, "modifiers") {
        let t = node_text(mods, src);
        if t.contains("private") { return Visibility::Private; }
        if t.contains("protected") { return Visibility::Protected; }
        if t.contains("internal") { return Visibility::Package; }
        if t.contains("public") { return Visibility::Public; }
    }
    Visibility::Default
}

fn kt_vis(node: Node<'_>, src: &str) -> Visibility {
    if let Some(mods) = child_by_kind(node, "modifiers") {
        let t = node_text(mods, src);
        if t.contains("private") { return Visibility::Private; }
        if t.contains("protected") { return Visibility::Protected; }
        if t.contains("internal") { return Visibility::Package; }
    }
    Visibility::Public
}
