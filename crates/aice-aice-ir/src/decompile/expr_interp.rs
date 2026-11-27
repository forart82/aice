use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{named_children, node_text};
use crate::decompile::expr_lit::{decompile_string_lit, is_py_fstring};
use crate::decompile::iter_env::{DTask, DecompEnv};
use crate::decompile::iter_expr::ExprFin;
use crate::decompile::trivia::is_comment_kind;
use crate::ir_code::{Expr, LiteralVal};

pub(crate) fn push_string_lit_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>, raw: &str) {
    if env.lang == LanguageId::Python && node.kind() == "string" && is_py_fstring(raw) {
        push_py_fstring_task(env, node, raw);
    } else {
        env.exprs.push(decompile_string_lit(raw, env.lang));
    }
}

fn decode_simple_escape(esc: &str) -> Option<char> {
    match esc {
        "\\\\" => Some('\\'),
        "\\\"" => Some('"'),
        "\\'" => Some('\''),
        "{{" => Some('{'),
        "}}" => Some('}'),
        _ => None,
    }
}

fn decode_braces_checked(s: &str, out: &mut String) -> bool {
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'{' => {
                if b.get(i + 1) == Some(&b'{') {
                    out.push('{');
                    i += 2;
                } else {
                    return false;
                }
            }
            b'}' => {
                if b.get(i + 1) == Some(&b'}') {
                    out.push('}');
                    i += 2;
                } else {
                    return false;
                }
            }
            b'\\' => return false,
            _ => {
                let ch = s[i..].chars().next().unwrap();
                out.push(ch);
                i += ch.len_utf8();
            }
        }
    }
    true
}

pub(crate) fn push_cs_interp_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>) {
    let raw = node_text(node, env.src).trim();
    if !raw.starts_with("$\"") || !raw.ends_with('"') || raw.starts_with("$\"\"\"") {
        env.exprs.push(Expr::Raw(raw.to_string()));
        return;
    }
    let mut quasis = Vec::new();
    let mut sub_exprs = Vec::new();
    let mut cur = String::new();
    let mut c = node.walk();
    for ch in node.children(&mut c) {
        match ch.kind() {
            "interpolation_start" => {
                if !matches!(node_text(ch, env.src), "$" | "$\"") {
                    env.exprs.push(Expr::Raw(raw.to_string()));
                    return;
                }
            }
            "interpolation_quote" => {
                if node_text(ch, env.src) != "\"" {
                    env.exprs.push(Expr::Raw(raw.to_string()));
                    return;
                }
            }
            "string_content" => {
                if !decode_braces_checked(node_text(ch, env.src), &mut cur) {
                    env.exprs.push(Expr::Raw(raw.to_string()));
                    return;
                }
            }
            "escape_sequence" => {
                let Some(dc) = decode_simple_escape(node_text(ch, env.src)) else {
                    env.exprs.push(Expr::Raw(raw.to_string()));
                    return;
                };
                cur.push(dc);
            }
            "interpolation" => {
                let kids = named_children(ch);
                if kids.iter().any(|k| {
                    matches!(
                        k.kind(),
                        "interpolation_alignment_clause" | "interpolation_format_clause"
                    )
                }) {
                    env.exprs.push(Expr::Raw(raw.to_string()));
                    return;
                }
                let exprs: Vec<_> = kids
                    .into_iter()
                    .filter(|k| k.kind() != "interpolation_brace" && !is_comment_kind(k.kind()))
                    .collect();
                if exprs.len() != 1 {
                    env.exprs.push(Expr::Raw(raw.to_string()));
                    return;
                }
                quasis.push(std::mem::take(&mut cur));
                sub_exprs.push(exprs[0]);
            }
            _ if !ch.is_named() => match node_text(ch, env.src) {
                "{{" => cur.push('{'),
                "}}" => cur.push('}'),
                "$\"" | "\"" | "" => {}
                _ => {
                    env.exprs.push(Expr::Raw(raw.to_string()));
                    return;
                }
            },
            _ => {
                env.exprs.push(Expr::Raw(raw.to_string()));
                return;
            }
        }
    }
    quasis.push(cur);
    if sub_exprs.is_empty() {
        let value = quasis.pop().unwrap_or_default();
        let multiline = value.contains('\n');
        env.exprs.push(Expr::Literal(LiteralVal::Str { value, multiline }));
        return;
    }
    env.tasks.push(DTask::FinishExpr(ExprFin::Template { quasis }));
    for ex in sub_exprs.into_iter().rev() {
        env.tasks.push(DTask::Expr(ex));
    }
}

