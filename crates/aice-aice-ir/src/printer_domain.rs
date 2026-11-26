use crate::ir_domain::{DataDecl, DataFormatKind, DataNode, DataScalar, DocBlock, DocSection, ShellDecl, TokenSheetDecl};
use crate::printer::PrintCtx;
use crate::printer_expr::escape_str;

pub(crate) fn print_tokens(c: &mut PrintCtx<'_>, ts: &TokenSheetDecl, d: usize) {
    c.emit_trivia(&ts.trivia, d);
    let u = ts.unit.as_ref().map(|x| format!("[{x}]")).unwrap_or_default();
    c.line_tr(d, &format!("tokens {}{u}:", ts.namespace), &ts.trivia);
    for (k, v) in &ts.entries { c.line(d + 1, &format!("{k}: {v}")); }
}

pub(crate) fn print_data(c: &mut PrintCtx<'_>, dd: &DataDecl, d: usize) {
    c.emit_trivia(&dd.trivia, d);
    let fmt = match dd.format {
        DataFormatKind::Json => "json", DataFormatKind::Yaml => "yaml",
        DataFormatKind::Toml => "toml", DataFormatKind::Xml => "xml",
    };
    c.line_tr(d, &format!("data {fmt}:"), &dd.trivia);
    for pr in &dd.prolog { c.line(d + 1, &format!("prolog: \"{}\"", escape_str(pr))); }
    let mut stack: Vec<(&DataNode, usize)> = dd.root.iter().rev().map(|n| (n, d + 1)).collect();
    while let Some((node, nd)) = stack.pop() {
        match node {
            DataNode::Scalar { key, val, trivia, .. } => {
                c.emit_trivia(trivia, nd);
                let pfx = match key {
                    Some(k) => format!("{}: ", format_ident_or_quoted(k)),
                    None => "- ".to_string(),
                };
                let v = match val {
                    DataScalar::Str(s) => format!("\"{}\"", escape_str(s)),
                    DataScalar::Int(s) | DataScalar::Float(s) | DataScalar::Raw(s) => s.clone(),
                    DataScalar::Bool(b) => if *b { "true".into() } else { "false".into() },
                    DataScalar::Null => "nil".into(),
                };
                c.line_tr(nd, &format!("{pfx}{v}"), trivia);
            }
            DataNode::Seq { key, items, trivia } => {
                c.emit_trivia(trivia, nd);
                let hdr = match key { Some(k) => format!("{}:", format_ident_or_quoted(k)), None => "-".into() };
                c.line_tr(nd, &hdr, trivia);
                for it in items.iter().rev() { stack.push((it, nd + 1)); }
            }
            DataNode::Map { key, entries, trivia } => {
                c.emit_trivia(trivia, nd);
                let hdr = match key { Some(k) => format!("{}:", format_ident_or_quoted(k)), None => "-".into() };
                c.line_tr(nd, &hdr, trivia);
                for en in entries.iter().rev() { stack.push((en, nd + 1)); }
            }
            DataNode::TableSection { path, is_array_table, entries, trivia } => {
                c.emit_trivia(trivia, nd);
                let arr = if *is_array_table { "[]" } else { "" };
                c.line_tr(nd, &format!("section{arr} \"{}\":", escape_str(path)), trivia);
                for en in entries.iter().rev() { stack.push((en, nd + 1)); }
            }
            DataNode::XmlElem { tag, attrs, text, children, trivia } => {
                c.emit_trivia(trivia, nd);
                let mut s = format!("xml {}", format_ident_or_quoted(tag));
                if !attrs.is_empty() {
                    let ps: Vec<String> = attrs.iter().map(|(k, v)| format!("{}: \"{}\"", format_ident_or_quoted(k), escape_str(v))).collect();
                    s.push_str(&format!("({})", ps.join(", ")));
                }
                if let Some(t) = text {
                    c.line_tr(nd, &format!("{s}: \"{}\"", escape_str(t)), trivia);
                } else if !children.is_empty() {
                    c.line_tr(nd, &format!("{s}:"), trivia);
                    for ch in children.iter().rev() { stack.push((ch, nd + 1)); }
                } else {
                    c.line_tr(nd, &s, trivia);
                }
            }
            DataNode::DtdDecl { kind, name, spec, trivia } => {
                c.emit_trivia(trivia, nd);
                c.line_tr(nd, &format!("dtd {kind} {name}: \"{}\"", escape_str(spec)), trivia);
            }
        }
    }
}

