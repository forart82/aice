use std::path::Path;

use aice_ast_engine::intra_ast::extract_intra_blocks_in_span;
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{
    AdapterLookup, IntraBlockNode, LanguageId, SymbolKind, SymbolNode,
};

use crate::aice_lower::lower_for_splice;
use crate::ast_select::find_intra_block;
pub use crate::ast_select::{ParsedSel, parse_ast_selector, resolve_symbol_node};
use crate::hunk::{extract_hunk_blocks, has_hunk_markers};
use crate::hunk_match::{EnclosingContext, apply_hunk_blocks};
use crate::types::split_lines_keep;

pub struct AstSpliceOutcome {
    pub new_src: String,
    pub original_snippet: String,
    pub new_snippet: String,
    pub preserved_trivia: String,
    pub start_line: usize,
    pub end_line: usize,
}

fn line_start_at(src: &str, byte_pos: usize) -> usize {
    src[..byte_pos].rfind('\n').map(|p| p + 1).unwrap_or(0)
}

fn line_indent_at(src: &str, byte_pos: usize) -> &str {
    let ls = line_start_at(src, byte_pos);
    let rest = src[ls..byte_pos].trim_start_matches('\u{FEFF}');
    let ws = rest.bytes().take_while(|b| *b == b' ' || *b == b'\t').count();
    &rest[..ws]
}

fn find_leading_doc_span(src: &str, sym_start: usize, lang: LanguageId) -> Option<(usize, usize)> {
    let decl_ls = line_start_at(src, sym_start);
    if decl_ls == 0 { return None; }
    let mut cur_end = decl_ls;
    let prev = src[..cur_end].strip_suffix('\n').map(|s| s.strip_suffix('\r').unwrap_or(s)).unwrap_or(&src[..cur_end]);
    let prev_trim = prev.trim_end();
    if prev_trim.ends_with("*/")
        && let Some(open) = prev_trim.rfind("/*")
        && src[line_start_at(src, open)..open].trim_start_matches('\u{FEFF}').trim().is_empty()
    {
        return Some((line_start_at(src, open), cur_end));
    }
    let hash_doc = matches!(lang, LanguageId::Python | LanguageId::Ruby | LanguageId::Bash | LanguageId::Yaml | LanguageId::Toml | LanguageId::GraphQl);
    let mut doc_start = None;
    while cur_end > 0 {
        let before_nl = cur_end.saturating_sub(1);
        let ls = line_start_at(src, before_nl);
        let line = src[ls..cur_end].trim_start_matches('\u{FEFF}').trim();
        if line.starts_with("///") || line.starts_with("//!") || (hash_doc && line.starts_with('#')) || line.starts_with("--") {
            doc_start = Some(ls);
            cur_end = ls;
        } else {
            break;
        }
    }
    doc_start.map(|s| (s, decl_ls))
}

fn snippet_has_doc(snippet: &str) -> bool {
    let t = snippet.trim_start();
    t.starts_with("/**") || t.starts_with("///") || t.starts_with("//!")
}

fn reindent_for_inline_replace(snippet: &str, target_indent: &str, eol: &str, include_first: bool) -> String {
    let (lines, _) = split_lines_keep(snippet);
    if lines.is_empty() { return String::new(); }
    let first_ws = lines.iter().find(|l| !l.trim().is_empty()).map(|l| {
        let n = l.bytes().take_while(|b| *b == b' ' || *b == b'\t').count();
        &l[..n]
    }).unwrap_or("");
    let first_len = first_ws.len();
    lines.iter().enumerate().map(|(i, l)| {
        if l.trim().is_empty() { return String::new(); }
        let ws_len = l.bytes().take_while(|b| *b == b' ' || *b == b'\t').count();
        let stripped = &l[first_len.min(ws_len)..];
        if i == 0 && !include_first { stripped.to_string() } else { format!("{target_indent}{stripped}") }
    }).collect::<Vec<_>>().join(eol)
}

