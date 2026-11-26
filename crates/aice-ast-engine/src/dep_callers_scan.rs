use std::collections::HashSet;

use aice_lang_registry::LanguageId;

use crate::dep_callers_cjs::scan_cjs_requires;
use crate::dep_callers_lang::{
    extract_js_imports, find_from_kw, is_export_from, is_js_import_start,
};
use crate::dep_callers_lang_scan::{scan_python_import_stmts, scan_rust_use_stmts};
use crate::dep_callers_other::scan_other_lang_imports;
use crate::dep_callers_other_match::collect_call_lines;
use crate::dep_callers_quote::{
    MAX_IMPORT_SPAN_LINES, QuoteDepthTracker, StepKind, is_js_ident_char, mask_span,
    skip_ws_forward,
};
use crate::dep_callers_strip::strip_comments_and_strings;

pub(crate) struct TargetLookup<'a> {
    pub(crate) stems: &'a [&'a str],
    pub(crate) leaf: Option<&'a str>,
    pub(crate) syms: &'a HashSet<&'a str>,
    pub(crate) type_syms: &'a HashSet<&'a str>,
    pub(crate) mod_qnames: &'a HashSet<String>,
}

pub(crate) fn scan_caller_source(
    src: &str,
    lang: LanguageId,
    targets: &TargetLookup<'_>,
) -> (Vec<String>, Vec<usize>) {
    let (imp_lines, mut code_lines) = strip_comments_and_strings(src, lang);
    let mut imp_work = imp_lines;
    let (mut imported, mut bindings, mut ns_aliases, mut direct_calls) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let mut unqual_star = false;

    if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript) {
        scan_js_esm_stmts(
            &mut imp_work,
            &mut code_lines,
            lang,
            targets.stems,
            &mut imported,
            &mut bindings,
            &mut ns_aliases,
            &mut unqual_star,
        );
        scan_cjs_requires(
            &imp_work,
            &mut code_lines,
            targets.stems,
            &mut imported,
            &mut bindings,
            &mut ns_aliases,
            &mut direct_calls,
        );
    } else if lang == LanguageId::Rust {
        scan_rust_use_stmts(
            &imp_work,
            &mut code_lines,
            targets.stems,
            &mut imported,
            &mut bindings,
            &mut ns_aliases,
            &mut unqual_star,
        );
    } else if lang == LanguageId::Python {
        scan_python_import_stmts(
            &imp_work,
            &mut code_lines,
            targets.stems,
            &mut imported,
            &mut bindings,
            &mut ns_aliases,
            &mut unqual_star,
        );
    } else {
        scan_other_lang_imports(
            &imp_work,
            &mut code_lines,
            lang,
            targets,
            &mut imported,
            &mut bindings,
            &mut ns_aliases,
            &mut unqual_star,
        );
    }

    let mut lines = collect_call_lines(
        &code_lines,
        lang,
        targets.leaf,
        targets.syms,
        &imported,
        &bindings,
        &ns_aliases,
        unqual_star,
    );
    for (sym, line_no) in &direct_calls {
        let matches = targets.leaf.map_or_else(
            || targets.syms.is_empty() || targets.syms.contains(sym.as_str()),
            |leaf| sym == leaf,
        );
        if matches && !lines.contains(line_no) {
            lines.push(*line_no);
        }
    }
    lines.sort_unstable();
    (imported, lines)
}

#[allow(clippy::too_many_arguments)]
fn scan_js_esm_stmts(
    imp_work: &mut [String],
    code_lines: &mut [String],
    lang: LanguageId,
    target_stems: &[&str],
    imported: &mut Vec<String>,
    bindings: &mut Vec<(String, String)>,
    ns_aliases: &mut Vec<String>,
    unqual_star: &mut bool,
) {
    let mut tr = QuoteDepthTracker::new();
    let (mut li, mut min_col) = (0usize, 0usize);
    while li < imp_work.len() {
        let line_len = imp_work[li].len();
        let mut jumped = None;
        if min_col < line_len && imp_work[li].is_char_boundary(min_col) {
            let line = imp_work[li].as_str();
            let mut iter = line[min_col..].char_indices().peekable();
            while let Some((rel, ch)) = iter.next() {
                let col = min_col + rel;
                if tr.at_top_level()
                    && (ch == 'i' || ch == 'e')
                    && line[..col].chars().next_back().is_none_or(|c| !is_js_ident_char(c) && c != '.')
                    && (is_js_import_start(&line[col..]) || is_export_from(&line[col..]))
                {
                    let (el, ec, stmt) = collect_single_esm_stmt(imp_work, li, col);
                    let spec = find_from_kw(&stmt).map_or(stmt.as_str(), |p| &stmt[p + 4..]);
                    if target_stems.iter().any(|st| contains_word(spec, st)) {
                        extract_js_imports(&stmt, lang, imported, bindings, ns_aliases, unqual_star);
                    }
                    mask_span(imp_work, li, col, el, ec);
                    mask_span(code_lines, li, col, el, ec);
                    tr = QuoteDepthTracker::new();
                    jumped = Some((el, ec));
                    break;
                }
                let next = iter.peek().map(|&(_, n)| n);
                if tr.step(ch, next) == StepKind::EnterTemplate {
                    iter.next();
                }
            }
        }
        if let Some((el, ec)) = jumped {
            li = el;
            min_col = ec;
        } else {
            tr.end_line();
            li += 1;
            min_col = 0;
        }
    }
}

