use crate::regex_mini::PatternMatch;
use crate::regex_parse::parse_regex;

#[derive(Debug, Clone)]
pub enum CharClassItem {
    Single(char),
    Range(char, char),
    Digit,
    Word,
    Space,
    NotDigit,
    NotWord,
    NotSpace,
}

#[derive(Debug, Clone)]
pub enum RegexAtom {
    Any,
    Lit(char),
    Digit,
    NotDigit,
    Word,
    NotWord,
    Space,
    NotSpace,
    Class { negated: bool, items: Vec<CharClassItem> },
}

#[derive(Debug, Clone)]
pub enum RegexNode {
    Atom(RegexAtom),
    AnchorStart,
    AnchorEnd,
    WordBoundary,
    NonWordBoundary,
    Repeat {
        node: Box<RegexNode>,
        min: usize,
        max: Option<usize>,
        greedy: bool,
    },
    Seq(Vec<RegexNode>),
    Alt(Vec<RegexNode>),
}

#[derive(Debug, Clone)]
pub struct CompiledPattern {
    pub raw: String,
    pub case_insensitive: bool,
    pub multiline: bool,
    pub is_literal: bool,
    pub ast: Option<RegexNode>,
}

pub fn parse_slash_regex(raw: &str) -> Result<(String, bool, bool), String> {
    let bytes = raw.as_bytes();
    if !bytes.starts_with(b"/") {
        return Err("Regex selector must start with '/'".to_string());
    }
    let mut i = 1usize;
    let mut in_class = false;
    let mut escaped = false;
    let mut close_idx = None;
    while i < bytes.len() {
        let b = bytes[i];
        if escaped {
            escaped = false;
            i += 1;
            continue;
        }
        match b {
            b'\\' => escaped = true,
            b'[' if !in_class => in_class = true,
            b']' if in_class => in_class = false,
            b'/' if !in_class => {
                close_idx = Some(i);
                break;
            }
            _ => {}
        }
        i += 1;
    }
    let Some(end) = close_idx else {
        return Err("Unclosed regex delimiter '/'".to_string());
    };
    let body = &raw[1..end];
    let flags = &raw[end + 1..];
    let (mut ci, mut ml) = (false, false);
    for ch in flags.chars() {
        match ch {
            'i' => ci = true,
            'm' => ml = true,
            'g' => {}
            _ => return Err(format!("Unsupported regex flag '{ch}'")),
        }
    }
    Ok((body.to_string(), ci, ml))
}

pub fn normalize_bre(raw: &str) -> String {
    let chars: Vec<char> = raw.chars().collect();
    let mut out = String::with_capacity(raw.len());
    let (mut i, mut in_class) = (0usize, false);
    while i < chars.len() {
        let ch = chars[i];
        if ch == '\\' && i + 1 < chars.len() {
            let next = chars[i + 1];
            if !in_class && matches!(next, '|' | '(' | ')') {
                out.push(next);
            } else {
                out.push('\\');
                out.push(next);
            }
            i += 2;
            continue;
        }
        if ch == '[' && !in_class {
            in_class = true;
        } else if ch == ']' && in_class {
            in_class = false;
        }
        out.push(ch);
        i += 1;
    }
    out
}

pub fn has_redos_risk(pat: &str) -> bool {
    if pat.len() > 512 {
        return true;
    }
    if pat.matches(".*").count() + pat.matches(".+").count() > 4 {
        return true;
    }
    let bytes = pat.as_bytes();
    let mut depth = 0usize;
    let mut inner_quant = [false; 32];
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'\\' {
            i += 2;
            continue;
        }
        match bytes[i] {
            b'(' => {
                depth = (depth + 1).min(31);
                inner_quant[depth] = false;
            }
            b')' => {
                let had_quant = inner_quant[depth];
                depth = depth.saturating_sub(1);
                if had_quant && matches!(bytes.get(i + 1), Some(b'*' | b'+' | b'{')) {
                    return true;
                }
                if had_quant {
                    inner_quant[depth] = true;
                }
            }
            b'*' | b'+' => inner_quant[depth] = true,
            _ => {}
        }
        i += 1;
    }
    false
}

pub fn compile_search_pattern(raw: &str, case_insensitive: bool) -> CompiledPattern {
    let normalized = normalize_bre(raw);
    if has_redos_risk(&normalized) {
        return CompiledPattern::literal(raw, case_insensitive, false);
    }
    match parse_regex(&normalized) {
        Ok(ast) => {
            let compiled = CompiledPattern {
                raw: raw.to_string(),
                case_insensitive,
                multiline: false,
                is_literal: false,
                ast: Some(ast),
            };
            if !raw.is_empty() && compiled.find_in_line("").is_some() {
                CompiledPattern::literal(raw, case_insensitive, false)
            } else {
                compiled
            }
        }
        Err(()) => CompiledPattern::literal(raw, case_insensitive, false),
    }
}

pub fn compile_slash_regex(raw: &str) -> Result<CompiledPattern, String> {
    let (body, ci, ml) = parse_slash_regex(raw)?;
    let normalized = normalize_bre(&body);
    if has_redos_risk(&normalized) {
        return Ok(CompiledPattern::literal(&body, ci, ml));
    }
    match parse_regex(&normalized) {
        Ok(ast) => Ok(CompiledPattern {
            raw: body,
            case_insensitive: ci,
            multiline: ml,
            is_literal: false,
            ast: Some(ast),
        }),
        Err(()) => Ok(CompiledPattern::literal(&body, ci, ml)),
    }
}

pub(crate) fn find_literal(hay: &str, needle: &str, ci: bool) -> Option<PatternMatch> {
    if needle.is_empty() {
        return Some(PatternMatch { start_byte: 0, end_byte: 0 });
    }
    if !ci {
        return hay.find(needle).map(|s| PatternMatch {
            start_byte: s,
            end_byte: s + needle.len(),
        });
    }
    if hay.is_ascii() && needle.is_ascii() {
        let (hb, nb) = (hay.as_bytes(), needle.as_bytes());
        return hb
            .windows(nb.len())
            .position(|w| w.eq_ignore_ascii_case(nb))
            .map(|s| PatternMatch {
                start_byte: s,
                end_byte: s + nb.len(),
            });
    }
    let mut low_h = String::with_capacity(hay.len());
    let mut low_start_to_orig: Vec<usize> = Vec::with_capacity(hay.len());
    let mut low_end_to_orig: Vec<usize> = Vec::with_capacity(hay.len());
    for (orig_s, ch) in hay.char_indices() {
        let orig_e = orig_s + ch.len_utf8();
        for lc in ch.to_lowercase() {
            let prev_len = low_h.len();
            low_h.push(lc);
            let added = low_h.len() - prev_len;
            low_start_to_orig.resize(low_start_to_orig.len() + added, orig_s);
            low_end_to_orig.resize(low_end_to_orig.len() + added, orig_e);
        }
    }
    let low_n = needle.to_lowercase();
    if low_n.is_empty() {
        return Some(PatternMatch { start_byte: 0, end_byte: 0 });
    }
    low_h.find(&low_n).and_then(|s| {
        let e = s + low_n.len();
        let start_byte = *low_start_to_orig.get(s)?;
        let end_byte = *low_end_to_orig.get(e - 1)?;
        Some(PatternMatch { start_byte, end_byte })
    })
}
