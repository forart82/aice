use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::c_cpp::{
    build_c_return_type, extract_c_type_quals, find_c_fn_declarator, prepend_c_type_quals,
    unwrap_c_param_declarator,
};
use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_span, node_text, with_ts_root};
use crate::decompile::expr_common::decompile_expr;
use crate::decompile::stmt_common::decompile_block;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::decompile::ts_helpers::push_attrs_to_trivia;
use crate::ir::{AiceItem, AiceModule, ImportDecl, TranspileError, TranspileOpts, Trivia, Visibility};
use crate::ir_code::{FnBody, FnDecl};
use crate::ir_types::{EnumDecl, EnumVariant, FieldDecl, FieldSigil, ParamDecl, TypeDecl, TypeKind, TypeParam, VariantPayload};

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    with_ts_root(tree, |root| {
        let mut m = AiceModule::new(LanguageId::C, "c");
        for ch in named_children(root) {
            if is_comment_kind(ch.kind()) { continue; }
            let tr = collect_trivia(ch, src, opts);
            match ch.kind() {
                "preproc_include" => {
                    let path = field_text(ch, "path", src).unwrap_or("").trim().to_string();
                    m.items.push(AiceItem::Import(ImportDecl {
                        vis: Visibility::Default, source: path, specifiers: Vec::new(),
                        is_type_only: false, trivia: tr, span: node_span(ch),
                    }));
                }
                "type_definition" => {
                    if let Some(en) = child_by_kind(ch, "enum_specifier").filter(|e| e.child_by_field_name("body").is_some()) {
                        let tag = field_text(en, "name", src).map(str::trim).filter(|s| !s.is_empty());
                        let nm = field_text(ch, "declarator", src).map(str::trim).filter(|s| !s.is_empty())
                            .or(tag).unwrap_or("Enum").to_string();
                        let mut etr = tr;
                        if let Some(tg) = tag { push_attrs_to_trivia(&mut etr, vec![format!("@tag({tg})")]); }
                        m.items.push(AiceItem::Enum(extract_c_enum(en, nm, src, etr, LanguageId::C)));
                    } else if let Some(st) = child_by_kind(ch, "struct_specifier").filter(|s| s.child_by_field_name("body").is_some()) {
                        let tag = field_text(st, "name", src).map(str::trim).filter(|s| !s.is_empty());
                        let nm = field_text(ch, "declarator", src).map(str::trim).filter(|s| !s.is_empty())
                            .or(tag).unwrap_or("Struct").to_string();
                        let mut str_tr = tr;
                        if let Some(tg) = tag { push_attrs_to_trivia(&mut str_tr, vec![format!("@tag({tg})")]); }
                        if let Some(td) = extract_c_struct(st, nm, src, str_tr.clone()) {
                            m.items.push(AiceItem::Type(td));
                        } else {
                            m.items.push(AiceItem::Directive { text: node_text(ch, src).trim().into(), trivia: str_tr, span: node_span(ch) });
                        }
                    } else {
                        m.items.push(AiceItem::Directive { text: node_text(ch, src).trim().into(), trivia: tr, span: node_span(ch) });
                    }
                }
                "enum_specifier" if ch.child_by_field_name("body").is_some() => {
                    let tag = field_text(ch, "name", src).map(str::trim).filter(|s| !s.is_empty());
                    let nm = tag.unwrap_or("Enum").to_string();
                    let mut etr = tr;
                    if let Some(tg) = tag { push_attrs_to_trivia(&mut etr, vec![format!("@tag({tg})")]); }
                    m.items.push(AiceItem::Enum(extract_c_enum(ch, nm, src, etr, LanguageId::C)));
                }
                "declaration"
                    if child_by_kind(ch, "enum_specifier").is_some_and(|e| e.child_by_field_name("body").is_some())
                        && ch.child_by_field_name("declarator").is_none() =>
                {
                    let en = child_by_kind(ch, "enum_specifier").expect("enum_specifier");
                    let tag = field_text(en, "name", src).map(str::trim).filter(|s| !s.is_empty());
                    let nm = tag.unwrap_or("Enum").to_string();
                    let mut etr = tr;
                    if let Some(tg) = tag { push_attrs_to_trivia(&mut etr, vec![format!("@tag({tg})")]); }
                    m.items.push(AiceItem::Enum(extract_c_enum(en, nm, src, etr, LanguageId::C)));
                }
                "declaration"
                    if child_by_kind(ch, "struct_specifier").is_some_and(|s| s.child_by_field_name("body").is_some())
                        && ch.child_by_field_name("declarator").is_none() =>
                {
                    let st = child_by_kind(ch, "struct_specifier").expect("struct_specifier");
                    push_named_c_struct(ch, st, src, tr, &mut m);
                }
                "struct_specifier" if ch.child_by_field_name("body").is_some() => {
                    push_named_c_struct(ch, ch, src, tr, &mut m);
                }
                "function_definition" => m.items.push(AiceItem::Fn(decompile_c_fn(ch, src, opts, tr))),
                _ => m.items.push(AiceItem::Directive { text: node_text(ch, src).trim().into(), trivia: tr, span: node_span(ch) }),
            }
        }
        Ok(m)
    })
}

