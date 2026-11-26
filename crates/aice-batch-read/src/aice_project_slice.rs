use aice_aice_ir::ir::{AiceItem, AiceModule, TranspileOpts};
use aice_aice_ir::ir_code::{FnBody, FnDecl, MethodDecl};
use aice_aice_ir::printer::print_aice_with_opts;
use aice_aice_ir::{AiceTranspiler, TranspileOutcome};
use aice_ast_engine::EngineRegistry;
use aice_lang_registry::{AdapterLookup, LanguageId, ParsedTree};

use crate::aice_project::ProjectWindowArgs;
pub(crate) use crate::aice_project_mid::has_unclosed_paren_or_bracket;
use crate::aice_project_mid::{
    ends_with_unfilled_call, has_body_code_after_sig, preserves_call_args_text,
    python_indent_bounds, reconstruct_python_mid_block,
};
use crate::aice_project_util::{balance_closers_for_lang, slice_lines_range, wrap_method_for_lang};
use crate::intra_wrap::{
    brace_net_depth, strip_dummy_ast_trivia_and_body, wrap_intra_block_for_lang,
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
) -> MidSliceResult<MethodDecl> {
    let lang = args.module.source_lang;
    let slice = slice_lines_range(args.full_src, args.starts, m_start, args.end_line);
    let wants_body = has_body_code_after_sig(lang, slice, args.end_line > m_start);
    if !ends_with_unfilled_call(slice) {
        let balanced = balance_closers_for_lang(lang, slice);
        let wrapped = wrap_method_for_lang(lang, &balanced);
        for cand in [wrapped.as_str(), balanced.as_str()] {
            if let Some(sub_mod) =
                parse_clean_module_dyn(lang, cand, args.registry, args.transpiler, args.opts)
                && let Some(fm) = extract_trimmed_method(sub_mod, m)
            {
                let body_ok = !wants_body || !matches!(fm.body, FnBody::SignatureOnly);
                if body_ok && method_preserves_calls(lang, slice, &fm, args.opts) {
                    return MidSliceResult::Sliced(fm);
                }
            }
        }
    }
    if wants_body {
        return MidSliceResult::Unrepresentable;
    }
    MidSliceResult::Sliced(clone_method_with_body(m, FnBody::SignatureOnly))
}

fn extract_trimmed_method(sub_mod: AiceModule, orig: &MethodDecl) -> Option<MethodDecl> {
    if sub_mod.items.len() != 1 {
        return None;
    }
    match sub_mod.items.into_iter().next()? {
        AiceItem::Class(c) => c.methods.into_iter().find(|x| x.name == orig.name),
        AiceItem::Fn(f) if f.name == orig.name => Some(clone_method_with_body(orig, f.body)),
        _ => None,
    }
}

fn method_preserves_calls(lang: LanguageId, raw: &str, m: &MethodDecl, opts: &TranspileOpts) -> bool {
    if !has_unclosed_paren_or_bracket(lang, raw) {
        return true;
    }
    let mut tmp = AiceModule::new(lang, lang.canonical_name());
    tmp.items.push(AiceItem::Fn(FnDecl {
        vis: m.vis, is_async: m.is_async, is_static: m.is_static, decorators: Vec::new(),
        name: m.name.clone(), type_params: m.type_params.clone(), params: m.params.clone(),
        return_type: m.return_type.clone(), body: m.body.clone(), trivia: m.trivia.clone(),
        span: m.span,
    }));
    preserves_call_args_text(raw, &print_aice_with_opts(&tmp, opts))
}

