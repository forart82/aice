use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{field_text, named_children, node_text};
use crate::decompile::iter_env::{DTask, DecompEnv};
use crate::decompile::iter_stmt::{StmtFin, push_stmt_nodes};
use crate::decompile::match_cf::parse_simple_pattern;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::ir_code::{Expr, FnBody, LiteralVal, Pattern};

pub(crate) fn is_raw_passthrough_expr(kind: &str, lang: LanguageId) -> bool {
    matches!(
        kind,
        "char_literal"
            | "character_literal"
            | "rune_literal"
            | "byte_literal"
            | "byte_string_literal"
            | "raw_byte_string_literal"
            | "c_string_literal"
            | "raw_c_string_literal"
    ) || matches!(
        (kind, lang),
        ("object_literal" | "try_expression" | "lambda_literal" | "annotated_lambda", LanguageId::Kotlin)
            | ("anonymous_class" | "arrow_function" | "anonymous_function", LanguageId::Php)
            | ("text_block", LanguageId::Java)
            | ("switch_expression", LanguageId::Java | LanguageId::CSharp)
            | ("send_statement" | "channel_type" | "composite_literal" | "func_literal", LanguageId::Go)
            | ("range_expression" | "async_block" | "unsafe_block" | "loop_expression", LanguageId::Rust)
            | ("satisfies_expression", LanguageId::TypeScript | LanguageId::Tsx)
            | ("compound_literal_expression" | "initializer_list", LanguageId::C | LanguageId::Cpp)
            | ("template_function" | "lambda_expression", LanguageId::Cpp)
    )
}

pub(crate) fn is_cs_mod_arg(node: Node<'_>) -> bool {
    node.child_by_field_name("name").is_some()
        || (0..node.child_count())
            .filter_map(|i| node.child(i))
            .any(|c| {
                (!c.is_named() && matches!(c.kind(), "ref" | "out" | "in"))
                    || c.kind() == "declaration_expression"
            })
}

pub(crate) fn is_c_arrow_field(node: Node<'_>, gap: &str, src: &str, lang: LanguageId) -> bool {
    matches!(lang, LanguageId::C | LanguageId::Cpp)
        && (node.child_by_field_name("operator").is_some_and(|o| node_text(o, src).trim() == "->")
            || gap.contains("->"))
}

pub(crate) fn is_c_raw_member(node: Node<'_>, last: Node<'_>, src: &str, lang: LanguageId) -> bool {
    matches!(lang, LanguageId::C | LanguageId::Cpp)
        && (matches!(last.kind(), "template_method" | "destructor_name" | "qualified_identifier" | "dependent_name")
            || node.child_by_field_name("operator").is_some_and(|o| node_text(o, src).trim() == ".*"))
}

pub(crate) fn is_c_paren_unary(node: Node<'_>, lang: LanguageId) -> bool {
    matches!(lang, LanguageId::C | LanguageId::Cpp)
        && node.kind() == "parenthesized_expression"
        && named_children(node).first().is_some_and(|c| {
            matches!(c.kind(), "pointer_expression" | "unary_expression" | "update_expression")
        })
}

pub(crate) fn is_rust_prefixed_raw_str(t: &str) -> bool {
    t.starts_with("b\"")
        || t.starts_with("br\"")
        || t.starts_with("br#")
        || t.starts_with("c\"")
        || t.starts_with("cr\"")
        || t.starts_with("cr#")
}

pub(crate) fn is_py_prefixed_raw_str(t: &str) -> bool {
    let pfx_len = t.bytes().take_while(|b| b.is_ascii_alphabetic()).count();
    if pfx_len == 0 || pfx_len > 2 {
        return false;
    }
    let rest = &t[pfx_len..];
    if !(rest.starts_with('"') || rest.starts_with('\'')) {
        return false;
    }
    matches!(
        t[..pfx_len].to_ascii_lowercase().as_str(),
        "b" | "rb" | "br" | "u"
    )
}

