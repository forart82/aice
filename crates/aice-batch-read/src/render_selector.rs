use aice_aice_ir::DefaultAiceTranspiler;
use aice_aice_ir::ir::TranspileOpts;
use aice_ast_engine::EngineRegistry;
use aice_find_engine::{SymbolResolution, format_symbol_suggestions};
use aice_governance::ReadOp;
use aice_lang_registry::{
    AdapterLookup, AstSlice, LanguageId, ParsedTree, SymbolNode, SymbolSelector,
};

use crate::matcher::{ResolvedTarget, resolve_symbol_fuzzy};
use crate::regex_compile::compile_slash_regex;
use crate::search_rank::build_windows;
use crate::selector::TargetSelector;
use crate::transpile::{
    SliceTranspileReq, render_imports_aice, render_outline_aice_with_src, sibling_hints,
    transpile_full_aice, transpile_intra_block_aice, transpile_slice_aice,
};

pub struct SelectorCtx<'a> {
    pub target: &'a ResolvedTarget,
    pub src: &'a str,
    pub total_lines: usize,
    pub lang: LanguageId,
    pub tree: Option<&'a ParsedTree>,
    pub syms: &'a [SymbolNode],
    pub registry: &'a EngineRegistry,
    pub transpiler: &'a DefaultAiceTranspiler,
    pub opts: &'a TranspileOpts,
    pub op: &'a ReadOp,
}

