use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};

use aice_governance::binary_probe::{
    BinaryProbeResult, DEFAULT_BINARY_PROBE_BYTES, DEFAULT_MAX_TEXT_FILE_BYTES,
    is_binary_extension, probe_bytes_with_partial,
};
use aice_lang_registry::{LanguageId, detect_language};

use crate::ignore_rules::EntryCheck;
use crate::utf8_stream::Utf8StreamValidator;
use crate::walker::{FindWalkOpts, WalkedFile};
use crate::walker_classify::{ExtClass, count_lf_swar, count_lines_fast, fast_ext_classify};
use crate::walker_pool::WalkContext;
use crate::walker_seed::is_canon_contained;

pub(crate) const STREAM_BUF_LEN: usize = 65_536;

pub(crate) fn directory_has_visible_files(
    dir: &Path,
    canon_dir: PathBuf,
    root_in_node_modules: bool,
    ctx: &WalkContext<'_>,
) -> bool {
    let mut visited = HashSet::new();
    let mut stack = vec![(dir.to_path_buf(), canon_dir, root_in_node_modules)];
    let mut scratch = vec![0u8; DEFAULT_BINARY_PROBE_BYTES];
    while let Some((cur_dir, cur_canon, in_nm)) = stack.pop() {
        if !is_canon_contained(&cur_canon, ctx) || !visited.insert(cur_canon.clone()) {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&cur_dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str == "." || name_str == ".." || name_str == ".git" {
                continue;
            }
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if ft.is_file() {
                let path = match ctx.ignore.fast_check_file(&name_str) {
                    EntryCheck::Skip => continue,
                    EntryCheck::Allow => entry.path(),
                    EntryCheck::NeedPath => {
                        let p = entry.path();
                        if ctx.ignore.should_skip_file(&name_str, &p) {
                            continue;
                        }
                        p
                    }
                };
                if is_visible_file(&path, ctx.opts, &mut scratch) {
                    return true;
                }
            } else if ft.is_dir() {
                let path = match ctx.ignore.fast_check_dir(&name_str, in_nm) {
                    EntryCheck::Skip => continue,
                    EntryCheck::Allow => entry.path(),
                    EntryCheck::NeedPath => {
                        let p = entry.path();
                        if ctx.ignore.should_skip_dir(&name_str, &p, in_nm) {
                            continue;
                        }
                        p
                    }
                };
                let child_canon = cur_canon.join(&name);
                stack.push((path, child_canon, in_nm || name_str == "node_modules"));
            }
        }
    }
    false
}

fn read_into_slice(file: &mut std::fs::File, dst: &mut [u8]) -> std::io::Result<usize> {
    let mut pos = 0;
    while pos < dst.len() {
        match file.read(&mut dst[pos..]) {
            Ok(0) => break,
            Ok(n) => pos += n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        }
    }
    Ok(pos)
}

fn is_visible_file(path: &Path, opts: &FindWalkOpts, scratch: &mut Vec<u8>) -> bool {
    if matches!(fast_ext_classify(path), ExtClass::Other) && is_binary_extension(path) {
        return opts.include_binary;
    }
    if !opts.probe_binary && !opts.measure_lines && !opts.include_binary {
        return true;
    }
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let Ok(meta) = file.metadata() else {
        return false;
    };
    let file_len = meta.len();
    if file_len > DEFAULT_MAX_TEXT_FILE_BYTES {
        return opts.include_binary;
    }
    if file_len == 0 || opts.include_binary || !opts.probe_binary {
        return true;
    }
    if scratch.len() < DEFAULT_BINARY_PROBE_BYTES {
        scratch.resize(DEFAULT_BINARY_PROBE_BYTES, 0);
    }
    let probe_len = (file_len as usize).min(DEFAULT_BINARY_PROBE_BYTES);
    let Ok(n) = read_into_slice(&mut file, &mut scratch[..probe_len]) else {
        return false;
    };
    let partial = file_len > n as u64;
    if !matches!(
        probe_bytes_with_partial(&scratch[..n], partial),
        BinaryProbeResult::Text
    ) {
        return false;
    }
    let mut utf8 = Utf8StreamValidator::new();
    if !utf8.push(&scratch[..n]) {
        return false;
    }
    let mut remaining = (file_len as usize).saturating_sub(n);
    while remaining > 0 {
        let want = remaining.min(scratch.len());
        let Ok(k) = read_into_slice(&mut file, &mut scratch[..want]) else {
            return false;
        };
        if k == 0 {
            break;
        }
        if scratch[..k].contains(&0) || !utf8.push(&scratch[..k]) {
            return false;
        }
        remaining = remaining.saturating_sub(k);
    }
    utf8.finish()
}

