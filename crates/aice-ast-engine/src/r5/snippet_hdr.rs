use aice_lang_registry::LanguageId;

pub(crate) fn depth0_assign_pos(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    let (mut pd, mut bd, mut cd) = (0usize, 0usize, 0usize);
    for (i, &c) in b.iter().enumerate() {
        match c {
            b'(' => pd += 1,
            b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1,
            b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1,
            b'}' => cd = cd.saturating_sub(1),
            b'=' if pd == 0 && bd == 0 && cd == 0 => {
                let prev = i.checked_sub(1).and_then(|k| b.get(k)).copied();
                let next = b.get(i + 1).copied();
                if !matches!(prev, Some(b'=' | b'!' | b'<' | b'>')) && !matches!(next, Some(b'=' | b'>')) {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

pub(crate) fn has_depth0_assign(s: &str) -> bool {
    depth0_assign_pos(s).is_some()
}

pub(crate) fn has_depth0_arrow(s: &str) -> bool {
    let b = s.as_bytes();
    let (mut i, mut pd, mut bd, mut cd, mut ad) = (0usize, 0usize, 0usize, 0usize, 0usize);
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1,
            b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1,
            b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1,
            b'}' => cd = cd.saturating_sub(1),
            b'<' if pd == 0 && bd == 0 && cd == 0 => {
                if b.get(i + 1) == Some(&b'=') {
                    i += 2;
                    continue;
                }
                ad += 1;
            }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => {
                ad = ad.saturating_sub(1);
            }
            b'-' if pd == 0 && bd == 0 && cd == 0 && ad == 0 && b.get(i + 1) == Some(&b'>') => {
                return true;
            }
            _ => {}
        }
        i += 1;
    }
    false
}
pub(crate) fn is_rust_struct_lit_hdr(hdr_before_brace: &str, words: &[&str]) -> bool {
    let last_ok = hdr_before_brace
        .trim_end()
        .as_bytes()
        .last()
        .is_some_and(|&c| c.is_ascii_alphanumeric() || c == b'_' || c == b'>');
    if !last_ok || has_depth0_arrow(hdr_before_brace) {
        return false;
    }
    !words.iter().any(|w| {
        matches!(
            *w,
            "fn" | "struct" | "enum" | "union" | "trait" | "impl" | "mod" | "match"
                | "if" | "else" | "for" | "while" | "loop" | "where" | "macro_rules" | "extern" | "use"
        )
    }) && !words.last().is_some_and(|w| {
        matches!(*w, "unsafe" | "async" | "try" | "const" | "move" | "else" | "loop" | "do")
    })
}

pub(crate) fn is_rust_let_struct_pat(
    lang: LanguageId,
    hdr: &str,
    words: &[&str],
    has_assign: bool,
) -> bool {
    lang == LanguageId::Rust
        && !has_assign
        && words.contains(&"let")
        && words.iter().any(|w| matches!(*w, "if" | "while"))
        && hdr
            .trim_end()
            .as_bytes()
            .last()
            .is_some_and(|&c| c.is_ascii_alphanumeric() || c == b'_' || c == b'>')
}

pub(crate) fn is_cpp_lambda_hdr(lang: LanguageId, hdr: &str) -> bool {
    lang == LanguageId::Cpp
        && (depth0_assign_pos(hdr).is_some_and(|p| hdr[p + 1..].trim_start().starts_with('['))
            || hdr.contains("]("))
}

pub(crate) fn has_unclosed_rust_angle(s: &str) -> bool {
    let b = s.as_bytes();
    let (mut i, mut ad, mut in_type_alias, mut saw_eq) = (0usize, 0usize, false, false);
    let mut brack_semi: Vec<bool> = Vec::new();
    while i < b.len() {
        let in_arr_len = brack_semi.iter().any(|&x| x);
        match b[i] {
            b'[' => brack_semi.push(false),
            b']' => { brack_semi.pop(); }
            b';' => {
                if let Some(last) = brack_semi.last_mut() { *last = true; }
                else if ad == 0 { in_type_alias = false; saw_eq = false; }
            }
            b't' if ad == 0 && brack_semi.is_empty() && b[i..].starts_with(b"type")
                && (i == 0 || (!b[i - 1].is_ascii_alphanumeric() && !matches!(b[i - 1], b'_' | b'#')))
                && b.get(i + 4).is_none_or(|c| !c.is_ascii_alphanumeric() && *c != b'_') =>
            {
                in_type_alias = true;
            }
            b'=' if ad == 0 && brack_semi.is_empty() && !in_type_alias
                && !matches!(b.get(i + 1), Some(b'=' | b'>'))
                && (i == 0 || !matches!(b[i - 1], b'=' | b'!' | b'<' | b'>')) =>
            {
                saw_eq = true;
            }
            b'<' if !in_arr_len => {
                let turbo = b[..i]
                    .iter()
                    .rposition(|c| !c.is_ascii_whitespace())
                    .is_some_and(|p| p >= 1 && b[p - 1] == b':' && b[p] == b':');
                if !saw_eq || turbo {
                    if b.get(i + 1) == Some(&b'=') || (saw_eq && !turbo && b.get(i + 1) == Some(&b'<')) {
                        i += 2;
                        continue;
                    }
                    ad += 1;
                }
            }
            b'>' if !in_arr_len && (!saw_eq || ad > 0) && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => {
                ad = ad.saturating_sub(1);
            }
            _ => {}
        }
        i += 1;
    }
    ad > 0
}
pub(crate) fn ends_with_ts_generic_params(bt: &str) -> bool {
    let b = bt.as_bytes();
    if b.last() != Some(&b'>') || bt.ends_with("=>") {
        return false;
    }
    let (mut i, mut depth, mut lt_pos) = (b.len() - 1, 0isize, None);
    loop {
        if b[i] == b'>' && !(i > 0 && matches!(b[i - 1], b'=' | b'-')) {
            depth += 1;
        } else if b[i] == b'<' {
            depth -= 1;
            if depth == 0 {
                lt_pos = Some(i);
                break;
            }
            if depth < 0 {
                return false;
            }
        }
        if i == 0 { break; }
        i -= 1;
    }
    let Some(lt) = lt_pos else { return false; };
    let inner = bt[lt + 1..b.len() - 1].trim();
    if inner.is_empty()
        || !inner.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || matches!(c, '_' | '$'))
        || inner.contains("&&") || inner.contains("||") || inner.contains(';')
        || inner.contains("==") || inner.contains("!=")
    {
        return false;
    }
    let pre = bt[..lt].trim_end();
    if pre.is_empty() || pre.ends_with(['=', '(', '[', '{', '}', ';', ',', ':', '?']) || pre.ends_with("=>") {
        return true;
    }
    let last_word = pre
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '$')
        .next_back()
        .unwrap_or("");
    matches!(last_word, "return" | "yield" | "await" | "default" | "async" | "else" | "throw" | "export")
}
pub(crate) fn starts_with_js_cont(rest: &str) -> bool {
    let kw = rest.split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
    matches!(kw, "extends" | "implements" | "as" | "satisfies" | "in" | "instanceof")
        || matches!(rest.as_bytes().first(), Some(b':' | b'?' | b'&' | b'|' | b'>' | b'<' | b',' | b'.' | b'[' | b'=' | b'+' | b'-' | b'*' | b'/' | b'%' | b'^'))
        || rest.starts_with("!=")
}
pub(crate) fn trim_after_last_sep(s: &str) -> &str {
    let b = s.as_bytes();
    let (mut i, mut pd, mut bd, mut cd, mut ad, mut last, mut open_lbrace) =
        (0usize, 0usize, 0usize, 0usize, 0usize, 0usize, None);
    let mut ang_starts: Vec<usize> = Vec::new();
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1,
            b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1,
            b']' => bd = bd.saturating_sub(1),
            b'<' if pd == 0 && bd == 0 && cd == 0 => {
                if matches!(b.get(i + 1), Some(b'=' | b'<')) {
                    i += 2;
                    continue;
                }
                ad += 1;
                ang_starts.push(i + 1);
            }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => {
                if ad > 0 {
                    ad -= 1;
                    ang_starts.pop();
                }
            }
            b',' if pd == 0 && bd == 0 && cd == 0 && ad > 0 => {
                if let Some(top) = ang_starts.last_mut() { *top = i + 1; }
            }
            b'{' => {
                if pd == 0 && bd == 0 && cd == 0 {
                    if ad > 0 {
                        let pre = s[..i].trim_end();
                        let prev = pre.as_bytes().last().copied();
                        let prev2 = pre.len().checked_sub(2).map(|k| pre.as_bytes()[k]);
                        let is_ext = pre.ends_with("extends")
                            && pre[..pre.len() - 7].bytes().next_back()
                                .is_none_or(|c| !c.is_ascii_alphanumeric() && !matches!(c, b'_' | b'$'));
                        let is_eq_head = prev == Some(b'=')
                            && !matches!(prev2, Some(b'=' | b'!' | b'<' | b'>'))
                            && ang_starts.last().is_some_and(|&st| {
                                crate::r5::snippet_ts_gen_chk::is_valid_ts_type_param_head(&s[st..pre.len() - 1])
                            });
                        let is_arrow = pre.ends_with("=>")
                            && ang_starts.last().is_some_and(|&st| {
                                crate::r5::snippet_hdr_ts::is_ts_generic_arrow_lbrace(&s[st..pre.len() - 2])
                            });
                        if !matches!(prev, Some(b'<' | b',' | b'&' | b'|' | b'?' | b':' | b'$'))
                            && !is_ext
                            && !is_eq_head
                            && !is_arrow
                        {
                            ad = 0;
                            ang_starts.clear();
                        }
                    }
                    open_lbrace = Some(i + 1);
                }
                cd += 1;
            }
            b'}' => {
                cd = cd.saturating_sub(1);
                if pd == 0 && bd == 0 && cd == 0 {
                    let lb = open_lbrace;
                    open_lbrace = None;
                    let rest = s[i + 1..].trim_start();
                    let next = rest.as_bytes().first().copied();
                    let has_nl = s[i + 1..s.len() - rest.len()].contains('\n');
                    let is_ret_obj = next.is_none()
                        && lb.is_some_and(|p| p > last && crate::r5::snippet_hdr_ts::is_ts_ret_obj_lbrace(&s[last..p - 1]));
                    let is_cont = starts_with_js_cont(rest);
                    let var_no_asi = !has_nl && crate::r5::snippet_ts_gen_ctx::stmt_starts_var_decl(&s[last..i]);
                    if ad == 0 && !is_cont && !var_no_asi && !is_ret_obj { last = i + 1; }
                }
            }
            b';' if pd == 0 && bd == 0 && cd == 0 => { ad = 0; ang_starts.clear(); last = i + 1; }
            _ => {}
        }
        i += 1;
    }
    &s[open_lbrace.map_or(last, |p| p.max(last))..]
}