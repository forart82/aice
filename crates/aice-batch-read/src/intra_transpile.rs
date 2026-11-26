use aice_aice_ir::ir::{AiceItem, AiceModule, TranspileOpts};
use aice_aice_ir::ir_code::{ClassDecl, FnBody, FnDecl, MethodDecl};
use aice_aice_ir::printer::print_aice_with_opts;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOutcome};
use aice_ast_engine::EngineRegistry;
use aice_lang_registry::{AdapterLookup, LanguageId, SymbolSelector};

use crate::aice_project::{ProjectWindowArgs, project_module_window};
use crate::aice_project_util::{
    balance_closers_for_lang, compute_line_starts, wrap_method_for_lang,
};
use crate::intra_wrap::{
    strip_dummy_ast_trivia_and_body, strip_printed_dummy_prefix, wrap_intra_block_for_lang,
};
use crate::transpile::{SliceTranspileReq, transpile_slice_aice};
use crate::transpile_helpers::{
    dedent_block, is_imperative_lang, normalize_fragment_comments, parse_clean_module,
    try_clean_aice,
};

pub fn transpile_intra_block_aice(req: &SliceTranspileReq<'_>) -> String {
    if req.lang == LanguageId::PlainText {
        return req.slice.content.clone();
    }
    if !req.slice.content.contains("// ... [L") {
        return transpile_slice_aice(req);
    }

    let mut chunks: Vec<String> = Vec::new();
    let mut markers: Vec<String> = Vec::new();
    let mut cur = String::new();
    for line in req.slice.content.lines() {
        if line.trim_start().starts_with("// ... [L") {
            chunks.push(std::mem::take(&mut cur));
            markers.push(line.to_string());
        } else {
            cur.push_str(line);
            cur.push('\n');
        }
    }

    if markers.is_empty() {
        return transpile_slice_aice(req);
    }
    if markers.len() == 1 && cur.trim().is_empty() {
        let combined = chunks.into_iter().next().unwrap_or_default();
        let mut out = transpile_combined_head_block(req, &combined);
        if !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(&markers[0]);
        out.push('\n');
        return out;
    }

    let header_chunk = chunks.first().map(String::as_str).unwrap_or("");
    let skip_1 = &markers[0];
    let block_chunk = if markers.len() >= 2 {
        chunks.get(1).map(String::as_str).unwrap_or("")
    } else {
        cur.as_str()
    };
    let skip_2 = markers.get(1).map(String::as_str);
    let block_start = parse_skip_end_line(skip_1)
        .map(|n| n + 1)
        .unwrap_or(req.slice.start_line);

    let header_aice = render_intra_header_aice(req, header_chunk);
    let block_aice = render_intra_block_body_aice(req, block_chunk, block_start);

    let mut out = String::new();
    out.push_str(header_aice.trim_end_matches('\n'));
    out.push('\n');
    out.push_str(skip_1);
    out.push('\n');
    out.push_str(block_aice.trim_end_matches('\n'));
    out.push('\n');
    if let Some(s2) = skip_2 {
        out.push_str(s2);
        out.push('\n');
    }
    out
}

fn transpile_combined_head_block(req: &SliceTranspileReq<'_>, combined: &str) -> String {
    let ded = dedent_block(combined);
    let bal = balance_closers_for_lang(req.lang, &ded);
    if let Some(printed) = try_clean_aice(req.lang, &bal, req.registry, req.transpiler, req.opts) {
        return printed;
    }
    if is_imperative_lang(req.lang) {
        let wrapped = wrap_method_for_lang(req.lang, &bal);
        if wrapped != bal
            && let Some(mut m) = parse_clean_module(req.lang, &wrapped, req.registry, req.transpiler, req.opts)
        {
            rename_wrapper_class(&mut m, req.sym_hint);
            let printed = print_aice_with_opts(&m, req.opts);
            if !printed.trim().is_empty() {
                return printed;
            }
        }
    }
    format!("module {}\n{}", req.lang.canonical_name(), normalize_fragment_comments(combined))
}

