use aice_aice_ir::DefaultAiceTranspiler;
use aice_aice_ir::ir::{AiceModule, TranspileOpts};
use aice_aice_ir::printer::print_aice_with_opts;
use aice_aice_ir::{AiceTranspiler, TranspileOutcome};
use aice_ast_engine::EngineRegistry;
use aice_lang_registry::{AdapterLookup, LanguageId, SymbolNode};

use crate::aice_project::{ProjectWindowArgs, project_module_window_opts};
use crate::aice_project_mid::{has_unclosed_paren_or_bracket, preserves_call_args_text};
use crate::aice_project_util::{
    balance_closers_for_lang, compute_line_starts, contains_ident, normalize_comment_block,
    slice_lines_range, strip_comment_prefix,
};
use crate::regex_compile::CompiledPattern;
use crate::search_aice_check::{
    collect_multiline_literal_spans, is_type_header_aice, looks_like_type_header,
    preserves_matched_lines, window_cuts_matched_multiline_literal,
};
use crate::search_rank::SearchHit;
use crate::transpile_helpers::{dedent_block, try_clean_aice};

struct FullAiceCtx {
    module: AiceModule,
    syms: Vec<SymbolNode>,
    starts: Vec<usize>,
    multiline_literals: Vec<(usize, usize)>,
}

pub fn render_search_hit_aice(
    hit: &SearchHit,
    src: &str,
    registry: &EngineRegistry,
    transpiler: &DefaultAiceTranspiler,
    line_numbers: bool,
    full_mode: bool,
) -> String {
    render_search_hit_aice_with_pattern(hit, src, registry, transpiler, line_numbers, full_mode, None)
}

pub(crate) fn render_search_hit_aice_with_pattern(
    hit: &SearchHit,
    src: &str,
    registry: &EngineRegistry,
    transpiler: &DefaultAiceTranspiler,
    _line_numbers: bool,
    full_mode: bool,
    compiled: Option<&CompiledPattern>,
) -> String {
    let lines: Vec<&str> = src.lines().collect();
    let mut out = format!("{}:\n", hit.rel_path);

    if matches!(hit.lang, LanguageId::PlainText | LanguageId::Markdown) {
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

    let opts = TranspileOpts {
        preserve_docs: false,
        ..TranspileOpts::default()
    };
    let full_ctx = parse_full_ctx(hit.lang, src, registry, transpiler, &opts);
    let mut prev_window: Option<(usize, usize)> = None;

    for (wi, &(ws, we)) in hit.windows.iter().enumerate() {
        let s = ws.clamp(1, lines.len().max(1));
        let e = we.clamp(s, lines.len().max(1));
        if let Some((ps, pe)) = prev_window
            && (ps < pe || s < e)
        {
            out.push_str("  ..\n");
        }
        prev_window = Some((s, e));

        if full_mode && wi == 0 && hit.windows.len() == 1 && s == 1 && e == lines.len()
            && let Some(ctx) = &full_ctx
        {
            let printed = clean_search_aice(&print_aice_with_opts(&ctx.module, &opts), src, false);
            if !printed.is_empty()
                && preserves_matched_lines(hit, &lines, s, e, &printed, compiled)
            {
                push_window_aice(&mut out, s, e, &printed);
                continue;
            }
        }

        let win_src = full_ctx
            .as_ref()
            .map(|c| slice_lines_range(src, &c.starts, s, e).to_string())
            .unwrap_or_else(|| lines[(s - 1)..e].join("\n"));

        let cuts_lit = full_ctx.as_ref().is_some_and(|c| {
            window_cuts_matched_multiline_literal(hit, &c.multiline_literals, s, e)
        });
        if cuts_lit {
            emit_fallback_lines(&mut out, &lines, s, e, false);
            continue;
        }

        if normalize_comment_block(&win_src).is_some() {
            emit_comment_window(&mut out, &lines, s, e);
            continue;
        }
        let raw_lines = (e - s) + 1;
        let matched_comment = s < e && window_has_matched_comment(hit, &lines, s, e);

        if !matched_comment
            && let Some(ctx) = &full_ctx
            && let Some(sub) = project_module_window_opts(
                &ProjectWindowArgs {
                    module: &ctx.module, full_src: src, starts: &ctx.starts, syms: &ctx.syms,
                    registry, transpiler, opts: &opts, start_line: s, end_line: e, sym_hint: None,
                },
                s < e,
            )
        {
            let printed = clean_search_aice(&print_aice_with_opts(&sub, &opts), &win_src, s == e);
            if is_faithful_search_aice(&win_src, &printed, s == e, raw_lines)
                && preserves_matched_lines(hit, &lines, s, e, &printed, compiled)
            {
                push_window_aice(&mut out, s, e, &printed);
                continue;
            }
        }

        let dedented = dedent_block(&win_src);
        if !matched_comment && !has_unclosed_paren_or_bracket(hit.lang, &dedented) {
            let balanced = balance_closers_for_lang(hit.lang, &dedented);
            if let Some(aice) = try_clean_aice(hit.lang, &balanced, registry, transpiler, &opts)
                && aice.trim() != balanced.trim()
            {
                let cleaned = clean_search_aice(&aice, &win_src, s == e);
                if is_faithful_search_aice(&win_src, &cleaned, s == e, raw_lines)
                    && preserves_matched_lines(hit, &lines, s, e, &cleaned, compiled)
                {
                    push_window_aice(&mut out, s, e, &cleaned);
                    continue;
                }
            }
        }

        emit_fallback_lines(&mut out, &lines, s, e, true);
    }
    out
}

fn emit_comment_window(out: &mut String, lines: &[&str], s: usize, e: usize) {
    let mut emitted = false;
    for orig_ln in s..=e {
        let text = lines.get(orig_ln - 1).copied().unwrap_or("");
        if let Some(clean) = strip_comment_prefix(text.trim())
            && !clean.is_empty()
        {
            out.push_str(&format!("  L{orig_ln}: # {clean}\n"));
            emitted = true;
        }
    }
    if !emitted {
        out.push_str(&format!("  L{s}: #\n"));
    }
}

fn emit_fallback_lines(
    out: &mut String,
    lines: &[&str],
    s: usize,
    e: usize,
    rewrite_comments: bool,
) {
    let slice = &lines[(s - 1)..e.min(lines.len())];
    let min_indent = slice
        .iter()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.bytes().take_while(|&b| b == b' ' || b == b'\t').count())
        .min()
        .unwrap_or(0);
    for (idx, &text) in slice.iter().enumerate() {
        let orig_ln = s + idx;
        let ded = if text.trim().is_empty() { "" } else { &text[min_indent.min(text.len())..] };
        if rewrite_comments && let Some(clean) = strip_comment_prefix(ded.trim()) {
            let indent = &ded[..ded.len() - ded.trim_start().len()];
            out.push_str(&format!("  L{orig_ln}: {indent}# {clean}\n"));
        } else {
            out.push_str(&format!("  L{orig_ln}: {ded}\n"));
        }
    }
}

