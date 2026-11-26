use aice_lang_registry::LanguageId;

use crate::dep_callers_bash_ansi::{scan_bash_delim_ansi_sq, scan_bash_delim_dq};
use crate::dep_callers_quote::{QuoteDepthTracker, StepKind};

pub(crate) fn scan_bash_delim_sub(raw: &str, start_dollar: usize) -> Option<usize> {
    let mut tr = QuoteDepthTracker::new_for(LanguageId::Bash);
    let mut iter = raw[start_dollar..].char_indices().peekable();
    while let Some((rel, ch)) = iter.next() {
        let next = iter.peek().map(|&(_, n)| n);
        let kind = tr.step(ch, next);
        let mut end = start_dollar + rel + ch.len_utf8();
        if kind == StepKind::EnterTemplate && let Some((nrel, nch)) = iter.next() {
            end = start_dollar + nrel + nch.len_utf8();
        }
        if end > start_dollar + 1
            && tr.bash_paren_depth() == 0
            && tr.quote.is_none()
            && !tr.in_bash_bt()
            && tr.bash_param_depth() == 0
        {
            return Some(end);
        }
    }
    None
}

pub(crate) fn scan_bash_delim_param(raw: &str, start_dollar: usize) -> Option<usize> {
    let mut tr = QuoteDepthTracker::new_for(LanguageId::Bash);
    let mut iter = raw[start_dollar..].char_indices().peekable();
    while let Some((rel, ch)) = iter.next() {
        let next = iter.peek().map(|&(_, n)| n);
        let kind = tr.step(ch, next);
        let mut end = start_dollar + rel + ch.len_utf8();
        if kind == StepKind::EnterTemplate && let Some((nrel, nch)) = iter.next() {
            end = start_dollar + nrel + nch.len_utf8();
        }
        if end > start_dollar + 1
            && tr.bash_param_depth() == 0
            && tr.bash_paren_depth() == 0
            && tr.quote.is_none()
            && !tr.in_bash_bt()
        {
            return Some(end);
        }
    }
    None
}

pub(crate) fn scan_bash_delim_bt(raw: &str, start_bt: usize) -> Option<usize> {
    let mut tr = QuoteDepthTracker::new_for(LanguageId::Bash);
    let mut iter = raw[start_bt..].char_indices().peekable();
    while let Some((rel, ch)) = iter.next() {
        let next = iter.peek().map(|&(_, n)| n);
        let kind = tr.step(ch, next);
        let mut end = start_bt + rel + ch.len_utf8();
        if kind == StepKind::EnterTemplate && let Some((nrel, nch)) = iter.next() {
            end = start_bt + nrel + nch.len_utf8();
        }
        if !tr.in_bash_bt() && tr.quote.is_none() && tr.bash_paren_depth() == 0 && tr.bash_param_depth() == 0 {
            return Some(end);
        }
    }
    None
}

pub(crate) fn mask_tail_spaces(s: &mut String, start: usize) {
    if start < s.len() {
        let n = s.len() - start;
        s.truncate(start);
        for _ in 0..n {
            s.push(' ');
        }
    }
}

pub(crate) fn mask_imp_from_ltlt(imp: &mut String, exact_pos: Option<usize>) {
    if let Some(pos) = exact_pos.filter(|&p| p <= imp.len()).or_else(|| imp.rfind("<<")) {
        mask_tail_spaces(imp, pos);
    }
}

pub(crate) fn mask_bash_hd(
    in_hd: (bool, bool),
    was_hd: (bool, bool),
    imp: &mut String,
    code: &mut String,
    starts: (usize, usize),
) {
    if was_hd.0 || in_hd.0 {
        mask_tail_spaces(code, starts.1);
    }
    if was_hd.1 || in_hd.1 {
        mask_tail_spaces(imp, starts.0);
    }
}