fn render_intra_header_aice(req: &SliceTranspileReq<'_>, header_chunk: &str) -> String {
    let short_hint = req.sym_hint.map(|s| s.rsplit(['.', ':']).next().unwrap_or(s));
    if let Some(t) = req.tree
        && let Ok(TranspileOutcome::Transpiled(module)) = req.transpiler.to_aice(t, req.full_src, req.opts)
        && let Some(sig_mod) = extract_sig_only_module(&module, short_hint, req.slice.start_line)
    {
        let printed = print_aice_with_opts(&sig_mod, req.opts);
        if !printed.trim().is_empty() {
            return printed;
        }
    }
    if let Some(sym_name) = req.sym_hint
        && let (Some(slicer), Some(t)) = (req.registry.slicer(req.lang), req.tree)
        && let Ok(sym_slice) = slicer.slice_symbol(t, req.full_src, &SymbolSelector { name: sym_name.to_string(), ordinal: None })
    {
        let ded = dedent_block(&sym_slice.content);
        if let Some(sub_mod) = parse_clean_module(req.lang, &ded, req.registry, req.transpiler, req.opts)
            && let Some(sig_mod) = extract_sig_only_module(&sub_mod, short_hint, 1)
        {
            let printed = print_aice_with_opts(&sig_mod, req.opts);
            if !printed.trim().is_empty() {
                return printed;
            }
        }
    }
    format!("module {}\n{}", req.lang.canonical_name(), normalize_fragment_comments(header_chunk))
}

fn extract_sig_only_module(module: &AiceModule, short_hint: Option<&str>, start_line: usize) -> Option<AiceModule> {
    let mut sub = AiceModule::new(module.source_lang, module.module_name.clone());
    for item in &module.items {
        match item {
            AiceItem::Fn(fd) if short_hint.map_or(fd.span.line == start_line, |h| fd.name == h) => {
                sub.items.push(AiceItem::Fn(FnDecl {
                    vis: fd.vis, is_async: fd.is_async, is_static: fd.is_static,
                    decorators: fd.decorators.clone(), name: fd.name.clone(),
                    type_params: fd.type_params.clone(), params: fd.params.clone(),
                    return_type: fd.return_type.clone(), body: FnBody::SignatureOnly,
                    trivia: fd.trivia.clone(), span: fd.span,
                }));
                return Some(sub);
            }
            AiceItem::Class(cd) => {
                for m in &cd.methods {
                    if short_hint.is_some_and(|h| m.name == h) || m.span.line == start_line {
                        sub.items.push(AiceItem::Class(ClassDecl {
                            vis: cd.vis, is_abstract: cd.is_abstract, decorators: cd.decorators.clone(),
                            name: cd.name.clone(), type_params: cd.type_params.clone(),
                            primary_ctor: cd.primary_ctor.clone(), extends: cd.extends.clone(),
                            implements: cd.implements.clone(), props: Vec::new(),
                            methods: vec![MethodDecl {
                                vis: m.vis, is_static: m.is_static, is_async: m.is_async,
                                is_const: m.is_const, accessor: m.accessor, name: m.name.clone(),
                                type_params: m.type_params.clone(), params: m.params.clone(),
                                return_type: m.return_type.clone(), body: FnBody::SignatureOnly,
                                trivia: m.trivia.clone(), span: m.span,
                            }],
                            static_blocks: Vec::new(), trivia: cd.trivia.clone(), span: cd.span,
                        }));
                        return Some(sub);
                    }
                }
            }
            _ => {}
        }
    }
    None
}

