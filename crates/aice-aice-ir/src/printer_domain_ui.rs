use aice_lang_registry::LanguageId;

use crate::ir_code::{Expr, LiteralVal};
use crate::ir_domain::{ComponentDecl, LayoutNode, StyleDecl, StyleProp, TemplateCtrlKind};
use crate::printer::{PrintCtx, format_params};
use crate::printer_compact::{
    fmt_attr_key, fmt_attr_val, has_comment_hazard, is_clean_attr_key, is_clean_inline_text,
};
use crate::printer_decl::format_type_params;
use crate::printer_domain::format_ident_or_quoted;
use crate::printer_expr::{escape_str, print_expr};
use crate::printer_stmt::print_block_stmts;

fn fmt_ctrl_arg(kind: TemplateCtrlKind, arg: &str) -> String {
    if matches!(kind, TemplateCtrlKind::Extends | TemplateCtrlKind::Include | TemplateCtrlKind::ExprOut) {
        let clean = !arg.is_empty()
            && !arg.contains('\n')
            && !arg.contains('\r')
            && !arg.contains(':')
            && !arg.contains('=')
            && !has_comment_hazard(arg)
            && !arg.starts_with('"')
            && !arg.starts_with('\'')
            && arg.bytes().all(|b| (b.is_ascii_graphic() || b == b' ') && !matches!(b, b'"' | b'\'' | b'`' | b'\\'));
        if clean { return arg.to_string(); }
        return format!("\"{}\"", escape_str(arg));
    }
    if matches!(kind, TemplateCtrlKind::Verbatim | TemplateCtrlKind::RawTag) {
        format!("\"{}\"", escape_str(arg))
    } else {
        arg.to_string()
    }
}

