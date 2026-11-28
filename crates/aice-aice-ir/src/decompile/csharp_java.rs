use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::csharp;
use crate::decompile::cst_util::{child_by_kind, field_text, map_type_str, named_children, node_text};
use crate::decompile::iter_env::{DTask, DecompEnv};
use crate::decompile::iter_stmt::{StmtFin, push_stmt_nodes};
use crate::decompile::java_lang;
use crate::decompile::match_cf::parse_simple_pattern;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::ir::{AiceModule, TranspileError, TranspileOpts};
use crate::ir_code::{FnBody, Pattern};
use crate::ir_types::TypeParam;

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    match tree.language() {
        LanguageId::CSharp => csharp::decompile(tree, src, opts),
        _ => java_lang::decompile(tree, src, opts),
    }
}

pub(crate) fn extract_java_type_params(node: Node<'_>, src: &str) -> Vec<TypeParam> {
    let Some(tps) = node.child_by_field_name("type_parameters").or_else(|| child_by_kind(node, "type_parameters")) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for ch in named_children(tps) {
        if ch.kind() != "type_parameter" { continue; }
        let name = child_by_kind(ch, "type_identifier")
            .or_else(|| child_by_kind(ch, "identifier"))
            .map(|n| node_text(n, src).trim().to_string())
            .unwrap_or_else(|| node_text(ch, src).split_whitespace().next().unwrap_or("T").to_string());
        let mut bounds = Vec::new();
        if let Some(tb) = child_by_kind(ch, "type_bound") {
            for b in named_children(tb) {
                if !is_comment_kind(b.kind()) {
                    let txt = node_text(b, src).trim();
                    if !txt.is_empty() {
                        bounds.push(map_type_str(txt, LanguageId::Java));
                    }
                }
            }
        }
        if !name.is_empty() {
            out.push(TypeParam { name, bounds, default: None });
        }
    }
    out
}

pub(crate) fn extract_cs_type_params(node: Node<'_>, src: &str) -> Vec<TypeParam> {
    let Some(tps) = node.child_by_field_name("type_parameters").or_else(|| child_by_kind(node, "type_parameter_list")) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for ch in named_children(tps) {
        if ch.kind() != "type_parameter" { continue; }
        let name = field_text(ch, "name", src)
            .or_else(|| child_by_kind(ch, "identifier").map(|n| node_text(n, src)))
            .unwrap_or("T")
            .trim()
            .to_string();
        if !name.is_empty() {
            out.push(TypeParam { name, bounds: Vec::new(), default: None });
        }
    }
    for cl in named_children(node) {
        if cl.kind() != "type_parameter_constraints_clause" { continue; }
        let target = field_text(cl, "target", src)
            .or_else(|| child_by_kind(cl, "identifier").map(|n| node_text(n, src)))
            .unwrap_or("")
            .trim();
        let Some(tp) = out.iter_mut().find(|tp| tp.name == target) else { continue; };
        for c in named_children(cl) {
            if c.kind() == "type_parameter_constraint" {
                let txt = node_text(c, src).trim();
                if !txt.is_empty() {
                    tp.bounds.push(map_type_str(txt, LanguageId::CSharp));
                }
            }
        }
    }
    out
}

pub(crate) fn java_has_mod(node: Node<'_>, src: &str, kw: &str) -> bool {
    let Some(mods) = child_by_kind(node, "modifiers") else { return false; };
    let mut cur = mods.walk();
    mods.children(&mut cur).any(|c| !c.is_named() && node_text(c, src).trim() == kw)
}

pub(crate) fn extract_java_annotations(node: Node<'_>, src: &str) -> Vec<String> {
    let Some(mods) = child_by_kind(node, "modifiers") else { return Vec::new(); };
    named_children(mods).into_iter()
        .filter(|c| matches!(c.kind(), "annotation" | "marker_annotation"))
        .map(|c| crate::decompile::ts_helpers::normalize_single_line(node_text(c, src)))
        .filter(|s| !s.is_empty())
        .collect()
}

