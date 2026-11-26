use crate::ir_domain::{DocBlock, DocSection, ShellDecl};
use crate::printer::PrintCtx;
use crate::printer_expr::escape_str;

fn render_compact_doc_blocks(out: &mut String, blocks: &[DocBlock], prev_was_para: &mut bool) {
    let mut ord_idx = 1usize;
    for b in blocks {
        match b {
            DocBlock::Frontmatter { marker, body } => {
                *prev_was_para = false;
                if !out.is_empty() { out.push('\n'); }
                out.push_str(marker);
                out.push('\n');
                if !body.is_empty() { out.push_str(body); out.push('\n'); }
                out.push_str(marker);
            }
            DocBlock::Paragraph(t) => {
                if !out.is_empty() {
                    out.push('\n');
                    if *prev_was_para { out.push('\n'); }
                }
                out.push_str(t);
                *prev_was_para = true;
                ord_idx = 1;
            }
            DocBlock::Quote(t) => {
                *prev_was_para = false;
                if !out.is_empty() { out.push('\n'); }
                out.push_str("> ");
                out.push_str(t);
                ord_idx = 1;
            }
            DocBlock::ThematicBreak => {
                *prev_was_para = false;
                if !out.is_empty() { out.push('\n'); }
                out.push_str("---");
                ord_idx = 1;
            }
            DocBlock::ListItem { ordered, checked, text } => {
                *prev_was_para = false;
                if !out.is_empty() { out.push('\n'); }
                if let Some(chk) = checked {
                    out.push_str(if *chk { "- [x] " } else { "- [ ] " });
                } else if *ordered {
                    out.push_str(&format!("{ord_idx}. "));
                    ord_idx += 1;
                } else {
                    out.push_str("- ");
                }
                out.push_str(text);
            }
            DocBlock::CodeFence { lang, code } => {
                *prev_was_para = false;
                if !out.is_empty() { out.push('\n'); }
                out.push_str("```");
                out.push_str(lang);
                out.push('\n');
                if !code.is_empty() { out.push_str(code); out.push('\n'); }
                out.push_str("```");
                ord_idx = 1;
            }
            DocBlock::LinkRef { label, dest } => {
                *prev_was_para = false;
                if !out.is_empty() { out.push('\n'); }
                out.push_str(&format!("[{label}]: {dest}"));
            }
            DocBlock::Table { headers, rows } => {
                *prev_was_para = false;
                if !out.is_empty() { out.push('\n'); }
                out.push_str(&format!("| {} |", headers.join(" | ")));
                for r in rows { out.push_str(&format!("\n| {} |", r.join(" | "))); }
                ord_idx = 1;
            }
        }
    }
}

fn render_compact_doc_body(root: &DocSection) -> String {
    let mut out = String::new();
    let mut prev_was_para = false;
    render_compact_doc_blocks(&mut out, &root.blocks, &mut prev_was_para);
    let mut stack: Vec<&DocSection> = root.children.iter().rev().collect();
    while let Some(sec) = stack.pop() {
        if !sec.heading.is_empty() {
            if !out.is_empty() { out.push('\n'); }
            let lvl = sec.level.clamp(1, 6) as usize;
            out.push_str(&"######"[..lvl]);
            out.push(' ');
            out.push_str(&sec.heading);
            prev_was_para = false;
        }
        render_compact_doc_blocks(&mut out, &sec.blocks, &mut prev_was_para);
        for ch in sec.children.iter().rev() { stack.push(ch); }
    }
    out
}

pub(crate) fn print_doc(c: &mut PrintCtx<'_>, root: &DocSection, init_d: usize) {
    c.emit_trivia(&root.trivia, init_d);
    let hdr = if root.level == 0 && root.heading.is_empty() {
        "doc:".to_string()
    } else {
        format!("doc {} \"{}\":", root.level, escape_str(&root.heading))
    };
    let body = render_compact_doc_body(root);
    if body.is_empty() {
        c.line_tr(init_d, &hdr, &root.trivia);
        return;
    }
    if root.trivia.trailing.is_none() && !body.contains("\"\"\"") {
        c.line(init_d, &format!("{hdr} \"\"\"\n{body}\n\"\"\""));
        return;
    }
    if root.trivia.trailing.is_none() && !body.contains("'''") {
        c.line(init_d, &format!("{hdr} '''\n{body}\n'''"));
        return;
    }
    c.line_tr(init_d, &hdr, &root.trivia);
    let body_d = init_d + 1;
    for line in body.split('\n') {
        if line.is_empty() { c.line(body_d, "|"); } else { c.line(body_d, &format!("| {line}")); }
    }
}

pub(crate) fn print_sh(c: &mut PrintCtx<'_>, sh: &ShellDecl, d: usize) {
    match sh {
        ShellDecl::Shebang(s) if !s.contains('\n') => c.line(d, &format!("shebang| {s}")),
        ShellDecl::Shebang(s) => c.line(d, &format!("sh shebang: \"{}\"", escape_str(s))),
        ShellDecl::SetFlags(s) if !s.contains('\n') => c.line(d, &format!("set| {s}")),
        ShellDecl::SetFlags(s) => c.line(d, &format!("sh set: \"{}\"", escape_str(s))),
        ShellDecl::Var { name, value, exported, readonly, trivia } => {
            c.emit_trivia(trivia, d);
            let ex = if *exported { "export " } else { "" };
            let ro = if *readonly { "ro " } else { "" };
            if trivia.trailing.is_none() && !value.contains('\n') {
                c.line(d, &format!("var| {ex}{ro}{name}={value}"));
            } else {
                c.line_tr(d, &format!("sh var {ex}{ro}{name} = \"{}\"", escape_str(value)), trivia);
            }
        }
        ShellDecl::Fn { name, body_lines, trivia } => {
            c.emit_trivia(trivia, d);
            let joined = body_lines.join("\n");
            if trivia.trailing.is_none() && body_lines.len() >= 2 && !joined.contains("\"\"\"") {
                c.line(d, &format!("sh fn {name}: \"\"\"\n{joined}\n\"\"\""));
                return;
            }
            c.line_tr(d, &format!("sh fn {name}:"), trivia);
            for l in body_lines {
                if !l.contains('\n') { c.line(d + 1, &format!("| {l}")); }
                else { c.line(d + 1, &format!("\"{}\"", escape_str(l))); }
            }
        }
        ShellDecl::Cmd { text, trivia } => {
            c.emit_trivia(trivia, d);
            if trivia.trailing.is_none() && !text.contains('\n') {
                c.line(d, &format!("cmd| {text}"));
            } else {
                c.line_tr(d, &format!("sh cmd: \"{}\"", escape_str(text)), trivia);
            }
        }
    }
}
