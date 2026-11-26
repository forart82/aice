use std::path::Path;

use aice_lang_registry::LanguageId;

use crate::r5::snippet_cst::{cst_defect_profile, strip_trailing_comment};
use crate::r5::snippet_ops::{
    has_valid_trailing_binary_op, is_trailing_continuation_token, push_go_bracket_probes,
    trailing_binary_op,
};
use crate::ts_pool::ParserPool;

fn any_cand_clean(lang: LanguageId, cands: &[String], path: &Path, pool: &mut ParserPool) -> bool {
    cands.iter().any(|cand| {
        let p = cst_defect_profile(lang, cand, path, pool);
        p.min_errs == 0 && p.unclosed_quotes == 0
    })
}

pub(crate) fn closed_trailing_op_ok(
    lang: LanguageId,
    code: &str,
    path: &Path,
    pool: &mut ParserPool,
) -> bool {
    if !has_valid_trailing_binary_op(lang, code.trim_end()) {
        return false;
    }
    let mut cands = vec![
        format!("{code} _aice_"),
        format!("{code} _aice_;"),
        format!("{code} _aice_ {{}}"),
        format!("{{\n{code} _aice_\n}}"),
        format!("[\n{code} _aice_\n]"),
        format!("_aice_(\n{code} _aice_\n)"),
        format!("_aice_(\n{code} _aice_\n);"),
        format!("if (0) {{}}\n{code} _aice_ {{}}"),
    ];
    match lang {
        LanguageId::Python => {
            cands.push(format!("{code} _aice_: pass"));
            cands.push(format!("if 0: pass\n{code} _aice_: pass"));
        }
        LanguageId::Ruby => {
            cands.push(format!("{code} _aice_; end"));
            cands.push(format!("{code} _aice_\nend"));
            cands.push(format!("if 0\n{code} _aice_\nend"));
        }
        LanguageId::Rust => cands.push(format!("match _aice_ {{\n{code} _aice_\n}}")),
        LanguageId::Kotlin => cands.push(format!("when (_aice_) {{\n{code} _aice_\n}}")),
        _ => {}
    }
    any_cand_clean(lang, &cands, path, pool)
}

