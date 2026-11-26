use std::path::Path;

use aice_ast_engine::DefaultSyntaxFirewall;
use aice_lang_registry::{FirewallVerdict, LanguageId, SymbolKind, SymbolNode, SyntaxFirewall};

fn skip_trivia_and_literals(b: &[u8], i: usize) -> Option<usize> {
    if b[i] == b'/' && b.get(i + 1) == Some(&b'/') {
        let mut j = i + 2;
        while j < b.len() && b[j] != b'\n' { j += 1; }
        return Some(j);
    }
    if b[i] == b'/' && b.get(i + 1) == Some(&b'*') {
        let mut j = i + 2;
        while j + 1 < b.len() && !(b[j] == b'*' && b[j + 1] == b'/') { j += 1; }
        return Some((j + 2).min(b.len()));
    }
    if matches!(b[i], b'"' | b'\'' | b'`') {
        let q = b[i];
        let mut j = i + 1;
        while j < b.len() {
            if b[j] == b'\\' && j + 1 < b.len() { j += 2; continue; }
            if b[j] == q { return Some(j + 1); }
            j += 1;
        }
        return Some(b.len());
    }
    None
}

fn is_ident_byte(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'$'
}

fn read_ident(src: &str, mut i: usize) -> Option<(&str, usize)> {
    let b = src.as_bytes();
    while i < b.len() && b[i].is_ascii_whitespace() { i += 1; }
    if i >= b.len() || !(b[i].is_ascii_alphabetic() || b[i] == b'_' || b[i] == b'$') {
        return None;
    }
    let s = i;
    while i < b.len() && is_ident_byte(b[i]) { i += 1; }
    Some((&src[s..i], i))
}

fn find_brace_body_end(b: &[u8], mut i: usize) -> Option<usize> {
    let (mut paren, mut brace) = (0usize, 0usize);
    while i < b.len() {
        if let Some(next) = skip_trivia_and_literals(b, i) { i = next; continue; }
        match b[i] {
            b'(' => paren += 1,
            b')' => paren = paren.saturating_sub(1),
            b'{' if paren == 0 || brace > 0 => brace += 1,
            b'}' if brace > 0 => {
                brace -= 1;
                if brace == 0 { return Some(i + 1); }
            }
            b';' if paren == 0 && brace == 0 => return Some(i + 1),
            _ => {}
        }
        i += 1;
    }
    None
}

fn find_stmt_end(b: &[u8], mut i: usize) -> Option<usize> {
    let (mut paren, mut brace, mut brack, mut saw_brace) = (0usize, 0usize, 0usize, false);
    while i < b.len() {
        if let Some(next) = skip_trivia_and_literals(b, i) { i = next; continue; }
        match b[i] {
            b'(' => paren += 1,
            b')' => paren = paren.saturating_sub(1),
            b'[' => brack += 1,
            b']' => brack = brack.saturating_sub(1),
            b'{' => { brace += 1; saw_brace = true; }
            b'}' if brace > 0 => {
                brace -= 1;
                if saw_brace && brace == 0 && paren == 0 && brack == 0 {
                    let mut j = i + 1;
                    while j < b.len() && matches!(b[j], b' ' | b'\t') { j += 1; }
                    return Some(if b.get(j) == Some(&b';') { j + 1 } else { i + 1 });
                }
            }
            b';' if paren == 0 && brace == 0 && brack == 0 => return Some(i + 1),
            _ => {}
        }
        i += 1;
    }
    None
}

fn line_at(src: &str, byte: usize) -> usize {
    src[..byte].bytes().filter(|&c| c == b'\n').count() + 1
}

