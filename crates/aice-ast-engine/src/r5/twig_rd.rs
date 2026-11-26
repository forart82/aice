use aice_lang_registry::{DepEdge, DepKind, RdNode, SymbolKind, SymbolNode};

pub fn collect_rd_symbols(root: &RdNode, out: &mut Vec<SymbolNode>) {
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        if let Some(lbl) = &node.label {
            if let Some(name) = lbl.strip_prefix("block:") {
                out.push(SymbolNode {
                    name: name.to_string(),
                    qualified_name: lbl.clone(),
                    kind: SymbolKind::Block,
                    start_line: node.start_line,
                    end_line: node.end_line,
                    start_byte: node.start_byte,
                    end_byte: node.end_byte,
                    signature: Some(format!("block {name}")),
                });
            } else if let Some(name) = lbl.strip_prefix("macro:") {
                out.push(SymbolNode {
                    name: name.to_string(),
                    qualified_name: lbl.clone(),
                    kind: SymbolKind::Function,
                    start_line: node.start_line,
                    end_line: node.end_line,
                    start_byte: node.start_byte,
                    end_byte: node.end_byte,
                    signature: Some(format!("macro {name}")),
                });
            }
        }
        stack.extend(node.children.iter().rev());
    }
}

pub fn collect_rd_deps(root: &RdNode, out: &mut Vec<DepEdge>) {
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        if let Some(lbl) = &node.label {
            for kw in ["extends ", "include ", "use ", "import ", "from "] {
                if let Some(rest) = lbl.strip_prefix(kw)
                    && let Some(target) = extract_quoted_path(rest)
                {
                    out.push(DepEdge {
                        source: "template".to_string(),
                        target,
                        kind: DepKind::Import,
                    });
                }
            }
        }
        if node.kind == "twig_embed"
            && let Some(lbl) = &node.label
            && let Some(target) = extract_quoted_path(lbl)
        {
            out.push(DepEdge {
                source: "template".to_string(),
                target,
                kind: DepKind::Import,
            });
        }
        stack.extend(node.children.iter().rev());
    }
}

fn extract_quoted_path(s: &str) -> Option<String> {
    let q = s.find(['\'', '"'])?;
    let quote = s.as_bytes()[q] as char;
    let rest = &s[q + 1..];
    let end = rest.find(quote)?;
    Some(rest[..end].to_string())
}
