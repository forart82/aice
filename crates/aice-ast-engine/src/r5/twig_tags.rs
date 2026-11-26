use aice_lang_registry::RdNode;

use crate::r5::checks::ErrorSpan;
use crate::r5::twig_lexer::{TwigTok, err_sp};
use crate::r5::twig_tag_validators::{
    find_top_level_assign, is_valid_twig_ident, valid_for_header, validate_macro_signature,
};

pub struct BlockFrame {
    pub kind: &'static str,
    pub label: Option<String>,
    pub line: usize,
    pub start_byte: usize,
    pub saw_else: bool,
    pub children: Vec<RdNode>,
}

pub fn handle_tag(
    kw: &str,
    rest: &str,
    tok: &TwigTok,
    stack: &mut Vec<BlockFrame>,
    errors: &mut Vec<ErrorSpan>,
) {
    match kw {
        "if" | "for" | "apply" | "filter" | "embed" | "verbatim" | "spaceless" | "sandbox"
        | "autoescape" | "autostrict" | "with" | "cache" => {
            if matches!(kw, "if" | "for" | "apply" | "filter" | "embed") && rest.is_empty() {
                errors.push(err_sp(tok.line, tok.col, format!("Missing argument for {{% {kw} %}}")));
            }
            if kw == "for" && !rest.is_empty() && !valid_for_header(rest) {
                errors.push(err_sp(
                    tok.line,
                    tok.col,
                    "Malformed {% for %} tag (expected '<var> in <iterable>')",
                ));
            }
            stack.push(BlockFrame {
                kind: block_kind_for(kw),
                label: (!rest.is_empty()).then(|| rest.to_string()),
                line: tok.line,
                start_byte: tok.start_byte,
                saw_else: false,
                children: Vec::new(),
            });
        }
        "block" => {
            let mut parts = rest.split_whitespace();
            let Some(name) = parts.next() else {
                errors.push(err_sp(tok.line, tok.col, "Missing block name in {% block %}"));
                return;
            };
            if !is_valid_twig_ident(name) {
                errors.push(err_sp(
                    tok.line,
                    tok.col,
                    format!("Invalid block name '{name}' in {{% block %}}"),
                ));
            }
            if parts.next().is_some() {
                push_leaf(stack, "twig_tag", Some(format!("block:{name}")), tok);
            } else {
                stack.push(BlockFrame {
                    kind: "twig_block",
                    label: Some(format!("block:{name}")),
                    line: tok.line,
                    start_byte: tok.start_byte,
                    saw_else: false,
                    children: Vec::new(),
                });
            }
        }
        "macro" => {
            let name = match validate_macro_signature(rest) {
                Ok(n) => n,
                Err(msg) => {
                    errors.push(err_sp(tok.line, tok.col, msg));
                    rest.split('(').next().unwrap_or("").trim().to_string()
                }
            };
            stack.push(BlockFrame {
                kind: "twig_macro",
                label: Some(format!("macro:{name}")),
                line: tok.line,
                start_byte: tok.start_byte,
                saw_else: false,
                children: Vec::new(),
            });
        }
        "set" => {
            if rest.is_empty() {
                errors.push(err_sp(tok.line, tok.col, "Missing variable name in {% set %}"));
            } else if let Some(eq_idx) = find_top_level_assign(rest) {
                let lhs = rest[..eq_idx].trim();
                let rhs = rest[eq_idx + 1..].trim();
                let valid_lhs = !lhs.is_empty()
                    && lhs.split(',').all(|v| is_valid_twig_ident(v.trim()));
                if !valid_lhs || rhs.is_empty() {
                    errors.push(err_sp(tok.line, tok.col, "Malformed {% set %} assignment"));
                } else {
                    push_leaf(stack, "twig_tag", Some(format!("set {rest}")), tok);
                }
            } else if is_valid_twig_ident(rest.trim()) {
                stack.push(BlockFrame {
                    kind: "twig_set_block",
                    label: Some(format!("set:{}", rest.trim())),
                    line: tok.line,
                    start_byte: tok.start_byte,
                    saw_else: false,
                    children: Vec::new(),
                });
            } else {
                errors.push(err_sp(tok.line, tok.col, "Malformed {% set %} tag"));
            }
        }
        "elseif" => {
            if rest.is_empty() {
                errors.push(err_sp(tok.line, tok.col, "Missing condition in {% elseif %}"));
            }
            if stack.last().map(|f| f.kind != "twig_if" || f.saw_else).unwrap_or(true) {
                errors.push(err_sp(tok.line, tok.col, "Unexpected {% elseif %} outside {% if %}"));
            }
        }
        "else" => {
            if !rest.trim().is_empty() {
                errors.push(err_sp(tok.line, tok.col, "Unexpected argument in {% else %}"));
            }
            let ok = stack.last_mut().map(|f| {
                if matches!(f.kind, "twig_if" | "twig_for") && !f.saw_else {
                    f.saw_else = true;
                    true
                } else {
                    false
                }
            }).unwrap_or(false);
            if !ok {
                errors.push(err_sp(tok.line, tok.col, "Unexpected {% else %}"));
            }
        }
        end_kw if end_kw.starts_with("end") => close_block(end_kw, rest, tok, stack, errors),
        "extends" | "include" | "use" | "import" | "from" | "do" => {
            if rest.trim().is_empty() {
                errors.push(err_sp(tok.line, tok.col, format!("Missing argument for {{% {kw} %}}")));
            } else {
                push_leaf(stack, "twig_tag", Some(format!("{kw} {rest}")), tok);
            }
        }
        "flush" | "deprecated" => {
            push_leaf(stack, "twig_tag", Some(format!("{kw} {rest}")), tok);
        }
        other => errors.push(err_sp(tok.line, tok.col, format!("Unknown Twig tag '{other}'"))),
    }
}

