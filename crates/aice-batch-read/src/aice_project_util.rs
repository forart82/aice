use aice_aice_ir::ir::{AiceItem, AiceModule, Span, TranspileOpts};
use aice_aice_ir::ir_domain_db::{DbQueryDecl, DbSchemaDecl};
use aice_aice_ir::{AiceTranspiler, TranspileOutcome};
use aice_ast_engine::EngineRegistry;
use aice_lang_registry::{AdapterLookup, LanguageId, SymbolNode};

use crate::aice_project_domain::{
    db_migration_line_range, doc_section_line_range, shell_line_range,
};

pub fn compute_line_starts(src: &str) -> Vec<usize> {
    let mut starts = vec![0usize];
    for (idx, b) in src.bytes().enumerate() {
        if b == b'\n' {
            starts.push(idx + 1);
        }
    }
    starts
}

pub fn byte_to_line(starts: &[usize], byte_idx: usize) -> usize {
    starts.partition_point(|&s| s <= byte_idx).max(1)
}

pub fn slice_lines_range<'a>(src: &'a str, starts: &[usize], s: usize, e: usize) -> &'a str {
    if starts.is_empty() || s == 0 || e < s {
        return "";
    }
    let b0 = starts.get(s - 1).copied().unwrap_or(src.len());
    let b1 = starts.get(e).copied().unwrap_or(src.len());
    if b0 >= b1 || b0 > src.len() {
        return "";
    }
    &src[b0..b1.min(src.len())]
}

pub fn balance_closers(snippet: &str) -> String {
    balance_closers_for_lang(LanguageId::PlainText, snippet)
}