fn collect_single_esm_stmt(lines: &[String], start_line: usize, start_col: usize) -> (usize, usize, String) {
    let mut tr = QuoteDepthTracker::new();
    let mut stmt = String::new();
    let is_import = is_js_import_start(&lines[start_line][start_col..]);
    let mut saw_brace_or_star = false;
    let limit = lines.len().min(start_line + MAX_IMPORT_SPAN_LINES);
    for (li, line) in lines.iter().enumerate().take(limit).skip(start_line) {
        let s = if li == start_line { start_col } else { 0 };
        if li > start_line {
            stmt.push('\n');
        }
        let mut iter = line[s..].char_indices().peekable();
        while let Some((rel, ch)) = iter.next() {
            let abs = s + rel;
            let prev_q = tr.quote;
            let next = iter.peek().map(|&(_, n)| n);
            let kind = tr.step(ch, next);
            stmt.push(ch);
            if kind == StepKind::EnterTemplate {
                if let Some((_, c2)) = iter.next() {
                    stmt.push(c2);
                }
                continue;
            }
            if (kind == StepKind::OpenBrace && tr.braces == 1 && tr.parens == 0)
                || (kind == StepKind::Other && ch == '*' && tr.at_top_level())
            {
                saw_brace_or_star = true;
            }
            if !tr.at_top_level() {
                continue;
            }
            if ch == ';' {
                return (li, abs + 1, stmt);
            }
            if prev_q.is_some()
                && (find_from_kw(&stmt).is_some() || (is_import && !saw_brace_or_star))
                && !line[abs + 1..].trim_start().starts_with(';')
            {
                return (li, abs + 1, stmt);
            }
            if kind == StepKind::CloseBrace && find_from_kw(&stmt).is_none() {
                let is_semi_or_from = skip_ws_forward(lines, li, abs + 1, 2)
                    .is_some_and(|(nl, nc, c)| c == ';' || has_from_ahead(&lines[nl][nc..]));
                if !is_semi_or_from {
                    return (li, abs + 1, stmt);
                }
            }
        }
        tr.end_line();
    }
    let last = limit - 1;
    (last, lines[last].len(), stmt)
}

fn has_from_ahead(rest: &str) -> bool {
    let Some(after) = rest.strip_prefix("from") else { return false };
    after.is_empty() || after.starts_with(|c: char| c.is_whitespace() || matches!(c, '\'' | '"'))
}

pub(crate) fn push_binding(imported: &mut Vec<String>, bindings: &mut Vec<(String, String)>, canon: &str, local: &str) {
    push_unique_sym(imported, canon);
    if !canon.is_empty() && !local.is_empty() {
        bindings.push((canon.to_string(), local.to_string()));
    }
}

pub(crate) fn push_unique_sym(out: &mut Vec<String>, name: &str) {
    if !name.is_empty() && !out.iter().any(|x| x == name) {
        out.push(name.to_string());
    }
}

pub(crate) fn contains_word(haystack: &str, word: &str) -> bool {
    if word.is_empty() {
        return false;
    }
    let mut start = 0;
    while let Some(pos) = haystack[start..].find(word) {
        let abs = start + pos;
        let b_ok = haystack[..abs].chars().next_back().is_none_or(|c| !c.is_alphanumeric() && c != '_');
        let after = abs + word.len();
        let a_ok = haystack[after..].chars().next().is_none_or(|c| !c.is_alphanumeric() && c != '_');
        if b_ok && a_ok {
            return true;
        }
        start = abs + haystack[abs..].chars().next().map_or(1, char::len_utf8);
    }
    false
}
