use std::path::Path;

use aice_lang_registry::{FirewallDiagnostic, LanguageId};

pub fn format_context_window(src: &str, start_line: usize, end_line: usize) -> String {
    let lines: Vec<&str> = src.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)).collect();
    let total = lines.len();
    if total == 0 {
        return String::new();
    }
    let s = start_line.clamp(1, total);
    let e = end_line.clamp(s, total);
    let ctx_s = s.saturating_sub(5).max(1);
    let ctx_e = (e + 5).min(total);
    let mut out = format!("Context around L{s}-L{e} (±5 lines):\n");
    for ln in ctx_s..=ctx_e {
        out.push_str(&format!("{ln}│ {}\n", lines[ln - 1]));
    }
    out
}

pub fn format_firewall_diagnostics(
    display_path: &Path,
    lang: LanguageId,
    src: &str,
    diagnostics: &[FirewallDiagnostic],
) -> String {
    let items: Vec<String> = diagnostics
        .iter()
        .take(5)
        .map(|d| format!("Line {}:{} - {}", d.line, d.column, d.message))
        .collect();
    let summary = if items.is_empty() {
        "Syntax error".to_string()
    } else {
        items.join("; ")
    };
    let first_line = diagnostics.first().map(|d| d.line).unwrap_or(1);
    let last_line = diagnostics
        .iter()
        .map(|d| d.line)
        .max()
        .unwrap_or(first_line);
    let ctx = format_context_window(src, first_line, last_line);
    format!(
        "SyntaxFirewall rejected {} ({}): {}\n{}",
        display_path.display(),
        lang.canonical_name(),
        summary,
        ctx
    )
}

pub fn format_range_rejected(
    display_path: &Path,
    start: usize,
    end: usize,
    msg: &str,
    src: &str,
) -> String {
    let ctx = format_context_window(src, start, end);
    format!(
        "Line-range splice (L{start}-L{end}) rejected in {}: {msg}\n{ctx}",
        display_path.display()
    )
}
