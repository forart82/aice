use aice_lang_registry::SymbolNode;

pub enum ParsedSel {
    Symbol { name: String, ordinal: Option<usize> },
    IntraBlock { symbol: String, pattern: String },
}

pub fn parse_ast_selector(raw: &str) -> ParsedSel {
    let t = raw.trim();
    if let Some((sym, pat)) = t.split_once('@')
        && !sym.is_empty()
        && !pat.is_empty()
    {
        if pat == "first" {
            return ParsedSel::Symbol { name: sym.to_string(), ordinal: Some(1) };
        }
        if pat.bytes().all(|b| b.is_ascii_digit()) {
            return ParsedSel::Symbol { name: sym.to_string(), ordinal: pat.parse().ok() };
        }
        return ParsedSel::IntraBlock { symbol: sym.to_string(), pattern: pat.to_string() };
    }
    ParsedSel::Symbol { name: t.to_string(), ordinal: None }
}

fn norm_qname(s: &str) -> String {
    s.replace("::", ".")
}

pub fn resolve_symbol_node<'a>(
    syms: &'a [SymbolNode],
    name: &str,
    ordinal: Option<usize>,
) -> Result<&'a SymbolNode, String> {
    let target = name.trim();
    let twig = target
        .strip_prefix("block ")
        .map(|r| format!("block:{}", r.trim()))
        .or_else(|| target.strip_prefix("macro ").map(|r| format!("macro:{}", r.trim())));
    let norm = norm_qname(target);
    let mut hits: Vec<&SymbolNode> = syms
        .iter()
        .filter(|s| {
            s.qualified_name == target
                || norm_qname(&s.qualified_name) == norm
                || twig.as_deref() == Some(s.qualified_name.as_str())
        })
        .collect();
    if hits.is_empty() && norm.contains('.') {
        let suffix = format!(".{norm}");
        hits = syms
            .iter()
            .filter(|s| norm_qname(&s.qualified_name).ends_with(&suffix))
            .collect();
    }
    if hits.is_empty() && twig.is_none() {
        hits = syms.iter().filter(|s| s.name == target).collect();
    }
    if hits.is_empty() {
        return Err(format!("Symbol '{target}' not found"));
    }
    let ord = ordinal.unwrap_or(1);
    if ord == 0 || ord > hits.len() {
        return Err(format!(
            "Symbol '{target}' ordinal {ord} out of range (found {})",
            hits.len()
        ));
    }
    Ok(hits[ord - 1])
}
