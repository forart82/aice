use crate::ir_domain::{DataDecl, DataFormatKind, DataNode, DataScalar, TokenSheetDecl};
use crate::printer::PrintCtx;
use crate::printer_compact::{
    fmt_attr_key, fmt_attr_val, fmt_data_key, fmt_data_scalar, fmt_inline_data_seq,
    is_clean_inline_text,
};
pub(crate) use crate::printer_domain_doc::{print_doc, print_sh};
use crate::printer_expr::escape_str;

pub(crate) fn print_tokens(c: &mut PrintCtx<'_>, ts: &TokenSheetDecl, d: usize) {
    c.emit_trivia(&ts.trivia, d);
    let u = ts.unit.as_ref().map(|x| format!("[{x}]")).unwrap_or_default();
    c.line_tr(d, &format!("tokens {}{u}:", ts.namespace), &ts.trivia);
    for (k, v) in &ts.entries { c.line(d + 1, &format!("{k}: {v}")); }
}

fn fmt_inline_map_entries(entries: &[DataNode], max_len: usize) -> Option<String> {
    if entries.is_empty() || entries.len() > max_len {
        return None;
    }
    let mut parts = Vec::with_capacity(entries.len());
    for en in entries {
        match en {
            DataNode::Scalar { key: Some(k), val, trivia, .. } if trivia.is_empty() => {
                if let DataScalar::Raw(r) = val
                    && (r.contains(',') || r.contains('}') || r.contains('\n'))
                {
                    return None;
                }
                parts.push(format!("{}={}", fmt_data_key(k), fmt_data_scalar(val, true)));
            }
            DataNode::Seq { key: Some(k), items, trivia } if trivia.is_empty() => {
                let seq = fmt_inline_data_seq(items)?;
                parts.push(format!("{}={seq}", fmt_data_key(k)));
            }
            _ => return None,
        }
    }
    Some(parts.join(" "))
}

