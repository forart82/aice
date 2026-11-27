use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, map_type_str, named_children, node_text};
use crate::decompile::iter_env::{DTask, DecompEnv};
use crate::decompile::iter_stmt::StmtFin;
use crate::decompile::stmt_common::find_body_node;
use crate::decompile::stmt_vars::{find_catch_parts, find_dart_catch_parts};
use crate::decompile::trivia::{collect_header_trailing, is_comment_kind};
use crate::ir::Trivia;
use crate::ir_code::Expr;
use crate::ir_expr::LiteralVal;

fn extract_if_init_cond(env: &DecompEnv<'_>, node: Node<'_>, cond_n: Option<Node<'_>>) -> Option<Expr> {
    if env.lang == LanguageId::Go
        && let Some(init_n) = node.child_by_field_name("initializer")
    {
        let end = cond_n.map_or(init_n.end_byte(), |c| c.end_byte());
        let txt = env.src.get(init_n.start_byte()..end)?.trim();
        if !txt.is_empty() {
            return Some(if txt.contains('\n') { Expr::Raw(txt.to_string()) } else { Expr::Ident(txt.to_string()) });
        }
    }
    None
}

pub(crate) fn extract_go_switch_init_hdr(env: &DecompEnv<'_>, node: Node<'_>) -> Option<Expr> {
    if env.lang != LanguageId::Go || node.kind() != "expression_switch_statement" {
        return None;
    }
    let init_n = node.child_by_field_name("initializer")?;
    let brace_pos = (0..node.child_count())
        .filter_map(|i| node.child(i))
        .find(|c| !c.is_named() && c.kind() == "{")
        .map_or(node.end_byte(), |b| b.start_byte());
    let hdr = env.src.get(init_n.start_byte()..brace_pos)?.trim();
    if hdr.is_empty() {
        return None;
    }
    Some(if hdr.contains('\n') { Expr::Raw(hdr.to_string()) } else { Expr::Ident(hdr.to_string()) })
}

fn extract_kt_if_branches<'a>(node: Node<'a>, cond_n: Option<Node<'a>>) -> (Option<Node<'a>>, Option<Node<'a>>) {
    let after_cond = cond_n.map_or(node.start_byte(), |c| c.end_byte());
    let (mut seen_else, mut then_n, mut alt_n) = (false, None, None);
    let mut cur = node.walk();
    for ch in node.children(&mut cur) {
        if ch.start_byte() < after_cond { continue; }
        if !ch.is_named() {
            if ch.kind() == "else" { seen_else = true; }
            continue;
        }
        if is_comment_kind(ch.kind()) { continue; }
        if seen_else { if alt_n.is_none() { alt_n = Some(ch); } }
        else if then_n.is_none() { then_n = Some(ch); }
    }
    (then_n, alt_n)
}