pub(crate) fn closed_non_op_completable_ok(
    lang: LanguageId,
    code: &str,
    allow_type_body: bool,
    allow_container: bool,
    path: &Path,
    pool: &mut ParserPool,
) -> bool {
    let mut cands = Vec::new();
    if !code.trim_end().ends_with(',') {
        cands.extend([
            format!("{code} {{}}"),
            format!("if (0) {{}} {code} {{}}"),
            format!("try {{}} {code} {{}}"),
        ]);
    }
    if allow_container {
        cands.extend([
            format!("(\n{code}\n)"),
            format!("[\n{code}\n]"),
            format!("[\n{code}\n];"),
            format!("{{\n{code}\n}}"),
            format!("_aice_(\n{code}\n)"),
            format!("_aice_(\n{code}\n);"),
            format!("let _v = [\n{code}\n];"),
        ]);
    if allow_type_body {
        cands.push(format!("struct _S {{\n{code}\n}}"));
        cands.push(format!("enum _E {{\n{code}\n}}"));
        if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx) {
            cands.push(format!("interface _I {{\n{code}\n}}"));
        }
    }
    }
    let t = code.trim_start();
    if t.starts_with('.') || t.starts_with("?.") || t.starts_with("->") {
        let recv = if lang == LanguageId::Php && t.starts_with("->") { "$_aice_" } else { "_aice_" };
        cands.extend([
            format!("{recv}{t}"),
            format!("{recv}{t};"),
            format!("[\n{recv}{t}\n]"),
            format!("[\n{recv}{t}\n];"),
            format!("_aice_(\n{recv}{t}\n)"),
            format!("_aice_(\n{recv}{t}\n);"),
        ]);
        if lang == LanguageId::Php {
            cands.push(format!("<?php {recv}{t};"));
            cands.push(format!("<?php [\n{recv}{t}\n];"));
            cands.push(format!("<?php _aice_(\n{recv}{t}\n);"));
        }
    }
    if is_trailing_continuation_token(lang, code) {
        cands.extend([
            format!("{code} _aice_"),
            format!("{code} _aice_;"),
            format!("_aice_(\n{code} _aice_\n)"),
            format!("_aice_(\n{code} _aice_\n);"),
            format!("{{\n{code} _aice_\n}}"),
        ]);
    }
    match lang {
        LanguageId::Python => {
            cands.push(format!("if 0: pass\n{code}\n    pass"));
            cands.push(format!("try: pass\n{code}\n    pass"));
            if allow_type_body { cands.push(format!("def _aice_(\n{code}\n): pass")); }
            if is_trailing_continuation_token(lang, code) {
                cands.push(format!("{code} _aice_: pass"));
            }
        }
        LanguageId::Ruby => {
            cands.extend([format!("{code}\nend"), format!("if 0\n{code}\nend"), format!("begin\n0\n{code}\nend"), format!("case 0\n{code}\nend")]);
            if is_trailing_continuation_token(lang, code) {
                cands.push(format!("{code} _aice_\nend"));
            }
        }
        LanguageId::Rust => {
            cands.push(format!("match _aice_ {{\n{code}\n}}"));
            if allow_type_body { cands.push(format!("fn _aice_(\n{code}\n) {{}}")); }
        }
        LanguageId::Kotlin => {
            cands.push(format!("when (_aice_) {{\n{code}\n}}"));
            if allow_type_body { cands.push(format!("fun _aice_(\n{code}\n) {{}}")); }
        }
        LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript => {
            cands.push(format!("switch (_aice_) {{\n{code}\n}}"));
            if allow_type_body { cands.push(format!("function _aice_(\n{code}\n) {{}}")); }
            if !allow_container
                && !allow_type_body
                && !code.trim_end().ends_with(',')
                && code.lines().all(|l| l.trim().is_empty() || l.contains(':'))
            {
                cands.push(format!("const _v = {{\n{code}\n}};"));
            }
        }
        LanguageId::Go => {
            cands.push(format!("switch _aice_ {{\n{code}\n}}"));
            if allow_type_body { cands.push(format!("func _aice_(\n{code}\n) {{}}")); }
        }
        LanguageId::C | LanguageId::Cpp | LanguageId::Java | LanguageId::CSharp | LanguageId::Dart => {
            cands.push(format!("switch (_aice_) {{\n{code}\n}}"));
            if allow_type_body { cands.push(format!("void _aice_(\n{code}\n) {{}}")); }
        }
        LanguageId::Php => {
            cands.push(format!("<?php switch ($_aice_) {{\n{code}\n}}"));
            if allow_type_body { cands.push(format!("<?php function _aice_(\n{code}\n) {{}}")); }
            if allow_container {
                cands.extend([format!("<?php\n[\n{code}\n];"), format!("<?php\n_aice_(\n{code}\n);"), format!("<?php\n$_v = [\n{code}\n];")]);
            }
        }
        LanguageId::Bash => cands.extend([format!("if true; then\n  true\n{code}\n  true\nfi"), format!("case x in\n{code}\nesac")]),
        _ => {}
    }
    any_cand_clean(lang, &cands, path, pool)
}

pub(crate) fn closed_line_completable_ok(
    lang: LanguageId,
    line: &str,
    path: &Path,
    pool: &mut ParserPool,
) -> bool {
    let code = strip_trailing_comment(lang, line, pool);
    if trailing_binary_op(lang, code).is_some() {
        return closed_trailing_op_ok(lang, code, path, pool);
    }
    closed_non_op_completable_ok(lang, code, lang != LanguageId::Rust, true, path, pool)
}