pub(crate) fn print_data(c: &mut PrintCtx<'_>, dd: &DataDecl, d: usize) {
    c.emit_trivia(&dd.trivia, d);
    let fmt = match dd.format {
        DataFormatKind::Json => "json", DataFormatKind::Yaml => "yaml",
        DataFormatKind::Toml => "toml", DataFormatKind::Xml => "xml",
    };
    c.line_tr(d, &format!("data {fmt}:"), &dd.trivia);
    for pr in &dd.prolog {
        if !pr.contains('\n') { c.line(d + 1, &format!("prolog| {pr}")); }
        else { c.line(d + 1, &format!("prolog: \"{}\"", escape_str(pr))); }
    }
    enum DPrint<'a> {
        Node(&'a DataNode, usize, bool),
        InlineMapFirst(&'a DataNode, usize),
    }
    let mut stack: Vec<DPrint<'_>> = dd.root.iter().rev().map(|n| DPrint::Node(n, d + 1, false)).collect();
    while let Some(task) = stack.pop() {
        let (node, nd, inline_dash, nested_xml) = match task {
            DPrint::Node(n, dep, nxml) => (n, dep, false, nxml),
            DPrint::InlineMapFirst(n, dep) => (n, dep, true, false),
        };
        match node {
            DataNode::Scalar { key, val, trivia, .. } => {
                c.emit_trivia(trivia, nd);
                let sep = if dd.format == DataFormatKind::Yaml { "=" } else { ": " };
                let pfx = match key {
                    Some(k) if inline_dash => format!("- {}: ", fmt_data_key(k)),
                    Some(k) => format!("{}{sep}", fmt_data_key(k)),
                    None => "- ".to_string(),
                };
                c.line_tr(nd, &format!("{pfx}{}", fmt_data_scalar(val, false)), trivia);
            }
            DataNode::Seq { key, items, trivia } => {
                c.emit_trivia(trivia, nd);
                if let Some(inline) = fmt_inline_data_seq(items) {
                    let pfx = match key {
                        Some(k) if inline_dash => format!("- {}: ", fmt_data_key(k)),
                        Some(k) => format!("{}: ", fmt_data_key(k)),
                        None => "- ".to_string(),
                    };
                    c.line_tr(nd, &format!("{pfx}{inline}"), trivia);
                } else {
                    let hdr = match key {
                        Some(k) if inline_dash => format!("- {}:", fmt_data_key(k)),
                        Some(k) => format!("{}:", fmt_data_key(k)),
                        None => "-".into(),
                    };
                    c.line_tr(nd, &hdr, trivia);
                    for it in items.iter().rev() { stack.push(DPrint::Node(it, nd + 1, false)); }
                }
            }
            DataNode::Map { key, entries, trivia } => {
                c.emit_trivia(trivia, nd);
                if c.opts.compact
                    && trivia.trailing.is_none()
                    && let Some(inline) = fmt_inline_map_entries(entries, 4)
                {
                    let pfx = match key {
                        Some(k) if inline_dash => format!("- {}: ", fmt_data_key(k)),
                        Some(k) => format!("{}: ", fmt_data_key(k)),
                        None => "- ".to_string(),
                    };
                    c.line_tr(nd, &format!("{pfx}{{{inline}}}"), trivia);
                } else if key.is_none()
                    && trivia.trailing.is_none()
                    && let Some((first, rest)) = entries.split_first()
                    && matches!(first, DataNode::Scalar { key: Some(_), trivia: ft, .. } if ft.leading.is_empty())
                {
                    for en in rest.iter().rev() { stack.push(DPrint::Node(en, nd + 1, false)); }
                    stack.push(DPrint::InlineMapFirst(first, nd));
                } else {
                    let hdr = match key {
                        Some(k) if inline_dash => format!("- {}:", fmt_data_key(k)),
                        Some(k) => format!("{}:", fmt_data_key(k)),
                        None => "-".into(),
                    };
                    c.line_tr(nd, &hdr, trivia);
                    for en in entries.iter().rev() { stack.push(DPrint::Node(en, nd + 1, false)); }
                }
            }
            DataNode::TableSection { path, is_array_table, entries, trivia } => {
                c.emit_trivia(trivia, nd);
                let arr = if *is_array_table { "[]" } else { "" };
                if c.opts.compact
                    && trivia.trailing.is_none()
                    && let Some(inline) = fmt_inline_map_entries(entries, 5)
                {
                    c.line_tr(nd, &format!("section{arr} \"{}\": {inline}", escape_str(path)), trivia);
                } else {
                    c.line_tr(nd, &format!("section{arr} \"{}\":", escape_str(path)), trivia);
                    for en in entries.iter().rev() { stack.push(DPrint::Node(en, nd + 1, false)); }
                }
            }
            DataNode::XmlElem { tag, attrs, text, children, trivia } => {
                c.emit_trivia(trivia, nd);
                let mut s = if nested_xml && !matches!(tag.as_str(), "xml" | "section" | "dtd" | "prolog") {
                    fmt_attr_key(tag)
                } else {
                    format!("xml {}", fmt_attr_key(tag))
                };
                if !attrs.is_empty() {
                    let ps: Vec<String> = attrs.iter()
                        .map(|(k, v)| format!("{}={}", fmt_attr_key(k), fmt_attr_val(v)))
                        .collect();
                    s.push_str(&format!("({})", ps.join(" ")));
                }
                if let Some(t) = text {
                    if is_clean_inline_text(t) {
                        c.line_tr(nd, &format!("{s}: {t}"), trivia);
                    } else {
                        c.line_tr(nd, &format!("{s}: \"{}\"", escape_str(t)), trivia);
                    }
                } else if !children.is_empty() {
                    c.line_tr(nd, &format!("{s}:"), trivia);
                    for ch in children.iter().rev() { stack.push(DPrint::Node(ch, nd + 1, true)); }
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

pub(crate) fn format_ident_or_quoted(s: &str) -> String {
    let simple = !s.is_empty()
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
        && !s.as_bytes()[0].is_ascii_digit()
        && crate::lexer_tokens::keyword_kind(s).is_none();
    if simple { s.to_string() } else { format!("\"{}\"", escape_str(s)) }
}
