use std::path::Path;

use aice_aice_ir::ir::{AiceItem, AiceModule, TranspileOpts};
use aice_aice_ir::printer::print_aice_with_opts;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOutcome};
use aice_ast_engine::EngineRegistry;
use aice_lang_registry::{
    AdapterLookup, AstSlice, LanguageId, OutlineView, ParsedTree, SymbolKind, SymbolNode,
    detect_language,
};

use crate::aice_project::{ProjectWindowArgs, project_module_window};
use crate::aice_project_mid::{ends_with_unfilled_call, preserves_call_args_text};
use crate::aice_project_util::{
    balance_closers_for_lang, compute_line_starts, wrap_method_for_lang,
};
pub use crate::intra_transpile::transpile_intra_block_aice;
use crate::transpile_helpers::{
    dedent_block, extract_raw_imports_for_rn, extract_ts_reexport_outline, js_ts_const_tag,
    normalize_fragment_comments, try_clean_aice,
};

pub fn parse_for_read(
    registry: &EngineRegistry,
    path: &Path,
    src: &str,
) -> (LanguageId, Option<ParsedTree>) {
    let lang = detect_language(path, src);
    if lang == LanguageId::PlainText {
        return (lang, None);
    }
    let tree = registry.adapter(lang).and_then(|a| a.parse_cst(src).ok());
    (lang, tree)
}

pub fn transpile_full_aice(
    transpiler: &DefaultAiceTranspiler,
    tree: Option<&ParsedTree>,
    lang: LanguageId,
    src: &str,
    opts: &TranspileOpts,
) -> String {
    if lang == LanguageId::PlainText || src.is_empty() {
        return src.to_string();
    }
    if let Some(t) = tree
        && let Ok(outcome) = transpiler.to_aice(t, src, opts)
    {
        match outcome {
            TranspileOutcome::Transpiled(module) => {
                let printed = print_aice_with_opts(&module, opts);
                if !printed.trim().is_empty() {
                    return printed;
                }
            }
            TranspileOutcome::UnsupportedPassthrough { raw_text, .. } => return raw_text,
        }
    }
    normalize_fragment_comments(src)
}

pub struct SliceTranspileReq<'a> {
    pub registry: &'a EngineRegistry,
    pub transpiler: &'a DefaultAiceTranspiler,
    pub tree: Option<&'a ParsedTree>,
    pub lang: LanguageId,
    pub full_src: &'a str,
    pub slice: &'a AstSlice,
    pub sym_hint: Option<&'a str>,
    pub opts: &'a TranspileOpts,
}

pub fn transpile_slice_aice(req: &SliceTranspileReq<'_>) -> String {
    if req.lang == LanguageId::PlainText {
        return req.slice.content.clone();
    }
    if req.lang == LanguageId::Markdown {
        if let Some(adapter) = req.registry.adapter(LanguageId::Markdown)
            && let Ok(slice_tree) = adapter.parse_cst(&req.slice.content)
            && let Ok(TranspileOutcome::Transpiled(sub)) =
                req.transpiler.to_aice(&slice_tree, &req.slice.content, req.opts)
        {
            let printed = print_aice_with_opts(&sub, req.opts);
            let body = printed.strip_prefix("module markdown").unwrap_or(&printed);
            if !body.trim().is_empty() {
                return printed;
            }
        }
        return format!(
            "// aice L{}-L{}\n{}",
            req.slice.start_line,
            req.slice.end_line,
            normalize_fragment_comments(&req.slice.content)
        );
    }
    if let Some(t) = req.tree
        && let Ok(TranspileOutcome::Transpiled(module)) =
            req.transpiler.to_aice(t, req.full_src, req.opts)
    {
        let starts = compute_line_starts(req.full_src);
        let syms: Vec<SymbolNode> = req
            .registry
            .adapter(req.lang)
            .map(|a| a.extract_symbols(t, req.full_src))
            .unwrap_or_default();
        if let Some(sub) = project_module_window(&ProjectWindowArgs {
            module: &module,
            full_src: req.full_src,
            starts: &starts,
            syms: &syms,
            registry: req.registry,
            transpiler: req.transpiler,
            opts: req.opts,
            start_line: req.slice.start_line,
            end_line: req.slice.end_line,
            sym_hint: req.sym_hint,
        }) {
            let printed = print_aice_with_opts(&sub, req.opts);
            if !printed.trim().is_empty() {
                return printed;
            }
        }
    }
    let dedented = dedent_block(&req.slice.content);
    let can_balance = req.sym_hint.is_none() && !ends_with_unfilled_call(&dedented);
    let slice_src = if can_balance {
        balance_closers_for_lang(req.lang, &dedented)
    } else {
        dedented.clone()
    };
    let candidates = if req.sym_hint.is_some() {
        vec![slice_src, wrap_method_for_lang(req.lang, &dedented)]
    } else {
        vec![slice_src]
    };
    for cand in candidates {
        if let Some(printed) =
            try_clean_aice(req.lang, &cand, req.registry, req.transpiler, req.opts)
            && preserves_call_args_text(&req.slice.content, &printed)
        {
            return printed;
        }
    }
    format!(
        "// aice L{}-L{}\n{}",
        req.slice.start_line,
        req.slice.end_line,
        normalize_fragment_comments(&req.slice.content)
    )
}

