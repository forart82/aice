use std::path::{Path, PathBuf};

use crate::heredoc_targets::{
    has_binary_write_payload, has_non_drive_colon_slash_str, has_traversal_after_selector_delim,
};
use crate::ops::{OperationKind, OperationTargets};
use crate::path_guard::{AuthorizedPath, is_blocked_system_path, is_path_contained};
use crate::target_spec::{has_regex_selector_part, split_target_selector_in_dir};
use crate::typestate::GovernanceError;

pub(crate) fn resolve_from_cwd(p: &Path, cwd: &Path) -> PathBuf {
    if p.is_absolute() { p.to_path_buf() } else { cwd.join(p) }
}

pub(crate) fn probe_write_inline_payloads(
    op: &dyn OperationTargets,
    authorized_paths: &[AuthorizedPath],
) -> Result<(), GovernanceError> {
    if has_binary_write_payload(&op.inline_payloads(), &op.json_manifest_payloads()) {
        let fallback = authorized_paths.first().map(|p| p.canonical.clone()).unwrap_or_default();
        return Err(GovernanceError::BinaryWriteForbidden(fallback));
    }
    Ok(())
}

pub(crate) fn validate_raw_target(
    raw: &str,
    cwd: &Path,
    root: &Path,
    allowed: &[PathBuf],
    op_kind: OperationKind,
) -> Result<(), GovernanceError> {
    if raw.is_empty() {
        return Err(GovernanceError::PathOutsideAllowedRoots(PathBuf::new()));
    }
    let abs_raw = resolve_from_cwd(Path::new(raw), cwd);
    if raw.contains('\0') || has_traversal_after_selector_delim(raw) {
        return Err(GovernanceError::PathOutsideAllowedRoots(abs_raw));
    }
    let split = split_target_selector_in_dir(raw, cwd);
    let is_regex = matches!(split, (_, Some(sel)) if has_regex_selector_part(sel));
    if has_non_drive_colon_slash_str(raw) {
        if op_kind != OperationKind::Find && is_regex {
            let abs_file = resolve_from_cwd(Path::new(split.0), cwd);
            let raw_ok = abs_raw.exists() && is_path_contained(&abs_raw, root, allowed);
            let file_ok = abs_file.exists() && is_path_contained(&abs_file, root, allowed);
            if !raw_ok && !file_ok {
                return Err(GovernanceError::PathOutsideAllowedRoots(abs_raw));
            }
        } else if !abs_raw.exists() || !is_path_contained(&abs_raw, root, allowed) {
            if op_kind == OperationKind::Read
                && let Some(msg) = detect_malformed_regex_selector(raw, cwd, root, allowed)
            {
                return Err(GovernanceError::InvalidSelector(msg));
            }
            return Err(GovernanceError::PathOutsideAllowedRoots(abs_raw));
        }
    } else if is_regex {
        let abs_file = resolve_from_cwd(Path::new(split.0), cwd);
        if op_kind == OperationKind::Find
            || !abs_file.exists()
            || !is_path_contained(&abs_file, root, allowed)
        {
            return Err(GovernanceError::PathOutsideAllowedRoots(abs_raw));
        }
    } else if op_kind == OperationKind::Read
        && split.1.is_none()
        && !abs_raw.exists()
        && let Some(msg) = detect_malformed_regex_selector(raw, cwd, root, allowed)
    {
        return Err(GovernanceError::InvalidSelector(msg));
    }
    Ok(())
}

fn detect_malformed_regex_selector(
    raw: &str,
    cwd: &Path,
    root: &Path,
    allowed: &[PathBuf],
) -> Option<String> {
    let bytes = raw.as_bytes();
    let offset = if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        2
    } else {
        0
    };
    let tail = &raw[offset..];
    for (pos, ch) in tail.char_indices() {
        if !matches!(ch, ':' | '#') {
            continue;
        }
        let split_at = offset + pos;
        if split_at == 0 {
            continue;
        }
        let file_part = &raw[..split_at];
        let sel_part = &raw[split_at + 1..];
        if sel_part.is_empty() || sel_part.contains("..") {
            continue;
        }
        let looks_regex = sel_part.starts_with('/') || has_regex_selector_part(sel_part);
        if !looks_regex {
            continue;
        }
        if sel_part.starts_with('/') && is_blocked_system_path(Path::new(sel_part)) {
            continue;
        }
        let abs_file = resolve_from_cwd(Path::new(file_part), cwd);
        if abs_file.is_file() && is_path_contained(&abs_file, root, allowed) {
            return Some(format!(
                "Invalid regex selector '{sel_part}' for {file_part}"
            ));
        }
    }
    None
}