pub(crate) fn print_doc(c: &mut PrintCtx<'_>, root: &DocSection, init_d: usize) {
    let mut stack = vec![(root, init_d)];
    while let Some((doc, d)) = stack.pop() {
        c.emit_trivia(&doc.trivia, d);
        c.line_tr(d, &format!("doc {} \"{}\":", doc.level, escape_str(&doc.heading)), &doc.trivia);
        for b in &doc.blocks {
            match b {
                DocBlock::Paragraph(t) => c.line(d + 1, &format!("p: \"{}\"", escape_str(t))),
                DocBlock::Quote(t) => c.line(d + 1, &format!("quote: \"{}\"", escape_str(t))),
                DocBlock::ThematicBreak => c.line(d + 1, "hr"),
                DocBlock::ListItem { ordered, checked, text } => {
                    if let Some(chk) = checked {
                        let x = if *chk { "x" } else { " " };
                        c.line(d + 1, &format!("todo [{x}]: \"{}\"", escape_str(text)));
                    } else {
                        let kw = if *ordered { "ol" } else { "li" };
                        c.line(d + 1, &format!("{kw}: \"{}\"", escape_str(text)));
                    }
                }
                DocBlock::CodeFence { lang, code } => c.line(d + 1, &format!("code \"{}\": \"{}\"", escape_str(lang), escape_str(code))),
                DocBlock::Frontmatter { marker, body } => c.line(d + 1, &format!("fm \"{}\": \"{}\"", escape_str(marker), escape_str(body))),
                DocBlock::LinkRef { label, dest } => c.line(d + 1, &format!("ref \"{}\": \"{}\"", escape_str(label), escape_str(dest))),
                DocBlock::Table { headers, rows } => {
                    c.line(d + 1, "table:");
                    let hs: Vec<String> = headers.iter().map(|h| format!("\"{}\"", escape_str(h))).collect();
                    c.line(d + 2, &format!("th: {}", hs.join(", ")));
                    for r in rows {
                        let rs: Vec<String> = r.iter().map(|x| format!("\"{}\"", escape_str(x))).collect();
                        c.line(d + 2, &format!("tr: {}", rs.join(", ")));
                    }
                }
            }
        }
        for ch in doc.children.iter().rev() { stack.push((ch, d + 1)); }
    }
}

pub(crate) fn print_sh(c: &mut PrintCtx<'_>, sh: &ShellDecl, d: usize) {
    match sh {
        ShellDecl::Shebang(s) => c.line(d, &format!("sh shebang: \"{}\"", escape_str(s))),
        ShellDecl::SetFlags(s) => c.line(d, &format!("sh set: \"{}\"", escape_str(s))),
        ShellDecl::Var { name, value, exported, readonly, trivia } => {
            c.emit_trivia(trivia, d);
            let ex = if *exported { "export " } else { "" };
            let ro = if *readonly { "ro " } else { "" };
            c.line_tr(d, &format!("sh var {ex}{ro}{name} = \"{}\"", escape_str(value)), trivia);
        }
        ShellDecl::Fn { name, body_lines, trivia } => {
            c.emit_trivia(trivia, d);
            c.line_tr(d, &format!("sh fn {name}:"), trivia);
            for l in body_lines { c.line(d + 1, &format!("\"{}\"", escape_str(l))); }
        }
        ShellDecl::Cmd { text, trivia } => {
            c.emit_trivia(trivia, d);
            c.line_tr(d, &format!("sh cmd: \"{}\"", escape_str(text)), trivia);
        }
    }
}

pub(crate) fn format_ident_or_quoted(s: &str) -> String {
    let simple = !s.is_empty()
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
        && !s.as_bytes()[0].is_ascii_digit()
        && crate::lexer_tokens::keyword_kind(s).is_none();
    if simple { s.to_string() } else { format!("\"{}\"", escape_str(s)) }
}
