use std::path::Path;

use crate::r5::checks::{ErrorSpan, collect_ts_error_spans};
pub use crate::r5::checks_tags::{check_html, check_xml};
use crate::ts_pool::{GrammarSlot, ParserPool};

pub fn check_json(tree: &tree_sitter::Tree, path: &Path) -> Vec<ErrorSpan> {
    let allow_comments = is_jsonc_path(path);
    let mut errors = Vec::new();
    let root = tree.root_node();

    if !allow_comments {
        collect_json_comments(root, &mut errors);
    }

    let mut value_count = 0usize;
    let count = root.named_child_count();
    for i in 0..count {
        if let Some(child) = root.named_child(i as u32)
            && child.kind() != "comment"
        {
            value_count += 1;
            if value_count == 2 {
                let pos = child.start_position();
                errors.push(ErrorSpan {
                    line: pos.row + 1,
                    column: pos.column + 1,
                    end_line: child.end_position().row + 1,
                    message: "Multiple top-level values in JSON document".to_string(),
                });
            }
        }
    }
    if value_count == 0 && !root.has_error() {
        errors.push(ErrorSpan {
            line: 1,
            column: 1,
            end_line: 1,
            message: "Empty JSON document".to_string(),
        });
    }
    errors
}

fn is_jsonc_path(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    if ext == "jsonc" {
        return true;
    }
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    name.starts_with("tsconfig") || name.starts_with("jsconfig")
}

fn collect_json_comments(root: tree_sitter::Node<'_>, errors: &mut Vec<ErrorSpan>) {
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        if node.kind() == "comment" {
            let pos = node.start_position();
            errors.push(ErrorSpan {
                line: pos.row + 1,
                column: pos.column + 1,
                end_line: node.end_position().row + 1,
                message: "Comments are not permitted in strict JSON".to_string(),
            });
            continue;
        }
        for i in (0..node.child_count()).rev() {
            if let Some(child) = node.child(i) { stack.push(child); }
        }
    }
}

pub fn check_markdown(src: &str, pool: &mut ParserPool) -> Vec<ErrorSpan> {
    let mut errors = Vec::new();
    let clean = src.strip_prefix('\u{FEFF}').unwrap_or(src);
    let lines: Vec<&str> = clean.lines().collect();
    let mut start_idx = 0usize;

    if lines.first().map(|l| l.trim_end() == "---").unwrap_or(false) {
        let close = (1..lines.len()).find(|&i| matches!(lines[i].trim(), "---" | "..."));
        match close {
            None => errors.push(ErrorSpan {
                line: 1,
                column: 1,
                end_line: 1,
                message: "Unterminated YAML frontmatter block".to_string(),
            }),
            Some(cidx) => {
                let body = lines[1..cidx].join("\n");
                if let Ok(yaml_tree) = pool.parse_slot(GrammarSlot::Yaml, &body) {
                    for mut sp in collect_ts_error_spans(&yaml_tree, &body) {
                        sp.line += 1;
                        sp.end_line += 1;
                        sp.message = format!("Frontmatter YAML error: {}", sp.message);
                        errors.push(sp);
                    }
                }
                start_idx = cidx + 1;
            }
        }
    }

    let mut open_fence: Option<(char, usize, usize)> = None;
    let mut saw_conflict_open = false;
    for (idx, line) in lines.iter().enumerate().skip(start_idx) {
        let line_no = idx + 1;
        let trimmed = line.trim_start_matches(' ');
        if line.len() - trimmed.len() <= 3 {
            if let Some((fc, flen, _)) = open_fence {
                let count = trimmed.chars().take_while(|&c| c == fc).count();
                if count >= flen && trimmed[count..].trim().is_empty() {
                    open_fence = None;
                    continue;
                }
            } else if let Some(fc) = trimmed.chars().next().filter(|&c| c == '`' || c == '~') {
                let count = trimmed.chars().take_while(|&c| c == fc).count();
                if count >= 3 && (fc != '`' || !trimmed[count..].contains('`')) {
                    open_fence = Some((fc, count, line_no));
                    continue;
                }
            }
        }
        if open_fence.is_none() {
            if line.starts_with("<<<<<<<") {
                saw_conflict_open = true;
                errors.push(ErrorSpan {
                    line: line_no,
                    column: 1,
                    end_line: line_no,
                    message: "Unresolved merge conflict marker '<<<<<<<'".to_string(),
                });
            } else if (line.starts_with("=======") && saw_conflict_open)
                || line.starts_with(">>>>>>>")
            {
                saw_conflict_open = false;
                errors.push(ErrorSpan {
                    line: line_no,
                    column: 1,
                    end_line: line_no,
                    message: "Unresolved merge conflict marker".to_string(),
                });
            }
        }
    }
    if let Some((_, _, open_line)) = open_fence {
        errors.push(ErrorSpan {
            line: open_line,
            column: 1,
            end_line: open_line,
            message: "Unterminated fenced code block".to_string(),
        });
    }
    errors
}

