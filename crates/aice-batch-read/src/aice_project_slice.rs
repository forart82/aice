use aice_aice_ir::ir::{AiceItem, AiceModule, TranspileOpts};
use aice_aice_ir::ir_code::{FnBody, FnDecl, MethodDecl};
use aice_aice_ir::{AiceTranspiler, TranspileOutcome};
use aice_ast_engine::EngineRegistry;
use aice_lang_registry::{AdapterLookup, LanguageId, ParsedTree};

use crate::aice_project::ProjectWindowArgs;
use crate::aice_project_util::{parse_balanced_module, slice_lines_range, wrap_method_for_lang};
use crate::intra_wrap::{
    brace_net_depth, skip_rust_char_or_lifetime, skip_rust_raw_string,
    strip_dummy_ast_trivia_and_body, wrap_intra_block_for_lang,
};
use crate::transpile_helpers::{dedent_block, is_imperative_lang};

pub(crate) enum MidSliceResult<T> {
    Sliced(T),
    Trivial,
    Unrepresentable,
}

pub(crate) fn trim_method_tail(
    m: &MethodDecl,
    m_start: usize,
    args: &ProjectWindowArgs<'_>,
) -> MethodDecl {
    let slice = slice_lines_range(args.full_src, args.starts, m_start, args.end_line);
    if !has_unclosed_paren_or_bracket(args.module.source_lang, slice) {
        let wrapped = wrap_method_for_lang(args.module.source_lang, slice);
        for cand in [wrapped.as_str(), slice] {
            if let Some(sub_mod) = parse_balanced_module(
                args.module.source_lang, cand, args.registry, args.transpiler, args.opts,
            ) {
                for it in sub_mod.items {
                    match it {
                        AiceItem::Class(c) => {
                            if let Some(fm) = c.methods.into_iter().find(|x| x.name == m.name) {
                                return fm;
                            }
                        }
                        AiceItem::Fn(f) if f.name == m.name => {
                            return clone_method_with_body(m, f.body);
                        }
                        _ => {}
                    }
                }
            }
        }
    }
    clone_method_with_body(m, FnBody::SignatureOnly)
}

pub(crate) fn project_fn_head(
    fd: &FnDecl,
    f_start: usize,
    args: &ProjectWindowArgs<'_>,
) -> Option<FnDecl> {
    let slice = slice_lines_range(args.full_src, args.starts, f_start, args.end_line);
    let unclosed = has_unclosed_paren_or_bracket(args.module.source_lang, slice);
    if !unclosed
        && let Some(sub_mod) = parse_balanced_module(
            args.module.source_lang, slice, args.registry, args.transpiler, args.opts,
        )
        && let Some(AiceItem::Fn(f)) =
            sub_mod.items.into_iter().find(|it| matches!(it, AiceItem::Fn(_)))
    {
        return Some(f);
    }
    if args.sym_hint.is_none() && args.end_line > f_start && !unclosed {
        return None;
    }
    Some(clone_fn_with_body(fd, FnBody::SignatureOnly))
}

pub(crate) fn slice_method_mid(
    m: &MethodDecl,
    m_end: usize,
    args: &ProjectWindowArgs<'_>,
) -> MidSliceResult<MethodDecl> {
    let win_end = args.end_line.min(m_end);
    let mid_src = slice_lines_range(args.full_src, args.starts, args.start_line, win_end);
    if !has_substantive_code(mid_src) {
        return MidSliceResult::Trivial;
    }
    match parse_mid_body(args.module.source_lang, mid_src, win_end >= m_end, args) {
        Some(body) => MidSliceResult::Sliced(clone_method_with_body(m, body)),
        None => MidSliceResult::Unrepresentable,
    }
}

pub(crate) fn slice_fn_mid(
    fd: &FnDecl,
    f_end: usize,
    args: &ProjectWindowArgs<'_>,
) -> MidSliceResult<FnDecl> {
    let win_end = args.end_line.min(f_end);
    let mid_src = slice_lines_range(args.full_src, args.starts, args.start_line, win_end);
    if !has_substantive_code(mid_src) {
        return MidSliceResult::Trivial;
    }
    match parse_mid_body(args.module.source_lang, mid_src, win_end >= f_end, args) {
        Some(body) => MidSliceResult::Sliced(clone_fn_with_body(fd, body)),
        None => MidSliceResult::Unrepresentable,
    }
}

