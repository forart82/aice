use aice_lang_registry::LanguageId;

use crate::dep_callers_other_ext::extract_other;
use crate::dep_callers_other_match::{match_other_kw, stmt_matches_target, validate_other_stmt};
use crate::dep_callers_quote::{
    MAX_IMPORT_SPAN_LINES, QuoteDepthTracker, StepKind, mask_span, skip_ws_forward,
};
use crate::dep_callers_scan::TargetLookup;

fn at_stmt_level(lang: LanguageId, tr: &QuoteDepthTracker) -> bool {
    tr.quote.is_none() && tr.brackets == 0 && (tr.parens == 0 || lang == LanguageId::Bash)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn scan_other_lang_imports(
    imp_work: &[String],
    code_lines: &mut [String],
    lang: LanguageId,
    targets: &TargetLookup<'_>,
    imported: &mut Vec<String>,
    bindings: &mut Vec<(String, String)>,
    ns_aliases: &mut Vec<String>,
    unqual_star: &mut bool,
) {
    use LanguageId as L;
    if !matches!(
        lang,
        L::Go | L::Java | L::Kotlin | L::CSharp | L::Php | L::Ruby | L::Dart | L::C | L::Cpp | L::Bash
    ) {
        return;
    }
    if matches!(lang, L::C | L::Cpp) {
        for (i, line) in imp_work.iter().enumerate() {
            if line.trim_start().starts_with("#include") {
                mask_span(code_lines, i, 0, i, line.len());
            }
        }
        if lang == L::C {
            return;
        }
    }

    let mut tr = QuoteDepthTracker::new_for(lang);
    let (mut li, mut min_col, mut boundary) = (0usize, 0usize, true);
    let nl_ends = matches!(lang, L::Go | L::Kotlin | L::Ruby | L::Bash);
    while li < imp_work.len() {
        let line = imp_work[li].as_str();
        let mut jumped = None;
        if min_col == 0 && at_stmt_level(lang, &tr) {
            if matches!(lang, L::C | L::Cpp | L::CSharp) && line.trim_start().starts_with('#') {
                while li < imp_work.len() && imp_work[li].trim_end().ends_with('\\') {
                    li += 1;
                }
                li += 1;
                continue;
            }
            if nl_ends {
                boundary = if lang == L::Bash { tr.bash_boundary() } else { true };
            }
        }
        if min_col < line.len() && line.is_char_boundary(min_col) {
            let mut iter = line[min_col..].char_indices().peekable();
            while let Some((rel, ch)) = iter.next() {
                let col = min_col + rel;
                let next = iter.peek().map(|&(_, n)| n);
                if lang == L::Php && at_stmt_level(lang, &tr) {
                    let tag_len = if line[col..].get(..5).is_some_and(|p| p.eq_ignore_ascii_case("<?php")) { 5 }
                        else if line[col..].starts_with("<?=") { 3 }
                        else if line[col..].starts_with("?>") { 2 }
                        else { 0 };
                    if tag_len > 0 {
                        for _ in 1..tag_len { iter.next(); }
                        boundary = true;
                        continue;
                    }
                }
                if at_stmt_level(lang, &tr)
                    && boundary
                    && let Some(kw) = match_other_kw(lang, &line[col..])
                    && let Some((el, ec, end_ch, stmt)) = collect_other_stmt(
                        imp_work,
                        li,
                        col,
                        kw,
                        lang,
                        (
                            tr.bash_bt_depth(),
                            tr.bash_bt_unescape_mask(),
                            tr.bash_esc_dq_layers(),
                        ),
                    )
                {
                    if validate_other_stmt(lang, kw, &stmt) {
                        mask_span(code_lines, li, col, el, ec);
                        if stmt_matches_target(lang, &stmt, targets) {
                            extract_other(
                                &stmt, lang, kw, targets.stems, targets.syms, targets.type_syms,
                                imported, bindings, ns_aliases, unqual_star,
                            );
                        }
                        tr.reset_after_stmt(lang == L::Bash);
                        if lang == L::Bash {
                            tr.bash_after_stmt(end_ch.is_some(), end_ch == Some(';'));
                            boundary = tr.bash_boundary();
                        } else {
                            boundary = end_ch.is_some();
                        }
                        jumped = Some((el, ec));
                        break;
                    }
                    if lang == L::Bash {
                        tr.bash_stmt_rejected();
                    }
                    boundary = false;
                }
                let kind = tr.step(ch, next);
                if kind == StepKind::EnterTemplate {
                    iter.next();
                    if lang == L::Bash {
                        boundary = tr.bash_boundary();
                    }
                    continue;
                }
                if kind == StepKind::ExitTemplate && lang == L::Bash {
                    boundary = tr.bash_boundary();
                    continue;
                }
                if at_stmt_level(lang, &tr) {
                    if lang == L::Bash {
                        boundary = tr.bash_boundary();
                    } else if matches!(ch, ';' | '{' | '}') {
                        boundary = true;
                    } else if !ch.is_whitespace() {
                        boundary = false;
                    }
                } else {
                    boundary = false;
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

fn collect_other_stmt(
    lines: &[String],
    start_line: usize,
    start_col: usize,
    kw: &str,
    lang: LanguageId,
    bash_ctx: (usize, u32, usize),
) -> Option<(usize, usize, Option<char>, String)> {
    use LanguageId as L;
    let (bash_bt_depth, bash_bt_mask, bash_dq_bt_layers) = bash_ctx;
    let mut tr = QuoteDepthTracker::new_for(lang);
    tr.set_bash_stmt_ctx(bash_bt_depth, bash_bt_mask, bash_dq_bt_layers);
    let mut stmt = String::new();
    let nl_ends = matches!(lang, L::Go | L::Kotlin | L::Ruby | L::Bash);
    let mut paren_group = false;
    let mut saw_kw = false;
    let limit = lines.len().min(start_line + MAX_IMPORT_SPAN_LINES);
    for (li, line) in lines.iter().enumerate().take(limit).skip(start_line) {
        let s = if li == start_line { start_col } else { 0 };
        if li > start_line {
            stmt.push('\n');
        }
        let mut iter = line[s..].char_indices().peekable();
        while let Some((rel, ch)) = iter.next() {
            let abs = s + rel;
            let was_top = tr.at_top_level();
            if lang == L::Bash && was_top && !tr.is_escaped() {
                if ch == ')' || (bash_bt_depth > 0 && ch == '`') {
                    return Some((li, abs, None, stmt));
                }
                if bash_bt_depth >= 2 && ch == '\\' && !line[s..abs].ends_with('\\') {
                    let bs = line[abs..].bytes().take_while(|&b| b == b'\\').count();
                    if line[abs + bs..].starts_with('`')
                        && ((bs + 1).trailing_zeros() as usize + 1) <= bash_bt_depth
                    {
                        return Some((li, abs, None, stmt));
                    }
                }
            }
            let was_q = tr.quote.is_some();
            let next = iter.peek().map(|&(_, n)| n);
            let kind = tr.step(ch, next);
            if lang == L::Bash
                && bash_bt_depth > 0
                && !tr.in_bash_bt()
                && ch == '`'
                && (was_q || !was_top)
                && tr.quote.is_none()
            {
                return None;
            }
            stmt.push(ch);
            if kind == StepKind::EnterTemplate {
                if let Some((_, c2)) = iter.next() {
                    stmt.push(c2);
                }
                continue;
            }
            if !saw_kw && stmt.len() >= kw.len() {
                saw_kw = true;
            }
            if saw_kw && matches!(lang, L::Go | L::Ruby) && was_top && ch == '(' {
                paren_group = true;
            }
            if lang == L::CSharp && was_top && ch == '{' {
                return None;
            }
            if lang == L::Php
                && !was_top
                && ch == '}'
                && tr.at_top_level()
                && !skip_ws_forward(lines, li, abs + 1, 4).is_some_and(|(_, _, c)| c == ';')
            {
                return None;
            }
            if paren_group && tr.at_top_level() && ch == ')' {
                return Some((li, abs + 1, None, stmt));
            }
            if tr.at_top_level() && (ch == ';' || (lang == L::Bash && matches!(ch, '&' | '|'))) {
                return Some((li, abs + 1, Some(ch), stmt));
            }
        }
        tr.end_line();
        if nl_ends && tr.at_top_level() && !(lang == L::Bash && line.trim_end().ends_with('\\')) {
            let kt_cont = lang == L::Kotlin && {
                let rest = stmt[kw.len()..].trim();
                let t = stmt.trim_end();
                let ends_as = t.strip_suffix("as").is_some_and(|p| p.ends_with(char::is_whitespace));
                let next_cont = skip_ws_forward(lines, li + 1, 0, limit - li - 1).is_some_and(
                    |(nl, nc, ch)| {
                        ch == '.'
                            || lines[nl][nc..]
                                .strip_prefix("as")
                                .is_some_and(|r| r.is_empty() || r.starts_with(char::is_whitespace))
                    },
                );
                rest.is_empty() || t.ends_with('.') || ends_as || next_cont
            };
            if !kt_cont {
                return Some((li, line.len(), Some('\n'), stmt));
            }
        }
    }
    None
}