pub(crate) fn push_py_fstring_task<'a>(env: &mut DecompEnv<'a>, node: Node<'a>, raw: &str) {
    let mut quasis = Vec::new();
    let mut sub_exprs = Vec::new();
    let mut cur = String::new();
    let mut c = node.walk();
    for ch in node.children(&mut c) {
        match ch.kind() {
            "string_start" => {
                let st = node_text(ch, env.src);
                let is_f = matches!(st, "f\"" | "F\"" | "f'" | "F'");
                let is_rf = matches!(st.to_ascii_lowercase().as_str(), "rf\"" | "fr\"" | "rf'" | "fr'");
                if !(is_f || (is_rf && !raw.contains('\\'))) {
                    env.exprs.push(Expr::Raw(raw.to_string()));
                    return;
                }
            }
            "string_end" => {}
            "string_content" => {
                let mut sc = ch.walk();
                let mut pos = ch.start_byte();
                for sub in ch.children(&mut sc) {
                    let gap = env.src.get(pos..sub.start_byte()).unwrap_or("");
                    if !decode_braces_checked(gap, &mut cur) {
                        env.exprs.push(Expr::Raw(raw.to_string()));
                        return;
                    }
                    match sub.kind() {
                        "escape_interpolation" | "escape_sequence" => {
                            let Some(dc) = decode_simple_escape(node_text(sub, env.src)) else {
                                env.exprs.push(Expr::Raw(raw.to_string()));
                                return;
                            };
                            cur.push(dc);
                        }
                        _ => {
                            env.exprs.push(Expr::Raw(raw.to_string()));
                            return;
                        }
                    }
                    pos = sub.end_byte();
                }
                let tail = env.src.get(pos..ch.end_byte()).unwrap_or("");
                if !decode_braces_checked(tail, &mut cur) {
                    env.exprs.push(Expr::Raw(raw.to_string()));
                    return;
                }
            }
            "interpolation" => {
                let has_debug_eq = {
                    let mut ic = ch.walk();
                    ch.children(&mut ic).any(|k| !k.is_named() && node_text(k, env.src) == "=")
                };
                if ch.child_by_field_name("format_specifier").is_some()
                    || ch.child_by_field_name("type_conversion").is_some()
                    || has_debug_eq
                {
                    env.exprs.push(Expr::Raw(raw.to_string()));
                    return;
                }
                let Some(ex) = ch.child_by_field_name("expression") else {
                    env.exprs.push(Expr::Raw(raw.to_string()));
                    return;
                };
                let ex_txt = node_text(ex, env.src);
                if ex_txt.contains('"') || ex_txt.contains('\'') {
                    env.exprs.push(Expr::Raw(raw.to_string()));
                    return;
                }
                quasis.push(std::mem::take(&mut cur));
                sub_exprs.push(ex);
            }
            _ => {
                env.exprs.push(Expr::Raw(raw.to_string()));
                return;
            }
        }
    }
    quasis.push(cur);
    if sub_exprs.is_empty() {
        let value = quasis.pop().unwrap_or_default();
        let multiline = value.contains('\n');
        env.exprs.push(Expr::Literal(LiteralVal::Str { value, multiline }));
        return;
    }
    env.tasks.push(DTask::FinishExpr(ExprFin::Template { quasis }));
    for ex in sub_exprs.into_iter().rev() {
        env.tasks.push(DTask::Expr(ex));
    }
}
