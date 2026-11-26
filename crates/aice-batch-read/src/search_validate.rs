use std::path::{Path, PathBuf};

use aice_governance::Governed;

use crate::BatchReadPack;
use crate::regex_compile::{CompiledPattern, compile_search_pattern, compile_slash_regex};
use crate::regex_parse::parse_regex;

pub(crate) struct ValidatedQuery {
    pub compiled: CompiledPattern,
    pub hint: String,
}

pub(crate) fn compile_search_query(raw: &str) -> Result<ValidatedQuery, String> {
    if raw.is_empty() {
        return Err("Search pattern cannot be empty".to_string());
    }
    if let Some(after_lead) = raw.strip_prefix('/') {
        if looks_like_closed_slash_regex(raw) {
            let compiled = compile_slash_regex(raw)
                .map_err(|e| format!("Invalid regex '{raw}': {e}"))?;
            return Ok(ValidatedQuery {
                compiled,
                hint: String::new(),
            });
        }
        if !after_lead.contains('/') {
            if !after_lead.is_empty() && parse_regex(after_lead).is_err() {
                return Err(format!(
                    "Invalid regex '{raw}': unclosed delimiter or malformed pattern"
                ));
            }
            return Ok(ValidatedQuery {
                compiled: CompiledPattern::literal(raw, false, false),
                hint: format!(
                    "Hint: unclosed '/' in search pattern '{raw}'; treated as literal.\n"
                ),
            });
        }
        return Ok(ValidatedQuery {
            compiled: compile_search_pattern(raw, false),
            hint: String::new(),
        });
    }
    Ok(ValidatedQuery {
        compiled: compile_search_pattern(raw, false),
        hint: String::new(),
    })
}

fn looks_like_closed_slash_regex(raw: &str) -> bool {
    let Some(last_slash) = raw.rfind('/') else {
        return false;
    };
    if last_slash == 0 {
        return false;
    }
    let flags = &raw[last_slash + 1..];
    if !flags.chars().all(|c| matches!(c, 'i' | 'm' | 'g')) {
        return false;
    }
    let body = &raw[1..last_slash];
    let bytes = body.as_bytes();
    let (mut i, mut escaped, mut in_class) = (0usize, false, false);
    while i < bytes.len() {
        if escaped {
            escaped = false;
            i += 1;
            continue;
        }
        match bytes[i] {
            b'\\' => escaped = true,
            b'[' if !in_class => in_class = true,
            b']' if in_class => in_class = false,
            b'/' if !in_class => return false,
            _ => {}
        }
        i += 1;
    }
    true
}

pub(crate) fn validate_explicit_targets(
    governed: &Governed,
    targets: &[String],
) -> Result<(), String> {
    for raw in targets {
        if raw.is_empty()
            || raw == "."
            || raw.contains('*')
            || raw.contains('?')
            || raw.contains('[')
        {
            continue;
        }
        let resolved = resolve_target_path(governed.cwd(), raw);
        if path_entry_exists(&resolved) {
            continue;
        }
        if raw.contains('\\') {
            let norm = raw.replace('\\', "/");
            let alt = resolve_target_path(governed.cwd(), &norm);
            if path_entry_exists(&alt) {
                continue;
            }
        }
        return Err(format!("Target path does not exist: {raw}"));
    }
    Ok(())
}

fn path_entry_exists(p: &Path) -> bool {
    std::fs::metadata(p).is_ok() || std::fs::read_link(p).is_ok()
}

fn resolve_target_path(cwd: &Path, raw: &str) -> PathBuf {
    let p = Path::new(raw);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        cwd.join(p)
    }
}

pub(crate) fn error_pack_with_mode(
    file_label: &str,
    mut stderr: String,
    is_search_mode: bool,
    is_files_mode: bool,
) -> BatchReadPack {
    if !stderr.is_empty() && !stderr.ends_with('\n') {
        stderr.push('\n');
    }
    BatchReadPack {
        raw_baseline: String::new(),
        emitted_output: String::new(),
        file_label: file_label.to_string(),
        stderr_output: stderr,
        exit_code: 1,
        realistic_native_payload: None,
        multi_files: Vec::new(),
        language: Some("Multi".to_string()),
        is_search_mode,
        is_files_mode,
        has_expanded_context: true,
        preserved_trivia_tokens: 0,
        wasted_input_tokens: None,
    }
}
