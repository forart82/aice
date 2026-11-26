use crate::regex_compile::{CharClassItem, CompiledPattern, RegexAtom, RegexNode, find_literal};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PatternMatch {
    pub start_byte: usize,
    pub end_byte: usize,
}

const MAX_STEPS: usize = 80_000;

impl CompiledPattern {
    pub fn literal(raw: &str, case_insensitive: bool, multiline: bool) -> Self {
        Self {
            raw: raw.to_string(),
            case_insensitive,
            multiline,
            is_literal: true,
            ast: None,
        }
    }

    pub fn is_match(&self, text: &str) -> bool {
        if self.multiline || !self.is_literal {
            return text.lines().any(|line| self.find_in_line(line).is_some())
                || (text.is_empty() && self.find_in_line("").is_some());
        }
        self.find_in_line(text).is_some()
    }

    pub fn matching_lines(&self, text: &str) -> Vec<usize> {
        let mut out = Vec::new();
        for (idx, line) in text.lines().enumerate() {
            if self.find_in_line(line).is_some() {
                out.push(idx + 1);
            }
        }
        out
    }

    pub fn find_in_line(&self, line: &str) -> Option<PatternMatch> {
        if self.is_literal || self.ast.is_none() {
            return find_literal(line, &self.raw, self.case_insensitive);
        }
        let ast = self.ast.as_ref()?;
        let chars: Vec<(usize, char)> = line.char_indices().collect();
        let mut steps = 0usize;
        for pos in 0..=chars.len() {
            if let Some(end_pos) = match_node(ast, &chars, pos, self.case_insensitive, &mut steps) {
                let start_byte = chars.get(pos).map_or(line.len(), |x| x.0);
                let end_byte = chars.get(end_pos).map_or(line.len(), |x| x.0);
                return Some(PatternMatch { start_byte, end_byte });
            }
        }
        None
    }

    pub fn find_all_in_line(&self, line: &str) -> Vec<PatternMatch> {
        let mut out = Vec::new();
        let mut offset = 0usize;
        while offset <= line.len() {
            let sub = &line[offset..];
            let Some(m) = self.find_in_line(sub) else {
                break;
            };
            let abs_s = offset + m.start_byte;
            let abs_e = offset + m.end_byte;
            out.push(PatternMatch {
                start_byte: abs_s,
                end_byte: abs_e,
            });
            if abs_e > offset {
                offset = abs_e;
            } else if let Some(ch) = line[offset..].chars().next() {
                offset += ch.len_utf8();
            } else {
                break;
            }
        }
        out
    }
}

fn match_node(
    node: &RegexNode,
    chars: &[(usize, char)],
    pos: usize,
    ci: bool,
    steps: &mut usize,
) -> Option<usize> {
    let mut results = Vec::new();
    collect_matches(node, chars, pos, ci, steps, &mut results);
    results.into_iter().next()
}

fn collect_matches(
    node: &RegexNode,
    chars: &[(usize, char)],
    pos: usize,
    ci: bool,
    steps: &mut usize,
    out: &mut Vec<usize>,
) {
    if *steps >= MAX_STEPS {
        return;
    }
    *steps += 1;
    match node {
        RegexNode::AnchorStart => {
            if pos == 0 {
                out.push(pos);
            }
        }
        RegexNode::AnchorEnd => {
            if pos == chars.len() {
                out.push(pos);
            }
        }
        RegexNode::WordBoundary => {
            let prev = pos.checked_sub(1).and_then(|i| chars.get(i)).is_some_and(|x| is_word(x.1));
            let curr = chars.get(pos).is_some_and(|x| is_word(x.1));
            if prev != curr {
                out.push(pos);
            }
        }
        RegexNode::NonWordBoundary => {
            let prev = pos.checked_sub(1).and_then(|i| chars.get(i)).is_some_and(|x| is_word(x.1));
            let curr = chars.get(pos).is_some_and(|x| is_word(x.1));
            if prev == curr {
                out.push(pos);
            }
        }
        RegexNode::Atom(atom) => {
            if let Some(&(_, ch)) = chars.get(pos)
                && atom_matches(atom, ch, ci)
            {
                out.push(pos + 1);
            }
        }
        RegexNode::Alt(branches) => {
            for b in branches {
                collect_matches(b, chars, pos, ci, steps, out);
            }
        }
        RegexNode::Seq(items) => {
            collect_seq(items, 0, chars, pos, ci, steps, out);
        }
        RegexNode::Repeat {
            node: inner,
            min,
            max,
            greedy,
        } => {
            collect_repeat(inner, *min, *max, *greedy, 0, chars, pos, ci, steps, out);
        }
    }
}