fn render_intra_block_body_aice(req: &SliceTranspileReq<'_>, block_chunk: &str, block_start: usize) -> String {
    if !is_imperative_lang(req.lang) {
        if let Some(t) = req.tree
            && let Ok(TranspileOutcome::Transpiled(module)) = req.transpiler.to_aice(t, req.full_src, req.opts)
        {
            let starts = compute_line_starts(req.full_src);
            let syms = req.registry.adapter(req.lang).map(|a| a.extract_symbols(t, req.full_src)).unwrap_or_default();
            if let Some(sub) = project_module_window(&ProjectWindowArgs {
                module: &module, full_src: req.full_src, starts: &starts, syms: &syms,
                registry: req.registry, transpiler: req.transpiler, opts: req.opts,
                start_line: block_start, end_line: req.slice.end_line, sym_hint: None,
            }) {
                let printed = strip_module_header(&print_aice_with_opts(&sub, req.opts));
                if !printed.trim().is_empty() {
                    return printed;
                }
            }
        }
        let bal = balance_closers_for_lang(req.lang, &dedent_block(block_chunk));
        if let Some(printed) = try_clean_aice(req.lang, &bal, req.registry, req.transpiler, req.opts) {
            return strip_module_header(&printed);
        }
        return normalize_fragment_comments(block_chunk);
    }

    let ded = dedent_block(block_chunk);
    if let Some(body) = try_wrapped_block_aice(req.lang, &ded, req.registry, req.transpiler, req.opts) {
        return body;
    }
    normalize_fragment_comments(block_chunk)
}

fn try_wrapped_block_aice(
    lang: LanguageId,
    ded: &str,
    registry: &EngineRegistry,
    transpiler: &DefaultAiceTranspiler,
    opts: &TranspileOpts,
) -> Option<String> {
    let (wrapped, dummy_kind) = wrap_intra_block_for_lang(lang, ded)?;
    let mut module = parse_clean_module(lang, &wrapped, registry, transpiler, opts).or_else(|| {
        (lang == LanguageId::Ruby && dummy_kind.is_some())
            .then(|| wrapped.strip_suffix("\nend"))
            .flatten()
            .and_then(|alt| parse_clean_module(lang, alt, registry, transpiler, opts))
    })?;
    if let Some(d) = dummy_kind {
        strip_dummy_ast_trivia_and_body(&mut module, d);
    }
    let printed = print_aice_with_opts(&module, opts);
    let mut lines: Vec<&str> = printed.lines().collect();
    if lines.first().is_some_and(|l| l.starts_with("module ")) { lines.remove(0); }
    if lines.first().is_some_and(|l| l.trim_start().starts_with("class _W")) {
        lines.remove(0);
        lines = lines.into_iter().map(|l| l.strip_prefix("  ").unwrap_or(l)).collect();
    }
    if let Some(first) = lines.first().copied()
        && let Some((_, expr)) = first.split_once("fn __aice_blk__() = ")
    {
        return Some(format!("  ret {expr}\n"));
    }
    let fn_idx = lines.iter().position(|l| l.contains("fn __aice_blk__"))?;
    let mut body_lines: Vec<String> = lines[fn_idx + 1..].iter().map(|s| (*s).to_string()).collect();
    if let Some(d) = dummy_kind {
        strip_printed_dummy_prefix(&mut body_lines, d);
    }
    (!body_lines.is_empty()).then(|| format!("{}\n", body_lines.join("\n")))
}

fn rename_wrapper_class(module: &mut AiceModule, sym_hint: Option<&str>) {
    let container = sym_hint.and_then(|s| s.replace('.', "::").rsplit_once("::").map(|(c, _)| c.to_string()));
    for item in &mut module.items {
        if let AiceItem::Class(c) = item
            && c.name == "_W"
            && let Some(ref real) = container
        {
            c.name = real.clone();
        }
    }
}

fn parse_skip_end_line(marker: &str) -> Option<usize> {
    let idx = marker.find("-L")?;
    let digits: String = marker[idx + 2..].chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

fn strip_module_header(s: &str) -> String {
    let mut lines = s.lines();
    if let Some(first) = lines.next()
        && first.starts_with("module ")
    {
        let rest: Vec<&str> = lines.collect();
        return if rest.is_empty() { String::new() } else { format!("{}\n", rest.join("\n")) };
    }
    s.to_string()
}