pub fn render_outline_aice(outline: &OutlineView, rel_path: &str, is_auto: bool) -> String {
    render_outline_aice_with_src(outline, LanguageId::PlainText, "", rel_path, is_auto)
}

pub fn render_outline_aice_with_src(
    outline: &OutlineView,
    lang: LanguageId,
    src: &str,
    rel_path: &str,
    is_auto: bool,
) -> String {
    let mut out = String::new();
    if is_auto {
        out.push_str(&format!(
            "// Auto-outlined {rel_path} ({}L) — batch symbols: aice read {rel_path}:<Sym> or aice search <pat> {rel_path}\n",
            outline.total_lines
        ));
    }
    if outline.entries.is_empty() {
        let reexports = extract_ts_reexport_outline(lang, src);
        if !reexports.is_empty() {
            for line in reexports {
                out.push_str(&line);
                out.push('\n');
            }
            return out;
        }
        out.push_str(&format!("// (no AST symbols in {rel_path})\n"));
        return out;
    }
    let src_lines: Vec<&str> = src.lines().collect();
    for e in &outline.entries {
        let tag = if e.kind == SymbolKind::Constant {
            let line = src_lines.get(e.start_line.saturating_sub(1)).copied();
            js_ts_const_tag(lang, e.signature.as_deref(), line)
        } else {
            outline_kind_tag(e.kind)
        };
        let sig = e
            .signature
            .as_deref()
            .map(|s| s.trim().trim_end_matches('{').trim())
            .filter(|s| !s.is_empty() && *s != e.name)
            .map(|s| format!(" : {s}"))
            .unwrap_or_default();
        out.push_str(&format!(
            "{tag} {} # [L{}-L{}]{sig}\n",
            e.name, e.start_line, e.end_line
        ));
    }
    out
}

const MAX_SIBLING_HINTS: usize = 8;

pub fn render_imports_aice(
    transpiler: &DefaultAiceTranspiler,
    tree: Option<&ParsedTree>,
    lang: LanguageId,
    src: &str,
    opts: &TranspileOpts,
) -> String {
    render_imports_aice_with_raw(transpiler, tree, lang, src, opts).0
}

pub(crate) fn render_imports_aice_with_raw(
    transpiler: &DefaultAiceTranspiler,
    tree: Option<&ParsedTree>,
    lang: LanguageId,
    src: &str,
    opts: &TranspileOpts,
) -> (String, Option<String>) {
    if let Some(t) = tree
        && let Ok(TranspileOutcome::Transpiled(module)) = transpiler.to_aice(t, src, opts)
    {
        let imports: Vec<AiceItem> = module
            .items
            .into_iter()
            .filter(|it| matches!(it, AiceItem::Import(_)))
            .collect();
        if !imports.is_empty() {
            let raw = extract_raw_imports_for_rn(src, &imports);
            let mut sub = AiceModule::new(lang, lang.canonical_name());
            sub.items = imports;
            return (print_aice_with_opts(&sub, opts), raw);
        }
    }
    ("// (no imports)\n".to_string(), None)
}

pub fn sibling_hints(syms: &[SymbolNode], matched_name: &str) -> Option<String> {
    let norm = matched_name.replace('.', "::");
    let container = norm.rsplit_once("::").map(|(c, _)| c)?;
    let short = norm.rsplit("::").next().unwrap_or(&norm);
    let prefix = format!("{container}::");
    let mut siblings: Vec<&str> = Vec::new();
    let mut match_pos: Option<usize> = None;
    for s in syms {
        let sq = s.qualified_name.replace('.', "::");
        if !sq.starts_with(&prefix) {
            continue;
        }
        if s.name == short {
            if match_pos.is_none() {
                match_pos = Some(siblings.len());
            }
            continue;
        }
        let name = s.name.as_str();
        if !siblings.contains(&name) {
            siblings.push(name);
        }
    }
    if siblings.is_empty() {
        return None;
    }
    if siblings.len() <= MAX_SIBLING_HINTS {
        return Some(format!("// siblings in {container}: {}\n", siblings.join(", ")));
    }
    let anchor = match_pos.unwrap_or(0);
    let start = anchor
        .saturating_sub(MAX_SIBLING_HINTS / 2)
        .min(siblings.len() - MAX_SIBLING_HINTS);
    let shown = &siblings[start..start + MAX_SIBLING_HINTS];
    let rem = siblings.len() - MAX_SIBLING_HINTS;
    Some(format!("// siblings in {container}: {} (+{rem} more)\n", shown.join(", ")))
}

fn outline_kind_tag(kind: SymbolKind) -> &'static str {
    match kind {
        SymbolKind::Module => "mod",
        SymbolKind::Struct => "struct",
        SymbolKind::Class => "class",
        SymbolKind::Interface => "iface",
        SymbolKind::Trait => "trait",
        SymbolKind::Enum => "enum",
        SymbolKind::Function | SymbolKind::Method => "fn",
        SymbolKind::Constant => "const",
        SymbolKind::Table => "table",
        SymbolKind::View => "view",
        SymbolKind::Trigger => "trigger",
        SymbolKind::Procedure => "proc",
        SymbolKind::Query => "query",
        SymbolKind::Section => "sec",
        SymbolKind::Block => "block",
    }
}
