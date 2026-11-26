use crate::regex_compile::{CharClassItem, RegexAtom, RegexNode};

pub(crate) fn parse_regex(pat: &str) -> Result<RegexNode, ()> {
    let chars: Vec<char> = pat.chars().collect();
    let mut pos = 0usize;
    let node = parse_alt(&chars, &mut pos)?;
    if pos != chars.len() {
        return Err(());
    }
    Ok(node)
}

fn parse_alt(c: &[char], pos: &mut usize) -> Result<RegexNode, ()> {
    let mut branches = vec![parse_seq(c, pos)?];
    while *pos < c.len() && c[*pos] == '|' {
        *pos += 1;
        branches.push(parse_seq(c, pos)?);
    }
    Ok(if branches.len() == 1 {
        branches.pop().ok_or(())?
    } else {
        RegexNode::Alt(branches)
    })
}

fn parse_seq(c: &[char], pos: &mut usize) -> Result<RegexNode, ()> {
    let mut items = Vec::new();
    while *pos < c.len() && !matches!(c[*pos], '|' | ')') {
        let atom = parse_atom(c, pos)?;
        let node = parse_quantifier(c, pos, atom)?;
        items.push(node);
    }
    Ok(if items.len() == 1 {
        items.pop().ok_or(())?
    } else {
        RegexNode::Seq(items)
    })
}

fn parse_atom(c: &[char], pos: &mut usize) -> Result<RegexNode, ()> {
    let ch = c[*pos];
    *pos += 1;
    match ch {
        '^' => Ok(RegexNode::AnchorStart),
        '$' => Ok(RegexNode::AnchorEnd),
        '.' => Ok(RegexNode::Atom(RegexAtom::Any)),
        '*' | '+' | '?' | '{' => Err(()),
        '(' => {
            if *pos + 1 < c.len() && c[*pos] == '?' && c[*pos + 1] == ':' {
                *pos += 2;
            }
            let inner = parse_alt(c, pos)?;
            if *pos >= c.len() || c[*pos] != ')' {
                return Err(());
            }
            *pos += 1;
            Ok(inner)
        }
        '[' => parse_char_class(c, pos),
        '\\' => parse_escape(c, pos),
        other => Ok(RegexNode::Atom(RegexAtom::Lit(other))),
    }
}

fn parse_escape(c: &[char], pos: &mut usize) -> Result<RegexNode, ()> {
    if *pos >= c.len() {
        return Err(());
    }
    let ch = c[*pos];
    *pos += 1;
    Ok(match ch {
        'b' => RegexNode::WordBoundary,
        'B' => RegexNode::NonWordBoundary,
        'd' => RegexNode::Atom(RegexAtom::Digit),
        'D' => RegexNode::Atom(RegexAtom::NotDigit),
        'w' => RegexNode::Atom(RegexAtom::Word),
        'W' => RegexNode::Atom(RegexAtom::NotWord),
        's' => RegexNode::Atom(RegexAtom::Space),
        'S' => RegexNode::Atom(RegexAtom::NotSpace),
        'n' => RegexNode::Atom(RegexAtom::Lit('\n')),
        't' => RegexNode::Atom(RegexAtom::Lit('\t')),
        'r' => RegexNode::Atom(RegexAtom::Lit('\r')),
        other => RegexNode::Atom(RegexAtom::Lit(other)),
    })
}

fn parse_char_class(c: &[char], pos: &mut usize) -> Result<RegexNode, ()> {
    let negated = *pos < c.len() && c[*pos] == '^';
    if negated {
        *pos += 1;
    }
    let mut items = Vec::new();
    let mut first = true;
    while *pos < c.len() && (first || c[*pos] != ']') {
        first = false;
        let item = parse_class_item(c, pos)?;
        if let CharClassItem::Single(start) = item
            && *pos + 1 < c.len()
            && c[*pos] == '-'
            && c[*pos + 1] != ']'
        {
            *pos += 1;
            if let CharClassItem::Single(end) = parse_class_item(c, pos)? {
                if start > end {
                    return Err(());
                }
                items.push(CharClassItem::Range(start, end));
                continue;
            }
            return Err(());
        }
        items.push(item);
    }
    if *pos >= c.len() || c[*pos] != ']' || items.is_empty() {
        return Err(());
    }
    *pos += 1;
    Ok(RegexNode::Atom(RegexAtom::Class { negated, items }))
}

fn parse_class_item(c: &[char], pos: &mut usize) -> Result<CharClassItem, ()> {
    if *pos >= c.len() {
        return Err(());
    }
    let ch = c[*pos];
    *pos += 1;
    if ch == '\\' {
        if *pos >= c.len() {
            return Err(());
        }
        let esc = c[*pos];
        *pos += 1;
        return Ok(match esc {
            'd' => CharClassItem::Digit,
            'D' => CharClassItem::NotDigit,
            'w' => CharClassItem::Word,
            'W' => CharClassItem::NotWord,
            's' => CharClassItem::Space,
            'S' => CharClassItem::NotSpace,
            'n' => CharClassItem::Single('\n'),
            't' => CharClassItem::Single('\t'),
            'r' => CharClassItem::Single('\r'),
            other => CharClassItem::Single(other),
        });
    }
    Ok(CharClassItem::Single(ch))
}

fn parse_quantifier(c: &[char], pos: &mut usize, node: RegexNode) -> Result<RegexNode, ()> {
    if *pos >= c.len() {
        return Ok(node);
    }
    let (min, max) = match c[*pos] {
        '*' => {
            *pos += 1;
            (0, None)
        }
        '+' => {
            *pos += 1;
            (1, None)
        }
        '?' => {
            *pos += 1;
            (0, Some(1))
        }
        '{' => {
            let save = *pos;
            if let Some(bounds) = parse_brace_bounds(c, pos) {
                bounds
            } else {
                *pos = save;
                return Ok(node);
            }
        }
        _ => return Ok(node),
    };
    if matches!(
        node,
        RegexNode::AnchorStart
            | RegexNode::AnchorEnd
            | RegexNode::WordBoundary
            | RegexNode::NonWordBoundary
    ) {
        return Err(());
    }
    let greedy = if *pos < c.len() && c[*pos] == '?' {
        *pos += 1;
        false
    } else {
        true
    };
    Ok(RegexNode::Repeat {
        node: Box::new(node),
        min,
        max,
        greedy,
    })
}

fn parse_brace_bounds(c: &[char], pos: &mut usize) -> Option<(usize, Option<usize>)> {
    let mut i = *pos + 1;
    let start = i;
    while i < c.len() && c[i].is_ascii_digit() {
        i += 1;
    }
    if i == start {
        return None;
    }
    let min: usize = c[start..i].iter().collect::<String>().parse().ok()?;
    let max = if i < c.len() && c[i] == ',' {
        i += 1;
        let max_start = i;
        while i < c.len() && c[i].is_ascii_digit() {
            i += 1;
        }
        if i == max_start {
            None
        } else {
            let m: usize = c[max_start..i].iter().collect::<String>().parse().ok()?;
            if m < min {
                return None;
            }
            Some(m)
        }
    } else {
        Some(min)
    };
    if i >= c.len() || c[i] != '}' {
        return None;
    }
    *pos = i + 1;
    Some((min, max))
}
