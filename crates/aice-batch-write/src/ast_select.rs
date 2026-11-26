use aice_lang_registry::{IntraBlockKind, IntraBlockNode, SymbolNode};

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

fn word_match(hay: &str, needle: &str, case_sensitive: bool) -> bool {
    if needle.is_empty() {
        return false;
    }
    let (h, n) = if case_sensitive {
        (hay.to_string(), needle.to_string())
    } else {
        (hay.to_ascii_lowercase(), needle.to_ascii_lowercase())
    };
    let mut start = 0;
    while let Some(pos) = h[start..].find(&n) {
        let abs = start + pos;
        let end = abs + n.len();
        let ok_b = h[..abs].chars().next_back().is_none_or(|c| !c.is_alphanumeric() && c != '_');
        let ok_a = h[end..].chars().next().is_none_or(|c| !c.is_alphanumeric() && c != '_');
        if ok_b && ok_a {
            return true;
        }
        start = abs + h[abs..].chars().next().map_or(1, char::len_utf8);
    }
    false
}

fn kind_alias_matches(kind: IntraBlockKind, pat: &str) -> bool {
    let p = pat.to_ascii_lowercase();
    match kind {
        IntraBlockKind::Branch => matches!(p.as_str(), "if" | "else" | "else_if" | "switch" | "match" | "branch"),
        IntraBlockKind::Loop => matches!(p.as_str(), "for" | "while" | "loop" | "do"),
        IntraBlockKind::ErrorHandler => matches!(p.as_str(), "try" | "catch" | "except" | "finally" | "rescue" | "defer" | "error"),
        IntraBlockKind::Closure => matches!(p.as_str(), "closure" | "lambda" | "arrow" | "callback"),
        IntraBlockKind::Cte => p == "cte",
        IntraBlockKind::Subquery => p == "subquery",
        IntraBlockKind::RuleBlock => matches!(p.as_str(), "rule" | "block"),
    }
}

pub(crate) fn find_intra_block<'a>(
    blocks: &'a [IntraBlockNode],
    src: &str,
    pat: &str,
) -> Option<&'a IntraBlockNode> {
    let cs = pat.chars().any(|c| c.is_ascii_uppercase());
    let mut best: Option<(u8, usize, usize, &'a IntraBlockNode)> = None;
    for blk in blocks {
        let body = src.get(blk.start_byte..blk.end_byte).unwrap_or("");
        let tier = if word_match(&blk.label, pat, cs) {
            0
        } else if kind_alias_matches(blk.kind, pat) {
            1
        } else if (cs && blk.label.contains(pat))
            || (!cs && blk.label.to_ascii_lowercase().contains(&pat.to_ascii_lowercase()))
        {
            2
        } else if (cs && body.contains(pat))
            || (!cs && body.to_ascii_lowercase().contains(&pat.to_ascii_lowercase()))
        {
            3
        } else {
            continue;
        };
        let key = (tier, blk.end_byte.saturating_sub(blk.start_byte), blk.start_byte);
        if best.is_none_or(|b| (key.0, key.1, key.2) < (b.0, b.1, b.2)) {
            best = Some((key.0, key.1, key.2, blk));
        }
    }
    best.map(|(_, _, _, b)| b)
}
