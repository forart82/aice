use std::path::Path;

use aice_governance::heredoc_targets::{is_md_or_txt_section_target, is_text_or_md_ext};
use aice_governance::split_target_selector;

#[derive(Default)]
pub(crate) struct HeaderMods {
    pub delete: bool,
    pub preserve_docs: bool,
    pub clone_from: Option<String>,
    pub insert_after: Option<String>,
    pub insert_before: Option<String>,
}

fn strip_flag_arg(s: &str, flag: &str) -> Option<(String, String)> {
    let idx = s.to_ascii_lowercase().rfind(flag)?;
    let (before, after) = (&s[..idx], &s[idx + flag.len()..]);
    if !before.ends_with(|c: char| c.is_ascii_whitespace())
        || !(after.is_empty()
            || after.starts_with('=')
            || after.starts_with(|c: char| c.is_ascii_whitespace()))
    {
        return None;
    }
    let rest = after.strip_prefix('=').unwrap_or(after).trim();
    let arg = if (rest.starts_with('"') && rest.ends_with('"') && rest.len() >= 2)
        || (rest.starts_with('\'') && rest.ends_with('\'') && rest.len() >= 2)
    {
        rest[1..rest.len() - 1].to_string()
    } else if !rest.contains(char::is_whitespace) {
        rest.to_string()
    } else {
        return None;
    };
    Some((before.trim_end().to_string(), arg))
}

fn strip_clone(s: &str) -> Option<(String, String)> {
    let lower = s.to_ascii_lowercase();
    for marker in ["(clone", "@clone"] {
        if let Some(idx) = lower.rfind(marker)
            && s[..idx].ends_with(|c: char| c.is_ascii_whitespace())
        {
            let after = s[idx + marker.len()..].trim();
            let sym = if marker == "(clone" && after.ends_with(')') {
                after[..after.len() - 1]
                    .trim()
                    .trim_matches(|c| c == '(' || c == ')')
            } else if after.starts_with('(') && after.ends_with(')') {
                after[1..after.len() - 1].trim()
            } else if !after.is_empty() && !after.contains(char::is_whitespace) {
                after
            } else {
                continue;
            };
            if !sym.is_empty() {
                return Some((s[..idx].trim_end().to_string(), sym.to_string()));
            }
        }
    }
    None
}

fn strip_mods(raw: &str, mods: &mut HeaderMods) -> String {
    let mut cur = raw.trim().to_string();
    loop {
        let prev = cur.clone();
        let lower = cur.to_ascii_lowercase();
        for suf in [
            "--delete",
            "(delete)",
            ":delete",
            "-d",
            "@replace-docs",
            "@strip-docs",
            "@drop-docs",
        ] {
            if lower.ends_with(suf) && cur.len() > suf.len() {
                let prefix = &cur[..cur.len() - suf.len()];
                if matches!(suf, "(delete)" | ":delete")
                    || prefix.ends_with(|c: char| c.is_ascii_whitespace())
                {
                    if matches!(suf, "--delete" | "(delete)" | ":delete" | "-d") {
                        mods.delete = true;
                    } else {
                        mods.preserve_docs = false;
                    }
                    cur = prefix.trim_end().to_string();
                    break;
                }
            }
        }
        if cur == prev
            && let Some((rest, sym)) = strip_clone(&cur)
        {
            mods.clone_from = Some(sym);
            cur = rest;
        }
        if cur == prev {
            for (flag, is_after) in [("--insert-after", true), ("--insert-before", false)] {
                if let Some((rest, arg)) = strip_flag_arg(&cur, flag) {
                    if is_after {
                        mods.insert_after = Some(arg);
                    } else {
                        mods.insert_before = Some(arg);
                    }
                    cur = rest;
                    break;
                }
            }
        }
        if cur == prev {
            break;
        }
    }
    cur
}

fn looks_like_file_candidate(s: &str) -> bool {
    !s.is_empty()
        && !s.contains(char::is_whitespace)
        && (s.contains('/') || s.contains('\\') || Path::new(s).extension().is_some())
}

pub(crate) fn parse_header_with_ctx(
    trimmed: &str,
    default_preserve_docs: bool,
    is_indented: bool,
    in_preamble: bool,
    has_default_path: bool,
    active_ext: &str,
) -> Result<Option<(String, HeaderMods)>, String> {
    if trimmed.bytes().all(|b| b == b'=') {
        return Ok(None);
    }
    let mut mods = HeaderMods {
        preserve_docs: default_preserve_docs,
        ..Default::default()
    };
    let header = strip_mods(trimmed, &mut mods);
    let eq_l = header.bytes().take_while(|&b| b == b'=').count();
    let eq_r = header.bytes().rev().take_while(|&b| b == b'=').count();
    if eq_l >= 3 && eq_r >= 3 && header.len() > eq_l + eq_r {
        let inner = header[eq_l..header.len() - eq_r]
            .trim_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}');
        let target = strip_mods(inner, &mut mods);
        let unquoted = target.trim_matches('"').trim_matches('\'').trim();
        if is_text_or_md_ext(active_ext)
            && (!in_preamble || has_default_path)
            && !is_md_or_txt_section_target(&target)
        {
            return Ok(None);
        }
        if unquoted.is_empty() || unquoted.bytes().all(|b| b == b'=') {
            return Err("Malformed heredoc header: empty target inside === ... ===".into());
        }
        return Ok(Some((target, mods)));
    }
    if eq_l >= 3 && header.len() == eq_l {
        if is_text_or_md_ext(active_ext) && (!in_preamble || has_default_path) {
            return Ok(None);
        }
        return Err("Malformed heredoc header: empty target inside === ... ===".into());
    }
    if trimmed.starts_with("===") && !trimmed[3..].contains("===") && !is_indented {
        let first_tok = trimmed[3..].split_whitespace().next().unwrap_or("");
        let file_part = split_target_selector(first_tok).0;
        let is_text_or_md = matches!(active_ext, "md" | "markdown" | "txt");
        if (in_preamble && !has_default_path) || (!is_text_or_md && looks_like_file_candidate(file_part)) {
            return Err(format!(
                "Malformed unclosed heredoc header: '{}'",
                trimmed.chars().take(60).collect::<String>()
            ));
        }
    }
    Ok(None)
}
