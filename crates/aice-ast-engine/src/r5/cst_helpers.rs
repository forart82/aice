use aice_lang_registry::{
    AstSlice, IntraBlockSelector, OutlineEntry, OutlineView, ParsedTree, SliceError, SymbolKind,
    SymbolNode, SymbolSelector,
};

pub fn node_text<'a>(node: tree_sitter::Node<'_>, src: &'a str) -> &'a str {
    src.get(node.byte_range()).unwrap_or("")
}

pub fn first_line_sig(node: tree_sitter::Node<'_>, src: &str) -> Option<String> {
    let text = node_text(node, src);
    let line = text.lines().next()?.trim();
    if line.is_empty() {
        None
    } else if line.len() > 120 {
        Some(line.chars().take(120).collect())
    } else {
        Some(line.to_string())
    }
}

pub fn push_sym(
    out: &mut Vec<SymbolNode>,
    name: impl Into<String>,
    qname: impl Into<String>,
    kind: SymbolKind,
    node: tree_sitter::Node<'_>,
    src: &str,
) {
    let name = name.into();
    if name.trim().is_empty() {
        return;
    }
    let start = node.start_position();
    let end = node.end_position();
    let end_row = if end.column == 0 && end.row > start.row {
        end.row - 1
    } else {
        end.row
    };
    out.push(SymbolNode {
        name,
        qualified_name: qname.into(),
        kind,
        start_line: start.row + 1,
        end_line: (end_row + 1).max(start.row + 1),
        start_byte: node.start_byte(),
        end_byte: node.end_byte(),
        signature: first_line_sig(node, src),
    });
}

pub fn qualified(scope: &[String], name: &str, sep: &str) -> String {
    if scope.is_empty() {
        name.to_string()
    } else {
        format!("{}{sep}{name}", scope.join(sep))
    }
}

pub fn field_text<'a>(node: tree_sitter::Node<'_>, field: &str, src: &'a str) -> Option<&'a str> {
    node.child_by_field_name(field)
        .map(|n| node_text(n, src).trim())
        .filter(|s| !s.is_empty())
}

pub fn child_kind_text<'a>(
    node: tree_sitter::Node<'_>,
    kind: &str,
    src: &'a str,
) -> Option<&'a str> {
    for i in 0..node.child_count() {
        if let Some(c) = node.child(i)
            && c.kind() == kind
        {
            let t = node_text(c, src).trim();
            if !t.is_empty() {
                return Some(t);
            }
        }
    }
    None
}

pub fn with_ts_root<T, F>(tree: &ParsedTree, default: T, f: F) -> T
where
    F: FnOnce(tree_sitter::Node<'_>) -> T,
{
    let ParsedTree::TreeSitter { tree, .. } = tree else {
        return default;
    };
    let Ok(guard) = tree.lock() else {
        return default;
    };
    f(guard.root_node())
}

pub fn slice_symbol_from_list(
    syms: &[SymbolNode],
    src: &str,
    sel: &SymbolSelector,
) -> Result<AstSlice, SliceError> {
    let target = sel.name.trim();
    if target.is_empty() {
        return Err(SliceError {
            message: "Empty symbol selector".to_string(),
        });
    }
    let twig_prefixed = target
        .strip_prefix("block ")
        .map(|r| format!("block:{}", r.trim()))
        .or_else(|| {
            target
                .strip_prefix("macro ")
                .map(|r| format!("macro:{}", r.trim()))
        });
    let norm_target = normalize_qname(target);
    let mut matches: Vec<&SymbolNode> = syms
        .iter()
        .filter(|s| {
            s.qualified_name == target
                || normalize_qname(&s.qualified_name) == norm_target
                || twig_prefixed.as_deref() == Some(s.qualified_name.as_str())
        })
        .collect();
    if matches.is_empty() && twig_prefixed.is_none() {
        matches = syms.iter().filter(|s| s.name == target).collect();
    }
    if matches.is_empty() {
        return Err(SliceError {
            message: format!("Symbol '{}' not found", sel.name),
        });
    }
    let ord = sel.ordinal.unwrap_or(1);
    if ord == 0 || ord > matches.len() {
        return Err(SliceError {
            message: format!(
                "Symbol '{}' ordinal {} out of range (found {})",
                sel.name,
                ord,
                matches.len()
            ),
        });
    }
    let sym = matches[ord - 1];
    let lines: Vec<&str> = src.lines().collect();
    let content = if !lines.is_empty() && sym.start_line >= 1 && sym.end_line <= lines.len() {
        lines[(sym.start_line - 1)..sym.end_line].join("\n")
    } else {
        src.get(sym.start_byte..sym.end_byte)
            .unwrap_or("")
            .to_string()
    };
    Ok(AstSlice {
        start_line: sym.start_line,
        end_line: sym.end_line,
        content,
    })
}

pub fn slice_intra_from_list(
    syms: &[SymbolNode],
    src: &str,
    sel: &IntraBlockSelector,
) -> Result<AstSlice, SliceError> {
    if sel.symbol.is_empty() || sel.pattern.is_empty() {
        return Err(SliceError {
            message: "Empty intra-block selector".to_string(),
        });
    }
    let base = slice_symbol_from_list(
        syms,
        src,
        &SymbolSelector {
            name: sel.symbol.clone(),
            ordinal: None,
        },
    )?;
    if base.content.contains(&sel.pattern) {
        Ok(base)
    } else {
        Err(SliceError {
            message: format!("Pattern '{}' not found in '{}'", sel.pattern, sel.symbol),
        })
    }
}

pub fn outline_from_symbols(
    syms: &[SymbolNode],
    src: &str,
    depth: usize,
    include_types: bool,
) -> OutlineView {
    let entries = syms
        .iter()
        .filter(|s| include_types || !is_type_kind(s.kind))
        .filter(|s| depth == 0 || symbol_depth(s, syms) <= depth)
        .map(|s| OutlineEntry {
            name: s.qualified_name.clone(),
            kind: s.kind,
            start_line: s.start_line,
            end_line: s.end_line,
            signature: s.signature.clone(),
        })
        .collect();
    OutlineView {
        entries,
        total_lines: src.lines().count(),
    }
}

fn symbol_depth(s: &SymbolNode, all: &[SymbolNode]) -> usize {
    let q_depth = if let Some(prefix) = s.qualified_name.strip_suffix(&s.name) {
        if prefix.is_empty() || matches!(prefix, "block:" | "macro:" | "@keyframes ") {
            0
        } else {
            prefix.matches("::").count() + prefix.matches('.').count()
        }
    } else {
        0
    };
    let span_depth = all
        .iter()
        .filter(|o| {
            o.start_byte <= s.start_byte
                && s.end_byte <= o.end_byte
                && (o.start_byte, o.end_byte) != (s.start_byte, s.end_byte)
        })
        .count();
    1 + q_depth.max(span_depth)
}

fn is_type_kind(kind: SymbolKind) -> bool {
    matches!(
        kind,
        SymbolKind::Struct
            | SymbolKind::Class
            | SymbolKind::Interface
            | SymbolKind::Trait
            | SymbolKind::Enum
    )
}

fn normalize_qname(s: &str) -> String {
    s.replace('.', "::")
}

pub fn visit_named_preorder<'a>(
    root: tree_sitter::Node<'a>,
    mut visit: impl FnMut(tree_sitter::Node<'a>),
) {
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        visit(node);
        for i in (0..node.named_child_count()).rev() {
            if let Some(c) = node.named_child(i as u32) {
                stack.push(c);
            }
        }
    }
}