#[allow(clippy::too_many_arguments)]
pub fn apply_ast_splice(
    src: &str,
    orig_disk: Option<&str>,
    canonical_path: &Path,
    lang: LanguageId,
    eol: &str,
    selector: &str,
    payload: &str,
    delete: bool,
    preserve_docs: bool,
    force_aice_ir: bool,
) -> Result<AstSpliceOutcome, String> {
    let reg = EngineRegistry::new();
    let adapter = reg.adapter(lang).ok_or_else(|| format!("AST symbol splicing unsupported for {}", lang.canonical_name()))?;
    let tree = adapter.parse_cst(src).map_err(|e| format!("Failed to parse {}: {e}", canonical_path.display()))?;
    let syms = adapter.extract_symbols(&tree, src);
    let parsed = parse_ast_selector(selector);
    let fallback_sym: Option<SymbolNode>;
    let (sym, span_start, span_end, span_sl, span_el) = match &parsed {
        ParsedSel::Symbol { name, ordinal } => {
            let s = match resolve_symbol_node(&syms, name, *ordinal) {
                Ok(s) => s,
                Err(err) => {
                    fallback_sym = crate::ts_fallback::find_prebroken_ts_symbol(src, canonical_path, lang, name, *ordinal);
                    fallback_sym.as_ref().ok_or(err)?
                }
            };
            (s, s.start_byte, s.end_byte, s.start_line, s.end_line)
        }
        ParsedSel::IntraBlock { symbol, pattern } => {
            let s = resolve_symbol_node(&syms, symbol, None)?;
            let blocks = extract_intra_blocks_in_span(&tree, src, s.start_byte, s.end_byte);
            let strict: Vec<IntraBlockNode> = blocks.iter().filter(|b| (b.start_byte, b.end_byte) != (s.start_byte, s.end_byte)).cloned().collect();
            let cands = if strict.is_empty() { &blocks } else { &strict };
            let blk = find_intra_block(cands, src, pattern).ok_or_else(|| format!("Intra-block '{pattern}' not found inside '{symbol}'"))?;
            (s, blk.start_byte, blk.end_byte, blk.start_line, blk.end_line)
        }
    };
    let orig_snippet = src.get(span_start..span_end).unwrap_or("").to_string();
    let doc_span = if matches!(parsed, ParsedSel::Symbol { .. }) { find_leading_doc_span(src, span_start, lang) } else { None };

    if delete {
        let del_s = doc_span.map(|(ds, _)| ds).unwrap_or_else(|| line_start_at(src, span_start));
        let mut del_e = span_end;
        if src[del_e..].starts_with("\r\n") { del_e += 2; }
        else if src[del_e..].starts_with('\n') { del_e += 1; }
        let mut new_src = format!("{}{}", &src[..del_s], &src[del_e..]);
        if del_s == 0 && src.starts_with('\u{FEFF}') && !new_src.is_empty() && !new_src.starts_with('\u{FEFF}') {
            new_src.insert(0, '\u{FEFF}');
        }
        return Ok(AstSpliceOutcome { new_src, original_snippet: orig_snippet, new_snippet: String::new(), preserved_trivia: String::new(), start_line: span_sl, end_line: span_el });
    }

    if has_hunk_markers(payload) {
        let hunks = extract_hunk_blocks(payload)?;
        let scope_ls = line_start_at(src, span_start);
        let scope_src = &src[scope_ls..span_end];
        let ctx = EnclosingContext { full_before: &src[..scope_ls], full_after: &src[span_end..], orig_disk };
        let updated_scope = apply_hunk_blocks(scope_src, &hunks, canonical_path, lang, eol, span_sl, &ctx)?;
        let mut new_src = format!("{}{}{}", &src[..scope_ls], updated_scope, &src[span_end..]);
        if src.starts_with('\u{FEFF}') && !new_src.is_empty() && !new_src.starts_with('\u{FEFF}') {
            new_src.insert(0, '\u{FEFF}');
        }
        return Ok(AstSpliceOutcome { new_src, original_snippet: scope_src.to_string(), new_snippet: updated_scope, preserved_trivia: String::new(), start_line: span_sl, end_line: span_el });
    }

    let fw = DefaultSyntaxFirewall;
    let inside_class = sym.kind == SymbolKind::Method || sym.qualified_name.contains('.') || sym.qualified_name.contains("::");
    let unwrap_cls = matches!(sym.kind, SymbolKind::Method)
        || (matches!(sym.kind, SymbolKind::Function) && (sym.qualified_name.contains('.') || sym.qualified_name.contains("::")));
    let sym_indent = line_indent_at(src, span_start);
    let (new_src, (formatted, preserved)) = lower_for_splice(
        payload,
        lang,
        force_aice_ir,
        inside_class,
        unwrap_cls,
        orig_disk,
        &fw,
        canonical_path,
        |txt| {
            let replace_doc = doc_span.is_some() && (!preserve_docs || snippet_has_doc(txt));
            let (rep_start, formatted, preserved) = if replace_doc {
                let (ds, _) = doc_span.unwrap();
                (ds, reindent_for_inline_replace(txt, sym_indent, eol, true), String::new())
            } else {
                let trivia = doc_span.map(|(ds, de)| src[ds..de].to_string()).unwrap_or_default();
                (span_start, reindent_for_inline_replace(txt, sym_indent, eol, false), trivia)
            };
            let mut cand = format!("{}{}{}", &src[..rep_start], formatted, &src[span_end..]);
            if src.starts_with('\u{FEFF}') && !cand.is_empty() && !cand.starts_with('\u{FEFF}') {
                cand.insert(0, '\u{FEFF}');
            }
            (cand, (formatted, preserved))
        },
    )?;
    Ok(AstSpliceOutcome { new_src, original_snippet: orig_snippet, new_snippet: formatted, preserved_trivia: preserved, start_line: span_sl, end_line: span_el })
}

