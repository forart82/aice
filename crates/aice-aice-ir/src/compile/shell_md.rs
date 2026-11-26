use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::ir::{AiceItem, AiceModule, TranspileError};
use crate::ir_domain::{DocBlock, DocSection, ShellDecl};

pub fn compile(module: &AiceModule, target: LanguageId) -> Result<String, TranspileError> {
    if module.items.is_empty() && !module.raw_fallback.is_empty() {
        return Ok(module.raw_fallback.clone());
    }
    if target == LanguageId::Markdown {
        let mut out = String::new();
        for it in &module.items {
            if let AiceItem::Doc(sec) = it { emit_md_section(&mut out, sec); }
        }
        return Ok(out);
    }
    let mut ec = EmitCtx::new("  ");
    for it in &module.items {
        if let AiceItem::Shell(sh) = it {
            match sh {
                ShellDecl::Shebang(s) => ec.line(&format!("#!{s}")),
                ShellDecl::SetFlags(s) => ec.line(&format!("set {s}")),
                ShellDecl::Var { name, value, exported, readonly, trivia } => {
                    ec.emit_trivia(trivia, CommentStyle::Hash);
                    let pfx = if *exported { "export " } else if *readonly { "readonly " } else { "" };
                    ec.line(&format!("{pfx}{name}={value}"));
                }
                ShellDecl::Fn { name, body_lines, trivia } => {
                    ec.blank();
                    ec.emit_trivia(trivia, CommentStyle::Hash);
                    ec.line(&format!("{name}() {{"));
                    ec.push();
                    for l in body_lines { ec.line(l); }
                    ec.pop();
                    ec.line("}");
                }
                ShellDecl::Cmd { text, trivia } => {
                    ec.emit_trivia(trivia, CommentStyle::Hash);
                    ec.line(text);
                }
            }
        }
    }
    Ok(ec.out)
}

fn emit_md_section(out: &mut String, root: &DocSection) {
    let mut stack = vec![root];
    while let Some(sec) = stack.pop() {
        if sec.level > 0 && !sec.heading.is_empty() {
            if !out.is_empty() { out.push('\n'); }
            for _ in 0..sec.level { out.push('#'); }
            out.push(' ');
            out.push_str(&sec.heading);
            out.push('\n');
        }
        let mut ord_idx = 1usize;
        for b in &sec.blocks {
            match b {
                DocBlock::Frontmatter { marker, body } => {
                    out.push_str(&format!("{marker}\n{body}\n{marker}\n"));
                }
                DocBlock::Paragraph(t) => {
                    if !out.is_empty() { out.push('\n'); }
                    out.push_str(t);
                    out.push('\n');
                    ord_idx = 1;
                }
                DocBlock::Quote(t) => out.push_str(&format!("\n> {t}\n")),
                DocBlock::ThematicBreak => out.push_str("\n---\n"),
                DocBlock::ListItem { ordered, checked, text } => {
                    if let Some(chk) = checked {
                        let x = if *chk { "x" } else { " " };
                        out.push_str(&format!("- [{x}] {text}\n"));
                    } else if *ordered {
                        out.push_str(&format!("{ord_idx}. {text}\n"));
                        ord_idx += 1;
                    } else {
                        out.push_str(&format!("- {text}\n"));
                    }
                }
                DocBlock::CodeFence { lang, code } => {
                    out.push_str(&format!("\n```{lang}\n{code}\n```\n"));
                }
                DocBlock::LinkRef { label, dest } => out.push_str(&format!("[{label}]: {dest}\n")),
                DocBlock::Table { headers, rows } => {
                    out.push_str(&format!("\n| {} |\n", headers.join(" | ")));
                    let sep: Vec<&str> = headers.iter().map(|_| "---").collect();
                    out.push_str(&format!("| {} |\n", sep.join(" | ")));
                    for r in rows { out.push_str(&format!("| {} |\n", r.join(" | "))); }
                }
            }
        }
        for ch in sec.children.iter().rev() { stack.push(ch); }
    }
}