pub(crate) fn print_component(c: &mut PrintCtx<'_>, comp: &ComponentDecl, d: usize) {
    c.emit_trivia(&comp.trivia, d);
    let is_markup = matches!(c.lang, LanguageId::Html | LanguageId::Twig);
    let tps = format_type_params(&comp.type_params);
    let ps = if comp.params.is_empty() { String::new() } else { format!("({})", format_params(c, &comp.params)) };
    let dt = if comp.has_doctype { " [doctype]" } else { "" };
    c.line_tr(d, &format!("{}component {}{}{}{dt}:", comp.vis.aice_prefix(), comp.name, tps, ps), &comp.trivia);
    if comp.body_stmts.is_empty() && comp.layout.is_empty() {
        c.line(d + 1, "pass");
        return;
    }
    let layout_d = if !comp.body_stmts.is_empty() {
        print_block_stmts(c, &comp.body_stmts, d + 1);
        if comp.layout.is_empty() { return; }
        c.line(d + 1, "ret:");
        d + 2
    } else {
        d + 1
    };
    enum Task<'a> {
        Node(&'a LayoutNode, usize),
        BranchHdr(&'a str, usize),
    }
    let mut tasks: Vec<Task<'_>> = comp.layout.iter().rev().map(|n| Task::Node(n, layout_d)).collect();
    while let Some(t) = tasks.pop() {
        match t {
            Task::BranchHdr(cond, bd) => {
                if cond == "else" { c.line(bd, "@else:"); }
                else { c.line(bd, &format!("@elif {cond}:")); }
            }
            Task::Node(node, nd) => match node {
                LayoutNode::Comment(txt) => {
                    if c.opts.preserve_docs { c.emit_comment_lines(nd, txt); }
                }
                LayoutNode::Element { tag, attrs, text, child_expr, children, trivia } => {
                    c.emit_trivia(trivia, nd);
                    let mut s = if is_markup { fmt_attr_key(tag) } else { format_ident_or_quoted(tag) };
                    if !attrs.is_empty() {
                        let as_: Vec<String> = attrs.iter().map(|a| {
                            if a.name == "..." && let Some(v) = &a.value {
                                return format!("...{}", print_expr(v));
                            }
                            let k = fmt_attr_key(&a.name);
                            match &a.value {
                                Some(Expr::Literal(LiteralVal::Str { value, .. })) if is_markup => {
                                    format!("{k}={}", fmt_attr_val(value))
                                }
                                Some(v) => format!("{k}: {}", print_expr(v)),
                                None => k,
                            }
                        }).collect();
                        let sep = if is_markup { " " } else { ", " };
                        s.push_str(&format!("({})", as_.join(sep)));
                    }
                    if let Some(txt) = text {
                        if is_markup && is_clean_inline_text(txt) {
                            c.line_tr(nd, &format!("{s} = {txt}"), trivia);
                        } else {
                            c.line_tr(nd, &format!("{s}: \"{}\"", escape_str(txt)), trivia);
                        }
                    } else if let Some(ex) = child_expr {
                        c.line_tr(nd, &format!("{s}: {}", print_expr(ex)), trivia);
                    } else if !children.is_empty() {
                        c.line_tr(nd, &format!("{s}:"), trivia);
                        for ch in children.iter().rev() { tasks.push(Task::Node(ch, nd + 1)); }
                    } else {
                        c.line_tr(nd, &s, trivia);
                    }
                }
                LayoutNode::TemplateCtrl { kind, arg, children, branches, trivia } => {
                    c.emit_trivia(trivia, nd);
                    let kw = match kind {
                        TemplateCtrlKind::Extends => "extends", TemplateCtrlKind::Include => "include",
                        TemplateCtrlKind::Use => "use", TemplateCtrlKind::Import => "import",
                        TemplateCtrlKind::From => "from", TemplateCtrlKind::Block => "block",
                        TemplateCtrlKind::If => "if", TemplateCtrlKind::For => "for",
                        TemplateCtrlKind::Set => "set", TemplateCtrlKind::Macro => "macro",
                        TemplateCtrlKind::Apply => "apply", TemplateCtrlKind::Filter => "filter",
                        TemplateCtrlKind::Embed => "embed", TemplateCtrlKind::Verbatim => "verbatim",
                        TemplateCtrlKind::Do => "do", TemplateCtrlKind::Flush => "flush",
                        TemplateCtrlKind::ExprOut => "out", TemplateCtrlKind::RawTag => "tag",
                    };
                    let arg_s = fmt_ctrl_arg(*kind, arg);
                    let hdr = if arg_s.is_empty() { format!("@{kw}") } else { format!("@{kw} {arg_s}") };
                    if branches.is_empty() && children.len() == 1
                        && let LayoutNode::Element { tag, attrs, text: Some(txt), children: grand, trivia: ctr, .. } = &children[0]
                        && tag == "#text" && attrs.is_empty() && grand.is_empty() && ctr.is_empty()
                    {
                        if is_clean_inline_text(txt) {
                            c.line_tr(nd, &format!("{hdr}: {txt}"), trivia);
                        } else {
                            c.line_tr(nd, &format!("{hdr}: \"{}\"", escape_str(txt)), trivia);
                        }
                    } else if children.is_empty() && branches.is_empty() {
                        c.line_tr(nd, &hdr, trivia);
                    } else {
                        c.line_tr(nd, &format!("{hdr}:"), trivia);
                        for (cond, bkids) in branches.iter().rev() {
                            for ch in bkids.iter().rev() { tasks.push(Task::Node(ch, nd + 1)); }
                            tasks.push(Task::BranchHdr(cond, nd));
                        }
                        for ch in children.iter().rev() { tasks.push(Task::Node(ch, nd + 1)); }
                    }
                }
            },
        }
    }
}

fn fmt_style_prop(p: &StyleProp, sep: &str) -> String {
    match &p.value {
        Some(v) => {
            let needs_quote = has_comment_hazard(v) || v.contains('"') || v.contains('\'') || v.contains('\n');
            if needs_quote {
                format!("{}{sep}\"{}\"", p.name, escape_str(v))
            } else {
                format!("{}{sep}{v}", p.name)
            }
        }
        None => {
            let needs_quote = p.name.contains(':')
                || p.name.contains(';')
                || p.name.contains('"')
                || p.name.contains('\n')
                || has_comment_hazard(&p.name);
            if needs_quote { format!("\"{}\"", escape_str(&p.name)) } else { p.name.clone() }
        }
    }
}

fn can_inline_style(st: &StyleDecl) -> bool {
    st.children.is_empty()
        && !st.props.is_empty()
        && st.props.len() <= 4
        && st.trivia.trailing.is_none()
        && st.props.iter().all(|p| {
            p.trivia.is_empty()
                && (p.value.is_some() || !p.name.starts_with('@'))
                && p.value.as_deref().is_none_or(|v| {
                    !v.contains(';') && !v.contains('\n') && !v.contains('"') && !v.contains('\'') && !has_comment_hazard(v)
                })
        })
}

pub(crate) fn print_style(c: &mut PrintCtx<'_>, root: &StyleDecl, init_d: usize) {
    let mut stack = vec![(root, init_d)];
    while let Some((st, d)) = stack.pop() {
        c.emit_trivia(&st.trivia, d);
        let sel = if is_clean_attr_key(&st.selector) {
            st.selector.clone()
        } else {
            format!("\"{}\"", escape_str(&st.selector))
        };
        let sep = c.colon_sep();
        if c.opts.compact && can_inline_style(st) {
            let parts: Vec<String> = st.props.iter().map(|p| fmt_style_prop(p, sep)).collect();
            c.line_tr(d, &format!("style {sel}: {}", parts.join("; ")), &st.trivia);
            continue;
        }
        c.line_tr(d, &format!("style {sel}:"), &st.trivia);
        for p in &st.props {
            c.emit_trivia(&p.trivia, d + 1);
            c.line_tr(d + 1, &fmt_style_prop(p, sep), &p.trivia);
        }
        for ch in st.children.iter().rev() { stack.push((ch, d + 1)); }
    }
}