pub(crate) fn push_if_task<'a>(env: &mut DecompEnv<'a>, root: Node<'a>) {
    let mut cond_nodes: Vec<Option<Node<'a>>> = Vec::new();
    let mut cond_overrides: Vec<Option<Expr>> = Vec::new();
    let mut then_nodes: Vec<Option<Node<'a>>> = Vec::new();
    let mut elif_trivias: Vec<Trivia> = Vec::new();
    let mut else_node: Option<Node<'a>> = None;
    let mut else_trivia = Trivia::default();
    let mut root_trailing = None;

    let mut cur = Some(root);
    let mut is_first = true;
    while let Some(node) = cur.take() {
        let cond_n = node.child_by_field_name("condition");
        let (then_n, kt_alt) = if env.lang == LanguageId::Kotlin && node.kind() == "if_expression" {
            extract_kt_if_branches(node, cond_n)
        } else {
            (find_body_node(node), None)
        };
        let tr = then_n.and_then(|bn| collect_header_trailing(bn, env.src, env.opts));
        if is_first {
            root_trailing = tr;
            is_first = false;
        } else {
            elif_trivias.push(Trivia { trailing: tr, ..Trivia::default() });
        }
        if let Some(ov) = extract_if_init_cond(env, node, cond_n) {
            cond_nodes.push(None);
            cond_overrides.push(Some(ov));
        } else if cond_n.is_none() {
            cond_nodes.push(None);
            cond_overrides.push(Some(Expr::Literal(LiteralVal::Bool(true))));
        } else {
            cond_nodes.push(cond_n);
            cond_overrides.push(None);
        }
        then_nodes.push(then_n);

        if let Some(alt) = kt_alt {
            if alt.kind() == "if_expression" {
                cur = Some(alt);
            } else if alt.kind() == "control_structure_body"
                && let Some(sub_if) = named_children(alt).into_iter().find(|k| k.kind() == "if_expression")
            {
                cur = Some(sub_if);
            } else {
                else_trivia.trailing = collect_header_trailing(alt, env.src, env.opts);
                else_node = Some(alt);
            }
            continue;
        }

        if let Some(alt) = node.child_by_field_name("alternative")
            && !matches!(alt.kind(), "elif_clause" | "else_if_clause")
        {
            if matches!(alt.kind(), "if_statement" | "if_expression" | "elsif") {
                cur = Some(alt);
            } else if matches!(alt.kind(), "else_clause" | "else") {
                let kids = named_children(alt);
                if let Some(sub_if) = kids.iter().find(|k| matches!(k.kind(), "if_statement" | "if_expression")) {
                    cur = Some(*sub_if);
                } else {
                    let ebn = find_body_node(alt);
                    else_trivia.trailing = ebn.and_then(|bn| collect_header_trailing(bn, env.src, env.opts))
                        .or_else(|| collect_header_trailing(alt, env.src, env.opts));
                    else_node = Some(ebn.unwrap_or(alt));
                }
            } else {
                else_trivia.trailing = collect_header_trailing(alt, env.src, env.opts);
                else_node = Some(alt);
            }
        }
        for ch in named_children(node) {
            if matches!(ch.kind(), "elif_clause" | "else_if_clause") {
                let ebn = find_body_node(ch);
                elif_trivias.push(Trivia {
                    trailing: ebn.and_then(|bn| collect_header_trailing(bn, env.src, env.opts)),
                    ..Trivia::default()
                });
                let c = ch.child_by_field_name("condition");
                if c.is_none() {
                    cond_nodes.push(None);
                    cond_overrides.push(Some(Expr::Literal(LiteralVal::Bool(true))));
                } else {
                    cond_nodes.push(c);
                    cond_overrides.push(None);
                }
                then_nodes.push(ebn);
            } else if matches!(ch.kind(), "else_clause" | "else") && else_node.is_none() && cur.is_none() {
                let kids = named_children(ch);
                if let Some(sub_if) = kids.iter().find(|k| matches!(k.kind(), "if_statement" | "if_expression")) {
                    cur = Some(*sub_if);
                } else {
                    let ebn = find_body_node(ch);
                    else_trivia.trailing = ebn.and_then(|bn| collect_header_trailing(bn, env.src, env.opts))
                        .or_else(|| collect_header_trailing(ch, env.src, env.opts));
                    else_node = Some(ebn.unwrap_or(ch));
                }
            }
        }
    }

    let has_thens: Vec<bool> = then_nodes.iter().map(Option::is_some).collect();
    env.tasks.push(DTask::FinishStmt(StmtFin::If {
        elif_count: cond_nodes.len() - 1,
        has_else: else_node.is_some(),
        elif_trivias,
        else_trivia,
        trivia: Trivia { trailing: root_trailing, ..Trivia::default() },
        has_thens,
        has_else_body: else_node.is_some(),
        cond_overrides,
    }));
    if let Some(en) = else_node { env.tasks.push(DTask::Block(en)); }
    for i in (1..cond_nodes.len()).rev() {
        if let Some(tn) = then_nodes[i] { env.tasks.push(DTask::Block(tn)); }
        if let Some(cn) = cond_nodes[i] { env.tasks.push(DTask::Expr(cn)); }
    }
    if let Some(tn) = then_nodes[0] { env.tasks.push(DTask::Block(tn)); }
    if let Some(cn) = cond_nodes[0] { env.tasks.push(DTask::Expr(cn)); }
}

