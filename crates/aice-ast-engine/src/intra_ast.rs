use std::cmp::Reverse;

use aice_lang_registry::{
    AstSlice, IntraBlockKind, IntraBlockNode, IntraBlockSelector, ParsedTree, SliceError,
    SymbolNode, SymbolSelector,
};

use crate::intra_ast_match::{
    else_if_label_matches, error_handler_sub_rank, label_word_matches, pat_matches,
};
use crate::intra_ast_rd::extract_rd_intra_blocks;
use crate::intra_ast_ts::extract_ts_intra_blocks;
use crate::r5::cst_helpers::{slice_symbol_from_list, with_ts_root};

pub fn extract_intra_blocks(tree: &ParsedTree, src: &str) -> Vec<IntraBlockNode> {
    extract_blocks_opt(tree, src, None)
}

pub fn extract_intra_blocks_in_span(
    tree: &ParsedTree,
    src: &str,
    start_byte: usize,
    end_byte: usize,
) -> Vec<IntraBlockNode> {
    if end_byte <= start_byte {
        return Vec::new();
    }
    extract_blocks_opt(tree, src, Some((start_byte, end_byte)))
}

fn extract_blocks_opt(
    tree: &ParsedTree,
    src: &str,
    span: Option<(usize, usize)>,
) -> Vec<IntraBlockNode> {
    match tree {
        ParsedTree::TreeSitter { lang, .. } => with_ts_root(tree, Vec::new(), |root| {
            let mut blocks = extract_ts_intra_blocks(*lang, root, src, span);
            blocks.sort_by_key(|b| (b.start_byte, Reverse(b.end_byte), b.kind as u8));
            blocks
        }),
        ParsedTree::Rd(rd) => {
            let mut blocks = extract_rd_intra_blocks(rd, src);
            if let Some((s_b, e_b)) = span {
                blocks.retain(|b| b.start_byte >= s_b && b.end_byte <= e_b);
            }
            blocks
        }
        ParsedTree::PlainText { .. } => Vec::new(),
    }
}

pub fn slice_intra_block(
    tree: &ParsedTree,
    syms: &[SymbolNode],
    src: &str,
    sel: &IntraBlockSelector,
) -> Result<AstSlice, SliceError> {
    let sym_q = sel.symbol.trim();
    let pat = sel.pattern.trim();
    if sym_q.is_empty() || pat.is_empty() {
        return Err(SliceError {
            message: "Empty intra-block selector".to_string(),
        });
    }
    let sym = resolve_symbol(syms, sym_q).ok_or_else(|| SliceError {
        message: format!("Symbol '{}' not found", sel.symbol),
    })?;

    let all_blocks = extract_intra_blocks_in_span(tree, src, sym.start_byte, sym.end_byte);
    let strict: Vec<&IntraBlockNode> = all_blocks
        .iter()
        .filter(|b| (b.start_byte, b.end_byte) != (sym.start_byte, sym.end_byte))
        .collect();
    let candidates: Vec<&IntraBlockNode> = if strict.is_empty() {
        all_blocks.iter().collect()
    } else {
        strict
    };

    let case_sensitive = pat.chars().any(|c| c.is_ascii_uppercase());
    let mut best: Option<(u8, u8, usize, usize, &IntraBlockNode)> = None;
    for blk in &candidates {
        let label_word = label_word_matches(&blk.label, pat, case_sensitive)
            || else_if_label_matches(blk.kind, &blk.label, pat);
        let kind_alias = !label_word && kind_alias_matches(blk.kind, pat);
        let label_sub = !label_word && !kind_alias && pat_matches(&blk.label, pat, case_sensitive);
        let body = src.get(blk.start_byte..blk.end_byte).unwrap_or("");
        let body_hit =
            !label_word && !kind_alias && !label_sub && pat_matches(body, pat, case_sensitive);
        let tier = if label_word {
            0
        } else if kind_alias {
            1
        } else if label_sub {
            2
        } else if body_hit {
            3
        } else {
            continue;
        };
        let sub_rank = if tier == 1 && blk.kind == IntraBlockKind::ErrorHandler {
            error_handler_sub_rank(&blk.label)
        } else {
            0
        };
        let key = (
            tier,
            sub_rank,
            blk.end_byte.saturating_sub(blk.start_byte),
            blk.start_byte,
        );
        if best.is_none_or(|cur| key < (cur.0, cur.1, cur.2, cur.3)) {
            best = Some((key.0, key.1, key.2, key.3, *blk));
        }
    }

    if let Some((_, _, _, _, matched)) = best {
        return Ok(format_block_slice(src, sym, matched));
    }

    let sym_lines = sym.end_line.saturating_sub(sym.start_line) + 1;
    if candidates.is_empty() || sym_lines <= 8 {
        let base = slice_symbol_from_list(
            syms,
            src,
            &SymbolSelector {
                name: sel.symbol.clone(),
                ordinal: None,
            },
        )?;
        if pat_matches(&base.content, pat, case_sensitive) {
            if sym_lines <= 8 {
                return Ok(base);
            }
            return Ok(window_around_match(src, sym, pat, case_sensitive));
        }
    }

    Err(SliceError {
        message: format!("Pattern '{}' not found in '{}'", sel.pattern, sel.symbol),
    })
}