pub(crate) fn is_regular_interpreted_str(t: &str, lang: LanguageId) -> bool {
    match lang {
        LanguageId::Rust | LanguageId::C | LanguageId::Cpp | LanguageId::Go | LanguageId::Ruby => {
            t.starts_with('"') && t.ends_with('"') && t.len() >= 2
        }
        LanguageId::Java | LanguageId::CSharp | LanguageId::Kotlin => {
            t.starts_with('"') && !t.starts_with("\"\"\"") && t.ends_with('"') && t.len() >= 2
        }
        LanguageId::Python => {
            (t.starts_with('"') && !t.starts_with("\"\"\"") && t.ends_with('"') && t.len() >= 2)
                || (t.starts_with('\'') && !t.starts_with("'''") && t.ends_with('\'') && t.len() >= 2)
        }
        LanguageId::Dart => {
            (t.starts_with('"') && t.ends_with('"') && t.len() >= 2)
                || (t.starts_with('\'') && t.ends_with('\'') && t.len() >= 2)
        }
        _ => false,
    }
}

pub(crate) fn try_unescape_std_str(s: &str, allow_single_quote: bool) -> Option<String> {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('\\') => out.push('\\'),
            Some('"') => out.push('"'),
            Some('\'') if allow_single_quote => out.push('\''),
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('t') => out.push('\t'),
            _ => return None,
        }
    }
    Some(out)
}

pub(crate) fn unescape_ruby_single_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('\\') => out.push('\\'),
            Some('\'') => out.push('\''),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

pub(crate) fn decompile_non_js_str(t: &str, inner: String, lang: LanguageId) -> Expr {
    if lang == LanguageId::Rust && is_rust_prefixed_raw_str(t) {
        return Expr::Raw(t.to_string());
    }
    if lang == LanguageId::Python && is_py_prefixed_raw_str(t) {
        return Expr::Raw(t.to_string());
    }
    if lang == LanguageId::Java && t.starts_with("\"\"\"") && t.ends_with("\"\"\"") && t.len() >= 6 {
        return Expr::Raw(t.to_string());
    }
    let multiline = inner.contains('\n');
    if lang == LanguageId::Php {
        return decompile_php_str(t, inner, multiline);
    }
    if lang == LanguageId::Ruby && t.starts_with('\'') && t.ends_with('\'') && t.len() >= 2 {
        let value = if inner.contains('\\') { unescape_ruby_single_str(&inner) } else { inner };
        return Expr::Literal(LiteralVal::Str { value, multiline });
    }
    if is_regular_interpreted_str(t, lang) && inner.contains('\\') {
        let allow_sq = lang != LanguageId::Go;
        return match try_unescape_std_str(&inner, allow_sq) {
            Some(value) => Expr::Literal(LiteralVal::Str { value, multiline }),
            None => Expr::Raw(t.to_string()),
        };
    }
    Expr::Literal(LiteralVal::Str { value: inner, multiline })
}

fn decompile_php_str(t: &str, inner: String, multiline: bool) -> Expr {
    if t.starts_with('\'') && t.ends_with('\'') && t.len() >= 2 {
        if inner.contains('\\') || inner.contains('$') {
            return Expr::Raw(t.to_string());
        }
        return Expr::Literal(LiteralVal::Str { value: inner, multiline });
    }
    if t.starts_with('"') && t.ends_with('"') && t.len() >= 2 {
        if inner.contains('$') {
            return Expr::Raw(t.to_string());
        }
        if inner.contains('\\') {
            return match try_unescape_std_str(&inner, false) {
                Some(value) => Expr::Literal(LiteralVal::Str { value, multiline }),
                None => Expr::Raw(t.to_string()),
            };
        }
        return Expr::Literal(LiteralVal::Str { value: inner, multiline });
    }
    Expr::Raw(t.to_string())
}