fn clean_search_aice(printed: &str, win_src: &str, single_line: bool) -> String {
    let raw_has_pass = contains_ident(win_src, "pass", false);
    let mut lines: Vec<&str> = printed.lines().collect();
    if lines.first().is_some_and(|l| l.trim_start().starts_with("module ")) {
        lines.remove(0);
    }
    lines.retain(|l| !(l.trim() == "pass" && !raw_has_pass));
    while lines.first().is_some_and(|l| l.trim().is_empty()) {
        lines.remove(0);
    }
    while lines.last().is_some_and(|l| l.trim().is_empty()) {
        lines.pop();
    }
    if single_line
        && lines.len() == 2
        && !looks_like_type_header(win_src)
        && is_type_header_aice(lines[0])
        && lines[1].starts_with("  ")
    {
        return lines[1].trim_start().to_string();
    }
    lines.join("\n")
}

fn window_has_matched_comment(hit: &SearchHit, lines: &[&str], s: usize, e: usize) -> bool {
    hit.matched_lines.iter().copied().any(|ln| {
        ln >= s
            && ln <= e
            && lines
                .get(ln.saturating_sub(1))
                .is_some_and(|l| strip_comment_prefix(l.trim()).is_some())
    })
}

fn is_faithful_search_aice(
    win_src: &str,
    cleaned: &str,
    single_line: bool,
    raw_lines: usize,
) -> bool {
    let ct = cleaned.trim();
    if ct.is_empty() {
        return false;
    }
    if ct.starts_with("directive ") && !win_src.trim_start().starts_with("directive") {
        return false;
    }
    let line_cap = (raw_lines * 3 / 2) + 3;
    if ct.lines().count() > line_cap {
        return false;
    }
    let raw_len = win_src.trim().len();
    if ct.len() > (raw_len * 3 / 2) + 24 {
        return false;
    }
    if single_line
        && ct.lines().count() == 1
        && is_type_header_aice(ct)
        && !looks_like_type_header(win_src)
    {
        return false;
    }
    preserves_call_args_text(win_src, ct)
}

fn push_window_aice(out: &mut String, s: usize, e: usize, cleaned: &str) {
    let lines: Vec<&str> = cleaned.lines().collect();
    if lines.is_empty() {
        return;
    }
    if s == e {
        out.push_str(&format!("  L{s}: {}\n", lines[0]));
        for line in &lines[1..] {
            out.push_str(&format!("    {line}\n"));
        }
    } else if lines.len() == 1 {
        out.push_str(&format!("  L{s}-L{e}: {}\n", lines[0]));
    } else {
        out.push_str(&format!("  L{s}-L{e}:\n"));
        for line in lines {
            out.push_str(&format!("    {line}\n"));
        }
    }
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
    let multiline_literals = collect_multiline_literal_spans(&tree);
    match transpiler.to_aice(&tree, src, opts).ok()? {
        TranspileOutcome::Transpiled(module) if !module.items.is_empty() => {
            Some(FullAiceCtx { module, syms, starts, multiline_literals })
        }
        _ => None,
    }
}
