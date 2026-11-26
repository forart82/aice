use aice_lang_registry::{IntraBlockKind, IntraBlockNode, RdNode};

use crate::intra_ast_rd_sql::push_rd_node;
use crate::r5::twig_lexer::{TwigTokKind, scan_twig_tokens};
use crate::r6::sql_lex::LineIndex;

pub(crate) fn extract_twig_blocks(
    root: &RdNode,
    src: &str,
    li: &LineIndex,
    out: &mut Vec<IntraBlockNode>,
) {
    let mut stack = vec![(root, 0usize)];
    while let Some((node, depth)) = stack.pop() {
        let lbl = node.label.as_deref().unwrap_or("");
        let kind_lbl = match node.kind.as_str() {
            "twig_if" => Some((IntraBlockKind::Branch, format_prefixed("if", lbl))),
            "twig_for" => Some((IntraBlockKind::Loop, format_prefixed("for", lbl))),
            "twig_apply" | "twig_filter" | "twig_embed" | "twig_with" | "twig_sandbox"
            | "twig_autoescape" | "twig_autostrict" | "twig_spaceless" | "twig_cache"
            | "twig_set_block" | "twig_verbatim" => {
                let tag = node.kind.strip_prefix("twig_").unwrap_or(&node.kind);
                Some((IntraBlockKind::RuleBlock, format_prefixed(tag, lbl)))
            }
            "twig_block" | "twig_macro" if depth > 1 => {
                Some((IntraBlockKind::RuleBlock, lbl.to_string()))
            }
            _ => None,
        };
        if let Some((kind, label)) = kind_lbl {
            push_rd_node(kind, label, node.start_byte, node.end_byte, src, li, out);
        }
        for c in node.children.iter().rev() {
            stack.push((c, depth + 1));
        }
    }
    extract_twig_arms(src, li, out);
}

fn extract_twig_arms(src: &str, li: &LineIndex, out: &mut Vec<IntraBlockNode>) {
    struct ArmFrame {
        start_byte: usize,
        label: String,
        is_for: bool,
        arms: Vec<(usize, usize, String)>,
    }
    let (toks, _, _) = scan_twig_tokens(src);
    let mut stack: Vec<ArmFrame> = Vec::new();
    for tok in toks {
        let TwigTokKind::Tag { keyword, rest } = tok.kind else { continue };
        match keyword.as_str() {
            "if" => stack.push(ArmFrame {
                start_byte: tok.start_byte,
                label: format_prefixed("if", &rest),
                is_for: false,
                arms: Vec::new(),
            }),
            "for" => stack.push(ArmFrame {
                start_byte: tok.start_byte,
                label: format_prefixed("for", &rest),
                is_for: true,
                arms: Vec::new(),
            }),
            "elseif" => {
                if let Some(top) = stack.last_mut()
                    && !top.is_for
                {
                    top.arms.push((top.start_byte, tok.start_byte, top.label.clone()));
                    top.start_byte = tok.start_byte;
                    top.label = format_prefixed("elseif", &rest);
                }
            }
            "else" => {
                if let Some(top) = stack.last_mut() {
                    top.arms.push((top.start_byte, tok.start_byte, top.label.clone()));
                    top.start_byte = tok.start_byte;
                    top.label = "else".to_string();
                }
            }
            "endif" | "endfor" => {
                let want_for = keyword == "endfor";
                if let Some(pos) = stack.iter().rposition(|f| f.is_for == want_for) {
                    let frame = stack.remove(pos);
                    if !frame.arms.is_empty() {
                        for (s, e, lbl) in frame.arms {
                            push_rd_node(IntraBlockKind::Branch, lbl, s, e, src, li, out);
                        }
                        push_rd_node(
                            IntraBlockKind::Branch,
                            frame.label,
                            frame.start_byte,
                            tok.end_byte,
                            src,
                            li,
                            out,
                        );
                    }
                }
            }
            _ => {}
        }
    }
}

fn format_prefixed(tag: &str, rest: &str) -> String {
    let t = rest.trim();
    if t.is_empty() { tag.to_string() } else { format!("{tag} {t}") }
}
