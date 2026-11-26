use aice_aice_ir::DefaultAiceTranspiler;
use aice_aice_ir::ir::{AiceModule, TranspileOpts};
use aice_aice_ir::printer::print_aice_with_opts;
use aice_aice_ir::{AiceTranspiler, TranspileOutcome};
use aice_ast_engine::EngineRegistry;
use aice_lang_registry::{AdapterLookup, LanguageId, ParsedTree, SymbolNode};

use crate::aice_project::{ProjectWindowArgs, project_module_window};
use crate::aice_project_util::{
    balance_closers_for_lang, compute_line_starts, normalize_comment_block, slice_lines_range,
    strip_comment_prefix,
};
use crate::search_rank::SearchHit;
use crate::transpile_helpers::dedent_block;

struct FullAiceCtx {
    module: AiceModule,
    syms: Vec<SymbolNode>,
    starts: Vec<usize>,
}

pub fn render_search_hit_aice(
    hit: &SearchHit,
    src: &str,
    registry: &EngineRegistry,
    transpiler: &DefaultAiceTranspiler,
    line_numbers: bool,
    full_mode: bool,
) -> String {
    let lines: Vec<&str> = src.lines().collect();
    let mut out = format!("{}:\n", hit.rel_path);

    if hit.lang == LanguageId::PlainText {
        for (wi, &(ws, we)) in hit.windows.iter().enumerate() {
            if wi > 0 {
                out.push_str("  ..\n");
            }
            for ln in ws..=we {
                if let Some(txt) = lines.get(ln.saturating_sub(1)) {
                    out.push_str(&format!("  L{ln}: {txt}\n"));
                }
            }
        }
        return out;
    }

    let opts = TranspileOpts::default();
    let full_ctx = parse_full_ctx(hit.lang, src, registry, transpiler, &opts);

    for (wi, &(ws, we)) in hit.windows.iter().enumerate() {
        if wi > 0 {
            out.push_str("  ..\n");
        }
        let s = ws.clamp(1, lines.len().max(1));
        let e = we.clamp(s, lines.len().max(1));

        if full_mode
            && wi == 0
            && hit.windows.len() == 1
            && s == 1
            && e == lines.len()
            && let Some(ctx) = &full_ctx
        {
            let printed = print_aice_with_opts(&ctx.module, &opts);
            if !printed.trim().is_empty() {
                push_indented_lines(&mut out, &printed);
                continue;
            }
        }

        let win_src = full_ctx
            .as_ref()
            .map(|c| slice_lines_range(src, &c.starts, s, e).to_string())
            .unwrap_or_else(|| lines[(s - 1)..e].join("\n"));

        if let Some(cmt) = normalize_comment_block(&win_src) {
            if line_numbers {
                out.push_str(&format!("  # L{s}-L{e}\n"));
            }
            push_indented_lines(&mut out, &cmt);
            continue;
        }

        if let Some(ctx) = &full_ctx
            && let Some(sub) = project_module_window(&ProjectWindowArgs {
                module: &ctx.module,
                full_src: src,
                starts: &ctx.starts,
                syms: &ctx.syms,
                registry,
                transpiler,
                opts: &opts,
                start_line: s,
                end_line: e,
                sym_hint: None,
            })
        {
            let printed = print_aice_with_opts(&sub, &opts);
            if !printed.trim().is_empty() {
                if line_numbers {
                    out.push_str(&format!("  # L{s}-L{e}\n"));
                }
                push_indented_lines(&mut out, &printed);
                continue;
            }
        }

        let dedented = dedent_block(&win_src);
        let balanced = balance_closers_for_lang(hit.lang, &dedented);
        if let Some(aice) = try_snippet_aice(hit.lang, &balanced, registry, transpiler, &opts) {
            if line_numbers {
                out.push_str(&format!("  # L{s}-L{e}\n"));
            }
            push_indented_lines(&mut out, &aice);
            continue;
        }

        for orig_ln in s..=e {
            let text = lines.get(orig_ln - 1).copied().unwrap_or("");
            let trimmed = text.trim();
            if let Some(clean) = strip_comment_prefix(trimmed) {
                let indent = &text[..text.len() - text.trim_start().len()];
                out.push_str(&format!("  L{orig_ln}: {indent}# {clean}\n"));
            } else {
                out.push_str(&format!("  L{orig_ln}: {text}\n"));
            }
        }
    }
    out
}

fn parse_full_ctx(
    lang: LanguageId,
    src: &str,
    registry: &EngineRegistry,
    transpiler: &DefaultAiceTranspiler,
    opts: &TranspileOpts,
) -> Option<FullAiceCtx> {
    let adapter = registry.adapter(lang)?;
    let tree = adapter.parse_cst(src).ok()?;
    let syms = adapter.extract_symbols(&tree, src);
    let starts = compute_line_starts(src);
    match transpiler.to_aice(&tree, src, opts).ok()? {
        TranspileOutcome::Transpiled(module) if !module.items.is_empty() => Some(FullAiceCtx {
            module,
            syms,
            starts,
        }),
        _ => None,
    }
}

fn try_snippet_aice(
    lang: LanguageId,
    snippet: &str,
    registry: &EngineRegistry,
    transpiler: &DefaultAiceTranspiler,
    opts: &TranspileOpts,
) -> Option<String> {
    let adapter = registry.adapter(lang)?;
    let tree = adapter.parse_cst(snippet).ok()?;
    let has_errors = match &tree {
        ParsedTree::TreeSitter { tree: mtx, .. } => {
            mtx.lock().ok().is_none_or(|g| g.root_node().has_error())
        }
        ParsedTree::Rd(rd) => !rd.errors.is_empty(),
        ParsedTree::PlainText { .. } => true,
    };
    if has_errors {
        return None;
    }
    match transpiler.to_aice(&tree, snippet, opts).ok()? {
        TranspileOutcome::Transpiled(module) if !module.items.is_empty() => {
            let printed = print_aice_with_opts(&module, opts);
            if printed.trim().is_empty() || printed.trim() == snippet.trim() {
                None
            } else {
                Some(printed)
            }
        }
        _ => None,
    }
}

fn push_indented_lines(out: &mut String, text: &str) {
    for line in text.lines() {
        out.push_str(&format!("  {line}\n"));
    }
}
