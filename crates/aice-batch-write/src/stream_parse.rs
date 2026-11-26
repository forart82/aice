use std::path::{Path, PathBuf};

use aice_governance::heredoc_targets::{
    CodeLexState, is_md_fence_close, parse_md_fence_open, scan_code_lex_line,
    scan_triple_quote_line,
};
use aice_governance::{WriteOp, split_target_selector};

use crate::hunk::has_hunk_markers;
use crate::manifest::validate_selector;
use crate::stream_header::{HeaderMods, parse_header_with_ctx};
use crate::types::BatchSpliceItem;

fn split_lines_norm(raw: &str) -> Vec<&str> {
    let s = raw.trim_start_matches('\u{FEFF}');
    if !s.contains('\n') && s.contains('\r') {
        s.split('\r').collect()
    } else {
        s.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)).collect()
    }
}

fn path_ext(p: &Path) -> String {
    let raw = p
        .to_str()
        .map(|s| Path::new(split_target_selector(s).0))
        .unwrap_or(p);
    raw.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
}

fn clean_body(lines: &[&str]) -> String {
    let mut end = lines.len();
    while end > 0 && lines[end - 1].trim().is_empty() {
        end -= 1;
    }
    if end > 0 {
        let last = lines[end - 1].trim();
        let is_shell_eof_tail = last
            .strip_prefix("EOF")
            .map(str::trim_start)
            .is_some_and(|r| r.starts_with("&&") || r.starts_with("||") || r.starts_with(';'));
        if is_shell_eof_tail {
            end -= 1;
            while end > 0 && lines[end - 1].trim().is_empty() {
                end -= 1;
            }
        }
    }
    let mut start = 0;
    while start < end && lines[start].trim().is_empty() {
        start += 1;
    }
    if start >= end {
        return String::new();
    }
    let mut out = lines[start..end].join("\n");
    out.push('\n');
    out
}

pub fn parse_heredoc_stream(raw: &str, op: &WriteOp) -> Result<Vec<BatchSpliceItem>, String> {
    let lines = split_lines_norm(raw);
    if lines.iter().all(|l| l.trim().is_empty()) {
        return Err("Empty heredoc stream".into());
    }
    let has_unindented = lines.iter().any(|l| {
        let nb = l.trim_start_matches('\u{FEFF}');
        nb.starts_with('=')
            && !nb.trim().bytes().all(|b| b == b'=')
            && matches!(
                parse_header_with_ctx(nb.trim(), true, false, false, op.path.is_some(), ""),
                Ok(Some(_))
            )
    });
    let mut ext = op.path.as_deref().map(path_ext).unwrap_or_default();
    let (mut sec_first, mut in_fence, mut in_hunk, mut in_tq, mut code_st) =
        (op.path.is_some(), None::<(u8, usize)>, false, None, CodeLexState::default());
    let mut sections: Vec<(String, HeaderMods, Vec<&str>)> = Vec::new();
    for line in lines {
        let trimmed = line.trim_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}');
        if let Some((fch, flen)) = in_fence {
            if is_md_fence_close(trimmed, fch, flen) {
                in_fence = None;
            }
            if let Some(sec) = sections.last_mut() {
                sec.2.push(line);
            }
            continue;
        }
        if in_tq.is_none() && !code_st.is_active() {
            if in_hunk {
                if trimmed.len() >= 3 && trimmed.bytes().all(|b| b == b'>') {
                    in_hunk = false;
                }
                if let Some(sec) = sections.last_mut() {
                    sec.2.push(line);
                }
                continue;
            }
            if trimmed.len() >= 3 && trimmed.bytes().all(|b| b == b'<') {
                in_hunk = true;
                if let Some(sec) = sections.last_mut() {
                    sec.2.push(line);
                }
                continue;
            }
        }
        if sec_first && !trimmed.is_empty() {
            sec_first = false;
            if ext.is_empty() && trimmed.starts_with("#!") && trimmed.to_ascii_lowercase().contains("python") {
                ext = "py".into();
            }
        }
        if in_tq.is_some() || matches!(ext.as_str(), "py" | "pyi" | "pyw") {
            let started = in_tq.is_some();
            scan_triple_quote_line(line, &mut in_tq, true);
            if started || in_tq.is_some() {
                if let Some(sec) = sections.last_mut() {
                    sec.2.push(line);
                }
                continue;
            }
        }
        if scan_code_lex_line(line, &ext, &mut code_st) {
            if let Some(sec) = sections.last_mut() {
                sec.2.push(line);
            }
            continue;
        }
        if matches!(ext.as_str(), "md" | "markdown")
            && let Some(fence) = parse_md_fence_open(trimmed)
        {
            in_fence = Some(fence);
            if let Some(sec) = sections.last_mut() {
                sec.2.push(line);
            }
            continue;
        }
        let no_bom = line.trim_start_matches('\u{FEFF}');
        let is_indented = no_bom.starts_with(|c: char| c.is_whitespace());
        let allow_header = !has_unindented || no_bom.starts_with('=');
        if allow_header
            && !trimmed.bytes().all(|b| b == b'=')
            && let Some((target, mods)) = parse_header_with_ctx(
                trimmed,
                op.preserve_docs,
                is_indented,
                sections.is_empty(),
                op.path.is_some(),
                &ext,
            )?
        {
            in_fence = None;
            sec_first = true;
            in_hunk = false;
            in_tq = None;
            code_st = CodeLexState::default();
            if !(target.starts_with(':') || target.starts_with('#')) {
                ext = path_ext(Path::new(&target));
            }
            sections.push((target, mods, Vec::new()));
            continue;
        }
        if let Some(sec) = sections.last_mut() {
            sec.2.push(line);
        } else if !trimmed.is_empty() {
            return Err("Heredoc stream must start with a '=== <file>:<symbol> ===' header".into());
        }
    }
    if sections.is_empty() {
        return Err("No valid '=== <file> ===' sections found in heredoc stream".into());
    }
    build_items(sections, op)
}

