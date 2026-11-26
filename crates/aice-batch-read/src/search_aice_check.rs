use aice_lang_registry::ParsedTree;

use crate::regex_compile::CompiledPattern;
use crate::search_rank::SearchHit;

pub(crate) fn collect_multiline_literal_spans(tree: &ParsedTree) -> Vec<(usize, usize)> {
    let ParsedTree::TreeSitter { tree: mtx, .. } = tree else {
        return Vec::new();
    };
    let Ok(guard) = mtx.lock() else {
        return Vec::new();
    };
    let mut spans = Vec::new();
    let mut stack = vec![guard.root_node()];
    while let Some(node) = stack.pop() {
        let start_line = node.start_position().row + 1;
        let end_line = node.end_position().row + 1;
        if end_line > start_line && is_multiline_literal_kind(node.kind()) {
            spans.push((start_line, end_line));
            continue;
        }
        if end_line > start_line {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if child.end_position().row > child.start_position().row {
                    stack.push(child);
                }
            }
        }
    }
    spans
}

fn is_multiline_literal_kind(kind: &str) -> bool {
    matches!(
        kind,
        "template_string"
            | "string"
            | "string_literal"
            | "interpreted_string_literal"
            | "raw_string_literal"
            | "multiline_string_literal"
            | "verbatim_string_literal"
            | "heredoc_body"
            | "heredoc"
            | "nowdoc"
            | "nowdoc_body"
    )
}

pub(crate) fn window_cuts_matched_multiline_literal(
    hit: &SearchHit,
    spans: &[(usize, usize)],
    s: usize,
    e: usize,
) -> bool {
    if spans.is_empty() {
        return false;
    }
    hit.matched_lines.iter().copied().filter(|&ln| ln >= s && ln <= e).any(|ln| {
        spans
            .iter()
            .any(|&(ls, le)| ln >= ls && ln <= le && (ls < s || le > e))
    })
}

pub(crate) fn preserves_matched_lines(
    hit: &SearchHit,
    lines: &[&str],
    s: usize,
    e: usize,
    cleaned: &str,
    compiled: Option<&CompiledPattern>,
) -> bool {
    let cleaned_low = cleaned.to_ascii_lowercase();
    for ln in hit.matched_lines.iter().copied().filter(|&ln| ln >= s && ln <= e).take(64) {
        let Some(&raw_line) = lines.get(ln.saturating_sub(1)) else {
            continue;
        };
        if raw_line.trim().is_empty() {
            continue;
        }
        if let Some(pat) = compiled
            && let Some(m) = pat.find_in_line(raw_line)
            && m.start_byte < m.end_byte
        {
            let matched = &raw_line[m.start_byte..m.end_byte];
            let match_toks = extract_substantive_tokens(matched);
            if !match_toks.is_empty() {
                if !match_toks.iter().any(|tok| cleaned_low.contains(tok)) {
                    return false;
                }
                continue;
            }
        }
        let line_toks = extract_substantive_tokens(raw_line);
        if !line_toks.is_empty() && !line_toks.iter().any(|tok| cleaned_low.contains(tok)) {
            return false;
        }
    }
    true
}

fn extract_substantive_tokens(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for ch in text.chars() {
        if ch.is_alphanumeric() || ch == '_' {
            cur.push(ch.to_ascii_lowercase());
        } else if !cur.is_empty() {
            push_if_substantive(&mut out, &cur);
            cur.clear();
        }
    }
    if !cur.is_empty() {
        push_if_substantive(&mut out, &cur);
    }
    out
}

fn push_if_substantive(out: &mut Vec<String>, tok: &str) {
    if tok.len() >= 2 && !is_rewritten_keyword(tok) && !out.iter().any(|existing| existing == tok) {
        out.push(tok.to_string());
    }
}

fn is_rewritten_keyword(tok: &str) -> bool {
    matches!(
        tok,
        "export" | "public" | "private" | "protected" | "internal" | "readonly" | "static"
            | "final" | "abstract" | "sealed" | "override" | "virtual" | "extern" | "async"
            | "await" | "function" | "def" | "func" | "fun" | "fn" | "class" | "struct"
            | "interface" | "trait" | "enum" | "type" | "const" | "let" | "var" | "val"
            | "mut" | "return" | "this" | "self" | "super" | "import" | "from" | "require"
            | "include" | "package" | "namespace" | "module" | "mod" | "use" | "pub" | "impl"
            | "create" | "table" | "view" | "select" | "insert" | "update" | "delete"
            | "where" | "into" | "values" | "join" | "alter" | "drop" | "index" | "trigger"
            | "procedure" | "begin" | "end" | "then" | "elif" | "elsif" | "elseif" | "switch"
            | "case" | "default" | "break" | "continue" | "try" | "catch" | "finally"
            | "throw" | "throws" | "new" | "void" | "null" | "nil" | "none" | "true" | "false"
            | "and" | "or" | "not" | "in" | "is" | "as" | "of" | "with" | "yield" | "pass"
            | "if" | "else" | "for" | "while" | "do" | "match" | "loop" | "extends"
            | "implements" | "declare" | "typeof" | "keyof" | "data" | "object" | "companion"
            | "local" | "fi" | "esac" | "done" | "string" | "number" | "boolean" | "integer"
            | "float" | "double" | "str" | "int" | "bool"
    )
}

pub(crate) fn looks_like_type_header(win_src: &str) -> bool {
    let t = win_src.trim();
    [
        "class ", "struct ", "impl ", "interface ", "trait ", "enum ", "type ", "model ",
        "record ", "object ", "protocol ", "extension ",
    ]
    .iter()
    .any(|kw| t.contains(kw))
}

pub(crate) fn is_type_header_aice(line: &str) -> bool {
    let t = line.trim();
    t.ends_with(':')
        && [
            "class ", "pub class ", "struct ", "pub struct ", "type ", "pub type ",
            "interface ", "pub interface ",
        ]
        .iter()
        .any(|p| t.starts_with(p))
}
