use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_text};
use crate::decompile::trivia::is_comment_kind;
use crate::ir::{Trivia, TriviaComment, TriviaKind, Visibility};
use crate::ir_code::{Expr, Stmt};
use crate::ir_types::ParamDecl;

pub(crate) fn normalize_single_line(raw: &str) -> String {
    raw.trim()
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn extract_ts_decorators(node: Node<'_>, src: &str) -> Vec<String> {
    let mut out = Vec::new();
    for ch in named_children(node) {
        if ch.kind() == "decorator" {
            let txt = normalize_single_line(node_text(ch, src));
            let clean = txt.trim_start_matches('@').trim().to_string();
            if !clean.is_empty() {
                out.push(clean);
            }
        }
    }
    out
}

pub(crate) fn format_ts_decorator_attr(node: Node<'_>, src: &str) -> String {
    let txt = normalize_single_line(node_text(node, src));
    if txt.starts_with('@') { txt } else { format!("@{txt}") }
}

pub(crate) fn push_attrs_to_trivia(tr: &mut Trivia, attrs: Vec<String>) {
    for text in attrs {
        if !text.is_empty() {
            tr.leading.push(TriviaComment { kind: TriviaKind::Attribute, text });
        }
    }
}

pub(crate) fn is_ts_readonly_prefix(node: Node<'_>, target_field: &str, src: &str) -> bool {
    let end = node
        .child_by_field_name(target_field)
        .or_else(|| node.child_by_field_name("name"))
        .or_else(|| node.child_by_field_name("pattern"))
        .or_else(|| node.child_by_field_name("property"))
        .or_else(|| node.child_by_field_name("type"))
        .map(|n| n.start_byte())
        .unwrap_or(node.end_byte());
    let hdr = src.get(node.start_byte()..end).unwrap_or("");
    hdr.split_whitespace().any(|w| w == "readonly")
}

pub(crate) fn is_ts_prop_optional(node: Node<'_>, src: &str) -> bool {
    let start = node
        .child_by_field_name("name")
        .or_else(|| node.child_by_field_name("property"))
        .map(|n| n.end_byte())
        .unwrap_or(node.start_byte());
    let end = node
        .child_by_field_name("type")
        .or_else(|| node.child_by_field_name("value"))
        .map(|n| n.start_byte())
        .unwrap_or(node.end_byte());
    src.get(start..end).is_some_and(|s| s.contains('?'))
}

pub(crate) fn extract_ts_param_vis(node: Node<'_>, src: &str) -> Visibility {
    if let Some(am) = child_by_kind(node, "accessibility_modifier") {
        return match node_text(am, src).trim() {
            "public" => Visibility::Public,
            "private" => Visibility::Private,
            "protected" => Visibility::Protected,
            _ => Visibility::Default,
        };
    }
    let end = node
        .child_by_field_name("pattern")
        .or_else(|| node.child_by_field_name("name"))
        .map(|n| n.start_byte())
        .unwrap_or(node.start_byte());
    let hdr = src.get(node.start_byte()..end).unwrap_or("");
    if hdr.split_whitespace().any(|w| w == "private") { Visibility::Private }
    else if hdr.split_whitespace().any(|w| w == "protected") { Visibility::Protected }
    else if hdr.split_whitespace().any(|w| w == "public") { Visibility::Public }
    else { Visibility::Default }
}

pub(crate) fn extract_ts_class_heritage(node: Node<'_>, src: &str) -> (Option<String>, Vec<String>) {
    let Some(her) = child_by_kind(node, "class_heritage") else {
        return (None, Vec::new());
    };
    let mut extends = None;
    let mut implements = Vec::new();
    for ch in named_children(her) {
        if ch.kind() == "extends_clause" {
            let raw = node_text(ch, src).trim();
            let val = raw.strip_prefix("extends").unwrap_or(raw).trim();
            if !val.is_empty() {
                extends = Some(val.to_string());
            }
        } else if ch.kind() == "implements_clause" {
            let raw = node_text(ch, src).trim();
            let body = raw.strip_prefix("implements").unwrap_or(raw).trim();
            for part in body.split(',') {
                let p = part.trim();
                if !p.is_empty() {
                    implements.push(p.to_string());
                }
            }
        }
    }
    (extends, implements)
}

pub(crate) fn extract_rust_closure_params<'a>(
    pn: Node<'a>,
    src: &'a str,
) -> (Vec<ParamDecl>, Vec<Option<Node<'a>>>) {
    let mut params = Vec::new();
    let mut def_nodes = Vec::new();
    let mut cur = pn.walk();
    for c in pn.children(&mut cur) {
        if !c.is_named() {
            if c.kind() == "_" {
                params.push(ParamDecl {
                    name: "_".into(), vis: Default::default(), is_readonly: false, is_mut: false,
                    is_optional: false, is_rest: false, ty: None, default: None, trivia: Trivia::default(),
                });
                def_nodes.push(None);
            }
            continue;
        }
        if is_comment_kind(c.kind()) { continue; }
        if c.kind() == "parameter" {
            let raw_p = c.child_by_field_name("pattern")
                .map(|p| node_text(p, src).trim())
                .unwrap_or_else(|| node_text(c, src).split(':').next().unwrap_or("_").trim());
            let (is_mut, name) = match raw_p.strip_prefix("mut ") {
                Some(rest) => (true, rest.trim().to_string()),
                None => (false, raw_p.to_string()),
            };
            let ty = c.child_by_field_name("type").map(|t| map_type_str(node_text(t, src).trim(), LanguageId::Rust));
            if !name.is_empty() {
                params.push(ParamDecl {
                    name, vis: Default::default(), is_readonly: false, is_mut,
                    is_optional: false, is_rest: false, ty, default: None, trivia: Trivia::default(),
                });
                def_nodes.push(None);
            }
        } else if c.kind() == "mut_pattern" {
            let nm = node_text(c, src).trim().strip_prefix("mut").unwrap_or("").trim().to_string();
            if !nm.is_empty() {
                params.push(ParamDecl {
                    name: nm, vis: Default::default(), is_readonly: false, is_mut: true,
                    is_optional: false, is_rest: false, ty: None, default: None, trivia: Trivia::default(),
                });
                def_nodes.push(None);
            }
        } else {
            let nm = node_text(c, src).trim().to_string();
            if !nm.is_empty() {
                params.push(ParamDecl {
                    name: nm, vis: Default::default(), is_readonly: false, is_mut: false,
                    is_optional: false, is_rest: false, ty: None, default: None, trivia: Trivia::default(),
                });
                def_nodes.push(None);
            }
        }
    }
    (params, def_nodes)
}

