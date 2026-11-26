use aice_lang_registry::{IntraBlockSelector, SymbolSelector};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TargetSelector {
    Full,
    Outline,
    Imports,
    Symbol(SymbolSelector),
    IntraBlock(IntraBlockSelector),
    LineRange { start: usize, end: usize },
    InvertedLineRange { start: usize, end: usize },
    Regex(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedTargetSpec {
    pub file_path: String,
    pub selectors: Vec<TargetSelector>,
}

pub fn parse_target_spec(raw: &str) -> ParsedTargetSpec {
    let (file, sel_opt) = aice_governance::split_target_selector(raw);
    match sel_opt {
        Some(sel_part) => {
            let selectors = split_comma_selectors(sel_part)
                .into_iter()
                .map(classify_selector)
                .collect();
            ParsedTargetSpec {
                file_path: file.to_string(),
                selectors,
            }
        }
        None => ParsedTargetSpec {
            file_path: raw.to_string(),
            selectors: vec![TargetSelector::Full],
        },
    }
}

pub fn split_comma_selectors(raw: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut in_quote: Option<char> = None;
    let mut in_regex = false;
    let mut in_class = false;
    let mut escaped = false;
    for ch in raw.chars() {
        if escaped {
            escaped = false;
            current.push(ch);
            continue;
        }
        if let Some(q) = in_quote {
            if ch == '\\' {
                escaped = true;
            } else if ch == q {
                in_quote = None;
            }
            current.push(ch);
            continue;
        }
        if in_regex {
            match ch {
                '\\' => escaped = true,
                '[' if !in_class => in_class = true,
                ']' if in_class => in_class = false,
                '/' if !in_class => in_regex = false,
                _ => {}
            }
            current.push(ch);
            continue;
        }
        match ch {
            '\'' | '"' => {
                in_quote = Some(ch);
                current.push(ch);
            }
            '/' => {
                in_regex = true;
                current.push(ch);
            }
            ',' => {
                if !current.is_empty() {
                    out.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(ch),
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

fn parse_line_num(s: &str, require_l_prefix: bool) -> Option<usize> {
    let digits = if let Some(rest) = s.strip_prefix('L').or_else(|| s.strip_prefix('l')) {
        rest
    } else if require_l_prefix {
        return None;
    } else {
        s
    };
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse::<usize>().ok()
}

fn try_parse_line_range(s: &str) -> Option<TargetSelector> {
    let trimmed = s.trim();
    if let Some((lhs, rhs)) = trimmed.split_once('-') {
        let start = parse_line_num(lhs.trim(), false)?;
        let end = parse_line_num(rhs.trim(), false)?;
        if start == 0 || end == 0 || start > end {
            return Some(TargetSelector::InvertedLineRange { start, end });
        }
        return Some(TargetSelector::LineRange { start, end });
    }
    if let Some(line) = parse_line_num(trimmed, true) {
        if line == 0 {
            return Some(TargetSelector::InvertedLineRange { start: 0, end: 0 });
        }
        return Some(TargetSelector::LineRange {
            start: line,
            end: line,
        });
    }
    None
}

fn classify_selector(s: String) -> TargetSelector {
    if s == "outline" {
        return TargetSelector::Outline;
    }
    if s == "imports" {
        return TargetSelector::Imports;
    }
    if s.starts_with('/') {
        return TargetSelector::Regex(s);
    }
    if let Some(lr) = try_parse_line_range(&s) {
        return lr;
    }
    if let Some((sym_part, pat_part)) = s.split_once('@')
        && !sym_part.is_empty()
        && !pat_part.is_empty()
    {
        if pat_part == "first" {
            return TargetSelector::Symbol(SymbolSelector {
                name: sym_part.to_string(),
                ordinal: Some(1),
            });
        }
        if pat_part.bytes().all(|b| b.is_ascii_digit()) {
            let ord = pat_part.parse::<usize>().unwrap_or(0);
            return TargetSelector::Symbol(SymbolSelector {
                name: sym_part.to_string(),
                ordinal: Some(ord),
            });
        }
        return TargetSelector::IntraBlock(IntraBlockSelector {
            symbol: sym_part.to_string(),
            pattern: pat_part.to_string(),
        });
    }
    TargetSelector::Symbol(SymbolSelector {
        name: s,
        ordinal: None,
    })
}

#[cfg(test)]
mod tests {
    use super::{TargetSelector, parse_target_spec};
    use aice_governance::strip_selector;
    use aice_lang_registry::{IntraBlockSelector, SymbolSelector};

    #[test]
    fn parse_target_spec_matches_strip_selector() {
        let single = parse_target_spec("a:L1-L5");
        assert_eq!(single.file_path, "a");
        assert_eq!(single.file_path, strip_selector("a:L1-L5"));
        assert_eq!(single.selectors, vec![TargetSelector::LineRange { start: 1, end: 5 }]);

        let win = parse_target_spec("C:\\src\\foo.rs:Sym");
        assert_eq!(win.file_path, "C:\\src\\foo.rs");
        assert_eq!(win.file_path, strip_selector("C:\\src\\foo.rs:Sym"));
        let trav = parse_target_spec("safe:/../../../etc/shadow");
        assert_eq!(trav.file_path, "safe:/../../../etc/shadow");
        assert_eq!(trav.file_path, strip_selector("safe:/../../../etc/shadow"));

        let regex_spec = parse_target_spec("f:/a|b/");
        assert_eq!(regex_spec.file_path, "f");
        assert_eq!(regex_spec.selectors, vec![TargetSelector::Regex("/a|b/".into())]);
    }

    #[test]
    fn parse_target_spec_handles_windows_paths_and_regex_selectors() {
        for path in [
            "C:/foo/bar",
            "C:/Windows/System32",
            "C:/etc/shadow",
            "safe:/etc/shadow",
        ] {
            let spec = parse_target_spec(path);
            assert_eq!(spec.file_path, path);
            assert_eq!(spec.file_path, strip_selector(path));
            assert_eq!(spec.selectors, vec![TargetSelector::Full]);
        }

        let win_sym = parse_target_spec("C:/path/to/file.rs:Sym");
        assert_eq!(win_sym.file_path, "C:/path/to/file.rs");
        assert_eq!(
            win_sym.selectors,
            vec![TargetSelector::Symbol(SymbolSelector {
                name: "Sym".into(),
                ordinal: None,
            })]
        );

        for (raw, expected_sel) in [
            ("f:/a|b/", "/a|b/"),
            ("f:/a|b/gi", "/a|b/gi"),
            (r"f:/fn\s+foo/", r"/fn\s+foo/"),
            ("f:/a:b/", "/a:b/"),
            ("f:/a#b/", "/a#b/"),
            ("f:/abc/gi", "/abc/gi"),
            ("f:/pat/", "/pat/"),
            ("f:/[a/b]/gi", "/[a/b]/gi"),
            ("F:/a|b/gi", "/a|b/gi"),
        ] {
            let spec = parse_target_spec(raw);
            assert_eq!(spec.file_path, raw.split(':').next().unwrap());
            assert_eq!(spec.file_path, strip_selector(raw));
            assert_eq!(spec.selectors, vec![TargetSelector::Regex(expected_sel.into())]);
        }
    }

    #[test]
    fn handles_two_segment_windows_paths_and_line_and_block_selectors() {
        for path in [
            "C:/Windows/sys", "C:/etc/sys", "C:/foo/gui", "C:/etc/gi",
            "C:/src/img", "C:/var/msg", "D:/a/m", "C:/Windows/",
        ] {
            let spec = parse_target_spec(path);
            assert_eq!(spec.file_path, path);
            assert_eq!(spec.file_path, strip_selector(path));
            assert_eq!(spec.selectors, vec![TargetSelector::Full]);
        }
        let win_re = parse_target_spec("C:/foo/bar.rs:/pat/gi");
        assert_eq!(win_re.file_path, "C:/foo/bar.rs");
        assert_eq!(win_re.selectors, vec![TargetSelector::Regex("/pat/gi".into())]);
        let win_lines = parse_target_spec("C:/foo/bar.rs:L1-L5");
        assert_eq!(win_lines.file_path, "C:/foo/bar.rs");
        assert_eq!(win_lines.selectors, vec![TargetSelector::LineRange { start: 1, end: 5 }]);

        assert_eq!(parse_target_spec("a.rs:10-45").selectors, vec![TargetSelector::LineRange { start: 10, end: 45 }]);
        assert_eq!(parse_target_spec("a.rs:L7").selectors, vec![TargetSelector::LineRange { start: 7, end: 7 }]);
        assert_eq!(parse_target_spec("a.rs:L50-L10").selectors, vec![TargetSelector::InvertedLineRange { start: 50, end: 10 }]);
        assert_eq!(parse_target_spec("a.rs:Sym@first").selectors, vec![TargetSelector::Symbol(SymbolSelector { name: "Sym".into(), ordinal: Some(1) })]);
        assert_eq!(parse_target_spec("a.rs:Sym@2").selectors, vec![TargetSelector::Symbol(SymbolSelector { name: "Sym".into(), ordinal: Some(2) })]);
        assert_eq!(parse_target_spec("a.rs:run@divisible").selectors, vec![TargetSelector::IntraBlock(IntraBlockSelector { symbol: "run".into(), pattern: "divisible".into() })]);
    }
}