fn scan_top_decls(src: &str, target: &str) -> Vec<SymbolNode> {
    let b = src.as_bytes();
    let (mut i, mut hits) = (0usize, Vec::new());
    let mut mod_start: Option<usize> = None;
    while i < b.len() {
        if b[i].is_ascii_whitespace() { i += 1; continue; }
        if let Some(next) = skip_trivia_and_literals(b, i) { i = next; continue; }
        if b[i].is_ascii_alphabetic() || b[i] == b'_' || b[i] == b'$' {
            let ws = i;
            while i < b.len() && is_ident_byte(b[i]) { i += 1; }
            let word = &src[ws..i];
            if matches!(word, "export" | "default" | "declare" | "async" | "abstract") {
                if mod_start.is_none() { mod_start = Some(ws); }
                continue;
            }
            let kind_opt = match word {
                "function" => Some((SymbolKind::Function, true)),
                "class" => Some((SymbolKind::Class, true)),
                "interface" => Some((SymbolKind::Interface, true)),
                "enum" => Some((SymbolKind::Enum, true)),
                "type" => Some((SymbolKind::Struct, false)),
                "const" | "let" | "var" => Some((SymbolKind::Function, false)),
                _ => None,
            };
            let decl_start = mod_start.take().unwrap_or(ws);
            if let Some((kind, brace_body)) = kind_opt {
                let mut pos = i;
                while pos < b.len() && (b[pos].is_ascii_whitespace() || (word == "function" && b[pos] == b'*')) {
                    pos += 1;
                }
                if let Some((name, after_name)) = read_ident(src, pos) && name == target {
                    let end = if brace_body { find_brace_body_end(b, after_name) } else { find_stmt_end(b, after_name) };
                    if let Some(end_byte) = end {
                        hits.push(SymbolNode {
                            name: name.to_string(),
                            qualified_name: name.to_string(),
                            kind,
                            start_byte: decl_start,
                            end_byte,
                            start_line: line_at(src, decl_start),
                            end_line: line_at(src, end_byte.saturating_sub(1)),
                            signature: None,
                        });
                        i = end_byte;
                        continue;
                    }
                }
            }
            continue;
        }
        mod_start = None;
        i += 1;
    }
    hits
}

pub fn find_prebroken_ts_symbol(
    src: &str,
    path: &Path,
    lang: LanguageId,
    target: &str,
    ordinal: Option<usize>,
) -> Option<SymbolNode> {
    if !matches!(lang, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript) {
        return None;
    }
    if !matches!(DefaultSyntaxFirewall.verify(src, path, lang), FirewallVerdict::Invalid { .. }) {
        return None;
    }
    let ord = ordinal.unwrap_or(1);
    if ord == 0 { return None; }
    let norm = target.trim().replace("::", ".");
    if let Some((cls, meth)) = norm.rsplit_once('.') {
        for container in scan_top_decls(src, cls) {
            let body = &src[container.start_byte..container.end_byte];
            if let Some(open) = body.find('{') {
                let mut m_hits = scan_class_methods(src, container.start_byte + open + 1, container.end_byte, cls, meth);
                if ord <= m_hits.len() { return Some(m_hits.swap_remove(ord - 1)); }
            }
        }
        return None;
    }
    let mut hits = scan_top_decls(src, &norm);
    (ord <= hits.len()).then(|| hits.swap_remove(ord - 1))
}

fn scan_class_methods(src: &str, start: usize, end: usize, cls: &str, meth: &str) -> Vec<SymbolNode> {
    let b = src.as_bytes();
    let (mut i, mut brace, mut hits) = (start, 0usize, Vec::new());
    let mut mod_start: Option<usize> = None;
    while i < end {
        if b[i].is_ascii_whitespace() { i += 1; continue; }
        if let Some(next) = skip_trivia_and_literals(b, i) { i = next.min(end); continue; }
        if b[i] == b'{' { brace += 1; mod_start = None; i += 1; continue; }
        if b[i] == b'}' { brace = brace.saturating_sub(1); mod_start = None; i += 1; continue; }
        if brace == 0 && (b[i].is_ascii_alphabetic() || b[i] == b'_' || b[i] == b'$') {
            let ws = i;
            while i < end && is_ident_byte(b[i]) { i += 1; }
            let word = &src[ws..i];
            if matches!(word, "public" | "private" | "protected" | "static" | "async" | "readonly" | "get" | "set") {
                if mod_start.is_none() { mod_start = Some(ws); }
                continue;
            }
            let decl_start = mod_start.take().unwrap_or(ws);
            let mut k = i;
            while k < end && b[k].is_ascii_whitespace() { k += 1; }
            if word == meth && b.get(k) == Some(&b'(') && let Some(eb) = find_brace_body_end(&b[..end], k) {
                hits.push(SymbolNode {
                    name: word.to_string(),
                    qualified_name: format!("{cls}.{word}"),
                    kind: SymbolKind::Method,
                    start_byte: decl_start,
                    end_byte: eb,
                    start_line: line_at(src, decl_start),
                    end_line: line_at(src, eb.saturating_sub(1)),
                    signature: None,
                });
                i = eb;
                continue;
            }
            continue;
        }
        mod_start = None;
        i += 1;
    }
    hits
}
