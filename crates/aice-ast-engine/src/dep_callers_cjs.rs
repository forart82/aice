use crate::dep_callers_js_scan::{
    is_valid_js_ident, split_top_level_commas, strip_top_level_default,
};
use crate::dep_callers_quote::{
    QuoteDepthTracker, StepKind, find_matching_open_brace, is_js_ident_char, mask_span,
    prev_non_ws_char, skip_ws_forward,
};
use crate::dep_callers_scan::{contains_word, push_binding, push_unique_sym};

struct AfterProp {
    prop: String,
    prop_line: usize,
    prop_end_col: usize,
    is_call: bool,
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn scan_cjs_requires(
    imp_lines: &[String],
    code_lines: &mut [String],
    target_stems: &[&str],
    imported: &mut Vec<String>,
    bindings: &mut Vec<(String, String)>,
    ns_aliases: &mut Vec<String>,
    direct_calls: &mut Vec<(String, usize)>,
) {
    let mut tr = QuoteDepthTracker::new();
    for (req_line, line) in imp_lines.iter().enumerate() {
        let mut iter = line.char_indices().peekable();
        while let Some((col, ch)) = iter.next() {
            if tr.quote.is_none()
                && ch == 'r'
                && line[col..].starts_with("require")
                && line[..col].chars().next_back().is_none_or(|c| !is_js_ident_char(c) && c != '.')
            {
                let after_kw = &line[col + 7..];
                let ws_len = after_kw.len() - after_kw.trim_start_matches([' ', '\t']).len();
                if after_kw[ws_len..].starts_with('(')
                    && let Some((el, ec)) =
                        find_matching_rparen(imp_lines, req_line, col + 7 + ws_len, tr.clone())
                {
                    handle_require_call(
                        imp_lines,
                        code_lines,
                        target_stems,
                        (req_line, col, col + 7 + ws_len),
                        (el, ec),
                        imported,
                        bindings,
                        ns_aliases,
                        direct_calls,
                    );
                }
            }
            let next = iter.peek().map(|&(_, n)| n);
            if tr.step(ch, next) == StepKind::EnterTemplate {
                iter.next();
            }
        }
        tr.end_line();
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_require_call(
    imp_lines: &[String],
    code_lines: &mut [String],
    target_stems: &[&str],
    req_pos: (usize, usize, usize),
    end_pos: (usize, usize),
    imported: &mut Vec<String>,
    bindings: &mut Vec<(String, String)>,
    ns_aliases: &mut Vec<String>,
    direct_calls: &mut Vec<(String, usize)>,
) {
    let (req_line, col, paren_col) = req_pos;
    let (end_line, end_col) = end_pos;
    let mut req_arg = String::new();
    for (li, l) in imp_lines.iter().enumerate().take(end_line + 1).skip(req_line) {
        let s = if li == req_line { paren_col + 1 } else { 0 };
        let e = if li == end_line { end_col } else { l.len() };
        if s <= e && e <= l.len() {
            if !req_arg.is_empty() { req_arg.push(' '); }
            req_arg.push_str(&l[s..e]);
        }
    }
    let is_target = target_stems.iter().any(|st| contains_word(&req_arg, st));
    let after_prop = read_after_prop(imp_lines, end_line, end_col);
    let eq_pos = prev_non_ws_char(imp_lines, req_line, col)
        .filter(|&(l, c, ch)| ch == '=' && is_assign_eq(&imp_lines[l], c));
    let lhs = eq_pos.and_then(|(el, ec, _)| prev_non_ws_char(imp_lines, el, ec));

    if let Some((cl, cc, ch)) = lhs {
        if ch == '}' {
            if let Some((ol, oc)) = find_matching_open_brace(imp_lines, cl, cc) {
                let (mel, mec) = match &after_prop {
                    Some(ap) if !ap.is_call || !is_target => (ap.prop_line, ap.prop_end_col),
                    _ => (end_line, end_col + 1),
                };
                mask_span(code_lines, ol, oc, mel, mec);
                if is_target {
                    extract_obj_bindings(
                        imp_lines,
                        (ol, oc, cl, cc),
                        after_prop.as_ref().filter(|ap| !ap.is_call),
                        imported,
                        bindings,
                    );
                }
                return;
            }
        } else if is_js_ident_char(ch)
            && let Some((id_start, local)) = trailing_ident(&imp_lines[cl][..cc + ch.len_utf8()])
        {
            match after_prop {
                Some(ap) if ap.is_call => {
                    mask_span(code_lines, cl, id_start, ap.prop_line, ap.prop_end_col);
                    if is_target {
                        push_unique_sym(imported, &ap.prop);
                        direct_calls.push((ap.prop, ap.prop_line + 1));
                    }
                }
                Some(ap) => {
                    mask_span(code_lines, cl, id_start, ap.prop_line, ap.prop_end_col);
                    if is_target {
                        push_binding(imported, bindings, &ap.prop, local);
                    }
                }
                None => {
                    mask_span(code_lines, cl, id_start, end_line, end_col + 1);
                    if is_target {
                        push_unique_sym(imported, "*");
                        push_unique_sym(ns_aliases, local);
                    }
                }
            }
            return;
        }
    }

    let (mel, mec) = match &after_prop {
        Some(ap) => (ap.prop_line, ap.prop_end_col),
        None => (end_line, end_col + 1),
    };
    mask_span(code_lines, req_line, col, mel, mec);
    if is_target && let Some(ap) = after_prop {
        push_unique_sym(imported, &ap.prop);
        direct_calls.push((ap.prop, ap.prop_line + 1));
    }
}

fn extract_obj_bindings(
    lines: &[String],
    span: (usize, usize, usize, usize),
    via_prop: Option<&AfterProp>,
    imported: &mut Vec<String>,
    bindings: &mut Vec<(String, String)>,
) {
    let (ol, oc, cl, cc) = span;
    if let Some(ap) = via_prop {
        push_unique_sym(imported, &ap.prop);
    }
    let mut inner = String::new();
    for (li, l) in lines.iter().enumerate().take(cl + 1).skip(ol) {
        let s = if li == ol { oc + 1 } else { 0 };
        let e = if li == cl { cc } else { l.len() };
        if s <= e && e <= l.len() {
            inner.push_str(&l[s..e]);
            inner.push(' ');
        }
    }
    for raw_item in split_top_level_commas(&inner) {
        let item = strip_top_level_default(raw_item).trim();
        if item.is_empty() { continue; }
        let (canon, local) = item
            .split_once(':')
            .map_or((item, item), |(lhs, rhs)| (lhs.trim(), rhs.trim()));
        if !is_valid_js_ident(canon) || !is_valid_js_ident(local) { continue; }
        push_binding(imported, bindings, canon, local);
        if let Some(ap) = via_prop {
            bindings.push((ap.prop.clone(), local.to_string()));
        }
    }
}

fn find_matching_rparen(
    lines: &[String],
    start_line: usize,
    paren_col: usize,
    mut tr: QuoteDepthTracker,
) -> Option<(usize, usize)> {
    let base = tr.parens;
    let limit = lines.len().min(start_line + 17);
    for (li, line) in lines.iter().enumerate().take(limit).skip(start_line) {
        let s = if li == start_line { paren_col } else { 0 };
        if s > line.len() || !line.is_char_boundary(s) { continue; }
        let mut iter = line[s..].char_indices().peekable();
        while let Some((rel, ch)) = iter.next() {
            let next = iter.peek().map(|&(_, n)| n);
            let kind = tr.step(ch, next);
            if kind == StepKind::EnterTemplate {
                iter.next();
                continue;
            }
            if kind == StepKind::Other && ch == ')' && tr.parens == base {
                return Some((li, s + rel));
            }
        }
        tr.end_line();
    }
    None
}

fn read_after_prop(lines: &[String], end_line: usize, end_col: usize) -> Option<AfterProp> {
    let (dl, dc, ch) = skip_ws_forward(lines, end_line, end_col + 1, 1)?;
    let (al, ac) = if ch == '.' {
        (dl, dc + 1)
    } else if ch == '?' && lines[dl][dc + 1..].starts_with('.') {
        (dl, dc + 2)
    } else {
        return None;
    };
    let (pl, ps, pch) = skip_ws_forward(lines, al, ac, 1)?;
    if !is_js_ident_char(pch) || pch.is_ascii_digit() { return None; }
    let mut pe = ps;
    for (rel, c) in lines[pl][ps..].char_indices() {
        if is_js_ident_char(c) { pe = ps + rel + c.len_utf8(); } else { break; }
    }
    let prop = lines[pl][ps..pe].to_string();
    let is_call = skip_ws_forward(lines, pl, pe, 1).is_some_and(|(_, _, c)| c == '(');
    Some(AfterProp { prop, prop_line: pl, prop_end_col: pe, is_call })
}

fn is_assign_eq(line: &str, col: usize) -> bool {
    let b = line.as_bytes();
    let prev_bad = col > 0
        && matches!(
            b[col - 1],
            b'=' | b'!' | b'<' | b'>' | b'+' | b'-' | b'*' | b'/' | b'%' | b'&' | b'|' | b'^' | b'?'
        );
    let next_bad = b.get(col + 1).is_some_and(|&n| matches!(n, b'=' | b'>'));
    !prev_bad && !next_bad
}

fn trailing_ident(prefix: &str) -> Option<(usize, &str)> {
    let mut start = prefix.len();
    for (idx, ch) in prefix.char_indices().rev() {
        if is_js_ident_char(ch) { start = idx; } else { break; }
    }
    (start < prefix.len() && !prefix[start..].starts_with(|c: char| c.is_ascii_digit()))
        .then_some((start, &prefix[start..]))
}