pub(crate) fn closed_delim_ok(
    lang: LanguageId,
    code: &str,
    stack: &[u8],
    unmatched: &[u8],
    path: &Path,
    pool: &mut ParserPool,
) -> bool {
    let trimmed = code.trim_end();
    if trailing_binary_op(lang, trimmed).is_some() && !has_valid_trailing_binary_op(lang, trimmed) {
        return false;
    }
    let closers: String = stack.iter().rev().map(|&c| match c { b'(' => ')', b'[' => ']', _ => '}' }).collect();
    let tail = if trimmed.ends_with(['(', '[']) {
        "_aice_"
    } else if (trimmed.ends_with(',')
        && !trimmed[..trimmed.len() - 1].trim_end().ends_with([',', '(', '[', '{'])
        && stack.last() != Some(&b'{'))
        || has_valid_trailing_binary_op(lang, trimmed)
        || is_trailing_continuation_token(lang, trimmed)
    {
        " _aice_"
    } else {
        ""
    };
    let mut v = Vec::new();
    if !unmatched.is_empty() {
        let openers: String = unmatched.iter().rev().map(|&c| match c { b')' => '(', b']' => '[', _ => '{' }).collect();
        v.extend([
            format!("{openers}\n{code}{tail}{closers}"),
            format!("{openers}\n{code}{tail}{closers};"),
            format!("_aice_{openers}\n{code}{tail}{closers}"),
            format!("_aice_{openers}\n{code}{tail}{closers};"),
        ]);
        if let Some(rest) = openers.strip_prefix('(') {
            let fn_end = if closers.is_empty() { " {}" } else { &closers };
            v.extend([
                format!("(_aice_{rest}\n{code}{tail}{closers}"),
                format!("(_aice_{rest}\n{code}{tail}{closers};"),
                format!("if {openers}\n{code}{tail}{fn_end}"),
            ]);
            match lang {
                LanguageId::Python => {
                    v.push(format!("def _aice_{openers}\n{code}{tail}: pass"));
                    if trimmed.ends_with(':') {
                        v.push(format!("def _aice_{openers}\n{code}{tail}\n    pass"));
                    }
                }
                LanguageId::Ruby => v.push(format!("def _aice_{openers}\n{code}{tail}\nend")),
                LanguageId::Rust => v.push(format!("fn _aice_{openers}\n{code}{tail}{fn_end}")),
                LanguageId::Kotlin => v.push(format!("fun _aice_{openers}\n{code}{tail}{fn_end}")),
                LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx => {
                    v.push(format!("function _aice_{openers}\n{code}{tail}{fn_end}"));
                }
                LanguageId::Go => v.push(format!("func _aice_{openers}\n{code}{tail}{fn_end}")),
                LanguageId::Php => v.push(format!("<?php function _aice_{openers}\n{code}{tail}{fn_end}")),
                _ => v.push(format!("void _aice_{openers}\n{code}{tail}{fn_end}")),
            }
        }
        if openers == "{" {
            v.push(format!("[\n{{\n{code}{tail}{closers},\n]"));
            v.push(format!("[\n{{\n{code}{tail}{closers}\n]"));
            if lang == LanguageId::Ruby {
                v.push(format!("_aice_ {{\n{code}{tail}{closers}"));
            }
        }
    } else if !stack.is_empty() {
        v.extend([format!("{code}{closers}"), format!("{code}{closers};"), format!("{code}{closers} {{}}")]);
        if lang == LanguageId::Python {
            v.push(format!("{code}{closers}: pass"));
        } else if lang == LanguageId::Ruby {
            v.extend([format!("{code}{closers}; end"), format!("{code}{closers}\nend")]);
        }
        if lang == LanguageId::Go && stack.last() == Some(&b'[') {
            push_go_bracket_probes(code, trimmed, &closers, has_valid_trailing_binary_op(lang, trimmed), &mut v);
        }
        if !tail.is_empty() {
            v.extend([format!("{code}{tail}{closers}"), format!("{code}{tail}{closers};"), format!("{code}{tail}{closers} {{}}")]);
            if lang == LanguageId::Python {
                v.push(format!("{code}{tail}{closers}: pass"));
            } else if lang == LanguageId::Ruby {
                v.extend([format!("{code}{tail}{closers}; end"), format!("{code}{tail}{closers}\nend")]);
            }
        }
    } else {
        v.extend([
            format!("_aice_(\n{code}\n)"),
            format!("_aice_(\n{code}\n);"),
            format!("[\n{code}\n]"),
            format!("let _v = [\n{code}\n];"),
            format!("_v = {{\n{code}\n}}"),
            format!("const _v = {{\n{code}\n}};"),
        ]);
        if lang != LanguageId::Rust {
            v.push(format!("struct _S {{\n{code}\n}}"));
        }
    }
    any_cand_clean(lang, &v, path, pool)
}