fn extract_c_enum(node: Node<'_>, name: String, src: &str, tr: Trivia, lang: LanguageId) -> EnumDecl {
    let mut variants = Vec::new();
    if let Some(body) = node.child_by_field_name("body") {
        for ch in named_children(body) {
            if ch.kind() == "enumerator" {
                let vn = field_text(ch, "name", src).unwrap_or("V").trim().to_string();
                let disc = ch.child_by_field_name("value").map(|v| decompile_expr(v, src, lang));
                variants.push(EnumVariant { name: vn, payload: VariantPayload::Unit, discriminant: disc, trivia: Trivia::default() });
            }
        }
    }
    EnumDecl { vis: Visibility::Public, name, type_params: Vec::new(), variants, trivia: tr, span: node_span(node) }
}

pub(crate) fn extract_cpp_enum(node: Node<'_>, src: &str, mut tr: Trivia) -> EnumDecl {
    let mut attrs = Vec::new();
    for i in 0..node.child_count() {
        if let Some(c) = node.child(i) && !c.is_named() {
            if c.kind() == "class" { attrs.push("@class".into()); }
            else if c.kind() == "struct" { attrs.push("@struct".into()); }
        }
    }
    if let Some(base) = field_text(node, "base", src).map(str::trim).filter(|s| !s.is_empty()) {
        attrs.push(format!("@base({base})"));
    }
    if !attrs.is_empty() { push_attrs_to_trivia(&mut tr, attrs); }
    let nm = field_text(node, "name", src).unwrap_or("Enum").trim().to_string();
    extract_c_enum(node, nm, src, tr, LanguageId::Cpp)
}

fn push_named_c_struct(outer: Node<'_>, st: Node<'_>, src: &str, tr: Trivia, m: &mut AiceModule) {
    let tag = field_text(st, "name", src).map(str::trim).filter(|s| !s.is_empty());
    let nm = tag.unwrap_or("Struct").to_string();
    let mut str_tr = tr.clone();
    if let Some(tg) = tag { push_attrs_to_trivia(&mut str_tr, vec![format!("@tag({tg})")]); }
    if let Some(td) = extract_c_struct(st, nm, src, str_tr) {
        m.items.push(AiceItem::Type(td));
    } else {
        m.items.push(AiceItem::Directive { text: node_text(outer, src).trim().into(), trivia: tr, span: node_span(outer) });
    }
}

fn is_c_simple_ident(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') && !s.as_bytes()[0].is_ascii_digit()
}

fn extract_c_struct(node: Node<'_>, name: String, src: &str, tr: Trivia) -> Option<TypeDecl> {
    let mut fields = Vec::new();
    if let Some(body) = node.child_by_field_name("body") {
        for ch in named_children(body) {
            if is_comment_kind(ch.kind()) { continue; }
            if ch.kind() != "field_declaration" { return None; }
            let mut cur = ch.walk();
            let decls: Vec<Node<'_>> = ch.children_by_field_name("declarator", &mut cur).collect();
            if decls.len() != 1 || child_by_kind(ch, "bitfield_clause").is_some() { return None; }
            let raw_ty = field_text(ch, "type", src)?.trim();
            let quals = extract_c_type_quals(ch, src);
            let (fnm, ptrs) = unwrap_c_declarator(decls[0], src);
            if !is_c_simple_ident(&fnm) { return None; }
            let full_ty = prepend_c_type_quals(&quals, raw_ty, &ptrs);
            let ty = Some(map_type_str(&full_ty, LanguageId::C));
            fields.push(FieldDecl {
                name: fnm, vis: Visibility::Public, is_readonly: false, is_optional: false,
                sigil: FieldSigil::None, ty, default: None, trivia: Trivia::default(),
            });
        }
    }
    Some(TypeDecl {
        vis: Visibility::Public, kind: TypeKind::Struct, name, type_params: Vec::new(),
        extends: Vec::new(), fields, methods: Vec::new(), alias_target: None, trivia: tr, span: node_span(node),
    })
}

