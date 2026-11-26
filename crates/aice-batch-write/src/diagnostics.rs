use std::path::Path;

use aice_lang_registry::{FirewallDiagnostic, LanguageId};

const MAX_CONTEXT_LINES: usize = 25;
const MAX_DIAG_WINDOWS: usize = 3;
const MAX_CONTEXT_LINE_CHARS: usize = 300;

fn push_ctx_line(out: &mut String, ln: usize, raw: &str) {
    if raw.chars().count() > MAX_CONTEXT_LINE_CHARS {
        let prefix: String = raw.chars().take(MAX_CONTEXT_LINE_CHARS).collect();
        out.push_str(&format!("{ln}│ {prefix}...\n"));
    } else {
        out.push_str(&format!("{ln}│ {raw}\n"));
    }
}

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
    if ctx_e - ctx_s < MAX_CONTEXT_LINES {
        for ln in ctx_s..=ctx_e {
            push_ctx_line(&mut out, ln, lines[ln - 1]);
        }
    } else {
        let head_count = (MAX_CONTEXT_LINES - 1) / 2;
        let tail_count = MAX_CONTEXT_LINES - 1 - head_count;
        let head_end = (ctx_s + head_count - 1).min(total);
        let tail_start = ctx_e.saturating_sub(tail_count - 1).max(head_end + 1);
        for ln in ctx_s..=head_end {
            push_ctx_line(&mut out, ln, lines[ln - 1]);
        }
        let omitted = tail_start.saturating_sub(head_end + 1);
        if omitted > 0 {
            out.push_str(&format!("... ({omitted} lines omitted) ...\n"));
        }
        for ln in tail_start..=ctx_e {
            push_ctx_line(&mut out, ln, lines[ln - 1]);
        }
    }
    out
}

fn format_diagnostics_context(src: &str, diagnostics: &[FirewallDiagnostic]) -> String {
    let lines: Vec<&str> = src.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)).collect();
    let total = lines.len();
    if total == 0 {
        return String::new();
    }
    let mut windows: Vec<(usize, usize)> = Vec::new();
    for d in diagnostics {
        let ln = d.line.clamp(1, total);
        if let Some(w) = windows.iter_mut().find(|(ws, we)| {
            let ns = (*ws).min(ln);
            let ne = (*we).max(ln);
            ln <= *we + 10 && ln + 10 >= *ws && ne - ns <= 14
        }) {
            w.0 = w.0.min(ln);
            w.1 = w.1.max(ln);
        } else if windows.len() < MAX_DIAG_WINDOWS {
            windows.push((ln, ln));
        }
    }
    if windows.is_empty() {
        windows.push((1, 1));
    }
    let radius = if windows.len() >= 3 { 3 } else { 5 };
    let mut emitted = 0usize;
    let mut out = String::new();
    for (ws, we) in windows {
        if emitted >= MAX_CONTEXT_LINES {
            break;
        }
        let ctx_s = ws.saturating_sub(radius).max(1);
        let max_ctx_e = (we + radius).min(total);
        let budget = MAX_CONTEXT_LINES - emitted;
        let ctx_e = max_ctx_e.min(ctx_s + budget - 1);
        out.push_str(&format!("Context around L{ws}-L{we} (±{radius} lines):\n"));
        for ln in ctx_s..=ctx_e {
            push_ctx_line(&mut out, ln, lines[ln - 1]);
            emitted += 1;
        }
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
    let ctx = format_diagnostics_context(src, diagnostics);
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