pub fn balance_closers_for_lang(lang: LanguageId, snippet: &str) -> String {
    let mut stack: Vec<char> = Vec::new();
    let bytes = snippet.as_bytes();
    let (mut i, mut quote, mut in_line_cmt, mut in_blk_cmt) = (0usize, None, false, false);
    while i < bytes.len() {
        let b = bytes[i];
        if in_line_cmt {
            if b == b'\n' {
                in_line_cmt = false;
            }
            i += 1;
            continue;
        }
        if in_blk_cmt {
            if b == b'*' && bytes.get(i + 1) == Some(&b'/') {
                in_blk_cmt = false;
                i += 2;
                continue;
            }
            i += 1;
            continue;
        }
        if let Some(q) = quote {
            if b == b'\\' {
                i += 2;
                continue;
            }
            if b == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        if b == b'/' && bytes.get(i + 1) == Some(&b'/') {
            in_line_cmt = true;
            i += 2;
            continue;
        }
        if b == b'/' && bytes.get(i + 1) == Some(&b'*') {
            in_blk_cmt = true;
            i += 2;
            continue;
        }
        if lang == LanguageId::Rust
            && let Some(next_i) = crate::intra_wrap::skip_rust_raw_string(bytes, i)
        {
            i = next_i;
            continue;
        }
        if lang == LanguageId::Rust && b == b'\'' {
            i = crate::intra_wrap::skip_rust_char_or_lifetime(snippet, i);
            continue;
        }
        match b {
            b'"' | b'\'' | b'`' => quote = Some(b),
            b'{' => stack.push('}'),
            b'(' => stack.push(')'),
            b'[' => stack.push(']'),
            b'}' | b')' | b']' if stack.last().copied() == Some(b as char) => {
                stack.pop();
            }
            _ => {}
        }
        i += 1;
    }
    if stack.is_empty() {
        return snippet.to_string();
    }
    let mut out = snippet.to_string();
    if !out.ends_with('\n') {
        out.push('\n');
    }
    while let Some(c) = stack.pop() {
        out.push(c);
        out.push('\n');
    }
    out
}

pub fn normalize_comment_block(snippet: &str) -> Option<String> {
    let mut out = Vec::new();
    let mut has_comment = false;
    for raw in snippet.lines() {
        let t = raw.trim();
        if t.is_empty() {
            continue;
        }
        let clean = strip_comment_prefix(t)?;
        has_comment = true;
        if !clean.is_empty() {
            out.push(format!("# {clean}"));
        }
    }
    has_comment.then(|| format!("{}\n", out.join("\n")))
}

pub fn strip_comment_prefix(t: &str) -> Option<String> {
    for (open, close) in [("/**", "*/"), ("/*", "*/"), ("<!--", "-->"), ("{#", "#}")] {
        if let Some(inner) = t.strip_prefix(open).and_then(|s| s.strip_suffix(close)) {
            return Some(inner.trim().trim_start_matches('*').trim().to_string());
        }
    }
    for pfx in ["///", "//!", "//", "--", "#"] {
        if let Some(rest) = t.strip_prefix(pfx) {
            if pfx == "#" && (rest.starts_with('[') || rest.starts_with('!')) {
                return None;
            }
            return Some(rest.trim().to_string());
        }
    }
    if matches!(t, "/*" | "*/" | "/**") || t.starts_with("* ") {
        return Some(t.trim_start_matches(['/', '*']).trim().to_string());
    }
    None
}

pub fn span_lines(sp: Span, starts: &[usize]) -> Option<(usize, usize)> {
    if sp.line == 0 {
        return None;
    }
    let end_b = sp.end_byte.saturating_sub(1).max(sp.start_byte);
    Some((sp.line, byte_to_line(starts, end_b).max(sp.line)))
}

pub(crate) fn find_sym_span(name: &str, syms: &[SymbolNode]) -> Option<(usize, usize)> {
    syms.iter()
        .find(|s| {
            s.name == name
                || s.qualified_name == name
                || s.qualified_name.ends_with(&format!("::{name}"))
        })
        .map(|s| (s.start_line, s.end_line))
}

pub(crate) fn find_text_span(src: &str, needle: &str) -> Option<(usize, usize)> {
    let first = needle.lines().next()?.trim();
    if first.is_empty() {
        return None;
    }
    let idx = src.lines().position(|l| l.trim().contains(first))?;
    let ln = idx + 1;
    Some((ln, ln + needle.lines().count().saturating_sub(1)))
}

pub fn item_line_range(
    item: &AiceItem,
    starts: &[usize],
    syms: &[SymbolNode],
    src: &str,
) -> Option<(usize, usize)> {
    match item {
        AiceItem::Import(v) => span_lines(v.span, starts),
        AiceItem::Type(v) => span_lines(v.span, starts),
        AiceItem::Enum(v) => span_lines(v.span, starts),
        AiceItem::Fn(v) => span_lines(v.span, starts),
        AiceItem::Const(v) => span_lines(v.span, starts),
        AiceItem::Var(v) => span_lines(v.span, starts),
        AiceItem::Component(v) => span_lines(v.span, starts),
        AiceItem::Style(v) => span_lines(v.span, starts),
        AiceItem::TokenSheet(v) => span_lines(v.span, starts),
        AiceItem::Data(v) => span_lines(v.span, starts),
        AiceItem::Directive { span, .. } => span_lines(*span, starts),
        AiceItem::Class(cls) => {
            let mut rng = span_lines(cls.span, starts);
            for m in &cls.methods {
                if let Some((ms, me)) = span_lines(m.span, starts) {
                    rng = Some(match rng {
                        Some((a, b)) => (a.min(ms), b.max(me)),
                        None => (ms, me),
                    });
                }
            }
            rng.or_else(|| find_sym_span(&cls.name, syms))
        }
        AiceItem::DbSchema(ds) => db_schema_range(ds, syms, src),
        AiceItem::DbQuery(dq) => db_query_range(dq, syms, src),
        AiceItem::Shell(sh) => shell_line_range(sh, syms, src),
        AiceItem::DbMigration(dm) => db_migration_line_range(dm, starts, syms, src),
        AiceItem::Doc(doc) => doc_section_line_range(doc, syms, src),
    }
}

fn db_query_range(dq: &DbQueryDecl, syms: &[SymbolNode], src: &str) -> Option<(usize, usize)> {
    let mut rng = dq.name.as_deref().and_then(|n| find_sym_span(n, syms));
    let mut merge = |s: usize, e: usize| {
        rng = Some(match rng { Some((a, b)) => (a.min(s), b.max(e)), None => (s, e) });
    };
    for (cname, body) in &dq.ctes {
        if let Some((s, e)) = find_sym_span(cname, syms).or_else(|| find_text_span(src, body)) { merge(s, e); }
    }
    for (_, v) in &dq.clauses {
        if let Some((s, e)) = find_text_span(src, v) { merge(s, e); }
    }
    rng
}

fn db_schema_range(ds: &DbSchemaDecl, syms: &[SymbolNode], src: &str) -> Option<(usize, usize)> {
    let nm = match ds {
        DbSchemaDecl::Table { name, .. }
        | DbSchemaDecl::View { name, .. }
        | DbSchemaDecl::Index { name, .. }
        | DbSchemaDecl::Procedure { name, .. }
        | DbSchemaDecl::Trigger { name, .. }
        | DbSchemaDecl::TypeDef { name, .. }
        | DbSchemaDecl::PrismaBlock { name, .. }
        | DbSchemaDecl::GraphQlType { name, .. } => name.as_str(),
        DbSchemaDecl::RawDdl { text, .. } => return find_text_span(src, text),
    };
    find_sym_span(nm, syms).or_else(|| find_text_span(src, nm))
}

pub fn contains_ident(hay: &str, name: &str, allow_member_dot: bool) -> bool {
    if name.is_empty() {
        return false;
    }
    hay.match_indices(name).any(|(idx, _)| {
        let prev = hay[..idx].chars().next_back();
        let before = prev.is_none_or(|c| !c.is_alphanumeric() && c != '_' && (allow_member_dot || c != '.'));
        let after = hay[idx + name.len()..].chars().next().is_none_or(|c| !c.is_alphanumeric() && c != '_');
        before && after
    })
}

pub fn parse_balanced_module(
    lang: LanguageId,
    slice: &str,
    registry: &EngineRegistry,
    transpiler: &dyn AiceTranspiler,
    opts: &TranspileOpts,
) -> Option<AiceModule> {
    let balanced = balance_closers_for_lang(lang, slice);
    let adapter = registry.adapter(lang)?;
    let tree = adapter.parse_cst(&balanced).ok()?;
    match transpiler.to_aice(&tree, &balanced, opts).ok()? {
        TranspileOutcome::Transpiled(m) if !m.items.is_empty() => Some(m),
        _ => None,
    }
}

pub fn wrap_method_for_lang(lang: LanguageId, slice: &str) -> String {
    match lang {
        LanguageId::Rust => format!("impl _W {{\n{slice}\n}}"),
        LanguageId::TypeScript
        | LanguageId::Tsx
        | LanguageId::JavaScript
        | LanguageId::Java
        | LanguageId::CSharp
        | LanguageId::Dart
        | LanguageId::Kotlin
        | LanguageId::Php => format!("class _W {{\n{slice}\n}}"),
        _ => slice.to_string(),
    }
}
