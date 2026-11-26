use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::cst_util::{field_text, named_children, node_span, node_text, strip_quotes, with_ts_root};
use crate::decompile::stmt_common::decompile_block;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::decompile::ts_helpers::push_attrs_to_trivia;
use crate::ir::{AiceItem, AiceModule, ImportDecl, TranspileError, TranspileOpts, Trivia, Visibility};
use crate::ir_code::{AccessorKind, ClassDecl, FnBody, FnDecl, MethodDecl, PropDecl, Stmt};
use crate::ir_types::ParamDecl;

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    with_ts_root(tree, |root| {
        let mut m = AiceModule::new(LanguageId::Ruby, "ruby");
        for ch in named_children(root) {
            if is_comment_kind(ch.kind()) { continue; }
            collect_ruby(ch, src, opts, &mut m);
        }
        Ok(m)
    })
}

fn collect_ruby(root: Node<'_>, src: &str, opts: &TranspileOpts, m: &mut AiceModule) {
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        let tr = collect_trivia(node, src, opts);
        match node.kind() {
            "module" => {
                if let Some(nm) = field_text(node, "name", src) { m.module_name = nm.trim().into(); }
                if let Some(body) = node.child_by_field_name("body") {
                    for ch in named_children(body).into_iter().rev() {
                        if !is_comment_kind(ch.kind()) { stack.push(ch); }
                    }
                }
            }
            "class" => m.items.push(AiceItem::Class(decompile_rb_class(node, src, opts, tr))),
            "method" => m.items.push(AiceItem::Fn(decompile_rb_fn(node, Visibility::Public, src, opts, tr))),
            "call" => {
                let meth = field_text(node, "method", src).unwrap_or("");
                if matches!(meth, "require" | "require_relative") {
                    let arg = node.child_by_field_name("arguments").map(|a| strip_quotes(node_text(a, src))).unwrap_or_default();
                    m.items.push(AiceItem::Import(ImportDecl {
                        vis: Visibility::Default, source: arg, specifiers: Vec::new(),
                        is_type_only: false, trivia: tr, span: node_span(node),
                    }));
                }
            }
            _ => {}
        }
    }
}

fn decompile_rb_class(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> ClassDecl {
    let name = field_text(node, "name", src).unwrap_or("Class").trim().to_string();
    let extends = node.child_by_field_name("superclass").map(|s| node_text(s, src).trim().trim_start_matches('<').trim().to_string());
    let mut cur_vis = Visibility::Public;
    let mut props = Vec::new();
    let mut methods = Vec::new();
    if let Some(body) = node.child_by_field_name("body") {
        for ch in named_children(body) {
            if is_comment_kind(ch.kind()) { continue; }
            let mtr = collect_trivia(ch, src, opts);
            if ch.kind() == "identifier" {
                match node_text(ch, src).trim() {
                    "private" => cur_vis = Visibility::Private,
                    "protected" => cur_vis = Visibility::Protected,
                    "public" => cur_vis = Visibility::Public,
                    _ => {}
                }
                continue;
            }
            if ch.kind() == "call" {
                let meth = field_text(ch, "method", src).unwrap_or("").trim();
                if matches!(meth, "attr_accessor" | "attr_reader" | "attr_writer")
                    && let Some(args) = ch.child_by_field_name("arguments")
                {
                    let mut first = true;
                    for a in named_children(args) {
                        if is_comment_kind(a.kind()) { continue; }
                        let nm = strip_quotes(node_text(a, src).trim()).trim_start_matches(':').trim().to_string();
                        if nm.is_empty() { continue; }
                        let mut ptr = if first { first = false; mtr.clone() } else { Trivia::default() };
                        push_attrs_to_trivia(&mut ptr, vec![format!("@{meth}")]);
                        props.push(PropDecl {
                            name: nm, aliases: Vec::new(), vis: cur_vis, is_static: false,
                            is_readonly: meth == "attr_reader", is_mut: meth != "attr_reader",
                            is_optional: false, ty: None, init: None, trivia: ptr,
                        });
                    }
                }
                continue;
            }
            if ch.kind() == "method" {
                let f = decompile_rb_fn(ch, cur_vis, src, opts, mtr);
                let accessor = if f.name == "initialize" { AccessorKind::Constructor } else { AccessorKind::Normal };
                methods.push(MethodDecl {
                    vis: f.vis, is_static: false, is_async: false, is_const: false,
                    accessor, name: f.name, type_params: Vec::new(), params: f.params,
                    return_type: None, body: f.body, trivia: f.trivia, span: f.span,
                });
            }
        }
    }
    ClassDecl {
        vis: Visibility::Public, is_abstract: false, decorators: Vec::new(), name,
        type_params: Vec::new(), primary_ctor: Vec::new(), extends, implements: Vec::new(),
        props, methods, static_blocks: Vec::new(), trivia: tr, span: node_span(node),
    }
}

fn decompile_rb_fn(node: Node<'_>, vis: Visibility, src: &str, opts: &TranspileOpts, tr: Trivia) -> FnDecl {
    let name = field_text(node, "name", src).unwrap_or("method").trim().to_string();
    let mut params = Vec::new();
    if let Some(pl) = node.child_by_field_name("parameters") {
        for ch in named_children(pl) {
            let pnm = node_text(ch, src).trim().to_string();
            if !pnm.is_empty() {
                params.push(ParamDecl {
                    name: pnm, vis: Visibility::Default, is_readonly: false, is_mut: false,
                    is_optional: false, is_rest: false, ty: None, default: None, trivia: Trivia::default(),
                });
            }
        }
    }
    let body = node.child_by_field_name("body").map(|b| {
        let mut stmts = decompile_block(b, src, LanguageId::Ruby, opts);
        if name != "initialize" && matches!(stmts.last(), Some(Stmt::Expr { .. }))
            && let Some(mut last_st) = stmts.pop()
            && let Stmt::Expr { expr, trivia } = &mut last_st
        {
            let e = std::mem::replace(expr, crate::ir_code::Expr::Ident(String::new()));
            let tr = std::mem::take(trivia);
            stmts.push(Stmt::Return { value: Some(e), trivia: tr });
        }
        FnBody::Block(stmts)
    }).unwrap_or(FnBody::SignatureOnly);
    FnDecl {
        vis, is_async: false, is_static: false, decorators: Vec::new(), name,
        type_params: Vec::new(), params, return_type: None, body, trivia: tr, span: node_span(node),
    }
}