fn parse_mid_body(
    lang: LanguageId,
    mid_src: &str,
    reaches_end: bool,
    args: &ProjectWindowArgs<'_>,
) -> Option<FnBody> {
    if !is_imperative_lang(lang) {
        return None;
    }
    let mut trimmed = mid_src.to_string();
    if reaches_end && brace_net_depth(lang, &trimmed) == -1 {
        trimmed = strip_trailing_closing_brace(&trimmed)?;
    }
    if brace_net_depth(lang, &trimmed) < 0 || has_unclosed_paren_or_bracket(lang, &trimmed) {
        return None;
    }
    let ded = dedent_block(&trimmed);
    let (wrapped, dummy_kind) = wrap_intra_block_for_lang(lang, &ded)?;
    let mut module =
        parse_clean_module_dyn(lang, &wrapped, args.registry, args.transpiler, args.opts)?;
    if let Some(d) = dummy_kind {
        strip_dummy_ast_trivia_and_body(&mut module, d);
    }
    extract_dummy_fn_body(module)
}

fn extract_dummy_fn_body(module: AiceModule) -> Option<FnBody> {
    for item in module.items {
        match item {
            AiceItem::Fn(f) if f.name == "__aice_blk__" => return non_empty_body(f.body),
            AiceItem::Class(c) => {
                if let Some(m) = c.methods.into_iter().find(|m| m.name == "__aice_blk__") {
                    return non_empty_body(m.body);
                }
            }
            _ => {}
        }
    }
    None
}

fn non_empty_body(body: FnBody) -> Option<FnBody> {
    match &body {
        FnBody::Block(stmts) if !stmts.is_empty() => Some(body),
        FnBody::Expr(_) => Some(body),
        _ => None,
    }
}

fn parse_clean_module_dyn(
    lang: LanguageId,
    src: &str,
    registry: &EngineRegistry,
    transpiler: &dyn AiceTranspiler,
    opts: &TranspileOpts,
) -> Option<AiceModule> {
    let adapter = registry.adapter(lang)?;
    let tree = adapter.parse_cst(src).ok()?;
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
    match transpiler.to_aice(&tree, src, opts).ok()? {
        TranspileOutcome::Transpiled(m) if !m.items.is_empty() => Some(m),
        _ => None,
    }
}

fn strip_trailing_closing_brace(src: &str) -> Option<String> {
    let mut lines: Vec<&str> = src.lines().collect();
    while lines.last().is_some_and(|l| l.trim().is_empty()) {
        lines.pop();
    }
    if matches!(lines.last()?.trim(), "}" | "};" | "end") {
        lines.pop();
        Some(format!("{}\n", lines.join("\n")))
    } else {
        None
    }
}

fn has_substantive_code(src: &str) -> bool {
    src.lines().any(|l| {
        let t = l.trim();
        !t.is_empty() && !matches!(t, "}" | "};" | "}," | ")" | ");" | ")," | "]" | "];" | "],")
    })
}

pub(crate) fn has_unclosed_paren_or_bracket(lang: LanguageId, src: &str) -> bool {
    let b = src.as_bytes();
    let (mut i, mut par, mut brk) = (0usize, 0isize, 0isize);
    let (mut q, mut lc, mut bc) = (None::<u8>, false, false);
    while i < b.len() {
        if lc {
            if b[i] == b'\n' { lc = false; }
            i += 1;
        } else if bc {
            if b[i] == b'*' && b.get(i + 1) == Some(&b'/') { bc = false; i += 2; } else { i += 1; }
        } else if let Some(qc) = q {
            if b[i] == b'\\' { i += 2; } else { if b[i] == qc { q = None; } i += 1; }
        } else if b[i] == b'/' && b.get(i + 1) == Some(&b'/') {
            lc = true; i += 2;
        } else if b[i] == b'/' && b.get(i + 1) == Some(&b'*') {
            bc = true; i += 2;
        } else if lang == LanguageId::Rust && let Some(ni) = skip_rust_raw_string(b, i) {
            i = ni;
        } else if lang == LanguageId::Rust && b[i] == b'\'' {
            i = skip_rust_char_or_lifetime(src, i);
        } else {
            match b[i] {
                b'"' | b'\'' | b'`' => q = Some(b[i]),
                b'(' => par += 1,
                b')' => par -= 1,
                b'[' => brk += 1,
                b']' => brk -= 1,
                _ => {}
            }
            i += 1;
        }
    }
    par > 0 || brk > 0
}

fn clone_method_with_body(m: &MethodDecl, body: FnBody) -> MethodDecl {
    MethodDecl {
        vis: m.vis, is_static: m.is_static, is_async: m.is_async, is_const: m.is_const,
        accessor: m.accessor, name: m.name.clone(), type_params: m.type_params.clone(),
        params: m.params.clone(), return_type: m.return_type.clone(), body,
        trivia: m.trivia.clone(), span: m.span,
    }
}

fn clone_fn_with_body(fd: &FnDecl, body: FnBody) -> FnDecl {
    FnDecl {
        vis: fd.vis, is_async: fd.is_async, is_static: fd.is_static,
        decorators: fd.decorators.clone(), name: fd.name.clone(),
        type_params: fd.type_params.clone(), params: fd.params.clone(),
        return_type: fd.return_type.clone(), body,
        trivia: fd.trivia.clone(), span: fd.span,
    }
}