pub fn push_leaf(stack: &mut [BlockFrame], kind: &str, label: Option<String>, tok: &TwigTok) {
    stack.last_mut().expect("root").children.push(RdNode {
        kind: kind.to_string(),
        label,
        start_line: tok.line,
        end_line: tok.line,
        start_byte: tok.start_byte,
        end_byte: tok.end_byte,
        children: Vec::new(),
    });
}

fn block_kind_for(kw: &str) -> &'static str {
    match kw {
        "if" => "twig_if",
        "for" => "twig_for",
        "apply" => "twig_apply",
        "filter" => "twig_filter",
        "embed" => "twig_embed",
        "verbatim" => "twig_verbatim",
        "spaceless" => "twig_spaceless",
        "sandbox" => "twig_sandbox",
        "autoescape" => "twig_autoescape",
        "autostrict" => "twig_autostrict",
        "with" => "twig_with",
        _ => "twig_cache",
    }
}

fn close_block(
    end_kw: &str,
    rest: &str,
    tok: &TwigTok,
    stack: &mut Vec<BlockFrame>,
    errors: &mut Vec<ErrorSpan>,
) {
    let expected = match end_kw {
        "endif" => "twig_if",
        "endfor" => "twig_for",
        "endblock" => "twig_block",
        "endmacro" => "twig_macro",
        "endset" => "twig_set_block",
        "endapply" => "twig_apply",
        "endfilter" => "twig_filter",
        "endembed" => "twig_embed",
        "endverbatim" => "twig_verbatim",
        "endspaceless" => "twig_spaceless",
        "endsandbox" => "twig_sandbox",
        "endautoescape" => "twig_autoescape",
        "endautostrict" => "twig_autostrict",
        "endwith" => "twig_with",
        "endcache" => "twig_cache",
        _ => {
            errors.push(err_sp(tok.line, tok.col, format!("Unknown Twig tag {{% {end_kw} %}}")));
            return;
        }
    };
    if stack.last().map(|f| f.kind == expected).unwrap_or(false) {
        let frame = stack.pop().expect("checked");
        let trailing = rest.trim();
        if !trailing.is_empty() {
            if matches!(end_kw, "endblock" | "endmacro") {
                if let Some(lbl) = &frame.label
                    && let Some(open_name) = lbl.split(':').nth(1)
                    && trailing != open_name
                {
                    errors.push(err_sp(
                        tok.line,
                        tok.col,
                        format!("Mismatched {{% {end_kw} {trailing} %}} (opened '{open_name}')"),
                    ));
                }
            } else {
                errors.push(err_sp(
                    tok.line,
                    tok.col,
                    format!("Unexpected argument '{trailing}' in {{% {end_kw} %}}"),
                ));
            }
        }
        let node = RdNode {
            kind: frame.kind.to_string(),
            label: frame.label,
            start_line: frame.line,
            end_line: tok.line,
            start_byte: frame.start_byte,
            end_byte: tok.end_byte,
            children: frame.children,
        };
        stack.last_mut().expect("root").children.push(node);
    } else {
        errors.push(err_sp(tok.line, tok.col, format!("Unexpected {{% {end_kw} %}}")));
    }
}
