use crate::ir_domain::{ComponentDecl, LayoutNode, StyleDecl, TemplateCtrlKind};
use crate::printer::{PrintCtx, format_params};
use crate::printer_decl::format_type_params;
use crate::printer_domain::format_ident_or_quoted;
use crate::printer_expr::{escape_str, print_expr};
use crate::printer_stmt::print_block_stmts;

pub(crate) fn print_component(c: &mut PrintCtx<'_>, comp: &ComponentDecl, d: usize) {
    c.emit_trivia(&comp.trivia, d);
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
        if comp.layout.is_empty() {
            return;
        }
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
                    let mut s = format_ident_or_quoted(tag);
                    if !attrs.is_empty() {
                        let as_: Vec<String> = attrs.iter().map(|a| {
                            let k = format_ident_or_quoted(&a.name);
                            match &a.value { Some(v) => format!("{k}: {}", print_expr(v)), None => k }
                        }).collect();
                        s.push_str(&format!("({})", as_.join(", ")));
                    }
                    if let Some(txt) = text {
                        c.line_tr(nd, &format!("{s}: \"{}\"", escape_str(txt)), trivia);
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
                    let arg_s = if matches!(kind, TemplateCtrlKind::Extends | TemplateCtrlKind::Include | TemplateCtrlKind::ExprOut | TemplateCtrlKind::Verbatim | TemplateCtrlKind::RawTag) {
                        format!("\"{}\"", escape_str(arg))
                    } else { arg.clone() };
                    let hdr = if arg_s.is_empty() { format!("@{kw}") } else { format!("@{kw} {arg_s}") };
                    if children.is_empty() && branches.is_empty() {
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

pub(crate) fn print_style(c: &mut PrintCtx<'_>, root: &StyleDecl, init_d: usize) {
    let mut stack = vec![(root, init_d)];
    while let Some((st, d)) = stack.pop() {
        c.emit_trivia(&st.trivia, d);
        c.line_tr(d, &format!("style \"{}\":", escape_str(&st.selector)), &st.trivia);
        for p in &st.props {
            c.emit_trivia(&p.trivia, d + 1);
            match &p.value {
                Some(v) => {
                    let needs_quote = v.contains("//") || v.contains("/*") || v.contains("# ")
                        || v.contains("#\t") || v.contains("##") || v.contains("#!")
                        || v.ends_with('#') || v.contains('"') || v.contains('\'') || v.contains('\n');
                    if needs_quote {
                        c.line_tr(d + 1, &format!("{}: \"{}\"", p.name, escape_str(v)), &p.trivia);
                    } else {
                        c.line_tr(d + 1, &format!("{}: {v}", p.name), &p.trivia);
                    }
                }
                None => c.line_tr(d + 1, &p.name, &p.trivia),
            }
        }
        for ch in st.children.iter().rev() { stack.push((ch, d + 1)); }
    }
}
