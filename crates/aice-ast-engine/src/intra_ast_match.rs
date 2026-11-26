use aice_lang_registry::IntraBlockKind;

pub(crate) fn else_if_label_matches(kind: IntraBlockKind, label: &str, pat: &str) -> bool {
    if kind != IntraBlockKind::Branch || !pat.eq_ignore_ascii_case("else_if") {
        return false;
    }
    let low = label.to_ascii_lowercase();
    ["else if", "elseif", "elif", "elsif"]
        .iter()
        .any(|kw| contains_word_unicode(&low, kw))
}

pub(crate) fn error_handler_sub_rank(label: &str) -> u8 {
    let low = label.trim_start().to_ascii_lowercase();
    let is_handler = [
        "catch", "except", "rescue", "__except", "on", "exception", "when", "declare",
        "begin catch",
    ]
    .iter()
    .any(|kw| starts_with_word(&low, kw))
        || contains_word_unicode(&low, "rescue")
        || (contains_word_unicode(&low, "on") && contains_word_unicode(&low, "catch"));
    if is_handler {
        return 0;
    }
    if ["finally", "__finally", "ensure", "defer"]
        .iter()
        .any(|kw| starts_with_word(&low, kw))
    {
        return 1;
    }
    2
}

fn starts_with_word(low: &str, kw: &str) -> bool {
    low.strip_prefix(kw)
        .is_some_and(|rest| rest.chars().next().is_none_or(|c| !is_word_char(c)))
}

pub(crate) fn label_word_matches(label: &str, pat: &str, case_sensitive: bool) -> bool {
    if pat.is_empty() {
        return false;
    }
    if case_sensitive {
        return contains_word_unicode(label, pat);
    }
    if label.is_ascii() && pat.is_ascii() {
        let (lb, pb) = (label.as_bytes(), pat.as_bytes());
        let mut start = 0;
        while start + pb.len() <= lb.len() {
            let Some(pos) = lb[start..]
                .windows(pb.len())
                .position(|w| w.eq_ignore_ascii_case(pb))
            else {
                return false;
            };
            let abs = start + pos;
            let b_ok = abs == 0 || !(lb[abs - 1].is_ascii_alphanumeric() || lb[abs - 1] == b'_');
            let after = abs + pb.len();
            let a_ok =
                after == lb.len() || !(lb[after].is_ascii_alphanumeric() || lb[after] == b'_');
            if b_ok && a_ok {
                return true;
            }
            start = abs + 1;
        }
        return false;
    }
    contains_word_unicode(&label.to_lowercase(), &pat.to_lowercase())
}

pub(crate) fn is_word_char(c: char) -> bool {
    c.is_alphanumeric()
        || c == '_'
        || matches!(
            c,
            '\u{0300}'..='\u{036F}' | '\u{1AB0}'..='\u{1AFF}' | '\u{1DC0}'..='\u{1DFF}'
                | '\u{20D0}'..='\u{20FF}' | '\u{FE20}'..='\u{FE2F}' | '\u{3099}'..='\u{309A}'
                | '\u{FE00}'..='\u{FE0F}' | '\u{0591}'..='\u{05BD}' | '\u{05BF}'
                | '\u{05C1}'..='\u{05C2}' | '\u{05C4}'..='\u{05C5}' | '\u{05C7}'
                | '\u{0610}'..='\u{061A}' | '\u{064B}'..='\u{065F}' | '\u{0670}'
                | '\u{06D6}'..='\u{06DC}' | '\u{06DF}'..='\u{06E4}' | '\u{06E7}'..='\u{06E8}'
                | '\u{06EA}'..='\u{06ED}' | '\u{0900}'..='\u{0903}' | '\u{093A}'..='\u{094F}'
                | '\u{0951}'..='\u{0957}' | '\u{0962}'..='\u{0963}'
        )
}

pub(crate) fn contains_word_unicode(hay: &str, needle: &str) -> bool {
    let mut start = 0;
    while start + needle.len() <= hay.len() {
        let Some(pos) = hay[start..].find(needle) else {
            return false;
        };
        let abs = start + pos;
        let after = abs + needle.len();
        let b_ok = hay[..abs].chars().next_back().is_none_or(|c| !is_word_char(c));
        let a_ok = hay[after..].chars().next().is_none_or(|c| !is_word_char(c));
        if b_ok && a_ok {
            return true;
        }
        start = abs + hay[abs..].chars().next().map_or(1, char::len_utf8);
    }
    false
}

pub(crate) fn pat_matches(haystack: &str, pat: &str, case_sensitive: bool) -> bool {
    if case_sensitive {
        haystack.contains(pat)
    } else if haystack.is_ascii() && pat.is_ascii() {
        let hb = haystack.as_bytes();
        let pb = pat.as_bytes();
        if pb.is_empty() || pb.len() > hb.len() {
            return pb.is_empty();
        }
        hb.windows(pb.len()).any(|w| w.eq_ignore_ascii_case(pb))
    } else {
        haystack.to_lowercase().contains(&pat.to_lowercase())
    }
}