fn collect_java_type_list(container: Node<'_>, src: &str) -> Vec<String> {
    let list = child_by_kind(container, "type_list").unwrap_or(container);
    named_children(list)
        .into_iter()
        .filter(|c| !is_comment_kind(c.kind()))
        .map(|c| node_text(c, src).trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

pub(crate) fn extract_java_heritage(node: Node<'_>, src: &str) -> (Option<String>, Vec<String>) {
    let extends = node
        .child_by_field_name("superclass")
        .or_else(|| child_by_kind(node, "superclass"))
        .and_then(|sc| {
            named_children(sc)
                .into_iter()
                .find(|c| !is_comment_kind(c.kind()))
                .map(|t| node_text(t, src).trim().to_string())
        })
        .filter(|s| !s.is_empty());
    let implements = node
        .child_by_field_name("interfaces")
        .or_else(|| child_by_kind(node, "super_interfaces"))
        .map(|si| collect_java_type_list(si, src))
        .unwrap_or_default();
    (extends, implements)
}

pub(crate) fn extract_java_iface_extends(node: Node<'_>, src: &str) -> Vec<String> {
    child_by_kind(node, "extends_interfaces")
        .map(|ei| collect_java_type_list(ei, src))
        .unwrap_or_default()
}

pub(crate) fn java_body_has_unhandled(body: Node<'_>) -> bool {
    named_children(body).into_iter().any(|ch| {
        !is_comment_kind(ch.kind())
            && !matches!(
                ch.kind(),
                "static_initializer" | "field_declaration" | "method_declaration"
                    | "constructor_declaration" | "record_declaration" | "class_declaration"
                    | "interface_declaration" | "enum_declaration"
            )
    })
}

pub(crate) fn cs_has_mod(node: Node<'_>, src: &str, kw: &str) -> bool {
    named_children(node)
        .into_iter()
        .any(|c| c.kind() == "modifier" && node_text(c, src).trim() == kw)
}

pub(crate) fn extract_cs_base_list(node: Node<'_>, src: &str) -> Vec<String> {
    let Some(bl) = child_by_kind(node, "base_list") else { return Vec::new(); };
    let mut out = Vec::new();
    for ch in named_children(bl) {
        if is_comment_kind(ch.kind()) || ch.kind() == "argument_list" { continue; }
        let txt = node_text(ch, src).trim();
        if !txt.is_empty() && !txt.contains('(') {
            out.push(txt.to_string());
        }
    }
    out
}

fn push_switch_arm_block<'a>(env: &mut DecompEnv<'a>, pat: Pattern, ch: Node<'a>, stmts: Vec<Node<'a>>) {
    env.tasks.push(DTask::FinishStmt(StmtFin::MatchArm { pat, has_guard: false, trivia: collect_trivia(ch, env.src, env.opts) }));
    if stmts.is_empty() {
        env.bodies.push(FnBody::Block(Vec::new()));
    } else {
        env.tasks.push(DTask::FinishFnBodyFromBlock { single_expr_collapse: false });
        let base = env.stmts.len();
        env.tasks.push(DTask::FinishBlock(base));
        push_stmt_nodes(env, stmts);
    }
}

pub(crate) fn push_cs_switch_section<'a>(env: &mut DecompEnv<'a>, ch: Node<'a>) {
    let last_colon = (0..ch.child_count())
        .filter_map(|i| ch.child(i))
        .filter(|c| !c.is_named() && c.kind() == ":")
        .map(|c| c.end_byte())
        .max()
        .unwrap_or(ch.start_byte());
    let (mut pats, mut is_def, mut stmts) = (Vec::new(), false, Vec::new());
    for i in 0..ch.child_count() {
        let Some(c) = ch.child(i) else { continue };
        if c.end_byte() <= last_colon {
            if !c.is_named() && c.kind() == "default" { is_def = true; }
            else if c.is_named() && !is_comment_kind(c.kind()) && c.kind() != "when_clause" {
                pats.push(parse_simple_pattern(node_text(c, env.src).trim()));
            }
        } else if c.is_named() && !is_comment_kind(c.kind()) {
            stmts.push(c);
        }
    }
    let pat = if is_def || pats.is_empty() { Pattern::Wildcard }
        else if pats.len() == 1 { pats.remove(0) } else { Pattern::Or(pats) };
    push_switch_arm_block(env, pat, ch, stmts);
}

pub(crate) fn push_java_switch_group<'a>(env: &mut DecompEnv<'a>, ch: Node<'a>) {
    let (mut pats, mut is_def, mut stmts) = (Vec::new(), false, Vec::new());
    for c in named_children(ch) {
        if is_comment_kind(c.kind()) { continue; }
        if c.kind() == "switch_label" {
            if node_text(c, env.src).trim_start().starts_with("default") { is_def = true; }
            else {
                for e in named_children(c) {
                    if !is_comment_kind(e.kind()) { pats.push(parse_simple_pattern(node_text(e, env.src).trim())); }
                }
            }
        } else { stmts.push(c); }
    }
    let pat = if is_def || pats.is_empty() { Pattern::Wildcard }
        else if pats.len() == 1 { pats.remove(0) } else { Pattern::Or(pats) };
    push_switch_arm_block(env, pat, ch, stmts);
}

pub(crate) fn push_js_switch_arm<'a>(env: &mut DecompEnv<'a>, ch: Node<'a>) {
    let pat = if ch.kind() == "switch_default" { Pattern::Wildcard }
        else { field_text(ch, "value", env.src).map(|s| parse_simple_pattern(s.trim())).unwrap_or(Pattern::Wildcard) };
    let mut cur = ch.walk();
    let stmts: Vec<Node<'a>> = ch.children_by_field_name("body", &mut cur).filter(|c| !is_comment_kind(c.kind())).collect();
    push_switch_arm_block(env, pat, ch, stmts);
}