pub fn check_css(tree: &tree_sitter::Tree, src: &str) -> Vec<ErrorSpan> {
    let mut errors = Vec::new();
    check_css_blocks(tree.root_node(), src, &mut errors);
    if has_unclosed_css_comment(src) {
        let last = src.lines().count().max(1);
        errors.push(ErrorSpan {
            line: last,
            column: 1,
            end_line: last,
            message: "Unterminated CSS block comment '/*'".to_string(),
        });
    }
    errors
}

fn check_css_blocks(root: tree_sitter::Node<'_>, src: &str, errors: &mut Vec<ErrorSpan>) {
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        if node.kind() == "block" {
            let count = node.child_count();
            for i in 0..count {
                let Some(child) = node.child(i) else { continue; };
                if child.kind() != "declaration" { continue; }
                let decl_text = &src[child.byte_range()];
                let ends_semi = decl_text.trim_end().ends_with(';');
                let next_semi = node.child(i + 1).map(|n| n.kind() == ";").unwrap_or(false);
                let followed = ((i + 1)..count).any(|j| {
                    node.child(j)
                        .map(|s| matches!(s.kind(), "declaration" | "rule_set" | "at_rule"))
                        .unwrap_or(false)
                });
                if followed && !ends_semi && !next_semi {
                    let end = child.end_position();
                    errors.push(ErrorSpan {
                        line: end.row + 1, column: end.column + 1, end_line: end.row + 1,
                        message: "Missing ';' after CSS declaration".to_string(),
                    });
                }
                if count_top_level_colons(decl_text) > 1 {
                    let start = child.start_position();
                    errors.push(ErrorSpan {
                        line: start.row + 1, column: start.column + 1, end_line: child.end_position().row + 1,
                        message: "Missing ';' between CSS declarations".to_string(),
                    });
                }
            }
        }
        for i in (0..node.child_count()).rev() {
            if let Some(child) = node.child(i) { stack.push(child); }
        }
    }
}

fn count_top_level_colons(s: &str) -> usize {
    let b = s.as_bytes();
    let (mut i, mut depth, mut quote, mut count) = (0, 0usize, None, 0usize);
    while i < b.len() {
        if let Some(q) = quote {
            if b[i] == b'\\' {
                i += 2;
                continue;
            }
            if b[i] == q {
                quote = None;
            }
        } else if i + 1 < b.len() && b[i] == b'/' && b[i + 1] == b'*' {
            if let Some(end) = s[i + 2..].find("*/") {
                i += 2 + end + 2;
                continue;
            }
            break;
        } else {
            match b[i] {
                b'\'' | b'"' => quote = Some(b[i]),
                b'(' => depth += 1,
                b')' => depth = depth.saturating_sub(1),
                b':' if depth == 0 => count += 1,
                _ => {}
            }
        }
        i += 1;
    }
    count
}

fn has_unclosed_css_comment(src: &str) -> bool {
    let b = src.as_bytes();
    let mut i = 0;
    let mut quote: Option<u8> = None;
    while i < b.len() {
        if let Some(q) = quote {
            if b[i] == b'\\' {
                i += 2;
                continue;
            }
            if b[i] == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        if b[i] == b'"' || b[i] == b'\'' {
            quote = Some(b[i]);
            i += 1;
        } else if i + 1 < b.len() && b[i] == b'/' && b[i + 1] == b'*' {
            if let Some(end) = src[i + 2..].find("*/") {
                i += 2 + end + 2;
            } else {
                return true;
            }
        } else {
            i += 1;
        }
    }
    false
}