fn extract_switch_arm<'a>(ch: Node<'a>, src: &'a str) -> (Vec<Pattern>, bool, Vec<Node<'a>>) {
    match ch.kind() {
        "switch_default" | "default_statement" => {
            let stmts = if ch.kind() == "switch_default" {
                let mut cur = ch.walk();
                ch.children_by_field_name("body", &mut cur).filter(|c| !is_comment_kind(c.kind())).collect()
            } else {
                named_children(ch).into_iter().filter(|c| !is_comment_kind(c.kind())).collect()
            };
            (Vec::new(), true, stmts)
        }
        "switch_case" => {
            let pats = field_text(ch, "value", src).map(|s| vec![parse_simple_pattern(s.trim())]).unwrap_or_default();
            let mut cur = ch.walk();
            (pats, false, ch.children_by_field_name("body", &mut cur).filter(|c| !is_comment_kind(c.kind())).collect())
        }
        "case_statement" => {
            let val_n = ch.child_by_field_name("value");
            let pats = val_n.map(|v| vec![parse_simple_pattern(node_text(v, src).trim())]).unwrap_or_default();
            (pats, false, named_children(ch).into_iter().filter(|c| Some(*c) != val_n && !is_comment_kind(c.kind())).collect())
        }
        "switch_section" => {
            let last_col = (0..ch.child_count()).filter_map(|i| ch.child(i))
                .filter(|c| !c.is_named() && c.kind() == ":").map(|c| c.end_byte()).max().unwrap_or(ch.start_byte());
            let (mut pats, mut is_def, mut stmts) = (Vec::new(), false, Vec::new());
            for c in (0..ch.child_count()).filter_map(|i| ch.child(i)) {
                if c.end_byte() <= last_col {
                    if !c.is_named() && c.kind() == "default" { is_def = true; }
                    else if c.is_named() && !is_comment_kind(c.kind()) && c.kind() != "when_clause" {
                        pats.push(parse_simple_pattern(node_text(c, src).trim()));
                    }
                } else if c.is_named() && !is_comment_kind(c.kind()) { stmts.push(c); }
            }
            (pats, is_def, stmts)
        }
        "switch_block_statement_group" => {
            let (mut pats, mut is_def, mut stmts) = (Vec::new(), false, Vec::new());
            for c in named_children(ch).into_iter().filter(|c| !is_comment_kind(c.kind())) {
                if c.kind() == "switch_label" {
                    if node_text(c, src).trim_start().starts_with("default") { is_def = true; }
                    else { pats.extend(named_children(c).into_iter().filter(|e| !is_comment_kind(e.kind())).map(|e| parse_simple_pattern(node_text(e, src).trim()))); }
                } else { stmts.push(c); }
            }
            (pats, is_def, stmts)
        }
        _ => (Vec::new(), false, Vec::new()),
    }
}

pub(crate) fn has_empty_switch_fallthrough(arm_nodes: &[Node<'_>], src: &str) -> bool {
    arm_nodes.iter().take(arm_nodes.len().saturating_sub(1)).any(|&ch| {
        let (pats, is_def, stmts) = extract_switch_arm(ch, src);
        stmts.is_empty() && !is_def && !pats.is_empty()
    })
}

pub(crate) fn push_grouped_switch_arms<'a>(env: &mut DecompEnv<'a>, arm_nodes: &[Node<'a>], is_expr: bool, hdr_tr: Option<String>) {
    let mut groups: Vec<(Vec<Pattern>, bool, Vec<Node<'a>>, Node<'a>)> = Vec::new();
    let (mut pending_pats, mut pending_first): (Vec<Pattern>, Option<Node<'a>>) = (Vec::new(), None);
    for &ch in arm_nodes {
        let (mut pats, is_def, stmts) = extract_switch_arm(ch, env.src);
        if stmts.is_empty() && !is_def && !pats.is_empty() {
            if pending_first.is_none() { pending_first = Some(ch); }
            pending_pats.append(&mut pats);
            continue;
        }
        let first = pending_first.take().unwrap_or(ch);
        if !pending_pats.is_empty() { let mut m = std::mem::take(&mut pending_pats); m.append(&mut pats); pats = m; }
        groups.push((pats, is_def, stmts, first));
    }
    if !pending_pats.is_empty() && let Some(first) = pending_first { groups.push((pending_pats, false, Vec::new(), first)); }
    env.tasks.push(DTask::FinishStmt(StmtFin::Match { is_expr, case_len: groups.len(), hdr_tr }));
    for (mut pats, is_def, body_nodes, first) in groups.into_iter().rev() {
        let pat = if is_def || pats.is_empty() { Pattern::Wildcard } else if pats.len() == 1 { pats.remove(0) } else { Pattern::Or(pats) };
        env.tasks.push(DTask::FinishStmt(StmtFin::MatchArm { pat, has_guard: false, trivia: collect_trivia(first, env.src, env.opts) }));
        if body_nodes.is_empty() { env.bodies.push(FnBody::Block(Vec::new())); }
        else if body_nodes.len() == 1 && matches!(body_nodes[0].kind(), "statement_block" | "block" | "compound_statement") {
            env.tasks.push(DTask::FinishFnBodyFromBlock { single_expr_collapse: false });
            env.tasks.push(DTask::Block(body_nodes[0]));
        } else {
            env.tasks.push(DTask::FinishFnBodyFromBlock { single_expr_collapse: false });
            let base = env.stmts.len();
            env.tasks.push(DTask::FinishBlock(base));
            push_stmt_nodes(env, body_nodes);
        }
    }
}