fn decompile_c_fn(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> FnDecl {
    let raw = node_text(node, src);
    let vis = if raw.trim_start().starts_with("static ") { Visibility::Private } else { Visibility::Public };
    let found = find_c_fn_declarator(node, src);
    let ret_quals = found.as_ref().map(|(_, q)| q.as_str()).unwrap_or("");
    let return_type = build_c_return_type(node, ret_quals, src, LanguageId::C);
    let fn_decl = found.map(|(fd, _)| fd).or_else(|| {
        node.child_by_field_name("declarator").and_then(|d| {
            if d.kind() == "function_declarator" { Some(d) } else { child_by_kind(d, "function_declarator") }
        })
    });
    let name = fn_decl.and_then(|d| field_text(d, "declarator", src)).unwrap_or("fn_anon").trim().to_string();
    let mut params = Vec::new();
    if let Some(pl) = fn_decl.and_then(|d| d.child_by_field_name("parameters")) {
        let pdecls: Vec<Node<'_>> = named_children(pl)
            .into_iter()
            .filter(|pd| pd.kind() == "parameter_declaration")
            .collect();
        for pd in &pdecls {
            let raw_ty = field_text(*pd, "type", src).unwrap_or("void").trim();
            let quals = extract_c_type_quals(*pd, src);
            let decl_node = pd.child_by_field_name("declarator");
            if pdecls.len() == 1 && decl_node.is_none() && raw_ty == "void" && quals.is_empty() {
                continue;
            }
            let (pnm, ptrs) = decl_node
                .map(|d| unwrap_c_declarator(d, src))
                .unwrap_or_else(|| ("p".into(), String::new()));
            let full_ty = prepend_c_type_quals(&quals, raw_ty, &ptrs);
            let pty = Some(map_type_str(&full_ty, LanguageId::C));
            params.push(ParamDecl {
                name: pnm, vis: Visibility::Default, is_readonly: false, is_mut: false,
                is_optional: false, is_rest: false, ty: pty, default: None, trivia: Trivia::default(),
            });
        }
    }
    let body = node.child_by_field_name("body").map(|b| FnBody::Block(decompile_block(b, src, LanguageId::C, opts))).unwrap_or(FnBody::SignatureOnly);
    FnDecl {
        vis, is_async: false, is_static: false, decorators: Vec::new(), name,
        type_params: Vec::new(), params, return_type, body, trivia: tr, span: node_span(node),
    }
}

pub(crate) fn unwrap_c_declarator(node: Node<'_>, src: &str) -> (String, String) {
    unwrap_c_param_declarator(node, src)
}

pub(crate) fn extract_cpp_bases(node: Node<'_>, src: &str) -> (Option<String>, Vec<String>) {
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

pub(crate) fn extract_cpp_type_params(node: Node<'_>, src: &str) -> Vec<TypeParam> {
    let mut out = Vec::new();
    let Some(pl) = node.child_by_field_name("parameters").or_else(|| child_by_kind(node, "template_parameter_list")) else {
        return out;
    };
    for ch in named_children(pl) {
        if matches!(ch.kind(), "type_parameter_declaration" | "parameter_declaration") {
            let nm = field_text(ch, "name", src)
                .or_else(|| named_children(ch).into_iter().last().map(|n| node_text(n, src)))
                .unwrap_or("T").trim().to_string();
            out.push(TypeParam { name: nm, bounds: Vec::new(), default: None });
        }
    }
    out
}

pub(crate) fn extract_cpp_fn_quals(node: Node<'_>, src: &str) -> Vec<String> {
    let decl_start = node.child_by_field_name("declarator").map(|n| n.start_byte()).unwrap_or(node.end_byte());
    let mut quals = Vec::new();
    let mut cur = node.walk();
    for c in node.children(&mut cur) {
        if c.start_byte() >= decl_start { break; }
        for tok in node_text(c, src).split_whitespace() {
            if matches!(tok, "inline" | "constexpr" | "consteval") && !quals.iter().any(|q| q == tok) {
                quals.push(tok.to_string());
            }
        }
    }
    quals
}

pub(crate) fn normalize_cpp_op_name(raw_name: &str) -> Option<(String, String)> {
    let clean = raw_name.trim().lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join(" ");
    let (prefix, tail) = match clean.rfind("::") {
        Some(idx) => (&clean[..idx], clean[idx + 2..].trim()),
        None => ("", clean.as_str()),
    };
    let rest = tail.strip_prefix("operator")?;
    if rest.is_empty() || rest.as_bytes()[0].is_ascii_alphanumeric() || rest.as_bytes()[0] == b'_' {
        return None;
    }
    let sym = rest.trim();
    let slug = match sym {
        "+" => "add", "-" => "sub", "*" => "mul", "/" => "div", "%" => "rem",
        "==" => "eq", "!=" => "ne", "<" => "lt", "<=" => "le", ">" => "gt", ">=" => "ge", "<=>" => "cmp",
        "[]" => "index", "()" => "call", "<<" => "shl", ">>" => "shr",
        "+=" => "add_assign", "-=" => "sub_assign", "*=" => "mul_assign", "/=" => "div_assign", "%=" => "rem_assign",
        "&=" => "bitand_assign", "|=" => "bitor_assign", "^=" => "bitxor_assign", "<<=" => "shl_assign", ">>=" => "shr_assign",
        "=" => "assign", "++" => "inc", "--" => "dec", "!" => "not", "~" => "bitnot",
        "&" => "bitand", "|" => "bitor", "^" => "bitxor", "&&" => "and", "||" => "or", "->" => "deref", "->*" => "deref_ptr",
        "," => "comma",
        _ => "custom",
    };
    let pfx: String = prefix.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect();
    let pfx = pfx.trim_matches('_');
    let safe = if pfx.is_empty() { format!("op_{slug}") } else { format!("{pfx}_op_{slug}") };
    let esc = clean.replace('\\', "\\\\").replace('"', "\\\"");
    Some((safe, format!("op(\"{esc}\")")))
}
