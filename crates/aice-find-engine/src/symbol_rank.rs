use aice_lang_registry::{AdapterLookup, LanguageId, SymbolKind, SymbolNode};

use crate::fuzzy_rank::{FuzzyResolveOpts, score_candidate};

#[derive(Debug, Clone, PartialEq)]
pub struct SymbolFuzzyMatch {
    pub symbol: SymbolNode,
    pub score: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SymbolResolution {
    Exact(SymbolNode),
    AutoResolved { symbol: SymbolNode, score: f64 },
    Ambiguous(Vec<SymbolFuzzyMatch>),
    NotFound,
}

pub fn extract_symbols_via_lookup(
    lookup: &dyn AdapterLookup,
    lang: LanguageId,
    src: &str,
) -> Vec<SymbolNode> {
    let Some(adapter) = lookup.adapter(lang) else {
        return Vec::new();
    };
    let Ok(tree) = adapter.parse_cst(src) else {
        return Vec::new();
    };
    adapter.extract_symbols(&tree, src)
}

pub fn rank_ast_symbols(query: &str, symbols: &[SymbolNode]) -> Vec<SymbolFuzzyMatch> {
    let query = query.trim();
    if query.is_empty() || symbols.is_empty() {
        return Vec::new();
    }
    let q_norm = normalize_sym_scope(query);
    let query_is_qualified = q_norm.contains("::");

    let mut scored: Vec<SymbolFuzzyMatch> = symbols
        .iter()
        .map(|sym| {
            let qname_norm = normalize_sym_scope(&sym.qualified_name);
            let qname_score = score_candidate(&q_norm, &qname_norm);
            let name_weight = if query_is_qualified { 0.90 } else { 1.0 };
            let name_score = score_candidate(&q_norm, &sym.name) * name_weight;
            let score = qname_score.max(name_score);
            SymbolFuzzyMatch {
                symbol: sym.clone(),
                score,
            }
        })
        .filter(|m| m.score > 0.0)
        .collect();

    scored.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then_with(|| kind_priority(b.symbol.kind).cmp(&kind_priority(a.symbol.kind)))
            .then_with(|| {
                a.symbol
                    .qualified_name
                    .len()
                    .cmp(&b.symbol.qualified_name.len())
            })
            .then_with(|| a.symbol.start_line.cmp(&b.symbol.start_line))
            .then_with(|| a.symbol.qualified_name.cmp(&b.symbol.qualified_name))
    });
    scored
}

pub fn resolve_ast_symbols(
    query: &str,
    symbols: &[SymbolNode],
    opts: &FuzzyResolveOpts,
) -> SymbolResolution {
    let ranked = rank_ast_symbols(query, symbols);
    let Some(top) = ranked.first() else {
        return SymbolResolution::NotFound;
    };

    if top.score >= 1.0 - 1e-9 {
        let exact_case_ties: Vec<SymbolFuzzyMatch> = ranked
            .iter()
            .filter(|m| m.score >= 1.0 - 1e-9)
            .take(opts.max_suggestions)
            .cloned()
            .collect();
        if exact_case_ties.len() <= 1 {
            return SymbolResolution::Exact(top.symbol.clone());
        }
        return SymbolResolution::Ambiguous(exact_case_ties);
    }

    if top.score >= 0.98 {
        let exact_ties: Vec<SymbolFuzzyMatch> = ranked
            .iter()
            .filter(|m| m.score >= 0.98)
            .take(opts.max_suggestions)
            .cloned()
            .collect();
        if exact_ties.len() <= 1 {
            return SymbolResolution::Exact(top.symbol.clone());
        }
        return SymbolResolution::Ambiguous(exact_ties);
    }

    let second_score = ranked.get(1).map_or(0.0, |m| m.score);
    if top.score >= opts.auto_min_score
        && (ranked.len() == 1 || top.score - second_score >= opts.auto_margin)
    {
        return SymbolResolution::AutoResolved {
            symbol: top.symbol.clone(),
            score: top.score,
        };
    }

    let suggestions: Vec<SymbolFuzzyMatch> = ranked
        .into_iter()
        .filter(|m| m.score >= opts.suggest_min_score)
        .take(opts.max_suggestions)
        .collect();

    if suggestions.is_empty() {
        SymbolResolution::NotFound
    } else {
        SymbolResolution::Ambiguous(suggestions)
    }
}

pub fn resolve_symbol_via_lookup(
    lookup: &dyn AdapterLookup,
    lang: LanguageId,
    src: &str,
    query: &str,
) -> SymbolResolution {
    let symbols = extract_symbols_via_lookup(lookup, lang, src);
    resolve_ast_symbols(query, &symbols, &FuzzyResolveOpts::default())
}

pub fn format_symbol_suggestions(matches: &[SymbolFuzzyMatch], is_pattern: bool) -> String {
    if matches.is_empty() {
        return String::new();
    }
    let prefix = if is_pattern {
        "\nAvailable symbols: "
    } else {
        "\nDid you mean: "
    };
    let items: Vec<String> = matches
        .iter()
        .map(|m| {
            format!(
                "{} [L{}-L{}]",
                m.symbol.qualified_name, m.symbol.start_line, m.symbol.end_line
            )
        })
        .collect();
    format!("{prefix}{}", items.join(", "))
}

fn normalize_sym_scope(s: &str) -> String {
    s.replace('.', "::")
}

fn kind_priority(kind: SymbolKind) -> u8 {
    match kind {
        SymbolKind::Struct
        | SymbolKind::Class
        | SymbolKind::Interface
        | SymbolKind::Trait
        | SymbolKind::Enum
        | SymbolKind::Function
        | SymbolKind::Method
        | SymbolKind::Table
        | SymbolKind::View
        | SymbolKind::Procedure => 3,
        SymbolKind::Module | SymbolKind::Query | SymbolKind::Section | SymbolKind::Trigger => 2,
        SymbolKind::Constant | SymbolKind::Block => 1,
    }
}