fn unwrap_cpp_param_decl(mut node: Node<'_>, src: &str) -> (String, String) {
    let mut quals = String::new();
    while matches!(
        node.kind(),
        "pointer_declarator" | "reference_declarator" | "abstract_pointer_declarator"
            | "abstract_reference_declarator" | "parenthesized_declarator"
    ) {
        if matches!(node.kind(), "reference_declarator" | "abstract_reference_declarator") {
            if node_text(node, src).trim_start().starts_with("&&") { quals.push_str("&&"); }
            else { quals.push('&'); }
        } else if matches!(node.kind(), "pointer_declarator" | "abstract_pointer_declarator") {
            quals.push('*');
        }
        if let Some(inner) = node.child_by_field_name("declarator")
            .or_else(|| named_children(node).into_iter().last())
        {
            node = inner;
        } else {
            break;
        }
    }
    let nm = node_text(node, src).trim().trim_start_matches(['*', '&']).trim().to_string();
    (if nm.is_empty() { "p".into() } else { nm }, quals)
}

pub(crate) fn extract_cpp_lambda_params<'a>(
    node: Node<'a>,
    src: &'a str,
) -> (Vec<ParamDecl>, Vec<Option<Node<'a>>>) {
    let mut params = Vec::new();
    let mut def_nodes = Vec::new();
    let decl = node.child_by_field_name("declarator").or_else(|| child_by_kind(node, "lambda_declarator"));
    let pl = decl
        .and_then(|d| d.child_by_field_name("parameters").or_else(|| child_by_kind(d, "parameter_list")))
        .or_else(|| child_by_kind(node, "parameter_list"));
    let Some(pl) = pl else { return (params, def_nodes); };
    for pd in named_children(pl) {
        if !matches!(pd.kind(), "parameter_declaration" | "optional_parameter_declaration") { continue; }
        let decl_n = pd.child_by_field_name("declarator");
        let raw_ty = decl_n
            .and_then(|d| src.get(pd.start_byte()..d.start_byte()))
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .or_else(|| field_text(pd, "type", src).map(str::trim))
            .unwrap_or("auto");
        let (name, quals) = decl_n
            .map(|d| unwrap_cpp_param_decl(d, src))
            .unwrap_or_else(|| ("p".into(), String::new()));
        let ty = Some(map_type_str(&format!("{raw_ty}{quals}"), LanguageId::Cpp));
        let def = pd.child_by_field_name("default_value");
        params.push(ParamDecl {
            name, vis: Default::default(), is_readonly: false, is_mut: false,
            is_optional: false, is_rest: false, ty, default: None, trivia: Trivia::default(),
        });
        def_nodes.push(def);
    }
    (params, def_nodes)
}

pub(crate) fn extract_ts_destructured_param_stmts(
    param_list: Node<'_>,
    src: &str,
    lang: LanguageId,
) -> Vec<Stmt> {
    let mut out = Vec::new();
    for (idx, ch) in named_children(param_list).into_iter().enumerate() {
        if !matches!(
            ch.kind(),
            "required_parameter" | "optional_parameter" | "assignment_pattern"
                | "identifier" | "object_pattern" | "array_pattern" | "rest_pattern"
        ) {
            continue;
        }
        let pat_node = if ch.kind() == "assignment_pattern" {
            ch.child_by_field_name("left").or_else(|| named_children(ch).into_iter().next())
        } else if matches!(ch.kind(), "object_pattern" | "array_pattern") {
            Some(ch)
        } else {
            ch.child_by_field_name("pattern").or_else(|| ch.child_by_field_name("name"))
        };
        let Some(pat) = pat_node else { continue; };
        let pname = if idx == 0 && lang == LanguageId::Tsx { "props".to_string() } else { format!("arg{idx}") };
        if pat.kind() == "object_pattern" {
            let parts: Vec<String> = named_children(pat)
                .into_iter()
                .filter(|c| !is_comment_kind(c.kind()))
                .map(|c| normalize_single_line(node_text(c, src)))
                .filter(|s| !s.is_empty())
                .collect();
            if !parts.is_empty() {
                out.push(Stmt::Let {
                    name: format!("{{ {} }}", parts.join(", ")),
                    is_mut: false,
                    ty: None,
                    init: Expr::Ident(pname),
                    trivia: Trivia::default(),
                });
            }
        } else if pat.kind() == "array_pattern" {
            let names: Vec<String> = named_children(pat)
                .into_iter()
                .filter(|c| !is_comment_kind(c.kind()))
                .map(|c| node_text(c, src).trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if !names.is_empty() {
                out.push(Stmt::Destructure {
                    names,
                    is_mut: false,
                    ty: None,
                    init: Expr::Ident(pname),
                    trivia: Trivia::default(),
                });
            }
        }
    }
    out
}
