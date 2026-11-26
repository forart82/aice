use std::fs::File;
use std::io::{BufRead, BufReader, Read};

use aice_aice_ir::DefaultAiceTranspiler;
use aice_aice_ir::ir::TranspileOpts;
use aice_ast_engine::EngineRegistry;
use aice_governance::ReadOp;
use aice_governance::binary_probe::{
    BinaryProbeResult, DEFAULT_BINARY_PROBE_BYTES, DEFAULT_MAX_TEXT_FILE_BYTES,
    probe_bytes_with_partial,
};
use aice_lang_registry::{AstSlice, detect_language};

use crate::matcher::ResolvedTarget;
use crate::render_single::{SingleRenderResult, binary_skip_result, err_result};
use crate::selector::TargetSelector;
use crate::transpile::{SliceTranspileReq, transpile_slice_aice};

pub(crate) fn render_oversized_target(
    target: &ResolvedTarget,
    file_len: u64,
    registry: &EngineRegistry,
    transpiler: &DefaultAiceTranspiler,
    op: &ReadOp,
) -> SingleRenderResult {
    let mut file = match File::open(&target.canonical) {
        Ok(f) => f,
        Err(e) => return err_result(format!("Failed reading {}: {e}", target.rel_path), None),
    };
    let mut probe = vec![0u8; DEFAULT_BINARY_PROBE_BYTES];
    let n = match read_probe(&mut file, &mut probe) {
        Ok(n) => n,
        Err(e) => return err_result(format!("Failed reading {}: {e}", target.rel_path), None),
    };
    if !matches!(
        probe_bytes_with_partial(&probe[..n], file_len > n as u64),
        BinaryProbeResult::Text
    ) {
        return binary_skip_result(&target.rel_path, file_len);
    }

    for sel in &target.spec.selectors {
        if let TargetSelector::InvertedLineRange { start, end } = sel {
            return err_result(
                format!("Invalid line range L{start}-L{end} for {}", target.rel_path),
                None,
            );
        }
    }

    let can_stream = !op.outline
        && !op.outline_target
        && !target.spec.selectors.is_empty()
        && target
            .spec
            .selectors
            .iter()
            .all(|s| matches!(s, TargetSelector::LineRange { .. }));
    if !can_stream {
        return err_result(
            format!(
                "File {} exceeds maximum text size ({file_len} > {DEFAULT_MAX_TEXT_FILE_BYTES} bytes); use a bounded line-range selector like {}:L1-L80",
                target.rel_path, target.rel_path
            ),
            None,
        );
    }

    let head_str = match std::str::from_utf8(&probe[..n]) {
        Ok(s) => s,
        Err(e) => std::str::from_utf8(&probe[..e.valid_up_to()]).unwrap_or(""),
    };
    let lang = detect_language(&target.canonical, head_str);
    let max_end = target
        .spec
        .selectors
        .iter()
        .filter_map(|s| match s {
            TargetSelector::LineRange { end, .. } => Some(*end),
            _ => None,
        })
        .max()
        .unwrap_or(1);

    let stream_file = match File::open(&target.canonical) {
        Ok(f) => f,
        Err(e) => return err_result(format!("Failed reading {}: {e}", target.rel_path), None),
    };
    let lines = match read_lines_prefix(stream_file, max_end) {
        Ok(Some(v)) => v,
        Ok(None) => return binary_skip_result(&target.rel_path, file_len),
        Err(e) => return err_result(format!("Failed reading {}: {e}", target.rel_path), None),
    };

    let opts = TranspileOpts {
        compact: op.compact,
        include_types: op.include_types,
        preserve_docs: true,
    };
    let mut header = format!("// file: {}\n", target.rel_path);
    if let Some(note) = &target.fuzzy_note {
        header.push_str(note);
    }
    let mut emitted = header.clone();
    let mut realistic_parts = Vec::new();
    for sel in &target.spec.selectors {
        if let TargetSelector::LineRange { start, end } = sel {
            let slice = slice_streamed_lines(&lines, *start, *end);
            realistic_parts.push(slice.content.clone());
            emitted.push_str(&format!("// slice: L{}-L{}\n", slice.start_line, slice.end_line));
            let body = transpile_slice_aice(&SliceTranspileReq {
                registry,
                transpiler,
                tree: None,
                lang,
                full_src: &slice.content,
                slice: &slice,
                sym_hint: None,
                opts: &opts,
            });
            emitted.push_str(&body);
            if !emitted.ends_with('\n') {
                emitted.push('\n');
            }
        }
    }
    let joined = realistic_parts.join("\n");
    SingleRenderResult {
        header,
        raw_baseline: joined.clone(),
        realistic_native: (!joined.is_empty()).then_some(joined),
        emitted,
        outline_text: String::new(),
        lang,
        error: None,
        wasted_payload: None,
    }
}

fn read_probe(file: &mut File, dst: &mut [u8]) -> std::io::Result<usize> {
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

fn read_lines_prefix(file: File, max_end: usize) -> std::io::Result<Option<Vec<String>>> {
    let mut reader = BufReader::new(file);
    let mut out = Vec::with_capacity(max_end.min(4096));
    let mut buf = Vec::new();
    while out.len() < max_end {
        buf.clear();
        let n = reader.read_until(b'\n', &mut buf)?;
        if n == 0 {
            break;
        }
        if buf.contains(&0) {
            return Ok(None);
        }
        let Ok(s) = std::str::from_utf8(&buf) else {
            return Ok(None);
        };
        let line = s.strip_suffix('\n').unwrap_or(s);
        let line = line.strip_suffix('\r').unwrap_or(line);
        out.push(line.to_string());
    }
    Ok(Some(out))
}

fn slice_streamed_lines(lines: &[String], start: usize, end: usize) -> AstSlice {
    if lines.is_empty() {
        return AstSlice { start_line: 1, end_line: 1, content: String::new() };
    }
    let s = start.clamp(1, lines.len());
    let e = end.clamp(s, lines.len());
    let content = format!("{}\n", lines[(s - 1)..e].join("\n"));
    AstSlice { start_line: s, end_line: e, content }
}