fn collect_seq(
    items: &[RegexNode],
    idx: usize,
    chars: &[(usize, char)],
    pos: usize,
    ci: bool,
    steps: &mut usize,
    out: &mut Vec<usize>,
) {
    if *steps >= MAX_STEPS {
        return;
    }
    if idx == items.len() {
        out.push(pos);
        return;
    }
    let mut next_positions = Vec::new();
    collect_matches(&items[idx], chars, pos, ci, steps, &mut next_positions);
    for np in next_positions {
        collect_seq(items, idx + 1, chars, np, ci, steps, out);
    }
}

#[allow(clippy::too_many_arguments)]
fn collect_repeat(
    inner: &RegexNode,
    min: usize,
    max: Option<usize>,
    greedy: bool,
    count: usize,
    chars: &[(usize, char)],
    pos: usize,
    ci: bool,
    steps: &mut usize,
    out: &mut Vec<usize>,
) {
    if *steps >= MAX_STEPS {
        return;
    }
    if !greedy && count >= min {
        out.push(pos);
    }
    if max.is_none_or(|m| count < m) {
        let mut step_positions = Vec::new();
        collect_matches(inner, chars, pos, ci, steps, &mut step_positions);
        for np in step_positions {
            if np > pos || count < min {
                collect_repeat(inner, min, max, greedy, count + 1, chars, np, ci, steps, out);
            }
        }
    }
    if greedy && count >= min {
        out.push(pos);
    }
}

fn atom_matches(atom: &RegexAtom, ch: char, ci: bool) -> bool {
    match atom {
        RegexAtom::Any => ch != '\n',
        RegexAtom::Lit(t) => char_eq(ch, *t, ci),
        RegexAtom::Digit => ch.is_ascii_digit(),
        RegexAtom::NotDigit => !ch.is_ascii_digit(),
        RegexAtom::Word => is_word(ch),
        RegexAtom::NotWord => !is_word(ch),
        RegexAtom::Space => ch.is_whitespace(),
        RegexAtom::NotSpace => !ch.is_whitespace(),
        RegexAtom::Class { negated, items } => {
            let hit = items.iter().any(|it| match it {
                CharClassItem::Single(c) => char_eq(ch, *c, ci),
                CharClassItem::Range(a, b) => range_match(ch, *a, *b, ci),
                CharClassItem::Digit => ch.is_ascii_digit(),
                CharClassItem::Word => is_word(ch),
                CharClassItem::Space => ch.is_whitespace(),
                CharClassItem::NotDigit => !ch.is_ascii_digit(),
                CharClassItem::NotWord => !is_word(ch),
                CharClassItem::NotSpace => !ch.is_whitespace(),
            });
            if *negated { !hit } else { hit }
        }
    }
}

fn is_word(ch: char) -> bool {
    ch.is_alphanumeric() || ch == '_'
}

fn char_eq(a: char, b: char, ci: bool) -> bool {
    a == b || (ci && a.eq_ignore_ascii_case(&b))
}

fn range_match(ch: char, lo: char, hi: char, ci: bool) -> bool {
    if ch >= lo && ch <= hi {
        return true;
    }
    if ci {
        let lc = ch.to_ascii_lowercase();
        let uc = ch.to_ascii_uppercase();
        return (lc >= lo && lc <= hi) || (uc >= lo && uc <= hi);
    }
    false
}