pub fn render_selector_part(
    sel: &TargetSelector,
    ctx: &SelectorCtx<'_>,
    emitted: &mut String,
    realistic_parts: &mut Vec<String>,
) -> Result<(), String> {
    match sel {
        TargetSelector::Full => {
            emitted.push_str(&transpile_full_aice(
                ctx.transpiler,
                ctx.tree,
                ctx.lang,
                ctx.src,
                ctx.opts,
            ));
        }
        TargetSelector::Outline => {
            if let (Some(slicer), Some(t)) = (ctx.registry.slicer(ctx.lang), ctx.tree) {
                let ov = slicer.outline(
                    t,
                    ctx.src,
                    ctx.op.depth.unwrap_or(0),
                    ctx.op.include_types,
                );
                emitted.push_str(&render_outline_aice_with_src(
                    &ov,
                    ctx.lang,
                    ctx.src,
                    &ctx.target.rel_path,
                    false,
                ));
            } else {
                emitted.push_str(ctx.src);
            }
        }
        TargetSelector::Imports => {
            emitted.push_str(&render_imports_aice(
                ctx.transpiler,
                ctx.tree,
                ctx.lang,
                ctx.src,
                ctx.opts,
            ));
        }
        TargetSelector::InvertedLineRange { start, end } => {
            return Err(format!(
                "Invalid line range L{start}-L{end} for {}",
                ctx.target.rel_path
            ));
        }
        TargetSelector::LineRange { start, end } => {
            let slice = slice_lines(ctx.src, *start, *end);
            realistic_parts.push(slice.content.clone());
            emitted.push_str(&format!("// slice: L{}-L{}\n", slice.start_line, slice.end_line));
            let body = transpile_slice_aice(&SliceTranspileReq {
                registry: ctx.registry,
                transpiler: ctx.transpiler,
                tree: ctx.tree,
                lang: ctx.lang,
                full_src: ctx.src,
                slice: &slice,
                sym_hint: None,
                opts: ctx.opts,
            });
            emitted.push_str(&body);
            if !emitted.ends_with('\n') {
                emitted.push('\n');
            }
        }
        TargetSelector::Regex(raw_rx) => {
            let pat = compile_slash_regex(raw_rx)
                .map_err(|e| format!("Invalid regex {raw_rx}: {e}"))?;
            let pad = ctx.op.context_lines.unwrap_or(2);
            let matched_lines = pat.matching_lines(ctx.src);
            if matched_lines.is_empty() {
                emitted.push_str(&format!(
                    "// [no regex matches for {raw_rx} in {}]\n",
                    ctx.target.rel_path
                ));
            } else {
                let windows = build_windows(&matched_lines, ctx.total_lines.max(1), pad);
                let multi = windows.len() > 1;
                for (s_line, e_line) in windows {
                    let slice = slice_lines(ctx.src, s_line, e_line);
                    realistic_parts.push(slice.content.clone());
                    if multi {
                        emitted.push_str(&format!(
                            "// slice: L{}-L{}\n",
                            slice.start_line, slice.end_line
                        ));
                    }
                    emitted.push_str(&transpile_slice_aice(&SliceTranspileReq {
                        registry: ctx.registry,
                        transpiler: ctx.transpiler,
                        tree: ctx.tree,
                        lang: ctx.lang,
                        full_src: ctx.src,
                        slice: &slice,
                        sym_hint: None,
                        opts: ctx.opts,
                    }));
                    if !emitted.ends_with('\n') {
                        emitted.push('\n');
                    }
                }
            }
        }
        TargetSelector::Symbol(sym_sel) => {
            let Some((slicer, t)) = ctx.registry.slicer(ctx.lang).zip(ctx.tree) else {
                return Err(format!(
                    "Symbol '{}' not supported for PlainText file {}",
                    sym_sel.name, ctx.target.rel_path
                ));
            };
            match slicer.slice_symbol(t, ctx.src, sym_sel) {
                Ok(slice) => {
                    realistic_parts.push(slice.content.clone());
                    emitted.push_str(&transpile_slice_aice(&SliceTranspileReq {
                        registry: ctx.registry,
                        transpiler: ctx.transpiler,
                        tree: Some(t),
                        lang: ctx.lang,
                        full_src: ctx.src,
                        slice: &slice,
                        sym_hint: Some(&sym_sel.name),
                        opts: ctx.opts,
                    }));
                    if let Some(hint) = sibling_hints(ctx.syms, &sym_sel.name) {
                        emitted.push_str(&hint);
                    }
                }
                Err(_) => match resolve_symbol_fuzzy(ctx.registry, ctx.lang, ctx.src, &sym_sel.name) {
                    SymbolResolution::Exact(matched)
                    | SymbolResolution::AutoResolved { symbol: matched, .. } => {
                        let resolved_sel = SymbolSelector {
                            name: matched.qualified_name.clone(),
                            ordinal: sym_sel.ordinal,
                        };
                        match slicer.slice_symbol(t, ctx.src, &resolved_sel) {
                            Ok(slice) => {
                                realistic_parts.push(slice.content.clone());
                                if matched.qualified_name != sym_sel.name {
                                    emitted.push_str(&format!(
                                        "// [fuzzy-symbol '{}' -> '{}']\n",
                                        sym_sel.name, matched.qualified_name
                                    ));
                                }
                                emitted.push_str(&transpile_slice_aice(&SliceTranspileReq {
                                    registry: ctx.registry,
                                    transpiler: ctx.transpiler,
                                    tree: Some(t),
                                    lang: ctx.lang,
                                    full_src: ctx.src,
                                    slice: &slice,
                                    sym_hint: Some(&matched.qualified_name),
                                    opts: ctx.opts,
                                }));
                                if let Some(hint) = sibling_hints(ctx.syms, &matched.qualified_name) {
                                    emitted.push_str(&hint);
                                }
                            }
                            Err(e) => {
                                return Err(format!("{} in {}", e.message, ctx.target.rel_path));
                            }
                        }
                    }
                    SymbolResolution::Ambiguous(matches) => {
                        let sug = format_symbol_suggestions(&matches, false);
                        return Err(format!(
                            "Symbol '{}' not found in {} (ambiguous).{sug}",
                            sym_sel.name, ctx.target.rel_path
                        ));
                    }
                    SymbolResolution::NotFound => {
                        return Err(format!(
                            "Symbol '{}' not found in {}",
                            sym_sel.name, ctx.target.rel_path
                        ));
                    }
                },
            }
        }
        TargetSelector::IntraBlock(blk_sel) => {
            let Some((slicer, t)) = ctx.registry.slicer(ctx.lang).zip(ctx.tree) else {
                return Err(format!(
                    "Intra-block '{}' not supported in {}",
                    blk_sel.symbol, ctx.target.rel_path
                ));
            };
            match slicer.slice_intra_block(t, ctx.src, blk_sel) {
                Ok(slice) => {
                    realistic_parts.push(slice.content.clone());
                    emitted.push_str(&transpile_intra_block_aice(&SliceTranspileReq {
                        registry: ctx.registry,
                        transpiler: ctx.transpiler,
                        tree: Some(t),
                        lang: ctx.lang,
                        full_src: ctx.src,
                        slice: &slice,
                        sym_hint: Some(&blk_sel.symbol),
                        opts: ctx.opts,
                    }));
                }
                Err(e) => {
                    return Err(format!("{} in {}", e.message, ctx.target.rel_path));
                }
            }
        }
    }
    Ok(())
}

fn slice_lines(src: &str, start: usize, end: usize) -> AstSlice {
    let lines: Vec<&str> = src.lines().collect();
    if lines.is_empty() {
        return AstSlice {
            start_line: 1,
            end_line: 1,
            content: String::new(),
        };
    }
    let s = start.clamp(1, lines.len());
    let e = end.clamp(s, lines.len());
    let content = format!("{}\n", lines[(s - 1)..e].join("\n"));
    AstSlice {
        start_line: s,
        end_line: e,
        content,
    }
}