pub(crate) fn project_fn_head(
    fd: &FnDecl,
    f_start: usize,
    args: &ProjectWindowArgs<'_>,
) -> MidSliceResult<FnDecl> {
    let lang = args.module.source_lang;
    let slice = slice_lines_range(args.full_src, args.starts, f_start, args.end_line);
    let wants_body = has_body_code_after_sig(lang, slice, args.end_line > f_start);
    if !ends_with_unfilled_call(slice) {
        let balanced = balance_closers_for_lang(lang, slice);
        if let Some(sub_mod) =
            parse_clean_module_dyn(lang, &balanced, args.registry, args.transpiler, args.opts)
            && sub_mod.items.len() == 1
            && let Some(AiceItem::Fn(f)) = sub_mod.items.into_iter().next()
        {
            let body_ok = !wants_body || !matches!(f.body, FnBody::SignatureOnly);
            let mut tmp = AiceModule::new(lang, lang.canonical_name());
            tmp.items.push(AiceItem::Fn(f.clone()));
            let calls_ok = !has_unclosed_paren_or_bracket(lang, slice)
                || preserves_call_args_text(slice, &print_aice_with_opts(&tmp, args.opts));
            if body_ok && calls_ok {
                return MidSliceResult::Sliced(f);
            }
        }
    }
    if wants_body {
        return MidSliceResult::Unrepresentable;
    }
    MidSliceResult::Sliced(clone_fn_with_body(fd, FnBody::SignatureOnly))
}

pub(crate) fn slice_method_mid(
    m: &MethodDecl,
    m_start: usize,
    m_end: usize,
    args: &ProjectWindowArgs<'_>,
) -> MidSliceResult<MethodDecl> {
    let win_end = args.end_line.min(m_end);
    let mid_src = slice_lines_range(args.full_src, args.starts, args.start_line, win_end);
    if !has_substantive_code(mid_src) {
        return MidSliceResult::Trivial;
    }
    match parse_mid_body(args.module.source_lang, m_start, mid_src, win_end >= m_end, args) {
        Some(body) => MidSliceResult::Sliced(clone_method_with_body(m, body)),
        None => MidSliceResult::Unrepresentable,
    }
}

pub(crate) fn slice_fn_mid(
    fd: &FnDecl,
    f_start: usize,
    f_end: usize,
    args: &ProjectWindowArgs<'_>,
) -> MidSliceResult<FnDecl> {
    let win_end = args.end_line.min(f_end);
    let mid_src = slice_lines_range(args.full_src, args.starts, args.start_line, win_end);
    if !has_substantive_code(mid_src) {
        return MidSliceResult::Trivial;
    }
    match parse_mid_body(args.module.source_lang, f_start, mid_src, win_end >= f_end, args) {
        Some(body) => MidSliceResult::Sliced(clone_fn_with_body(fd, body)),
        None => MidSliceResult::Unrepresentable,
    }
}

fn parse_mid_body(
    lang: LanguageId,
    fn_start: usize,
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
    if lang == LanguageId::Python
        && let Some((first_ind, min_ind)) = python_indent_bounds(&trimmed)
        && first_ind > min_ind
    {
        trimmed = reconstruct_python_mid_block(
            args.full_src,
            args.starts,
            fn_start,
            args.start_line,
            &trimmed,
        )?;
    }
    let ded = dedent_block(&trimmed);
    if lang == LanguageId::Python
        && python_indent_bounds(&ded).is_some_and(|(first_ind, _)| first_ind > 0)
    {
        return None;
    }
    let (wrapped, dummy_kind) = wrap_intra_block_for_lang(lang, &ded)?;
    let mut module =
        parse_clean_module_dyn(lang, &wrapped, args.registry, args.transpiler, args.opts)?;
    if let Some(d) = dummy_kind {
        strip_dummy_ast_trivia_and_body(&mut module, d);
    }
    extract_dummy_fn_body(module)
}

fn extract_dummy_fn_body(module: AiceModule) -> Option<FnBody> {
    if module.items.len() != 1 {
        return None;
    }
    match module.items.into_iter().next()? {
        AiceItem::Fn(f) if f.name == "__aice_blk__" => non_empty_body(f.body),
        AiceItem::Class(c) if c.methods.len() == 1 => {
            let m = c.methods.into_iter().next()?;
            (m.name == "__aice_blk__").then_some(m.body).and_then(non_empty_body)
        }
        _ => None,
    }
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