fn build_items(
    sections: Vec<(String, HeaderMods, Vec<&str>)>,
    op: &WriteOp,
) -> Result<Vec<BatchSpliceItem>, String> {
    let mut last_file: Option<PathBuf> = op.path.clone();
    let mut items = Vec::with_capacity(sections.len());
    for (target, mut mods, body_lines) in sections {
        let (file_path, symbol) =
            if let Some(rest) = target.strip_prefix(':').or_else(|| target.strip_prefix('#')) {
                let fp = last_file.clone().ok_or_else(|| {
                    format!("Relative selector '{target}' has no default or preceding file")
                })?;
                let sel = rest.trim();
                if sel.is_empty() || sel == "+" {
                    return Err(format!("Malformed empty selector in header '{target}'"));
                }
                (fp, Some(sel.to_string()))
            } else if target.ends_with(':') || target.ends_with('#') {
                return Err(format!(
                    "Malformed heredoc header '{target}': trailing selector delimiter with empty symbol"
                ));
            } else {
                let (fp_str, sel_opt) = split_target_selector(&target);
                if fp_str.is_empty() {
                    return Err(format!("Missing file path in header '{target}'"));
                }
                let fp = PathBuf::from(fp_str);
                last_file = Some(fp.clone());
                (fp, sel_opt.map(str::to_string))
            };
        if let Some(ref sym) = symbol {
            validate_selector(sym)?;
        }
        for opt_sel in [&mods.insert_after, &mods.insert_before, &mods.clone_from]
            .into_iter()
            .flatten()
        {
            if !opt_sel.is_empty() {
                validate_selector(opt_sel)?;
            }
        }
        let body = clean_body(&body_lines);
        if body.trim().eq_ignore_ascii_case("--delete") || body.trim() == "DELETE" {
            mods.delete = true;
        }
        let is_bare_file = symbol.is_none()
            && mods.insert_after.is_none()
            && mods.insert_before.is_none()
            && !mods.delete;
        let final_sym = if is_bare_file && has_hunk_markers(&body) {
            Some(":hunk".to_string())
        } else {
            symbol
        };
        let explicit_overwrite = final_sym.as_deref().is_some_and(|s| {
            matches!(
                s.trim().to_ascii_lowercase().as_str(),
                "overwrite" | ":overwrite" | "*"
            )
        });
        let explicit_create_sel = final_sym
            .as_deref()
            .is_some_and(|s| matches!(s.trim().to_ascii_lowercase().as_str(), "create" | ":create"));
        items.push(BatchSpliceItem {
            requested_display: file_path.display().to_string(),
            file_path,
            symbol: final_sym,
            payload: body,
            force_aice_ir: false,
            delete: mods.delete,
            insert_after: mods.insert_after,
            insert_before: mods.insert_before,
            clone_from: mods.clone_from,
            create: op.create || is_bare_file || explicit_create_sel,
            explicit_create_flag: op.create,
            overwrite: op.overwrite || explicit_overwrite,
            force: op.force,
            preserve_docs: mods.preserve_docs,
        });
    }
    Ok(items)
}
