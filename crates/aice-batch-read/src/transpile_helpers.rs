use aice_aice_ir::ir::{AiceItem, AiceModule, TranspileOpts};
use aice_aice_ir::printer::print_aice_with_opts;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOutcome};
use aice_ast_engine::EngineRegistry;
use aice_lang_registry::{AdapterLookup, LanguageId, ParsedTree};

use crate::aice_project_util::strip_comment_prefix;

pub fn normalize_fragment_comments(src: &str) -> String {
    if src.is_empty() {
        return String::new();
    }
    let mut out = String::new();
    for line in src.lines() {
        let trimmed = line.trim();
        if let Some(clean) = strip_comment_prefix(trimmed) {
            let indent = &line[..line.len() - line.trim_start().len()];
            if clean.is_empty() {
                out.push_str(&format!("{indent}#\n"));
            } else {
                out.push_str(&format!("{indent}# {clean}\n"));
            }
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

pub fn dedent_block(src: &str) -> String {
    let min_indent = src
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.bytes().take_while(|&b| b == b' ' || b == b'\t').count())
        .min()
        .unwrap_or(0);
    let mut out = String::new();
    for line in src.lines() {
        if line.trim().is_empty() {
            out.push('\n');
        } else {
            out.push_str(&line[min_indent.min(line.len())..]);
            out.push('\n');
        }
    }
    if !src.ends_with('\n') && out.ends_with('\n') {
        out.pop();
    }
    out
}

pub(crate) fn try_clean_aice(
    lang: LanguageId,
    src: &str,
    registry: &EngineRegistry,
    transpiler: &DefaultAiceTranspiler,
    opts: &TranspileOpts,
) -> Option<String> {
    let module = parse_clean_module(lang, src, registry, transpiler, opts)?;
    let printed = print_aice_with_opts(&module, opts);
    (!printed.trim().is_empty()).then_some(printed)
}

pub(crate) fn parse_clean_module(
    lang: LanguageId,
    src: &str,
    registry: &EngineRegistry,
    transpiler: &DefaultAiceTranspiler,
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
        TranspileOutcome::Transpiled(m) if !m.items.is_empty() => {
            if is_imperative_lang(lang)
                && m.items.iter().all(|it| matches!(it, AiceItem::Directive { .. }))
            {
                None
            } else {
                Some(m)
            }
        }
        _ => None,
    }
}

pub(crate) fn is_imperative_lang(lang: LanguageId) -> bool {
    matches!(
        lang,
        LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript
            | LanguageId::Python | LanguageId::Rust | LanguageId::Go
            | LanguageId::C | LanguageId::Cpp | LanguageId::CSharp
            | LanguageId::Java | LanguageId::Kotlin | LanguageId::Dart
            | LanguageId::Php | LanguageId::Ruby
    )
}