pub(crate) fn push_try_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>) {
    let try_bn = find_body_node(node);
    let try_hdr = try_bn.and_then(|b| collect_header_trailing(b, env.src, env.opts));
    let mut catches = Vec::new();
    let mut else_bn = None;
    let mut else_trivia = Trivia::default();
    let mut finally_bn = None;
    let mut finally_trivia = Trivia::default();
    if env.lang == LanguageId::Dart {
        let kids: Vec<Node<'a>> = named_children(node)
            .into_iter()
            .filter(|c| !is_comment_kind(c.kind()) && Some(*c) != try_bn)
            .collect();
        let mut i = 0usize;
        while i < kids.len() {
            match kids[i].kind() {
                "finally_clause" => {
                    let fbn = find_body_node(kids[i]);
                    finally_trivia.trailing = fbn.and_then(|b| collect_header_trailing(b, env.src, env.opts));
                    finally_bn = fbn;
                    i += 1;
                }
                "type" => {
                    let ty_n = kids[i];
                    i += 1;
                    let cc_n = kids.get(i).copied().filter(|c| c.kind() == "catch_clause");
                    if cc_n.is_some() { i += 1; }
                    let bn = kids.get(i).copied().filter(|c| c.kind() == "block");
                    if bn.is_some() { i += 1; }
                    catches.push(find_dart_catch_parts(Some(ty_n), cc_n, bn, env.src, env.opts));
                }
                "catch_clause" => {
                    let cc_n = kids[i];
                    i += 1;
                    let bn = kids.get(i).copied().filter(|c| c.kind() == "block");
                    if bn.is_some() { i += 1; }
                    catches.push(find_dart_catch_parts(None, Some(cc_n), bn, env.src, env.opts));
                }
                _ => i += 1,
            }
        }
    } else {
        for ch in named_children(node) {
            if matches!(ch.kind(), "catch_clause" | "except_clause" | "catch_block") {
                catches.push(find_catch_parts(ch, env.src, env.lang, env.opts));
            } else if ch.kind() == "else_clause" {
                let ebn = find_body_node(ch);
                else_trivia.trailing = ebn.and_then(|b| collect_header_trailing(b, env.src, env.opts));
                else_bn = ebn;
            } else if matches!(ch.kind(), "finally_clause" | "finally_block") {
                let fbn = find_body_node(ch);
                finally_trivia.trailing = fbn.and_then(|b| collect_header_trailing(b, env.src, env.opts));
                finally_bn = fbn;
            }
        }
    }
    env.tasks.push(DTask::FinishStmt(StmtFin::Try {
        catch_len: catches.len(),
        has_else: else_bn.is_some(),
        else_trivia,
        has_finally: finally_bn.is_some(),
        finally_trivia,
        trivia: Trivia { trailing: try_hdr, ..Trivia::default() },
    }));
    if let Some(fb) = finally_bn { env.tasks.push(DTask::Block(fb)); }
    if let Some(eb) = else_bn { env.tasks.push(DTask::Block(eb)); }
    for (param, ty, tr, bn) in catches.into_iter().rev() {
        env.tasks.push(DTask::FinishStmt(StmtFin::Catch { param, ty, has_body: bn.is_some(), trivia: tr }));
        if let Some(b) = bn { env.tasks.push(DTask::Block(b)); }
    }
    if let Some(tb) = try_bn { env.tasks.push(DTask::Block(tb)); } else { env.blocks.push(Vec::new()); }
}

pub(crate) fn push_ruby_begin<'a>(env: &mut DecompEnv<'a>, node: Node<'a>) {
    let mut nodes_to_scan = Vec::new();
    if let Some(bs) = child_by_kind(node, "body_statement") { nodes_to_scan.extend(named_children(bs)); }
    for ch in named_children(node) { if ch.kind() != "body_statement" { nodes_to_scan.push(ch); } }
    let mut try_nodes = Vec::new();
    let mut rescues = Vec::new();
    let mut else_n = None;
    let mut ensure_n = None;
    for ch in nodes_to_scan {
        if is_comment_kind(ch.kind()) { continue; }
        match ch.kind() {
            "rescue" => rescues.push(ch),
            "ensure" => ensure_n = ch.child_by_field_name("body").or_else(|| child_by_kind(ch, "then")).or(Some(ch)),
            "else" => else_n = ch.child_by_field_name("body").or_else(|| child_by_kind(ch, "then")).or(Some(ch)),
            _ => try_nodes.push(ch),
        }
    }
    env.tasks.push(DTask::FinishStmt(StmtFin::Try {
        catch_len: rescues.len(), has_else: else_n.is_some(), else_trivia: Trivia::default(),
        has_finally: ensure_n.is_some(), finally_trivia: Trivia::default(), trivia: Trivia::default(),
    }));
    if let Some(eb) = ensure_n { env.tasks.push(DTask::Block(eb)); }
    if let Some(elb) = else_n { env.tasks.push(DTask::Block(elb)); }
    for ch in rescues.into_iter().rev() {
        let var_node = ch.child_by_field_name("variable").or_else(|| child_by_kind(ch, "exception_variable"));
        let param = var_node.and_then(|v| named_children(v).into_iter().last().or(Some(v)))
            .map(|n| node_text(n, env.src).trim().trim_start_matches("=>").trim().to_string()).filter(|s| !s.is_empty());
        let ty = ch.child_by_field_name("exceptions").or_else(|| child_by_kind(ch, "exceptions"))
            .map(|e| map_type_str(node_text(e, env.src).trim(), env.lang));
        let bn = ch.child_by_field_name("body").or_else(|| child_by_kind(ch, "then"));
        env.tasks.push(DTask::FinishStmt(StmtFin::Catch { param, ty, has_body: bn.is_some(), trivia: Trivia::default() }));
        if let Some(b) = bn { env.tasks.push(DTask::Block(b)); }
    }
    let base = env.stmts.len();
    env.tasks.push(DTask::FinishBlock(base));
    for ch in try_nodes.into_iter().rev() { env.tasks.push(DTask::Stmt(ch)); }
}