fn format_block_slice(src: &str, sym: &SymbolNode, blk: &IntraBlockNode) -> AstSlice {
    let lines: Vec<&str> = src.lines().collect();
    if lines.is_empty() {
        return AstSlice {
            start_line: blk.start_line,
            end_line: blk.end_line,
            content: src.get(blk.start_byte..blk.end_byte).unwrap_or("").to_string(),
        };
    }
    let sym_s = sym.start_line.clamp(1, lines.len());
    let sym_e = sym.end_line.clamp(sym_s, lines.len());
    let blk_s = blk.start_line.clamp(1, lines.len());
    let blk_e = blk.end_line.clamp(blk_s, lines.len());

    let mut out = Vec::new();
    if blk_s > sym_s {
        out.push(lines[sym_s - 1].to_string());
        if blk_s > sym_s + 1 {
            let from = sym_s + 1;
            let to = blk_s - 1;
            let cnt = to - from + 1;
            out.push(format!("// ... [L{from}-L{to} skipped — {cnt} unrelated lines] ..."));
        }
    }
    out.extend(lines[(blk_s - 1)..blk_e].iter().map(|s| (*s).to_string()));
    if blk_e < sym_e {
        out.push(format!("// ... [L{}-L{sym_e} skipped] ...", blk_e + 1));
    }
    AstSlice {
        start_line: sym_s.min(blk_s),
        end_line: blk_e,
        content: out.join("\n"),
    }
}

fn window_around_match(src: &str, sym: &SymbolNode, pat: &str, case_sensitive: bool) -> AstSlice {
    let lines: Vec<&str> = src.lines().collect();
    let sym_s = sym.start_line.clamp(1, lines.len().max(1));
    let sym_e = sym.end_line.clamp(sym_s, lines.len().max(1));
    let hit = (sym_s..=sym_e)
        .find(|&ln| pat_matches(lines[ln - 1], pat, case_sensitive))
        .unwrap_or(sym_s);
    let win_s = hit.saturating_sub(3).max(sym_s);
    let win_e = (hit + 3).min(sym_e);
    let mut out = Vec::new();
    if win_s > sym_s {
        out.push(lines[sym_s - 1].to_string());
        if win_s > sym_s + 1 {
            out.push(format!("// ... [L{}-L{} skipped] ...", sym_s + 1, win_s - 1));
        }
    }
    out.extend(lines[(win_s - 1)..win_e].iter().map(|s| (*s).to_string()));
    AstSlice {
        start_line: sym_s.min(win_s),
        end_line: win_e,
        content: out.join("\n"),
    }
}

fn resolve_symbol<'a>(syms: &'a [SymbolNode], target: &str) -> Option<&'a SymbolNode> {
    let twig_pref = target
        .strip_prefix("block ")
        .map(|r| format!("block:{}", r.trim()))
        .or_else(|| target.strip_prefix("macro ").map(|r| format!("macro:{}", r.trim())));
    let norm = target.replace('.', "::");
    syms.iter()
        .find(|s| {
            s.qualified_name == target
                || s.qualified_name.replace('.', "::") == norm
                || twig_pref.as_deref() == Some(s.qualified_name.as_str())
        })
        .or_else(|| {
            if twig_pref.is_none() {
                syms.iter().find(|s| s.name == target)
            } else {
                None
            }
        })
}

fn kind_alias_matches(kind: IntraBlockKind, pat: &str) -> bool {
    let low = pat.to_ascii_lowercase();
    match kind {
        IntraBlockKind::Branch => low == "branch",
        IntraBlockKind::Loop => low == "loop",
        IntraBlockKind::ErrorHandler => {
            matches!(low.as_str(), "error_handler" | "error" | "catch" | "exception")
        }
        IntraBlockKind::Closure => matches!(low.as_str(), "closure" | "lambda"),
        IntraBlockKind::Cte => low == "cte",
        IntraBlockKind::Subquery => low == "subquery",
        IntraBlockKind::RuleBlock => matches!(low.as_str(), "rule_block" | "rule"),
    }
}