pub(crate) fn try_parse_heredoc(
    lang: LanguageId,
    raw: &str,
    b: &[u8],
    start: usize,
) -> Option<(crate::dep_callers_heredoc::HeredocEntry, usize)> {
    use crate::dep_callers_heredoc::HeredocEntry;
    if !matches!(lang, LanguageId::Ruby | LanguageId::Bash)
        || start + 2 >= b.len()
        || b[start] != b'<'
        || b[start + 1] != b'<'
        || (start > 0 && b[start - 1] == b'<')
    {
        return None;
    }
    let mut j = start + 2;
    if b[j] == b'<' {
        return None;
    }
    let strip_ws = if b[j] == b'-' || (lang == LanguageId::Ruby && b[j] == b'~') {
        j += 1;
        true
    } else {
        false
    };
    if lang == LanguageId::Bash {
        while j < b.len() && matches!(b[j], b' ' | b'\t') {
            j += 1;
        }
    }
    if j >= b.len() {
        return None;
    }
    if lang == LanguageId::Ruby
        && start > 0
        && (matches!(
            b[start - 1],
            b'a'..=b'z'
                | b'A'..=b'Z'
                | b'0'..=b'9'
                | b'_'
                | b')'
                | b']'
                | b'}'
                | b'\''
                | b'"'
                | b'`'
                | b'?'
                | b'/'
        ) || (b[start - 1] == b'!'
            && start >= 2
            && (b[start - 2].is_ascii_alphanumeric() || b[start - 2] == b'_')))
    {
        return None;
    }
    let q = b[j];
    if lang == LanguageId::Ruby {
        if matches!(q, b'\'' | b'"' | b'`') {
            j += 1;
            let d_start = j;
            while j < b.len() && b[j] != q {
                j += 1;
            }
            if j >= b.len() || j == d_start {
                return None;
            }
            return Some((HeredocEntry { delim: raw[d_start..j].to_string(), strip_ws, quoted: true, bt_depth: 0, bt_mask: 0 }, j + 1));
        }
        if !(b[j].is_ascii_alphabetic() || b[j] == b'_') {
            return None;
        }
        let d_start = j;
        while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'_') {
            j += 1;
        }
        return Some((HeredocEntry { delim: raw[d_start..j].to_string(), strip_ws, quoted: false, bt_depth: 0, bt_mask: 0 }, j));
    }
    if b[j] == b'#' {
        return None;
    }
    let (mut delim, mut quoted, mut has_any) = (String::new(), false, false);
    while j < b.len() {
        match b[j] {
            b'\'' => {
                quoted = true;
                has_any = true;
                j += 1;
                let d_start = j;
                while j < b.len() && b[j] != b'\'' {
                    j += 1;
                }
                if j >= b.len() {
                    return None;
                }
                delim.push_str(&raw[d_start..j]);
                j += 1;
            }
            b'"' => {
                quoted = true;
                has_any = true;
                j = scan_bash_delim_dq(raw, j, &mut delim)?;
            }
            b'\\' => {
                quoted = true;
                has_any = true;
                if j + 1 >= b.len() {
                    return None;
                }
                let ch = raw[j + 1..].chars().next()?;
                delim.push(ch);
                j += 1 + ch.len_utf8();
            }
            b'$' if b.get(j + 1) == Some(&b'\'') => {
                quoted = true;
                has_any = true;
                let (nj, _) = scan_bash_delim_ansi_sq(raw, j, &mut delim)?;
                j = nj;
            }
            b'$' if b.get(j + 1) == Some(&b'"') => {
                quoted = true;
                has_any = true;
                j = scan_bash_delim_dq(raw, j + 1, &mut delim)?;
            }
            b'$' if b.get(j + 1) == Some(&b'(') => {
                has_any = true;
                let nj = scan_bash_delim_sub(raw, j)?;
                delim.push_str(&raw[j..nj]);
                j = nj;
            }
            b'$' if b.get(j + 1) == Some(&b'{') => {
                has_any = true;
                let nj = scan_bash_delim_param(raw, j)?;
                delim.push_str(&raw[j..nj]);
                j = nj;
            }
            b'`' => {
                has_any = true;
                let nj = scan_bash_delim_bt(raw, j)?;
                delim.push_str(&raw[j..nj]);
                j = nj;
            }
            c if !c.is_ascii_whitespace() && !matches!(c, b';' | b'&' | b'|' | b'<' | b'>' | b'(' | b')' | b'`') => {
                has_any = true;
                let ch = raw[j..].chars().next()?;
                delim.push(ch);
                j += ch.len_utf8();
            }
            _ => break,
        }
    }
    if !has_any || (delim.is_empty() && !quoted) {
        return None;
    }
    Some((HeredocEntry { delim, strip_ws, quoted, bt_depth: 0, bt_mask: 0 }, j))
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn try_step_heredoc(
    lang: LanguageId,
    raw: &str,
    b: &[u8],
    i: usize,
    bash: &mut crate::dep_callers_bash_strip::BashStripState,
    heredoc: &mut crate::dep_callers_heredoc::HeredocTracker,
    imp: &mut String,
    code: &mut String,
) -> Option<usize> {
    if lang == LanguageId::Bash {
        if bash.in_arith() || bash.active_braces() > 0 || bash.hd_q != 0 || bash.hd_sub.is_some() {
            return None;
        }
        if bash.trail_lt == 8 {
            if b[i] == b'<' { bash.trail_lt = 0; } else { return None; }
        }
        if b[i] == b'<' { bash.flush_ml_hd_if_ready(heredoc); }
    }
    let (entry, end_idx) = if lang == LanguageId::Bash && bash.bt_depth() > 0 {
        crate::dep_callers_heredoc::try_parse_bash_heredoc_in_bt(raw, i, bash.bt_depth(), bash.bt_unescape_mask())?
    } else {
        try_parse_heredoc(lang, raw, b, i)?
    };
    heredoc.pending.push(entry);
    if lang == LanguageId::Bash {
        bash.on_heredoc_token();
        for _ in i..end_idx { imp.push(' '); code.push(' '); }
    } else {
        imp.push_str(&raw[i..end_idx]);
        code.push_str(&raw[i..end_idx]);
    }
    Some(end_idx)
}