#[allow(clippy::too_many_arguments)]
pub fn apply_insert_relative(
    src: &str,
    orig_disk: Option<&str>,
    canonical_path: &Path,
    lang: LanguageId,
    eol: &str,
    anchor: &str,
    insert_after: bool,
    payload: &str,
    force_aice_ir: bool,
) -> Result<AstSpliceOutcome, String> {
    let reg = EngineRegistry::new();
    let adapter = reg.adapter(lang).ok_or_else(|| format!("AST insert unsupported for {}", lang.canonical_name()))?;
    let tree = adapter.parse_cst(src).map_err(|e| format!("Failed to parse {}: {e}", canonical_path.display()))?;
    let syms = adapter.extract_symbols(&tree, src);
    let fallback_sym;
    let sym = match resolve_symbol_node(&syms, anchor, None) {
        Ok(s) => s,
        Err(err) => {
            fallback_sym = crate::ts_fallback::find_prebroken_ts_symbol(src, canonical_path, lang, anchor, None);
            fallback_sym.as_ref().ok_or(err)?
        }
    };
    let fw = DefaultSyntaxFirewall;
    let inside_class = sym.kind == SymbolKind::Method || sym.qualified_name.contains('.') || sym.qualified_name.contains("::");
    let unwrap_cls = matches!(sym.kind, SymbolKind::Method)
        || (matches!(sym.kind, SymbolKind::Function) && (sym.qualified_name.contains('.') || sym.qualified_name.contains("::")));
    let indent = line_indent_at(src, sym.start_byte);
    let ins_pos = if insert_after {
        sym.end_byte
    } else {
        let raw_pos = find_leading_doc_span(src, sym.start_byte, lang).map(|(ds, _)| ds).unwrap_or_else(|| line_start_at(src, sym.start_byte));
        if src.starts_with('\u{FEFF}') && raw_pos < '\u{FEFF}'.len_utf8() { '\u{FEFF}'.len_utf8() } else { raw_pos }
    };
    let (new_src, formatted) = lower_for_splice(
        payload,
        lang,
        force_aice_ir,
        inside_class,
        unwrap_cls,
        orig_disk,
        &fw,
        canonical_path,
        |txt| {
            let formatted = reindent_for_inline_replace(txt, indent, eol, true);
            let cand = if insert_after {
                format!("{}{eol}{eol}{}{}", &src[..ins_pos], formatted, &src[ins_pos..])
            } else {
                format!("{}{}{eol}{eol}{}", &src[..ins_pos], formatted, &src[ins_pos..])
            };
            (cand, formatted)
        },
    )?;
    Ok(AstSpliceOutcome { new_src, original_snippet: String::new(), new_snippet: formatted, preserved_trivia: String::new(), start_line: sym.start_line, end_line: sym.end_line })
}