pub(crate) fn inspect_file(
    path: PathBuf,
    depth: usize,
    opts: &FindWalkOpts,
    scratch: &mut Vec<u8>,
) -> Option<WalkedFile> {
    let ext_class = fast_ext_classify(&path);
    let known_lang = match ext_class {
        ExtClass::Lang(lang) => Some(lang),
        ExtClass::PlainProbe => None,
        ExtClass::Other => {
            if is_binary_extension(&path) {
                if !opts.include_binary {
                    return None;
                }
                let byte_size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                return Some(binary_entry(path, byte_size, depth));
            }
            None
        }
    };
    if !opts.probe_binary && !opts.measure_lines && !opts.include_binary {
        let language = known_lang.unwrap_or_else(|| detect_language(&path, ""));
        return Some(WalkedFile { path, language, is_binary: false, line_count: 0, byte_size: 0, depth });
    }
    let mut file = std::fs::File::open(&path).ok()?;
    let file_len = file.metadata().ok()?.len();
    if file_len > DEFAULT_MAX_TEXT_FILE_BYTES {
        return opts.include_binary.then(|| binary_entry(path, file_len, depth));
    }
    if file_len == 0 {
        let language = known_lang.unwrap_or_else(|| detect_language(&path, ""));
        return Some(WalkedFile { path, language, is_binary: false, line_count: 0, byte_size: 0, depth });
    }
    if scratch.len() < STREAM_BUF_LEN {
        scratch.resize(STREAM_BUF_LEN, 0);
    }
    let first_target = if opts.measure_lines && file_len as usize <= STREAM_BUF_LEN {
        file_len as usize
    } else {
        (file_len as usize).min(DEFAULT_BINARY_PROBE_BYTES)
    };
    let n = read_into_slice(&mut file, &mut scratch[..first_target]).ok()?;
    let probe_len = n.min(DEFAULT_BINARY_PROBE_BYTES);
    let partial = file_len > probe_len as u64;
    let mut utf8 = Utf8StreamValidator::new();
    if opts.probe_binary
        && (!matches!(probe_bytes_with_partial(&scratch[..probe_len], partial), BinaryProbeResult::Text)
            || (n > probe_len && scratch[probe_len..n].contains(&0))
            || !utf8.push(&scratch[..n])
            || (file_len <= n as u64 && !utf8.finish()))
    {
        return opts.include_binary.then(|| binary_entry(path, file_len, depth));
    }
    let language = known_lang.unwrap_or_else(|| {
        let head = &scratch[..probe_len];
        let head_str = match std::str::from_utf8(head) {
            Ok(s) => s,
            Err(e) => std::str::from_utf8(&head[..e.valid_up_to()]).unwrap_or(""),
        };
        detect_language(&path, head_str)
    });
    let (line_count, byte_size) = if !opts.measure_lines {
        if opts.probe_binary && file_len > n as u64 {
            let max_rem = (DEFAULT_MAX_TEXT_FILE_BYTES as usize).saturating_sub(n);
            let mut remaining = (file_len as usize).saturating_sub(n).min(max_rem);
            while remaining > 0 {
                let want = remaining.min(STREAM_BUF_LEN);
                let Ok(k) = read_into_slice(&mut file, &mut scratch[..want]) else { break; };
                if k == 0 {
                    break;
                }
                if scratch[..k].contains(&0) || !utf8.push(&scratch[..k]) {
                    return opts.include_binary.then(|| binary_entry(path, file_len, depth));
                }
                remaining = remaining.saturating_sub(k);
            }
            if !utf8.finish() {
                return opts.include_binary.then(|| binary_entry(path, file_len, depth));
            }
        }
        (0, file_len)
    } else if file_len as usize <= STREAM_BUF_LEN {
        (count_lines_fast(&scratch[..n]), n as u64)
    } else if n == 0 {
        (0, 0)
    } else {
        let mut total_bytes = n;
        let mut total_lf = count_lf_swar(&scratch[..n]);
        let mut last_byte = scratch[n - 1];
        let max_rem = (DEFAULT_MAX_TEXT_FILE_BYTES as usize).saturating_sub(total_bytes);
        let mut remaining = (file_len as usize).saturating_sub(n).min(max_rem);
        while remaining > 0 {
            let want = remaining.min(STREAM_BUF_LEN);
            let Ok(k) = read_into_slice(&mut file, &mut scratch[..want]) else { break; };
            if k == 0 {
                break;
            }
            if opts.probe_binary && (scratch[..k].contains(&0) || !utf8.push(&scratch[..k])) {
                return opts.include_binary.then(|| binary_entry(path, file_len, depth));
            }
            total_bytes += k;
            total_lf += count_lf_swar(&scratch[..k]);
            last_byte = scratch[k - 1];
            remaining = remaining.saturating_sub(k);
        }
        if opts.probe_binary && !utf8.finish() {
            return opts.include_binary.then(|| binary_entry(path, file_len, depth));
        }
        let lines = if total_bytes == 0 { 0 } else if last_byte == b'\n' { total_lf } else { total_lf + 1 };
        (lines, total_bytes as u64)
    };
    Some(WalkedFile { path, language, is_binary: false, line_count, byte_size, depth })
}

fn binary_entry(path: PathBuf, byte_size: u64, depth: usize) -> WalkedFile {
    WalkedFile {
        path,
        language: LanguageId::PlainText,
        is_binary: true,
        line_count: 0,
        byte_size,
        depth,
    }
}
