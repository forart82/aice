use aice_aice_ir::ir::{AiceItem, AiceModule, TranspileOpts};
use aice_aice_ir::printer::print_aice_with_opts;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOutcome};
use aice_ast_engine::EngineRegistry;
use aice_lang_registry::{AdapterLookup, LanguageId, ParsedTree};

use crate::aice_project_util::{
    compute_line_starts, slice_lines_range, span_lines, strip_comment_prefix,
};

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

pub(crate) fn extract_ts_reexport_outline(lang: LanguageId, src: &str) -> Vec<String> {
    if !matches!(lang, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript) {
        return Vec::new();
    }
    let lines: Vec<&str> = src.lines().collect();
    let mut out = Vec::new();
    let (mut i, mut in_blk) = (0usize, false);
    while i < lines.len() {
        let trimmed = lines[i].trim();
        if in_blk {
            if trimmed.contains("*/") {
                in_blk = false;
            }
            i += 1;
            continue;
        }
        if trimmed.is_empty() || trimmed.starts_with("//") {
            i += 1;
            continue;
        }
        if trimmed.starts_with("/*") {
            if !trimmed.contains("*/") {
                in_blk = true;
            }
            i += 1;
            continue;
        }
        if !trimmed.starts_with("export ") && !trimmed.starts_with("export{") && !trimmed.starts_with("export*") {
            i += 1;
            continue;
        }
        let start = i + 1;
        let mut buf = String::new();
        let mut end = start;
        let mut has_from = false;
        while i < lines.len() {
            let cur = lines[i].trim();
            if !cur.is_empty() && !cur.starts_with("//") {
                if !buf.is_empty() {
                    buf.push(' ');
                }
                buf.push_str(cur);
            }
            end = i + 1;
            if contains_from_clause(&buf) {
                has_from = true;
            }
            let done = cur.ends_with(';') || (has_from && (cur.ends_with('\'') || cur.ends_with('"')));
            i += 1;
            if done {
                break;
            }
            if !has_from && !buf.contains('{') && !buf.contains('*') {
                break;
            }
        }
        if has_from {
            let compact = collapse_ws(buf.trim_end_matches(';').trim());
            let loc = if start == end { format!("L{start}") } else { format!("L{start}-L{end}") };
            out.push(format!("{compact} # [{loc}]"));
        }
    }
    out
}

fn contains_from_clause(s: &str) -> bool {
    s.contains(" from '") || s.contains(" from \"") || s.contains("}from '") || s.contains("}from \"")
}

fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_ws = false;
    for ch in s.chars() {
        if ch.is_whitespace() {
            if !prev_ws {
                out.push(' ');
                prev_ws = true;
            }
        } else {
            out.push(ch);
            prev_ws = false;
        }
    }
    out
}

pub(crate) fn extract_raw_imports_for_rn(src: &str, imports: &[AiceItem]) -> Option<String> {
    if imports.is_empty() {
        return None;
    }
    let starts = compute_line_starts(src);
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    for item in imports {
        if let AiceItem::Import(imp) = item
            && let Some((s, e)) = span_lines(imp.span, &starts)
        {
            ranges.push((s, e));
        }
    }
    if !ranges.is_empty() {
        ranges.sort_unstable();
        let mut merged: Vec<(usize, usize)> = Vec::new();
        for (s, e) in ranges {
            if let Some(last) = merged.last_mut()
                && s <= last.1.saturating_add(1)
            {
                last.1 = last.1.max(e);
            } else {
                merged.push((s, e));
            }
        }
        let mut out = String::new();
        for (s, e) in merged {
            out.push_str(slice_lines_range(src, &starts, s, e));
        }
        if !out.trim().is_empty() {
            return Some(out);
        }
    }
    let lines: Vec<&str> = src
        .lines()
        .filter(|l| {
            let t = l.trim_start();
            [
                "import ", "import{", "import*", "from ", "use ", "#include", "using ",
                "require(", "require ", "require_relative ", "@import ",
            ]
            .iter()
            .any(|p| t.starts_with(p))
        })
        .collect();
    (!lines.is_empty()).then(|| format!("{}\n", lines.join("\n")))
}

pub(crate) fn js_ts_const_tag(lang: LanguageId, sig: Option<&str>, line: Option<&str>) -> &'static str {
    if !matches!(lang, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript) {
        return "const";
    }
    let Some(raw) = sig.or(line) else {
        return "const";
    };
    let mut rest = raw.trim_start();
    while let Some(after) = rest
        .strip_prefix("export ")
        .or_else(|| rest.strip_prefix("declare "))
    {
        rest = after.trim_start();
    }
    if rest.strip_prefix("let").is_some_and(|r| r.starts_with(char::is_whitespace)) {
        "let"
    } else if rest.strip_prefix("var").is_some_and(|r| r.starts_with(char::is_whitespace)) {
        "var"
    } else {
        "const"
    }
}
